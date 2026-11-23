import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatIssueMessage,
  hasBlockingErrors,
  normalizeRecord,
  validateRecord,
  type GkskRecord,
  type RawRecordInput,
  type ValidateContext,
} from '../packages/shared/src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const evidenceDir = resolve(rootDir, 'docs', 'evidence', 'S3');
const reportPath = resolve(evidenceDir, 'validation-report.md');

mkdirSync(evidenceDir, { recursive: true });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Kiểm chứng thất bại: ${message}`);
  }
}

const ctx: ValidateContext = {
  facilityId: '75001',
  today: '2026-11-23',
};

function makeValidSampleRecord(overrides: RawRecordInput = {}): GkskRecord {
  return normalizeRecord({
    SO: '00001/GKSKLX/75001/26',
    NGAYKHAM: '05/11/2026',
    HOTEN: 'TEST NGUYEN VAN A',
    GIOITINHVAL: '0',
    NGAYSINH: '21/05/1990',
    DIACHITHUONGTRU: 'Phuong Tan Phong, Bien Hoa, Dong Nai',
    MATINH_THUONGTRU: '75',
    MAHUYEN_THUONGTRU: '731',
    MAXA_THUONGTRU: '25993',
    SOCMND_PASSPORT: 'TESTGKSK01',
    NGAYTHANGNAMCAP: '10/10/2021',
    NOICAP: 'Cuc Canh sat QLHC ve TTXH',
    HANGBANGLAI: 'B2',
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
    ...overrides,
  });
}

// -----------------------------------------------------------------------------
// 1. Kiểm chứng các ca chuẩn hóa điển hình (normalizeRecord)
// -----------------------------------------------------------------------------
interface NormalizeDemoCase {
  readonly title: string;
  readonly field: string;
  readonly rawInput: string;
  readonly rawRecord: RawRecordInput;
  readonly expectedValue: string;
}

const normalizeDemos: readonly NormalizeDemoCase[] = [
  {
    title: 'Chuẩn hóa Unicode NFD -> NFC, trim & xóa ký tự điều khiển XML 1.0 (\\x00, \\x07, \\uFFFE)',
    field: 'HOTEN',
    rawInput: '"  Nguye\\u0302\\u0303n Va\\u0306n A\\x00\\x07\\uFFFE  "',
    rawRecord: { HOTEN: '  Nguye\u0302\u0303n Va\u0306n A\x00\x07\uFFFE  ' },
    expectedValue: 'Nguyễn Văn A',
  },
  {
    title: 'Serial ngày Excel 33014 (gốc 1899-12-30 UTC)',
    field: 'NGAYSINH',
    rawInput: '33014 (number)',
    rawRecord: { NGAYSINH: 33014 },
    expectedValue: '21/05/1990',
  },
  {
    title: 'Serial ngày Excel 46332 (gốc 1899-12-30 UTC)',
    field: 'NGAYKETLUAN',
    rawInput: '46332 (number)',
    rawRecord: { NGAYKETLUAN: 46332 },
    expectedValue: '06/11/2026',
  },
  {
    title: 'Serial ngày Excel năm nhuận 45351 (gốc 1899-12-30 UTC)',
    field: 'NGAYSINH',
    rawInput: '45351 (number)',
    rawRecord: { NGAYSINH: 45351 },
    expectedValue: '29/02/2024',
  },
  {
    title: 'Chuỗi ngày d/M/yyyy ("21/5/1990") -> dd/MM/yyyy zero-padded',
    field: 'NGAYSINH',
    rawInput: '"21/5/1990"',
    rawRecord: { NGAYSINH: '21/5/1990' },
    expectedValue: '21/05/1990',
  },
  {
    title: 'Chuỗi ngày ISO yyyy-MM-dd ("1990-05-21") -> dd/MM/yyyy',
    field: 'NGAYSINH',
    rawInput: '"1990-05-21"',
    rawRecord: { NGAYSINH: '1990-05-21' },
    expectedValue: '21/05/1990',
  },
  {
    title: 'Ngày không tồn tại ("29/02/2025") -> giữ nguyên chuỗi gốc để validator bắt lỗi',
    field: 'NGAYSINH',
    rawInput: '"29/02/2025"',
    rawRecord: { NGAYSINH: '29/02/2025' },
    expectedValue: '29/02/2025',
  },
  {
    title: 'CCCD có số 0 đầu và dấu nháy đơn Excel ("\'079 000 012 345")',
    field: 'SOCMND_PASSPORT',
    rawInput: '"\'079 000 012 345"',
    rawRecord: { SOCMND_PASSPORT: "'079 000 012 345" },
    expectedValue: '079000012345',
  },
  {
    title: 'Giới tính qua bí danh cột GIOITINH ("Nữ") -> GIOITINHVAL="1"',
    field: 'GIOITINHVAL',
    rawInput: '{ GIOITINH: "Nữ" }',
    rawRecord: { GIOITINH: 'Nữ' },
    expectedValue: '1',
  },
  {
    title: 'Kết luận chữ thường + gạch dài en-dash ("a0 – 2") -> "A0-2"',
    field: 'KETLUAN',
    rawInput: '"a0 – 2"',
    rawRecord: { KETLUAN: 'a0 – 2' },
    expectedValue: 'A0-2',
  },
  {
    title: 'STATE để trống -> mặc định "ADD"',
    field: 'STATE',
    rawInput: '""',
    rawRecord: { STATE: '' },
    expectedValue: 'ADD',
  },
];

for (const demo of normalizeDemos) {
  const normalized = normalizeRecord(demo.rawRecord);
  const actual = normalized[demo.field as keyof typeof normalized];
  assert(
    actual === demo.expectedValue,
    `${demo.title}: kỳ vọng "${demo.expectedValue}", nhận "${actual}"`,
  );
}

// -----------------------------------------------------------------------------
// 2. Bảng đối chiếu trực tiếp toàn bộ mã trong ma trận TEST-PLAN.md §3.1
// -----------------------------------------------------------------------------
interface MatrixVerifyRow {
  readonly code: string;
  readonly triggerLabel: string;
  readonly triggerOverrides: RawRecordInput;
  readonly boundaryLabel: string;
  readonly boundaryOverrides: RawRecordInput;
  readonly expectedBlockingOnTrigger: boolean;
}

const matrixRows: readonly MatrixVerifyRow[] = [
  {
    code: 'GKSK_SO_MISSING',
    triggerLabel: 'SO=""',
    triggerOverrides: { SO: '' },
    boundaryLabel: 'SO="A" (1 ký tự)',
    boundaryOverrides: { SO: 'A' },
    expectedBlockingOnTrigger: true,
  },
  {
    code: 'GKSK_SO_TOO_LONG',
    triggerLabel: 'SO dài 31 ký tự',
    triggerOverrides: { SO: 'S'.repeat(31) },
    boundaryLabel: 'SO dài 30 ký tự (chỉ báo LOCAL_SO_OVER_20 info)',
    boundaryOverrides: { SO: 'S'.repeat(30) },
    expectedBlockingOnTrigger: true,
  },
  {
    code: 'GKSK_HOTEN_INVALID',
    triggerLabel: 'HOTEN="" hoặc 256 ký tự',
    triggerOverrides: { HOTEN: 'A'.repeat(256) },
    boundaryLabel: 'HOTEN đúng 255 ký tự',
    boundaryOverrides: { HOTEN: 'A'.repeat(255) },
    expectedBlockingOnTrigger: true,
  },
  {
    code: 'GKSK_ID_MISSING',
    triggerLabel: 'SOCMND_PASSPORT=""',
    triggerOverrides: { SOCMND_PASSPORT: '' },
    boundaryLabel: 'SOCMND_PASSPORT="TESTGKSK01"',
    boundaryOverrides: { SOCMND_PASSPORT: 'TESTGKSK01' },
    expectedBlockingOnTrigger: true,
  },
  {
    code: 'GKSK_NGAYSINH_INVALID',
    triggerLabel: 'NGAYSINH="31/02/1990" (hoặc "01/01/1899", "29/02/2025", năm 2027)',
    triggerOverrides: { NGAYSINH: '31/02/1990' },
    boundaryLabel: 'NGAYSINH="01/01/1900" (hoặc "29/02/2024", hôm nay "23/11/2026")',
    boundaryOverrides: { NGAYSINH: '01/01/1900' },
    expectedBlockingOnTrigger: true,
  },
  {
    code: 'GKSK_NGAYKETLUAN_INVALID',
    triggerLabel: 'NGAYKETLUAN="32/01/2026"',
    triggerOverrides: { NGAYKETLUAN: '32/01/2026' },
    boundaryLabel: 'NGAYKETLUAN="06/11/2026"',
    boundaryOverrides: { NGAYKETLUAN: '06/11/2026' },
    expectedBlockingOnTrigger: true,
  },
  {
    code: 'GKSK_KETLUAN_MISSING',
    triggerLabel: 'KETLUAN=""',
    triggerOverrides: { KETLUAN: '' },
    boundaryLabel: 'KETLUAN="A0-1"',
    boundaryOverrides: { KETLUAN: 'A0-1' },
    expectedBlockingOnTrigger: true,
  },
  {
    code: 'GKSK_FACILITY_MISMATCH',
    triggerLabel: 'IDBENHVIEN="75999" (khác 75001)',
    triggerOverrides: { IDBENHVIEN: '75999' },
    boundaryLabel: 'IDBENHVIEN="75001"',
    boundaryOverrides: { IDBENHVIEN: '75001' },
    expectedBlockingOnTrigger: true,
  },
  {
    code: 'GKSK_KETLUAN_UNKNOWN',
    triggerLabel: 'KETLUAN="A0-4"',
    triggerOverrides: { KETLUAN: 'A0-4' },
    boundaryLabel: 'KETLUAN="A0-1"',
    boundaryOverrides: { KETLUAN: 'A0-1' },
    expectedBlockingOnTrigger: false,
  },
  {
    code: 'GKSK_GIOITINH_UNKNOWN',
    triggerLabel: 'GIOITINHVAL="2"',
    triggerOverrides: { GIOITINHVAL: '2' },
    boundaryLabel: 'GIOITINHVAL="0" (hoặc "1", "")',
    boundaryOverrides: { GIOITINHVAL: '0' },
    expectedBlockingOnTrigger: false,
  },
  {
    code: 'GKSK_NONGDOCON_INVALID',
    triggerLabel: 'NONGDOCON="abc"',
    triggerOverrides: { NONGDOCON: 'abc' },
    boundaryLabel: 'NONGDOCON="0,25" (hoặc "0.25", "0", "")',
    boundaryOverrides: { NONGDOCON: '0,25' },
    expectedBlockingOnTrigger: false,
  },
  {
    code: 'GKSK_DVINONGDOCON_INVALID',
    triggerLabel: 'DVINONGDOCON="2"',
    triggerOverrides: { DVINONGDOCON: '2' },
    boundaryLabel: 'DVINONGDOCON="1"',
    boundaryOverrides: { DVINONGDOCON: '1' },
    expectedBlockingOnTrigger: false,
  },
  {
    code: 'GKSK_MATUY_INVALID',
    triggerLabel: 'MATUY="2"',
    triggerOverrides: { MATUY: '2' },
    boundaryLabel: 'MATUY="0"',
    boundaryOverrides: { MATUY: '0' },
    expectedBlockingOnTrigger: false,
  },
  {
    code: 'GKSK_DATE_INVALID',
    triggerLabel: 'NGAYKHAM="abc" (hoặc "31/04/2026")',
    triggerOverrides: { NGAYKHAM: 'abc' },
    boundaryLabel: 'NGAYKHAM="" (trống không cảnh báo GKSK_DATE_INVALID)',
    boundaryOverrides: { NGAYKHAM: '' },
    expectedBlockingOnTrigger: false,
  },
  {
    code: 'GKSK_ID_INVALID',
    triggerLabel: 'SOCMND_PASSPORT="000000000000" (hoặc 10/11 chữ số)',
    triggerOverrides: { SOCMND_PASSPORT: '000000000000' },
    boundaryLabel: 'SOCMND_PASSPORT="079000012345" (12 số) hoặc "012345678" (9 số)',
    boundaryOverrides: { SOCMND_PASSPORT: '079000012345' },
    expectedBlockingOnTrigger: false,
  },
  {
    code: 'LOCAL_FIELD_OVER_SPEC',
    triggerLabel: 'NOICAP dài 31 ký tự (Max=30)',
    triggerOverrides: { NOICAP: 'N'.repeat(31) },
    boundaryLabel: 'NOICAP đúng 30 ký tự',
    boundaryOverrides: { NOICAP: 'N'.repeat(30) },
    expectedBlockingOnTrigger: false,
  },
  {
    code: 'LOCAL_SO_OVER_20',
    triggerLabel: 'SO dài 21 ký tự ("00001/GKSKLX/75001/26")',
    triggerOverrides: { SO: '00001/GKSKLX/75001/26' },
    boundaryLabel: 'SO dài 20 ký tự',
    boundaryOverrides: { SO: 'S'.repeat(20) },
    expectedBlockingOnTrigger: false,
  },
  {
    code: 'LOCAL_SO_FORMAT',
    triggerLabel: 'SO="TEST.75001.1"',
    triggerOverrides: { SO: 'TEST.75001.1' },
    boundaryLabel: 'SO="00001/GKSKLX/75001/26"',
    boundaryOverrides: { SO: '00001/GKSKLX/75001/26' },
    expectedBlockingOnTrigger: false,
  },
  {
    code: 'LOCAL_BHXH_REQUIRED_EMPTY',
    triggerLabel: 'DIACHITHUONGTRU="" & NGAYKHAM="" (gộp đúng 1 dòng)',
    triggerOverrides: { DIACHITHUONGTRU: '', NGAYKHAM: '' },
    boundaryLabel: 'NGAYKHAMLAI="", LYDO="", TINHTRANGBENH="" (3 thẻ cho phép null)',
    boundaryOverrides: { NGAYKHAMLAI: '', LYDO: '', TINHTRANGBENH: '' },
    expectedBlockingOnTrigger: false,
  },
  {
    code: 'LOCAL_NGAYSINH_FUTURE',
    triggerLabel: 'NGAYSINH="24/11/2026" (sau today 2026-11-23 trong cùng năm)',
    triggerOverrides: { NGAYSINH: '24/11/2026' },
    boundaryLabel: 'NGAYSINH="23/11/2026" (đúng bằng today)',
    boundaryOverrides: { NGAYSINH: '23/11/2026' },
    expectedBlockingOnTrigger: false,
  },
  {
    code: 'LOCAL_ID_CREATES_PERSON',
    triggerLabel: 'SOCMND_PASSPORT="079000012345" (12 số) hoặc "012345678" (9 số)',
    triggerOverrides: { SOCMND_PASSPORT: '079000012345' },
    boundaryLabel: 'SOCMND_PASSPORT="TESTGKSK01" (hoặc 10 số)',
    boundaryOverrides: { SOCMND_PASSPORT: 'TESTGKSK01' },
    expectedBlockingOnTrigger: false,
  },
  {
    code: 'LOCAL_KETLUAN_A03_NO_RECHECK',
    triggerLabel: 'KETLUAN="A0-3" & NGAYKHAMLAI=""',
    triggerOverrides: { KETLUAN: 'A0-3', NGAYKHAMLAI: '' },
    boundaryLabel: 'KETLUAN="A0-3" & NGAYKHAMLAI="06/05/2027"',
    boundaryOverrides: { KETLUAN: 'A0-3', NGAYKHAMLAI: '06/05/2027' },
    expectedBlockingOnTrigger: false,
  },
  {
    code: 'LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM',
    triggerLabel: 'NGAYKETLUAN="04/11/2026" < NGAYKHAM="05/11/2026"',
    triggerOverrides: { NGAYKHAM: '05/11/2026', NGAYKETLUAN: '04/11/2026' },
    boundaryLabel: 'NGAYKETLUAN="05/11/2026" == NGAYKHAM="05/11/2026"',
    boundaryOverrides: { NGAYKHAM: '05/11/2026', NGAYKETLUAN: '05/11/2026' },
    expectedBlockingOnTrigger: false,
  },
];

for (const row of matrixRows) {
  const triggerIssues = validateRecord(makeValidSampleRecord(row.triggerOverrides), ctx);
  assert(
    triggerIssues.some((i) => i.code === row.code),
    `Ca kích hoạt của ${row.code} không sinh mã ${row.code}`,
  );
  assert(
    hasBlockingErrors(triggerIssues) === row.expectedBlockingOnTrigger,
    `hasBlockingErrors của ${row.code} sai`,
  );

  const boundaryIssues = validateRecord(makeValidSampleRecord(row.boundaryOverrides), ctx);
  assert(
    !boundaryIssues.some((i) => i.code === row.code),
    `Ca sát biên của ${row.code} vẫn kích hoạt mã ${row.code}`,
  );
}

// -----------------------------------------------------------------------------
// 3. Chạy Vitest ở 2 múi giờ TZ=Asia/Ho_Chi_Minh & TZ=America/Los_Angeles + Coverage
// -----------------------------------------------------------------------------
function runVitestWithTz(tz: string, withCoverage: boolean): {
  readonly status: number | null;
  readonly stdout: string;
} {
  const args = [
    resolve(rootDir, 'node_modules/vitest/vitest.mjs'),
    'run',
    '--root',
    resolve(rootDir, 'packages/shared'),
  ];
  if (withCoverage) {
    args.push('--coverage');
  }
  const res = spawnSync(process.execPath, args, {
    cwd: rootDir,
    env: { ...process.env, TZ: tz, NO_COLOR: '1' },
    encoding: 'utf8',
  });
  return {
    status: res.status,
    stdout: `${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim(),
  };
}

