import type { ServerIssue } from '@gksk/shared';
import type { GkskEnvelope } from './envelope.js';

/**
 * 4 nhóm phân loại kết quả gọi API GKSK theo IMPLEMENTATION-PLAN.md S7 & API-CONTRACT.md §6–§8:
 * - `accepted`: Hệ thống Sở đã tiếp nhận và lưu giấy (HTTP 200, `data.status = "accepted"`).
 * - `rejected`: Hệ thống Sở từ chối giấy do lỗi nghiệp vụ/dữ liệu (HTTP 200, `data.status = "rejected"`). Không retry.
 * - `transient`: Lỗi tạm thời (timeout, đứt mạng, HTTP 5xx, HTTP 429) hoặc lỗi bất thường trong phản hồi (`ref_msg_id` lệch).
 * - `config`: Lỗi cấu hình/xác thực/lập trình (sai tài khoản đăng nhập, HTTP 403 sau khi đã đăng nhập lại 1 lần, HTTP 400 envelope/chữ ký sai, HTTP 409 sau khi đã đổi `msg_id` 1 lần). Không retry.
 */
export type GkskResultKind = 'accepted' | 'rejected' | 'transient' | 'config';

/** Mã nguyên nhân chi tiết khi kết quả không phải `accepted` / `rejected`. */
export type GkskFailureReason =
  | 'timeout'
  | 'network_error'
  | 'http_5xx'
  | 'http_429'
  | 'http_403'
  | 'http_400'
  | 'http_409'
  | 'login_failed'
  | 'ref_msg_id_mismatch'
  | 'invalid_response';

/** Cấu trúc `data` đã chuẩn hóa khoan dung từ phản hồi `push` (API-CONTRACT.md §6) và `status` (§7). */
export interface GkskPushResultData {
  status: 'accepted' | 'rejected';
  submission_id: string;
  certificate_id: string | null;
  so: string | null;
  errors: ServerIssue[];
  warnings: ServerIssue[];
}

/** Sự kiện nhật ký dòng thời gian (`timeline`) của một lượt gọi API GKSK (phục vụ kiểm thử & đối soát S7). */
export interface GkskTimelineEvent {
  step: number;
  timestampMs: number;
  action:
    | 'login_request'
    | 'login_success'
    | 'login_cached'
    | 'login_failed'
    | 'push_request'
    | 'push_response'
    | 'push_error'
    | 'status_request'
    | 'status_response'
    | 'status_error'
    | 'retry_sleep'
    | 'relogin_on_403'
    | 'regenerate_msgid_on_409';
  msgId?: string;
  httpStatus?: number | null;
  resCode?: string | null;
  delayMs?: number;
  detail: string;
}

/** Thuộc tính chung của kết quả gửi giấy qua `gkskClient`. */
export interface GkskResultBase {
  kind: GkskResultKind;
  /** `msg_id` cuối cùng đã sử dụng (giữ nguyên khi retry lỗi mạng; chỉ đổi nếu gặp HTTP 409 từ CSYT khác). */
  msgId: string;
  /** Gói tin envelope tương ứng với `msgId` cuối cùng. */
  envelope: GkskEnvelope;
  /** Tổng số lần đã gọi `POST /push`. */
  attempts: number;
  /** Mã trạng thái HTTP của phản hồi cuối cùng (hoặc `null` nếu timeout/mất mạng). */
  httpStatus: number | null;
  /** Mã `header.res_code` hoặc `code` từ phản hồi (hoặc `null` nếu không có). */
  resCode: string | null;
  /** Thông điệp `header.res_msg` hoặc `message` từ Hệ thống Sở (không chứa dữ liệu cá nhân). */
  resMsg: string | null;
  /** `true` nếu kết quả được thu hồi qua `GET /status` sau khi lần `push` trước bị mất kết nối/timeout. */
  recoveredViaStatus: boolean;
  /** Dòng thời gian chi tiết các bước đã thực hiện. */
  timeline: GkskTimelineEvent[];
}

export interface GkskAcceptedResult extends GkskResultBase {
  kind: 'accepted';
  status: 'accepted';
  submissionId: string;
  certificateId: string | null;
  so: string | null;
  errors: ServerIssue[];
  warnings: ServerIssue[];
  data: GkskPushResultData;
}

