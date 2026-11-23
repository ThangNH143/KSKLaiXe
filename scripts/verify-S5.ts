import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEnvelope,
  formatVnYyMmDd,
  newMsgId,
} from '../server/src/gksk/envelope.js';
import {
  computeEnvelopeSignatureParts,
  ENVELOPE_HEADER_KEYS,
  verifyEnvelopeSignature,
} from '../server/src/gksk/signature.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'S5');
const SAMPLE_ENVELOPE_OUT = path.join(EVIDENCE_DIR, 'sample-envelope.json');
const VERIFY_OUT = path.join(EVIDENCE_DIR, 'verify-output.txt');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`VERIFY S5 FAILED: ${message}`);
  }
}

// 1. Dữ liệu Golden Vector tại docs/API-CONTRACT.md §5
const EXPECTED = {
  senderId: '75001',
  msgId: '75001261123a3f1c2e4b5d44e7f8a9b0c1d2e3f4a5b',
  sendDatetime: 1781084650736,
  xml: '<root><SO>TEST.75001.1</SO></root>',
  headerKeys: 'version,sender_id,receiver_id,txn_type,msg_id,msg_type,data_type,send_datetime',
  headerJson:
    '{"version":"1.0.6","sender_id":"75001","receiver_id":"TTYQG","txn_type":"sync_gksk_lai_xe","msg_id":"75001261123a3f1c2e4b5d44e7f8a9b0c1d2e3f4a5b","msg_type":"101","data_type":"xml/base64","send_datetime":1781084650736}',
  data: 'PHJvb3Q+PFNPPlRFU1QuNzUwMDEuMTwvU08+PC9yb290Pg==',
  H: '6A618CAF5E36F31A4A779636EB2C34E9C4FCE1FFF20BE0A29D39CC9C0F04EC8F',
  D: '2D626275B6434A748DCF1A2A4A535C556C1C52EDDA981FE16967F937D599C11E',
  signed:
    '6A618CAF5E36F31A4A779636EB2C34E9C4FCE1FFF20BE0A29D39CC9C0F04EC8F.2D626275B6434A748DCF1A2A4A535C556C1C52EDDA981FE16967F937D599C11E',
  signatureNoKey: 'CHUA-KY-6A618CAF5E36F31A',
} as const;

// 2. Dựng gói tin Golden Vector (chế độ không khóa RSA) và lưu ra docs/evidence/S5/sample-envelope.json
const goldenEnvelope = buildEnvelope({
  senderId: EXPECTED.senderId,
  xml: EXPECTED.xml,
  msgId: EXPECTED.msgId,
  sendDatetime: EXPECTED.sendDatetime,
});

const partsNoKey = computeEnvelopeSignatureParts(goldenEnvelope.header, goldenEnvelope.data);
const actualHeaderKeys = Object.keys(goldenEnvelope.header).join(',');

const goldenRows = [
  {
    field: 'Object.keys(header)',
    expected: EXPECTED.headerKeys,
    actual: actualHeaderKeys,
    match: actualHeaderKeys === EXPECTED.headerKeys,
  },
  {
    field: 'headerJson',
    expected: EXPECTED.headerJson,
    actual: partsNoKey.headerJson,
    match: partsNoKey.headerJson === EXPECTED.headerJson,
  },
  {
    field: 'data (Base64 UTF-8)',
    expected: EXPECTED.data,
    actual: goldenEnvelope.data,
    match: goldenEnvelope.data === EXPECTED.data,
  },
  {
    field: 'H = SHA256_UPPER(headerJson)',
    expected: EXPECTED.H,
    actual: partsNoKey.headerHash,
    match: partsNoKey.headerHash === EXPECTED.H,
  },
  {
    field: 'D = SHA256_UPPER(data.trim())',
    expected: EXPECTED.D,
    actual: partsNoKey.dataHash,
    match: partsNoKey.dataHash === EXPECTED.D,
  },
  {
    field: 'signed = H + "." + D',
    expected: EXPECTED.signed,
    actual: partsNoKey.signedPayload,
    match: partsNoKey.signedPayload === EXPECTED.signed,
  },
  {
    field: 'signature (không khóa RSA)',
    expected: EXPECTED.signatureNoKey,
    actual: goldenEnvelope.signature,
    match: goldenEnvelope.signature === EXPECTED.signatureNoKey,
  },
];

