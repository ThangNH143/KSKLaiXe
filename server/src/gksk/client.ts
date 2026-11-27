import type { Logger } from 'pino';
import { logger as defaultLogger } from '../logger.js';
import {
  buildEnvelopeHeader,
  newMsgId,
  type GkskEnvelope,
} from './envelope.js';
import {
  classifyHttpFailure,
  parseLenientPushData,
  parseRetryAfterSeconds,
  type GkskLoginResult,
  type GkskPushAttemptResult,
  type GkskSendResult,
  type GkskStatusResult,
} from './errors.js';
import {
  defaultSleep,
  withRetry,
  type GkskRetryTarget,
  type TimelineRecorder,
  type WithRetryOptions,
} from './retry.js';
import { signEnvelope } from './signature.js';

/** Thời lượng hiệu lực mặc định của token CSYT tính bằng phút (720 phút = 12 giờ — API-CONTRACT.md §2). */
export const DEFAULT_TOKEN_DURATION_MINUTES = 720;

/** Khoảng đệm trừ lùi trước khi hết hạn token: 5 phút (API-CONTRACT.md §2: `now + duration - 5 phút`). */
export const TOKEN_EXPIRY_BUFFER_MINUTES = 5;
export const TOKEN_EXPIRY_BUFFER_MS = TOKEN_EXPIRY_BUFFER_MINUTES * 60 * 1000;

/** Giá trị header `service-type` bắt buộc khi gọi `POST /push` (API-CONTRACT.md §3). */
export const GKSK_SERVICE_TYPE_HEADER = '100';

/** Header `User-Agent` chuẩn tương thích với Postman / MasterFlow WAF. */
export const GKSK_DEFAULT_USER_AGENT = 'PostmanRuntime/7.43.0 GKSKLaiXe/1.0';

interface CachedTokenState {
  token: string;
  durationMinutes: number;
  issuedAtMs: number;
  expiresAtMs: number;
}

/** Cấu hình khởi tạo `GkskClient`. */
export interface GkskClientOptions {
  /** Base URL của Hệ thống Sở hoặc Mock Server (không cần `/` cuối, sẽ được tự động chuẩn hóa). */
  baseUrl: string;
  /** Tài khoản đăng nhập CSYT (`GKSK_USERNAME`). */
  username: string;
  /** Mật khẩu đăng nhập CSYT (`GKSK_PASSWORD`). */
  password: string;
  /** Thời gian chờ tối đa mỗi request HTTP tính bằng ms (mặc định 30000 ms). */
  httpTimeoutMs?: number;
  /** Khóa bí mật RSA PEM tùy chọn để ký lại gói tin khi gặp HTTP 409 cần sinh `msg_id` mới. */
  privateKeyPem?: string;
  /** Hàm lấy thời gian hiện tại (epoch ms), cho phép truyền đồng hồ giả trong unit test. */
  now?: () => number;
  /** Hàm chờ bất đồng bộ (ms), cho phép truyền `sleep` giả trong unit test. */
  sleep?: (ms: number) => Promise<void>;
  /** Hàm `fetch` tùy chỉnh (mặc định `globalThis.fetch`). */
  fetchImpl?: typeof fetch;
  /** Logger `pino` tùy chỉnh (mặc định dùng `logger` có redact của server). */
  logger?: Logger;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isAbortOrTimeoutError(error: unknown, signalAborted: boolean): boolean {
  if (signalAborted) {
    return true;
  }
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.name === 'TimeoutError';
  }
  return false;
}

/**
 * Client giao tiếp với Hệ thống CSDL Sức khỏe Thành Phố Đồng Nai (API-CONTRACT.md §1–§8).
 * - Quản lý đăng nhập và cache token tới `now + duration - 5 phút`.
 * - Timeout mọi request bằng `AbortController`.
 * - Parse khoan dung 3 cấu trúc phản hồi khác nhau (`login`, `push`, `status`).
 * - Kiểm tra chặt `header.ref_msg_id === msg_id`.
 * - Thực thi chính sách retry §8 (`withRetry`) và tuyệt đối không log token / mật khẩu / PII.
 */
