import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FIELD_ORDER } from '@gksk/shared';
import { createMockGkskApp, type MockPushData } from './app.js';

function makeValidRecord(overrides: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {
    SO: 'TEST.75001.1700000000.1',
    NGAYKHAM: '05/11/2026',
    HOTEN: 'TEST NGUYEN VAN A',
    GIOITINHVAL: '0',
    NGAYSINH: '21/05/1990',
    DIACHITHUONGTRU: 'So 1 Duong Thu, Bien Hoa, Dong Nai',
    MATINH_THUONGTRU: '75',
    MAHUYEN_THUONGTRU: '75731',
    MAXA_THUONGTRU: '7573126041',
    SOCMND_PASSPORT: 'TESTGKSK01',
    NGAYTHANGNAMCAP: '01/02/2021',
    NOICAP: 'Cuc CS QLHC',
    HANGBANGLAI: 'B',
    IDBENHVIEN: '75001',
    BENHVIEN: 'Benh vien Thu',
    NGAYKETLUAN: '06/11/2026',
    NONGDOCON: '0',
    DVINONGDOCON: '0',
    MATUY: '0',
    BACSYKETLUAN: 'TEST BAC SI',
    KETLUAN: 'A0-1',
    NGAYKHAMLAI: '',
    LYDO: '',
    TINHTRANGBENH: '',
    STATE: 'ADD',
  };
  return { ...base, ...overrides };
}

function buildTestXml(
  record: Record<string, string>,
  extraInnerXml = '',
): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<root>'];
  for (const tag of FIELD_ORDER) {
    const val = record[tag] ?? '';
    lines.push(`  <${tag}>${val}</${tag}>`);
  }
  if (extraInnerXml) {
    lines.push(`  ${extraInnerXml}`);
  }
  lines.push('</root>');
  return `${lines.join('\n')}\n`;
}

function makeMsgId(senderId = '75001', nowMs = Date.parse('2026-11-23T10:00:00Z')): string {
  const vnIso = new Date(nowMs + 7 * 3600 * 1000).toISOString();
  const yymmdd = vnIso.slice(2, 4) + vnIso.slice(5, 7) + vnIso.slice(8, 10);
  const uuid = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  return `${senderId}${yymmdd}${uuid}`;
}

