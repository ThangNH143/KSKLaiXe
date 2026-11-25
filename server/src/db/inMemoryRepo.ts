import { createEmptyRecord, FIELD_ORDER, type GkskRecord, type ServerIssue } from '@gksk/shared';
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
  SubmissionRow,
  SubmissionsRepository,
  UpdateCertificateStatusInput,
  UpdateSubmissionInput,
  UpsertCertificateInput,
  UpsertCertificateResult,
} from './types.js';

export function toIsoTimestamp(value?: string | Date | null): string {
  if (!value) {
    return new Date().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

export function parseDateFilterStartIso(fromDate?: string): string | null {
  if (!fromDate || fromDate.trim().length === 0) {
    return null;
  }
  const trimmed = fromDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function parseDateFilterEndIso(toDate?: string): string | null {
  if (!toDate || toDate.trim().length === 0) {
    return null;
  }
  const trimmed = toDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T23:59:59.999Z`;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function cloneGkskRecord(record: GkskRecord): GkskRecord {
  const out = createEmptyRecord();
  for (const tag of FIELD_ORDER) {
    out[tag] = typeof record[tag] === 'string' ? record[tag] : '';
  }
  return out;
}

export function parseFieldsJson(fieldsJson: string): GkskRecord {
  const out = createEmptyRecord();
  try {
    const parsed = JSON.parse(fieldsJson) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      for (const tag of FIELD_ORDER) {
        const val = parsed[tag];
        out[tag] = typeof val === 'string' ? val : '';
      }
    }
  } catch {
    // Giữ bản ghi rỗng nếu JSON hỏng
  }
  return out;
}

export function parseServerIssuesJson(json: string | null): ServerIssue[] {
  if (!json) {
    return [];
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const items: ServerIssue[] = [];
    for (const item of parsed) {
      if (item && typeof item === 'object' && typeof (item as { code?: unknown }).code === 'string') {
        const rawField = (item as { field?: unknown }).field;
        items.push({
          code: (item as { code: string }).code,
          field: typeof rawField === 'string' ? rawField : null,
        });
      }
    }
    return items;
  } catch {
    return [];
  }
}

export function createEmptyReconcileCounts(): ReconcileCounts {
  return {
    all: 0,
    unsent: 0,
    accepted: 0,
    attention: 0,
    ready: 0,
    invalid: 0,
    rejected: 0,
    error: 0,
    sending: 0,
  };
}

function cloneCertificateRow(row: CertificateRow): CertificateRow {
  return {
    ...row,
    fields: cloneGkskRecord(row.fields),
  };
}

function cloneSubmissionRow(row: SubmissionRow): SubmissionRow {
  return {
    ...row,
    errors: row.errors.map((e) => ({ ...e })),
    warnings: row.warnings.map((w) => ({ ...w })),
  };
}

function matchesBaseCertificateFilter(
  row: CertificateRow,
  filter?: CertificateCountFilter,
): boolean {
  if (!filter) {
    return true;
  }

  if (filter.batchId !== undefined && row.batchId !== filter.batchId) {
    return false;
  }

  const fromIso = parseDateFilterStartIso(filter.fromDate);
  if (fromIso && Date.parse(row.createdAt) < Date.parse(fromIso)) {
    return false;
  }

  const toIso = parseDateFilterEndIso(filter.toDate);
  if (toIso && Date.parse(row.createdAt) > Date.parse(toIso)) {
    return false;
  }

  if (filter.q && filter.q.trim().length > 0) {
    const qLower = filter.q.trim().toLowerCase();
    const soMatch = row.so.toLowerCase().includes(qLower);
    const hotenMatch = row.fields.HOTEN.toLowerCase().includes(qLower);
    const idMatch = row.fields.SOCMND_PASSPORT.toLowerCase().includes(qLower);
    if (!soMatch && !hotenMatch && !idMatch) {
      return false;
    }
  }

  return true;
}

function matchesTabAndStatus(
  row: CertificateRow,
  query?: CertificateListQuery,
): boolean {
  const tab = query?.tab ?? 'all';
  if (tab === 'unsent' && row.status !== 'ready') {
    return false;
  }
  if (tab === 'accepted' && row.status !== 'accepted') {
    return false;
  }
  if (
    tab === 'attention' &&
    row.status !== 'invalid' &&
    row.status !== 'rejected' &&
    row.status !== 'error'
  ) {
    return false;
  }

  if (query?.status !== undefined && row.status !== query.status) {
    return false;
  }

  return true;
}

/**
 * Cài đặt `DbRepositories` lưu trữ hoàn toàn trong bộ nhớ RAM (`InMemoryRepositories`).
 * Dùng mặc định cho toàn bộ `npm test` để chạy nhanh và tuyệt đối không chạm vào MSSQL đang vận hành.
 */
export class InMemoryRepositories implements DbRepositories {
  public readonly kind = 'in-memory' as const;
  public readonly batches: BatchesRepository;
  public readonly certificates: CertificatesRepository;
  public readonly submissions: SubmissionsRepository;

  private nextBatchId = 1;
  private nextCertificateId = 1;
  private nextSubmissionId = 1;

  private readonly batchStore = new Map<number, ImportBatchRow>();
  private readonly certificateStore = new Map<number, CertificateRow>();
  private readonly certificateIdBySo = new Map<string, number>();
  private readonly submissionStore = new Map<number, SubmissionRow>();
  private readonly submissionIdByMsgId = new Map<string, number>();

  constructor() {
    this.batches = {
      create: async (input: CreateImportBatchInput): Promise<ImportBatchRow> => {
        const id = this.nextBatchId++;
        const row: ImportBatchRow = {
          id,
          filename: input.filename.trim(),
          rowCount: input.rowCount,
          createdAt: toIsoTimestamp(input.createdAt),
        };
        this.batchStore.set(id, row);
        return { ...row };
      },

      findById: async (id: number): Promise<ImportBatchRow | null> => {
        const found = this.batchStore.get(id);
        return found ? { ...found } : null;
      },

      list: async (): Promise<ImportBatchRow[]> => {
        return Array.from(this.batchStore.values())
          .sort((a, b) => b.id - a.id)
          .map((row) => ({ ...row }));
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

        const nowIso = toIsoTimestamp(input.now);
        const cleanFields = cloneGkskRecord(input.fields);
        const fieldsJson = JSON.stringify(cleanFields);
        const existingId = this.certificateIdBySo.get(cleanSo);

        if (existingId !== undefined) {
          const existing = this.certificateStore.get(existingId);
          if (existing) {
            const nextBatchId =
              input.batchId !== undefined ? input.batchId : existing.batchId;
            const nextBatchFilename =
              nextBatchId !== null
                ? (this.batchStore.get(nextBatchId)?.filename ?? null)
                : null;

            const updatedRow: CertificateRow = {
              ...existing,
              so: cleanSo,
              fields: cleanFields,
              fieldsJson,
              dataSha256: input.dataSha256,
              status: input.status,
              batchId: nextBatchId,
              batchFilename: nextBatchFilename,
              excelRowNumber:
                input.excelRowNumber !== undefined
                  ? input.excelRowNumber
                  : existing.excelRowNumber,
              serverCertificateId:
                input.serverCertificateId !== undefined
                  ? input.serverCertificateId
                  : existing.serverCertificateId,
              updatedAt: nowIso,
            };
            this.certificateStore.set(existingId, updatedRow);
            return {
              row: cloneCertificateRow(updatedRow),
              created: false,
            };
          }
        }

        const id = this.nextCertificateId++;
        const batchId = input.batchId ?? null;
        const batchFilename =
          batchId !== null ? (this.batchStore.get(batchId)?.filename ?? null) : null;

        const newRow: CertificateRow = {
          id,
          so: cleanSo,
          fields: cleanFields,
          fieldsJson,
          dataSha256: input.dataSha256,
          status: input.status,
          batchId,
          batchFilename,
          excelRowNumber: input.excelRowNumber ?? null,
          serverCertificateId: input.serverCertificateId ?? null,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        this.certificateStore.set(id, newRow);
        this.certificateIdBySo.set(cleanSo, id);

        return {
          row: cloneCertificateRow(newRow),
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
        const row = this.certificateStore.get(id);
        return row ? this.withBatchFilename(row) : null;
      },

      findByIds: async (ids: readonly number[]): Promise<CertificateRow[]> => {
        const rows: CertificateRow[] = [];
        for (const id of ids) {
          const row = this.certificateStore.get(id);
          if (row) {
            rows.push(this.withBatchFilename(row));
          }
        }
        return rows;
      },

      findBySo: async (so: string): Promise<CertificateRow | null> => {
        const id = this.certificateIdBySo.get(so.trim());
        if (id === undefined) {
          return null;
        }
        const row = this.certificateStore.get(id);
        return row ? this.withBatchFilename(row) : null;
      },

      findBySoList: async (soList: readonly string[]): Promise<CertificateRow[]> => {
        const uniqueSos = new Set(
          soList.map((s) => s.trim()).filter((s) => s.length > 0),
        );
        const result: CertificateRow[] = [];
        for (const so of uniqueSos) {
          const id = this.certificateIdBySo.get(so);
          if (id !== undefined) {
            const row = this.certificateStore.get(id);
            if (row) {
              result.push(this.withBatchFilename(row));
            }
          }
        }
        return result.sort((a, b) => a.id - b.id);
      },

      countByStatus: async (
        filter?: CertificateCountFilter,
      ): Promise<ReconcileCounts> => {
        const counts = createEmptyReconcileCounts();
        for (const row of this.certificateStore.values()) {
          if (!matchesBaseCertificateFilter(row, filter)) {
            continue;
          }
          counts.all += 1;
          counts[row.status] += 1;
        }
        counts.unsent = counts.ready;
        counts.attention = counts.invalid + counts.rejected + counts.error;
        return counts;
      },

      list: async (query?: CertificateListQuery): Promise<CertificateListResult> => {
        const page = Math.max(1, Math.floor(query?.page ?? 1));
        const pageSize = Math.min(1000, Math.max(1, Math.floor(query?.pageSize ?? 50)));

        const counts = await this.certificates.countByStatus(query);
        const matched: CertificateRow[] = [];

        for (const row of this.certificateStore.values()) {
          if (!matchesBaseCertificateFilter(row, query)) {
            continue;
          }
          if (!matchesTabAndStatus(row, query)) {
            continue;
          }
          matched.push(this.withBatchFilename(row));
        }

        matched.sort((a, b) => b.id - a.id);

        const total = matched.length;
        const offset = (page - 1) * pageSize;
        const items = matched.slice(offset, offset + pageSize);

        return {
          items,
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
        const existing = this.certificateStore.get(id);
        if (!existing) {
          return null;
        }

        const updated: CertificateRow = {
          ...existing,
          status: input.status,
          serverCertificateId:
            input.serverCertificateId !== undefined
              ? input.serverCertificateId
              : existing.serverCertificateId,
          updatedAt: toIsoTimestamp(input.now),
        };
        this.certificateStore.set(id, updated);
        return this.withBatchFilename(updated);
      },

      deleteById: async (id: number): Promise<boolean> => {
        const existing = this.certificateStore.get(id);
        if (!existing) {
          return false;
        }

        this.certificateStore.delete(id);
        this.certificateIdBySo.delete(existing.so);

        // ON DELETE CASCADE cho gksk_submissions
        for (const [subId, subRow] of this.submissionStore.entries()) {
          if (subRow.certificateId === id) {
            this.submissionStore.delete(subId);
            this.submissionIdByMsgId.delete(subRow.msgId);
          }
        }

        return true;
      },

      recoverOnStartup: async (now?: string | Date): Promise<number> => {
        const nowIso = toIsoTimestamp(now);
        let recovered = 0;
        for (const [id, row] of this.certificateStore.entries()) {
          if (row.status === 'sending') {
            this.certificateStore.set(id, {
              ...row,
              status: 'error',
              updatedAt: nowIso,
            });
            recovered += 1;
          }
        }
        return recovered;
      },
    };

    this.submissions = {
      create: async (input: CreateSubmissionInput): Promise<SubmissionRow> => {
        if (!this.certificateStore.has(input.certificateId)) {
          throw new Error(
            `Không tìm thấy certificate_id=${input.certificateId} khi tạo submission.`,
          );
        }
        const cleanMsgId = input.msgId.trim();
        if (this.submissionIdByMsgId.has(cleanMsgId)) {
          throw new Error(`Vi phạm ràng buộc ux_gksk_sub_msg_id: trùng msg_id=${cleanMsgId}`);
        }

        const id = this.nextSubmissionId++;
        const errors = input.errors ? input.errors.map((e) => ({ ...e })) : [];
        const warnings = input.warnings ? input.warnings.map((w) => ({ ...w })) : [];

        const row: SubmissionRow = {
          id,
          certificateId: input.certificateId,
          msgId: cleanMsgId,
          sendDatetime: input.sendDatetime,
          dataSha256: input.dataSha256,
          attempts: input.attempts ?? 0,
          httpStatus: input.httpStatus ?? null,
          resCode: input.resCode ?? null,
          resultStatus: input.resultStatus ?? null,
          serverSubmissionId: input.serverSubmissionId ?? null,
          errors,
          errorsJson: input.errors !== undefined && input.errors !== null ? JSON.stringify(errors) : null,
          warnings,
          warningsJson:
            input.warnings !== undefined && input.warnings !== null
              ? JSON.stringify(warnings)
              : null,
          lastError: input.lastError ?? null,
          createdAt: toIsoTimestamp(input.createdAt),
          finishedAt: input.finishedAt ? toIsoTimestamp(input.finishedAt) : null,
        };

        this.submissionStore.set(id, row);
        this.submissionIdByMsgId.set(cleanMsgId, id);
        return cloneSubmissionRow(row);
      },

      update: async (
        id: number,
        input: UpdateSubmissionInput,
      ): Promise<SubmissionRow | null> => {
        const existing = this.submissionStore.get(id);
        if (!existing) {
          return null;
        }

        let nextMsgId = existing.msgId;
        if (input.msgId !== undefined) {
          const cleanNextMsgId = input.msgId.trim();
          const conflictId = this.submissionIdByMsgId.get(cleanNextMsgId);
          if (conflictId !== undefined && conflictId !== id) {
            throw new Error(
              `Vi phạm ràng buộc ux_gksk_sub_msg_id: trùng msg_id=${cleanNextMsgId}`,
            );
          }
          this.submissionIdByMsgId.delete(existing.msgId);
          this.submissionIdByMsgId.set(cleanNextMsgId, id);
          nextMsgId = cleanNextMsgId;
        }

        const nextErrors =
          input.errors !== undefined
            ? input.errors
              ? input.errors.map((e) => ({ ...e }))
              : []
            : existing.errors;
        const nextErrorsJson =
          input.errors !== undefined
            ? input.errors !== null
              ? JSON.stringify(nextErrors)
              : null
            : existing.errorsJson;

        const nextWarnings =
          input.warnings !== undefined
            ? input.warnings
              ? input.warnings.map((w) => ({ ...w }))
              : []
            : existing.warnings;
        const nextWarningsJson =
          input.warnings !== undefined
            ? input.warnings !== null
              ? JSON.stringify(nextWarnings)
              : null
            : existing.warningsJson;

        const updated: SubmissionRow = {
          ...existing,
          msgId: nextMsgId,
          sendDatetime: input.sendDatetime ?? existing.sendDatetime,
          attempts: input.attempts ?? existing.attempts,
          httpStatus:
            input.httpStatus !== undefined ? input.httpStatus : existing.httpStatus,
          resCode: input.resCode !== undefined ? input.resCode : existing.resCode,
          resultStatus:
            input.resultStatus !== undefined ? input.resultStatus : existing.resultStatus,
          serverSubmissionId:
            input.serverSubmissionId !== undefined
              ? input.serverSubmissionId
              : existing.serverSubmissionId,
          errors: nextErrors,
          errorsJson: nextErrorsJson,
          warnings: nextWarnings,
          warningsJson: nextWarningsJson,
          lastError:
            input.lastError !== undefined ? input.lastError : existing.lastError,
          finishedAt:
            input.finishedAt !== undefined
              ? input.finishedAt
                ? toIsoTimestamp(input.finishedAt)
                : null
              : existing.finishedAt,
        };

        this.submissionStore.set(id, updated);
        return cloneSubmissionRow(updated);
      },

      findById: async (id: number): Promise<SubmissionRow | null> => {
        const row = this.submissionStore.get(id);
        return row ? cloneSubmissionRow(row) : null;
      },

      findByMsgId: async (msgId: string): Promise<SubmissionRow | null> => {
        const id = this.submissionIdByMsgId.get(msgId.trim());
        if (id === undefined) {
          return null;
        }
        const row = this.submissionStore.get(id);
        return row ? cloneSubmissionRow(row) : null;
      },

      listByCertificateId: async (certificateId: number): Promise<SubmissionRow[]> => {
        const rows: SubmissionRow[] = [];
        for (const row of this.submissionStore.values()) {
          if (row.certificateId === certificateId) {
            rows.push(cloneSubmissionRow(row));
          }
        }
        return rows.sort((a, b) => b.id - a.id);
      },

      findLatestByCertificateId: async (
        certificateId: number,
      ): Promise<SubmissionRow | null> => {
        const list = await this.submissions.listByCertificateId(certificateId);
        return list[0] ?? null;
      },

      findLatestByCertificateIds: async (
        certificateIds: readonly number[],
      ): Promise<Map<number, SubmissionRow>> => {
        const idSet = new Set(certificateIds);
        const latestMap = new Map<number, SubmissionRow>();
        const allSorted = Array.from(this.submissionStore.values()).sort(
          (a, b) => b.id - a.id,
        );
        for (const sub of allSorted) {
          if (idSet.has(sub.certificateId) && !latestMap.has(sub.certificateId)) {
            latestMap.set(sub.certificateId, cloneSubmissionRow(sub));
          }
        }
        return latestMap;
      },

      findPendingByCertificateAndSha: async (
        certificateId: number,
        dataSha256: string,
      ): Promise<SubmissionRow | null> => {
        const list = await this.submissions.listByCertificateId(certificateId);
        const pending = list.find(
          (sub) => sub.resultStatus === null && sub.dataSha256 === dataSha256,
        );
        return pending ?? null;
      },
    };
  }

  private withBatchFilename(row: CertificateRow): CertificateRow {
    const batchFilename =
      row.batchId !== null
        ? (this.batchStore.get(row.batchId)?.filename ?? row.batchFilename)
        : null;
    return {
      ...cloneCertificateRow(row),
      batchFilename,
    };
  }

  /**
   * Làm sạch toàn bộ dữ liệu trong bộ nhớ RAM (dùng cho E2E / test cô lập giữa các lượt chạy).
   */
  public resetAll(): void {
    this.batchStore.clear();
    this.certificateStore.clear();
    this.certificateIdBySo.clear();
    this.submissionStore.clear();
    this.submissionIdByMsgId.clear();
    this.nextBatchId = 1;
    this.nextCertificateId = 1;
    this.nextSubmissionId = 1;
  }
}

export function createInMemoryRepositories(): InMemoryRepositories {
  return new InMemoryRepositories();
}