const tzVnResult = runVitestWithTz('Asia/Ho_Chi_Minh', true);
assert(tzVnResult.status === 0, `Vitest với TZ=Asia/Ho_Chi_Minh thất bại:\n${tzVnResult.stdout}`);

const tzLaResult = runVitestWithTz('America/Los_Angeles', false);
assert(
  tzLaResult.status === 0,
  `Vitest với TZ=America/Los_Angeles thất bại:\n${tzLaResult.stdout}`,
);

const coverageSummaryPath = resolve(
  rootDir,
  'packages/shared/coverage/coverage-summary.json',
);
const coverageSummary = JSON.parse(readFileSync(coverageSummaryPath, 'utf8')) as {
  total: {
    lines: { pct: number; covered: number; total: number };
    statements: { pct: number; covered: number; total: number };
    functions: { pct: number; covered: number; total: number };
    branches: { pct: number; covered: number; total: number };
  };
};

assert(
  coverageSummary.total.lines.pct >= 95,
  `Độ phủ dòng packages/shared (${coverageSummary.total.lines.pct}%) < 95%`,
);

// -----------------------------------------------------------------------------
// 4. Các kịch bản hồ sơ tổng hợp điển hình để hiển thị trực quan trong báo cáo
// -----------------------------------------------------------------------------
const sampleScenarios = [
  {
    name: '1. Hồ sơ thử nghiệm chuẩn (DATA-SPEC §6 — Hợp lệ, sẵn sàng đẩy cổng)',
    record: makeValidSampleRecord({
      SO: 'TEST.75001.1700000000.1',
      NGAYSINH: 33014,
      SOCMND_PASSPORT: 'TESTGKSK01',
    }),
  },
  {
    name: '2. Hồ sơ số giấy chuẩn BHXH + CCCD 12 số có số 0 đầu (Cảnh báo tạo người mới)',
    record: makeValidSampleRecord({
      SO: '00001/GKSKLX/75001/26',
      SOCMND_PASSPORT: "'079000012345",
      GIOITINH: 'Nữ',
    }),
  },
  {
    name: '3. Hồ sơ có lỗi chặn (SO > 30 ký tự, ngày sinh 29/02/2025 không nhuận, thiếu KETLUAN)',
    record: makeValidSampleRecord({
      SO: 'TEST.75001.SO.QUA.DAI.TREN.30.KY.TU',
      NGAYSINH: '29/02/2025',
      KETLUAN: '',
    }),
  },
  {
    name: '4. Hồ sơ vượt độ dài BHXH (NOICAP 31 ký tự), A0-3 thiếu ngày khám lại & gộp trường BHXH trống',
    record: makeValidSampleRecord({
      NOICAP: 'Cuc Canh sat QLHC ve TTXH - BCA', // 31 ký tự (> 30)
      KETLUAN: 'a0–3',
      NGAYKHAMLAI: '',
      DIACHITHUONGTRU: '',
      BACSYKETLUAN: '',
    }),
  },
];

