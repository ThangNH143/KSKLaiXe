import type { GkskEnvelope } from './envelope.js';
import {
  MAX_RETRY_AFTER_SECONDS,
  type GkskLoginResult,
  type GkskPushAttemptResult,
  type GkskSendResult,
  type GkskStatusResult,
  type GkskTimelineEvent,
} from './errors.js';

/** Khoảng chờ chuẩn giữa 3 lần thử lại lỗi mạng/5xx: 5s → 15s → 45s (API-CONTRACT.md §8). */
export const RETRY_DELAYS_MS = [5_000, 15_000, 45_000] as const;

/** Số lần thử lại tối đa cho lỗi tạm thời (timeout / đứt mạng / 5xx / 429) theo API-CONTRACT.md §8. */
export const MAX_RETRY_COUNT = 3;

/** Hàm ghi nhận sự kiện dòng thời gian nội bộ (không cần truyền `step` và `timestampMs`). */
export type TimelineRecorder = (
  event: Omit<GkskTimelineEvent, 'step' | 'timestampMs'>,
) => void;

/** Tùy chọn thực thi chính sách retry (API-CONTRACT.md §8). */
export interface WithRetryOptions {
  /** Gọi `GET /status` trước cả lần `push` đầu tiên (dùng ở S9 khi khôi phục lần gửi dở dang từ DB). */
  checkStatusFirst?: boolean;
  /** Số lần thử lại tối đa (mặc định 3 lần theo API-CONTRACT.md §8). */
  maxRetries?: number;
  /** Bảng thời gian chờ giữa các lần thử lại (mặc định `[5000, 15000, 45000]` ms). */
  retryDelaysMs?: readonly number[];
  /** Callback nhận từng sự kiện trong `timeline`. */
  onEvent?: (event: GkskTimelineEvent) => void;
}

/** Giao diện đối tượng client cần thiết để chạy `withRetry`. */
export interface GkskRetryTarget {
  login(options?: {
    forceRefresh?: boolean;
    onEvent?: TimelineRecorder;
  }): Promise<GkskLoginResult>;
  pushOnce(
    envelope: GkskEnvelope,
    options?: { onEvent?: TimelineRecorder },
  ): Promise<GkskPushAttemptResult>;
  status(
    msgId: string,
    options?: { onEvent?: TimelineRecorder; skipReloginOn403?: boolean },
  ): Promise<GkskStatusResult>;
  regenerateEnvelopeOn409(envelope: GkskEnvelope): GkskEnvelope;
  getNow(): number;
  getSleep(): (ms: number) => Promise<void>;
}

/** Hàm `sleep` thật mặc định bằng `setTimeout`. */
export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toLoginFailureResult(
  loginFailure: Extract<GkskLoginResult, { ok: false }>,
  envelope: GkskEnvelope,
  attempts: number,
  timeline: GkskTimelineEvent[],
): GkskSendResult {
  const base = {
    msgId: envelope.header.msg_id,
    envelope,
    attempts,
    httpStatus: loginFailure.httpStatus,
    resCode: loginFailure.resCode,
    resMsg: loginFailure.resMsg,
    recoveredViaStatus: false,
    isAbnormal: false,
    timeline,
  };

  if (loginFailure.kind === 'config') {
    return {
      ...base,
      kind: 'config',
      reason: loginFailure.reason,
      message: loginFailure.message,
      retryable: false,
    };
  }

  return {
    ...base,
    kind: 'transient',
    reason: loginFailure.reason,
    message: loginFailure.message,
    retryable: loginFailure.retryable,
    retryAfterSec: null,
  };
}

/**
 * Thực thi gửi gói tin GKSK theo đúng chính sách retry tại API-CONTRACT.md §8:
 * - Tối đa 3 lần thử lại (5s → 15s → 45s; gặp HTTP 429 chờ theo `Retry-After`, tối đa 120s).
 * - Trước mỗi lần gửi lại sau timeout / lỗi mạng / 5xx: bắt buộc gọi `status(msg_id)` trước:
 *   + Nếu `status` trả HTTP 200 (`accepted` hoặc `rejected`): trả kết quả đó luôn, tuyệt đối không `push` lại.
 *   + Nếu `status` trả HTTP 404: `push` lại với cùng `msg_id`, `send_datetime`, `data`, `signature`.
 * - Gặp HTTP 403 (`CM_PERMISSION_DENY`): xóa token cũ, gọi `login()` lại đúng 1 lần rồi thử lại; nếu vẫn 403 → trả `kind: 'config'`.
 * - Gặp HTTP 409 (trùng `msg_id` với CSYT khác): sinh `msg_id` mới + ký lại gói tin rồi thử đúng 1 lần.
 * - Gặp `rejected` (HTTP 200), HTTP 400, login sai, hoặc `header.ref_msg_id` lệch: không retry.
 */
