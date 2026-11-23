import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  computeEnvelopeSignatureParts,
  ENVELOPE_HEADER_KEYS,
  type EnvelopeHeader,
  serializeEnvelopeHeader,
  sha256HexUpper,
  signEnvelope,
  verifyEnvelopeSignature,
} from './signature.js';

/** Golden Vector chính thức từ docs/API-CONTRACT.md §5. */
const GOLDEN_HEADER: EnvelopeHeader = {
  version: '1.0.6',
  sender_id: '75001',
  receiver_id: 'TTYQG',
  txn_type: 'sync_gksk_lai_xe',
  msg_id: '75001261123a3f1c2e4b5d44e7f8a9b0c1d2e3f4a5b',
  msg_type: '101',
  data_type: 'xml/base64',
  send_datetime: 1781084650736,
};

const GOLDEN_HEADER_JSON =
  '{"version":"1.0.6","sender_id":"75001","receiver_id":"TTYQG","txn_type":"sync_gksk_lai_xe","msg_id":"75001261123a3f1c2e4b5d44e7f8a9b0c1d2e3f4a5b","msg_type":"101","data_type":"xml/base64","send_datetime":1781084650736}';

const GOLDEN_DATA = 'PHJvb3Q+PFNPPlRFU1QuNzUwMDEuMTwvU08+PC9yb290Pg==';
const GOLDEN_H = '6A618CAF5E36F31A4A779636EB2C34E9C4FCE1FFF20BE0A29D39CC9C0F04EC8F';
const GOLDEN_D = '2D626275B6434A748DCF1A2A4A535C556C1C52EDDA981FE16967F937D599C11E';
const GOLDEN_SIGNED = `${GOLDEN_H}.${GOLDEN_D}`;
const GOLDEN_SIGNATURE_NO_KEY = 'CHUA-KY-6A618CAF5E36F31A';

describe('server/src/gksk/signature', () => {
  it('khớp từng ký tự với Golden Vector tại docs/API-CONTRACT.md §5 (chế độ không khóa RSA)', () => {
    const parts = computeEnvelopeSignatureParts(GOLDEN_HEADER, GOLDEN_DATA);

    expect(parts.headerJson).toBe(GOLDEN_HEADER_JSON);
    expect(parts.headerHash).toBe(GOLDEN_H);
    expect(parts.dataHash).toBe(GOLDEN_D);
    expect(parts.signedPayload).toBe(GOLDEN_SIGNED);
    expect(parts.signature).toBe(GOLDEN_SIGNATURE_NO_KEY);
    expect(signEnvelope(GOLDEN_HEADER, GOLDEN_DATA)).toBe(GOLDEN_SIGNATURE_NO_KEY);
  });

  it('serializeEnvelopeHeader luôn ép đúng thứ tự 8 khóa ngay cả khi object truyền vào bị đảo thứ tự key', () => {
    const shuffledHeader = {
      send_datetime: GOLDEN_HEADER.send_datetime,
      data_type: GOLDEN_HEADER.data_type,
      msg_type: GOLDEN_HEADER.msg_type,
      msg_id: GOLDEN_HEADER.msg_id,
      txn_type: GOLDEN_HEADER.txn_type,
      receiver_id: GOLDEN_HEADER.receiver_id,
      sender_id: GOLDEN_HEADER.sender_id,
      version: GOLDEN_HEADER.version,
    } satisfies EnvelopeHeader;

    const json = serializeEnvelopeHeader(shuffledHeader);
    expect(json).toBe(GOLDEN_HEADER_JSON);

    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([...ENVELOPE_HEADER_KEYS]);
    expect(sha256HexUpper(json)).toBe(GOLDEN_H);
  });

  it('trim khoảng trắng hai đầu của data Base64 trước khi băm D = SHA256_UPPER(data.trim())', () => {
    const paddedData = `  \n${GOLDEN_DATA}\r\n  `;
    const parts = computeEnvelopeSignatureParts(GOLDEN_HEADER, paddedData);

    expect(parts.dataHash).toBe(GOLDEN_D);
    expect(parts.signature).toBe(GOLDEN_SIGNATURE_NO_KEY);
  });

  it('xử lý privateKeyPem rỗng hoặc chỉ có khoảng trắng như chế độ không có khóa RSA', () => {
    expect(signEnvelope(GOLDEN_HEADER, GOLDEN_DATA, undefined)).toBe(GOLDEN_SIGNATURE_NO_KEY);
    expect(signEnvelope(GOLDEN_HEADER, GOLDEN_DATA, '')).toBe(GOLDEN_SIGNATURE_NO_KEY);
    expect(signEnvelope(GOLDEN_HEADER, GOLDEN_DATA, '   \n  ')).toBe(GOLDEN_SIGNATURE_NO_KEY);
  });

  it('ký RSA-PKCS1v1.5-SHA256 2048-bit ra Base64 và verify khớp bằng crypto.verify + verifyEnvelopeSignature', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const parts = computeEnvelopeSignatureParts(GOLDEN_HEADER, GOLDEN_DATA, privateKey);

    expect(parts.signature).not.toContain('CHUA-KY-');
    expect(parts.signature.length).toBeGreaterThan(100);

    // Kiểm tra trực tiếp bằng node:crypto theo đúng API-CONTRACT.md §5
    const verifiedByNodeCrypto = crypto.verify(
      'sha256',
      Buffer.from(GOLDEN_SIGNED, 'utf8'),
      publicKey,
      Buffer.from(parts.signature, 'base64'),
    );
    expect(verifiedByNodeCrypto).toBe(true);

    // Kiểm tra qua helper verifyEnvelopeSignature
    expect(verifyEnvelopeSignature(GOLDEN_HEADER, GOLDEN_DATA, parts.signature, publicKey)).toBe(
      true,
    );

    // Đổi 1 ký tự trong data hoặc signature hoặc dùng sai publicKey phải trả false
    expect(
      verifyEnvelopeSignature(GOLDEN_HEADER, `${GOLDEN_DATA}A`, parts.signature, publicKey),
    ).toBe(false);
    expect(
      verifyEnvelopeSignature(GOLDEN_HEADER, GOLDEN_DATA, GOLDEN_SIGNATURE_NO_KEY, publicKey),
    ).toBe(false);
    expect(
      verifyEnvelopeSignature(GOLDEN_HEADER, GOLDEN_DATA, parts.signature, 'INVALID_PEM'),
    ).toBe(false);
  });
});
