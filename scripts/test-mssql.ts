import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type sql from 'mssql';
import {
  createEmptyRecord,
  FIELD_ORDER,
  type CertificateStatus,
  type GkskRecord,
} from '../packages/shared/src/index.js';
import type { AppConfig } from '../server/src/config.js';
import {
  buildMssqlPoolConfig,
  createMssqlPool,
  createRepositories,
  resolveDefaultMigrationsDir,
  runMigrations,
} from '../server/src/db/connection.js';
import { MssqlRepositories } from '../server/src/db/mssqlRepo.js';
import { GKSK_TABLE_NAMES } from '../server/src/db/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function makeSampleRecord(overrides: Partial<GkskRecord> = {}): GkskRecord {
  const base = createEmptyRecord();
  return {
    ...base,
    SO: 'TEST.75001.MSSQL.01',
    NGAYKHAM: '05/11/2026',
    HOTEN: 'TEST NGUYEN VAN MSSQL',
    GIOITINHVAL: '0',
    NGAYSINH: '21/05/1990',
    DIACHITHUONGTRU: 'Bien Hoa, Dong Nai',
    MATINH_THUONGTRU: '75',
    MAHUYEN_THUONGTRU: '75731',
    MAXA_THUONGTRU: '7573126041',
    SOCMND_PASSPORT: 'TESTGKSK01',
    NGAYTHANGNAMCAP: '01/02/2021',
    NOICAP: 'Cuc CS QLHC ve TTXH Bo Cong An',
    HANGBANGLAI: 'B2',
    IDBENHVIEN: '75001',
    BENHVIEN: 'Benh vien Da khoa Dong Nai',
    NGAYKETLUAN: '06/11/2026',
    NONGDOCON: '0',
    DVINONGDOCON: '0',
    MATUY: '0',
    BACSYKETLUAN: 'TEST BAC SI',
    KETLUAN: 'A0-1',
    STATE: 'ADD',
    ...overrides,
  };
}

function sha(label: string): string {
  return label.padEnd(64, '0').slice(0, 64).toUpperCase();
}

export interface MssqlEmulatorState {
  tablesCreated: Set<string>;
  indexesCreated: Set<string>;
  migrations: Array<{ version: string; applied_at: Date }>;
  batches: Array<{
    id: number;
    filename: string;
    row_count: number;
    created_at: Date;
  }>;
  certificates: Array<{
    id: number;
    so: string;
    fields_json: string;
    data_sha256: string;
    status: CertificateStatus;
    batch_id: number | null;
    excel_row_number: number | null;
    server_certificate_id: string | null;
    created_at: Date;
    updated_at: Date;
  }>;
  submissions: Array<{
    id: number;
    certificate_id: number;
    msg_id: string;
    send_datetime: number;
    data_sha256: string;
    attempts: number;
    http_status: number | null;
    res_code: string | null;
    result_status: string | null;
    server_submission_id: string | null;
    errors_json: string | null;
    warnings_json: string | null;
    last_error: string | null;
    created_at: Date;
    finished_at: Date | null;
  }>;
  sqlCallLog: Array<{
    sqlText: string;
    params: Record<string, unknown>;
  }>;
}

/**
 * Tạo `sql.ConnectionPool` giả lập động cơ T-SQL cho 4 bảng `dbo.gksk_*`
 * để kiểm thử 100% đường chạy `runMigrations(pool)` và `MssqlRepositories(pool)`
 * ngay cả khi máy trạm kiểm thử chưa mở cổng TCP 1433.
 */
