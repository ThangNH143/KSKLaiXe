import crypto from 'node:crypto';
import {
  type EnvelopeHeader,
  signEnvelope,
} from './signature.js';
import { toBase64Utf8 } from './xml.js';

/** Hằng số mặc định cho `header` của gói tin GKSK lái xe (API-CONTRACT.md §3). */
export const ENVELOPE_VERSION = '1.0.6';
export const ENVELOPE_RECEIVER_ID = 'TTYQG';
export const ENVELOPE_TXN_TYPE = 'sync_gksk_lai_xe';
export const ENVELOPE_MSG_TYPE = '101';
export const ENVELOPE_DATA_TYPE = 'xml/base64';

/** Độ lệch múi giờ Việt Nam (UTC+7) tính bằng mili giây: 7 * 3600 * 1000. */
const VN_UTC_OFFSET_MS = 7 * 3600 * 1000;

/**
 * Biểu thức chính quy kiểm tra `sender_id` hợp lệ theo API-CONTRACT.md §3:
 * chỉ gồm chữ cái, chữ số, dấu chấm `.`, gạch dưới `_`, gạch ngang `-`.
 */
const SENDER_ID_REGEX = /^[A-Za-z0-9._-]+$/;

/** Cấu trúc gói tin (envelope) gửi lên `POST /api/platform/gksk-lai-xe/push` (API-CONTRACT.md §3). */
export interface GkskEnvelope {
  header: EnvelopeHeader;
  data: string;
  signature: string;
}

/** Tham số đầu vào của `buildEnvelope` (IMPLEMENTATION-PLAN.md S5 & API-CONTRACT.md §3–5). */
export interface BuildEnvelopeInput {
  senderId: string;
  xml: string;
  msgId: string;
  sendDatetime: number;
  privateKeyPem?: string;
}

/**
 * Tính chuỗi `YYMMDD` theo giờ Việt Nam (`UTC+7` cố định, tuyệt đối không phụ thuộc múi giờ máy).
 * Công thức chuẩn tại API-CONTRACT.md §4:
 * `const vnIso = new Date(nowMs + 7 * 3600 * 1000).toISOString();`
 */
export function formatVnYyMmDd(nowMs: number): string {
  if (!Number.isFinite(nowMs)) {
    throw new Error('Tham số thời gian nowMs phải là số hữu hạn (epoch milliseconds).');
  }
  const vnIso = new Date(nowMs + VN_UTC_OFFSET_MS).toISOString();
  return vnIso.slice(2, 4) + vnIso.slice(5, 7) + vnIso.slice(8, 10);
}

/**
 * Tạo `msg_id` mới theo đúng quy tắc tại API-CONTRACT.md §4:
 * `msg_id = sender_id + YYMMDD (UTC+7) + uuidV4SansDash`
 *
 * - `YYMMDD`: ngày theo giờ Việt Nam (`UTC+7` cố định), truyền qua `nowMs` để hàm thuần và kiểm thử ổn định.
 * - `uuidV4SansDash`: `crypto.randomUUID().replace(/-/g, '')` (32 ký tự hexa viết thường,
 *   ký tự thứ 13 là `4`, ký tự thứ 17 thuộc `{8, 9, a, b}`).
 * - Với `senderId` 5 ký tự (ví dụ `"75001"`), tổng độ dài `msg_id` là `5 + 6 + 32 = 43` ký tự.
 */
export function newMsgId(senderId: string, nowMs: number): string {
  const cleanSenderId = senderId.trim();
  if (cleanSenderId.length === 0 || !SENDER_ID_REGEX.test(cleanSenderId)) {
    throw new Error(
      'senderId không hợp lệ: chỉ được chứa chữ cái, chữ số, dấu chấm (.), gạch dưới (_) hoặc gạch ngang (-).',
    );
  }

  const yymmdd = formatVnYyMmDd(nowMs);
  const uuidV4SansDash = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  return `${cleanSenderId}${yymmdd}${uuidV4SansDash}`;
}

/**
 * Dựng đối tượng `header` giữ chính xác thứ tự 8 khóa theo API-CONTRACT.md §3:
 * `version, sender_id, receiver_id, txn_type, msg_id, msg_type, data_type, send_datetime`.
 */
export function buildEnvelopeHeader(params: {
  senderId: string;
  msgId: string;
  sendDatetime: number;
}): EnvelopeHeader {
  return {
    version: ENVELOPE_VERSION,
    sender_id: params.senderId,
    receiver_id: ENVELOPE_RECEIVER_ID,
    txn_type: ENVELOPE_TXN_TYPE,
    msg_id: params.msgId,
    msg_type: ENVELOPE_MSG_TYPE,
    data_type: ENVELOPE_DATA_TYPE,
    send_datetime: params.sendDatetime,
  };
}

/**
 * Dựng gói tin (envelope) hoàn chỉnh để đẩy lên Hệ thống Sở theo API-CONTRACT.md §3–5:
 * - `header`: giữ chính xác thứ tự 8 khóa (`version`, `sender_id`, `receiver_id`, `txn_type`, `msg_id`, `msg_type`, `data_type`, `send_datetime`).
 * - `data`: Base64 chuẩn (UTF-8, có padding `=`) của chuỗi XML.
 * - `signature`: chữ ký gói tin tính theo `signEnvelope(header, data, privateKeyPem)`.
 */
export function buildEnvelope(input: BuildEnvelopeInput): GkskEnvelope {
  const header = buildEnvelopeHeader({
    senderId: input.senderId,
    msgId: input.msgId,
    sendDatetime: input.sendDatetime,
  });
  const data = toBase64Utf8(input.xml);
  const signature = signEnvelope(header, data, input.privateKeyPem);

  return {
    header,
    data,
    signature,
  };
}
