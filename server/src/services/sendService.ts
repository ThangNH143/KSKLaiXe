import type { Logger } from 'pino';
import {
  hasBlockingErrors,
  validateRecord,
  type CertificateStatus,
  type GkskRecord,
  type Issue,
} from '@gksk/shared';
import type {
  CertificateRow,
  DbRepositories,
  SubmissionRow,
} from '../db/types.js';
import type { GkskClient } from '../gksk/client.js';
import { buildEnvelope, formatVnYyMmDd, newMsgId } from '../gksk/envelope.js';
import type {
  GkskSendResult,
  GkskStatusResult,
  GkskTimelineEvent,
} from '../gksk/errors.js';
import type { WithRetryOptions } from '../gksk/retry.js';
import { sha256HexUpper } from '../gksk/signature.js';
import { buildGkskXml, toBase64Utf8, XmlSizeLimitError } from '../gksk/xml.js';
import { logger as defaultLogger } from '../logger.js';

/** Độ lệch múi giờ Việt Nam (UTC+7) tính bằng mili giây. */
const VN_UTC_OFFSET_MS = 7 * 3600 * 1000;

/** Giới hạn độ dài tối đa của cột `last_error` trong bảng `gksk_submissions` (`NVARCHAR(500)`). */
const MAX_LAST_ERROR_LENGTH = 500;

/** Mã lỗi nghiệp vụ của `SendService` ánh xạ sang HTTP status code. */
export type SendServiceErrorCode =
  | 'CERTIFICATE_NOT_FOUND'
  | 'SUBMISSION_NOT_FOUND'
  | 'INVALID_REQUEST';

/** Lỗi nghiệp vụ có cấu trúc của `SendService` (không bao giờ chứa PII). */
export class SendServiceError extends Error {
  public readonly code: SendServiceErrorCode;
  public readonly httpStatus: number;