export function createStatefulMssqlPoolEmulator(): {
  pool: sql.ConnectionPool;
  state: MssqlEmulatorState;
} {
  let nextBatchId = 1;
  let nextCertId = 1;
  let nextSubId = 1;

  const state: MssqlEmulatorState = {
    tablesCreated: new Set<string>(),
    indexesCreated: new Set<string>(),
    migrations: [],
    batches: [],
    certificates: [],
    submissions: [],
    sqlCallLog: [],
  };

  function matchCertWhere(
    cert: MssqlEmulatorState['certificates'][number],
    params: Record<string, unknown>,
    checkTabAndStatus: boolean,
  ): boolean {
    const batchId = params.batchId as number | null | undefined;
    if (batchId !== null && batchId !== undefined && cert.batch_id !== batchId) {
      return false;
    }

    const fromDate = params.fromDate as Date | null | undefined;
    if (fromDate instanceof Date && cert.created_at.getTime() < fromDate.getTime()) {
      return false;
    }

    const toDate = params.toDate as Date | null | undefined;
    if (toDate instanceof Date && cert.created_at.getTime() > toDate.getTime()) {
      return false;
    }

    const qPattern = params.qPattern as string | null | undefined;
    if (typeof qPattern === 'string' && qPattern.length > 0) {
      // Bỏ % đầu cuối và unescape T-SQL LIKE ESCAPE '\'
      const inner = qPattern
        .replace(/^%/, '')
        .replace(/%$/, '')
        .replace(/\\([%_\\[])/g, '$1')
        .toLowerCase();
      let hoten = '';
      let socmnd = '';
      try {
        const parsed = JSON.parse(cert.fields_json) as Record<string, string>;
        hoten = (parsed.HOTEN ?? '').toLowerCase();
        socmnd = (parsed.SOCMND_PASSPORT ?? '').toLowerCase();
      } catch {
        // ignore
      }
      if (
        !cert.so.toLowerCase().includes(inner) &&
        !hoten.includes(inner) &&
        !socmnd.includes(inner)
      ) {
        return false;
      }
    }

    if (checkTabAndStatus) {
      const tab = (params.tab as string | undefined) ?? 'all';
      if (tab === 'unsent' && cert.status !== 'ready') return false;
      if (tab === 'accepted' && cert.status !== 'accepted') return false;
      if (
        tab === 'attention' &&
        cert.status !== 'invalid' &&
        cert.status !== 'rejected' &&
        cert.status !== 'error'
      ) {
        return false;
      }
      const statusFilter = params.statusFilter as string | null | undefined;
      if (
        statusFilter !== null &&
        statusFilter !== undefined &&
        cert.status !== statusFilter
      ) {
        return false;
      }
    }

    return true;
  }

  function joinBatchFilename(
    cert: MssqlEmulatorState['certificates'][number],
  ) {
    const batch = state.batches.find((b) => b.id === cert.batch_id);
    return {
      ...cert,
      batch_filename: batch ? batch.filename : null,
    };
  }

  const pool = {
    request() {
      const params: Record<string, unknown> = {};
      const reqObj = {
        input(name: string, _type: unknown, value: unknown) {
          params[name] = value;
          return reqObj;
        },
        async query(sqlText: string) {
          state.sqlCallLog.push({ sqlText: sqlText.trim(), params: { ...params } });

          // 1. Migration 001_init.sql
          if (sqlText.includes('CREATE TABLE dbo.gksk_schema_migrations')) {
            for (const tbl of GKSK_TABLE_NAMES) {
              state.tablesCreated.add(tbl);
            }
            state.indexesCreated.add('ix_gksk_cert_status');
            state.indexesCreated.add('ix_gksk_cert_batch');
            state.indexesCreated.add('ix_gksk_sub_cert');
            return { recordset: [], rowsAffected: [0] };
          }

          // 2. Ghi nhận phiên bản vào gksk_schema_migrations
          if (sqlText.includes('INSERT INTO dbo.gksk_schema_migrations')) {
            const version = String(params.version ?? '');
            if (!state.migrations.some((m) => m.version === version)) {
              state.migrations.push({ version, applied_at: new Date() });
            }
            return { recordset: [], rowsAffected: [1] };
          }

          // 3. gksk_import_batches
          if (sqlText.includes('INSERT INTO dbo.gksk_import_batches')) {
            const row = {
              id: nextBatchId++,
              filename: String(params.filename ?? ''),
              row_count: Number(params.rowCount ?? 0),
              created_at:
                params.createdAt instanceof Date ? params.createdAt : new Date(),
            };
            state.batches.push(row);
            return { recordset: [row], rowsAffected: [1] };
          }

          if (
            sqlText.includes('FROM dbo.gksk_import_batches') &&
            sqlText.includes('WHERE id = @id')
          ) {
            const found = state.batches.find((b) => b.id === Number(params.id));
            return {
              recordset: found ? [found] : [],
              rowsAffected: [found ? 1 : 0],
            };
          }

          if (
            sqlText.includes('FROM dbo.gksk_import_batches') &&
            sqlText.includes('ORDER BY id DESC')
          ) {
            const sorted = [...state.batches].sort((a, b) => b.id - a.id);
            return { recordset: sorted, rowsAffected: [sorted.length] };
          }

          // 4. gksk_certificates
          if (sqlText.includes('INSERT INTO dbo.gksk_certificates')) {
            const row = {
              id: nextCertId++,
              so: String(params.so ?? ''),
              fields_json: String(params.fieldsJson ?? '{}'),
              data_sha256: String(params.dataSha256 ?? ''),
              status: String(params.status ?? 'ready') as CertificateStatus,
              batch_id:
                params.batchId !== null && params.batchId !== undefined
                  ? Number(params.batchId)
                  : null,
              excel_row_number:
                params.excelRowNumber !== null &&
                params.excelRowNumber !== undefined
                  ? Number(params.excelRowNumber)
                  : null,
              server_certificate_id:
                params.serverCertificateId !== null &&
                params.serverCertificateId !== undefined
                  ? String(params.serverCertificateId)
                  : null,
              created_at:
                params.createdAt instanceof Date ? params.createdAt : new Date(),
              updated_at:
                params.updatedAt instanceof Date ? params.updatedAt : new Date(),
            };
            state.certificates.push(row);
            return { recordset: [{ id: row.id }], rowsAffected: [1] };
          }

          if (
            sqlText.includes('UPDATE dbo.gksk_certificates') &&
            sqlText.includes('SET fields_json = @fieldsJson')
          ) {
            const target = state.certificates.find(
              (c) => c.id === Number(params.id),
            );
            if (target) {
              target.fields_json = String(params.fieldsJson ?? target.fields_json);
              target.data_sha256 = String(params.dataSha256 ?? target.data_sha256);
              target.status = String(
                params.status ?? target.status,
              ) as CertificateStatus;
              target.batch_id =
                params.batchId !== null && params.batchId !== undefined
                  ? Number(params.batchId)
                  : null;
              target.excel_row_number =
                params.excelRowNumber !== null &&
                params.excelRowNumber !== undefined
                  ? Number(params.excelRowNumber)
                  : null;
              target.server_certificate_id =
                params.serverCertificateId !== null &&
                params.serverCertificateId !== undefined
                  ? String(params.serverCertificateId)
                  : null;
              target.updated_at =
                params.updatedAt instanceof Date ? params.updatedAt : new Date();
            }
            return { recordset: [], rowsAffected: [target ? 1 : 0] };
          }

          if (
            sqlText.includes('UPDATE dbo.gksk_certificates') &&
            sqlText.includes('WHERE status = @fromStatus')
          ) {
            const fromStatus = String(params.fromStatus ?? 'sending');
            const toStatus = String(params.toStatus ?? 'error') as CertificateStatus;
            let count = 0;
            for (const c of state.certificates) {
              if (c.status === fromStatus) {
                c.status = toStatus;
                c.updated_at =
                  params.updatedAt instanceof Date ? params.updatedAt : new Date();
                count += 1;
              }
            }
            return { recordset: [], rowsAffected: [count] };
          }

          if (
            sqlText.includes('UPDATE dbo.gksk_certificates') &&
            sqlText.includes('SET status = @status')
          ) {
            const target = state.certificates.find(
              (c) => c.id === Number(params.id),
            );
            if (target) {
              target.status = String(params.status) as CertificateStatus;
              target.server_certificate_id =
                params.serverCertificateId !== null &&
                params.serverCertificateId !== undefined
                  ? String(params.serverCertificateId)
                  : null;
              target.updated_at =
                params.updatedAt instanceof Date ? params.updatedAt : new Date();
            }
            return { recordset: [], rowsAffected: [target ? 1 : 0] };
          }

          if (sqlText.includes('DELETE FROM dbo.gksk_certificates')) {
            const id = Number(params.id);
            const idx = state.certificates.findIndex((c) => c.id === id);
            if (idx === -1) {
              return { recordset: [], rowsAffected: [0] };
            }
            state.certificates.splice(idx, 1);
            // ON DELETE CASCADE
            for (let i = state.submissions.length - 1; i >= 0; i -= 1) {
              if (state.submissions[i]?.certificate_id === id) {
                state.submissions.splice(i, 1);
              }
            }
            return { recordset: [], rowsAffected: [1] };
          }

          if (
            sqlText.includes('FROM dbo.gksk_certificates c') &&
            sqlText.includes('WHERE c.id = @id')
          ) {
            const found = state.certificates.find(
              (c) => c.id === Number(params.id),
            );
            return {
              recordset: found ? [joinBatchFilename(found)] : [],
              rowsAffected: [found ? 1 : 0],
            };
          }

          if (
            sqlText.includes('FROM dbo.gksk_certificates c') &&
            sqlText.includes('WHERE c.so = @so')
          ) {
            const found = state.certificates.find(
              (c) => c.so === String(params.so ?? ''),
            );
            return {
              recordset: found ? [joinBatchFilename(found)] : [],
              rowsAffected: [found ? 1 : 0],
            };
          }

          if (
            sqlText.includes('FROM dbo.gksk_certificates c') &&
            sqlText.includes('OPENJSON(@idsJson)')
          ) {
            const ids = JSON.parse(String(params.idsJson ?? '[]')) as number[];
            const idSet = new Set(ids.map(Number));
            const rows = state.certificates
              .filter((c) => idSet.has(c.id))
              .sort((a, b) => a.id - b.id)
              .map(joinBatchFilename);
            return { recordset: rows, rowsAffected: [rows.length] };
          }

          if (
            sqlText.includes('FROM dbo.gksk_certificates c') &&
            sqlText.includes('OPENJSON(@soListJson)')
          ) {
            const sos = JSON.parse(String(params.soListJson ?? '[]')) as string[];
            const soSet = new Set(sos);
            const rows = state.certificates
              .filter((c) => soSet.has(c.so))
              .sort((a, b) => a.id - b.id)
              .map(joinBatchFilename);
            return { recordset: rows, rowsAffected: [rows.length] };
          }

          if (sqlText.includes('GROUP BY c.status')) {
            const grouped = new Map<string, number>();
            for (const c of state.certificates) {
              if (!matchCertWhere(c, params, false)) continue;
              grouped.set(c.status, (grouped.get(c.status) ?? 0) + 1);
            }
            const recordset = Array.from(grouped.entries()).map(
              ([status, cnt]) => ({ status, cnt }),
            );
            return { recordset, rowsAffected: [recordset.length] };
          }

          if (sqlText.includes('SELECT COUNT(1) AS total')) {
            const matched = state.certificates.filter((c) =>
              matchCertWhere(c, params, true),
            );
            return {
              recordset: [{ total: matched.length }],
              rowsAffected: [1],
            };
          }

          if (sqlText.includes('OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY')) {
            const offset = Number(params.offset ?? 0);
            const pageSize = Number(params.pageSize ?? 50);
            const matched = state.certificates
              .filter((c) => matchCertWhere(c, params, true))
              .sort((a, b) => b.id - a.id)
              .slice(offset, offset + pageSize)
              .map(joinBatchFilename);
            return { recordset: matched, rowsAffected: [matched.length] };
          }

          // 5. gksk_submissions
          if (sqlText.includes('INSERT INTO dbo.gksk_submissions')) {
            const row = {
              id: nextSubId++,
              certificate_id: Number(params.certificateId),
              msg_id: String(params.msgId ?? ''),
              send_datetime: Number(params.sendDatetime ?? 0),
              data_sha256: String(params.dataSha256 ?? ''),
              attempts: Number(params.attempts ?? 0),
              http_status:
                params.httpStatus !== null && params.httpStatus !== undefined
                  ? Number(params.httpStatus)
                  : null,
              res_code:
                params.resCode !== null && params.resCode !== undefined
                  ? String(params.resCode)
                  : null,
              result_status:
                params.resultStatus !== null && params.resultStatus !== undefined
                  ? String(params.resultStatus)
                  : null,
              server_submission_id:
                params.serverSubmissionId !== null &&
                params.serverSubmissionId !== undefined
                  ? String(params.serverSubmissionId)
                  : null,
              errors_json:
                params.errorsJson !== null && params.errorsJson !== undefined
                  ? String(params.errorsJson)
                  : null,
              warnings_json:
                params.warningsJson !== null && params.warningsJson !== undefined
                  ? String(params.warningsJson)
                  : null,
              last_error:
                params.lastError !== null && params.lastError !== undefined
                  ? String(params.lastError)
                  : null,
              created_at:
                params.createdAt instanceof Date ? params.createdAt : new Date(),
              finished_at:
                params.finishedAt instanceof Date ? params.finishedAt : null,
            };
            state.submissions.push(row);
            return { recordset: [row], rowsAffected: [1] };
          }

          if (sqlText.includes('UPDATE dbo.gksk_submissions')) {
            const target = state.submissions.find(
              (s) => s.id === Number(params.id),
            );
            if (!target) {
              return { recordset: [], rowsAffected: [0] };
            }
            target.msg_id = String(params.msgId ?? target.msg_id);
            target.send_datetime = Number(
              params.sendDatetime ?? target.send_datetime,
            );
            target.attempts = Number(params.attempts ?? target.attempts);
            target.http_status =
              params.httpStatus !== null && params.httpStatus !== undefined
                ? Number(params.httpStatus)
                : null;
            target.res_code =
              params.resCode !== null && params.resCode !== undefined
                ? String(params.resCode)
                : null;
            target.result_status =
              params.resultStatus !== null && params.resultStatus !== undefined
                ? String(params.resultStatus)
                : null;
            target.server_submission_id =
              params.serverSubmissionId !== null &&
              params.serverSubmissionId !== undefined
                ? String(params.serverSubmissionId)
                : null;
            target.errors_json =
              params.errorsJson !== null && params.errorsJson !== undefined
                ? String(params.errorsJson)
                : null;
            target.warnings_json =
              params.warningsJson !== null && params.warningsJson !== undefined
                ? String(params.warningsJson)
                : null;
            target.last_error =
              params.lastError !== null && params.lastError !== undefined
                ? String(params.lastError)
                : null;
            target.finished_at =
              params.finishedAt instanceof Date ? params.finishedAt : null;

            return { recordset: [target], rowsAffected: [1] };
          }

          if (
            sqlText.includes('FROM dbo.gksk_submissions') &&
            sqlText.includes('WHERE id = @id')
          ) {
            const found = state.submissions.find(
              (s) => s.id === Number(params.id),
            );
            return {
              recordset: found ? [found] : [],
              rowsAffected: [found ? 1 : 0],
            };
          }

          if (
            sqlText.includes('FROM dbo.gksk_submissions') &&
            sqlText.includes('WHERE msg_id = @msgId')
          ) {
            const found = state.submissions.find(
              (s) => s.msg_id === String(params.msgId ?? ''),
            );
            return {
              recordset: found ? [found] : [],
              rowsAffected: [found ? 1 : 0],
            };
          }

          if (
            sqlText.includes('FROM dbo.gksk_submissions') &&
            sqlText.includes('AND result_status IS NULL')
          ) {
            const certId = Number(params.certificateId);
            const dataSha = String(params.dataSha256 ?? '');
            const pending = [...state.submissions]
              .filter(
                (s) =>
                  s.certificate_id === certId &&
                  s.data_sha256 === dataSha &&
                  s.result_status === null,
              )
              .sort((a, b) => b.id - a.id)[0];
            return {
              recordset: pending ? [pending] : [],
              rowsAffected: [pending ? 1 : 0],
            };
          }

          if (
            sqlText.includes('SELECT TOP (1) *') &&
            sqlText.includes('FROM dbo.gksk_submissions')
          ) {
            const certId = Number(params.certificateId);
            const latest = [...state.submissions]
              .filter((s) => s.certificate_id === certId)
              .sort((a, b) => b.id - a.id)[0];
            return {
              recordset: latest ? [latest] : [],
              rowsAffected: [latest ? 1 : 0],
            };
          }

          if (
            sqlText.includes('FROM dbo.gksk_submissions s') &&
            sqlText.includes('OPENJSON(@idsJson)')
          ) {
            const ids = JSON.parse(String(params.idsJson ?? '[]')) as number[];
            const idSet = new Set(ids.map(Number));
            const rows = [...state.submissions]
              .filter((s) => idSet.has(s.certificate_id))
              .sort((a, b) => b.id - a.id);
            return { recordset: rows, rowsAffected: [rows.length] };
          }

          if (
            sqlText.includes('FROM dbo.gksk_submissions') &&
            sqlText.includes('WHERE certificate_id = @certificateId')
          ) {
            const certId = Number(params.certificateId);
            const rows = [...state.submissions]
              .filter((s) => s.certificate_id === certId)
              .sort((a, b) => b.id - a.id);
            return { recordset: rows, rowsAffected: [rows.length] };
          }

          return { recordset: [], rowsAffected: [0] };
        },
      };
      return reqObj;
    },
    async close() {
      // no-op
    },
  } as unknown as sql.ConnectionPool;

  return { pool, state };
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`[test:mssql] FAILED: ${msg}`);
  }
}