for (const row of goldenRows) {
  assert(
    row.match,
    `Golden Vector lệch tại ${row.field}:\n  Expected: ${row.expected}\n  Actual  : ${row.actual}`,
  );
}

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.writeFileSync(SAMPLE_ENVELOPE_OUT, `${JSON.stringify(goldenEnvelope, null, 2)}\n`, 'utf8');

// Kiểm tra đọc lại sample-envelope.json từ đĩa giữ nguyên đúng 8 khóa header
const diskEnvelope = JSON.parse(fs.readFileSync(SAMPLE_ENVELOPE_OUT, 'utf8')) as typeof goldenEnvelope;
assert(
  Object.keys(diskEnvelope.header).join(',') === ENVELOPE_HEADER_KEYS.join(','),
  'sample-envelope.json trên đĩa bị sai thứ tự 8 khóa header',
);
assert(
  JSON.stringify(diskEnvelope.header) === EXPECTED.headerJson,
  'JSON.stringify(diskEnvelope.header) không khớp Golden Vector',
);

// 3. Kiểm chứng ký và xác thực RSA 2048-bit thật (RSA-PKCS1v1.5-SHA256)
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const rsaEnvelope = buildEnvelope({
  senderId: EXPECTED.senderId,
  xml: EXPECTED.xml,
  msgId: EXPECTED.msgId,
  sendDatetime: EXPECTED.sendDatetime,
  privateKeyPem: privateKey,
});

const rsaVerifiedByNode = crypto.verify(
  'sha256',
  Buffer.from(EXPECTED.signed, 'utf8'),
  publicKey,
  Buffer.from(rsaEnvelope.signature, 'base64'),
);
const rsaVerifiedByHelper = verifyEnvelopeSignature(
  rsaEnvelope.header,
  rsaEnvelope.data,
  rsaEnvelope.signature,
  publicKey,
);
assert(rsaVerifiedByNode && rsaVerifiedByHelper, 'Xác thực chữ ký RSA 2048-bit thất bại');

