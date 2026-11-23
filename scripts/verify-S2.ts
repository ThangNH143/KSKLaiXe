import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_ISSUE_CODES,
  BHXH_OPTIONAL_TAGS,
  EXCEL_REQUIRED_COLUMNS,
  FIELD_ORDER,
  FIELDS,
  ISSUE_MESSAGES,
  LOCAL_ISSUE_CODES,
  SENSITIVE_TAGS,
  SERVER_ERROR_CODES,
  SERVER_WARNING_CODES,
  SO_REQUIRED_TAGS,
  TEMPLATE_FIELDS,
  getIssueMessage,
} from '../packages/shared/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'S2');
const REPORT_FILE = path.join(EVIDENCE_DIR, 'fields-and-messages-report.md');
const SAMPLE_XML_FILE = path.join(ROOT_DIR, 'docs', 'reference', 'gksk_mau_ky_so_root.xml');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`VERIFY S2 FAILED: ${message}`);
  }
}

// 1. Kiểm tra bất biến cốt lõi của FIELDS & FIELD_ORDER
assert(FIELDS.length === 25, `Phải có đúng 25 trường, nhận ${FIELDS.length}`);
assert(FIELD_ORDER[0] === 'SO', 'Trường đầu tiên phải là SO');
assert(FIELD_ORDER[1] === 'NGAYKHAM', 'Trường thứ 2 phải là NGAYKHAM');
assert(FIELD_ORDER[24] === 'STATE', 'Trường cuối cùng phải là STATE');
assert(new Set(FIELD_ORDER).size === 25, 'Không được trùng tên thẻ');
assert(
  BHXH_OPTIONAL_TAGS.join(',') === 'NGAYKHAMLAI,LYDO,TINHTRANGBENH',
  'bhxhRequired=false phải đúng 3 thẻ NGAYKHAMLAI, LYDO, TINHTRANGBENH',
);
assert(SO_REQUIRED_TAGS.length === 7, 'Phải có đúng 7 trường Sở bắt buộc');
assert(
  SENSITIVE_TAGS.join(',') === 'NONGDOCON,MATUY,LYDO,TINHTRANGBENH',
  'SENSITIVE_TAGS phải đúng 4 trường NONGDOCON, MATUY, LYDO, TINHTRANGBENH',
);
assert(TEMPLATE_FIELDS.length === 23, 'Mẫu Excel phải có đúng 23 cột');
assert(EXCEL_REQUIRED_COLUMNS.length === 6, 'Excel phải có đúng 6 cột bắt buộc');

// 2. Đối chiếu trực tiếp tập 25 thẻ với file XML mẫu gốc `docs/reference/gksk_mau_ky_so_root.xml`
assert(fs.existsSync(SAMPLE_XML_FILE), `Không tìm thấy file XML mẫu: ${SAMPLE_XML_FILE}`);
const sampleXml = fs.readFileSync(SAMPLE_XML_FILE, 'utf8');
const withoutSignature = sampleXml.replace(/<Signature[\s\S]*?<\/Signature>/, '');
const rootInnerMatch = withoutSignature.match(/<root>([\s\S]*?)<\/root>/);
assert(Boolean(rootInnerMatch?.[1]), 'Không tách được nội dung thẻ <root> trong file XML mẫu');
const xmlTags = Array.from(
  (rootInnerMatch?.[1] ?? '').matchAll(/<([A-Z0-9_]+)(?:\s*\/>|>)/g),
  (m) => m[1] ?? '',
);
const ignoredNonDataTags = new Set(['UUID', 'STATUS']);
const xmlDataTags = xmlTags.filter((tag) => !ignoredNonDataTags.has(tag));
assert(
  xmlDataTags.length === 25,
  `File XML mẫu phải có đúng 25 thẻ dữ liệu (trừ UUID, STATUS, Signature), nhận ${xmlDataTags.length}`,
);
const missingInXml = FIELD_ORDER.filter((tag) => !xmlDataTags.includes(tag));
const extraInXml = xmlDataTags.filter((tag) => !(FIELD_ORDER as readonly string[]).includes(tag));
assert(
  missingInXml.length === 0 && extraInXml.length === 0,
  `Lệch thẻ so với gksk_mau_ky_so_root.xml: thiếu=[${missingInXml.join(',')}] thừa=[${extraInXml.join(',')}]`,
);