export async function runMssqlIntegrationSuite(
  pool: sql.ConnectionPool,
  modeLabel: string,
): Promise<{
  mode: string;
  appliedMigrations: string[];
  tablesVerified: readonly string[];
  testsPassed: number;
}> {
  let testsPassed = 0;

  // Test 1: runMigrations tạo 4 bảng gksk_* an toàn
  const applied = await runMigrations(pool);
  assert(
    applied.includes('001_init'),
    'runMigrations phải thực thi 001_init.sql',
  );
  testsPassed += 1;

  const repo = createRepositories(pool);
  assert(
    repo.kind === 'mssql' && repo instanceof MssqlRepositories,
    'createRepositories(pool) phải trả về MssqlRepositories (kind="mssql")',
  );
  testsPassed += 1;

  // Test 2: Tạo đợt import vào gksk_import_batches
  const uniqueSuffix = Date.now().toString().slice(-6);
  const so1 = `TEST.75001.SQL.${uniqueSuffix}.1`;
  const so2 = `TEST.75001.SQL.${uniqueSuffix}.2`;

  const batch = await repo.batches.create({
    filename: `GKSK_test_mssql_${uniqueSuffix}.xlsx`,
    rowCount: 2,
  });
  assert(batch.id >= 1, 'Tạo đợt import thành công');
  const foundBatch = await repo.batches.findById(batch.id);
  assert(
    foundBatch?.filename === batch.filename,
    'findById trên gksk_import_batches khớp dữ liệu',
  );
  testsPassed += 1;

  // Test 3: Upsert giấy hợp lệ (ready) và giấy lỗi (invalid) vào gksk_certificates
  const up1 = await repo.certificates.upsertBySo({
    so: so1,
    fields: makeSampleRecord({ SO: so1, HOTEN: 'TEST NGUYEN VAN SQL 1' }),
    dataSha256: sha('SQL_1'),
    status: 'ready',
    batchId: batch.id,
    excelRowNumber: 2,
  });
  assert(up1.created === true, 'Upsert giấy mới so1 phải có created=true');

  const up2 = await repo.certificates.upsertBySo({
    so: so2,
    fields: makeSampleRecord({
      SO: so2,
      HOTEN: 'TEST TRAN THI SQL 2',
      NGAYSINH: '31/02/1990',
    }),
    dataSha256: sha('SQL_2_BAD'),
    status: 'invalid',
    batchId: batch.id,
    excelRowNumber: 3,
  });
  assert(up2.created === true, 'Upsert giấy lỗi so2 phải có created=true');
  testsPassed += 1;

  // Test 4: Ghi đè thông minh cùng mã SO (giữ nguyên certificate id)
  const up2Fixed = await repo.certificates.upsertBySo({
    so: so2,
    fields: makeSampleRecord({
      SO: so2,
      HOTEN: 'TEST TRAN THI SQL 2 DA SUA',
      NGAYSINH: '28/02/1990',
    }),
    dataSha256: sha('SQL_2_FIXED'),
    status: 'ready',
    batchId: batch.id,
    excelRowNumber: 3,
  });
  assert(
    up2Fixed.created === false && up2Fixed.row.id === up2.row.id,
    'Ghi đè theo mã SO giữ nguyên id trong gksk_certificates',
  );
  testsPassed += 1;

  // Test 5: Tạo và cập nhật lịch sử gửi trong gksk_submissions
  const msgId = `75001261125${uniqueSuffix.padEnd(12, '0')}4000800000000000001`;
  const sub = await repo.submissions.create({
    certificateId: up1.row.id,
    msgId,
    sendDatetime: Date.now(),
    dataSha256: sha('SQL_1'),
    attempts: 1,
  });
  const pending = await repo.submissions.findPendingByCertificateAndSha(
    up1.row.id,
    sha('SQL_1'),
  );
  assert(pending?.msgId === msgId, 'Tìm thấy submission đang chờ cùng data_sha256');

  const updatedSub = await repo.submissions.update(sub.id, {
    attempts: 1,
    httpStatus: 200,
    resCode: 'PS_SYNC_SUCCESS',
    resultStatus: 'accepted',
    serverSubmissionId: `srv-sub-${uniqueSuffix}`,
    warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
    finishedAt: new Date(),
  });
  assert(
    updatedSub?.resultStatus === 'accepted',
    'Cập nhật kết quả submission accepted thành công',
  );
  await repo.certificates.updateStatus(up1.row.id, {
    status: 'accepted',
    serverCertificateId: `srv-cert-${uniqueSuffix}`,
  });
  testsPassed += 1;

  // Test 6: Lọc danh sách và đếm thống kê đối soát theo batchId
  const listRes = await repo.certificates.list({
    batchId: batch.id,
    tab: 'all',
  });
  assert(
    listRes.total === 2 &&
      listRes.counts.accepted === 1 &&
      listRes.counts.unsent === 1,
    'Truy vấn đối soát list() và countByStatus() trên gksk_certificates chính xác',
  );
  testsPassed += 1;

  // Test 7: Dọn sạch 2 giấy kiểm thử vừa tạo (ON DELETE CASCADE xóa luôn submission)
  const del1 = await repo.certificates.deleteById(up1.row.id);
  const del2 = await repo.certificates.deleteById(up2.row.id);
  assert(del1 && del2, 'Xóa dữ liệu kiểm thử tạm thời thành công');
  const subAfterDelete = await repo.submissions.findByMsgId(msgId);
  assert(
    subAfterDelete === null,
    'ON DELETE CASCADE tự động xóa bản ghi gksk_submissions khi xóa giấy',
  );
  testsPassed += 1;

  return {
    mode: modeLabel,
    appliedMigrations: applied,
    tablesVerified: GKSK_TABLE_NAMES,
    testsPassed,
  };
}

