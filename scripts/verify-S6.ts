import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIELD_ORDER } from '../packages/shared/src/index.js';
import { createMockGkskApp, type MockPushData } from '../tools/mock-gksk-api/src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'S6');
const REPORT_OUT = path.join(EVIDENCE_DIR, 'postman-scenarios-report.md');
const VERIFY_OUT = path.join(EVIDENCE_DIR, 'verify-output.txt');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`VERIFY S6 FAILED: ${message}`);
  }
}

function makeRecord(overrides: Record<string, string> = {}): Record<string, string> {
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

function buildXml(record: Record<string, string>, extraInnerXml = ''): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<root>'];
  for (const tag of FIELD_ORDER) {
    lines.push(`  <${tag}>${record[tag] ?? ''}</${tag}>`);
  }
  if (extraInnerXml) {
    lines.push(`  ${extraInnerXml}`);
  }
  lines.push('</root>');
  return `${lines.join('\n')}\n`;
}

function makeMsgId(senderId = '75001'): string {
  const vnIso = new Date(Date.now() + 7 * 3600 * 1000).toISOString();
  const yymmdd = vnIso.slice(2, 4) + vnIso.slice(5, 7) + vnIso.slice(8, 10);
  const uuid = crypto.randomUUID().replace(/-/g, '').toLowerCase();
  return `${senderId}${yymmdd}${uuid}`;
}

