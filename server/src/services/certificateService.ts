import {
  FIELD_ORDER,
  hasBlockingErrors,
  SENSITIVE_TAGS,
  validateRecord,
  type CertificateStatus,
  type GkskListFields,
  type GkskRecord,
  type Issue,
  type ReconcileTab,
  type ServerIssue,
} from '@gksk/shared';
import type {
  CertificateListQuery,
  CertificateRow,
  DbRepositories,
  ImportBatchRow,
  ReconcileCounts,
  SubmissionRow,
} from '../db/types.js';
import { buildGkskXml } from '../gksk/xml.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  buildReconcileExcel,
  buildXmlZip,
  formatVnFileTimestamp,
  sanitizeXmlFileName,
  type ReconcileExcelItem,
  type XmlZipInputItem,
} from './exportService.js';
import { formatVnTodayIso } from './sendService.js';

const SENSITIVE_TAG_SET = new Set<string>(SENSITIVE_TAGS);

/**
 * Loại bỏ 4 trường nhạy cảm (`NONGDOCON`, `MATUY`, `LYDO`, `TINHTRANGBENH`)
 * khỏi bản ghi 25 trường trước khi trả về ở danh sách đối soát (ARCHITECTURE.md §4 & §7).
 */
export function stripSensitiveFields(record: GkskRecord): GkskListFields {
  const safeFields = {} as Record<string, string>;
  for (const tag of FIELD_ORDER) {
    if (!SENSITIVE_TAG_SET.has(tag)) {
      safeFields[tag] = record[tag] ?? '';
    }
  }
  return safeFields as GkskListFields;
}

/** Thông tin tóm tắt lần gửi gần nhất đính kèm vào từng dòng trên bảng danh sách đối soát. */
export interface LatestSubmissionSummary {
  id: number;
  msgId: string;
  sendDatetime: number;
  attempts: number;
  httpStatus: number | null;
  resCode: string | null;
  resultStatus: 'accepted' | 'rejected' | null;
  serverSubmissionId: string | null;
  errors: ServerIssue[];
  warnings: ServerIssue[];
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Một dòng trong kết quả `GET /api/certificates` (tuyệt đối không có 4 trường nhạy cảm). */
export interface CertificateListItem {
  id: number;
  so: string;
  fields: GkskListFields;
  dataSha256: string;
  status: CertificateStatus;
  batchId: number | null;
  batchFilename: string | null;
  excelRowNumber: number | null;
  serverCertificateId: string | null;
  createdAt: string;
  updatedAt: string;
  issues: Issue[];
  latestSubmission: LatestSubmissionSummary | null;
}

export interface CertificateListResponse {
  items: CertificateListItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: ReconcileCounts;
}

/** Kết quả chi tiết chỉ đọc của 1 giấy (`GET /api/certificates/:id`). */
export interface CertificateDetailResponse {
  id: number;
  so: string;
  /** Đủ 25 trường đã chuẩn hóa (bao gồm cả 4 trường nhạy cảm để hiển thị trong Drawer chi tiết 1 giấy). */
  fields: GkskRecord;
  dataSha256: string;
  status: CertificateStatus;
  batchId: number | null;
  batchFilename: string | null;
  excelRowNumber: number | null;
  batch: ImportBatchRow | null;
  serverCertificateId: string | null;
  createdAt: string;
  updatedAt: string;
  issues: Issue[];
  /** Mã nguồn XML chuẩn nếu giấy không có lỗi dữ liệu chặn; `null` nếu giấy đang `invalid`. */
  xml: string | null;
  latestSubmission: LatestSubmissionSummary | null;
}

export interface CertificateXmlDownload {
  fileName: string;
  xml: string;
}

export interface CertificateZipDownload {
  fileName: string;
  buffer: Buffer;
  includedCount: number;
}

export interface ReconcileExcelDownload {
  fileName: string;
  buffer: Buffer;
  rowCount: number;
}

export interface CertificateServiceOptions {
  repos: DbRepositories;
  facilityId: string;
  facilityName?: string;
  today?: string | Date;
  now?: () => number;
}

function toLatestSubmissionSummary(sub: SubmissionRow): LatestSubmissionSummary {
  return {
    id: sub.id,
    msgId: sub.msgId,
    sendDatetime: sub.sendDatetime,
    attempts: sub.attempts,
    httpStatus: sub.httpStatus,
    resCode: sub.resCode,
    resultStatus: sub.resultStatus,
    serverSubmissionId: sub.serverSubmissionId,
    errors: sub.errors.map((e) => ({ ...e })),
    warnings: sub.warnings.map((w) => ({ ...w })),
    lastError: sub.lastError,
    createdAt: sub.createdAt,
    finishedAt: sub.finishedAt,
  };
}

/**
 * Dịch vụ quản lý truy vấn Danh sách đối soát, Chi tiết chỉ đọc, Xuất XML (`.xml` & `.zip`)
 * và Xuất Excel đối soát (ARCHITECTURE.md §3, §4 & IMPLEMENTATION-PLAN.md S10).
 *
 * Lưu ý kiến trúc v1.1: Không có phương thức tạo tay hay sửa tay giấy trên web.
 */
export class CertificateService {
  private readonly repos: DbRepositories;
  private readonly facilityId: string;
  private readonly todayOverride: string | Date | undefined;
  private readonly nowFn: () => number;