function resolveLiveMssqlConfigFromEnv(): AppConfig['db'] | null {
  dotenv.config({ path: path.join(ROOT_DIR, '.env') });

  const host = (process.env.TEST_MSSQL_HOST ?? process.env.DB_HOST ?? '').trim();
  const user = (process.env.TEST_MSSQL_USER ?? process.env.DB_USER ?? '').trim();
  const dbPassword =
    process.env.TEST_MSSQL_PASSWORD ?? process.env.DB_PASSWORD ?? '';
  const name = (process.env.TEST_MSSQL_DATABASE ?? process.env.DB_NAME ?? '').trim();
  const portRaw = (process.env.TEST_MSSQL_PORT ?? process.env.DB_PORT ?? '1433').trim();
  const encryptRaw = (
    process.env.TEST_MSSQL_ENCRYPT ??
    process.env.DB_ENCRYPT ??
    'false'
  )
    .trim()
    .toLowerCase();
  const trustRaw = (
    process.env.TEST_MSSQL_TRUST_SERVER_CERT ??
    process.env.DB_TRUST_SERVER_CERT ??
    'true'
  )
    .trim()
    .toLowerCase();

  if (
    !host ||
    !user ||
    !dbPassword ||
    !name ||
    dbPassword === 'CHANGE_ME_DB_PASSWORD'
  ) {
    return null;
  }

  return {
    host,
    port: Number.parseInt(portRaw, 10) || 1433,
    user,
    dbPassword,
    name,
    encrypt: encryptRaw === 'true' || encryptRaw === '1',
    trustServerCert: trustRaw === 'true' || trustRaw === '1',
  };
}

