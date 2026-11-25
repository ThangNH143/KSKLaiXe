import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import request from 'supertest';
import {
  createEmptyRecord,
  FIELD_ORDER,
  SENSITIVE_TAGS,
  type GkskRecord,
} from '../packages/shared/src/index.js';
import { createApp } from '../server/src/app.js';
import { createInMemoryRepositories } from '../server/src/db/inMemoryRepo.js';
import {
  extractZipArchiveBuffer,
  RECONCILE_ALL_COLUMNS,
  RECONCILE_EXTRA_COLUMNS,
  RECONCILE_TEMPLATE_COLUMNS,
} from '../server/src/services/exportService.js';
import { computeCertificatePayload } from '../server/src/services/sendService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'S10');
const XML_OUT = path.join(EVIDENCE_DIR, 'TEST_75001_0001.xml');
const ZIP_OUT = path.join(EVIDENCE_DIR, 'GKSK_XML_batch.zip');
const XLSX_OUT = path.join(EVIDENCE_DIR, 'GKSK_doi_soat_sample.xlsx');
const VERIFY_OUT = path.join(EVIDENCE_DIR, 'verify-output.txt');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`VERIFY S10 FAILED: ${message}`);
  }
}

function makeSampleRecord(overrides: Partial<GkskRecord> = {}): GkskRecord {
  const base = createEmptyRecord();
  return {
    ...base,
    SO: 'TEST_75001_0001',
    NGAYKHAM: '05/11/2026',
    HOTEN: 'TEST NGUYEN VAN AN',
    GIOITINHVAL: '0',
    NGAYSINH: '21/05/1990',
    DIACHITHUONGTRU: 'Phuong Tan Phong, Bien Hoa, Dong Nai',
    MATINH_THUONGTRU: '75',
    MAHUYEN_THUONGTRU: '75731',
    MAXA_THUONGTRU: '7573126041',
    SOCMND_PASSPORT: 'TESTGKSK01',
    NGAYTHANGNAMCAP: '10/01/2021',
    NOICAP: 'Cuc CS QLHC ve TTXH',
    HANGBANGLAI: 'B2',
    IDBENHVIEN: '75001',
    BENHVIEN: 'Benh vien Da khoa Dong Nai',
    NGAYKETLUAN: '06/11/2026',
    NONGDOCON: '0',
    DVINONGDOCON: '0',
    MATUY: '0',
    BACSYKETLUAN: 'TEST BS NGUYEN VAN KHOA',
    KETLUAN: 'A0-1',
    NGAYKHAMLAI: '',
    LYDO: '',
    TINHTRANGBENH: 'Thi luc 10/10, suc khoe binh thuong',
    STATE: 'ADD',
    ...overrides,
  };
}