  constructor(options: CertificateServiceOptions) {
    this.repos = options.repos;
    this.facilityId = options.facilityId.trim();
    this.todayOverride = options.today;
    this.nowFn = options.now ?? (() => Date.now());
  }

  private getToday(): string | Date {
    return this.todayOverride ?? formatVnTodayIso(this.nowFn());
  }

  private computeIssues(row: CertificateRow): Issue[] {
    return validateRecord(row.fields, {
      facilityId: this.facilityId,
      today: this.getToday(),
    });
  }

  /**
   * `GET /api/batches` — Danh sách các đợt import Excel (`id`, `filename`, `rowCount`, `createdAt`).
   */
  public async listBatches(): Promise<ImportBatchRow[]> {
    return this.repos.batches.list();
  }

  /**
   * `GET /api/certificates` — Truy vấn danh sách giấy đối soát có phân trang, kèm `counts`
   * và thông tin lần gửi gần nhất. Tuyệt đối không trả 4 trường nhạy cảm (`NONGDOCON`, `MATUY`, `LYDO`, `TINHTRANGBENH`).
   */
  public async listCertificates(
    query?: CertificateListQuery,
  ): Promise<CertificateListResponse> {
    const result = await this.repos.certificates.list(query);
    const certIds = result.items.map((row) => row.id);
    const latestSubMap =
      certIds.length > 0
        ? await this.repos.submissions.findLatestByCertificateIds(certIds)
        : new Map<number, SubmissionRow>();

    const items: CertificateListItem[] = result.items.map((row) => {
      const latestSub = latestSubMap.get(row.id) ?? null;
      return {
        id: row.id,
        so: row.so,
        fields: stripSensitiveFields(row.fields),
        dataSha256: row.dataSha256,
        status: row.status,
        batchId: row.batchId,
        batchFilename: row.batchFilename,
        excelRowNumber: row.excelRowNumber,
        serverCertificateId: row.serverCertificateId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        issues: this.computeIssues(row),
        latestSubmission: latestSub ? toLatestSubmissionSummary(latestSub) : null,
      };
    });

    return {
      items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      counts: result.counts,
    };
  }

  /**
   * `GET /api/certificates/:id` — Chi tiết chỉ đọc của 1 giấy:
   * trả đủ 25 trường + `issues[]` + `xml` (nếu không có lỗi chặn) + thông tin đợt import + lần gửi gần nhất.
   */
  public async getCertificateDetail(id: number): Promise<CertificateDetailResponse> {
    const row = await this.repos.certificates.findById(id);
    if (!row) {
      throw new AppError(
        'CERTIFICATE_NOT_FOUND',
        `Không tìm thấy giấy khám sức khỏe (id=${id}).`,
        404,
      );
    }

    const issues = this.computeIssues(row);
    const isInvalid = row.status === 'invalid' || hasBlockingErrors(issues);
    const xml = isInvalid ? null : buildGkskXml(row.fields);

    const [batch, latestSub] = await Promise.all([
      row.batchId !== null ? this.repos.batches.findById(row.batchId) : Promise.resolve(null),
      this.repos.submissions.findLatestByCertificateId(row.id),
    ]);

    return {
      id: row.id,
      so: row.so,
      fields: { ...row.fields },
      dataSha256: row.dataSha256,
      status: row.status,
      batchId: row.batchId,
      batchFilename: batch?.filename ?? row.batchFilename,
      excelRowNumber: row.excelRowNumber,
      batch,
      serverCertificateId: row.serverCertificateId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      issues,
      xml,
      latestSubmission: latestSub ? toLatestSubmissionSummary(latestSub) : null,
    };
  }

  /**
   * `DELETE /api/certificates/:id` — Xóa cục bộ khỏi DB (không xóa trên Hệ thống Sở).
   */
  public async deleteCertificate(id: number): Promise<void> {
    const deleted = await this.repos.certificates.deleteById(id);
    if (!deleted) {
      throw new AppError(
        'CERTIFICATE_NOT_FOUND',
        `Không tìm thấy giấy khám sức khỏe (id=${id}).`,
        404,
      );
    }
  }

  /**
   * `GET /api/certificates/:id/xml` — Tải file `<SO>.xml` lẻ.
   * Trả lỗi HTTP `422` nếu giấy đang `invalid` hoặc có lỗi dữ liệu chặn.
   */
  public async getCertificateXmlDownload(id: number): Promise<CertificateXmlDownload> {
    const row = await this.repos.certificates.findById(id);
    if (!row) {
      throw new AppError(
        'CERTIFICATE_NOT_FOUND',
        `Không tìm thấy giấy khám sức khỏe (id=${id}).`,
        404,
      );
    }

    const issues = this.computeIssues(row);
    if (row.status === 'invalid' || hasBlockingErrors(issues)) {
      throw new AppError(
        'CERTIFICATE_INVALID_XML',
        'Giấy khám sức khỏe đang có lỗi dữ liệu chặn (invalid), không thể xuất XML.',
        422,
      );
    }

    return {
      fileName: sanitizeXmlFileName(row.so),
      xml: buildGkskXml(row.fields),
    };
  }