function sha256Upper(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

function makeEnvelope(params: {
  senderId?: string;
  receiverId?: string;
  txnType?: string;
  msgId?: string;
  msgType?: string;
  dataType?: string;
  sendDatetime?: number;
  xml?: string;
  rawDataBase64?: string;
  privateKeyPem?: string;
  overrideSignature?: string;
}) {
  const senderId = params.senderId ?? '75001';
  const msgId = params.msgId ?? makeMsgId(senderId);
  const sendDatetime = params.sendDatetime ?? 1781084650736;
  const header = {
    version: '1.0.6',
    sender_id: senderId,
    receiver_id: params.receiverId ?? 'TTYQG',
    txn_type: params.txnType ?? 'sync_gksk_lai_xe',
    msg_id: msgId,
    msg_type: params.msgType ?? '101',
    data_type: params.dataType ?? 'xml/base64',
    send_datetime: sendDatetime,
  };
  const data =
    params.rawDataBase64 ??
    Buffer.from(params.xml ?? buildTestXml(makeValidRecord()), 'utf8').toString('base64');

  const signed = `${sha256Upper(JSON.stringify(header))}.${sha256Upper(data.trim())}`;
  const signature =
    params.overrideSignature !== undefined
      ? params.overrideSignature
      : params.privateKeyPem
        ? crypto
            .sign('sha256', Buffer.from(signed, 'utf8'), params.privateKeyPem)
            .toString('base64')
        : `CHUA-KY-${signed.slice(0, 16)}`;

  return { header, data, signature };
}

describe('tools/mock-gksk-api — Postman Scenarios 1.1 → 4.6 & API-CONTRACT §1–§12', () => {
  let server: Server;
  let baseUrl = '';
  let token75001 = '';

  beforeAll(async () => {
    const app = createMockGkskApp({ currentYear: 2026, defaultTimeoutMs: 120 });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(async () => {
    await fetch(`${baseUrl}/__mock/reset`, { method: 'POST' });
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '75001', password: 'mock' }),
    });
    const loginJson = (await loginRes.json()) as { data: { token: string } };
    token75001 = loginJson.data.token;
  });

  it('Kịch bản 1.1 & 1.2: Đăng nhập CSYT thành công trả CM_SUCCESS + token (duration=720) và từ chối khi sai mật khẩu', async () => {
    // 1.1 Login đúng
    const okRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '75001', password: 'mock' }),
    });
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as {
      header: { res_code: string; success: boolean };
      data: { token: string; refresh_token: string; duration: number; refresh_duration: number };
    };
    expect(okBody.header.res_code).toBe('CM_SUCCESS');
    expect(okBody.header.success).toBe(true);
    expect(okBody.data.token).toBeTruthy();
    expect(okBody.data.duration).toBe(720);
    expect(okBody.data.refresh_duration).toBe(1440);

    // 1.2 Login sai mật khẩu -> không có data.token
    const badRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '75001', password: 'wrong' }),
    });
    expect(badRes.status).toBe(401);
    const badBody = (await badRes.json()) as {
      header: { res_code: string; success: boolean };
      data: null;
    };
    expect(badBody.header.success).toBe(false);
    expect(badBody.data).toBeNull();
  });

  it('Kịch bản 2.1: Gửi XML chưa ký hợp lệ -> HTTP 200 accepted + cảnh báo GKSK_UNSIGNED', async () => {
    const env = makeEnvelope({
      xml: buildTestXml(makeValidRecord({ SO: 'TEST.75001.201' })),
    });

    const res = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(env),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      header: { res_code: string; ref_msg_id: string };
      data: MockPushData;
    };
    expect(body.header.res_code).toBe('PS_SYNC_SUCCESS');
    expect(body.header.ref_msg_id).toBe(env.header.msg_id);
    expect(body.data.status).toBe('accepted');
    expect(body.data.so).toBe('TEST.75001.201');
    expect(body.data.submission_id).toBeTruthy();
    expect(body.data.certificate_id).toBeTruthy();
    expect(body.data.errors).toEqual([]);
    expect(body.data.warnings).toEqual([{ code: 'GKSK_UNSIGNED', field: null }]);
  });

  it('Kịch bản 2.2: Gửi lại cùng msg_id (idempotent) -> trả về đúng cùng submission_id và certificate_id', async () => {
    const env = makeEnvelope({
      xml: buildTestXml(makeValidRecord({ SO: 'TEST.75001.202' })),
    });

    const res1 = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(env),
    });
    const body1 = (await res1.json()) as { data: MockPushData };

    const res2 = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(env),
    });
    const body2 = (await res2.json()) as { data: MockPushData };

    expect(res2.status).toBe(200);
    expect(body2.data.status).toBe('accepted');
    expect(body2.data.submission_id).toBe(body1.data.submission_id);
    expect(body2.data.certificate_id).toBe(body1.data.certificate_id);
  });

  it('Kịch bản 2.3: Cùng SO nhưng msg_id mới -> ghi đè theo (facility, SO), giữ nguyên certificate_id + cảnh báo GKSK_STATE_ADD_EXISTS', async () => {
    const env1 = makeEnvelope({
      msgId: makeMsgId('75001'),
      xml: buildTestXml(makeValidRecord({ SO: 'TEST.75001.203', HOTEN: 'TEST LAN 1', STATE: 'ADD' })),
    });
    const res1 = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(env1),
    });
    const body1 = (await res1.json()) as { data: MockPushData };

    const env2 = makeEnvelope({
      msgId: makeMsgId('75001'),
      xml: buildTestXml(makeValidRecord({ SO: 'TEST.75001.203', HOTEN: 'TEST LAN 2', STATE: 'ADD' })),
    });
    const res2 = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(env2),
    });
    const body2 = (await res2.json()) as { data: MockPushData };

    expect(res2.status).toBe(200);
    expect(body2.data.status).toBe('accepted');
    expect(body2.data.submission_id).not.toBe(body1.data.submission_id);
    expect(body2.data.certificate_id).toBe(body1.data.certificate_id);
    expect(body2.data.warnings).toContainEqual({
      code: 'GKSK_STATE_ADD_EXISTS',
      field: 'STATE',
    });
  });

  it('Kịch bản 2.4: Áp dụng đầy đủ các mã cảnh báo §10 (giấy vẫn accepted)', async () => {
    const warnRecord = makeValidRecord({
      SO: 'TEST.75001.204',
      GIOITINHVAL: '9', // GKSK_GIOITINH_UNKNOWN
      KETLUAN: 'A0-9', // GKSK_KETLUAN_UNKNOWN
      NONGDOCON: 'abc', // GKSK_NONGDOCON_INVALID
      DVINONGDOCON: '5', // GKSK_DVINONGDOCON_INVALID
      MATUY: '2', // GKSK_MATUY_INVALID
      NGAYKHAM: '31/02/2026', // GKSK_DATE_INVALID
      SOCMND_PASSPORT: '000000000000', // GKSK_ID_INVALID
      NOICAP: 'A'.repeat(31), // GKSK_FIELD_TOO_LONG (Max 30)
    });
    const xmlWithUnknownTag = buildTestXml(warnRecord, '<THE_LA_NGOAI_CHUAN>123</THE_LA_NGOAI_CHUAN>');
    const env = makeEnvelope({ xml: xmlWithUnknownTag });

    const res = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(env),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: MockPushData };
    expect(body.data.status).toBe('accepted');
    const warnCodes = body.data.warnings.map((w) => w.code);
    expect(warnCodes).toEqual(
      expect.arrayContaining([
        'GKSK_UNSIGNED',
        'GKSK_UNKNOWN_TAG',
        'GKSK_ID_INVALID',
        'GKSK_KETLUAN_UNKNOWN',
        'GKSK_GIOITINH_UNKNOWN',
        'GKSK_NONGDOCON_INVALID',
        'GKSK_DVINONGDOCON_INVALID',
        'GKSK_MATUY_INVALID',
        'GKSK_DATE_INVALID',
        'GKSK_FIELD_TOO_LONG',
      ]),
    );
  });

  it('Kịch bản 3.1 & 3.2: Status trả {code, message, data} y hệt lúc push (không có header) và 404 khi msg_id không tồn tại', async () => {
    const env = makeEnvelope({
      xml: buildTestXml(makeValidRecord({ SO: 'TEST.75001.301' })),
    });

    const pushRes = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(env),
    });
    const pushBody = (await pushRes.json()) as { data: MockPushData };

    // 3.1 Status 200
    const statusOkRes = await fetch(
      `${baseUrl}/api/platform/gksk-lai-xe/status?msg_id=${encodeURIComponent(env.header.msg_id)}`,
      {
        headers: { Authorization: `Bearer ${token75001}` },
      },
    );
    expect(statusOkRes.status).toBe(200);
    const statusOkBody = (await statusOkRes.json()) as Record<string, unknown>;
    expect(statusOkBody).not.toHaveProperty('header');
    expect(statusOkBody.code).toBe('CM_SUCCESS');
    expect(statusOkBody.data).toEqual(pushBody.data);

    // 3.2 Status 404
    const status404Res = await fetch(
      `${baseUrl}/api/platform/gksk-lai-xe/status?msg_id=7500126112300000000000040008000000000000000`,
      {
        headers: { Authorization: `Bearer ${token75001}` },
      },
    );
    expect(status404Res.status).toBe(404);
    const status404Body = (await status404Res.json()) as Record<string, unknown>;
    expect(status404Body).not.toHaveProperty('header');
    expect(status404Body.code).toBe('CM_INVALID_REQUEST');
    expect(status404Body.data).toBeNull();
  });

  it('Kịch bản 4.1 → 4.5: 5 nhóm giấy bị từ chối đều trả HTTP 200 (PS_SYNC_SUCCESS) với data.status = "rejected"', async () => {
    const rejectionScenarios = [
      {
        name: '4.1 — Sai mã CSYT (IDBENHVIEN khác tài khoản)',
        xml: buildTestXml(makeValidRecord({ SO: 'TEST.75001.401', IDBENHVIEN: '75999' })),
        expectedErrorCode: 'GKSK_FACILITY_MISMATCH',
      },
      {
        name: '4.2 — Thiếu trường bắt buộc (SO, HOTEN, SOCMND_PASSPORT) hoặc SO > 30 ký tự',
        xml: buildTestXml(
          makeValidRecord({
            SO: 'TEST.75001.SO.QUA.DAI.TREN.30.KY.TU.12345',
            HOTEN: '',
            SOCMND_PASSPORT: '',
          }),
        ),
        expectedErrorCode: 'GKSK_SO_TOO_LONG',
      },
      {
        name: '4.3 — Ngày sinh không hợp lệ (31/02/1990)',
        xml: buildTestXml(makeValidRecord({ SO: 'TEST.75001.403', NGAYSINH: '31/02/1990' })),
        expectedErrorCode: 'GKSK_NGAYSINH_INVALID',
      },
      {
        name: '4.4 — Ngày kết luận sai & thiếu kết luận',
        xml: buildTestXml(
          makeValidRecord({
            SO: 'TEST.75001.404',
            NGAYKETLUAN: '32/01/2026',
            KETLUAN: '',
          }),
        ),
        expectedErrorCode: 'GKSK_NGAYKETLUAN_INVALID',
      },
      {
        name: '4.5 — XML chứa DOCTYPE bị cấm (GKSK_XML_INVALID)',
        xml: '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE root>\n<root><SO>TEST.75001.405</SO></root>',
        expectedErrorCode: 'GKSK_XML_INVALID',
      },
    ];

    for (const scenario of rejectionScenarios) {
      const env = makeEnvelope({ xml: scenario.xml });
      const res = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'service-type': '100',
          Authorization: `Bearer ${token75001}`,
        },
        body: JSON.stringify(env),
      });

      expect(res.status, scenario.name).toBe(200);
      const body = (await res.json()) as {
        header: { res_code: string };
        data: MockPushData;
      };
      expect(body.header.res_code, scenario.name).toBe('PS_SYNC_SUCCESS');
      expect(body.data.status, scenario.name).toBe('rejected');
      expect(body.data.certificate_id, scenario.name).toBeNull();
      expect(
        body.data.errors.map((e) => e.code),
        scenario.name,
      ).toContain(scenario.expectedErrorCode);
    }

    // Kiểm tra thêm SO trống -> GKSK_SO_MISSING và XML > 1 MB -> GKSK_XML_INVALID
    const emptySoEnv = makeEnvelope({
      xml: buildTestXml(makeValidRecord({ SO: '' })),
    });
    const emptySoRes = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(emptySoEnv),
    });
    const emptySoBody = (await emptySoRes.json()) as { data: MockPushData };
    expect(emptySoBody.data.status).toBe('rejected');
    expect(emptySoBody.data.errors.map((e) => e.code)).toContain('GKSK_SO_MISSING');

    const over1MbXml = `<root><SO>TEST.75001.BIG</SO><LYDO>${'X'.repeat(1024 * 1024 + 100)}</LYDO></root>`;
    const over1MbEnv = makeEnvelope({ xml: over1MbXml });
    const over1MbRes = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(over1MbEnv),
    });
    const over1MbBody = (await over1MbRes.json()) as { data: MockPushData };
    expect(over1MbRes.status).toBe(200);
    expect(over1MbBody.data.status).toBe('rejected');
    expect(over1MbBody.data.errors.map((e) => e.code)).toContain('GKSK_XML_INVALID');
  });

  it('Kịch bản 4.6 & §8: Lỗi envelope trả HTTP 400/403/409 đúng mã res_code', async () => {
    // 4.6 Sai txn_type -> HTTP 400 CM_INVALID_REQUEST
    const badTxnEnv = makeEnvelope({ txnType: 'wrong_txn_type' });
    const badTxnRes = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(badTxnEnv),
    });
    expect(badTxnRes.status).toBe(400);
    const badTxnBody = (await badTxnRes.json()) as { header: { res_code: string } };
    expect(badTxnBody.header.res_code).toBe('CM_INVALID_REQUEST');

    // Thiếu service-type -> HTTP 400
    const noServiceTypeRes = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(makeEnvelope({})),
    });
    expect(noServiceTypeRes.status).toBe(400);

    // Chữ ký rỗng -> HTTP 400 PS_DS_RSA_SIGNATURE_MISSING
    const emptySigEnv = makeEnvelope({ overrideSignature: '   ' });
    const emptySigRes = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(emptySigEnv),
    });
    expect(emptySigRes.status).toBe(400);
    const emptySigBody = (await emptySigRes.json()) as { header: { res_code: string } };
    expect(emptySigBody.header.res_code).toBe('PS_DS_RSA_SIGNATURE_MISSING');

    // msg_id đã bị CSYT khác (75002) sử dụng -> HTTP 409 CM_INVALID_REQUEST
    const sharedMsgId = makeMsgId('75001');
    const firstPushRes = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(makeEnvelope({ msgId: sharedMsgId })),
    });
    expect(firstPushRes.status).toBe(200);

    const login75002Res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '75002', password: 'mock' }),
    });
    const token75002 = ((await login75002Res.json()) as { data: { token: string } }).data.token;

    const conflictEnv = makeEnvelope({
      senderId: '75002',
      msgId: sharedMsgId,
    });
    const conflictRes = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75002}`,
      },
      body: JSON.stringify(conflictEnv),
    });
    expect(conflictRes.status).toBe(409);
    const conflictBody = (await conflictRes.json()) as { header: { res_code: string } };
    expect(conflictBody.header.res_code).toBe('CM_INVALID_REQUEST');
  });

  it('Endpoint quản trị lỗi POST /__mock/fail hoạt động đúng cho 429 (có Retry-After), 500, 403-once và timeout', async () => {
    // 1. 429 với Retry-After
    await fetch(`${baseUrl}/__mock/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: '429', count: 1, retryAfterSec: 3 }),
    });

    const res429 = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(makeEnvelope({})),
    });
    expect(res429.status).toBe(429);
    expect(res429.headers.get('retry-after')).toBe('3');
    const body429 = (await res429.json()) as { header: { res_code: string } };
    expect(body429.header.res_code).toBe('CM_TOO_MANY_REQUESTS');

    // Lần gọi ngay sau đó thành công (vì count=1 đã tiêu thụ hết)
    const resAfter429 = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(makeEnvelope({})),
    });
    expect(resAfter429.status).toBe(200);

    // 2. 500
    await fetch(`${baseUrl}/__mock/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: '500', count: 1 }),
    });
    const res500 = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(makeEnvelope({})),
    });
    expect(res500.status).toBe(500);

    // 3. 403-once
    await fetch(`${baseUrl}/__mock/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: '403-once', count: 1 }),
    });
    const res403 = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token75001}`,
      },
      body: JSON.stringify(makeEnvelope({})),
    });
    expect(res403.status).toBe(403);

    // 4. timeout
    await fetch(`${baseUrl}/__mock/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'timeout', count: 1, timeoutMs: 250 }),
    });
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 60);
    await expect(
      fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'service-type': '100',
          Authorization: `Bearer ${token75001}`,
        },
        body: JSON.stringify(makeEnvelope({})),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    clearTimeout(abortTimer);
  });

  it('Cờ MOCK_VERIFY_SIGNATURE=1 kiểm tra chữ ký RSA 2048-bit thật bằng public key', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const rsaApp = createMockGkskApp({
      verifySignature: true,
      publicKeyPem: publicKey,
    });
    const rsaServer = await new Promise<Server>((resolve) => {
      const s = rsaApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    const rsaPort = (rsaServer.address() as AddressInfo).port;
    const rsaBaseUrl = `http://127.0.0.1:${rsaPort}`;

    try {
      const loginRes = await fetch(`${rsaBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: '75001', password: 'mock' }),
      });
      const rsaToken = ((await loginRes.json()) as { data: { token: string } }).data.token;

      // Gửi chữ ký giả CHUA-KY-... -> bị từ chối HTTP 400 PS_DS_RSA_SIGNATURE_INVALID
      const unsignedEnv = makeEnvelope({});
      const badSigRes = await fetch(`${rsaBaseUrl}/api/platform/gksk-lai-xe/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'service-type': '100',
          Authorization: `Bearer ${rsaToken}`,
        },
        body: JSON.stringify(unsignedEnv),
      });
      expect(badSigRes.status).toBe(400);
      const badSigBody = (await badSigRes.json()) as { header: { res_code: string } };
      expect(badSigBody.header.res_code).toBe('PS_DS_RSA_SIGNATURE_INVALID');

      // Gửi chữ ký RSA thật -> HTTP 200 accepted
      const signedEnv = makeEnvelope({ privateKeyPem: privateKey });
      const goodSigRes = await fetch(`${rsaBaseUrl}/api/platform/gksk-lai-xe/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'service-type': '100',
          Authorization: `Bearer ${rsaToken}`,
        },
        body: JSON.stringify(signedEnv),
      });
      expect(goodSigRes.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => {
        rsaServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