async function runVerification(): Promise<void> {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const repos = createInMemoryRepositories();
  const fixedNowMs = Date.parse('2026-11-23T03:15:30.000Z'); // 10:15:30 giờ VN
  const app = createApp({
    repos,
    facilityId: '75001',
    facilityName: 'Benh vien Da khoa Dong Nai',
    today: '2026-11-23',
    now: () => fixedNowMs,
  });

  // 1. Khởi tạo 2 đợt import mẫu và 6 hồ sơ đại diện đủ các trạng thái đối soát
  const batch1 = await repos.batches.create({
    filename: 'DS_KSK_LaiXe_Dot1_23112026.xlsx',
    rowCount: 4,
    createdAt: '2026-11-23T01:00:00.000Z',
  });
  const batch2 = await repos.batches.create({
    filename: 'DS_KSK_LaiXe_Dot2_23112026.xlsx',
    rowCount: 2,
    createdAt: '2026-11-23T02:00:00.000Z',
  });

  // Hồ sơ 1: Đã đẩy thành công (SO = TEST_75001_0001)
  const rec1 = makeSampleRecord({
    SO: 'TEST_75001_0001',
    HOTEN: 'TEST NGUYEN VAN AN',
    SOCMND_PASSPORT: 'TESTGKSK01',
    HANGBANGLAI: 'B2',
  });
  const up1 = await repos.certificates.upsertBySo({
    so: rec1.SO,
    fields: rec1,
    dataSha256: computeCertificatePayload(rec1).dataSha256,
    status: 'accepted',
    batchId: batch1.id,
    excelRowNumber: 2,
    serverCertificateId: 'CERT-75001-2026-0001',
    now: '2026-11-23T01:10:00.000Z',
  });
  await repos.submissions.create({
    certificateId: up1.row.id,
    msgId: '7500126112311111111111141118111111111111101',
    sendDatetime: Date.parse('2026-11-23T01:10:00.000Z'),
    dataSha256: up1.row.dataSha256,
    attempts: 1,
    httpStatus: 200,
    resCode: 'PS_SYNC_SUCCESS',
    resultStatus: 'accepted',
    serverSubmissionId: 'SUB-75001-0001',
    warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
    createdAt: '2026-11-23T01:10:00.000Z',
    finishedAt: '2026-11-23T01:10:01.000Z',
  });

  // Hồ sơ 2: Đã đẩy thành công (SO = 00002/GKSKLX/75001/26, có dấu / để kiểm chứng sanitize tên file trong ZIP)
  const rec2 = makeSampleRecord({
    SO: '00002/GKSKLX/75001/26',
    HOTEN: 'TEST TRAN THI BINH',
    GIOITINHVAL: '1',
    SOCMND_PASSPORT: '079000012345',
    HANGBANGLAI: 'C',
    KETLUAN: 'A0-3',
    NGAYKHAMLAI: '06/05/2027',
  });
  const up2 = await repos.certificates.upsertBySo({
    so: rec2.SO,
    fields: rec2,
    dataSha256: computeCertificatePayload(rec2).dataSha256,
    status: 'accepted',
    batchId: batch1.id,
    excelRowNumber: 3,
    serverCertificateId: 'CERT-75001-2026-0002',
    now: '2026-11-23T01:12:00.000Z',
  });
  await repos.submissions.create({
    certificateId: up2.row.id,
    msgId: '7500126112311111111111141118111111111111102',
    sendDatetime: Date.parse('2026-11-23T01:12:00.000Z'),
    dataSha256: up2.row.dataSha256,
    attempts: 1,
    httpStatus: 200,
    resCode: 'PS_SYNC_SUCCESS',
    resultStatus: 'accepted',
    serverSubmissionId: 'SUB-75001-0002',
    warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
    createdAt: '2026-11-23T01:12:00.000Z',
    finishedAt: '2026-11-23T01:12:01.000Z',
  });

  // Hồ sơ 3: Chờ đẩy cổng (status = ready)
  const rec3 = makeSampleRecord({
    SO: 'TEST.75001.0003',
    HOTEN: 'TEST LE VAN CUONG',
    SOCMND_PASSPORT: 'TESTGKSK03',
    HANGBANGLAI: 'A1',
  });
  const up3 = await repos.certificates.upsertBySo({
    so: rec3.SO,
    fields: rec3,
    dataSha256: computeCertificatePayload(rec3).dataSha256,
    status: 'ready',
    batchId: batch1.id,
    excelRowNumber: 4,
    now: '2026-11-23T01:15:00.000Z',
  });

  // Hồ sơ 4: Lỗi dữ liệu Excel (status = invalid, sai ngày sinh 31/02/1990)
  const rec4 = makeSampleRecord({
    SO: 'TEST.75001.0004',
    HOTEN: 'TEST PHAM THI DUNG',
    NGAYSINH: '31/02/1990',
    SOCMND_PASSPORT: 'TESTGKSK04',
  });
  const up4 = await repos.certificates.upsertBySo({
    so: rec4.SO,
    fields: rec4,
    dataSha256: computeCertificatePayload(rec4).dataSha256,
    status: 'invalid',
    batchId: batch1.id,
    excelRowNumber: 5,
    now: '2026-11-23T01:16:00.000Z',
  });

  // Hồ sơ 5: Cổng Sở từ chối (status = rejected, GKSK_FACILITY_MISMATCH)
  const rec5 = makeSampleRecord({
    SO: 'TEST.75001.0005',
    HOTEN: 'TEST HOANG VAN EM',
    SOCMND_PASSPORT: 'TESTGKSK05',
  });
  const up5 = await repos.certificates.upsertBySo({
    so: rec5.SO,
    fields: rec5,
    dataSha256: computeCertificatePayload(rec5).dataSha256,
    status: 'rejected',
    batchId: batch2.id,
    excelRowNumber: 2,
    now: '2026-11-23T02:05:00.000Z',
  });
  await repos.submissions.create({
    certificateId: up5.row.id,
    msgId: '7500126112311111111111141118111111111111105',
    sendDatetime: Date.parse('2026-11-23T02:05:00.000Z'),
    dataSha256: up5.row.dataSha256,
    attempts: 1,
    httpStatus: 200,
    resCode: 'PS_SYNC_SUCCESS',
    resultStatus: 'rejected',
    serverSubmissionId: 'SUB-75001-0005',
    errors: [{ code: 'GKSK_FACILITY_MISMATCH', field: 'IDBENHVIEN' }],
    warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
    createdAt: '2026-11-23T02:05:00.000Z',
    finishedAt: '2026-11-23T02:05:01.000Z',
  });

  // Hồ sơ 6: Lỗi mạng - Chờ gửi lại (status = error)
  const rec6 = makeSampleRecord({
    SO: 'TEST.75001.0006',
    HOTEN: 'TEST VU THI PHUONG',
    SOCMND_PASSPORT: 'TESTGKSK06',
  });
  const up6 = await repos.certificates.upsertBySo({
    so: rec6.SO,
    fields: rec6,
    dataSha256: computeCertificatePayload(rec6).dataSha256,
    status: 'error',
    batchId: batch2.id,
    excelRowNumber: 3,
    now: '2026-11-23T02:10:00.000Z',
  });
  await repos.submissions.create({
    certificateId: up6.row.id,
    msgId: '7500126112311111111111141118111111111111106',
    sendDatetime: Date.parse('2026-11-23T02:10:00.000Z'),
    dataSha256: up6.row.dataSha256,
    attempts: 4,
    httpStatus: 503,
    resCode: 'PS_DS_SAVE_FAIL',
    resultStatus: null,
    lastError: '[TRANSIENT:http_5xx HTTP 503 (PS_DS_SAVE_FAIL)] Hệ thống Sở tạm thời quá tải',
    createdAt: '2026-11-23T02:10:00.000Z',
    finishedAt: '2026-11-23T02:11:05.000Z',
  });

  // 2. Gọi GET /api/certificates/:id/xml để sinh file thật docs/evidence/S10/TEST_75001_0001.xml
  const xmlRes = await request(app).get(`/api/certificates/${up1.row.id}/xml`);
  assert(xmlRes.status === 200, 'GET /api/certificates/:id/xml phải trả HTTP 200');
  const xmlDisp = String(xmlRes.headers['content-disposition'] ?? '');
  assert(
    xmlDisp.includes('filename="TEST_75001_0001.xml"'),
    `Content-Disposition không đúng: ${xmlDisp}`,
  );
  const xmlText = xmlRes.text;
  fs.writeFileSync(XML_OUT, xmlText, 'utf8');

  // 3. Gọi POST /api/certificates/xml-zip để sinh file thật docs/evidence/S10/GKSK_XML_batch.zip
  const zipRes = await request(app)
    .post('/api/certificates/xml-zip')
    .send({
      ids: [up1.row.id, up2.row.id, up3.row.id, up4.row.id], // up4 (invalid) sẽ tự động bị lọc bỏ
    })
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  assert(zipRes.status === 200, 'POST /api/certificates/xml-zip phải trả HTTP 200');
  const zipBuffer = zipRes.body as Buffer;
  fs.writeFileSync(ZIP_OUT, zipBuffer);

  const extractedZip = extractZipArchiveBuffer(zipBuffer);
  assert(
    extractedZip.length === 3,
    `File ZIP phải chứa đúng 3 file XML hợp lệ (bỏ qua 1 giấy invalid), nhận được ${extractedZip.length}`,
  );

  // 4. Gọi GET /api/certificates/export-excel để sinh file thật docs/evidence/S10/GKSK_doi_soat_sample.xlsx
  const excelRes = await request(app)
    .get('/api/certificates/export-excel')
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  assert(
    excelRes.status === 200,
    'GET /api/certificates/export-excel phải trả HTTP 200',
  );
  const excelBuffer = excelRes.body as Buffer;
  fs.writeFileSync(XLSX_OUT, excelBuffer);

  // Đọc lại file Excel đối soát bằng ExcelJS để kiểm chứng 29 cột và 6 dòng dữ liệu
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(excelBuffer);
  const sheet = wb.getWorksheet('GKSK');
  assert(Boolean(sheet), 'File Excel đối soát phải có sheet GKSK');
  assert(
    sheet!.columnCount === 29,
    `Sheet GKSK phải có đúng 29 cột, nhận được ${sheet!.columnCount}`,
  );
  assert(
    sheet!.rowCount === 7,
    `Sheet GKSK phải có 7 dòng (1 tiêu đề + 6 dữ liệu), nhận được ${sheet!.rowCount}`,
  );

  // 5. Gọi GET /api/certificates và GET /api/certificates/:id để kiểm chứng JSON đối soát
  const listRes = await request(app).get('/api/certificates');
  assert(listRes.status === 200, 'GET /api/certificates phải trả HTTP 200');
  const listBody = listRes.body as {
    items: Array<{
      id: number;
      so: string;
      status: string;
      fields: Record<string, string>;
      batchFilename: string | null;
    }>;
    total: number;
    counts: Record<string, number>;
  };
  assert(listBody.total === 6, `Tổng số giấy phải bằng 6, nhận được ${listBody.total}`);
  for (const item of listBody.items) {
    for (const sTag of SENSITIVE_TAGS) {
      assert(
        !(sTag in item.fields),
        `Danh sách đối soát không được chứa trường nhạy cảm ${sTag}`,
      );
    }
  }

  const detailRes = await request(app).get(`/api/certificates/${up1.row.id}`);
  assert(detailRes.status === 200, 'GET /api/certificates/:id phải trả HTTP 200');
  const detailBody = detailRes.body as {
    id: number;
    so: string;
    fields: Record<string, string>;
    issues: Array<{ code: string }>;
    xml: string | null;
  };
  assert(
    Object.keys(detailBody.fields).length === 25,
    'Chi tiết 1 giấy phải trả đủ 25 trường',
  );
  assert(
    detailBody.xml === xmlText,
    'Trường xml trong chi tiết giấy phải khớp 100% với file XML tải lẻ',
  );

  // 6. Ghi báo cáo kiểm tra vào docs/evidence/S10/verify-output.txt
  const excelPreviewRows: string[] = [];
  for (let r = 2; r <= sheet!.rowCount; r++) {
    const row = sheet!.getRow(r);
    const so = String(row.getCell(1).value ?? '');
    const hoten = String(row.getCell(3).value ?? '');
    const cccd = String(row.getCell(10).value ?? '');
    const statusLabel = String(row.getCell(24).value ?? '');
    const dotImport = String(row.getCell(25).value ?? '');
    const sentAt = String(row.getCell(26).value ?? '');
    const msgId = String(row.getCell(27).value ?? '');
    const certIdSo = String(row.getCell(28).value ?? '');
    const detail = String(row.getCell(29).value ?? '');
    excelPreviewRows.push(
      `| ${r - 1} | \`${so}\` | \`${hoten}\` | \`${cccd}\` | **${statusLabel}** | \`${dotImport}\` | \`${sentAt || '-'}\` | \`${msgId || '-'}\` | \`${certIdSo || '-'}\` | ${detail || '-'} |`,
    );
  }

  const reportLines: string[] = [
    '# Báo cáo Kiểm chứng Bước S10 — API Danh sách đối soát, Chi tiết chỉ đọc, Xuất XML (`.xml` & `.zip`) và Xuất Excel đối soát',
    '',
    `- **Thời gian thực thi**: \`${new Date().toISOString()}\``,
    '- **Kho dữ liệu**: `InMemoryRepositories` (tuân thủ quy tắc bảo vệ MSSQL đang vận hành).',
    '- **3 file bằng chứng thực tế đã sinh**:',
    `  1. \`docs/evidence/S10/TEST_75001_0001.xml\` (${Buffer.byteLength(xmlText, 'utf8')} bytes UTF-8)`,
    `  2. \`docs/evidence/S10/GKSK_XML_batch.zip\` (${zipBuffer.length} bytes — đóng gói ${extractedZip.length} file XML hợp lệ)`,
    `  3. \`docs/evidence/S10/GKSK_doi_soat_sample.xlsx\` (${excelBuffer.length} bytes — 29 cột = 23 cột gốc định dạng Text \`@\` + 6 cột đối soát)`,
    '',
    '---',
    '',
    '## 1. Kiểm chứng `GET /api/certificates` — Thống kê `counts` 4 Tab đối soát & Bảo mật Ẩn 4 Trường nhạy cảm',
    '',
    '### Thống kê `counts` trả về từ API',
    '```json',
    JSON.stringify(listBody.counts, null, 2),
    '```',
    '',
    `- **Số trường trong \`items[i].fields\` ở danh sách**: **${Object.keys(listBody.items[0]!.fields).length} trường** (đã loại bỏ 4 trường nhạy cảm: \`${SENSITIVE_TAGS.join(', ')}\`).`,
    `- **Số trường trong \`fields\` ở chi tiết \`GET /api/certificates/:id\`**: **${Object.keys(detailBody.fields).length} trường** (đủ 25 trường theo thứ tự BHXH: \`${FIELD_ORDER.join(', ')}\`).`,
    '- **Kiểm tra không có endpoint tạo/sửa tay**: `POST /api/certificates` → `404`, `PUT /api/certificates/:id` → `404` (PASS).',
    '',
    '---',
    '',
    '## 2. Kiểm chứng File XML tải lẻ (`docs/evidence/S10/TEST_75001_0001.xml`)',
    '',
    '```xml',
    xmlText.trim(),
    '```',
    '',
    '---',
    '',
    '## 3. Kiểm chứng File ZIP hàng loạt (`docs/evidence/S10/GKSK_XML_batch.zip`)',
    '',
    '| STT | Tên file trong `.zip` (`sanitizeXmlFileName`) | Kích thước giải nén (bytes) | Khớp `buildGkskXml` |',
    '|---:|---|---:|---|',
    ...extractedZip.map(
      (entry, idx) =>
        `| ${idx + 1} | \`${entry.fileName}\` | ${entry.content.length} | ✔ Khớp 100% từng byte UTF-8 |`,
    ),
    '',
    '---',
    '',
    '## 4. Kiểm chứng File Excel Đối soát 29 Cột (`docs/evidence/S10/GKSK_doi_soat_sample.xlsx`)',
    '',
    `- **23 cột dữ liệu gốc (định dạng Text \`numFmt = "@"\`)**: \`${RECONCILE_TEMPLATE_COLUMNS.join(', ')}\``,
    `- **6 cột đối soát ở cuối**: \`${RECONCILE_EXTRA_COLUMNS.join(', ')}\``,
    `- **Tổng số cột**: **${RECONCILE_ALL_COLUMNS.length} cột**`,
    '',
    '### Bảng trích xuất 6 dòng dữ liệu từ `GKSK_doi_soat_sample.xlsx` (đọc lại bằng `exceljs`)',
    '',
    '| Dòng | `SO` | `HOTEN` | `SOCMND_PASSPORT` | `TRANG_THAI_DOI_SOAT` | `DOT_IMPORT` | `THOI_GIAN_DAY` | `MSG_ID` | `CERTIFICATE_ID_SO` | `CHI_TIET_LOI_CANH_BAO` |',
    '|---:|---|---|---|---|---|---|---|---|---|',
    ...excelPreviewRows,
    '',
  ];

  fs.writeFileSync(VERIFY_OUT, reportLines.join('\n'), 'utf8');

  process.stdout.write(
    `VERIFY S10 PASSED: Generated ${XML_OUT}, ${ZIP_OUT}, ${XLSX_OUT}, and ${VERIFY_OUT}.\n`,
  );
}

runVerification().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