export class GkskClient implements GkskRetryTarget {
  private baseUrl: string;
  private username: string;
  private password: string;
  private readonly httpTimeoutMs: number;
  private readonly privateKeyPem: string | undefined;
  private readonly nowFn: () => number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly fetchImpl: typeof fetch;
  private readonly log: Logger;
  private cachedToken: CachedTokenState | null = null;

  constructor(options: GkskClientOptions) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    this.username = options.username.trim();
    this.password = options.password;
    this.httpTimeoutMs = options.httpTimeoutMs ?? 30_000;
    this.privateKeyPem = options.privateKeyPem;
    this.nowFn = options.now ?? (() => Date.now());
    this.sleepFn = options.sleep ?? defaultSleep;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.log = options.logger ?? defaultLogger;
  }

  /**
   * Trả về thông tin tóm tắt cấu hình kết nối CSYT hiện tại (tuyệt đối không trả mật khẩu).
   */
  public getCredentialsSummary(): {
    baseUrl: string;
    username: string;
    hasPassword: boolean;
    passwordLength: number;
  } {
    return {
      baseUrl: this.baseUrl,
      username: this.username,
      hasPassword: this.password.length > 0,
      passwordLength: this.password.length,
    };
  }

  /**
   * Cập nhật nóng thông tin kết nối/đăng nhập CSYT trên bộ nhớ tiến trình và xóa ngay cache token cũ.
   */
  public updateCredentials(input: {
    baseUrl?: string;
    username?: string;
    password?: string;
  }): void {
    if (typeof input.baseUrl === 'string' && input.baseUrl.trim().length > 0) {
      this.baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
    }
    if (typeof input.username === 'string' && input.username.trim().length > 0) {
      this.username = input.username.trim();
    }
    if (typeof input.password === 'string' && input.password.length > 0) {
      this.password = input.password;
    }
    this.clearTokenCache();
  }

  public getNow(): number {
    return this.nowFn();
  }

  public getSleep(): (ms: number) => Promise<void> {
    return this.sleepFn;
  }

  /** Xóa token đang cache trong bộ nhớ. */
  public clearTokenCache(): void {
    this.cachedToken = null;
  }

  /**
   * Trả về thông tin thời hạn cache token hiện tại (tuyệt đối không trả chuỗi token bí mật).
   */
  public getCachedTokenMetadata(): {
    durationMinutes: number;
    issuedAtMs: number;
    expiresAtMs: number;
  } | null {
    if (!this.cachedToken) {
      return null;
    }
    return {
      durationMinutes: this.cachedToken.durationMinutes,
      issuedAtMs: this.cachedToken.issuedAtMs,
      expiresAtMs: this.cachedToken.expiresAtMs,
    };
  }

  /**
   * Sinh `msg_id` mới và ký lại gói tin khi gặp HTTP 409 (`msg_id` đã bị CSYT khác sử dụng — API-CONTRACT.md §4 & §8).
   */
  public regenerateEnvelopeOn409(envelope: GkskEnvelope): GkskEnvelope {
    const nextMsgId = newMsgId(envelope.header.sender_id, this.nowFn());
    const nextHeader = buildEnvelopeHeader({
      senderId: envelope.header.sender_id,
      msgId: nextMsgId,
      sendDatetime: envelope.header.send_datetime,
    });
    const nextSignature = signEnvelope(nextHeader, envelope.data, this.privateKeyPem);
    return {
      header: nextHeader,
      data: envelope.data,
      signature: nextSignature,
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<
    | { ok: true; response: Response; rawText: string; json: unknown }
    | { ok: false; reason: 'timeout' | 'network_error'; errorMessage: string }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.httpTimeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
      const rawText = await response.text();
      let json: unknown = null;
      if (rawText.trim().length > 0) {
        try {
          json = JSON.parse(rawText);
        } catch {
          json = null;
        }
      }
      return { ok: true, response, rawText, json };
    } catch (error) {
      const isTimeout = isAbortOrTimeoutError(error, controller.signal.aborted);
      return {
        ok: false,
        reason: isTimeout ? 'timeout' : 'network_error',
        errorMessage: isTimeout
          ? `Quá thời gian chờ phản hồi (${this.httpTimeoutMs}ms)`
          : 'Lỗi kết nối mạng tới Hệ thống Sở',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Đăng nhập lấy Bearer token từ `POST /api/auth/login` (API-CONTRACT.md §2).
   * - Cache token tới `now + duration - 5 phút`.
   * - Nếu sai tài khoản/mật khẩu hoặc phản hồi không có `data.token` → trả `kind: 'config'`, không retry.
   * - Không bao giờ đưa token hay mật khẩu vào thông điệp lỗi hoặc log.
   */
  public async login(options?: {
    forceRefresh?: boolean;
    onEvent?: TimelineRecorder;
  }): Promise<GkskLoginResult> {
    const nowMs = this.nowFn();
    if (
      !options?.forceRefresh &&
      this.cachedToken &&
      nowMs < this.cachedToken.expiresAtMs
    ) {
      options?.onEvent?.({
        action: 'login_cached',
        httpStatus: 200,
        resCode: 'CM_SUCCESS',
        detail: `Sử dụng token CSYT từ bộ nhớ đệm (còn hiệu lực tới ${this.cachedToken.expiresAtMs})`,
      });
      return {
        ok: true,
        kind: 'authenticated',
        token: this.cachedToken.token,
        durationMinutes: this.cachedToken.durationMinutes,
        expiresAtMs: this.cachedToken.expiresAtMs,
        fromCache: true,
        httpStatus: 200,
        resCode: 'CM_SUCCESS',
        resMsg: null,
      };
    }

    this.cachedToken = null;
    options?.onEvent?.({
      action: 'login_request',
      detail: `POST /api/auth/login (username=${this.username}${options?.forceRefresh ? ', forceRefresh=true' : ''})`,
    });

    const fetchOutcome = await this.fetchWithTimeout(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
        'User-Agent': GKSK_DEFAULT_USER_AGENT,
      },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
    });

    if (!fetchOutcome.ok) {
      this.log.warn(
        {
          username: this.username,
          reason: fetchOutcome.reason,
        },
        'Lỗi kết nối khi đăng nhập cổng GKSK',
      );
      options?.onEvent?.({
        action: 'login_failed',
        httpStatus: null,
        resCode: null,
        detail: `Đăng nhập thất bại do lỗi mạng (${fetchOutcome.reason}): ${fetchOutcome.errorMessage}`,
      });
      return {
        ok: false,
        kind: 'transient',
        reason: fetchOutcome.reason,
        httpStatus: null,
        resCode: null,
        resMsg: null,
        message: `Không thể kết nối đăng nhập Hệ thống Sở: ${fetchOutcome.errorMessage}`,
        retryable: true,
      };
    }

    const { response, json } = fetchOutcome;
    const rootObj = asRecord(json);
    const headerObj = asRecord(rootObj?.header);
    const dataObj = asRecord(rootObj?.data);

    const resCode =
      asNonEmptyString(headerObj?.res_code) ?? asNonEmptyString(rootObj?.code) ?? null;
    const resMsg =
      asNonEmptyString(headerObj?.res_msg) ?? asNonEmptyString(rootObj?.message) ?? null;
    const token = asNonEmptyString(dataObj?.token);

    const headerExplicitlyFailed =
      headerObj?.success === false ||
      (resCode !== null && resCode !== 'CM_SUCCESS');

    if (response.status === 200 && token && !headerExplicitlyFailed) {
      const rawDuration = dataObj?.duration;
      const durationMinutes =
        typeof rawDuration === 'number' &&
        Number.isFinite(rawDuration) &&
        rawDuration > 0
          ? rawDuration
          : DEFAULT_TOKEN_DURATION_MINUTES;

      const issuedAtMs = this.nowFn();
      const expiresAtMs =
        issuedAtMs + durationMinutes * 60 * 1000 - TOKEN_EXPIRY_BUFFER_MS;

      this.cachedToken = {
        token,
        durationMinutes,
        issuedAtMs,
        expiresAtMs,
      };

      this.log.info(
        {
          username: this.username,
          httpStatus: response.status,
          resCode: resCode ?? 'CM_SUCCESS',
          durationMinutes,
        },
        'Đăng nhập cổng GKSK thành công',
      );

      options?.onEvent?.({
        action: 'login_success',
        httpStatus: response.status,
        resCode: resCode ?? 'CM_SUCCESS',
        detail: `Đăng nhập thành công (duration=${durationMinutes} phút, cache tới now + ${durationMinutes}p - 5p)`,
      });

      return {
        ok: true,
        kind: 'authenticated',
        token,
        durationMinutes,
        expiresAtMs,
        fromCache: false,
        httpStatus: response.status,
        resCode: resCode ?? 'CM_SUCCESS',
        resMsg,
      };
    }

    // Nếu máy chủ đăng nhập gặp lỗi 5xx
    if (response.status >= 500 && response.status <= 599) {
      this.log.warn(
        {
          username: this.username,
          httpStatus: response.status,
          resCode,
        },
        'Máy chủ cổng GKSK lỗi 5xx khi đăng nhập',
      );
      options?.onEvent?.({
        action: 'login_failed',
        httpStatus: response.status,
        resCode,
        detail: `Đăng nhập thất bại HTTP ${response.status} (${resCode ?? 'HTTP_5XX'})`,
      });
      return {
        ok: false,
        kind: 'transient',
        reason: 'http_5xx',
        httpStatus: response.status,
        resCode,
        resMsg,
        message: `Máy chủ Hệ thống Sở lỗi khi đăng nhập (HTTP ${response.status})`,
        retryable: true,
      };
    }

    // Sai tài khoản/mật khẩu hoặc phản hồi không có data.token -> lỗi cấu hình, không retry (API-CONTRACT.md §2)
    this.log.error(
      {
        username: this.username,
        httpStatus: response.status,
        resCode,
        resMsg,
      },
      'Đăng nhập cổng GKSK thất bại (sai cấu hình tài khoản hoặc thiếu data.token)',
    );

    const resMsgDetail = resMsg ? ` — Phản hồi từ cổng Sở: "${resMsg}"` : '';

    options?.onEvent?.({
      action: 'login_failed',
      httpStatus: response.status,
      resCode,
      detail: `Đăng nhập thất bại HTTP ${response.status} (${resCode ?? 'NO_TOKEN'})${resMsgDetail}: sai tài khoản/mật khẩu hoặc thiếu token`,
    });

    return {
      ok: false,
      kind: 'config',
      reason: 'login_failed',
      httpStatus: response.status,
      resCode,
      resMsg,
      message: `Đăng nhập cổng GKSK thất bại (HTTP ${response.status}${resCode ? ` ${resCode}` : ''})${resMsgDetail}: vui lòng kiểm tra GKSK_USERNAME / GKSK_PASSWORD`,
      retryable: false,
    };
  }

  /**
   * Thực hiện 1 lần gọi `POST /api/platform/gksk-lai-xe/push` (không tự lặp retry).
   * Kiểm tra chặt `header.ref_msg_id === envelope.header.msg_id` và parse khoan dung `data`.
   */
  public async pushOnce(
    envelope: GkskEnvelope,
    options?: { onEvent?: TimelineRecorder },
  ): Promise<GkskPushAttemptResult> {
    const msgId = envelope.header.msg_id;
    const loginRes = await this.login({ onEvent: options?.onEvent });
    if (!loginRes.ok) {
      return loginRes.kind === 'config'
        ? {
            kind: 'config',
            reason: loginRes.reason,
            message: loginRes.message,
            msgId,
            envelope,
            httpStatus: loginRes.httpStatus,
            resCode: loginRes.resCode,
            resMsg: loginRes.resMsg,
            retryable: false,
            isAbnormal: false,
          }
        : {
            kind: 'transient',
            reason: loginRes.reason,
            message: loginRes.message,
            msgId,
            envelope,
            httpStatus: loginRes.httpStatus,
            resCode: loginRes.resCode,
            resMsg: loginRes.resMsg,
            retryable: loginRes.retryable,
            isAbnormal: false,
            retryAfterSec: null,
          };
    }

    // Giữ chính xác thứ tự 8 khóa header khi serialize body gửi đi
    const orderedHeader = buildEnvelopeHeader({
      senderId: envelope.header.sender_id,
      msgId: envelope.header.msg_id,
      sendDatetime: envelope.header.send_datetime,
    });
    const requestPayload = JSON.stringify({
      header: orderedHeader,
      data: envelope.data,
      signature: envelope.signature,
    });

    options?.onEvent?.({
      action: 'push_request',
      msgId,
      detail: `POST /api/platform/gksk-lai-xe/push (msg_id=${msgId}, send_datetime=${orderedHeader.send_datetime})`,
    });

    const fetchOutcome = await this.fetchWithTimeout(
      `${this.baseUrl}/api/platform/gksk-lai-xe/push`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${loginRes.token}`,
          'service-type': GKSK_SERVICE_TYPE_HEADER,
          'Content-Type': 'application/json',
          Accept: '*/*',
          'User-Agent': GKSK_DEFAULT_USER_AGENT,
        },
        body: requestPayload,
      },
    );

    if (!fetchOutcome.ok) {
      this.log.warn(
        {
          msgId,
          senderId: orderedHeader.sender_id,
          reason: fetchOutcome.reason,
        },
        'Lỗi kết nối khi đẩy gói tin GKSK',
      );
      options?.onEvent?.({
        action: 'push_error',
        msgId,
        httpStatus: null,
        resCode: null,
        detail: `Lỗi mạng khi push (${fetchOutcome.reason}): ${fetchOutcome.errorMessage}`,
      });
      return {
        kind: 'transient',
        reason: fetchOutcome.reason,
        message: fetchOutcome.errorMessage,
        msgId,
        envelope,
        httpStatus: null,
        resCode: null,
        resMsg: null,
        retryable: true,
        isAbnormal: false,
        retryAfterSec: null,
      };
    }

    const { response, json } = fetchOutcome;
    const rootObj = asRecord(json);
    const headerObj = asRecord(rootObj?.header);

    const resCode =
      asNonEmptyString(headerObj?.res_code) ?? asNonEmptyString(rootObj?.code) ?? null;
    const resMsg =
      asNonEmptyString(headerObj?.res_msg) ?? asNonEmptyString(rootObj?.message) ?? null;
    const refMsgId = asNonEmptyString(headerObj?.ref_msg_id);

    // Xử lý các mã lỗi HTTP khác 200 (400, 403, 409, 429, 500...)
    if (response.status !== 200) {
      const retryAfterSec =
        response.status === 429
          ? parseRetryAfterSeconds(response.headers.get('retry-after'))
          : null;

      const classified = classifyHttpFailure({
        httpStatus: response.status,
        resCode,
        resMsg,
        retryAfterSec,
      });

      this.log.warn(
        {
          msgId,
          senderId: orderedHeader.sender_id,
          httpStatus: response.status,
          resCode,
          kind: classified.kind,
          reason: classified.reason,
          ...(retryAfterSec !== null ? { retryAfterSec } : {}),
        },
        'Phản hồi lỗi HTTP khi đẩy gói tin GKSK',
      );

      options?.onEvent?.({
        action: 'push_response',
        msgId,
        httpStatus: response.status,
        resCode,
        detail: `HTTP ${response.status} (${resCode ?? classified.reason})${retryAfterSec !== null ? ` Retry-After=${retryAfterSec}s` : ''}`,
      });

      return classified.kind === 'config'
        ? {
            kind: 'config',
            reason: classified.reason,
            message: classified.message,
            msgId,
            envelope,
            httpStatus: response.status,
            resCode,
            resMsg,
            retryable: false,
            isAbnormal: false,
          }
        : {
            kind: 'transient',
            reason: classified.reason,
            message: classified.message,
            msgId,
            envelope,
            httpStatus: response.status,
            resCode,
            resMsg,
            retryable: classified.retryable,
            isAbnormal: false,
            retryAfterSec: classified.retryAfterSec,
          };
    }

    // HTTP 200: Bắt buộc kiểm tra header.ref_msg_id === msg_id đã gửi (API-CONTRACT.md §6)
    if (refMsgId !== msgId) {
      this.log.error(
        {
          msgId,
          receivedRefMsgId: refMsgId,
          httpStatus: 200,
          resCode,
        },
        'Lỗi bất thường: header.ref_msg_id không khớp với msg_id đã gửi',
      );
      options?.onEvent?.({
        action: 'push_error',
        msgId,
        httpStatus: 200,
        resCode,
        detail: `Lỗi bất thường: header.ref_msg_id ('${refMsgId ?? ''}') !== msg_id ('${msgId}')`,
      });
      return {
        kind: 'transient',
        reason: 'ref_msg_id_mismatch',
        message: `Lỗi bất thường: header.ref_msg_id trong phản hồi ('${refMsgId ?? ''}') không khớp với msg_id đã gửi ('${msgId}')`,
        msgId,
        envelope,
        httpStatus: 200,
        resCode,
        resMsg,
        retryable: false,
        isAbnormal: true,
        retryAfterSec: null,
      };
    }

    // Parse khoan dung đối tượng data (bỏ qua trường lạ, thiếu warnings/errors -> [])
    const parsedData = parseLenientPushData(rootObj?.data);
    if (!parsedData) {
      this.log.error(
        {
          msgId,
          httpStatus: 200,
          resCode,
        },
        'Lỗi bất thường: phản hồi push HTTP 200 không có data.status hợp lệ',
      );
      options?.onEvent?.({
        action: 'push_error',
        msgId,
        httpStatus: 200,
        resCode,
        detail: 'Lỗi bất thường: phản hồi HTTP 200 thiếu data.status (accepted/rejected)',
      });
      return {
        kind: 'transient',
        reason: 'invalid_response',
        message:
          'Lỗi bất thường: phản hồi HTTP 200 từ Hệ thống Sở không có trường data.status hợp lệ',
        msgId,
        envelope,
        httpStatus: 200,
        resCode,
        resMsg,
        retryable: false,
        isAbnormal: true,
        retryAfterSec: null,
      };
    }

    const effectiveResCode = resCode ?? 'PS_SYNC_SUCCESS';
    this.log.info(
      {
        msgId,
        senderId: orderedHeader.sender_id,
        httpStatus: 200,
        resCode: effectiveResCode,
        resultStatus: parsedData.status,
        submissionId: parsedData.submission_id,
        certificateId: parsedData.certificate_id,
        errorCodes: parsedData.errors.map((e) => e.code),
        warningCodes: parsedData.warnings.map((w) => w.code),
      },
      'Nhận phản hồi xử lý gói tin GKSK từ Hệ thống Sở',
    );

    options?.onEvent?.({
      action: 'push_response',
      msgId,
      httpStatus: 200,
      resCode: effectiveResCode,
      detail: `HTTP 200 (${effectiveResCode}) -> data.status=${parsedData.status} (errors=${parsedData.errors.length}, warnings=${parsedData.warnings.length})`,
    });

    const baseSuccess = {
      msgId,
      envelope,
      httpStatus: 200,
      resCode: effectiveResCode,
      resMsg,
      submissionId: parsedData.submission_id,
      certificateId: parsedData.certificate_id,
      so: parsedData.so,
      errors: parsedData.errors,
      warnings: parsedData.warnings,
      data: parsedData,
    };

    return parsedData.status === 'accepted'
      ? { ...baseSuccess, kind: 'accepted', status: 'accepted' }
      : { ...baseSuccess, kind: 'rejected', status: 'rejected' };
  }

  /**
   * Đẩy gói tin GKSK lên Hệ thống Sở kèm chính sách retry đầy đủ theo API-CONTRACT.md §8.
   */
  public async push(
    envelope: GkskEnvelope,
    options?: WithRetryOptions,
  ): Promise<GkskSendResult> {
    return withRetry(this, envelope, options);
  }

  /**
   * Tra cứu trạng thái xử lý gói tin theo `msg_id`:
   * `GET /api/platform/gksk-lai-xe/status?msg_id=<msg_id>` (API-CONTRACT.md §7).
   * Phản hồi của endpoint này có dạng `{ code, message, data }` (không có `header`).
   */
  public async status(
    msgId: string,
    options?: { onEvent?: TimelineRecorder; skipReloginOn403?: boolean },
  ): Promise<GkskStatusResult> {
    const cleanMsgId = msgId.trim();
    const loginRes = await this.login({ onEvent: options?.onEvent });
    if (!loginRes.ok) {
      return {
        kind: loginRes.kind,
        found: false,
        reason: loginRes.reason,
        httpStatus: loginRes.httpStatus,
        resCode: loginRes.resCode,
        resMsg: loginRes.resMsg,
        message: loginRes.message,
        retryable: loginRes.retryable,
      };
    }

    options?.onEvent?.({
      action: 'status_request',
      msgId: cleanMsgId,
      detail: `GET /api/platform/gksk-lai-xe/status?msg_id=${cleanMsgId}`,
    });

    const url = `${this.baseUrl}/api/platform/gksk-lai-xe/status?msg_id=${encodeURIComponent(cleanMsgId)}`;
    const fetchOutcome = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${loginRes.token}`,
        Accept: '*/*',
        'User-Agent': GKSK_DEFAULT_USER_AGENT,
      },
    });

    if (!fetchOutcome.ok) {
      this.log.warn(
        {
          msgId: cleanMsgId,
          reason: fetchOutcome.reason,
        },
        'Lỗi kết nối khi tra cứu status gói tin GKSK',
      );
      options?.onEvent?.({
        action: 'status_error',
        msgId: cleanMsgId,
        httpStatus: null,
        resCode: null,
        detail: `Lỗi mạng khi gọi status (${fetchOutcome.reason}): ${fetchOutcome.errorMessage}`,
      });
      return {
        kind: 'transient',
        found: false,
        reason: fetchOutcome.reason,
        httpStatus: null,
        resCode: null,
        resMsg: null,
        message: fetchOutcome.errorMessage,
        retryable: true,
      };
    }

    const { response, json } = fetchOutcome;
    const rootObj = asRecord(json);
    const headerObj = asRecord(rootObj?.header);

    // Phản hồi status theo §7 dùng { code, message, data } (không có header), nhưng vẫn hỗ trợ khoan dung nếu có header
    const resCode =
      asNonEmptyString(rootObj?.code) ?? asNonEmptyString(headerObj?.res_code) ?? null;
    const resMsg =
      asNonEmptyString(rootObj?.message) ?? asNonEmptyString(headerObj?.res_msg) ?? null;

    if (response.status === 404) {
      this.log.info(
        {
          msgId: cleanMsgId,
          httpStatus: 404,
          resCode,
        },
        'Tra cứu status: Hệ thống Sở chưa ghi nhận gói tin (HTTP 404)',
      );
      options?.onEvent?.({
        action: 'status_response',
        msgId: cleanMsgId,
        httpStatus: 404,
        resCode,
        detail: `HTTP 404 (${resCode ?? 'CM_INVALID_REQUEST'}): không tìm thấy gói tin -> cần push lại cùng msg_id`,
      });
      return {
        kind: 'not_found',
        found: false,
        httpStatus: 404,
        resCode,
        resMsg,
      };
    }

    // Nếu gọi status gặp 403 và chưa tắt tự động relogin -> đăng nhập lại đúng 1 lần
    if (response.status === 403 && !options?.skipReloginOn403) {
      options?.onEvent?.({
        action: 'relogin_on_403',
        msgId: cleanMsgId,
        httpStatus: 403,
        resCode,
        detail: 'Gặp HTTP 403 khi gọi status -> đăng nhập lại đúng 1 lần',
      });
      const reloginRes = await this.login({
        forceRefresh: true,
        onEvent: options?.onEvent,
      });
      if (!reloginRes.ok) {
        return {
          kind: reloginRes.kind,
          found: false,
          reason: reloginRes.reason,
          httpStatus: reloginRes.httpStatus,
          resCode: reloginRes.resCode,
          resMsg: reloginRes.resMsg,
          message: reloginRes.message,
          retryable: reloginRes.retryable,
        };
      }
      return this.status(cleanMsgId, {
        ...options,
        skipReloginOn403: true,
      });
    }

    if (response.status === 200) {
      const parsedData = parseLenientPushData(rootObj?.data);
      if (!parsedData) {
        options?.onEvent?.({
          action: 'status_error',
          msgId: cleanMsgId,
          httpStatus: 200,
          resCode,
          detail: 'Phản hồi status HTTP 200 không có trường data.status hợp lệ',
        });
        return {
          kind: 'transient',
          found: false,
          reason: 'invalid_response',
          httpStatus: 200,
          resCode,
          resMsg,
          message: 'Phản hồi tra cứu status HTTP 200 không có trường data.status hợp lệ',
          retryable: false,
        };
      }

      const effectiveResCode = resCode ?? 'CM_SUCCESS';
      this.log.info(
        {
          msgId: cleanMsgId,
          httpStatus: 200,
          resCode: effectiveResCode,
          resultStatus: parsedData.status,
          submissionId: parsedData.submission_id,
          certificateId: parsedData.certificate_id,
        },
        'Tra cứu status gói tin GKSK thành công (HTTP 200)',
      );
      options?.onEvent?.({
        action: 'status_response',
        msgId: cleanMsgId,
        httpStatus: 200,
        resCode: effectiveResCode,
        detail: `HTTP 200 (${effectiveResCode}) -> tìm thấy kết quả đã xử lý (data.status=${parsedData.status})`,
      });

      return {
        kind: parsedData.status,
        found: true,
        httpStatus: 200,
        resCode: effectiveResCode,
        resMsg,
        status: parsedData.status,
        submissionId: parsedData.submission_id,
        certificateId: parsedData.certificate_id,
        so: parsedData.so,
        errors: parsedData.errors,
        warnings: parsedData.warnings,
        data: parsedData,
      };
    }

    const classified = classifyHttpFailure({
      httpStatus: response.status,
      resCode,
      resMsg,
    });
    options?.onEvent?.({
      action: 'status_response',
      msgId: cleanMsgId,
      httpStatus: response.status,
      resCode,
      detail: `HTTP ${response.status} (${resCode ?? classified.reason})`,
    });
    return {
      kind: classified.kind,
      found: false,
      reason: classified.reason,
      httpStatus: response.status,
      resCode,
      resMsg,
      message: classified.message,
      retryable: classified.retryable,
    };
  }
}

/** Factory khởi tạo `GkskClient`. */
export function createGkskClient(options: GkskClientOptions): GkskClient {
  return new GkskClient(options);
}