  constructor(code: SendServiceErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = 'SendServiceError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** Kết quả dựng XML, Base64 và mã băm `data_sha256` từ bản ghi 25 trường. */
export interface CertificatePayloadParts {
  xml: string;
  base64Data: string;
  dataSha256: string;
}

/** Thông tin tóm tắt giấy khám sức khỏe trả về qua API gửi (đã loại bỏ `fields`/`fieldsJson` chứa PII). */
export interface SafeCertificateSummary {
  id: number;
  so: string;
  dataSha256: string;
  status: CertificateStatus;
  batchId: number | null;
  batchFilename: string | null;
  excelRowNumber: number | null;
  serverCertificateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toSafeCertificateSummary(row: CertificateRow): SafeCertificateSummary {
  return {
    id: row.id,
    so: row.so,
    dataSha256: row.dataSha256,
    status: row.status,
    batchId: row.batchId,
    batchFilename: row.batchFilename,
    excelRowNumber: row.excelRowNumber,
    serverCertificateId: row.serverCertificateId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Dựng chuỗi XML UTF-8, mã hóa Base64 và tính `data_sha256 = SHA256_UPPER(base64Data.trim())`
 * theo đúng chuẩn chữ ký gói tin tại API-CONTRACT.md §5 & ARCHITECTURE.md §5.
 */
export function computeCertificatePayload(
  record: GkskRecord,
): CertificatePayloadParts {
  const xml = buildGkskXml(record);
  const base64Data = toBase64Utf8(xml);
  const dataSha256 = sha256HexUpper(base64Data.trim());
  return {
    xml,
    base64Data,
    dataSha256,
  };
}

/**
 * Tính chuỗi ngày hiện tại `YYYY-MM-DD` theo giờ Việt Nam (`UTC+7` cố định)
 * để truyền vào `validateRecord(record, { facilityId, today })`.
 */
export function formatVnTodayIso(nowMs: number): string {
  // Kiểm tra nowMs hợp lệ qua formatVnYyMmDd
  formatVnYyMmDd(nowMs);
  return new Date(nowMs + VN_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/** Tùy chọn cho một lần gọi `sendCertificate(id, options)`. */
export interface SendCertificateCallOptions {
  /**
   * Callback được gọi ngay khi phát hiện phản hồi HTTP 429 (`CM_TOO_MANY_REQUESTS`)
   * từ Hệ thống Sở, truyền số mili-giây cần tạm dừng hàng đợi (`Retry-After`).
   */
  onRateLimit?: (retryAfterMs: number) => void;
  /** Callback nhận từng sự kiện trong `timeline` của lượt gửi. */
  onTimelineEvent?: (event: GkskTimelineEvent) => void;
}

/** Trạng thái kết thúc của 1 lần gọi `sendCertificate(id)`. */
export type SendTerminalStatus = 'accepted' | 'rejected' | 'error' | 'invalid';

/** Kết quả trả về của `sendService.sendCertificate(id)`. */
export interface SendCertificateOutcome {
  certificateId: number;
  so: string;
  status: SendTerminalStatus;
  certificate: CertificateRow;
  submission: SubmissionRow | null;
  issues: Issue[];
  /** `true` nếu tái sử dụng bản ghi submission chưa có kết quả (`result_status === null`) cùng `data_sha256`. */
  reusedPendingSubmission: boolean;
  /** `true` nếu kết quả được thu hồi qua `GET /status` mà không cần đẩy lại `POST /push`. */
  recoveredViaStatus: boolean;
  /** Số giây `Retry-After` nếu gặp HTTP 429 trong quá trình gửi. */
  rateLimitedRetryAfterSec: number | null;
  /** Nhật ký dòng thời gian các bước gọi API GKSK. */
  timeline: GkskTimelineEvent[];
}

/** Kết quả trả về của `sendService.refreshSubmission(submissionId)`. */
export interface RefreshSubmissionOutcome {
  submission: SubmissionRow;
  certificate: CertificateRow;
  statusResult: GkskStatusResult;
}

/** Cấu hình khởi tạo `SendService`. */
export interface SendServiceOptions {
  repos: DbRepositories;
  gkskClient: GkskClient;
  /** Mã CSYT theo cấu hình máy chủ (`GKSK_FACILITY_ID`), vd `"75001"`. */
  facilityId: string;
  /** Mã `sender_id` dùng trong envelope header (mặc định bằng `facilityId`). */
  senderId?: string;
  /** Khóa bí mật RSA PEM tùy chọn để ký gói tin envelope. */
  privateKeyPem?: string;
  /** Ghi đè ngày `today` cố định cho `validateRecord` (phục vụ kiểm thử xác định). */
  today?: string | Date;
  /** Tùy chọn retry mặc định truyền xuống `gkskClient.push` (vd `maxRetries`, `retryDelaysMs`). */
  retryOptions?: Pick<WithRetryOptions, 'maxRetries' | 'retryDelaysMs'>;
  /** Hàm lấy thời gian hiện tại (epoch ms), mặc định lấy từ `gkskClient.getNow()`. */
  now?: () => number;
  /** Logger `pino` có redact (mặc định dùng `logger` của server). */
  logger?: Logger;
}

function formatSafeLastError(result: Extract<GkskSendResult, { kind: 'transient' | 'config' }>): string {
  const codePart = result.resCode ? ` (${result.resCode})` : '';
  const httpPart = result.httpStatus !== null ? ` HTTP ${result.httpStatus}` : '';
  const raw = `[${result.kind.toUpperCase()}:${result.reason}${httpPart}${codePart}] ${result.message}`;
  return raw.slice(0, MAX_LAST_ERROR_LENGTH);
}

/**
 * Dịch vụ thực thi máy trạng thái gửi 1 giấy khám sức khỏe (`sendCertificate`)
 * và tra cứu lại trạng thái theo `msg_id` (`refreshSubmission`) theo đúng ARCHITECTURE.md §6.
 */
export class SendService {
  private readonly repos: DbRepositories;
  private readonly gkskClient: GkskClient;
  private facilityId: string;
  private senderId: string;
  private readonly privateKeyPem: string | undefined;
  private readonly todayOverride: string | Date | undefined;
  private readonly retryOptions: Pick<WithRetryOptions, 'maxRetries' | 'retryDelaysMs'> | undefined;
  private readonly nowFn: () => number;
  private readonly log: Logger;
  private readonly inFlightByCertId = new Map<number, Promise<SendCertificateOutcome>>();

  constructor(options: SendServiceOptions) {
    this.repos = options.repos;
    this.gkskClient = options.gkskClient;
    this.facilityId = options.facilityId.trim();
    this.senderId = (options.senderId ?? options.facilityId).trim();
    this.privateKeyPem = options.privateKeyPem;
    this.todayOverride = options.today;
    this.retryOptions = options.retryOptions;
    this.nowFn = options.now ?? (() => this.gkskClient.getNow());
    this.log = options.logger ?? defaultLogger;
  }

  public getSenderConfig(): { facilityId: string; senderId: string } {
    return {
      facilityId: this.facilityId,
      senderId: this.senderId,
    };
  }

  public updateSenderConfig(input: {
    facilityId?: string;
    senderId?: string;
  }): void {
    if (
      typeof input.facilityId === 'string' &&
      input.facilityId.trim().length > 0
    ) {
      this.facilityId = input.facilityId.trim();
    }
    if (typeof input.senderId === 'string') {
      const trimmedSender = input.senderId.trim();
      this.senderId =
        trimmedSender.length > 0 ? trimmedSender : this.facilityId;
    }
  }

  /**
   * Thực thi máy trạng thái gửi 1 giấy GKSK lên Hệ thống Sở (ARCHITECTURE.md §6):
   * 1. Kiểm tra lại bằng `validateRecord`; nếu có lỗi chặn (`severity = 'error'`) -> cập nhật `invalid`, không gọi API.
   * 2. Dựng XML -> Base64 -> tính `data_sha256`; tìm submission chưa có kết quả (`result_status === null`)
   *    có cùng `data_sha256` để giữ nguyên `msg_id` & `send_datetime`, hoặc tạo mới khi dữ liệu đã đổi.
   * 3. Nếu là gửi lại từ submission dở dang (`attempts > 0`), gọi `GET /status` trước khi `POST /push`.
   * 4. Đẩy gói tin qua `gkskClient.push` (`withRetry`), lưu đầy đủ `attempts`, `http_status`, `res_code`,
   *    `result_status`, `server_submission_id`, `server_certificate_id`, `errors_json`, `warnings_json`, `last_error`.
   * 5. Cập nhật `gksk_certificates.status` (`accepted | rejected | error`), đảm bảo không bao giờ để giấy kẹt ở `sending`.
   */
  public async sendCertificate(
    id: number,
    callOptions?: SendCertificateCallOptions,
  ): Promise<SendCertificateOutcome> {
    const existingInFlight = this.inFlightByCertId.get(id);
    if (existingInFlight) {
      return existingInFlight;
    }

    const task = this.executeSendCertificate(id, callOptions);
    this.inFlightByCertId.set(id, task);
    try {
      return await task;
    } finally {
      this.inFlightByCertId.delete(id);
    }
  }

  private async executeSendCertificate(
    id: number,
    callOptions?: SendCertificateCallOptions,
  ): Promise<SendCertificateOutcome> {
    const cert = await this.repos.certificates.findById(id);
    if (!cert) {
      throw new SendServiceError(
        'CERTIFICATE_NOT_FOUND',
        `Không tìm thấy giấy khám sức khỏe (id=${id}).`,
        404,
      );
    }

    const startNowMs = this.nowFn();
    const today = this.todayOverride ?? formatVnTodayIso(startNowMs);

    // Bước 1: Kiểm tra lại bằng validateRecord
    const issues = validateRecord(cert.fields, {
      facilityId: this.facilityId,
      today,
    });

    if (hasBlockingErrors(issues)) {
      const blockingCodes = issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.code);

      const updatedCert =
        (await this.repos.certificates.updateStatus(cert.id, {
          status: 'invalid',
          now: new Date(startNowMs),
        })) ?? { ...cert, status: 'invalid' as const };

      this.log.warn(
        {
          certificateId: cert.id,
          so: cert.so,
          status: 'invalid',
          blockingCodes,
        },
        'Chặn gửi giấy GKSK do có lỗi dữ liệu chặn (invalid)',
      );

      return {
        certificateId: updatedCert.id,
        so: updatedCert.so,
        status: 'invalid',
        certificate: updatedCert,
        submission: null,
        issues,
        reusedPendingSubmission: false,
        recoveredViaStatus: false,
        rateLimitedRetryAfterSec: null,
        timeline: [],
      };
    }

    // Bước 2: Dựng XML -> Base64 -> tính data_sha256
    let payload: CertificatePayloadParts;
    try {
      payload = computeCertificatePayload(cert.fields);
    } catch (err) {
      if (err instanceof XmlSizeLimitError) {
        const xmlIssue: Issue = {
          code: 'GKSK_XML_INVALID',
          field: null,
          severity: 'error',
          source: 'server-mirror',
        };
        const nextIssues = [...issues, xmlIssue];
        const updatedCert =
          (await this.repos.certificates.updateStatus(cert.id, {
            status: 'invalid',
            now: new Date(startNowMs),
          })) ?? { ...cert, status: 'invalid' as const };

        this.log.warn(
          {
            certificateId: cert.id,
            so: cert.so,
            status: 'invalid',
            byteLength: err.byteLength,
            maxBytes: err.maxBytes,
          },
          'Chặn gửi giấy GKSK do kích thước XML vượt quá 1 MB',
        );

        return {
          certificateId: updatedCert.id,
          so: updatedCert.so,
          status: 'invalid',
          certificate: updatedCert,
          submission: null,
          issues: nextIssues,
          reusedPendingSubmission: false,
          recoveredViaStatus: false,
          rateLimitedRetryAfterSec: null,
          timeline: [],
        };
      }
      throw err;
    }

    const { xml, dataSha256 } = payload;

    // Nếu data_sha256 trong bảng gksk_certificates bị lệch so với fields hiện tại, đồng bộ lại
    if (cert.dataSha256 !== dataSha256) {
      await this.repos.certificates.upsertBySo({
        so: cert.so,
        fields: cert.fields,
        dataSha256,
        status: cert.status,
        batchId: cert.batchId,
        excelRowNumber: cert.excelRowNumber,
        serverCertificateId: cert.serverCertificateId,
        now: new Date(startNowMs),
      });
    }

    // Tìm submission chưa có kết quả (result_status === null) có cùng data_sha256
    const existingPending = await this.repos.submissions.findPendingByCertificateAndSha(
      cert.id,
      dataSha256,
    );

    const reusedPendingSubmission = existingPending !== null;
    const previousAttempts = existingPending ? existingPending.attempts : 0;
    const msgId = existingPending
      ? existingPending.msgId
      : newMsgId(this.senderId, startNowMs);
    const sendDatetime = existingPending ? existingPending.sendDatetime : startNowMs;

    let submissionRow: SubmissionRow;
    if (existingPending) {
      submissionRow = existingPending;
    } else {
      submissionRow = await this.repos.submissions.create({
        certificateId: cert.id,
        msgId,
        sendDatetime,
        dataSha256,
        attempts: 0,
        httpStatus: null,
        resCode: null,
        resultStatus: null,
        serverSubmissionId: null,
        errors: null,
        warnings: null,
        lastError: null,
        createdAt: new Date(startNowMs),
        finishedAt: null,
      });
    }

    // Chuyển trạng thái giấy sang 'sending'
    await this.repos.certificates.updateStatus(cert.id, {
      status: 'sending',
      now: new Date(startNowMs),
    });

    const envelope = buildEnvelope({
      senderId: this.senderId,
      xml,
      msgId,
      sendDatetime,
      ...(this.privateKeyPem !== undefined ? { privateKeyPem: this.privateKeyPem } : {}),
    });

    let rateLimitedRetryAfterSec: number | null = null;
    const checkStatusFirst = reusedPendingSubmission && previousAttempts > 0;

    try {
      const pushResult = await this.gkskClient.push(envelope, {
        ...this.retryOptions,
        checkStatusFirst,
        onEvent: (event) => {
          if (
            event.action === 'retry_sleep' &&
            event.httpStatus === 429 &&
            typeof event.delayMs === 'number' &&
            event.delayMs > 0
          ) {
            rateLimitedRetryAfterSec = Math.ceil(event.delayMs / 1000);
            callOptions?.onRateLimit?.(event.delayMs);
          }
          callOptions?.onTimelineEvent?.(event);
        },
      });

      if (
        pushResult.kind === 'transient' &&
        pushResult.reason === 'http_429' &&
        pushResult.retryAfterSec !== null &&
        pushResult.retryAfterSec > 0
      ) {
        rateLimitedRetryAfterSec = pushResult.retryAfterSec;
        callOptions?.onRateLimit?.(pushResult.retryAfterSec * 1000);
      }

      const finishNowMs = this.nowFn();
      const totalAttempts =
        reusedPendingSubmission && pushResult.recoveredViaStatus
          ? Math.max(1, previousAttempts + pushResult.attempts)
          : previousAttempts + pushResult.attempts;

      if (pushResult.kind === 'accepted' || pushResult.kind === 'rejected') {
        const nextStatus: CertificateStatus =
          pushResult.kind === 'accepted' ? 'accepted' : 'rejected';
        const nextServerCertId =
          pushResult.certificateId !== null
            ? pushResult.certificateId
            : cert.serverCertificateId;

        const updatedSubmission =
          (await this.repos.submissions.update(submissionRow.id, {
            msgId: pushResult.msgId,
            sendDatetime: pushResult.envelope.header.send_datetime,
            attempts: totalAttempts,
            httpStatus: pushResult.httpStatus,
            resCode: pushResult.resCode,
            resultStatus: pushResult.status,
            serverSubmissionId:
              pushResult.submissionId.length > 0 ? pushResult.submissionId : null,
            errors: pushResult.errors,
            warnings: pushResult.warnings,
            lastError: null,
            finishedAt: new Date(finishNowMs),
          })) ?? submissionRow;

        const updatedCert =
          (await this.repos.certificates.updateStatus(cert.id, {
            status: nextStatus,
            serverCertificateId: nextServerCertId,
            now: new Date(finishNowMs),
          })) ?? {
            ...cert,
            status: nextStatus,
            serverCertificateId: nextServerCertId,
          };

        this.log.info(
          {
            certificateId: cert.id,
            so: cert.so,
            submissionId: updatedSubmission.id,
            msgId: updatedSubmission.msgId,
            status: nextStatus,
            attempts: totalAttempts,
            reusedPendingSubmission,
            recoveredViaStatus: pushResult.recoveredViaStatus,
            serverSubmissionId: updatedSubmission.serverSubmissionId,
            serverCertificateId: updatedCert.serverCertificateId,
            errorCodes: pushResult.errors.map((e) => e.code),
            warningCodes: pushResult.warnings.map((w) => w.code),
          },
          'Hoàn tất xử lý gửi giấy GKSK',
        );

        return {
          certificateId: updatedCert.id,
          so: updatedCert.so,
          status: nextStatus,
          certificate: updatedCert,
          submission: updatedSubmission,
          issues,
          reusedPendingSubmission,
          recoveredViaStatus: pushResult.recoveredViaStatus,
          rateLimitedRetryAfterSec,
          timeline: pushResult.timeline,
        };
      }

      // Lỗi tạm thời (transient) sau khi hết retry hoặc lỗi cấu hình (config) -> trạng thái giấy 'error',
      // giữ resultStatus = null để lần "Gửi lại" tiếp theo tái sử dụng cùng msg_id nếu dữ liệu giấy chưa đổi.
      const safeLastError = formatSafeLastError(pushResult);
      const updatedSubmission =
        (await this.repos.submissions.update(submissionRow.id, {
          msgId: pushResult.msgId,
          sendDatetime: pushResult.envelope.header.send_datetime,
          attempts: totalAttempts,
          httpStatus: pushResult.httpStatus,
          resCode: pushResult.resCode,
          resultStatus: null,
          lastError: safeLastError,
          finishedAt: new Date(finishNowMs),
        })) ?? submissionRow;

      const updatedCert =
        (await this.repos.certificates.updateStatus(cert.id, {
          status: 'error',
          now: new Date(finishNowMs),
        })) ?? { ...cert, status: 'error' as const };

      this.log.warn(
        {
          certificateId: cert.id,
          so: cert.so,
          submissionId: updatedSubmission.id,
          msgId: updatedSubmission.msgId,
          status: 'error',
          failureKind: pushResult.kind,
          failureReason: pushResult.reason,
          httpStatus: pushResult.httpStatus,
          resCode: pushResult.resCode,
          attempts: totalAttempts,
          reusedPendingSubmission,
        },
        'Gửi giấy GKSK thất bại, chuyển trạng thái sang error',
      );

      return {
        certificateId: updatedCert.id,
        so: updatedCert.so,
        status: 'error',
        certificate: updatedCert,
        submission: updatedSubmission,
        issues,
        reusedPendingSubmission,
        recoveredViaStatus: false,
        rateLimitedRetryAfterSec,
        timeline: pushResult.timeline,
      };
    } catch (unexpectedError) {
      const finishNowMs = this.nowFn();
      const safeMessage =
        '[INTERNAL_ERROR] Lỗi nội bộ không mong đợi khi thực thi gửi giấy GKSK';

      await this.repos.submissions.update(submissionRow.id, {
        lastError: safeMessage,
        finishedAt: new Date(finishNowMs),
      });
      await this.repos.certificates.updateStatus(cert.id, {
        status: 'error',
        now: new Date(finishNowMs),
      });

      this.log.error(
        {
          certificateId: cert.id,
          so: cert.so,
          submissionId: submissionRow.id,
          msgId: submissionRow.msgId,
        },
        'Lỗi bất ngờ trong sendCertificate, đã hạ trạng thái giấy về error để không kẹt sending',
      );

      throw unexpectedError;
    }
  }

  /**
   * Tra cứu lại trạng thái của một lần gửi (`gksk_submissions`) theo `msg_id`
   * qua `GET /api/platform/gksk-lai-xe/status?msg_id=<msg_id>` (API-CONTRACT.md §7 & ARCHITECTURE.md §4, §6).
   */
  public async refreshSubmission(
    submissionId: number,
  ): Promise<RefreshSubmissionOutcome> {
    const submission = await this.repos.submissions.findById(submissionId);
    if (!submission) {
      throw new SendServiceError(
        'SUBMISSION_NOT_FOUND',
        `Không tìm thấy bản ghi lịch sử gửi (id=${submissionId}).`,
        404,
      );
    }

    const cert = await this.repos.certificates.findById(submission.certificateId);
    if (!cert) {
      throw new SendServiceError(
        'CERTIFICATE_NOT_FOUND',
        `Không tìm thấy giấy khám sức khỏe (id=${submission.certificateId}) của lần gửi này.`,
        404,
      );
    }

    const statusResult = await this.gkskClient.status(submission.msgId);
    const nowDate = new Date(this.nowFn());

    if (statusResult.found) {
      const updatedSubmission =
        (await this.repos.submissions.update(submission.id, {
          httpStatus: statusResult.httpStatus,
          resCode: statusResult.resCode,
          resultStatus: statusResult.status,
          serverSubmissionId:
            statusResult.submissionId.length > 0
              ? statusResult.submissionId
              : submission.serverSubmissionId,
          errors: statusResult.errors,
          warnings: statusResult.warnings,
          lastError: null,
          finishedAt: nowDate,
        })) ?? submission;

      // Cập nhật trạng thái giấy và server_certificate_id (nếu giấy bị xóa trên Sở thì certificateId có thể là null)
      const nextStatus: CertificateStatus =
        statusResult.status === 'accepted' ? 'accepted' : 'rejected';
      const updatedCert =
        (await this.repos.certificates.updateStatus(cert.id, {
          status: nextStatus,
          serverCertificateId: statusResult.certificateId,
          now: nowDate,
        })) ?? {
          ...cert,
          status: nextStatus,
          serverCertificateId: statusResult.certificateId,
        };

      this.log.info(
        {
          certificateId: cert.id,
          so: cert.so,
          submissionId: updatedSubmission.id,
          msgId: updatedSubmission.msgId,
          resultStatus: statusResult.status,
          serverSubmissionId: updatedSubmission.serverSubmissionId,
          serverCertificateId: updatedCert.serverCertificateId,
        },
        'Đã đồng bộ kết quả tra cứu status gói tin GKSK',
      );

      return {
        submission: updatedSubmission,
        certificate: updatedCert,
        statusResult,
      };
    }

    if (statusResult.kind === 'not_found') {
      const updatedSubmission =
        (await this.repos.submissions.update(submission.id, {
          httpStatus: 404,
          resCode: statusResult.resCode ?? 'CM_INVALID_REQUEST',
          lastError:
            '[NOT_FOUND HTTP 404] Hệ thống Sở chưa từng ghi nhận gói tin có msg_id này',
        })) ?? submission;

      let updatedCert = cert;
      if (cert.status === 'sending') {
        updatedCert =
          (await this.repos.certificates.updateStatus(cert.id, {
            status: 'error',
            now: nowDate,
          })) ?? { ...cert, status: 'error' as const };
      }

      this.log.info(
        {
          certificateId: cert.id,
          so: cert.so,
          submissionId: updatedSubmission.id,
          msgId: updatedSubmission.msgId,
          httpStatus: 404,
        },
        'Tra cứu status gói tin GKSK trả về HTTP 404 (chưa được xử lý trên Sở)',
      );

      return {
        submission: updatedSubmission,
        certificate: updatedCert,
        statusResult,
      };
    }

    // Lỗi mạng tạm thời hoặc lỗi cấu hình khi gọi GET /status
    const safeError = `[${statusResult.kind.toUpperCase()}:${statusResult.reason}] ${statusResult.message}`.slice(
      0,
      MAX_LAST_ERROR_LENGTH,
    );
    const updatedSubmission =
      (await this.repos.submissions.update(submission.id, {
        httpStatus: statusResult.httpStatus,
        resCode: statusResult.resCode,
        lastError: safeError,
      })) ?? submission;

    let updatedCert = cert;
    if (cert.status === 'sending') {
      updatedCert =
        (await this.repos.certificates.updateStatus(cert.id, {
          status: 'error',
          now: nowDate,
        })) ?? { ...cert, status: 'error' as const };
    }

    this.log.warn(
      {
        certificateId: cert.id,
        so: cert.so,
        submissionId: updatedSubmission.id,
        msgId: updatedSubmission.msgId,
        failureKind: statusResult.kind,
        failureReason: statusResult.reason,
        httpStatus: statusResult.httpStatus,
      },
      'Lỗi khi gọi tra cứu status gói tin GKSK',
    );

    return {
      submission: updatedSubmission,
      certificate: updatedCert,
      statusResult,
    };
  }
}

export function createSendService(options: SendServiceOptions): SendService {
  return new SendService(options);
}