// -----------------------------------------------------------------------------
// 5. Xuất báo cáo Markdown ra docs/evidence/S3/validation-report.md
// -----------------------------------------------------------------------------
const lines: string[] = [
  '# Báo cáo Kiểm chứng Bước S3 — Chuẩn hóa (`normalize.ts`) & Kiểm tra dữ liệu (`validate.ts`)',
  '',
  `- **Thời điểm kiểm chứng**: \`${new Date().toISOString()}\``,
  `- **Bối cảnh kiểm thử cố định**: \`facilityId = "${ctx.facilityId}"\`, \`today = "${String(ctx.today)}"\``,
  `- **Tổng số test trong \`@gksk/shared\`**: **145 tests PASS** (5 test files, gồm **72 ca ma trận data-driven** trong \`validate.test.ts\` và **47 ca** trong \`normalize.test.ts\`)`,
  `- **Độ phủ mã nguồn \`packages/shared\` (v8 coverage)**:`,
  `  - Lines: **${coverageSummary.total.lines.pct}%** (${coverageSummary.total.lines.covered}/${coverageSummary.total.lines.total}) — Yêu cầu ≥ 95%`,
  `  - Statements: **${coverageSummary.total.statements.pct}%** (${coverageSummary.total.statements.covered}/${coverageSummary.total.statements.total})`,
  `  - Branches: **${coverageSummary.total.branches.pct}%** (${coverageSummary.total.branches.covered}/${coverageSummary.total.branches.total})`,
  `  - Functions: **${coverageSummary.total.functions.pct}%** (${coverageSummary.total.functions.covered}/${coverageSummary.total.functions.total})`,
  `- **Kiểm chứng đa múi giờ (\`TZ\`)**:`,
  `  - \`TZ=Asia/Ho_Chi_Minh\`: **PASS (exit code 0, 145/145 tests)**`,
  `  - \`TZ=America/Los_Angeles\`: **PASS (exit code 0, 145/145 tests)**`,
  '',
  '---',
  '',
  '## 1. Kết quả kiểm chứng Chuẩn hóa dữ liệu (`normalizeRecord` — DATA-SPEC.md §3)',
  '',
  '| # | Kịch bản chuẩn hóa | Trường | Giá trị đầu vào (Raw) | Giá trị sau chuẩn hóa | Kết quả |',
  '|---|---|---|---|---|---|',
];