async function main(): Promise<void> {
  const migrationsDir = resolveDefaultMigrationsDir();
  const initSqlPath = path.join(migrationsDir, '001_init.sql');
  assert(fs.existsSync(initSqlPath), 'Phải tồn tại file 001_init.sql');
  assert(FIELD_ORDER.length === 25, 'Đủ 25 trường chuẩn BHXH');

  const liveDbConfig = resolveLiveMssqlConfigFromEnv();
  if (liveDbConfig) {
    const safePoolCfg = buildMssqlPoolConfig(liveDbConfig);
    process.stdout.write(
      `[test:mssql] Đang kết nối tới MSSQL thật tại ${safePoolCfg.server}:${safePoolCfg.port ?? 1433} (database=${safePoolCfg.database})...\n`,
    );
    const pool = await createMssqlPool(liveDbConfig);
    try {
      const summary = await runMssqlIntegrationSuite(
        pool,
        `LIVE_MSSQL (${safePoolCfg.server}:${safePoolCfg.port ?? 1433}/${safePoolCfg.database})`,
      );
      process.stdout.write(
        `[test:mssql] PASS 100% trên MSSQL thật: ${summary.testsPassed}/7 nhóm kiểm thử, 4 bảng [${summary.tablesVerified.join(', ')}] hoạt động an toàn.\n`,
      );
    } finally {
      await pool.close();
    }
    return;
  }

  process.stdout.write(
    '[test:mssql] Chưa phát hiện biến môi trường TEST_MSSQL_* hoặc file .env kết nối MSSQL thật -> Chạy kiểm chứng toàn trình MssqlRepositories + 001_init.sql trên Stateful T-SQL Pool Emulator...\n',
  );
  const { pool, state } = createStatefulMssqlPoolEmulator();
  const summary = await runMssqlIntegrationSuite(
    pool,
    'STATEFUL_TSQL_POOL_EMULATOR (001_init.sql + MssqlRepositories)',
  );
  assert(
    state.tablesCreated.size === 4,
    'Phải tạo đủ 4 bảng tiền tố gksk_*',
  );
  assert(
    state.indexesCreated.size === 3,
    'Phải tạo đủ 3 chỉ mục tiền tố ix_gksk_*',
  );
  process.stdout.write(
    `[test:mssql] PASS 100%: ${summary.testsPassed}/7 nhóm kiểm thử MssqlRepositories (${state.sqlCallLog.length} câu lệnh T-SQL tham số hóa đã thực thi trên 4 bảng [${summary.tablesVerified.join(', ')}]).\n`,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  main().catch((err) => {
    process.stderr.write(
      `[test:mssql] ERROR: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
