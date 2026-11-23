import crypto from 'node:crypto';

/**
 * Thứ tự 8 khóa bắt buộc trong `header` của gói tin gửi lên Hệ thống Sở (API-CONTRACT.md §3 & §5).
 * Khi `JSON.stringify(header)` phải giữ chính xác thứ tự này để khớp chữ ký gói tin.
 */
export const ENVELOPE_HEADER_KEYS = [
  'version',
  'sender_id',
  'receiver_id',
  'txn_type',
  'msg_id',
  'msg_type',
  'data_type',
  'send_datetime',
] as const;

export type EnvelopeHeaderKey = (typeof ENVELOPE_HEADER_KEYS)[number];

/** Cấu trúc `header` của gói tin push GKSK lái xe (API-CONTRACT.md §3). */
export interface EnvelopeHeader {
  version: string;
  sender_id: string;
  receiver_id: string;
  txn_type: string;
  msg_id: string;
  msg_type: string;
  data_type: string;
  send_datetime: number;
}

/** Kết quả chi tiết quá trình tính băm và ký gói tin (phục vụ kiểm thử Golden Vector & đối soát). */
export interface EnvelopeSignatureParts {
  /** Chuỗi JSON gọn của `header` theo đúng thứ tự 8 khóa ở API-CONTRACT.md §3. */
  headerJson: string;
  /** `H = SHA256_HEX_UPPER(headerJson)` (64 ký tự hexa viết hoa). */
  headerHash: string;
  /** `D = SHA256_HEX_UPPER(data.trim())` (64 ký tự hexa viết hoa, băm chuỗi Base64 UTF-8). */
  dataHash: string;
  /** Chuỗi đưa vào ký: `signed = H + "." + D`. */
  signedPayload: string;
  /**
   * Chữ ký gói tin:
   * - Có `privateKeyPem`: `Base64(RSA-PKCS1v1.5-SHA256(signed))`
   * - Không có khóa: `"CHUA-KY-" + signed.slice(0, 16)`
   */
  signature: string;
}

/** Tiền tố chữ ký giả khi CSYT chưa cấu hình khóa RSA (API-CONTRACT.md §5). */
export const UNSIGNED_ENVELOPE_PREFIX = 'CHUA-KY-';

/**
 * Tính SHA-256 của chuỗi UTF-8 và trả về chuỗi hexa VIẾT HOA (64 ký tự).
 * (API-CONTRACT.md §5)
 */
export function sha256HexUpper(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').toUpperCase();
}

/**
 * Chuẩn hóa đối tượng `header` và serialize thành chuỗi JSON gọn theo đúng thứ tự 8 khóa
 * quy định tại API-CONTRACT.md §3 & §5:
 * `version, sender_id, receiver_id, txn_type, msg_id, msg_type, data_type, send_datetime`.
 */
export function serializeEnvelopeHeader(header: EnvelopeHeader): string {
  const orderedHeader: EnvelopeHeader = {
    version: header.version,
    sender_id: header.sender_id,
    receiver_id: header.receiver_id,
    txn_type: header.txn_type,
    msg_id: header.msg_id,
    msg_type: header.msg_type,
    data_type: header.data_type,
    send_datetime: header.send_datetime,
  };
  return JSON.stringify(orderedHeader);
}

/**
 * Tính các thành phần băm (`headerJson`, `H`, `D`, `signed`) và chữ ký gói tin (`signature`)
 * theo đúng quy tắc tại API-CONTRACT.md §5:
 * 1. `headerJson = JSON.stringify(header)` (8 khóa đúng thứ tự)
 * 2. `H = SHA256_UPPER(headerJson)`
 * 3. `D = SHA256_UPPER(data.trim())`
 * 4. `signed = H + "." + D`
 * 5. Nếu có `privateKeyPem`: ký `RSA-PKCS1v1.5-SHA256` ra Base64.
 *    Nếu không có khóa: trả `"CHUA-KY-" + signed.slice(0, 16)`.
 */
export function computeEnvelopeSignatureParts(
  header: EnvelopeHeader,
  data: string,
  privateKeyPem?: string,
): EnvelopeSignatureParts {
  const headerJson = serializeEnvelopeHeader(header);
  const headerHash = sha256HexUpper(headerJson);
  const dataHash = sha256HexUpper(data.trim());
  const signedPayload = `${headerHash}.${dataHash}`;

  const trimmedKey = privateKeyPem?.trim() ?? '';
  let signature: string;

  if (trimmedKey.length > 0) {
    signature = crypto
      .sign('sha256', Buffer.from(signedPayload, 'utf8'), trimmedKey)
      .toString('base64');
  } else {
    signature = `${UNSIGNED_ENVELOPE_PREFIX}${signedPayload.slice(0, 16)}`;
  }

  return {
    headerJson,
    headerHash,
    dataHash,
    signedPayload,
    signature,
  };
}

/**
 * Ký gói tin envelope và trả về chuỗi `signature` theo API-CONTRACT.md §5.
 */
export function signEnvelope(
  header: EnvelopeHeader,
  data: string,
  privateKeyPem?: string,
): string {
  return computeEnvelopeSignatureParts(header, data, privateKeyPem).signature;
}

/**
 * Kiểm tra chữ ký RSA-PKCS1v1.5-SHA256 của gói tin bằng khóa công khai (`publicKeyPem`).
 * Phục vụ kiểm thử đơn vị và Mock Server khi bật `MOCK_VERIFY_SIGNATURE=1`.
 */
export function verifyEnvelopeSignature(
  header: EnvelopeHeader,
  data: string,
  signature: string,
  publicKeyPem: string,
): boolean {
  const { signedPayload } = computeEnvelopeSignatureParts(header, data);
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