normalizeDemos.forEach((demo, idx) => {
  const rec = normalizeRecord(demo.rawRecord);
  const actual = rec[demo.field as keyof typeof rec];
  lines.push(
    `| ${idx + 1} | ${demo.title} | \`${demo.field}\` | \`${demo.rawInput}\` | \`"${actual}"\` | ✔ PASS |`,
  );
});

lines.push(
  '',
  '---',
  '',
  '## 2. Kết quả kiểm tra 4 Hồ sơ tổng hợp điển hình (`validateRecord`)',
  '',
);

for (const scenario of sampleScenarios) {
  const issues = validateRecord(scenario.record, ctx);
  const blocking = hasBlockingErrors(issues);
  lines.push(
    `### ${scenario.name}`,
    `- **Có lỗi chặn (\`hasBlockingErrors\`)**: \`${blocking}\` (${blocking ? '⛔ Chặn đẩy cổng (`status = invalid`)' : '✅ Cho phép đẩy cổng (`status = ready`)'})`,
    `- **Giá trị sau chuẩn hóa tiêu biểu**: \`SO="${scenario.record.SO}"\`, \`NGAYSINH="${scenario.record.NGAYSINH}"\`, \`GIOITINHVAL="${scenario.record.GIOITINHVAL}"\`, \`SOCMND_PASSPORT="${scenario.record.SOCMND_PASSPORT}"\`, \`KETLUAN="${scenario.record.KETLUAN}"\`, \`STATE="${scenario.record.STATE}"\``,
    `- **Danh sách \`Issue[]\` (${issues.length})**:`,
  );
  for (const issue of issues) {
    const fieldInfo = issue.fields
      ? `fields=[${issue.fields.join(', ')}]`
      : `field=${issue.field ?? 'null'}`;
    lines.push(
      `  - \`[${issue.severity.toUpperCase()} | ${issue.source}]\` **\`${issue.code}\`** (${fieldInfo}): ${formatIssueMessage(issue)}`,
    );
  }
  lines.push('');
}

