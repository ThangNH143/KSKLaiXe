import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildEnvelope,
  ENVELOPE_DATA_TYPE,
  ENVELOPE_MSG_TYPE,
  ENVELOPE_RECEIVER_ID,
  ENVELOPE_TXN_TYPE,
  ENVELOPE_VERSION,
  formatVnYyMmDd,
  newMsgId,
} from './envelope.js';
import {
  computeEnvelopeSignatureParts,
  ENVELOPE_HEADER_KEYS,
  verifyEnvelopeSignature,
} from './signature.js';

describe('server/src/gksk/envelope', () => {
  it('buildEnvelope dựng đúng Golden Vector tại docs/API-CONTRACT.md §5 và giữ đúng thứ tự 8 khóa header', () => {
    const xml = '<root><SO>TEST.75001.1</SO></root>';
    const msgId = '75001261123a3f1c2e4b5d44e7f8a9b0c1d2e3f4a5b';
    const sendDatetime = 1781084650736;

    const envelope = buildEnvelope({
      senderId: '75001',
      xml,
      msgId,
      sendDatetime,
    });

    // Kiểm tra thứ tự 8 khóa của header theo API-CONTRACT.md §3
    expect(Object.keys(envelope.header)).toEqual([...ENVELOPE_HEADER_KEYS]);
    expect(envelope.header).toEqual({
      version: ENVELOPE_VERSION,
      sender_id: '75001',
      receiver_id: ENVELOPE_RECEIVER_ID,
      txn_type: ENVELOPE_TXN_TYPE,
      msg_id: msgId,
      msg_type: ENVELOPE_MSG_TYPE,
      data_type: ENVELOPE_DATA_TYPE,
      send_datetime: sendDatetime,
    });

    expect(JSON.stringify(envelope.header)).toBe(
      '{"version":"1.0.6","sender_id":"75001","receiver_id":"TTYQG","txn_type":"sync_gksk_lai_xe","msg_id":"75001261123a3f1c2e4b5d44e7f8a9b0c1d2e3f4a5b","msg_type":"101","data_type":"xml/base64","send_datetime":1781084650736}',
    );
    expect(envelope.data).toBe('PHJvb3Q+PFNPPlRFU1QuNzUwMDEuMTwvU08+PC9yb290Pg==');
    expect(envelope.signature).toBe('CHUA-KY-6A618CAF5E36F31A');

    const parts = computeEnvelopeSignatureParts(envelope.header, envelope.data);
    expect(parts.headerHash).toBe(
      '6A618CAF5E36F31A4A779636EB2C34E9C4FCE1FFF20BE0A29D39CC9C0F04EC8F',
    );
    expect(parts.dataHash).toBe(
      '2D626275B6434A748DCF1A2A4A535C556C1C52EDDA981FE16967F937D599C11E',
    );
  });

  it('buildEnvelope hỗ trợ ký RSA 2048-bit khi truyền privateKeyPem', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const envelope = buildEnvelope({
      senderId: '75001',
      xml: '<root><SO>TEST.75001.1</SO></root>',
      msgId: '75001261123a3f1c2e4b5d44e7f8a9b0c1d2e3f4a5b',
      sendDatetime: 1781084650736,
      privateKeyPem: privateKey,
    });

    expect(Object.keys(envelope.header)).toEqual([...ENVELOPE_HEADER_KEYS]);
    expect(
      verifyEnvelopeSignature(envelope.header, envelope.data, envelope.signature, publicKey),
    ).toBe(true);
  });

  it('newMsgId khớp regex §4, độ dài 43 với sender 5 ký tự và tính YYMMDD đúng ở mốc giao thừa giờ VN (UTC+7)', () => {
    const msgIdRegex = /^75001\d{6}[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/;

    // 2026-11-23T16:59:59Z = 2026-11-23 23:59:59 (UTC+7) -> YYMMDD = 261123
    const beforeVnMidnightMs = Date.parse('2026-11-23T16:59:59Z');
    const msgBefore = newMsgId('75001', beforeVnMidnightMs);
    expect(msgBefore).toHaveLength(43);
    expect(msgBefore).toMatch(msgIdRegex);
    expect(msgBefore.slice(0, 11)).toBe('75001261123');

    // 2026-11-23T17:00:00Z = 2026-11-24 00:00:00 (UTC+7) -> YYMMDD = 261124
    const exactVnMidnightMs = Date.parse('2026-11-23T17:00:00Z');
    const msgExact = newMsgId('75001', exactVnMidnightMs);
    expect(msgExact.slice(0, 11)).toBe('75001261124');

    // 2026-11-23T17:30:00Z = 2026-11-24 00:30:00 (UTC+7) -> YYMMDD = 261124
    const afterVnMidnightMs = Date.parse('2026-11-23T17:30:00Z');
    const msgAfter = newMsgId('75001', afterVnMidnightMs);
    expect(msgAfter).toHaveLength(43);
    expect(msgAfter).toMatch(msgIdRegex);
    expect(msgAfter.slice(0, 11)).toBe('75001261124');
  });

  it('newMsgId luôn trả cùng YYMMDD theo UTC+7 bất kể biến môi trường TZ của tiến trình', () => {
    const originalTz = process.env.TZ;
    const beforeVnMidnightMs = Date.parse('2026-11-23T16:59:59Z');
    const afterVnMidnightMs = Date.parse('2026-11-23T17:30:00Z');
    const newYearEveUtcMs = Date.parse('2026-12-31T17:00:00Z'); // 2027-01-01 00:00:00 VN

    const timezones = [
      'UTC',
      'Asia/Ho_Chi_Minh',
      'America/Los_Angeles',
      'America/New_York',
      'Pacific/Auckland',
    ];

    try {
      for (const tz of timezones) {
        process.env.TZ = tz;
        expect(formatVnYyMmDd(beforeVnMidnightMs)).toBe('261123');
        expect(formatVnYyMmDd(afterVnMidnightMs)).toBe('261124');
        expect(formatVnYyMmDd(newYearEveUtcMs)).toBe('270101');

        expect(newMsgId('75001', beforeVnMidnightMs).slice(5, 11)).toBe('261123');
        expect(newMsgId('75001', afterVnMidnightMs).slice(5, 11)).toBe('261124');
      }
    } finally {
      if (originalTz === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTz;
      }
    }
  });

  it('sinh 10.000 msg_id liên tiếp không có bất kỳ giá trị nào trùng nhau và đều khớp regex UUID v4', () => {
    const nowMs = Date.parse('2026-11-23T10:00:00Z');
    const msgIdRegex = /^75001261123[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/;
    const generated = new Set<string>();

    for (let i = 0; i < 10_000; i += 1) {
      const id = newMsgId('75001', nowMs);
      expect(id).toMatch(msgIdRegex);
      generated.add(id);
    }

    expect(generated.size).toBe(10_000);
  });

  it('kiểm tra lỗi đầu vào của newMsgId và formatVnYyMmDd khi senderId hoặc nowMs không hợp lệ', () => {
    const validNow = Date.parse('2026-11-23T10:00:00Z');
    expect(() => newMsgId('', validNow)).toThrow(/senderId không hợp lệ/);
    expect(() => newMsgId('   ', validNow)).toThrow(/senderId không hợp lệ/);
    expect(() => newMsgId('75001/invalid', validNow)).toThrow(/senderId không hợp lệ/);
    expect(() => formatVnYyMmDd(Number.NaN)).toThrow(/nowMs phải là số hữu hạn/);
  });
});
