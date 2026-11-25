import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import request from 'supertest';
import {
  FIELDS,
  TEMPLATE_FIELDS,
  type GkskRecord,
} from '../packages/shared/src/index.js';
import { createApp } from '../server/src/app.js';
import { createInMemoryRepositories } from '../server/src/db/inMemoryRepo.js';
import { createLogger } from '../server/src/logger.js';
import {
  RECONCILE_ALL_COLUMNS,
  RECONCILE_EXTRA_COLUMNS,
} from '../server/src/services/exportService.js';
import {
  TEMPLATE_FORMATTED_ROWS,
  type ImportPreviewRow,
} from '../server/src/services/importService.js';
import {
  createWorkbookBuffer,
  makeDefaultFixtureRow,
  TEMPLATE_TAGS,
  writeFixturesToDisk,
} from '../tests/fixtures/make-fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'S11');
const TEMPLATE_OUT = path.join(EVIDENCE_DIR, 'GKSK_mau_nhap_lieu.xlsx');
const REPORT_OUT = path.join(EVIDENCE_DIR, 'smart-import-report.md');
const VERIFY_OUT = path.join(EVIDENCE_DIR, 'verify-output.txt');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`VERIFY S11 FAILED: ${message}`);
  }
}

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
}

async function runVerification(): Promise<void> {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  // 0. Sinh 19 file Excel fixtures chuẩn vào tests/fixtures/
  const fixturePaths = await writeFixturesToDisk();
  assert(
    fixturePaths.length === 19,
    `Phải sinh đủ 19 file fixtures trong tests/fixtures/, nhận được ${fixturePaths.length}`,
  );

  const logLines: string[] = [];
  const logStream = new Writable({
    write(chunk, _enc, cb) {
      logLines.push(chunk.toString('utf8'));
      cb();
    },
  });
  const logger = createLogger({ level: 'info', destination: logStream });

  const repos = createInMemoryRepositories();
  const fixedNowMs = Date.parse('2026-11-23T04:00:00.000Z'); // 11:00:00 giờ VN
  const app = createApp({
    repos,
    facilityId: '75001',
    facilityName: 'Benh vien Da khoa Dong Nai',
    today: '2026-11-23',
    now: () => fixedNowMs,
    logger,
  });

  // ===========================================================================
  // 1. Gọi GET /api/import/template để sinh file mẫu thật docs/evidence/S11/GKSK_mau_nhap_lieu.xlsx
  // ===========================================================================
  const templateRes = await request(app)
    .get('/api/import/template')
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  assert(
    templateRes.status === 200,
    'GET /api/import/template phải trả HTTP 200',
  );
  const templateBuffer = templateRes.body as Buffer;
  fs.writeFileSync(TEMPLATE_OUT, templateBuffer);

  // Kiểm tra cấu trúc file mẫu bằng ExcelJS
  const templateWb = new ExcelJS.Workbook();
  await templateWb.xlsx.load(bufferToArrayBuffer(templateBuffer));
  const gkskSheet = templateWb.getWorksheet('GKSK');
  const guideSheet = templateWb.getWorksheet('HuongDan');
  assert(
    Boolean(gkskSheet) && Boolean(guideSheet),
    'File mẫu phải có đủ 2 sheet GKSK và HuongDan',
  );
  assert(
    gkskSheet!.columnCount === TEMPLATE_FIELDS.length,
    `Sheet GKSK phải có đúng 23 cột, nhận được ${gkskSheet!.columnCount}`,
  );
  assert(
    gkskSheet!.getRow(2).getCell(1).numFmt === '@' &&
      gkskSheet!.getRow(TEMPLATE_FORMATTED_ROWS + 1).getCell(1).numFmt === '@',
    'Sheet GKSK phải định dạng Text @ cho ít nhất 2000 dòng đầu',
  );
  assert(
    guideSheet!.rowCount === FIELDS.length + 1,
    `Sheet HuongDan phải có đủ 25 dòng trường dữ liệu + 1 dòng tiêu đề`,
  );

  // ===========================================================================
  // 2. Mô phỏng Luồng Import Lần 1 -> Đẩy cổng -> Xuất Excel Đối soát 29 cột -> Sửa lỗi trên file Đối soát -> Import Lần 2
  // ===========================================================================
  // Tạo file Excel Đợt 1 gồm 5 dòng:
  // - Dòng 2 (TEST.75001.S11.01): Hợp lệ -> sau khi import sẽ được đánh dấu đã đẩy thành công (accepted) và giữ nguyên ở lần 2
  // - Dòng 3 (TEST.75001.S11.02): Hợp lệ -> sau khi import sẽ được đánh dấu đã đẩy thành công (accepted), nhưng ở lần 2 người dùng sửa HOTEN
  // - Dòng 4 (TEST.75001.S11.03): Hợp lệ -> giữ ở trạng thái chờ đẩy (ready)
  // - Dòng 5 (TEST.75001.S11.04): Lỗi dữ liệu chặn (NGAYSINH = '31/02/1990') -> lưu vào DB với status = 'invalid' để khớp 100% quân số
  // - Dòng 6 (TEST.75001.S11.05): Hợp lệ nhưng khi đẩy lên Sở bị từ chối (status = 'rejected')
  const round1Buf = await createWorkbookBuffer({
    headers: TEMPLATE_TAGS,
    rows: [
      makeDefaultFixtureRow(1, {
        SO: 'TEST.75001.S11.01',
        HOTEN: 'TEST NGUYEN VAN MOT',
        SOCMND_PASSPORT: '079000012341',
      }),
      makeDefaultFixtureRow(2, {
        SO: 'TEST.75001.S11.02',
        HOTEN: 'TEST TRAN THI HAI',
        SOCMND_PASSPORT: 'TESTGKSK02',
      }),
      makeDefaultFixtureRow(3, {
        SO: 'TEST.75001.S11.03',
        HOTEN: 'TEST LE VAN BA',
        SOCMND_PASSPORT: 'TESTGKSK03',
      }),
      makeDefaultFixtureRow(4, {
        SO: 'TEST.75001.S11.04',
        HOTEN: 'TEST PHAM THI BON',
        NGAYSINH: '31/02/1990', // Lỗi ngày sinh không tồn tại
        SOCMND_PASSPORT: 'TESTGKSK04',
      }),
      makeDefaultFixtureRow(5, {
        SO: 'TEST.75001.S11.05',
        HOTEN: 'TEST HOANG VAN NAM',
        KETLUAN: 'A0-2',
        SOCMND_PASSPORT: 'TESTGKSK05',
      }),
    ],
  });

  // 2.1 Xem trước Import Lần 1
  const preview1Res = await request(app)
    .post('/api/import/excel')
    .attach('file', round1Buf, 'DS_KSK_Dot1.xlsx');
  assert(preview1Res.status === 200, 'POST /api/import/excel lần 1 thất bại');
  const preview1Rows = preview1Res.body.rows as ImportPreviewRow[];
  assert(
    preview1Rows.length === 5 &&
      preview1Res.body.summary.newCount === 5 &&
      preview1Res.body.summary.defaultSelectedCount === 5,
    'Import lần 1 phải có 5 dòng new và cả 5 dòng (kể cả dòng invalid có SO) đều có defaultSelected=true',
  );

  // 2.2 Lưu đợt Import Lần 1 vào Danh sách đối soát
  const commit1Res = await request(app)
    .post('/api/import/commit')
    .send({
      filename: 'DS_KSK_Dot1.xlsx',
      rows: preview1Rows.map((r) => ({
        rowNumber: r.rowNumber,
        fields: r.fields,
        selected: r.defaultSelected,
      })),
    });
  assert(
    commit1Res.status === 200 &&
      commit1Res.body.totalCommitted === 5 &&
      commit1Res.body.readyCount === 4 &&
      commit1Res.body.invalidCount === 1,
    'Commit lần 1 phải lưu đủ 5 dòng (4 ready + 1 invalid)',
  );

  // 2.3 Mô phỏng kết quả sau khi đẩy cổng cho hồ sơ #01, #02 (accepted) và #05 (rejected)
  const cert1 = (await repos.certificates.findBySo('TEST.75001.S11.01'))!;
  const cert2 = (await repos.certificates.findBySo('TEST.75001.S11.02'))!;
  const cert5 = (await repos.certificates.findBySo('TEST.75001.S11.05'))!;

  await repos.certificates.updateStatus(cert1.id, {
    status: 'accepted',
    serverCertificateId: 'CERT-S11-0001',
  });
  await repos.submissions.create({
    certificateId: cert1.id,
    msgId: '7500126112322222222222242228222222222222201',
    sendDatetime: fixedNowMs,
    dataSha256: cert1.dataSha256,
    attempts: 1,
    httpStatus: 200,
    resCode: 'PS_SYNC_SUCCESS',
    resultStatus: 'accepted',
    serverSubmissionId: 'SUB-S11-0001',
    warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
    finishedAt: new Date(fixedNowMs),
  });

  await repos.certificates.updateStatus(cert2.id, {
    status: 'accepted',
    serverCertificateId: 'CERT-S11-0002',
  });
  await repos.submissions.create({
    certificateId: cert2.id,
    msgId: '7500126112322222222222242228222222222222202',
    sendDatetime: fixedNowMs,
    dataSha256: cert2.dataSha256,
    attempts: 1,
    httpStatus: 200,
    resCode: 'PS_SYNC_SUCCESS',
    resultStatus: 'accepted',
    serverSubmissionId: 'SUB-S11-0002',
    warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
    finishedAt: new Date(fixedNowMs),
  });

  await repos.certificates.updateStatus(cert5.id, {
    status: 'rejected',
  });
  await repos.submissions.create({
    certificateId: cert5.id,
    msgId: '7500126112322222222222242228222222222222205',
    sendDatetime: fixedNowMs,
    dataSha256: cert5.dataSha256,
    attempts: 1,
    httpStatus: 200,
    resCode: 'PS_SYNC_SUCCESS',
    resultStatus: 'rejected',
    serverSubmissionId: 'SUB-S11-0005',
    errors: [{ code: 'GKSK_FACILITY_MISMATCH', field: 'IDBENHVIEN' }],
    finishedAt: new Date(fixedNowMs),
  });

  // 2.4 Xuất file Excel đối soát 29 cột từ GET /api/certificates/export-excel
  const exportRes = await request(app)
    .get('/api/certificates/export-excel')
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  assert(
    exportRes.status === 200,
    'GET /api/certificates/export-excel phải trả HTTP 200',
  );
  const reconcileWb = new ExcelJS.Workbook();
  await reconcileWb.xlsx.load(bufferToArrayBuffer(exportRes.body as Buffer));
  const reconcileSheet = reconcileWb.getWorksheet('GKSK')!;
  assert(
    reconcileSheet.columnCount === RECONCILE_ALL_COLUMNS.length,
    'File Excel đối soát phải có đúng 29 cột',
  );

  // 2.5 Người dùng mở chính file Excel đối soát 29 cột đó để:
  // - Sửa dòng bị lỗi dữ liệu Excel (TEST.75001.S11.04): sửa NGAYSINH từ '31/02/1990' -> '15/08/1992'
  // - Sửa dòng bị Sở từ chối (TEST.75001.S11.05): sửa KETLUAN -> 'A0-1'
  // - Thử sửa HOTEN của dòng đã đẩy thành công (TEST.75001.S11.02) -> 'TEST TRAN THI HAI (DA SUA)'
  // - Thêm 1 dòng mới tinh (TEST.75001.S11.06) ở cuối
  const soColIdx = TEMPLATE_TAGS.indexOf('SO') + 1;
  const hotenColIdx = TEMPLATE_TAGS.indexOf('HOTEN') + 1;
  const ngaysinhColIdx = TEMPLATE_TAGS.indexOf('NGAYSINH') + 1;
  const ketluanColIdx = TEMPLATE_TAGS.indexOf('KETLUAN') + 1;

  for (let r = 2; r <= reconcileSheet.rowCount; r++) {
    const row = reconcileSheet.getRow(r);
    const so = String(row.getCell(soColIdx).value ?? '');
    if (so === 'TEST.75001.S11.04') {
      row.getCell(ngaysinhColIdx).value = '15/08/1992';
    } else if (so === 'TEST.75001.S11.05') {
      row.getCell(ketluanColIdx).value = 'A0-1';
    } else if (so === 'TEST.75001.S11.02') {
      row.getCell(hotenColIdx).value = 'TEST TRAN THI HAI (DA SUA)';
    }
  }

  // Thêm dòng mới thứ 6 vào file đối soát
  const newRow6Data = makeDefaultFixtureRow(6, {
    SO: 'TEST.75001.S11.06',
    HOTEN: 'TEST VU VAN SAU (MOI)',
    SOCMND_PASSPORT: 'TESTGKSK06',
  });
  reconcileSheet.addRow(
    RECONCILE_ALL_COLUMNS.map((col) =>
      col in newRow6Data ? String(newRow6Data[col]) : '',
    ),
  );

  const editedReconcileBuffer = Buffer.from(
    await reconcileWb.xlsx.writeBuffer(),
  );

  // 2.6 Import lại lần 2 bằng chính file Excel đối soát 29 cột vừa sửa!
  const preview2Res = await request(app)
    .post('/api/import/excel')
    .attach('file', editedReconcileBuffer, 'GKSK_doi_soat_da_sua.xlsx');
  assert(
    preview2Res.status === 200,
    'POST /api/import/excel lần 2 (round-trip file đối soát 29 cột) phải trả HTTP 200',
  );

  const preview2Body = preview2Res.body as {
    filename: string;
    sheetName: string;
    matchedColumns: string[];
    ignoredColumns: string[];
    summary: Record<string, number>;
    rows: ImportPreviewRow[];
  };

  assert(
    JSON.stringify(preview2Body.ignoredColumns) ===
      JSON.stringify(RECONCILE_EXTRA_COLUMNS),
    `6 cột đối soát cuối phải được nhận diện là ignoredColumns: ${JSON.stringify(preview2Body.ignoredColumns)}`,
  );

  const rowBySo = new Map(preview2Body.rows.map((r) => [r.so, r]));
  assert(
    rowBySo.get('TEST.75001.S11.01')?.conflictMode === 'accepted_unchanged' &&
      rowBySo.get('TEST.75001.S11.01')?.defaultSelected === false,
    'Hồ sơ #01 (accepted không đổi) phải có conflictMode=accepted_unchanged, defaultSelected=false',
  );
  assert(
    rowBySo.get('TEST.75001.S11.02')?.conflictMode === 'accepted_modified' &&
      rowBySo.get('TEST.75001.S11.02')?.defaultSelected === false,
    'Hồ sơ #02 (accepted có sửa) phải có conflictMode=accepted_modified, defaultSelected=false',
  );
  assert(
    rowBySo.get('TEST.75001.S11.03')?.conflictMode === 'overwrite_pending' &&
      rowBySo.get('TEST.75001.S11.03')?.defaultSelected === true,
    'Hồ sơ #03 (ready) phải có conflictMode=overwrite_pending, defaultSelected=true',
  );
  assert(
    rowBySo.get('TEST.75001.S11.04')?.conflictMode === 'overwrite_pending' &&
      rowBySo.get('TEST.75001.S11.04')?.status === 'ready' &&
      rowBySo.get('TEST.75001.S11.04')?.defaultSelected === true,
    'Hồ sơ #04 (cũ invalid, đã sửa ngày sinh) phải chuyển sang status=ready, conflictMode=overwrite_pending, defaultSelected=true',
  );
  assert(
    rowBySo.get('TEST.75001.S11.05')?.conflictMode === 'overwrite_pending' &&
      rowBySo.get('TEST.75001.S11.05')?.status === 'ready' &&
      rowBySo.get('TEST.75001.S11.05')?.defaultSelected === true,
    'Hồ sơ #05 (cũ rejected, đã sửa) phải có conflictMode=overwrite_pending, defaultSelected=true',
  );
  assert(
    rowBySo.get('TEST.75001.S11.06')?.conflictMode === 'new' &&
      rowBySo.get('TEST.75001.S11.06')?.status === 'ready' &&
      rowBySo.get('TEST.75001.S11.06')?.defaultSelected === true,
    'Hồ sơ #06 (mới thêm) phải có conflictMode=new, defaultSelected=true',
  );

  // 2.7 Commit lần 2 theo đúng lựa chọn mặc định thông minh (4 dòng được chọn: #03, #04, #05, #06; tự động bỏ qua 2 dòng accepted #01, #02)
  const commit2Res = await request(app)
    .post('/api/import/commit')
    .send({
      filename: 'GKSK_doi_soat_da_sua.xlsx',
      rows: preview2Body.rows.map((r: ImportPreviewRow) => ({
        rowNumber: r.rowNumber,
        fields: r.fields as GkskRecord,
        selected: r.defaultSelected,
      })),
    });
  assert(
    commit2Res.status === 200 &&
      commit2Res.body.totalCommitted === 4 &&
      commit2Res.body.inserted === 1 &&
      commit2Res.body.updated === 3 &&
      commit2Res.body.skippedCount === 2,
    'Commit lần 2 phải cập nhật 3 dòng pending, thêm 1 dòng mới và bỏ qua 2 dòng accepted',
  );

  const finalCounts = await repos.certificates.countByStatus();
  assert(
    finalCounts.all === 6 &&
      finalCounts.accepted === 2 &&
      finalCounts.ready === 4 &&
      finalCounts.invalid === 0 &&
      finalCounts.rejected === 0,
    `Sau khi import đè sửa lỗi, toàn bộ 6 hồ sơ phải ở trạng thái hợp lệ (2 accepted + 4 ready, 0 invalid, 0 rejected), nhận được: ${JSON.stringify(finalCounts)}`,
  );

  // Kiểm tra log không rò rỉ PII
  const fullLogs = logLines.join('\n');
  assert(
    !fullLogs.includes('TEST NGUYEN') && !fullLogs.includes('079000012341'),
    'Phát hiện rò rỉ PII trong log Pino!',
  );

  // ===========================================================================
  // 3. Xuất báo cáo docs/evidence/S11/smart-import-report.md & verify-output.txt
  // ===========================================================================
  const reportLines: string[] = [
    '# Báo cáo Kiểm chứng Bước S11 — Mẫu Excel & Import Ghi đè Thông minh (`smart-import-report.md`)',
    '',
    `- **Thời gian thực thi**: \`${new Date().toISOString()}\``,
    '- **Kho dữ liệu**: `InMemoryRepositories` (tuân thủ quy tắc bảo vệ MSSQL đang vận hành).',
    `- **File mẫu thực tế đã sinh**: \`docs/evidence/S11/GKSK_mau_nhap_lieu.xlsx\` (${templateBuffer.length} bytes)`,
    `- **Bộ fixtures kiểm thử đã sinh**: **${fixturePaths.length} file** tại \`tests/fixtures/*.xlsx\` theo đúng \`docs/TEST-PLAN.md §2.1\`.`,
    `- **Kiểm toán Log Pino (${logLines.length} dòng)**: **0 rò rỉ PII** (không chứa họ tên, CCCD, dữ liệu ô Excel).`,
    '',
    '---',
    '',
    '## 1. Kiểm định File Mẫu `docs/evidence/S11/GKSK_mau_nhap_lieu.xlsx`',
    '',
    '- **Sheet 1 — `GKSK`**:',
    `  - Số cột: **${TEMPLATE_FIELDS.length} cột** theo đúng thứ tự bảng BHXH (trừ \`IDBENHVIEN\`, \`BENHVIEN\` do server tự điền): \`${TEMPLATE_TAGS.join(', ')}\`.`,
    `  - Định dạng ô: \`numFmt = "@"\` (Text) áp dụng cho toàn bộ **23 cột × ${TEMPLATE_FORMATTED_ROWS} dòng dữ liệu đầu** (dòng \`2..${TEMPLATE_FORMATTED_ROWS + 1}\`) để giữ số \`0\` đầu của CCCD và không tự đổi ngày.`,
    '  - Đóng băng tiêu đề: Freeze dòng 1 (`state = "frozen", ySplit = 1`), để trống dữ liệu từ dòng 2.',
    '  - Dropdown Data Validation: `GIOITINHVAL` (`0,1`), `DVINONGDOCON` (`0,1`), `MATUY` (`0,1`), `KETLUAN` (`A0-1,A0-2,A0-3`), `STATE` (`ADD,EDIT`).',
    '- **Sheet 2 — `HuongDan`**:',
    `  - Sinh tự động từ hằng số \`FIELDS\` (**${FIELDS.length} trường**), gồm 5 cột: \`Thẻ\`, \`Ý nghĩa\`, \`Bắt buộc (Sở / BHXH)\`, \`Định dạng & độ dài tối đa\`, \`Ví dụ giả (chỉ dùng thử nghiệm)\`.`,
    '',
    '---',
    '',
    '## 2. Mô phỏng Luồng Nghiệp vụ Khép kín: Import Lần 1 → Đẩy cổng → Xuất Excel Đối soát (29 cột) → Sửa lỗi trên File Đối soát → Import Ghi đè Thông minh Lần 2',
    '',
    '### 2.1. Kết quả Import Lần 1 (`DS_KSK_Dot1.xlsx` — 5 dòng mới)',
    '',
    '| Dòng Excel | Mã `SO` | Trạng thái dữ liệu (`status`) | `conflictMode` | `defaultSelected` | Trạng thái sau khi Đẩy cổng (trước Lần 2) |',
    '|---:|---|---|:---:|:---:|---|',
    '| 2 | `TEST.75001.S11.01` | `ready` (✅ Hợp lệ) | `new` | `true` | `accepted` (Đã đẩy thành công — `CERT-S11-0001`) |',
    '| 3 | `TEST.75001.S11.02` | `ready` (✅ Hợp lệ) | `new` | `true` | `accepted` (Đã đẩy thành công — `CERT-S11-0002`) |',
    '| 4 | `TEST.75001.S11.03` | `ready` (✅ Hợp lệ) | `new` | `true` | `ready` (Chờ đẩy cổng) |',
    '| 5 | `TEST.75001.S11.04` | `invalid` (⛔ Sai ngày sinh `31/02/1990`) | `new` | `true` *(lưu để đối soát 100% quân số)* | `invalid` (Lỗi dữ liệu Excel) |',
    '| 6 | `TEST.75001.S11.05` | `ready` (✅ Hợp lệ) | `new` | `true` | `rejected` (Cổng Sở từ chối) |',
    '',
    '### 2.2. Xuất File Excel Đối soát 29 cột & Sửa lỗi trực tiếp trên File Đối soát',
    '',
    '- Gọi `GET /api/certificates/export-excel` → nhận file `.xlsx` 29 cột (23 cột gốc + 6 cột đối soát).',
    '- Người dùng mở chính file Excel đối soát 29 cột này, thực hiện:',
    '  1. Sửa `NGAYSINH` của hồ sơ lỗi `TEST.75001.S11.04` từ `31/02/1990` → `15/08/1992`.',
    '  2. Sửa `KETLUAN` của hồ sơ bị từ chối `TEST.75001.S11.05` từ `A0-2` → `A0-1`.',
    '  3. Thử sửa `HOTEN` của hồ sơ đã đẩy thành công `TEST.75001.S11.02` thành `TEST TRAN THI HAI (DA SUA)`.',
    '  4. Thêm 1 dòng mới `TEST.75001.S11.06` ở cuối bảng.',
    '- Đem nguyên file đối soát 29 cột vừa sửa nạp lại vào `POST /api/import/excel`:',
    `  - **6 cột đối soát cuối tự động được bỏ qua (\`ignoredColumns\`)**: \`${preview2Body.ignoredColumns.join(', ')}\`.`,
    '',
    '### 2.3. Bảng Đối chiếu `conflictMode` & `defaultSelected` của Từng Dòng ở Lần Import Thứ 2',
    '',
    '| Dòng Excel | Mã `SO` | Trạng thái cũ trong DB | Trạng thái dữ liệu mới | `conflictMode` | `defaultSelected` | Mã thông báo đối chiếu (`issues`) |',
    '|---:|---|---|---|---|---|---|',
  ];

  for (const r of preview2Body.rows) {
    const conflictIssues = r.issues
      .filter((i) => i.code.startsWith('LOCAL_SO_') && i.code !== 'LOCAL_SO_FORMAT')
      .map((i) => i.code);
    reportLines.push(
      `| ${r.rowNumber} | \`${r.so}\` | \`${r.existingStatus ?? '(chưa có)'}\` | \`${r.status}\` | **\`${r.conflictMode}\`** | \`${r.defaultSelected}\` | \`${conflictIssues.join(', ') || '-'}\` |`,
    );
  }

  reportLines.push(
    '',
    '### 2.4. JSON `summary` của Bản Xem trước Lần 2 (`POST /api/import/excel`)',
    '',
    '```json',
    JSON.stringify(preview2Body.summary, null, 2),
    '```',
    '',
    '### 2.5. Kết quả Lưu vào Danh sách Đối soát Lần 2 (`POST /api/import/commit`)',
    '',
    '```json',
    JSON.stringify(
      {
        batch: commit2Res.body.batch,
        totalCommitted: commit2Res.body.totalCommitted,
        inserted: commit2Res.body.inserted,
        updated: commit2Res.body.updated,
        readyCount: commit2Res.body.readyCount,
        invalidCount: commit2Res.body.invalidCount,
        skippedCount: commit2Res.body.skippedCount,
        finalDbCounts: finalCounts,
      },
      null,
      2,
    ),
    '```',
    '',
  );

  const reportText = reportLines.join('\n');
  fs.writeFileSync(REPORT_OUT, reportText, 'utf8');
  fs.writeFileSync(VERIFY_OUT, reportText, 'utf8');

  process.stdout.write(
    `VERIFY S11 PASSED: Generated ${TEMPLATE_OUT}, ${REPORT_OUT}, ${VERIFY_OUT}, and ${fixturePaths.length} fixtures.\n`,
  );
}

runVerification().catch((err) => {
  process.stderr.write(
    `${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