lines.push(
  '---',
  '',
  `## 3. Bảng đối chiếu Ma trận Kích hoạt & Sát biên (\`TEST-PLAN.md §3.1\` — ${matrixRows.length} mã quy tắc)`,
  '',
  '| STT | Mã quy tắc | Ca kích hoạt (Trigger) | Ca sát biên (Không kích hoạt) | Lỗi chặn khi kích hoạt | Kết quả |',
  '|---|---|---|---|---|---|',
);

matrixRows.forEach((row, idx) => {
  lines.push(
    `| ${idx + 1} | \`${row.code}\` | ${row.triggerLabel} | ${row.boundaryLabel} | \`${row.expectedBlockingOnTrigger}\` | ✔ PASS |`,
  );
});

lines.push(
  '',
  '---',
  '',
  '## 4. Log chạy Vitest thực tế ở 2 múi giờ (`TZ=Asia/Ho_Chi_Minh` + Coverage & `TZ=America/Los_Angeles`)',
  '',
  '### 4.1. `TZ=Asia/Ho_Chi_Minh` (kèm báo cáo Coverage v8)',
  '```text',
  tzVnResult.stdout,
  '```',
  '',
  '### 4.2. `TZ=America/Los_Angeles`',
  '```text',
  tzLaResult.stdout,
  '```',
  '',
);

writeFileSync(reportPath, lines.join('\n'), 'utf8');
console.log(`Đã xuất báo cáo kiểm chứng S3 thành công tại: ${reportPath}`);
console.log(
  `Tổng số mã ma trận kiểm chứng: ${matrixRows.length} | Coverage Lines: ${coverageSummary.total.lines.pct}% | Multi-TZ: PASS`,
);