export interface GkskRejectedResult extends GkskResultBase {
  kind: 'rejected';
  status: 'rejected';
  submissionId: string;
  certificateId: string | null;
  so: string | null;
  errors: ServerIssue[];
  warnings: ServerIssue[];
  data: GkskPushResultData;
}

export interface GkskTransientResult extends GkskResultBase {
  kind: 'transient';
  reason: GkskFailureReason;
  message: string;
  retryable: boolean;
  /** `true` khi phản hồi vi phạm giao thức bất thường (ví dụ `header.ref_msg_id !== msg_id`). */
  isAbnormal: boolean;
  retryAfterSec: number | null;
}

export interface GkskConfigResult extends GkskResultBase {
  kind: 'config';
  reason: GkskFailureReason;
  message: string;
  retryable: false;
  isAbnormal: boolean;
}

/** Kết quả hợp nhất sau khi gọi `push` (hoặc `withRetry`). */
export type GkskSendResult =
  | GkskAcceptedResult
  | GkskRejectedResult
  | GkskTransientResult
  | GkskConfigResult;

/** Distributive Omit giữ nguyên cấu trúc discriminated union. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** Kết quả của 1 lần gọi `pushOnce(envelope)` đơn lẻ (chưa gộp `attempts`, `recoveredViaStatus`, `timeline`). */
export type GkskPushAttemptResult = DistributiveOmit<
  GkskSendResult,
  'attempts' | 'recoveredViaStatus' | 'timeline'
>;

/** Kết quả của một lần gọi `login()`. */
export type GkskLoginResult =
  | {
      ok: true;
      kind: 'authenticated';
      token: string;
      durationMinutes: number;
      expiresAtMs: number;
      fromCache: boolean;
      httpStatus: number;
      resCode: string;
      resMsg: string | null;
    }
  | {
      ok: false;
      kind: 'config' | 'transient';
      reason: GkskFailureReason;
      httpStatus: number | null;
      resCode: string | null;
      resMsg: string | null;
      message: string;
      retryable: boolean;
    };

/** Kết quả của một lần gọi `status(msgId)` (API-CONTRACT.md §7). */
export type GkskStatusResult =
  | {
      kind: 'accepted' | 'rejected';
      found: true;
      httpStatus: number;
      resCode: string;
      resMsg: string | null;
      status: 'accepted' | 'rejected';
      submissionId: string;
      certificateId: string | null;
      so: string | null;
      errors: ServerIssue[];
      warnings: ServerIssue[];
      data: GkskPushResultData;
    }
  | {
      kind: 'not_found';
      found: false;
      httpStatus: 404;
      resCode: string | null;
      resMsg: string | null;
    }
  | {
      kind: 'transient' | 'config';
      found: false;
      reason: GkskFailureReason;
      httpStatus: number | null;
      resCode: string | null;
      resMsg: string | null;
      message: string;
      retryable: boolean;
    };

/** Giới hạn trần `Retry-After` khi gặp HTTP 429 (120 giây — API-CONTRACT.md §8). */
export const MAX_RETRY_AFTER_SECONDS = 120;

/**
 * Chuẩn hóa khoan dung mảng `errors` hoặc `warnings` từ Hệ thống Sở (API-CONTRACT.md §6):
 * - Nếu thiếu, `null` hoặc không phải mảng → trả mảng rỗng `[]`.
 * - Bỏ qua các phần tử không hợp lệ hoặc không có `code` dạng chuỗi.
 * - Chỉ giữ `{ code, field }` (tuyệt đối không lưu dữ liệu cá nhân).
 */
export function normalizeServerIssues(raw: unknown): ServerIssue[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized: ServerIssue[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code.trim() : '';
    if (code.length === 0) {
      continue;
    }
    const fieldRaw = record.field;
    const field =
      typeof fieldRaw === 'string' && fieldRaw.trim().length > 0 ? fieldRaw.trim() : null;
    normalized.push({ code, field });
  }
  return normalized;
}

/**
 * Parse khoan dung đối tượng `data` trong phản hồi của `push` (§6) và `status` (§7):
 * - Trường lạ bỏ qua.
 * - Thiếu `warnings` hoặc `errors` → mảng rỗng `[]`.
 * - Thiếu `certificate_id` hoặc `so` → `null`.
 */