  /**
   * `POST /api/certificates/xml-zip` — Đóng gói các file `<SO>.xml` của các giấy hợp lệ trong `ids`
   * thành file `GKSK_XML_<YYYYMMDD_HHmmss>.zip`.
   */
  public async buildCertificatesXmlZip(
    ids: readonly number[],
  ): Promise<CertificateZipDownload> {
    const uniqueIds = Array.from(new Set(ids));
    const foundRows = await this.repos.certificates.findByIds(uniqueIds);
    const rowById = new Map(foundRows.map((row) => [row.id, row]));

    const validRecords: XmlZipInputItem[] = [];
    for (const id of uniqueIds) {
      const row = rowById.get(id);
      if (!row || row.status === 'invalid') {
        continue;
      }
      const issues = this.computeIssues(row);
      if (hasBlockingErrors(issues)) {
        continue;
      }
      validRecords.push({
        so: row.so,
        fields: row.fields,
        status: row.status,
        issues,
      });
    }

    if (validRecords.length === 0) {
      throw new AppError(
        'NO_VALID_CERTIFICATES_FOR_ZIP',
        'Không có giấy khám sức khỏe hợp lệ nào trong danh sách đã chọn để xuất file ZIP.',
        422,
      );
    }

    const buffer = buildXmlZip(validRecords, {
      facilityId: this.facilityId,
      today: this.getToday(),
    });
    const timestamp = formatVnFileTimestamp(this.nowFn());

    return {
      fileName: `GKSK_XML_${timestamp}.zip`,
      buffer,
      includedCount: validRecords.length,
    };
  }

  /**
   * `GET /api/certificates/:id/submissions` — Lịch sử các lần gửi của giấy.
   */
  public async listCertificateSubmissions(id: number): Promise<SubmissionRow[]> {
    const row = await this.repos.certificates.findById(id);
    if (!row) {
      throw new AppError(
        'CERTIFICATE_NOT_FOUND',
        `Không tìm thấy giấy khám sức khỏe (id=${id}).`,
        404,
      );
    }
    return this.repos.submissions.listByCertificateId(id);
  }

  /**
   * `GET /api/certificates/export-excel` — Xuất file `.xlsx` đối soát 29 cột theo bộ lọc hiện tại.
   */
  public async exportReconcileExcel(
    filter?: {
      tab?: ReconcileTab;
      status?: CertificateStatus;
      batchId?: number;
      fromDate?: string;
      toDate?: string;
      q?: string;
    },
  ): Promise<ReconcileExcelDownload> {
    // Lấy toàn bộ các bản ghi khớp bộ lọc hiện tại (hỗ trợ nhiều trang nếu > 1000 dòng)
    const allRows: CertificateRow[] = [];
    let page = 1;
    const pageSize = 1000;

    for (;;) {
      const pageResult = await this.repos.certificates.list({
        ...filter,
        page,
        pageSize,
      });
      allRows.push(...pageResult.items);
      if (allRows.length >= pageResult.total || pageResult.items.length === 0) {
        break;
      }
      page += 1;
    }

    const certIds = allRows.map((row) => row.id);
    const latestSubMap =
      certIds.length > 0
        ? await this.repos.submissions.findLatestByCertificateIds(certIds)
        : new Map<number, SubmissionRow>();

    const excelItems: ReconcileExcelItem[] = allRows.map((row) => {
      const latestSub = latestSubMap.get(row.id);
      const localIssues = this.computeIssues(row);
      return {
        so: row.so,
        fields: row.fields,
        status: row.status,
        batchFilename: row.batchFilename,
        excelRowNumber: row.excelRowNumber,
        serverCertificateId: row.serverCertificateId,
        lastSentAt: latestSub ? (latestSub.finishedAt ?? latestSub.sendDatetime) : null,
        lastMsgId: latestSub?.msgId ?? null,
        localIssues,
        ...(latestSub?.errors ? { serverErrors: latestSub.errors } : {}),
        ...(latestSub?.warnings ? { serverWarnings: latestSub.warnings } : {}),
        ...(latestSub?.lastError ? { lastError: latestSub.lastError } : {}),
      };
    });

    const buffer = await buildReconcileExcel(excelItems);
    const timestamp = formatVnFileTimestamp(this.nowFn());

    return {
      fileName: `GKSK_doi_soat_${timestamp}.xlsx`,
      buffer,
      rowCount: excelItems.length,
    };
  }
}

export function createCertificateService(
  options: CertificateServiceOptions,
): CertificateService {
  return new CertificateService(options);
}
