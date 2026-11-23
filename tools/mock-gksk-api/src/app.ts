import crypto from 'node:crypto';
import express, { type Express, type Request, type Response } from 'express';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  FIELD_BY_TAG,
  FIELD_ORDER,
  FIELDS,
  SO_SERVER_MAX_LENGTH,
  type FieldTag,
} from '@gksk/shared';

/** Giới hạn kích thước tối đa của payload XML sau khi giải mã Base64 (1 MB — API-CONTRACT.md §3 & §9). */
export const MOCK_MAX_DECODED_BYTES = 1024 * 1024;

export type MockAccountRole = 'csyt' | 'school';

export interface MockAccount {
  username: string;
  password: string;
  facilityId: string;
  role: MockAccountRole;
}

export type MockFailMode =
  | 'timeout'
  | '500'
  | '429'
  | '403-once'
  | '403'
  | '400'
  | '409'
  | 'disconnect-after-save'
  | 'mismatched-ref-msg-id'
  | 'sparse-response';

export interface MockFailConfig {
  mode: MockFailMode;
  count: number;
  retryAfterSec: number;
  timeoutMs: number;
}

export interface MockIssueItem {
  code: string;
  field: string | null;
}

export interface MockPushData {
  status: 'accepted' | 'rejected';
  submission_id: string;
  certificate_id: string | null;
  so: string | null;
  errors: MockIssueItem[];
  warnings: MockIssueItem[];
}

export interface MockStoredSubmission {
  msgId: string;
  facilityId: string;
  senderId: string;
  sendDatetime: number;
  createdAtMs: number;
  responseData: MockPushData;
}