export async function withRetry(
  target: GkskRetryTarget,
  initialEnvelope: GkskEnvelope,
  options: WithRetryOptions = {},
): Promise<GkskSendResult> {
  const maxRetries = options.maxRetries ?? MAX_RETRY_COUNT;
  const delaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  const sleep = target.getSleep();
  const timeline: GkskTimelineEvent[] = [];

  const recordTimeline: TimelineRecorder = (event) => {
    const fullEvent: GkskTimelineEvent = {
      step: timeline.length + 1,
      timestampMs: target.getNow(),
      ...event,
    };
    timeline.push(fullEvent);
    options.onEvent?.(fullEvent);
  };

  let currentEnvelope = initialEnvelope;
  let reloginAttempted = false;
  let conflictRetried = false;
  let transientRetriesUsed = 0;
  let pushAttempts = 0;
  let needStatusCheckBeforePush = options.checkStatusFirst ?? false;

  // 1. Đảm bảo đã có token đăng nhập hợp lệ trước khi bắt đầu
  const initialLogin = await target.login({ onEvent: recordTimeline });
  if (!initialLogin.ok) {
    return toLoginFailureResult(initialLogin, currentEnvelope, 0, timeline);
  }

  for (;;) {
    // 2. Trước mỗi lần gửi lại sau timeout / lỗi mạng / 5xx (hoặc checkStatusFirst): gọi status(msgId) trước
    if (needStatusCheckBeforePush) {
      const statusResult = await target.status(currentEnvelope.header.msg_id, {
        onEvent: recordTimeline,
        skipReloginOn403: reloginAttempted,
      });

      if (statusResult.found) {
        // Server đã xử lý xong gói tin này -> lấy kết quả luôn, tuyệt đối KHÔNG push lại!
        return {
          kind: statusResult.kind,
          status: statusResult.status,
          msgId: currentEnvelope.header.msg_id,
          envelope: currentEnvelope,
          attempts: pushAttempts,
          httpStatus: statusResult.httpStatus,
          resCode: statusResult.resCode,
          resMsg: statusResult.resMsg,
          recoveredViaStatus: true,
          submissionId: statusResult.submissionId,
          certificateId: statusResult.certificateId,
          so: statusResult.so,
          errors: statusResult.errors,
          warnings: statusResult.warnings,
          data: statusResult.data,
          timeline,
        };
      }

      if (statusResult.kind === 'config') {
        return {
          kind: 'config',
          reason: statusResult.reason,
          message: statusResult.message,
          msgId: currentEnvelope.header.msg_id,
          envelope: currentEnvelope,
          attempts: pushAttempts,
          httpStatus: statusResult.httpStatus,
          resCode: statusResult.resCode,
          resMsg: statusResult.resMsg,
          recoveredViaStatus: false,
          retryable: false,
          isAbnormal: false,
          timeline,
        };
      }

      // HTTP 404 (not_found) hoặc lỗi mạng tạm thời khi tra status -> tiến hành push lại với cùng msg_id
      needStatusCheckBeforePush = false;
    }

    // 3. Gọi POST /api/platform/gksk-lai-xe/push
    pushAttempts += 1;
    const outcome = await target.pushOnce(currentEnvelope, {
      onEvent: recordTimeline,
    });

    if (outcome.kind === 'accepted' || outcome.kind === 'rejected') {
      return {
        ...outcome,
        msgId: currentEnvelope.header.msg_id,
        envelope: currentEnvelope,
        attempts: pushAttempts,
        recoveredViaStatus: false,
        timeline,
      };
    }

    // 4. Xử lý HTTP 403: đăng nhập lại đúng 1 lần rồi thử lại
    if (outcome.reason === 'http_403') {
      if (!reloginAttempted) {
        reloginAttempted = true;
        recordTimeline({
          action: 'relogin_on_403',
          msgId: currentEnvelope.header.msg_id,
          httpStatus: 403,
          resCode: outcome.resCode,
          detail: 'Gặp HTTP 403 khi push -> đăng nhập lại đúng 1 lần rồi gửi lại cùng msg_id',
        });

        const reloginResult = await target.login({
          forceRefresh: true,
          onEvent: recordTimeline,
        });
        if (!reloginResult.ok) {
          return toLoginFailureResult(
            reloginResult,
            currentEnvelope,
            pushAttempts,
            timeline,
          );
        }

        continue;
      }

      // Đã đăng nhập lại 1 lần mà vẫn 403 -> báo lỗi cấu hình (kind: 'config'), không retry nữa
      return {
        ...outcome,
        kind: 'config',
        retryable: false,
        msgId: currentEnvelope.header.msg_id,
        envelope: currentEnvelope,
        attempts: pushAttempts,
        recoveredViaStatus: false,
        timeline,
      };
    }

    // 5. Xử lý HTTP 409 (msg_id đã bị CSYT khác dùng): sinh msg_id mới và thử lại đúng 1 lần
    if (outcome.reason === 'http_409') {
      if (!conflictRetried) {
        conflictRetried = true;
        const previousMsgId = currentEnvelope.header.msg_id;
        currentEnvelope = target.regenerateEnvelopeOn409(currentEnvelope);
        recordTimeline({
          action: 'regenerate_msgid_on_409',
          msgId: currentEnvelope.header.msg_id,
          httpStatus: 409,
          resCode: outcome.resCode,
          detail: `Gặp HTTP 409 trùng msg_id -> sinh msg_id mới (${previousMsgId} -> ${currentEnvelope.header.msg_id}) và thử lại đúng 1 lần`,
        });
        continue;
      }

      return {
        ...outcome,
        kind: 'config',
        retryable: false,
        msgId: currentEnvelope.header.msg_id,
        envelope: currentEnvelope,
        attempts: pushAttempts,
        recoveredViaStatus: false,
        timeline,
      };
    }

    // 6. Các lỗi không được phép retry (HTTP 400, ref_msg_id lệch, phản hồi hỏng không retryable)
    if (outcome.kind === 'config' || !outcome.retryable) {
      return {
        ...outcome,
        msgId: currentEnvelope.header.msg_id,
        envelope: currentEnvelope,
        attempts: pushAttempts,
        recoveredViaStatus: false,
        timeline,
      };
    }

    // 7. Lỗi tạm thời có thể retry (timeout, network_error, http_5xx, http_429)
    if (transientRetriesUsed >= maxRetries) {
      return {
        ...outcome,
        msgId: currentEnvelope.header.msg_id,
        envelope: currentEnvelope,
        attempts: pushAttempts,
        recoveredViaStatus: false,
        timeline,
      };
    }

    let delayMs: number;
    if (
      outcome.reason === 'http_429' &&
      outcome.retryAfterSec !== null &&
      outcome.retryAfterSec > 0
    ) {
      delayMs = Math.min(outcome.retryAfterSec, MAX_RETRY_AFTER_SECONDS) * 1000;
    } else {
      const fallbackDelay = delaysMs[delaysMs.length - 1] ?? 45_000;
      delayMs = delaysMs[transientRetriesUsed] ?? fallbackDelay;
    }

    transientRetriesUsed += 1;
    recordTimeline({
      action: 'retry_sleep',
      msgId: currentEnvelope.header.msg_id,
      httpStatus: outcome.httpStatus,
      resCode: outcome.resCode,
      delayMs,
      detail: `Chờ ${delayMs}ms trước lần thử lại #${transientRetriesUsed}/${maxRetries} (lý do: ${outcome.reason})`,
    });

    await sleep(delayMs);

    // Sau timeout / lỗi mạng / 5xx bắt buộc phải gọi status(msgId) trước khi push lại
    needStatusCheckBeforePush =
      outcome.reason === 'timeout' ||
      outcome.reason === 'network_error' ||
      outcome.reason === 'http_5xx';
  }
}