// 4. Kiểm chứng newMsgId ở mốc giao thừa giờ Việt Nam (UTC+7) trên nhiều TZ + 10.000 msg_id không trùng
const msgIdRegex = /^75001\d{6}[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/;
const beforeVnMidnightMs = Date.parse('2026-11-23T16:59:59Z'); // 23:59:59 VN -> 261123
const afterVnMidnightMs = Date.parse('2026-11-23T17:30:00Z'); // 00:30:00 VN -> 261124

const originalTz = process.env.TZ;
const tzChecks: Array<{ tz: string; beforePrefix: string; afterPrefix: string }> = [];

try {
  for (const tz of ['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles', 'Pacific/Auckland']) {
    process.env.TZ = tz;
    const mBefore = newMsgId('75001', beforeVnMidnightMs);
    const mAfter = newMsgId('75001', afterVnMidnightMs);

    assert(mBefore.length === 43 && msgIdRegex.test(mBefore), `msg_id sai định dạng ở TZ=${tz}`);
    assert(mAfter.length === 43 && msgIdRegex.test(mAfter), `msg_id sai định dạng ở TZ=${tz}`);
    assert(
      mBefore.slice(0, 11) === '75001261123' && formatVnYyMmDd(beforeVnMidnightMs) === '261123',
      `Sai YYMMDD tại 16:59:59Z ở TZ=${tz}: ${mBefore.slice(0, 11)}`,
    );
    assert(
      mAfter.slice(0, 11) === '75001261124' && formatVnYyMmDd(afterVnMidnightMs) === '261124',
      `Sai YYMMDD tại 17:30:00Z ở TZ=${tz}: ${mAfter.slice(0, 11)}`,
    );

    tzChecks.push({
      tz,
      beforePrefix: mBefore.slice(0, 11),
      afterPrefix: mAfter.slice(0, 11),
    });
  }
} finally {
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
}

const uniqueSet = new Set<string>();
for (let i = 0; i < 10_000; i += 1) {
  const id = newMsgId('75001', beforeVnMidnightMs);
  assert(msgIdRegex.test(id), `msg_id thứ ${i + 1} không khớp regex`);
  uniqueSet.add(id);
}
assert(uniqueSet.size === 10_000, `10.000 msg_id có trùng lặp: size=${uniqueSet.size}`);

// 5. Quét tĩnh mã nguồn envelope.ts & signature.ts đảm bảo không có Date.now() gọi trực tiếp
const envelopeSource = fs.readFileSync(
  path.join(ROOT_DIR, 'server', 'src', 'gksk', 'envelope.ts'),
  'utf8',
);
const signatureSource = fs.readFileSync(
  path.join(ROOT_DIR, 'server', 'src', 'gksk', 'signature.ts'),
  'utf8',
);
assert(
  !envelopeSource.includes('Date.now(') && !signatureSource.includes('Date.now('),
  'Phát hiện Date.now() gọi trực tiếp trong envelope.ts hoặc signature.ts',
);

// 6. Xuất báo cáo ra docs/evidence/S5/verify-output.txt
const reportLines: string[] = [
  '================================================================================',
  'GKSKLaiXe — KIỂM CHỨNG BƯỚC S5: MSG_ID (UTC+7), ENVELOPE & CHỮ KÝ GÓI TIN',
  '================================================================================',
  `Thời điểm chạy : ${new Date().toISOString()}`,
  `File gói tin   : docs/evidence/S5/sample-envelope.json`,
  `Báo cáo        : docs/evidence/S5/verify-output.txt`,
  '',
  '1. BẢNG ĐỐI CHIẾU TỪNG DÒNG GOLDEN VECTOR (docs/API-CONTRACT.md §5)',
  '--------------------------------------------------------------------------------',
  ...goldenRows.flatMap((row, index) => [
    `[${index + 1}] Trường   : ${row.field}`,
    `    Expected : ${row.expected}`,
    `    Actual   : ${row.actual}`,
    `    Kết quả  : ${row.match ? 'PASS (KHỚP 100% TỪNG KÝ TỰ)' : 'FAIL'}`,
    '',
  ]),
  '2. KIỂM CHỨNG KÝ & XÁC THỰC RSA-PKCS1v1.5-SHA256 (2048-BIT)',
  '--------------------------------------------------------------------------------',
  `   - Độ dài chữ ký Base64 (RSA 2048-bit) : ${rsaEnvelope.signature.length} ký tự`,
  `   - Mẫu chữ ký RSA (64 ký tự đầu)       : ${rsaEnvelope.signature.slice(0, 64)}...`,
  `   - crypto.verify('sha256', signed, ...) : ${rsaVerifiedByNode} [PASS]`,
  `   - verifyEnvelopeSignature(...)         : ${rsaVerifiedByHelper} [PASS]`,
  '',
  '3. KIỂM CHỨNG newMsgId(senderId, nowMs) THEO GIỜ VIỆT NAM (UTC+7 CỐ ĐỊNH)',
  '--------------------------------------------------------------------------------',
  '   - Mốc 1: 2026-11-23T16:59:59Z (tức 23:59:59 ngày 23/11/2026 giờ VN) -> YYMMDD = 261123',
  '   - Mốc 2: 2026-11-23T17:30:00Z (tức 00:30:00 ngày 24/11/2026 giờ VN) -> YYMMDD = 261124',
  ...tzChecks.map(
    (item) =>
      `   [PASS] TZ=${item.tz.padEnd(20, ' ')} | 16:59:59Z -> ${item.beforePrefix} | 17:30:00Z -> ${item.afterPrefix}`,
  ),
  `   [PASS] Sinh 10.000 msg_id liên tiếp: ${uniqueSet.size}/10.000 duy nhất (0 trùng), 100% dài 43 ký tự & khớp regex UUID v4`,
  '',
  '4. KIỂM TRA TĨNH KHÔNG GỌI TRỰC TIẾP Date.now() TRONG LOGIC',
  '--------------------------------------------------------------------------------',
  '   [PASS] server/src/gksk/envelope.ts  : 0 lệnh gọi Date.now() (nhận nowMs & sendDatetime qua tham số)',
  '   [PASS] server/src/gksk/signature.ts : 0 lệnh gọi Date.now()',
  '',
  'KẾT LUẬN: PASS 100% — ĐẠT ĐỦ ĐIỀU KIỆN QUA CỔNG BƯỚC S5.',
  '',
];

const reportText = reportLines.join('\n');
fs.writeFileSync(VERIFY_OUT, reportText, 'utf8');
process.stdout.write(reportText);