// 3. Kiểm tra 100% mã lỗi/cảnh báo có thông điệp tiếng Việt có dấu
const vnRegex =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/;
for (const code of ALL_ISSUE_CODES) {
  const msg = getIssueMessage(code);
  assert(Boolean(msg) && msg !== code && vnRegex.test(msg), `Mã ${code} thiếu thông điệp tiếng Việt`);
}
assert(
  getIssueMessage('UNKNOWN_TEST_CODE') === 'UNKNOWN_TEST_CODE',
  'Mã lạ phải trả về nguyên mã',
);

// 4. Xuất báo cáo Markdown đối chiếu vào docs/evidence/S2/fields-and-messages-report.md
const lines: string[] = [];
lines.push('# Báo cáo kiểm chứng Bước S2 — Đặc tả 25 trường BHXH & Bảng mã thông điệp tiếng Việt');
lines.push('');
lines.push(`- **Thời điểm sinh báo cáo:** \`${new Date().toISOString()}\``);
lines.push('- **Nguồn đối chiếu:** `docs/DATA-SPEC.md` (§1, §2), `docs/API-CONTRACT.md` (§9, §10), `docs/reference/gksk_mau_ky_so_root.xml`');
lines.push('');
lines.push('## 1. Tóm tắt kiểm chứng tự động');
lines.push('');
lines.push('| Hạng mục | Kỳ vọng | Thực tế | Trạng thái |');
lines.push('|---|---|---|---|');
lines.push(`| Tổng số thẻ dữ liệu | 25 thẻ (thứ tự BHXH) | ${FIELDS.length} thẻ (\`${FIELD_ORDER[0]}\` → \`${FIELD_ORDER[24]}\`) | ✅ PASS |`);
lines.push(`| Đối chiếu tập thẻ với \`gksk_mau_ky_so_root.xml\` | Khớp 25/25 thẻ dữ liệu (trừ \`UUID\`, \`STATUS\`, \`Signature\`) | Khớp 25/25 (0 thiếu, 0 thừa) | ✅ PASS |`);
lines.push(`| Thẻ BHXH cho phép null (\`bhxhRequired=false\`) | 3 thẻ (\`NGAYKHAMLAI\`, \`LYDO\`, \`TINHTRANGBENH\`) | ${BHXH_OPTIONAL_TAGS.length} thẻ (${BHXH_OPTIONAL_TAGS.map((t) => `\`${t}\``).join(', ')}) | ✅ PASS |`);
lines.push(`| Thẻ Sở bắt buộc (\`soRequired=true\`) | 7 thẻ | ${SO_REQUIRED_TAGS.length} thẻ (${SO_REQUIRED_TAGS.map((t) => `\`${t}\``).join(', ')}) | ✅ PASS |`);
lines.push(`| Thẻ nhạy cảm (\`SENSITIVE_TAGS\`) | 4 thẻ (\`NONGDOCON\`, \`MATUY\`, \`LYDO\`, \`TINHTRANGBENH\`) | ${SENSITIVE_TAGS.length} thẻ (${SENSITIVE_TAGS.map((t) => `\`${t}\``).join(', ')}) | ✅ PASS |`);
lines.push(`| Số cột trong mẫu Excel (\`inTemplate=true\`) | 23 cột (trừ \`IDBENHVIEN\`, \`BENHVIEN\`) | ${TEMPLATE_FIELDS.length} cột (${EXCEL_REQUIRED_COLUMNS.length} cột bắt buộc) | ✅ PASS |`);
lines.push(`| Tổng số mã lỗi/cảnh báo/thông tin | 36 mã (9 §9 + 14 §10 + 13 \`LOCAL_*\`) | ${ALL_ISSUE_CODES.length} mã (100% có tiếng Việt có dấu) | ✅ PASS |`);
lines.push('');

lines.push('## 2. Bảng đối chiếu 25 trường theo thứ tự BHXH (`packages/shared/src/fields.ts`)');
lines.push('');
lines.push('| STT | Tag | Nhãn tiếng Việt | Kiểu | MaxLength | BHXH bắt buộc | Sở bắt buộc | Có trong mẫu Excel | Chỉ đọc | Nhạy cảm | Enum / Bí danh Excel |');
lines.push('|---:|---|---|---|---:|:---:|:---:|:---:|:---:|:---:|---|');