function sha256Upper(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

function buildTestEnvelope(params: {
  senderId?: string;
  txnType?: string;
  msgId?: string;
  xml: string;
}) {
  const senderId = params.senderId ?? '75001';
  const msgId = params.msgId ?? makeMsgId(senderId);
  const header = {
    version: '1.0.6',
    sender_id: senderId,
    receiver_id: 'TTYQG',
    txn_type: params.txnType ?? 'sync_gksk_lai_xe',
    msg_id: msgId,
    msg_type: '101',
    data_type: 'xml/base64',
    send_datetime: 1781084650736,
  };
  const data = Buffer.from(params.xml, 'utf8').toString('base64');
  const signed = `${sha256Upper(JSON.stringify(header))}.${sha256Upper(data.trim())}`;
  const signature = `CHUA-KY-${signed.slice(0, 16)}`;
  return { header, data, signature };
}

interface ScenarioLog {
  id: string;
  title: string;
  method: string;
  endpoint: string;
  requestSummary: string;
  httpStatus: number;
  responseSummary: string;
  rawResponseJson: unknown;
  passed: boolean;
}

async function runVerification(): Promise<void> {
  // 1. Kiểm tra tĩnh cô lập mã nguồn: tools/mock-gksk-api KHÔNG import từ server/
  const mockSrcDir = path.join(ROOT_DIR, 'tools', 'mock-gksk-api', 'src');
  const mockFiles = fs.readdirSync(mockSrcDir).filter((f) => f.endsWith('.ts'));
  assert(mockFiles.length >= 2, 'Thiếu file nguồn trong tools/mock-gksk-api/src');
  for (const fileName of mockFiles) {
    const content = fs.readFileSync(path.join(mockSrcDir, fileName), 'utf8');
    assert(
      !content.includes('@gksk/server') && !content.includes('/server/'),
      `File tools/mock-gksk-api/src/${fileName} vi phạm quy tắc cô lập: import từ server/`,
    );
  }

  // 2. Khởi chạy Mock API Server thật trên cổng local
  const app = createMockGkskApp({ currentYear: 2026 });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const logs: ScenarioLog[] = [];

  try {
    // --- Kịch bản 1.1: Login thành công ---
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '75001', password: 'mock' }),
    });
    const loginBody = (await loginRes.json()) as {
      header: { res_code: string; success: boolean };
      data: { token: string; duration: number };
    };
    const token = loginBody.data?.token ?? '';
    const pass11 =
      loginRes.status === 200 &&
      loginBody.header.res_code === 'CM_SUCCESS' &&
      loginBody.header.success === true &&
      token.length > 0 &&
      loginBody.data.duration === 720;
    assert(pass11, 'Kịch bản 1.1 thất bại');
    logs.push({
      id: '1.1',
      title: 'Đăng nhập CSYT hợp lệ (`75001`)',
      method: 'POST',
      endpoint: '/api/auth/login',
      requestSummary: '`{"username":"75001","password":"***"}`',
      httpStatus: loginRes.status,
      responseSummary: `res_code=${loginBody.header.res_code}, duration=${loginBody.data.duration}, token=<issued>`,
      rawResponseJson: {
        ...loginBody,
        data: { ...loginBody.data, token: '<REDACTED_MOCK_TOKEN>', refresh_token: '<REDACTED>' },
      },
      passed: pass11,
    });

    // --- Kịch bản 1.2: Login sai mật khẩu ---
    const badLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '75001', password: 'wrong_password' }),
    });
    const badLoginBody = (await badLoginRes.json()) as {
      header: { res_code: string; success: boolean };
      data: null;
    };
    const pass12 =
      badLoginRes.status === 401 &&
      badLoginBody.header.success === false &&
      badLoginBody.data === null;
    assert(pass12, 'Kịch bản 1.2 thất bại');
    logs.push({
      id: '1.2',
      title: 'Đăng nhập sai mật khẩu (từ chối, không trả token)',
      method: 'POST',
      endpoint: '/api/auth/login',
      requestSummary: '`{"username":"75001","password":"wrong_password"}`',
      httpStatus: badLoginRes.status,
      responseSummary: `res_code=${badLoginBody.header.res_code}, success=false, data=null`,
      rawResponseJson: badLoginBody,
      passed: pass12,
    });

    // --- Kịch bản 2.1: Push XML chưa ký hợp lệ -> accepted + GKSK_UNSIGNED ---
    const env21 = buildTestEnvelope({
      xml: buildXml(makeRecord({ SO: 'TEST.75001.S6.001' })),
    });
    const res21 = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(env21),
    });
    const body21 = (await res21.json()) as {
      header: { res_code: string; ref_msg_id: string };
      data: MockPushData;
    };
    const pass21 =
      res21.status === 200 &&
      body21.header.res_code === 'PS_SYNC_SUCCESS' &&
      body21.header.ref_msg_id === env21.header.msg_id &&
      body21.data.status === 'accepted' &&
      Boolean(body21.data.submission_id) &&
      Boolean(body21.data.certificate_id) &&
      body21.data.warnings.length === 1 &&
      body21.data.warnings[0]?.code === 'GKSK_UNSIGNED';
    assert(pass21, 'Kịch bản 2.1 thất bại');
    logs.push({
      id: '2.1',
      title: 'Push XML hợp lệ chưa ký số (`accepted` + `GKSK_UNSIGNED`)',
      method: 'POST',
      endpoint: '/api/platform/gksk-lai-xe/push',
      requestSummary: `msg_id=\`${env21.header.msg_id}\`, SO=\`TEST.75001.S6.001\``,
      httpStatus: res21.status,
      responseSummary: `status=${body21.data.status}, submission_id=${body21.data.submission_id}, certificate_id=${body21.data.certificate_id}, warnings=[GKSK_UNSIGNED]`,
      rawResponseJson: body21,
      passed: pass21,
    });

    // --- Kịch bản 2.2: Gửi lại cùng msg_id (idempotent) -> trả cùng submission_id ---
    const res22 = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(env21),
    });
    const body22 = (await res22.json()) as {
      header: { res_code: string; ref_msg_id: string };
      data: MockPushData;
    };
    const pass22 =
      res22.status === 200 &&
      body22.data.status === 'accepted' &&
      body22.data.submission_id === body21.data.submission_id &&
      body22.data.certificate_id === body21.data.certificate_id;
    assert(pass22, 'Kịch bản 2.2 thất bại: submission_id không khớp');
    logs.push({
      id: '2.2',
      title: 'Gửi lại cùng `msg_id` (Idempotent) -> trả cùng `submission_id`',
      method: 'POST',
      endpoint: '/api/platform/gksk-lai-xe/push',
      requestSummary: `Cùng msg_id=\`${env21.header.msg_id}\``,
      httpStatus: res22.status,
      responseSummary: `status=${body22.data.status}, cùng submission_id=${body22.data.submission_id}`,
      rawResponseJson: body22,
      passed: pass22,
    });

    // --- Kịch bản 2.3: Cùng SO, msg_id mới -> ghi đè, giữ cùng certificate_id + GKSK_STATE_ADD_EXISTS ---
    const env23 = buildTestEnvelope({
      xml: buildXml(makeRecord({ SO: 'TEST.75001.S6.001', HOTEN: 'TEST NGUYEN VAN A CAP NHAT' })),
    });
    const res23 = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(env23),
    });
    const body23 = (await res23.json()) as { data: MockPushData };
    const pass23 =
      res23.status === 200 &&
      body23.data.status === 'accepted' &&
      body23.data.submission_id !== body21.data.submission_id &&
      body23.data.certificate_id === body21.data.certificate_id &&
      body23.data.warnings.some((w) => w.code === 'GKSK_STATE_ADD_EXISTS');
    assert(pass23, 'Kịch bản 2.3 thất bại: certificate_id không giữ nguyên');
    logs.push({
      id: '2.3',
      title: 'Cùng `SO`, `msg_id` mới -> ghi đè giữ cùng `certificate_id` + `GKSK_STATE_ADD_EXISTS`',
      method: 'POST',
      endpoint: '/api/platform/gksk-lai-xe/push',
      requestSummary: `msg_id mới=\`${env23.header.msg_id}\`, cùng SO=\`TEST.75001.S6.001\``,
      httpStatus: res23.status,
      responseSummary: `status=${body23.data.status}, giữ cùng certificate_id=${body23.data.certificate_id}, warnings=[GKSK_UNSIGNED, GKSK_STATE_ADD_EXISTS]`,
      rawResponseJson: body23,
      passed: pass23,
    });

    // --- Kịch bản 2.4: Push có cảnh báo không chặn (§10) ---
    const env24 = buildTestEnvelope({
      xml: buildXml(
        makeRecord({
          SO: 'TEST.75001.S6.002',
          KETLUAN: 'A0-9',
          GIOITINHVAL: '9',
          NONGDOCON: 'abc',
          DVINONGDOCON: '9',
          MATUY: '9',
          NGAYKHAM: '31/02/2026',
          SOCMND_PASSPORT: '000000000000',
          NOICAP: 'N'.repeat(31),
        }),
        '<EXTRA_TAG>test</EXTRA_TAG>',
      ),
    });
    const res24 = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(env24),
    });
    const body24 = (await res24.json()) as { data: MockPushData };
    const warnCodes24 = body24.data.warnings.map((w) => w.code);
    const pass24 =
      res24.status === 200 &&
      body24.data.status === 'accepted' &&
      warnCodes24.includes('GKSK_KETLUAN_UNKNOWN') &&
      warnCodes24.includes('GKSK_GIOITINH_UNKNOWN') &&
      warnCodes24.includes('GKSK_NONGDOCON_INVALID') &&
      warnCodes24.includes('GKSK_DVINONGDOCON_INVALID') &&
      warnCodes24.includes('GKSK_MATUY_INVALID') &&
      warnCodes24.includes('GKSK_DATE_INVALID') &&
      warnCodes24.includes('GKSK_ID_INVALID') &&
      warnCodes24.includes('GKSK_UNKNOWN_TAG') &&
      warnCodes24.includes('GKSK_FIELD_TOO_LONG');
    assert(pass24, 'Kịch bản 2.4 thất bại');
    logs.push({
      id: '2.4',
      title: 'Push giấy có các cảnh báo §10 (vẫn `accepted`, trả đủ mã `warnings`)',
      method: 'POST',
      endpoint: '/api/platform/gksk-lai-xe/push',
      requestSummary: `SO=\`TEST.75001.S6.002\`, kèm 9 trường kích hoạt cảnh báo §10`,
      httpStatus: res24.status,
      responseSummary: `status=${body24.data.status}, warnings=[${warnCodes24.join(', ')}]`,
      rawResponseJson: body24,
      passed: pass24,
    });

    // --- Kịch bản 3.1: Tra cứu status theo msg_id đã gửi -> HTTP 200 (không có header) ---
    const res31 = await fetch(
      `${baseUrl}/api/platform/gksk-lai-xe/status?msg_id=${encodeURIComponent(env21.header.msg_id)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const body31 = (await res31.json()) as {
      code: string;
      message: string;
      data: MockPushData;
      header?: unknown;
    };
    const pass31 =
      res31.status === 200 &&
      !('header' in body31) &&
      body31.code === 'CM_SUCCESS' &&
      JSON.stringify(body31.data) === JSON.stringify(body21.data);
    assert(pass31, 'Kịch bản 3.1 thất bại');
    logs.push({
      id: '3.1',
      title: 'Tra cứu `status` theo `msg_id` đã gửi -> HTTP 200 `data` y hệt lúc push (không có `header`)',
      method: 'GET',
      endpoint: `/api/platform/gksk-lai-xe/status?msg_id=${env21.header.msg_id}`,
      requestSummary: `query \`msg_id=${env21.header.msg_id}\``,
      httpStatus: res31.status,
      responseSummary: `code=${body31.code}, không có header, data khớp 100% lúc push`,
      rawResponseJson: body31,
      passed: pass31,
    });

    // --- Kịch bản 3.2: Tra cứu status với msg_id lạ -> HTTP 404 ---
    const unknownMsgId = '7500126112300000000000040008000000000000999';
    const res32 = await fetch(
      `${baseUrl}/api/platform/gksk-lai-xe/status?msg_id=${unknownMsgId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const body32 = (await res32.json()) as {
      code: string;
      message: string;
      data: null;
      header?: unknown;
    };
    const pass32 =
      res32.status === 404 &&
      !('header' in body32) &&
      body32.code === 'CM_INVALID_REQUEST' &&
      body32.data === null;
    assert(pass32, 'Kịch bản 3.2 thất bại');
    logs.push({
      id: '3.2',
      title: 'Tra cứu `status` với `msg_id` chưa từng gửi -> HTTP 404',
      method: 'GET',
      endpoint: `/api/platform/gksk-lai-xe/status?msg_id=${unknownMsgId}`,
      requestSummary: `query \`msg_id=${unknownMsgId}\``,
      httpStatus: res32.status,
      responseSummary: `HTTP 404, code=${body32.code}, data=null`,
      rawResponseJson: body32,
      passed: pass32,
    });

    // --- Kịch bản 4.1 -> 4.5: 5 kịch bản rejected trả HTTP 200 ---
    const rejectCases = [
      {
        id: '4.1',
        title: 'Từ chối giấy: `IDBENHVIEN` khác mã CSYT tài khoản (`GKSK_FACILITY_MISMATCH`)',
        xml: buildXml(makeRecord({ SO: 'TEST.75001.REJ.401', IDBENHVIEN: '75999' })),
        expectedCode: 'GKSK_FACILITY_MISMATCH',
      },
      {
        id: '4.2',
        title: 'Từ chối giấy: Thiếu `SO` / `HOTEN` / `SOCMND_PASSPORT` (`GKSK_SO_MISSING`, `GKSK_HOTEN_INVALID`, `GKSK_ID_MISSING`)',
        xml: buildXml(makeRecord({ SO: '', HOTEN: '', SOCMND_PASSPORT: '' })),
        expectedCode: 'GKSK_SO_MISSING',
      },
      {
        id: '4.3',
        title: 'Từ chối giấy: `NGAYSINH` không hợp lệ (`31/02/1990` -> `GKSK_NGAYSINH_INVALID`)',
        xml: buildXml(makeRecord({ SO: 'TEST.75001.REJ.403', NGAYSINH: '31/02/1990' })),
        expectedCode: 'GKSK_NGAYSINH_INVALID',
      },
      {
        id: '4.4',
        title: 'Từ chối giấy: `NGAYKETLUAN` sai & thiếu `KETLUAN` (`GKSK_NGAYKETLUAN_INVALID`, `GKSK_KETLUAN_MISSING`)',
        xml: buildXml(
          makeRecord({ SO: 'TEST.75001.REJ.404', NGAYKETLUAN: '32/01/2026', KETLUAN: '' }),
        ),
        expectedCode: 'GKSK_NGAYKETLUAN_INVALID',
      },
      {
        id: '4.5',
        title: 'Từ chối giấy: XML chứa `DOCTYPE` bị cấm (`GKSK_XML_INVALID`)',
        xml: '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE root>\n<root><SO>TEST.75001.REJ.405</SO></root>',
        expectedCode: 'GKSK_XML_INVALID',
      },
    ];

    for (const rc of rejectCases) {
      const env = buildTestEnvelope({ xml: rc.xml });
      const res = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'service-type': '100',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(env),
      });
      const body = (await res.json()) as {
        header: { res_code: string };
        data: MockPushData;
      };
      const errorCodes = body.data.errors.map((e) => e.code);
      const passed =
        res.status === 200 &&
        body.header.res_code === 'PS_SYNC_SUCCESS' &&
        body.data.status === 'rejected' &&
        body.data.certificate_id === null &&
        errorCodes.includes(rc.expectedCode);
      assert(passed, `Kịch bản ${rc.id} thất bại`);
      logs.push({
        id: rc.id,
        title: rc.title,
        method: 'POST',
        endpoint: '/api/platform/gksk-lai-xe/push',
        requestSummary: `msg_id=\`${env.header.msg_id}\` (kỳ vọng rejected: \`${rc.expectedCode}\`)`,
        httpStatus: res.status,
        responseSummary: `HTTP 200 (res_code=PS_SYNC_SUCCESS), data.status=rejected, errors=[${errorCodes.join(', ')}]`,
        rawResponseJson: body,
        passed,
      });
    }

    // --- Kịch bản 4.6: Lỗi envelope (txn_type sai) -> HTTP 400 ---
    const env46 = buildTestEnvelope({
      txnType: 'invalid_txn_type',
      xml: buildXml(makeRecord({ SO: 'TEST.75001.406' })),
    });
    const res46 = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(env46),
    });
    const body46 = (await res46.json()) as {
      header: { res_code: string; res_msg: string };
      data: null;
    };
    const pass46 =
      res46.status === 400 &&
      body46.header.res_code === 'CM_INVALID_REQUEST' &&
      body46.data === null;
    assert(pass46, 'Kịch bản 4.6 thất bại');
    logs.push({
      id: '4.6',
      title: 'Lỗi Envelope: `header.txn_type` sai -> HTTP 400 `CM_INVALID_REQUEST`',
      method: 'POST',
      endpoint: '/api/platform/gksk-lai-xe/push',
      requestSummary: `header.txn_type=\`invalid_txn_type\``,
      httpStatus: res46.status,
      responseSummary: `HTTP 400, res_code=${body46.header.res_code}, res_msg="${body46.header.res_msg}"`,
      rawResponseJson: body46,
      passed: pass46,
    });

    // --- Kịch bản bổ sung: Ép lỗi 429 qua POST /__mock/fail -> trả HTTP 429 kèm Retry-After ---
    await fetch(`${baseUrl}/__mock/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: '429', count: 1, retryAfterSec: 5 }),
    });
    const env429 = buildTestEnvelope({
      xml: buildXml(makeRecord({ SO: 'TEST.75001.429' })),
    });
    const res429 = await fetch(`${baseUrl}/api/platform/gksk-lai-xe/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'service-type': '100',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(env429),
    });
    const retryAfterHeader = res429.headers.get('retry-after');
    const body429 = (await res429.json()) as {
      header: { res_code: string; res_msg: string };
      data: null;
    };
    const pass429 =
      res429.status === 429 &&
      retryAfterHeader === '5' &&
      body429.header.res_code === 'CM_TOO_MANY_REQUESTS';
    assert(pass429, 'Kịch bản ép lỗi 429 Retry-After thất bại');
    logs.push({
      id: 'MOCK-429',
      title: 'Điều khiển lỗi `POST /__mock/fail {mode:"429", count:1, retryAfterSec:5}` -> HTTP 429 + `Retry-After: 5`',
      method: 'POST',
      endpoint: '/api/platform/gksk-lai-xe/push',
      requestSummary: `Bật /__mock/fail mode=429 rồi gọi push msg_id=\`${env429.header.msg_id}\``,
      httpStatus: res429.status,
      responseSummary: `HTTP 429, Header Retry-After=${retryAfterHeader}, res_code=${body429.header.res_code}`,
      rawResponseJson: body429,
      passed: pass429,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  // 3. Xuất báo cáo Markdown chi tiết ra docs/evidence/S6/postman-scenarios-report.md
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const mdLines: string[] = [
    '# Báo cáo Kiểm chứng Bước S6 — Mock GKSK API Server (`1.1 → 4.6` & `429 Retry-After`)',
    '',
    `- **Thời điểm kiểm chứng**: \`${new Date().toISOString()}\``,
    '- **Module kiểm chứng**: `tools/mock-gksk-api` (`@gksk/mock-gksk-api`)',
    '- **Kiểm tra cô lập kiến trúc**: `PASS` — `tools/mock-gksk-api` hoàn toàn không import từ `server/` (chỉ dùng `@gksk/shared`).',
    `- **Tổng số kịch bản thực thi**: **${logs.length}/${logs.length} PASS (100%)**`,
    '',
    '## 1. Bảng Tổng hợp Kết quả Kịch bản Postman (`1.1 → 4.6` & `MOCK-429`)',
    '',
    '| Kịch bản | Mô tả | Endpoint | HTTP | Kết quả Tóm tắt | Trạng thái |',
    '|---|---|---|---:|---|---|',
    ...logs.map(
      (item) =>
        `| **${item.id}** | ${item.title} | \`${item.method} ${item.endpoint.split('?')[0]}\` | \`${item.httpStatus}\` | ${item.responseSummary} | ${item.passed ? '✅ PASS' : '❌ FAIL'} |`,
    ),
    '',
    '## 2. Chi tiết Request & Response từng Kịch bản',
    '',
    ...logs.flatMap((item) => [
      `### Kịch bản ${item.id}: ${item.title}`,
      `- **Request**: \`${item.method} ${item.endpoint}\` — ${item.requestSummary}`,
      `- **HTTP Status**: \`${item.httpStatus}\``,
      `- **Tóm tắt**: ${item.responseSummary}`,
      '- **Response Body (JSON)**:',
      '```json',
      JSON.stringify(item.rawResponseJson, null, 2),
      '```',
      '',
    ]),
  ];

  const mdContent = mdLines.join('\n');
  fs.writeFileSync(REPORT_OUT, mdContent, 'utf8');
  fs.writeFileSync(VERIFY_OUT, mdContent, 'utf8');
  process.stdout.write(
    `[verify-S6] PASS 100% (${logs.length}/${logs.length} scenarios). Report written to docs/evidence/S6/postman-scenarios-report.md\n`,
  );
}

runVerification().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
