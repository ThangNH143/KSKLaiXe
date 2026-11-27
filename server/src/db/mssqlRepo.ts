import sql from 'mssql';
import type { CertificateStatus } from '@gksk/shared';
import {
  cloneGkskRecord,
  createEmptyReconcileCounts,
  parseDateFilterEndIso,
  parseDateFilterStartIso,
  parseFieldsJson,
  parseServerIssuesJson,
  toIsoTimestamp,
  toSafeUserRow,
} from './inMemoryRepo.js';
import type {
  BatchesRepository,
  CertificateCountFilter,
  CertificateListQuery,
  CertificateListResult,
  CertificateRow,
  CertificatesRepository,
  CreateImportBatchInput,
  CreateSubmissionInput,
  DbRepositories,
  ImportBatchRow,
  ReconcileCounts,
  SafeUserRow,
  SubmissionRow,
  SubmissionsRepository,
  UpdateCertificateStatusInput,
  UpdateSubmissionInput,
  UpsertCertificateInput,
  UpsertCertificateResult,
  UpsertUserInput,
  UserRow,
  UsersRepository,
} from './types.js';

interface RawUserRecord {
  id: number;
  username: string;
  password_hash: string;
  full_name: string;
  is_active: boolean | number;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapRawUserRow(raw: RawUserRecord): UserRow {
  return {
    id: Number(raw.id),
    username: raw.username,
    passwordHash: raw.password_hash,
    fullName: raw.full_name ?? '',
    isActive: Boolean(raw.is_active),
    createdAt: toIsoTimestamp(raw.created_at),
    updatedAt: toIsoTimestamp(raw.updated_at),
  };
}

interface RawBatchRecord {
  id: number;
  filename: string;
  row_count: number;
  created_at: Date | string;
}

interface RawCertificateRecord {
  id: number;
  so: string;
  fields_json: string;
  data_sha256: string;
  status: string;
  batch_id: number | null;
  batch_filename?: string | null;
  excel_row_number: number | null;
  server_certificate_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RawSubmissionRecord {
  id: number;
  certificate_id: number;
  msg_id: string;
  send_datetime: number | string;
  data_sha256: string;
  attempts: number;
  http_status: number | null;
  res_code: string | null;
  result_status: string | null;
  server_submission_id: string | null;
  errors_json: string | null;
  warnings_json: string | null;
  last_error: string | null;
  created_at: Date | string;
  finished_at: Date | string | null;
}

/**
 * Escape các ký tự đại diện đặc biệt của T-SQL `LIKE` (`\`, `%`, `_`, `[`)
 * để tìm kiếm chuỗi con chính xác khi kết hợp với `LIKE @qPattern ESCAPE N'\'`.
 */
export function escapeSqlLikePattern(raw: string): string {
  return raw.replace(/[\\%_[]/g, (ch) => `\\${ch}`);
}

function mapRawBatchRow(raw: RawBatchRecord): ImportBatchRow {
  return {
    id: Number(raw.id),
    filename: raw.filename,
    rowCount: Number(raw.row_count),
    createdAt: toIsoTimestamp(raw.created_at),
  };
}

function mapRawCertificateRow(raw: RawCertificateRecord): CertificateRow {
  return {
    id: Number(raw.id),
    so: raw.so,
    fields: parseFieldsJson(raw.fields_json),
    fieldsJson: raw.fields_json,
    dataSha256: raw.data_sha256.trim(),
    status: raw.status as CertificateStatus,
    batchId: raw.batch_id !== null && raw.batch_id !== undefined ? Number(raw.batch_id) : null,
    batchFilename: raw.batch_filename ?? null,
    excelRowNumber:
      raw.excel_row_number !== null && raw.excel_row_number !== undefined
        ? Number(raw.excel_row_number)
        : null,
    serverCertificateId: raw.server_certificate_id ?? null,
    createdAt: toIsoTimestamp(raw.created_at),
    updatedAt: toIsoTimestamp(raw.updated_at),
  };
}

function mapRawSubmissionRow(raw: RawSubmissionRecord): SubmissionRow {
  const resultStatus =
    raw.result_status === 'accepted' || raw.result_status === 'rejected'
      ? raw.result_status
      : null;

  return {
    id: Number(raw.id),
    certificateId: Number(raw.certificate_id),
    msgId: raw.msg_id,
    sendDatetime: Number(raw.send_datetime),
    dataSha256: raw.data_sha256.trim(),
    attempts: Number(raw.attempts),
    httpStatus:
      raw.http_status !== null && raw.http_status !== undefined
        ? Number(raw.http_status)
        : null,
    resCode: raw.res_code ?? null,
    resultStatus,
    serverSubmissionId: raw.server_submission_id ?? null,
    errors: parseServerIssuesJson(raw.errors_json),
    errorsJson: raw.errors_json ?? null,
    warnings: parseServerIssuesJson(raw.warnings_json),
    warningsJson: raw.warnings_json ?? null,
    lastError: raw.last_error ?? null,
    createdAt: toIsoTimestamp(raw.created_at),
    finishedAt: raw.finished_at ? toIsoTimestamp(raw.finished_at) : null,
  };
}

function bindBaseFilterInputs(
  request: sql.Request,
  filter?: CertificateCountFilter,
): sql.Request {
  const batchId = filter?.batchId !== undefined ? filter.batchId : null;
  const fromIso = parseDateFilterStartIso(filter?.fromDate);
  const toIso = parseDateFilterEndIso(filter?.toDate);
  const qTrimmed = filter?.q?.trim() ?? '';
  const qPattern =
    qTrimmed.length > 0 ? `%${escapeSqlLikePattern(qTrimmed)}%` : null;

  request.input('batchId', sql.Int, batchId);
  request.input('fromDate', sql.DateTime2, fromIso ? new Date(fromIso) : null);
  request.input('toDate', sql.DateTime2, toIso ? new Date(toIso) : null);
  request.input('qPattern', sql.NVarChar(260), qPattern);
  return request;
}

/**
 * Cài đặt `DbRepositories` trên Microsoft SQL Server (`MssqlRepositories`).
 * Tuân thủ nghiêm ngặt quy tắc an toàn CSDL (AGENTS.md §3 & ARCHITECTURE.md §5):
 * - 100% bảng có tiền tố `gksk_` (`gksk_import_batches`, `gksk_certificates`, `gksk_submissions`).
 * - 100% câu truy vấn SQL dùng tham số `@param` qua `request.input('param', sql.Type, value)`.
 * - Tuyệt đối không ghép chuỗi giá trị vào SQL.
 */
export class MssqlRepositories implements DbRepositories {
  public readonly kind = 'mssql' as const;
  public readonly batches: BatchesRepository;
  public readonly certificates: CertificatesRepository;
  public readonly submissions: SubmissionsRepository;
  public readonly users: UsersRepository;

  private readonly pool: sql.ConnectionPool;

  constructor(pool: sql.ConnectionPool) {
    this.pool = pool;

    this.users = {
      findByUsername: async (username: string): Promise<UserRow | null> => {
        const cleanUsername = username.trim();
        if (!cleanUsername) {
          return null;
        }
        const result = await this.pool
          .request()
          .input('username', sql.NVarChar(64), cleanUsername)
          .query<RawUserRecord>(
            `
            SELECT id, username, password_hash, full_name, is_active, created_at, updated_at
            FROM dbo.gksk_users
            WHERE username = @username;
            `,
          );
        const row = result.recordset[0];
        return row ? mapRawUserRow(row) : null;
      },

      findById: async (id: number): Promise<UserRow | null> => {
        const result = await this.pool
          .request()
          .input('id', sql.Int, id)
          .query<RawUserRecord>(
            `
            SELECT id, username, password_hash, full_name, is_active, created_at, updated_at
            FROM dbo.gksk_users
            WHERE id = @id;
            `,
          );
        const row = result.recordset[0];
        return row ? mapRawUserRow(row) : null;
      },

      list: async (): Promise<SafeUserRow[]> => {
        const result = await this.pool.request().query<RawUserRecord>(
          `
          SELECT id, username, password_hash, full_name, is_active, created_at, updated_at
          FROM dbo.gksk_users
          ORDER BY id ASC;
          `,
        );
        return result.recordset.map((raw) => toSafeUserRow(mapRawUserRow(raw)));
      },

      upsertByUsername: async (
        input: UpsertUserInput,
      ): Promise<{ row: SafeUserRow; created: boolean }> => {
        const cleanUsername = input.username.trim();
        if (!cleanUsername) {
          throw new Error('Tên đăng nhập (username) không được để trống.');
        }

        const nowDate = new Date(toIsoTimestamp(input.now));
        const existing = await this.users.findByUsername(cleanUsername);

        if (existing) {
          const nextFullName =
            input.fullName !== undefined ? input.fullName.trim() : existing.fullName;
          const nextIsActive =
            input.isActive !== undefined ? input.isActive : existing.isActive;

          const result = await this.pool
            .request()
            .input('id', sql.Int, existing.id)
            .input('passwordHash', sql.NVarChar(255), input.passwordHash)
            .input('fullName', sql.NVarChar(128), nextFullName)
            .input('isActive', sql.Bit, nextIsActive)
            .input('updatedAt', sql.DateTime2, nowDate)
            .query<RawUserRecord>(
              `
              UPDATE dbo.gksk_users
              SET password_hash = @passwordHash,
                  full_name = @fullName,
                  is_active = @isActive,
                  updated_at = @updatedAt
              OUTPUT INSERTED.id, INSERTED.username, INSERTED.password_hash, INSERTED.full_name, INSERTED.is_active, INSERTED.created_at, INSERTED.updated_at
              WHERE id = @id;
              `,
            );

          const updatedRaw = result.recordset[0];
          if (!updatedRaw) {
            throw new Error('Không tìm thấy bản ghi sau khi cập nhật dbo.gksk_users.');
          }
          return {
            row: toSafeUserRow(mapRawUserRow(updatedRaw)),
            created: false,
          };
        }

        const insertResult = await this.pool
          .request()
          .input('username', sql.NVarChar(64), cleanUsername)
          .input('passwordHash', sql.NVarChar(255), input.passwordHash)
          .input('fullName', sql.NVarChar(128), (input.fullName ?? '').trim())
          .input('isActive', sql.Bit, input.isActive ?? true)
          .input('createdAt', sql.DateTime2, nowDate)
          .input('updatedAt', sql.DateTime2, nowDate)
          .query<RawUserRecord>(
            `
            INSERT INTO dbo.gksk_users (
              username,
              password_hash,
              full_name,
              is_active,
              created_at,
              updated_at
            )
            OUTPUT INSERTED.id, INSERTED.username, INSERTED.password_hash, INSERTED.full_name, INSERTED.is_active, INSERTED.created_at, INSERTED.updated_at
            VALUES (
              @username,
              @passwordHash,
              @fullName,
              @isActive,
              @createdAt,
              @updatedAt
            );
            `,
          );

        const createdRaw = insertResult.recordset[0];
        if (!createdRaw) {
          throw new Error('Không thể thêm mới bản ghi vào dbo.gksk_users.');
        }
        return {
          row: toSafeUserRow(mapRawUserRow(createdRaw)),
          created: true,
        };
      },

      updatePassword: async (
        id: number,
        passwordHash: string,
        now?: string | Date,
      ): Promise<SafeUserRow | null> => {
        const updatedAt = new Date(toIsoTimestamp(now));
        const result = await this.pool
          .request()
          .input('id', sql.Int, id)
          .input('passwordHash', sql.NVarChar(255), passwordHash)
          .input('updatedAt', sql.DateTime2, updatedAt)
          .query<RawUserRecord>(
            `
            UPDATE dbo.gksk_users
            SET password_hash = @passwordHash,
                updated_at = @updatedAt
            OUTPUT INSERTED.id, INSERTED.username, INSERTED.password_hash, INSERTED.full_name, INSERTED.is_active, INSERTED.created_at, INSERTED.updated_at
            WHERE id = @id;
            `,
          );
        const row = result.recordset[0];
        return row ? toSafeUserRow(mapRawUserRow(row)) : null;
      },

      updateActiveStatus: async (
        id: number,
        isActive: boolean,
        now?: string | Date,
      ): Promise<SafeUserRow | null> => {
        const updatedAt = new Date(toIsoTimestamp(now));
        const result = await this.pool
          .request()
          .input('id', sql.Int, id)
          .input('isActive', sql.Bit, isActive)
          .input('updatedAt', sql.DateTime2, updatedAt)
          .query<RawUserRecord>(
            `
            UPDATE dbo.gksk_users
            SET is_active = @isActive,
                updated_at = @updatedAt
            OUTPUT INSERTED.id, INSERTED.username, INSERTED.password_hash, INSERTED.full_name, INSERTED.is_active, INSERTED.created_at, INSERTED.updated_at
            WHERE id = @id;
            `,
          );
        const row = result.recordset[0];
        return row ? toSafeUserRow(mapRawUserRow(row)) : null;
      },
    };

    this.batches = {
      create: async (input: CreateImportBatchInput): Promise<ImportBatchRow> => {
        const createdAt = new Date(toIsoTimestamp(input.createdAt));
        const result = await this.pool
          .request()
          .input('filename', sql.NVarChar(255), input.filename.trim())
          .input('rowCount', sql.Int, input.rowCount)
          .input('createdAt', sql.DateTime2, createdAt)
          .query<RawBatchRecord>(
            `
            INSERT INTO dbo.gksk_import_batches (filename, row_count, created_at)
            OUTPUT INSERTED.id, INSERTED.filename, INSERTED.row_count, INSERTED.created_at
            VALUES (@filename, @rowCount, @createdAt);
            `,
          );

        const row = result.recordset[0];
        if (!row) {
          throw new Error('Không thể tạo bản ghi trong dbo.gksk_import_batches.');
        }
        return mapRawBatchRow(row);
      },

      findById: async (id: number): Promise<ImportBatchRow | null> => {
        const result = await this.pool
          .request()
          .input('id', sql.Int, id)
          .query<RawBatchRecord>(
            `
            SELECT id, filename, row_count, created_at
            FROM dbo.gksk_import_batches
            WHERE id = @id;
            `,
          );

        const row = result.recordset[0];
        return row ? mapRawBatchRow(row) : null;
      },

      list: async (): Promise<ImportBatchRow[]> => {
        const result = await this.pool.request().query<RawBatchRecord>(
          `
          SELECT id, filename, row_count, created_at
          FROM dbo.gksk_import_batches
          ORDER BY id DESC;
          `,
        );

        return result.recordset.map(mapRawBatchRow);
      },
    };

    this.certificates = {
      upsertBySo: async (
        input: UpsertCertificateInput,
      ): Promise<UpsertCertificateResult> => {
        const cleanSo = input.so.trim();
        if (cleanSo.length === 0) {
          throw new Error('Mã số giấy (so) không được để trống khi lưu vào CSDL.');
        }

        const nowDate = new Date(toIsoTimestamp(input.now));
        const cleanFields = cloneGkskRecord(input.fields);
        const fieldsJson = JSON.stringify(cleanFields);

        const existing = await this.certificates.findBySo(cleanSo);
        if (existing) {
          const nextBatchId =
            input.batchId !== undefined ? input.batchId : existing.batchId;
          const nextExcelRow =
            input.excelRowNumber !== undefined
              ? input.excelRowNumber
              : existing.excelRowNumber;
          const nextServerCertId =
            input.serverCertificateId !== undefined
              ? input.serverCertificateId
              : existing.serverCertificateId;

          await this.pool
            .request()
            .input('id', sql.Int, existing.id)
            .input('fieldsJson', sql.NVarChar(sql.MAX), fieldsJson)
            .input('dataSha256', sql.Char(64), input.dataSha256)
            .input('status', sql.VarChar(20), input.status)
            .input('batchId', sql.Int, nextBatchId)
            .input('excelRowNumber', sql.Int, nextExcelRow)
            .input('serverCertificateId', sql.NVarChar(64), nextServerCertId)
            .input('updatedAt', sql.DateTime2, nowDate)
            .query(
              `
              UPDATE dbo.gksk_certificates
              SET fields_json = @fieldsJson,
                  data_sha256 = @dataSha256,
                  status = @status,
                  batch_id = @batchId,
                  excel_row_number = @excelRowNumber,
                  server_certificate_id = @serverCertificateId,
                  updated_at = @updatedAt
              WHERE id = @id;
              `,
            );

          const updatedRow = await this.certificates.findById(existing.id);
          if (!updatedRow) {
            throw new Error('Không tìm thấy bản ghi sau khi cập nhật dbo.gksk_certificates.');
          }
          return {
            row: updatedRow,
            created: false,
          };
        }

        const insertResult = await this.pool
          .request()
          .input('so', sql.NVarChar(64), cleanSo)
          .input('fieldsJson', sql.NVarChar(sql.MAX), fieldsJson)
          .input('dataSha256', sql.Char(64), input.dataSha256)
          .input('status', sql.VarChar(20), input.status)
          .input('batchId', sql.Int, input.batchId ?? null)
          .input('excelRowNumber', sql.Int, input.excelRowNumber ?? null)
          .input('serverCertificateId', sql.NVarChar(64), input.serverCertificateId ?? null)
          .input('createdAt', sql.DateTime2, nowDate)
          .input('updatedAt', sql.DateTime2, nowDate)
          .query<{ id: number }>(
            `
            INSERT INTO dbo.gksk_certificates (
              so,
              fields_json,
              data_sha256,
              status,
              batch_id,
              excel_row_number,
              server_certificate_id,
              created_at,
              updated_at
            )
            OUTPUT INSERTED.id
            VALUES (
              @so,
              @fieldsJson,
              @dataSha256,
              @status,
              @batchId,
              @excelRowNumber,
              @serverCertificateId,
              @createdAt,
              @updatedAt
            );
            `,
          );

        const insertedId = insertResult.recordset[0]?.id;
        if (insertedId === undefined) {
          throw new Error('Không thể thêm mới bản ghi vào dbo.gksk_certificates.');
        }

        const createdRow = await this.certificates.findById(Number(insertedId));
        if (!createdRow) {
          throw new Error('Không tìm thấy bản ghi vừa thêm trong dbo.gksk_certificates.');
        }

        return {
          row: createdRow,
          created: true,
        };
      },

      upsertManyBySo: async (inputs: readonly UpsertCertificateInput[]) => {
        let inserted = 0;
        let updated = 0;
        const rows: CertificateRow[] = [];

        for (const item of inputs) {
          const res = await this.certificates.upsertBySo(item);
          if (res.created) {
            inserted += 1;
          } else {
            updated += 1;
          }
          rows.push(res.row);
        }

        return { inserted, updated, rows };
      },

      findById: async (id: number): Promise<CertificateRow | null> => {
        const result = await this.pool
          .request()
          .input('id', sql.Int, id)
          .query<RawCertificateRecord>(
            `
            SELECT
              c.id,
              c.so,
              c.fields_json,
              c.data_sha256,
              c.status,
              c.batch_id,
              b.filename AS batch_filename,
              c.excel_row_number,
              c.server_certificate_id,
              c.created_at,
              c.updated_at
            FROM dbo.gksk_certificates c
            LEFT JOIN dbo.gksk_import_batches b ON b.id = c.batch_id
            WHERE c.id = @id;
            `,
          );

        const row = result.recordset[0];
        return row ? mapRawCertificateRow(row) : null;
      },

      findByIds: async (ids: readonly number[]): Promise<CertificateRow[]> => {
        if (ids.length === 0) {
          return [];
        }
        const idsJson = JSON.stringify(ids);
        const result = await this.pool
          .request()
          .input('idsJson', sql.NVarChar(sql.MAX), idsJson)
          .query<RawCertificateRecord>(
            `
            SELECT
              c.id,
              c.so,
              c.fields_json,
              c.data_sha256,
              c.status,
              c.batch_id,
              b.filename AS batch_filename,
              c.excel_row_number,
              c.server_certificate_id,
              c.created_at,
              c.updated_at
            FROM dbo.gksk_certificates c
            LEFT JOIN dbo.gksk_import_batches b ON b.id = c.batch_id
            WHERE c.id IN (
              SELECT CAST([value] AS INT) FROM OPENJSON(@idsJson)
            )
            ORDER BY c.id ASC;
            `,
          );

        return result.recordset.map(mapRawCertificateRow);
      },

      findBySo: async (so: string): Promise<CertificateRow | null> => {
        const result = await this.pool
          .request()
          .input('so', sql.NVarChar(64), so.trim())
          .query<RawCertificateRecord>(
            `
            SELECT
              c.id,
              c.so,
              c.fields_json,
              c.data_sha256,
              c.status,
              c.batch_id,
              b.filename AS batch_filename,
              c.excel_row_number,
              c.server_certificate_id,
              c.created_at,
              c.updated_at
            FROM dbo.gksk_certificates c
            LEFT JOIN dbo.gksk_import_batches b ON b.id = c.batch_id
            WHERE c.so = @so;
            `,
          );

        const row = result.recordset[0];
        return row ? mapRawCertificateRow(row) : null;
      },

      findBySoList: async (soList: readonly string[]): Promise<CertificateRow[]> => {
        const uniqueSos = Array.from(
          new Set(soList.map((s) => s.trim()).filter((s) => s.length > 0)),
        );
        if (uniqueSos.length === 0) {
          return [];
        }

        const soListJson = JSON.stringify(uniqueSos);
        const result = await this.pool
          .request()
          .input('soListJson', sql.NVarChar(sql.MAX), soListJson)
          .query<RawCertificateRecord>(
            `
            SELECT
              c.id,
              c.so,
              c.fields_json,
              c.data_sha256,
              c.status,
              c.batch_id,
              b.filename AS batch_filename,
              c.excel_row_number,
              c.server_certificate_id,
              c.created_at,
              c.updated_at
            FROM dbo.gksk_certificates c
            LEFT JOIN dbo.gksk_import_batches b ON b.id = c.batch_id
            WHERE c.so IN (
              SELECT [value] FROM OPENJSON(@soListJson)
            )
            ORDER BY c.id ASC;
            `,
          );

        return result.recordset.map(mapRawCertificateRow);
      },

      countByStatus: async (
        filter?: CertificateCountFilter,
      ): Promise<ReconcileCounts> => {
        const request = bindBaseFilterInputs(this.pool.request(), filter);
        const result = await request.query<{
          status: string;
          cnt: number;
        }>(
          `
          SELECT c.status, COUNT(1) AS cnt
          FROM dbo.gksk_certificates c
          WHERE (@batchId IS NULL OR c.batch_id = @batchId)
            AND (@fromDate IS NULL OR c.created_at >= @fromDate)
            AND (@toDate IS NULL OR c.created_at <= @toDate)
            AND (
              @qPattern IS NULL
              OR c.so LIKE @qPattern ESCAPE N'\\'
              OR JSON_VALUE(c.fields_json, N'$.HOTEN') LIKE @qPattern ESCAPE N'\\'
              OR JSON_VALUE(c.fields_json, N'$.SOCMND_PASSPORT') LIKE @qPattern ESCAPE N'\\'
            )
          GROUP BY c.status;
          `,
        );

        const counts = createEmptyReconcileCounts();
        for (const row of result.recordset) {
          const st = row.status as CertificateStatus;
          const cnt = Number(row.cnt);
          if (st in counts) {
            counts[st] += cnt;
            counts.all += cnt;
          }
        }
        counts.unsent = counts.ready;
        counts.attention = counts.invalid + counts.rejected + counts.error;
        return counts;
      },

      list: async (query?: CertificateListQuery): Promise<CertificateListResult> => {
        const page = Math.max(1, Math.floor(query?.page ?? 1));
        const pageSize = Math.min(1000, Math.max(1, Math.floor(query?.pageSize ?? 50)));
        const offset = (page - 1) * pageSize;
        const tab = query?.tab ?? 'all';
        const statusFilter = query?.status ?? null;

        const counts = await this.certificates.countByStatus(query);

        const countRequest = bindBaseFilterInputs(this.pool.request(), query)
          .input('tab', sql.VarChar(20), tab)
          .input('statusFilter', sql.VarChar(20), statusFilter);

        const totalResult = await countRequest.query<{ total: number }>(
          `
          SELECT COUNT(1) AS total
          FROM dbo.gksk_certificates c
          WHERE (@batchId IS NULL OR c.batch_id = @batchId)
            AND (@fromDate IS NULL OR c.created_at >= @fromDate)
            AND (@toDate IS NULL OR c.created_at <= @toDate)
            AND (
              @qPattern IS NULL
              OR c.so LIKE @qPattern ESCAPE N'\\'
              OR JSON_VALUE(c.fields_json, N'$.HOTEN') LIKE @qPattern ESCAPE N'\\'
              OR JSON_VALUE(c.fields_json, N'$.SOCMND_PASSPORT') LIKE @qPattern ESCAPE N'\\'
            )
            AND (
              @tab = 'all'
              OR (@tab = 'unsent' AND c.status = 'ready')
              OR (@tab = 'accepted' AND c.status = 'accepted')
              OR (@tab = 'attention' AND c.status IN ('invalid', 'rejected', 'error'))
            )
            AND (@statusFilter IS NULL OR c.status = @statusFilter);
          `,
        );

        const total = Number(totalResult.recordset[0]?.total ?? 0);

        const listRequest = bindBaseFilterInputs(this.pool.request(), query)
          .input('tab', sql.VarChar(20), tab)
          .input('statusFilter', sql.VarChar(20), statusFilter)
          .input('offset', sql.Int, offset)
          .input('pageSize', sql.Int, pageSize);

        const itemsResult = await listRequest.query<RawCertificateRecord>(
          `
          SELECT
            c.id,
            c.so,
            c.fields_json,
            c.data_sha256,
            c.status,
            c.batch_id,
            b.filename AS batch_filename,
            c.excel_row_number,
            c.server_certificate_id,
            c.created_at,
            c.updated_at
          FROM dbo.gksk_certificates c
          LEFT JOIN dbo.gksk_import_batches b ON b.id = c.batch_id
          WHERE (@batchId IS NULL OR c.batch_id = @batchId)
            AND (@fromDate IS NULL OR c.created_at >= @fromDate)
            AND (@toDate IS NULL OR c.created_at <= @toDate)
            AND (
              @qPattern IS NULL
              OR c.so LIKE @qPattern ESCAPE N'\\'
              OR JSON_VALUE(c.fields_json, N'$.HOTEN') LIKE @qPattern ESCAPE N'\\'
              OR JSON_VALUE(c.fields_json, N'$.SOCMND_PASSPORT') LIKE @qPattern ESCAPE N'\\'
            )
            AND (
              @tab = 'all'
              OR (@tab = 'unsent' AND c.status = 'ready')
              OR (@tab = 'accepted' AND c.status = 'accepted')
              OR (@tab = 'attention' AND c.status IN ('invalid', 'rejected', 'error'))
            )
            AND (@statusFilter IS NULL OR c.status = @statusFilter)
          ORDER BY c.id DESC
          OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
          `,
        );

        return {
          items: itemsResult.recordset.map(mapRawCertificateRow),
          total,
          page,
          pageSize,
          counts,
        };
      },

      updateStatus: async (
        id: number,
        input: UpdateCertificateStatusInput,
      ): Promise<CertificateRow | null> => {
        const existing = await this.certificates.findById(id);
        if (!existing) {
          return null;
        }

        const nextServerCertId =
          input.serverCertificateId !== undefined
            ? input.serverCertificateId
            : existing.serverCertificateId;
        const updatedAt = new Date(toIsoTimestamp(input.now));

        await this.pool
          .request()
          .input('id', sql.Int, id)
          .input('status', sql.VarChar(20), input.status)
          .input('serverCertificateId', sql.NVarChar(64), nextServerCertId)
          .input('updatedAt', sql.DateTime2, updatedAt)
          .query(
            `
            UPDATE dbo.gksk_certificates
            SET status = @status,
                server_certificate_id = @serverCertificateId,
                updated_at = @updatedAt
            WHERE id = @id;
            `,
          );

        return this.certificates.findById(id);
      },

      deleteById: async (id: number): Promise<boolean> => {
        const result = await this.pool
          .request()
          .input('id', sql.Int, id)
          .query(
            `
            DELETE FROM dbo.gksk_certificates
            WHERE id = @id;
            `,
          );

        const affected = result.rowsAffected[0] ?? 0;
        return affected > 0;
      },

      recoverOnStartup: async (now?: string | Date): Promise<number> => {
        const updatedAt = new Date(toIsoTimestamp(now));
        const result = await this.pool
          .request()
          .input('fromStatus', sql.VarChar(20), 'sending')
          .input('toStatus', sql.VarChar(20), 'error')
          .input('updatedAt', sql.DateTime2, updatedAt)
          .query(
            `
            UPDATE dbo.gksk_certificates
            SET status = @toStatus,
                updated_at = @updatedAt
            WHERE status = @fromStatus;
            `,
          );

        return result.rowsAffected[0] ?? 0;
      },
    };

    this.submissions = {
      create: async (input: CreateSubmissionInput): Promise<SubmissionRow> => {
        const errorsJson =
          input.errors !== undefined && input.errors !== null
            ? JSON.stringify(input.errors)
            : null;
        const warningsJson =
          input.warnings !== undefined && input.warnings !== null
            ? JSON.stringify(input.warnings)
            : null;
        const createdAt = new Date(toIsoTimestamp(input.createdAt));
        const finishedAt = input.finishedAt
          ? new Date(toIsoTimestamp(input.finishedAt))
          : null;

        const result = await this.pool
          .request()
          .input('certificateId', sql.Int, input.certificateId)
          .input('msgId', sql.VarChar(64), input.msgId.trim())
          .input('sendDatetime', sql.BigInt, input.sendDatetime)
          .input('dataSha256', sql.Char(64), input.dataSha256)
          .input('attempts', sql.Int, input.attempts ?? 0)
          .input('httpStatus', sql.Int, input.httpStatus ?? null)
          .input('resCode', sql.VarChar(64), input.resCode ?? null)
          .input('resultStatus', sql.VarChar(20), input.resultStatus ?? null)
          .input('serverSubmissionId', sql.NVarChar(64), input.serverSubmissionId ?? null)
          .input('errorsJson', sql.NVarChar(sql.MAX), errorsJson)
          .input('warningsJson', sql.NVarChar(sql.MAX), warningsJson)
          .input('lastError', sql.NVarChar(500), input.lastError ?? null)
          .input('createdAt', sql.DateTime2, createdAt)
          .input('finishedAt', sql.DateTime2, finishedAt)
          .query<RawSubmissionRecord>(
            `
            INSERT INTO dbo.gksk_submissions (
              certificate_id,
              msg_id,
              send_datetime,
              data_sha256,
              attempts,
              http_status,
              res_code,
              result_status,
              server_submission_id,
              errors_json,
              warnings_json,
              last_error,
              created_at,
              finished_at
            )
            OUTPUT INSERTED.*
            VALUES (
              @certificateId,
              @msgId,
              @sendDatetime,
              @dataSha256,
              @attempts,
              @httpStatus,
              @resCode,
              @resultStatus,
              @serverSubmissionId,
              @errorsJson,
              @warningsJson,
              @lastError,
              @createdAt,
              @finishedAt
            );
            `,
          );

        const row = result.recordset[0];
        if (!row) {
          throw new Error('Không thể tạo bản ghi trong dbo.gksk_submissions.');
        }
        return mapRawSubmissionRow(row);
      },

      update: async (
        id: number,
        input: UpdateSubmissionInput,
      ): Promise<SubmissionRow | null> => {
        const existing = await this.submissions.findById(id);
        if (!existing) {
          return null;
        }

        const nextMsgId =
          input.msgId !== undefined ? input.msgId.trim() : existing.msgId;
        const nextSendDatetime = input.sendDatetime ?? existing.sendDatetime;
        const nextAttempts = input.attempts ?? existing.attempts;
        const nextHttpStatus =
          input.httpStatus !== undefined ? input.httpStatus : existing.httpStatus;
        const nextResCode =
          input.resCode !== undefined ? input.resCode : existing.resCode;
        const nextResultStatus =
          input.resultStatus !== undefined ? input.resultStatus : existing.resultStatus;
        const nextServerSubmissionId =
          input.serverSubmissionId !== undefined
            ? input.serverSubmissionId
            : existing.serverSubmissionId;
        const nextErrorsJson =
          input.errors !== undefined
            ? input.errors !== null
              ? JSON.stringify(input.errors)
              : null
            : existing.errorsJson;
        const nextWarningsJson =
          input.warnings !== undefined
            ? input.warnings !== null
              ? JSON.stringify(input.warnings)
              : null
            : existing.warningsJson;
        const nextLastError =
          input.lastError !== undefined ? input.lastError : existing.lastError;
        const nextFinishedAt =
          input.finishedAt !== undefined
            ? input.finishedAt
              ? new Date(toIsoTimestamp(input.finishedAt))
              : null
            : existing.finishedAt
              ? new Date(existing.finishedAt)
              : null;

        const result = await this.pool
          .request()
          .input('id', sql.Int, id)
          .input('msgId', sql.VarChar(64), nextMsgId)
          .input('sendDatetime', sql.BigInt, nextSendDatetime)
          .input('attempts', sql.Int, nextAttempts)
          .input('httpStatus', sql.Int, nextHttpStatus)
          .input('resCode', sql.VarChar(64), nextResCode)
          .input('resultStatus', sql.VarChar(20), nextResultStatus)
          .input('serverSubmissionId', sql.NVarChar(64), nextServerSubmissionId)
          .input('errorsJson', sql.NVarChar(sql.MAX), nextErrorsJson)
          .input('warningsJson', sql.NVarChar(sql.MAX), nextWarningsJson)
          .input('lastError', sql.NVarChar(500), nextLastError)
          .input('finishedAt', sql.DateTime2, nextFinishedAt)
          .query<RawSubmissionRecord>(
            `
            UPDATE dbo.gksk_submissions
            SET msg_id = @msgId,
                send_datetime = @sendDatetime,
                attempts = @attempts,
                http_status = @httpStatus,
                res_code = @resCode,
                result_status = @resultStatus,
                server_submission_id = @serverSubmissionId,
                errors_json = @errorsJson,
                warnings_json = @warningsJson,
                last_error = @lastError,
                finished_at = @finishedAt
            OUTPUT INSERTED.*
            WHERE id = @id;
            `,
          );

        const row = result.recordset[0];
        return row ? mapRawSubmissionRow(row) : null;
      },

      findById: async (id: number): Promise<SubmissionRow | null> => {
        const result = await this.pool
          .request()
          .input('id', sql.Int, id)
          .query<RawSubmissionRecord>(
            `
            SELECT *
            FROM dbo.gksk_submissions
            WHERE id = @id;
            `,
          );

        const row = result.recordset[0];
        return row ? mapRawSubmissionRow(row) : null;
      },

      findByMsgId: async (msgId: string): Promise<SubmissionRow | null> => {
        const result = await this.pool
          .request()
          .input('msgId', sql.VarChar(64), msgId.trim())
          .query<RawSubmissionRecord>(
            `
            SELECT *
            FROM dbo.gksk_submissions
            WHERE msg_id = @msgId;
            `,
          );

        const row = result.recordset[0];
        return row ? mapRawSubmissionRow(row) : null;
      },

      listByCertificateId: async (certificateId: number): Promise<SubmissionRow[]> => {
        const result = await this.pool
          .request()
          .input('certificateId', sql.Int, certificateId)
          .query<RawSubmissionRecord>(
            `
            SELECT *
            FROM dbo.gksk_submissions
            WHERE certificate_id = @certificateId
            ORDER BY id DESC;
            `,
          );

        return result.recordset.map(mapRawSubmissionRow);
      },

      findLatestByCertificateId: async (
        certificateId: number,
      ): Promise<SubmissionRow | null> => {
        const result = await this.pool
          .request()
          .input('certificateId', sql.Int, certificateId)
          .query<RawSubmissionRecord>(
            `
            SELECT TOP (1) *
            FROM dbo.gksk_submissions
            WHERE certificate_id = @certificateId
            ORDER BY id DESC;
            `,
          );

        const row = result.recordset[0];
        return row ? mapRawSubmissionRow(row) : null;
      },

      findLatestByCertificateIds: async (
        certificateIds: readonly number[],
      ): Promise<Map<number, SubmissionRow>> => {
        const latestMap = new Map<number, SubmissionRow>();
        if (certificateIds.length === 0) {
          return latestMap;
        }

        const idsJson = JSON.stringify(certificateIds);
        const result = await this.pool
          .request()
          .input('idsJson', sql.NVarChar(sql.MAX), idsJson)
          .query<RawSubmissionRecord>(
            `
            SELECT s.*
            FROM dbo.gksk_submissions s
            WHERE s.certificate_id IN (
              SELECT CAST([value] AS INT) FROM OPENJSON(@idsJson)
            )
            ORDER BY s.id DESC;
            `,
          );

        for (const raw of result.recordset) {
          const row = mapRawSubmissionRow(raw);
          if (!latestMap.has(row.certificateId)) {
            latestMap.set(row.certificateId, row);
          }
        }
        return latestMap;
      },

      findPendingByCertificateAndSha: async (
        certificateId: number,
        dataSha256: string,
      ): Promise<SubmissionRow | null> => {
        const result = await this.pool
          .request()
          .input('certificateId', sql.Int, certificateId)
          .input('dataSha256', sql.Char(64), dataSha256)
          .query<RawSubmissionRecord>(
            `
            SELECT TOP (1) *
            FROM dbo.gksk_submissions
            WHERE certificate_id = @certificateId
              AND data_sha256 = @dataSha256
              AND result_status IS NULL
            ORDER BY id DESC;
            `,
          );

        const row = result.recordset[0];
        return row ? mapRawSubmissionRow(row) : null;
      },
    };
  }
}