export function parseLenientPushData(raw: unknown): GkskPushResultData | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const status = obj.status;
  if (status !== 'accepted' && status !== 'rejected') {
    return null;
  }

  const submissionId =
    typeof obj.submission_id === 'string' ? obj.submission_id.trim() : '';
  const certificateId =
    typeof obj.certificate_id === 'string' && obj.certificate_id.trim().length > 0
      ? obj.certificate_id.trim()
      : null;
  const so =
    typeof obj.so === 'string' && obj.so.trim().length > 0 ? obj.so.trim() : null;

  return {
    status,
    submission_id: submissionId,
    certificate_id: certificateId,
    so,
    errors: normalizeServerIssues(obj.errors),
    warnings: normalizeServerIssues(obj.warnings),
  };
}

/**
 * Đọc giá trị `Retry-After` (tính bằng giây) từ HTTP header khi gặp 429 (API-CONTRACT.md §8).
 * Kẹp trong khoảng `1..maxSeconds` (mặc định tối đa 120 giây).
 */
export function parseRetryAfterSeconds(
  headerValue: string | null | undefined,
  maxSeconds: number = MAX_RETRY_AFTER_SECONDS,
): number | null {
  if (typeof headerValue !== 'string') {
    return null;
  }
  const trimmed = headerValue.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.min(parsed, maxSeconds);
}

/**
 * Phân loại lỗi HTTP (4xx / 5xx) theo bảng ở API-CONTRACT.md §8.
 * Lưu ý:
 * - HTTP 403 sẽ được tầng retry bắt để đăng nhập lại đúng 1 lần; nếu vẫn 403 thì giữ kết quả `kind: 'config'`.
 * - HTTP 409 sẽ được tầng retry bắt để sinh `msg_id` mới thử lại đúng 1 lần; nếu vẫn 409 thì giữ kết quả `kind: 'config'`.
 */
export function classifyHttpFailure(params: {
  httpStatus: number;
  resCode: string | null;
  resMsg: string | null;
  retryAfterSec?: number | null;
}): {
  kind: 'transient' | 'config';
  reason: GkskFailureReason;
  retryable: boolean;
  message: string;
  retryAfterSec: number | null;
} {
  const { httpStatus, resCode, resMsg } = params;
  const retryAfterSec = params.retryAfterSec ?? null;
  const detailSuffix = resMsg ? `: ${resMsg}` : resCode ? ` (${resCode})` : '';

  if (httpStatus === 400) {
    return {
      kind: 'config',
      reason: 'http_400',
      retryable: false,
      message: `Lỗi cấu trúc gói tin/chữ ký (HTTP 400${resCode ? ` ${resCode}` : ''})${detailSuffix}`,
      retryAfterSec: null,
    };
  }

  if (httpStatus === 401) {
    return {
      kind: 'config',
      reason: 'login_failed',
      retryable: false,
      message: `Xác thực tài khoản CSYT thất bại (HTTP 401)${detailSuffix}`,
      retryAfterSec: null,
    };
  }

  if (httpStatus === 403) {
    return {
      kind: 'config',
      reason: 'http_403',
      retryable: false,
      message: `Từ chối quyền truy cập CSYT (HTTP 403${resCode ? ` ${resCode}` : ''})${detailSuffix}`,
      retryAfterSec: null,
    };
  }

  if (httpStatus === 409) {
    return {
      kind: 'config',
      reason: 'http_409',
      retryable: false,
      message: `Xung đột mã gói tin msg_id với CSYT khác (HTTP 409)${detailSuffix}`,
      retryAfterSec: null,
    };
  }

  if (httpStatus === 429) {
    return {
      kind: 'transient',
      reason: 'http_429',
      retryable: true,
      message: `Vượt giới hạn tần suất gọi API (HTTP 429${retryAfterSec ? `, Retry-After=${retryAfterSec}s` : ''})${detailSuffix}`,
      retryAfterSec,
    };
  }

  if (httpStatus >= 500 && httpStatus <= 599) {
    return {
      kind: 'transient',
      reason: 'http_5xx',
      retryable: true,
      message: `Lỗi máy chủ Hệ thống Sở (HTTP ${httpStatus}${resCode ? ` ${resCode}` : ''})${detailSuffix}`,
      retryAfterSec: null,
    };
  }

  return {
    kind: 'config',
    reason: 'invalid_response',
    retryable: false,
    message: `Phản hồi HTTP không mong đợi (HTTP ${httpStatus})${detailSuffix}`,
    retryAfterSec: null,
  };
}