export interface MockStoredCertificate {
  certificateId: string;
  facilityId: string;
  so: string;
  fields: Record<string, string>;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface MockRequestLogEntry {
  method: string;
  path: string;
  timestampMs: number;
  msgId?: string;
  senderId?: string;
  httpStatus?: number;
  note?: string;
}

export interface MockGkskAppOptions {
  /** Danh sách tài khoản cho phép đăng nhập (mặc định có 75001, 75002 và SCHOOL01). */
  accounts?: MockAccount[];
  /** Bật kiểm tra chữ ký RSA thật (tương đương biến môi trường MOCK_VERIFY_SIGNATURE=1). */
  verifySignature?: boolean;
  /** Khóa công khai PEM dùng để verify chữ ký khi bật verifySignature. */
  publicKeyPem?: string;
  /** Thời gian chờ mặc định (ms) khi giả lập lỗi timeout (mặc định 1500 ms). */
  defaultTimeoutMs?: number;
  /** Năm hiện tại dùng để kiểm tra giới hạn năm sinh 1900..currentYear (mặc định tính theo UTC+7). */
  currentYear?: number;
}

interface TokenSession {
  token: string;
  refreshToken: string;
  username: string;
  facilityId: string;
  role: MockAccountRole;
  issuedAtMs: number;
}

interface EnvelopeHeaderInput {
  version: string;
  sender_id: string;
  receiver_id: string;
  txn_type: string;
  msg_id: string;
  msg_type: string;
  data_type: string;
  send_datetime: number;
}

const SENDER_ID_REGEX = /^[A-Za-z0-9._-]+$/;
const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

const xmlParser = new XMLParser({
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreAttributes: false,
  trimValues: false,
});

function getVnCurrentYear(): number {
  const vnTime = new Date(Date.now() + 7 * 3600 * 1000);
  return vnTime.getUTCFullYear();
}

function buildServerMsgId(nowMs: number = Date.now()): string {
  const vnIso = new Date(nowMs + 7 * 3600 * 1000).toISOString();
  const yymmdd = vnIso.slice(2, 4) + vnIso.slice(5, 7) + vnIso.slice(8, 10);
  const uuidSansDash = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  return `TTYQG${yymmdd}${uuidSansDash}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function parseDdMmYyyy(value: string): { valid: boolean; year: number } {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) {
    return { valid: false, year: 0 };
  }
  const day = Number.parseInt(match[1] ?? '0', 10);
  const month = Number.parseInt(match[2] ?? '0', 10);
  const year = Number.parseInt(match[3] ?? '0', 10);
  if (month < 1 || month > 12) {
    return { valid: false, year };
  }
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) {
    return { valid: false, year };
  }
  return { valid: true, year };
}

function sha256HexUpper(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').toUpperCase();
}

function verifyRsaEnvelopeSignature(
  header: EnvelopeHeaderInput,
  data: string,
  signature: string,
  publicKeyPem: string,
): boolean {
  const orderedHeader: EnvelopeHeaderInput = {
    version: header.version,
    sender_id: header.sender_id,
    receiver_id: header.receiver_id,
    txn_type: header.txn_type,
    msg_id: header.msg_id,
    msg_type: header.msg_type,
    data_type: header.data_type,
    send_datetime: header.send_datetime,
  };
  const headerJson = JSON.stringify(orderedHeader);
  const headerHash = sha256HexUpper(headerJson);
  const dataHash = sha256HexUpper(data.trim());
  const signedPayload = `${headerHash}.${dataHash}`;

  try {
    return crypto.verify(
      'sha256',
      Buffer.from(signedPayload, 'utf8'),
      publicKeyPem,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

function buildEnvelopeResponse(params: {
  receiverId: string;
  refMsgId: string;
  resCode: string;
  resMsg: string;
  data: unknown;
  signature?: string;
}) {
  const nowMs = Date.now();
  return {
    header: {
      version: '1.0.6',
      sender_id: 'TTYQG',
      receiver_id: params.receiverId,
      txn_type: 'sync_gksk_lai_xe',
      res_code: params.resCode,
      res_msg: params.resMsg,
      msg_id: buildServerMsgId(nowMs),
      msg_type: '102',
      ref_msg_id: params.refMsgId,
      send_datetime: nowMs,
      res_datetime: nowMs,
    },
    data: params.data,
    signature: params.signature ?? 'MOCK-TTYQG-SIGNATURE',
  };
}

function buildDefaultAccounts(): MockAccount[] {
  const envUser = (process.env.MOCK_USERNAME ?? process.env.GKSK_USERNAME ?? '75001').trim();
  const envPass = process.env.MOCK_PASSWORD ?? process.env.GKSK_PASSWORD ?? 'mock';
  const envFacility = (process.env.GKSK_FACILITY_ID ?? envUser).trim();

  const accountsMap = new Map<string, MockAccount>();
  accountsMap.set('75001', {
    username: '75001',
    password: 'mock',
    facilityId: '75001',
    role: 'csyt',
  });
  accountsMap.set('75002', {
    username: '75002',
    password: 'mock',
    facilityId: '75002',
    role: 'csyt',
  });
  accountsMap.set('SCHOOL01', {
    username: 'SCHOOL01',
    password: 'mock',
    facilityId: 'SCHOOL01',
    role: 'school',
  });

  if (envUser.length > 0) {
    accountsMap.set(envUser, {
      username: envUser,
      password: envPass,
      facilityId: envFacility,
      role: 'csyt',
    });
  }

  return Array.from(accountsMap.values());
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.header('authorization') ?? req.header('Authorization');
  if (!authHeader) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match?.[1]?.trim() ?? null;
}

function unicodeLength(value: string): number {
  return [...value.normalize('NFC')].length;
}

/**
 * Khởi tạo ứng dụng Express đóng vai trò Mock GKSK API (Hệ thống Sở Y tế Đồng Nai giả lập).
 * Tuân thủ nghiêm ngặt docs/API-CONTRACT.md §1–§12 và độc lập hoàn toàn với server/.
 */
export function createMockGkskApp(options: MockGkskAppOptions = {}): Express {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const accounts = new Map<string, MockAccount>();
  for (const acc of options.accounts ?? buildDefaultAccounts()) {
    accounts.set(acc.username, acc);
  }

  const verifySignature =
    options.verifySignature ?? process.env.MOCK_VERIFY_SIGNATURE === '1';
  const publicKeyPem = options.publicKeyPem ?? process.env.MOCK_PUBLIC_KEY_PEM ?? '';
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 1500;
  const currentYear = options.currentYear ?? getVnCurrentYear();

  const tokens = new Map<string, TokenSession>();
  const submissionsByMsgId = new Map<string, MockStoredSubmission>();
  const certificatesByKey = new Map<string, MockStoredCertificate>();
  const requestLog: MockRequestLogEntry[] = [];
  let activeFail: MockFailConfig | null = null;

  function recordRequest(entry: MockRequestLogEntry): void {
    requestLog.push(entry);
  }

  function consumeFailMode(req: Request): MockFailConfig | null {
    const headerFail = req.header('x-mock-fail')?.trim() as MockFailMode | undefined;
    if (headerFail) {
      const headerRetryAfter = Number.parseInt(req.header('x-mock-retry-after') ?? '2', 10);
      const headerTimeout = Number.parseInt(
        req.header('x-mock-timeout-ms') ?? String(defaultTimeoutMs),
        10,
      );
      return {
        mode: headerFail,
        count: 1,
        retryAfterSec: Number.isFinite(headerRetryAfter) ? headerRetryAfter : 2,
        timeoutMs: Number.isFinite(headerTimeout) ? headerTimeout : defaultTimeoutMs,
      };
    }

    if (activeFail && activeFail.count > 0) {
      const current: MockFailConfig = { ...activeFail };
      activeFail.count -= 1;
      if (activeFail.count <= 0) {
        activeFail = null;
      }
      return current;
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Endpoints quản trị Mock (/__mock/*) phục vụ test tự động S6, S7, S9, S17
  // ---------------------------------------------------------------------------

  app.post('/__mock/fail', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      mode?: MockFailMode | null;
      count?: number;
      retryAfterSec?: number;
      timeoutMs?: number;
    };

    if (!body.mode) {
      activeFail = null;
      res.status(200).json({ ok: true, activeFail: null });
      return;
    }

    const count =
      typeof body.count === 'number' && Number.isFinite(body.count) && body.count >= 0
        ? Math.floor(body.count)
        : 1;
    const retryAfterSec =
      typeof body.retryAfterSec === 'number' &&
      Number.isFinite(body.retryAfterSec) &&
      body.retryAfterSec > 0
        ? Math.floor(body.retryAfterSec)
        : 2;
    const timeoutMs =
      typeof body.timeoutMs === 'number' &&
      Number.isFinite(body.timeoutMs) &&
      body.timeoutMs > 0
        ? Math.floor(body.timeoutMs)
        : defaultTimeoutMs;

    activeFail =
      count > 0
        ? {
            mode: body.mode,
            count,
            retryAfterSec,
            timeoutMs,
          }
        : null;

    res.status(200).json({ ok: true, activeFail });
  });

  app.post('/__mock/reset', (_req: Request, res: Response) => {
    tokens.clear();
    submissionsByMsgId.clear();
    certificatesByKey.clear();
    requestLog.length = 0;
    activeFail = null;
    res.status(200).json({ ok: true });
  });

  app.get('/__mock/state', (_req: Request, res: Response) => {
    res.status(200).json({
      activeFail,
      tokenCount: tokens.size,
      submissionCount: submissionsByMsgId.size,
      certificateCount: certificatesByKey.size,
      submissions: Array.from(submissionsByMsgId.values()),
      certificates: Array.from(certificatesByKey.values()),
      requests: requestLog,
    });
  });

  // ---------------------------------------------------------------------------
  // 1. POST /api/auth/login (API-CONTRACT.md §2)
  // ---------------------------------------------------------------------------

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    const account = accounts.get(username);
    if (!account || account.password !== password) {
      recordRequest({
        method: 'POST',
        path: '/api/auth/login',
        timestampMs: Date.now(),
        senderId: username,
        httpStatus: 401,
        note: 'login_failed',
      });
      res.status(401).json({
        header: {
          version: '1.0.6',
          success: false,
          res_code: 'CM_PERMISSION_DENY',
          res_msg: 'Sai tên đăng nhập hoặc mật khẩu',
        },
        data: null,
      });
      return;
    }

    const token = `mock-token-${account.username}-${crypto.randomUUID()}`;
    const refreshToken = `mock-refresh-${account.username}-${crypto.randomUUID()}`;
    tokens.set(token, {
      token,
      refreshToken,
      username: account.username,
      facilityId: account.facilityId,
      role: account.role,
      issuedAtMs: Date.now(),
    });

    recordRequest({
      method: 'POST',
      path: '/api/auth/login',
      timestampMs: Date.now(),
      senderId: account.username,
      httpStatus: 200,
      note: 'login_success',
    });

    res.status(200).json({
      header: {
        version: '1.0.6',
        success: true,
        res_code: 'CM_SUCCESS',
        res_msg: 'Đăng nhập thành công',
      },
      data: {
        token,
        refresh_token: refreshToken,
        duration: 720,
        refresh_duration: 1440,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // 2. POST /api/platform/gksk-lai-xe/push (API-CONTRACT.md §3–§6, §8–§10)
  // ---------------------------------------------------------------------------

  app.post('/api/platform/gksk-lai-xe/push', (req: Request, res: Response) => {
    const rawBody = (req.body ?? {}) as {
      header?: Record<string, unknown>;
      data?: unknown;
      signature?: unknown;
    };
    const rawHeader = (rawBody.header ?? {}) as Record<string, unknown>;
    const reqSenderId =
      typeof rawHeader.sender_id === 'string' ? rawHeader.sender_id.trim() : '';
    const reqMsgId = typeof rawHeader.msg_id === 'string' ? rawHeader.msg_id.trim() : '';

    // 2.1 Kiểm tra chế độ giả lập lỗi (/__mock/fail hoặc x-mock-fail)
    const failEffect = consumeFailMode(req);
    if (failEffect) {
      if (failEffect.mode === 'timeout') {
        recordRequest({
          method: 'POST',
          path: '/api/platform/gksk-lai-xe/push',
          timestampMs: Date.now(),
          msgId: reqMsgId,
          senderId: reqSenderId,
          note: `mock_fail_timeout_${failEffect.timeoutMs}ms`,
        });
        const timer = setTimeout(() => {
          if (!res.headersSent) {
            res.socket?.destroy();
          }
        }, failEffect.timeoutMs);
        req.on('close', () => clearTimeout(timer));
        return;
      }

      if (failEffect.mode === '500') {
        recordRequest({
          method: 'POST',
          path: '/api/platform/gksk-lai-xe/push',
          timestampMs: Date.now(),
          msgId: reqMsgId,
          senderId: reqSenderId,
          httpStatus: 500,
          note: 'mock_fail_500',
        });
        res.status(500).json(
          buildEnvelopeResponse({
            receiverId: reqSenderId || 'UNKNOWN',
            refMsgId: reqMsgId,
            resCode: 'PS_DS_SAVE_FAIL',
            resMsg: 'Lỗi lưu dữ liệu phía hệ thống (mock 500)',
            data: null,
            signature: '',
          }),
        );
        return;
      }

      if (failEffect.mode === '429') {
        recordRequest({
          method: 'POST',
          path: '/api/platform/gksk-lai-xe/push',
          timestampMs: Date.now(),
          msgId: reqMsgId,
          senderId: reqSenderId,
          httpStatus: 429,
          note: `mock_fail_429_retry_after_${failEffect.retryAfterSec}`,
        });
        res
          .status(429)
          .set('Retry-After', String(failEffect.retryAfterSec))
          .json(
            buildEnvelopeResponse({
              receiverId: reqSenderId || 'UNKNOWN',
              refMsgId: reqMsgId,
              resCode: 'CM_TOO_MANY_REQUESTS',
              resMsg: 'Vượt quá giới hạn 300 gói/phút/CSYT (mock 429)',
              data: null,
              signature: '',
            }),
          );
        return;
      }

      if (failEffect.mode === '403-once' || failEffect.mode === '403') {
        recordRequest({
          method: 'POST',
          path: '/api/platform/gksk-lai-xe/push',
          timestampMs: Date.now(),
          msgId: reqMsgId,
          senderId: reqSenderId,
          httpStatus: 403,
          note: `mock_fail_${failEffect.mode}`,
        });
        res.status(403).json(
          buildEnvelopeResponse({
            receiverId: reqSenderId || 'UNKNOWN',
            refMsgId: reqMsgId,
            resCode: 'CM_PERMISSION_DENY',
            resMsg: 'Token hết hạn hoặc không hợp lệ (mock 403)',
            data: null,
            signature: '',
          }),
        );
        return;
      }

      if (failEffect.mode === '400') {
        recordRequest({
          method: 'POST',
          path: '/api/platform/gksk-lai-xe/push',
          timestampMs: Date.now(),
          msgId: reqMsgId,
          senderId: reqSenderId,
          httpStatus: 400,
          note: 'mock_fail_400',
        });
        res.status(400).json(
          buildEnvelopeResponse({
            receiverId: reqSenderId || 'UNKNOWN',
            refMsgId: reqMsgId,
            resCode: 'CM_INVALID_REQUEST',
            resMsg: 'Envelope không hợp lệ (mock 400)',
            data: null,
            signature: '',
          }),
        );
        return;
      }

      if (failEffect.mode === '409') {
        recordRequest({
          method: 'POST',
          path: '/api/platform/gksk-lai-xe/push',
          timestampMs: Date.now(),
          msgId: reqMsgId,
          senderId: reqSenderId,
          httpStatus: 409,
          note: 'mock_fail_409',
        });
        res.status(409).json(
          buildEnvelopeResponse({
            receiverId: reqSenderId || 'UNKNOWN',
            refMsgId: reqMsgId,
            resCode: 'CM_INVALID_REQUEST',
            resMsg: 'msg_id đã được CSYT khác sử dụng (mock 409)',
            data: null,
            signature: '',
          }),
        );
        return;
      }
    }

    // 2.2 Kiểm tra HTTP header `service-type: 100` (API-CONTRACT.md §3 & §8)
    const serviceType = req.header('service-type');
    if (serviceType !== '100') {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId: reqMsgId,
        senderId: reqSenderId,
        httpStatus: 400,
        note: 'missing_or_invalid_service_type',
      });
      res.status(400).json(
        buildEnvelopeResponse({
          receiverId: reqSenderId || 'UNKNOWN',
          refMsgId: reqMsgId,
          resCode: 'CM_INVALID_REQUEST',
          resMsg: `Thiếu hoặc sai HTTP header service-type: nhận '${serviceType ?? ''}', yêu cầu '100'`,
          data: null,
          signature: '',
        }),
      );
      return;
    }

    // 2.3 Kiểm tra Authorization Bearer token (API-CONTRACT.md §3 & §8)
    const bearerToken = extractBearerToken(req);
    const session = bearerToken ? tokens.get(bearerToken) : undefined;
    if (!session || session.role !== 'csyt') {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId: reqMsgId,
        senderId: reqSenderId,
        httpStatus: 403,
        note: !session ? 'invalid_token' : 'non_csyt_role',
      });
      res.status(403).json(
        buildEnvelopeResponse({
          receiverId: reqSenderId || 'UNKNOWN',
          refMsgId: reqMsgId,
          resCode: 'CM_PERMISSION_DENY',
          resMsg: !session
            ? 'Token không hợp lệ hoặc đã hết hạn'
            : 'Tài khoản không thuộc cơ sở y tế (CSYT)',
          data: null,
          signature: '',
        }),
      );
      return;
    }

    // 2.4 Kiểm tra cấu trúc envelope & chữ ký (API-CONTRACT.md §3, §4, §5, §8)
    if (
      !rawBody.header ||
      typeof rawBody.header !== 'object' ||
      Array.isArray(rawBody.header)
    ) {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        httpStatus: 400,
        note: 'missing_header_object',
      });
      res.status(400).json(
        buildEnvelopeResponse({
          receiverId: session.facilityId,
          refMsgId: '',
          resCode: 'CM_INVALID_REQUEST',
          resMsg: 'Thiếu đối tượng header trong envelope',
          data: null,
          signature: '',
        }),
      );
      return;
    }

    const version = typeof rawHeader.version === 'string' ? rawHeader.version : '';
    const senderId = typeof rawHeader.sender_id === 'string' ? rawHeader.sender_id : '';
    const receiverId = typeof rawHeader.receiver_id === 'string' ? rawHeader.receiver_id : '';
    const txnType = typeof rawHeader.txn_type === 'string' ? rawHeader.txn_type : '';
    const msgId = typeof rawHeader.msg_id === 'string' ? rawHeader.msg_id : '';
    const msgType = typeof rawHeader.msg_type === 'string' ? rawHeader.msg_type : '';
    const dataType = typeof rawHeader.data_type === 'string' ? rawHeader.data_type : '';
    const sendDatetime = rawHeader.send_datetime;

    if (version !== '1.0' && version !== '1.0.6') {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId,
        senderId,
        httpStatus: 400,
        note: 'invalid_version',
      });
      res.status(400).json(
        buildEnvelopeResponse({
          receiverId: senderId || session.facilityId,
          refMsgId: msgId,
          resCode: 'CM_INVALID_REQUEST',
          resMsg: `Trường header.version không hợp lệ: nhận '${version}', yêu cầu '1.0' hoặc '1.0.6'`,
          data: null,
          signature: '',
        }),
      );
      return;
    }

    if (!senderId || !SENDER_ID_REGEX.test(senderId)) {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId,
        senderId,
        httpStatus: 400,
        note: 'invalid_sender_id_format',
      });
      res.status(400).json(
        buildEnvelopeResponse({
          receiverId: session.facilityId,
          refMsgId: msgId,
          resCode: 'CM_INVALID_REQUEST',
          resMsg: `Trường header.sender_id không hợp lệ: '${senderId}'`,
          data: null,
          signature: '',
        }),
      );
      return;
    }

    if (senderId !== session.facilityId) {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId,
        senderId,
        httpStatus: 403,
        note: 'sender_id_facility_mismatch',
      });
      res.status(403).json(
        buildEnvelopeResponse({
          receiverId: senderId,
          refMsgId: msgId,
          resCode: 'CM_PERMISSION_DENY',
          resMsg: `header.sender_id ('${senderId}') không khớp với mã CSYT của token ('${session.facilityId}')`,
          data: null,
          signature: '',
        }),
      );
      return;
    }

    if (receiverId !== 'TTYQG') {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId,
        senderId,
        httpStatus: 400,
        note: 'invalid_receiver_id',
      });
      res.status(400).json(
        buildEnvelopeResponse({
          receiverId: senderId,
          refMsgId: msgId,
          resCode: 'CM_INVALID_REQUEST',
          resMsg: `Trường header.receiver_id không hợp lệ: nhận '${receiverId}', yêu cầu 'TTYQG'`,
          data: null,
          signature: '',
        }),
      );
      return;
    }

    if (txnType !== 'sync_gksk_lai_xe') {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId,
        senderId,
        httpStatus: 400,
        note: 'invalid_txn_type',
      });
      res.status(400).json(
        buildEnvelopeResponse({
          receiverId: senderId,
          refMsgId: msgId,
          resCode: 'CM_INVALID_REQUEST',
          resMsg: `Trường header.txn_type không hợp lệ: nhận '${txnType}', yêu cầu 'sync_gksk_lai_xe'`,
          data: null,
          signature: '',
        }),
      );
      return;
    }

    if (msgType !== '101') {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId,
        senderId,
        httpStatus: 400,
        note: 'invalid_msg_type',
      });
      res.status(400).json(
        buildEnvelopeResponse({
          receiverId: senderId,
          refMsgId: msgId,
          resCode: 'CM_INVALID_REQUEST',
          resMsg: `Trường header.msg_type không hợp lệ: nhận '${msgType}', yêu cầu '101'`,
          data: null,
          signature: '',
        }),
      );
      return;
    }

    if (dataType !== 'xml/base64' && dataType !== 'json/base64') {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId,
        senderId,
        httpStatus: 400,
        note: 'invalid_data_type',
      });
      res.status(400).json(
        buildEnvelopeResponse({
          receiverId: senderId,
          refMsgId: msgId,
          resCode: 'CM_INVALID_REQUEST',
          resMsg: `Trường header.data_type không hợp lệ: nhận '${dataType}', yêu cầu 'xml/base64' hoặc 'json/base64'`,
          data: null,
          signature: '',
        }),
      );
      return;
    }

    if (
      typeof sendDatetime !== 'number' ||
      !Number.isFinite(sendDatetime) ||
      sendDatetime <= 0
    ) {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId,
        senderId,
        httpStatus: 400,
        note: 'invalid_send_datetime',
      });
      res.status(400).json(
        buildEnvelopeResponse({
          receiverId: senderId,
          refMsgId: msgId,
          resCode: 'CM_INVALID_REQUEST',
          resMsg: 'Trường header.send_datetime phải là số nguyên dương (epoch milliseconds)',
          data: null,
          signature: '',
        }),
      );
      return;
    }

    // Kiểm tra xung đột msg_id giữa các CSYT khác nhau trước (HTTP 409 — API-CONTRACT.md §4 & §8)
    const existingSubmission = submissionsByMsgId.get(msgId);
    if (existingSubmission && existingSubmission.facilityId !== session.facilityId) {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId,
        senderId,
        httpStatus: 409,
        note: 'msg_id_conflict_other_csyt',
      });
      res.status(409).json(
        buildEnvelopeResponse({
          receiverId: senderId,
          refMsgId: msgId,
          resCode: 'CM_INVALID_REQUEST',
          resMsg: `msg_id '${msgId}' đã được sử dụng bởi CSYT khác`,
          data: null,
          signature: '',
        }),
      );
      return;
    }

    // Kiểm tra định dạng msg_id: ^<sender_id>\d{6}[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$
    const msgIdSuffix = msgId.startsWith(senderId) ? msgId.slice(senderId.length) : '';
    const msgIdSuffixRegex = /^\d{6}[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/i;
    if (!msgId.startsWith(senderId) || !msgIdSuffixRegex.test(msgIdSuffix)) {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId,
        senderId,
        httpStatus: 400,
        note: 'invalid_msg_id_format',
      });
      res.status(400).json(
        buildEnvelopeResponse({
          receiverId: senderId,
          refMsgId: msgId,
          resCode: 'CM_INVALID_REQUEST',
          resMsg: `Trường header.msg_id không đúng định dạng <sender_id> + YYMMDD + UUIDv4: '${msgId}'`,
          data: null,
          signature: '',
        }),
      );
      return;
    }

    // Kiểm tra chữ ký gói tin (API-CONTRACT.md §5 & §8)
    const signature = typeof rawBody.signature === 'string' ? rawBody.signature.trim() : '';
    if (signature.length === 0) {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId,
        senderId,
        httpStatus: 400,
        note: 'missing_signature',
      });
      res.status(400).json(
        buildEnvelopeResponse({
          receiverId: senderId,
          refMsgId: msgId,
          resCode: 'PS_DS_RSA_SIGNATURE_MISSING',
          resMsg: 'Thiếu chữ ký gói tin (signature rỗng)',
          data: null,
          signature: '',
        }),
      );
      return;
    }

    // Kiểm tra trường data Base64
    const rawData = typeof rawBody.data === 'string' ? rawBody.data.trim() : '';
    if (
      rawData.length === 0 ||
      rawData.length % 4 !== 0 ||
      !BASE64_REGEX.test(rawData)
    ) {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId,
        senderId,
        httpStatus: 400,
        note: 'invalid_base64_data',
      });
      res.status(400).json(
        buildEnvelopeResponse({
          receiverId: senderId,
          refMsgId: msgId,
          resCode: 'CM_INVALID_REQUEST',
          resMsg: 'Trường data không phải chuỗi Base64 hợp lệ',
          data: null,
          signature: '',
        }),
      );
      return;
    }

    // Kiểm tra chữ ký RSA thật nếu bật MOCK_VERIFY_SIGNATURE=1
    if (verifySignature) {
      const headerForVerify: EnvelopeHeaderInput = {
        version,
        sender_id: senderId,
        receiver_id: receiverId,
        txn_type: txnType,
        msg_id: msgId,
        msg_type: msgType,
        data_type: dataType,
        send_datetime: sendDatetime,
      };
      if (
        !publicKeyPem ||
        !verifyRsaEnvelopeSignature(headerForVerify, rawData, signature, publicKeyPem)
      ) {
        recordRequest({
          method: 'POST',
          path: '/api/platform/gksk-lai-xe/push',
          timestampMs: Date.now(),
          msgId,
          senderId,
          httpStatus: 400,
          note: 'invalid_rsa_signature',
        });
        res.status(400).json(
          buildEnvelopeResponse({
            receiverId: senderId,
            refMsgId: msgId,
            resCode: 'PS_DS_RSA_SIGNATURE_INVALID',
            resMsg: 'Chữ ký RSA của gói tin không hợp lệ',
            data: null,
            signature: '',
          }),
        );
        return;
      }
    }

    // 2.5 Xử lý Idempotent theo msg_id của cùng CSYT (Postman kịch bản 2.2)
    if (existingSubmission && existingSubmission.facilityId === session.facilityId) {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId,
        senderId,
        httpStatus: 200,
        note: 'idempotent_msg_id_hit',
      });

      const refMsgIdToReturn =
        failEffect?.mode === 'mismatched-ref-msg-id'
          ? `MISMATCH_${msgId}`
          : msgId;

      res.status(200).json(
        buildEnvelopeResponse({
          receiverId: senderId,
          refMsgId: refMsgIdToReturn,
          resCode: 'PS_SYNC_SUCCESS',
          resMsg: 'Xử lý đồng bộ GKSK lái xe hoàn tất (idempotent)',
          data: existingSubmission.responseData,
        }),
      );
      return;
    }

    // 2.6 Giải mã Base64 và kiểm tra nội dung XML/JSON (API-CONTRACT.md §9 & §10)
    const decodedBytes = Buffer.from(rawData, 'base64');
    const errors: MockIssueItem[] = [];
    const warnings: MockIssueItem[] = [];
    const recordValues: Record<string, string> = {};
    for (const tag of FIELD_ORDER) {
      recordValues[tag] = '';
    }

    let xmlOrPayloadInvalid = false;
    let hasDigitalSignature = false;

    if (decodedBytes.byteLength > MOCK_MAX_DECODED_BYTES) {
      xmlOrPayloadInvalid = true;
      errors.push({ code: 'GKSK_XML_INVALID', field: null });
    } else if (dataType === 'xml/base64') {
      const xmlText = decodedBytes.toString('utf8');

      // Từ chối DOCTYPE hoặc ENTITY
      if (/<!DOCTYPE/i.test(xmlText) || /<!ENTITY/i.test(xmlText)) {
        xmlOrPayloadInvalid = true;
        errors.push({ code: 'GKSK_XML_INVALID', field: null });
      } else if (XMLValidator.validate(xmlText) !== true) {
        xmlOrPayloadInvalid = true;
        errors.push({ code: 'GKSK_XML_INVALID', field: null });
      } else {
        let parsed: unknown;
        try {
          parsed = xmlParser.parse(xmlText);
        } catch {
          parsed = null;
        }

        const parsedObj =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
        const rootNode = parsedObj?.root;

        if (
          !rootNode ||
          typeof rootNode !== 'object' ||
          Array.isArray(rootNode) ||
          !('SO' in (rootNode as Record<string, unknown>))
        ) {
          xmlOrPayloadInvalid = true;
          errors.push({ code: 'GKSK_XML_INVALID', field: null });
        } else {
          const rootRecord = rootNode as Record<string, unknown>;

          for (const [tag, rawVal] of Object.entries(rootRecord)) {
            if (tag === '#text' || tag.startsWith('@_') || tag.startsWith('?')) {
              continue;
            }
            if (tag === 'Signature' || tag === 'SIGNDATA') {
              const sigStr = typeof rawVal === 'string' ? rawVal.trim() : '';
              if (sigStr.length > 0 || (rawVal && typeof rawVal === 'object')) {
                hasDigitalSignature = true;
              }
              continue;
            }
            if (tag === 'GIOITINH') {
              const strVal = typeof rawVal === 'string' ? rawVal.trim() : String(rawVal ?? '').trim();
              if (!recordValues.GIOITINHVAL) {
                recordValues.GIOITINHVAL = strVal;
              }
              continue;
            }
            if (!(tag in FIELD_BY_TAG)) {
              warnings.push({ code: 'GKSK_UNKNOWN_TAG', field: tag });
              continue;
            }
            if (rawVal !== null && typeof rawVal === 'object') {
              xmlOrPayloadInvalid = true;
              errors.push({ code: 'GKSK_XML_INVALID', field: null });
              break;
            }
            recordValues[tag] =
              typeof rawVal === 'string' ? rawVal.trim() : String(rawVal ?? '').trim();
          }
        }
      }
    } else {
      // json/base64
      try {
        const parsedJson = JSON.parse(decodedBytes.toString('utf8')) as unknown;
        if (
          !parsedJson ||
          typeof parsedJson !== 'object' ||
          Array.isArray(parsedJson) ||
          !('SO' in (parsedJson as Record<string, unknown>))
        ) {
          xmlOrPayloadInvalid = true;
          errors.push({ code: 'GKSK_XML_INVALID', field: null });
        } else {
          for (const [tag, rawVal] of Object.entries(
            parsedJson as Record<string, unknown>,
          )) {
            if (rawVal !== null && typeof rawVal === 'object') {
              xmlOrPayloadInvalid = true;
              errors.push({ code: 'GKSK_XML_INVALID', field: null });
              break;
            }
            if (tag === 'SIGNDATA') {
              if (typeof rawVal === 'string' && rawVal.trim().length > 0) {
                hasDigitalSignature = true;
              }
              continue;
            }
            if (tag === 'GIOITINH') {
              if (!recordValues.GIOITINHVAL) {
                recordValues.GIOITINHVAL =
                  typeof rawVal === 'string' ? rawVal.trim() : String(rawVal ?? '').trim();
              }
              continue;
            }
            if (!(tag in FIELD_BY_TAG)) {
              warnings.push({ code: 'GKSK_UNKNOWN_TAG', field: tag });
              continue;
            }
            recordValues[tag] =
              typeof rawVal === 'string' ? rawVal.trim() : String(rawVal ?? '').trim();
          }
        }
      } catch {
        xmlOrPayloadInvalid = true;
        errors.push({ code: 'GKSK_XML_INVALID', field: null });
      }
    }

    // 2.7 Áp dụng bộ quy tắc Từ chối (§9) và Cảnh báo (§10) nếu XML hợp lệ cấu trúc
    const so = recordValues.SO ?? '';
    const hoTen = recordValues.HOTEN ?? '';
    const ngaySinh = recordValues.NGAYSINH ?? '';
    const soCmnd = recordValues.SOCMND_PASSPORT ?? '';
    const idBenhVien = recordValues.IDBENHVIEN ?? '';
    const ngayKetLuan = recordValues.NGAYKETLUAN ?? '';
    const ketLuan = recordValues.KETLUAN ?? '';
    const gioiTinh = recordValues.GIOITINHVAL ?? '';
    const nongDoCon = recordValues.NONGDOCON ?? '';
    const dviNongDoCon = recordValues.DVINONGDOCON ?? '';
    const maTuy = recordValues.MATUY ?? '';
    const state = recordValues.STATE || 'ADD';

    if (!xmlOrPayloadInvalid) {
      // --- Mã từ chối (§9) ---
      if (so.length === 0) {
        errors.push({ code: 'GKSK_SO_MISSING', field: 'SO' });
      } else if (unicodeLength(so) > SO_SERVER_MAX_LENGTH) {
        errors.push({ code: 'GKSK_SO_TOO_LONG', field: 'SO' });
      }

      if (idBenhVien.length === 0 || idBenhVien !== session.facilityId) {
        errors.push({ code: 'GKSK_FACILITY_MISMATCH', field: 'IDBENHVIEN' });
      }

      if (hoTen.length === 0 || unicodeLength(hoTen) > 255) {
        errors.push({ code: 'GKSK_HOTEN_INVALID', field: 'HOTEN' });
      }

      if (soCmnd.length === 0) {
        errors.push({ code: 'GKSK_ID_MISSING', field: 'SOCMND_PASSPORT' });
      }

      const parsedNgaySinh = parseDdMmYyyy(ngaySinh);
      if (
        ngaySinh.length === 0 ||
        !parsedNgaySinh.valid ||
        parsedNgaySinh.year < 1900 ||
        parsedNgaySinh.year > currentYear
      ) {
        errors.push({ code: 'GKSK_NGAYSINH_INVALID', field: 'NGAYSINH' });
      }

      const parsedNgayKetLuan = parseDdMmYyyy(ngayKetLuan);
      if (ngayKetLuan.length === 0 || !parsedNgayKetLuan.valid) {
        errors.push({ code: 'GKSK_NGAYKETLUAN_INVALID', field: 'NGAYKETLUAN' });
      }

      if (ketLuan.length === 0) {
        errors.push({ code: 'GKSK_KETLUAN_MISSING', field: 'KETLUAN' });
      }

      // --- Mã cảnh báo (§10) ---
      if (!hasDigitalSignature) {
        warnings.push({ code: 'GKSK_UNSIGNED', field: null });
      }

      if (
        soCmnd.length > 0 &&
        (/^0+$/.test(soCmnd) || /^\d{10,11}$/.test(soCmnd))
      ) {
        warnings.push({ code: 'GKSK_ID_INVALID', field: 'SOCMND_PASSPORT' });
      }

      if (
        ketLuan.length > 0 &&
        ketLuan !== 'A0-1' &&
        ketLuan !== 'A0-2' &&
        ketLuan !== 'A0-3'
      ) {
        warnings.push({ code: 'GKSK_KETLUAN_UNKNOWN', field: 'KETLUAN' });
      }

      if (gioiTinh.length > 0 && gioiTinh !== '0' && gioiTinh !== '1') {
        warnings.push({ code: 'GKSK_GIOITINH_UNKNOWN', field: 'GIOITINHVAL' });
      }

      if (nongDoCon.length > 0 && !/^\d+([.,]\d+)?$/.test(nongDoCon)) {
        warnings.push({ code: 'GKSK_NONGDOCON_INVALID', field: 'NONGDOCON' });
      }

      if (dviNongDoCon.length > 0 && dviNongDoCon !== '0' && dviNongDoCon !== '1') {
        warnings.push({ code: 'GKSK_DVINONGDOCON_INVALID', field: 'DVINONGDOCON' });
      }

      if (maTuy.length > 0 && maTuy !== '0' && maTuy !== '1') {
        warnings.push({ code: 'GKSK_MATUY_INVALID', field: 'MATUY' });
      }

      for (const dateTag of ['NGAYKHAM', 'NGAYTHANGNAMCAP', 'NGAYKHAMLAI'] as const) {
        const val = recordValues[dateTag] ?? '';
        if (val.length > 0 && !parseDdMmYyyy(val).valid) {
          warnings.push({ code: 'GKSK_DATE_INVALID', field: dateTag });
        }
      }

      for (const fieldSpec of FIELDS) {
        if (fieldSpec.tag === 'SO' || fieldSpec.tag === 'HOTEN') {
          continue;
        }
        if (fieldSpec.maxLength !== undefined) {
          const val = recordValues[fieldSpec.tag as FieldTag] ?? '';
          if (val.length > 0 && unicodeLength(val) > fieldSpec.maxLength) {
            warnings.push({ code: 'GKSK_FIELD_TOO_LONG', field: fieldSpec.tag });
          }
        }
      }
    }

    // 2.8 Lưu kết quả vào bộ nhớ Mock (submissions & certificates)
    const submissionId = crypto.randomUUID();
    let certificateId: string | null = null;
    const isAccepted = errors.length === 0;

    if (isAccepted) {
      const certKey = `${session.facilityId}::${so}`;
      const existingCert = certificatesByKey.get(certKey);
      const nowMs = Date.now();

      if (existingCert) {
        // Ghi đè theo (facility, SO) giữ nguyên certificate_id (Postman kịch bản 2.3)
        certificateId = existingCert.certificateId;
        existingCert.fields = { ...recordValues };
        existingCert.updatedAtMs = nowMs;

        if (state === 'ADD') {
          warnings.push({ code: 'GKSK_STATE_ADD_EXISTS', field: 'STATE' });
        }
      } else {
        certificateId = crypto.randomUUID();
        certificatesByKey.set(certKey, {
          certificateId,
          facilityId: session.facilityId,
          so,
          fields: { ...recordValues },
          createdAtMs: nowMs,
          updatedAtMs: nowMs,
        });
      }
    }

    const responseData: MockPushData = {
      status: isAccepted ? 'accepted' : 'rejected',
      submission_id: submissionId,
      certificate_id: certificateId,
      so: so.length > 0 ? so : null,
      errors,
      warnings,
    };

    submissionsByMsgId.set(msgId, {
      msgId,
      facilityId: session.facilityId,
      senderId,
      sendDatetime,
      createdAtMs: Date.now(),
      responseData,
    });

    // Hỗ trợ kịch bản S7: server đã lưu xong nhưng đứt kết nối trước khi client nhận phản hồi
    if (failEffect?.mode === 'disconnect-after-save') {
      recordRequest({
        method: 'POST',
        path: '/api/platform/gksk-lai-xe/push',
        timestampMs: Date.now(),
        msgId,
        senderId,
        note: 'mock_fail_disconnect_after_save',
      });
      res.socket?.destroy();
      return;
    }

    const refMsgIdToReturn =
      failEffect?.mode === 'mismatched-ref-msg-id' ? `MISMATCH_${msgId}` : msgId;

    const payloadDataToReturn =
      failEffect?.mode === 'sparse-response'
        ? {
            status: responseData.status,
            submission_id: responseData.submission_id,
            certificate_id: responseData.certificate_id,
            so: responseData.so,
            extra_server_note: 'unknown_field_for_lenient_parse_test',
          }
        : responseData;

    recordRequest({
      method: 'POST',
      path: '/api/platform/gksk-lai-xe/push',
      timestampMs: Date.now(),
      msgId,
      senderId,
      httpStatus: 200,
      note: `push_${responseData.status}`,
    });

    res.status(200).json(
      buildEnvelopeResponse({
        receiverId: senderId,
        refMsgId: refMsgIdToReturn,
        resCode: 'PS_SYNC_SUCCESS',
        resMsg:
          responseData.status === 'accepted'
            ? 'Tiếp nhận giấy khám sức khỏe lái xe thành công'
            : 'Giấy khám sức khỏe lái xe bị từ chối do lỗi dữ liệu',
        data: payloadDataToReturn,
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // 3. GET /api/platform/gksk-lai-xe/status (API-CONTRACT.md §7 — không có header)
  // ---------------------------------------------------------------------------

  app.get('/api/platform/gksk-lai-xe/status', (req: Request, res: Response) => {
    const bearerToken = extractBearerToken(req);
    const session = bearerToken ? tokens.get(bearerToken) : undefined;
    const msgId = typeof req.query.msg_id === 'string' ? req.query.msg_id.trim() : '';

    if (!session || session.role !== 'csyt') {
      recordRequest({
        method: 'GET',
        path: '/api/platform/gksk-lai-xe/status',
        timestampMs: Date.now(),
        msgId,
        httpStatus: 403,
        note: 'status_unauthorized',
      });
      res.status(403).json({
        code: 'CM_PERMISSION_DENY',
        message: 'Token không hợp lệ hoặc không có quyền truy cập',
        data: null,
      });
      return;
    }

    if (msgId.length === 0) {
      recordRequest({
        method: 'GET',
        path: '/api/platform/gksk-lai-xe/status',
        timestampMs: Date.now(),
        senderId: session.facilityId,
        httpStatus: 400,
        note: 'status_missing_msg_id',
      });
      res.status(400).json({
        code: 'CM_INVALID_REQUEST',
        message: 'Thiếu tham số truy vấn msg_id',
        data: null,
      });
      return;
    }

    const stored = submissionsByMsgId.get(msgId);
    if (!stored || stored.facilityId !== session.facilityId) {
      recordRequest({
        method: 'GET',
        path: '/api/platform/gksk-lai-xe/status',
        timestampMs: Date.now(),
        msgId,
        senderId: session.facilityId,
        httpStatus: 404,
        note: 'status_not_found',
      });
      res.status(404).json({
        code: 'CM_INVALID_REQUEST',
        message: `Không tìm thấy gói tin ${msgId}`,
        data: null,
      });
      return;
    }

    recordRequest({
      method: 'GET',
      path: '/api/platform/gksk-lai-xe/status',
      timestampMs: Date.now(),
      msgId,
      senderId: session.facilityId,
      httpStatus: 200,
      note: 'status_found',
    });

    res.status(200).json({
      code: 'CM_SUCCESS',
      message: 'Tra cứu kết quả xử lý gói tin thành công',
      data: stored.responseData,
    });
  });

  return app;
}
