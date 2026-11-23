import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { FIELD_ORDER, createEmptyRecord, type GkskRecord } from '../packages/shared/src/index.js';
import { MAX_XML_BYTES, buildGkskXml, toBase64Utf8 } from '../server/src/gksk/xml.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'S4');
const SAMPLE_XML_OUT = path.join(EVIDENCE_DIR, 'sample-gksk.xml');
const SPECIAL_XML_OUT = path.join(EVIDENCE_DIR, 'special-chars-gksk.xml');
const VERIFY_OUT = path.join(EVIDENCE_DIR, 'verify-output.txt');
const REFERENCE_XML_FILE = path.join(ROOT_DIR, 'docs', 'reference', 'gksk_mau_ky_so_root.xml');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`VERIFY S4 FAILED: ${message}`);
  }
}

const parser = new XMLParser({
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreAttributes: false,
});

// 1. Chuẩn bị 2 bản ghi dữ liệu giả theo DATA-SPEC.md §6
const sampleRecord: GkskRecord = {
  ...createEmptyRecord(),
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

const specialCharsRecord: GkskRecord = {
  ...createEmptyRecord(),
  SO: 'TEST.75001.1700000000.2',
  NGAYKHAM: '05/11/2026',
  HOTEN: 'TEST NGUYỄN VĂN Ă & B <C> "D" \'E\'',
  GIOITINHVAL: '1',
  NGAYSINH: '21/05/1990',
  DIACHITHUONGTRU: 'Số 12/3 Đường 30/4 & Nguyễn Ái Quốc, TP. Biên Hòa, Đồng Nai',
  MATINH_THUONGTRU: '75',
  MAHUYEN_THUONGTRU: '75731',
  MAXA_THUONGTRU: '7573126041',
  SOCMND_PASSPORT: 'TESTGKSK02',
  NGAYTHANGNAMCAP: '01/02/2021',
  NOICAP: 'Cục CS QLHC về TTXH',
  HANGBANGLAI: 'B2',
  IDBENHVIEN: '75001',
  BENHVIEN: 'Bệnh viện Thử nghiệm & Kiểm định',
  NGAYKETLUAN: '06/11/2026',
  NONGDOCON: '0,25',
  DVINONGDOCON: '1',
  MATUY: '0',
  BACSYKETLUAN: 'TEST BS. TRẦN THỊ BÍCH',
  KETLUAN: 'A0-3',
  NGAYKHAMLAI: '06/05/2027',
  LYDO: 'Dòng 1: Thị lực < 8/10 & cần đeo kính "chuẩn"\nDòng 2: Khám lại sau \'6 tháng\' > quy định',
  TINHTRANGBENH: 'Cận thị nhẹ\x00\x07\x1F — đã lọc ký tự điều khiển cấm XML 1.0',
  STATE: 'EDIT',
};

// 2. Sinh XML và ghi ra docs/evidence/S4/
const sampleXml = buildGkskXml(sampleRecord);
const sampleXmlSecondCall = buildGkskXml(sampleRecord);
assert(sampleXml === sampleXmlSecondCall, 'buildGkskXml không xác định (2 lần gọi khác nhau)');

const specialXml = buildGkskXml(specialCharsRecord);

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.writeFileSync(SAMPLE_XML_OUT, sampleXml, 'utf8');
fs.writeFileSync(SPECIAL_XML_OUT, specialXml, 'utf8');

// 3. Kiểm tra quy chuẩn XML 1.0, không BOM/DOCTYPE/comment/Signature, kích thước <= 1MB
for (const [name, xml, filePath] of [
  ['sample-gksk.xml', sampleXml, SAMPLE_XML_OUT],
  ['special-chars-gksk.xml', specialXml, SPECIAL_XML_OUT],
] as const) {
  const diskBytes = fs.readFileSync(filePath);
  assert(
    !diskBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
    `${name} chứa UTF-8 BOM`,
  );
  assert(xml.charCodeAt(0) !== 0xfeff, `${name} bắt đầu bằng ký tự BOM 0xFEFF`);
  assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<root>\n'), `${name} sai phần đầu XML`);
  assert(!xml.includes('DOCTYPE'), `${name} chứa DOCTYPE`);
  assert(!xml.includes('<!--'), `${name} chứa comment`);
  assert(!xml.includes('Signature'), `${name} chứa Signature`);
  assert(!xml.includes('\r\n'), `${name} chứa CRLF`);
  assert(diskBytes.byteLength <= MAX_XML_BYTES, `${name} vượt quá 1 MB`);
  assert(XMLValidator.validate(xml) === true, `${name} không hợp lệ theo XMLValidator`);

  const b64 = toBase64Utf8(xml);
  const decoded = Buffer.from(b64, 'base64');
  assert(decoded.equals(diskBytes), `${name} giải mã Base64 không khớp byte UTF-8`);
}

// Kiểm tra Golden Vector Base64 ở API-CONTRACT.md §5
const goldenXml = '<root><SO>TEST.75001.1</SO></root>';
const goldenB64 = toBase64Utf8(goldenXml);
assert(
  goldenB64 === 'PHJvb3Q+PFNPPlRFU1QuNzUwMDEuMTwvU08+PC9yb290Pg==',
  `Base64 Golden Vector lệch: ${goldenB64}`,
);

// 4. Kiểm tra round-trip bằng fast-xml-parser
const parsedSample = (parser.parse(sampleXml) as { root: Record<string, string> }).root;
const parsedSampleTags = Object.keys(parsedSample);
assert(
  parsedSampleTags.length === 25 && parsedSampleTags.join(',') === FIELD_ORDER.join(','),
  `Danh sách 25 thẻ của sample-gksk.xml không khớp thứ tự BHXH`,
);
for (const tag of FIELD_ORDER) {
  assert(parsedSample[tag] === sampleRecord[tag], `Round-trip sample-gksk.xml lệch tại thẻ ${tag}`);
}

const parsedSpecial = (parser.parse(specialXml) as { root: Record<string, string> }).root;
const parsedSpecialTags = Object.keys(parsedSpecial);
assert(
  parsedSpecialTags.length === 25 && parsedSpecialTags.join(',') === FIELD_ORDER.join(','),
  `Danh sách 25 thẻ của special-chars-gksk.xml không khớp thứ tự BHXH`,
);
for (const tag of FIELD_ORDER) {
  const expectedVal =
    tag === 'TINHTRANGBENH'
      ? 'Cận thị nhẹ — đã lọc ký tự điều khiển cấm XML 1.0'
      : specialCharsRecord[tag];
  assert(
    parsedSpecial[tag] === expectedVal,
    `Round-trip special-chars-gksk.xml lệch tại thẻ ${tag}`,
  );
}

// Kiểm tra thẻ rỗng của sample-gksk.xml xuất đúng <TAG></TAG>
for (const emptyTag of ['NGAYKHAMLAI', 'LYDO', 'TINHTRANGBENH'] as const) {
  assert(
    sampleXml.includes(`  <${emptyTag}></${emptyTag}>`),
    `Thẻ rỗng ${emptyTag} không xuất dạng <${emptyTag}></${emptyTag}>`,
  );
}

// 5. Đối chiếu 25 thẻ với docs/reference/gksk_mau_ky_so_root.xml
assert(fs.existsSync(REFERENCE_XML_FILE), `Không tìm thấy file XML mẫu gốc: ${REFERENCE_XML_FILE}`);
const refXmlRaw = fs.readFileSync(REFERENCE_XML_FILE, 'utf8');
const refWithoutSig = refXmlRaw.replace(/<Signature[\s\S]*?<\/Signature>/, '');
const refInnerMatch = refWithoutSig.match(/<root>([\s\S]*?)<\/root>/);
assert(Boolean(refInnerMatch?.[1]), 'Không đọc được nội dung <root> từ gksk_mau_ky_so_root.xml');

const refAllTags = Array.from(
  (refInnerMatch?.[1] ?? '').matchAll(/<([A-Z0-9_]+)(?:\s*\/>|>)/g),
  (m) => m[1] ?? '',
);
const ignoredRefTags = new Set(['UUID', 'STATUS']);
const refDataTags = refAllTags.filter((tag) => !ignoredRefTags.has(tag));
assert(refDataTags.length === 25, `File mẫu gốc phải có 25 thẻ dữ liệu, nhận ${refDataTags.length}`);

const missingFromSample = refDataTags.filter((tag) => !parsedSampleTags.includes(tag));
const extraInSample = parsedSampleTags.filter((tag) => !refDataTags.includes(tag));
assert(
  missingFromSample.length === 0 && extraInSample.length === 0,
  `Lệch tập 25 thẻ so với gksk_mau_ky_so_root.xml: thiếu=[${missingFromSample.join(',')}] thừa=[${extraInSample.join(',')}]`,
);

// 6. Ghi báo cáo kiểm chứng vào docs/evidence/S4/verify-output.txt
const sampleByteLen = Buffer.byteLength(sampleXml, 'utf8');
const specialByteLen = Buffer.byteLength(specialXml, 'utf8');
const sampleB64Len = toBase64Utf8(sampleXml).length;
const specialB64Len = toBase64Utf8(specialXml).length;

const reportLines: string[] = [
  '================================================================================',
  'GKSKLaiXe — KIỂM CHỨNG BƯỚC S4: DỰNG XML GKSK LÁI XE (25 THẺ BHXH)',
  '================================================================================',
  `Thời điểm chạy : ${new Date().toISOString()}`,
  `File mẫu 1     : docs/evidence/S4/sample-gksk.xml (${sampleByteLen} byte UTF-8, Base64 ${sampleB64Len} ký tự)`,
  `File mẫu 2     : docs/evidence/S4/special-chars-gksk.xml (${specialByteLen} byte UTF-8, Base64 ${specialB64Len} ký tự)`,
  `File đối chiếu : docs/reference/gksk_mau_ky_so_root.xml`,
  '',
  '1. KIỂM TRA CÁC RÀNG BUỘC GIAO THỨC & XML 1.0',
  '   [PASS] Khai báo chuẩn: <?xml version="1.0" encoding="UTF-8"?>, gốc <root>',
  '   [PASS] Không có UTF-8 BOM (0xEF 0xBB 0xBF / 0xFEFF) ở cả 2 file XML',
  '   [PASS] Không có DOCTYPE, không có comment (<!--), không có <Signature>, không có thẻ ngoài chuẩn (UUID/STATUS/SIGNDATA)',
  '   [PASS] Thẻ rỗng xuất đúng dạng <TAG></TAG> (NGAYKHAMLAI, LYDO, TINHTRANGBENH)',
  '   [PASS] Tính xác định (determinism): 2 lần gọi buildGkskXml cho chuỗi giống hệt nhau',
  '   [PASS] XMLValidator.validate() hợp lệ 100% cho cả 2 file',
  '   [PASS] Round-trip fast-xml-parser: 25/25 thẻ khớp chính xác (kể cả & < > " \', tiếng Việt có dấu, \\n trong LYDO, lọc \\x00/\\x07/\\x1F)',
  '   [PASS] toBase64Utf8() giải mã khớp chính xác byte UTF-8 cho cả 2 file',
  `   [PASS] Golden Vector Base64 (<root><SO>TEST.75001.1</SO></root>): ${goldenB64}`,
  '',
  '2. ĐỐI CHIẾU 25 THẺ DỮ LIỆU VỚI docs/reference/gksk_mau_ky_so_root.xml',
  `   - Số thẻ dữ liệu trong sample-gksk.xml          : ${parsedSampleTags.length} (đúng thứ tự BHXH DATA-SPEC.md §1)`,
  `   - Số thẻ dữ liệu trong gksk_mau_ky_so_root.xml  : ${refDataTags.length} (đã loại trừ UUID, STATUS, Signature)`,
  `   - Thẻ thiếu so với file mẫu gốc                 : 0`,
  `   - Thẻ thừa so với file mẫu gốc                  : 0`,
  '   - Ghi chú: File mẫu gốc gksk_mau_ky_so_root.xml sắp xếp theo bảng Sở, còn sample-gksk.xml',
  '     xuất đúng thứ tự bảng BHXH PL2 CV 3829 (bắt đầu SO, NGAYKHAM, HOTEN ... kết thúc STATE).',
  '',
  '   STT | Thẻ trong sample-gksk.xml (thứ tự BHXH) | Có trong gksk_mau_ky_so_root.xml (vị trí)',
  '   ----+-----------------------------------------+------------------------------------------',
  ...parsedSampleTags.map((tag, idx) => {
    const refPos = refDataTags.indexOf(tag) + 1;
    return `   ${String(idx + 1).padStart(3, ' ')} | ${tag.padEnd(39, ' ')} | CÓ (vị trí #${refPos} trong file mẫu Sở)`;
  }),
  '',
  'KẾT LUẬN: PASS 100% — ĐẠT ĐỦ ĐIỀU KIỆN QUA CỔNG BƯỚC S4.',
  '',
];

const reportText = reportLines.join('\n');
fs.writeFileSync(VERIFY_OUT, reportText, 'utf8');
process.stdout.write(reportText);