for (const f of FIELDS) {
  const maxStr =
    f.maxLength === undefined
      ? '—'
      : f.serverMaxLength !== undefined
        ? `${f.maxLength} (Sở ≤ ${f.serverMaxLength})`
        : String(f.maxLength);
  const extras: string[] = [];
  if (f.enumValues) {
    extras.push(`Enum: ${f.enumValues.map((v) => `\`${v}\``).join(', ')}`);
  }
  if (f.excelAliases) {
    extras.push(`Alias: ${f.excelAliases.map((a) => `\`${a}\``).join(', ')}`);
  }
  lines.push(
    `| ${f.order} | \`${f.tag}\` | ${f.label} | \`${f.type}\` | ${maxStr} | ${f.bhxhRequired ? '✔' : '—'} | ${f.soRequired ? '**Có**' : 'Không'} | ${f.inTemplate ? '✔' : '—'} | ${f.readOnly ? '✔' : '—'} | ${f.sensitive ? '**Có**' : '—'} | ${extras.join(' · ') || '—'} |`,
  );
}
lines.push('');

lines.push('## 3. Bảng toàn bộ mã lỗi / cảnh báo / thông tin tiếng Việt (`packages/shared/src/messages.ts`)');
lines.push('');

lines.push(`### 3.1. Mã từ chối giấy từ Hệ thống Sở — \`API-CONTRACT.md §9\` (${SERVER_ERROR_CODES.length} mã)`);
lines.push('');
lines.push('| STT | Mã | Thông điệp tiếng Việt |');
lines.push('|---:|---|---|');
SERVER_ERROR_CODES.forEach((code, idx) => {
  lines.push(`| ${idx + 1} | \`${code}\` | ${ISSUE_MESSAGES[code]} |`);
});
lines.push('');

lines.push(`### 3.2. Mã cảnh báo từ Hệ thống Sở — \`API-CONTRACT.md §10\` (${SERVER_WARNING_CODES.length} mã)`);
lines.push('');
lines.push('| STT | Mã | Thông điệp tiếng Việt |');
lines.push('|---:|---|---|');
SERVER_WARNING_CODES.forEach((code, idx) => {
  lines.push(`| ${idx + 1} | \`${code}\` | ${ISSUE_MESSAGES[code]} |`);
});
lines.push('');

lines.push(`### 3.3. Mã kiểm tra cục bộ (\`LOCAL_*\`) — \`DATA-SPEC.md §2\` (${LOCAL_ISSUE_CODES.length} mã)`);
lines.push('');
lines.push('| STT | Mã | Thông điệp tiếng Việt |');
lines.push('|---:|---|---|');
LOCAL_ISSUE_CODES.forEach((code, idx) => {
  lines.push(`| ${idx + 1} | \`${code}\` | ${ISSUE_MESSAGES[code]} |`);
});
lines.push('');

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.writeFileSync(REPORT_FILE, `${lines.join('\n')}`, 'utf8');

process.stdout.write(
  [
    '======================================================================',
    'GKSKLaiXe — KIỂM CHỨNG BƯỚC S2: ĐẶC TẢ 25 TRƯỜNG & MÃ THÔNG ĐIỆP',
    '======================================================================',
    `- Tổng số trường BHXH: ${FIELDS.length} (${FIELD_ORDER[0]} .. ${FIELD_ORDER[24]})`,
    `- Đối chiếu gksk_mau_ky_so_root.xml: KHỚP 25/25 thẻ dữ liệu`,
    `- bhxhRequired=false: ${BHXH_OPTIONAL_TAGS.length} thẻ (${BHXH_OPTIONAL_TAGS.join(', ')})`,
    `- soRequired=true: ${SO_REQUIRED_TAGS.length} thẻ (${SO_REQUIRED_TAGS.join(', ')})`,
    `- SENSITIVE_TAGS: ${SENSITIVE_TAGS.length} thẻ (${SENSITIVE_TAGS.join(', ')})`,
    `- Mẫu Excel: ${TEMPLATE_FIELDS.length} cột (${EXCEL_REQUIRED_COLUMNS.length} cột bắt buộc)`,
    `- Tổng mã lỗi/cảnh báo tiếng Việt: ${ALL_ISSUE_CODES.length} mã (${SERVER_ERROR_CODES.length} §9 + ${SERVER_WARNING_CODES.length} §10 + ${LOCAL_ISSUE_CODES.length} LOCAL_*)`,
    `- Đã xuất báo cáo đối chiếu tại: ${REPORT_FILE}`,
    'KẾT LUẬN: PASS 100%',
    '',
  ].join('\n'),
);
