import ExcelJS from 'exceljs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  createEmptyRecord,
  FIELD_ORDER,
  SENSITIVE_TAGS,
  type GkskRecord,
} from '@gksk/shared';
import { createApp } from '../app.js';
import { createInMemoryRepositories } from '../db/inMemoryRepo.js';
import { buildGkskXml } from '../gksk/xml.js';
import {
  buildReconcileExcel,
  buildXmlFileName,
  buildXmlZip,
  extractZipArchiveBuffer,
  RECONCILE_ALL_COLUMNS,
  RECONCILE_EXTRA_COLUMNS,
  RECONCILE_TEMPLATE_COLUMNS,
  sanitizeXmlFileName,
} from '../services/exportService.js';
import { computeCertificatePayload } from '../services/sendService.js';

function makeSampleRecord(overrides: Partial<GkskRecord> = {}): GkskRecord {
  const base = createEmptyRecord();
  return {
    ...base,
    SO: 'TEST.75001.1',
    NGAYKHAM: '05/11/2026',
    HOTEN: 'TEST NGUYEN VAN A',
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
    NONGDOCON: '0.25',
    DVINONGDOCON: '0',
    MATUY: '1',
    BACSYKETLUAN: 'TEST BS NGUYEN VAN B',
    KETLUAN: 'A0-1',
    NGAYKHAMLAI: '',
    LYDO: 'Secret Ly Do Suc Khoe',
    TINHTRANGBENH: 'Secret Tinh Trang Benh',
    STATE: 'ADD',
    ...overrides,
  };
}

describe('S10 — exportService & API Danh sách đối soát, Chi tiết chỉ đọc, Xuất XML/ZIP/Excel', () => {
  it('1. sanitizeXmlFileName (buildXmlFileName) làm sạch ký tự cấm và chặn path traversal ../', () => {
    expect(sanitizeXmlFileName('TEST.75001.1')).toBe('TEST.75001.1.xml');
    expect(buildXmlFileName('00001/GKSKLX/75001/26')).toBe(
      '00001_GKSKLX_75001_26.xml',
    );
    expect(sanitizeXmlFileName('../../etc/passwd')).toBe('etc_passwd.xml');
    expect(sanitizeXmlFileName('..\\..\\Windows\\System32\\cmd')).toBe(
      'Windows_System32_cmd.xml',
    );
    expect(sanitizeXmlFileName('SO:123*456?789"<>|')).toBe(
      'SO_123_456_789.xml',
    );
    expect(sanitizeXmlFileName('   ...   ')).toBe('GKSK.xml');
  });

  it('2. buildXmlZip đóng gói chỉ các giấy hợp lệ và giải nén khớp 100% từng byte UTF-8', () => {
    const rec1 = makeSampleRecord({
      SO: 'TEST.75001.0001',
      HOTEN: 'TEST NGUYEN VAN MOT',
    });
    const rec2 = makeSampleRecord({
      SO: '00002/GKSKLX/75001/26',
      HOTEN: 'TEST TRAN THI HAI & <DAC BIET>',
    });
    const recInvalid = makeSampleRecord({
      SO: 'TEST.75001.INVALID',
      NGAYSINH: '31/02/1990',
    });

    const zipBuf = buildXmlZip(
      [
        { so: rec1.SO, fields: rec1, status: 'ready' },
        { so: rec2.SO, fields: rec2, status: 'accepted' },
        { so: recInvalid.SO, fields: recInvalid, status: 'invalid' },
      ],
      { facilityId: '75001', today: '2026-11-23' },
    );

    // Kiểm tra magic bytes PK\x03\x04
    expect(zipBuf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(
      true,
    );

    const extracted = extractZipArchiveBuffer(zipBuf);
    expect(extracted).toHaveLength(2);
    expect(extracted[0]?.fileName).toBe('TEST.75001.0001.xml');
    expect(extracted[0]?.content.toString('utf8')).toBe(buildGkskXml(rec1));

    expect(extracted[1]?.fileName).toBe('00002_GKSKLX_75001_26.xml');
    expect(extracted[1]?.content.toString('utf8')).toBe(buildGkskXml(rec2));
  });

  it('3. buildReconcileExcel xuất đúng 29 cột (23 cột gốc định dạng Text @ + 6 cột đối soát)', async () => {
    const recAccepted = makeSampleRecord({
      SO: 'TEST.75001.ACC',
      SOCMND_PASSPORT: '079000012345',
    });
    const recInvalid = makeSampleRecord({
      SO: 'TEST.75001.INV',
      NGAYSINH: '31/02/1990',
    });

    const excelBuf = await buildReconcileExcel([
      {
        so: recAccepted.SO,
        fields: recAccepted,
        status: 'accepted',
        batchFilename: 'dot_1.xlsx',
        excelRowNumber: 2,
        serverCertificateId: 'CERT-75001-01',
        lastSentAt: '2026-11-23T01:30:00.000Z', // 08:30:00 giờ VN
        lastMsgId: '7500126112300000000000000000000000000000001',
        serverWarnings: [{ code: 'GKSK_UNSIGNED', field: null }],
      },
      {
        so: recInvalid.SO,
        fields: recInvalid,
        status: 'invalid',
        batchFilename: 'dot_1.xlsx',
        excelRowNumber: 3,
        localIssues: [
          {
            code: 'GKSK_NGAYSINH_INVALID',
            field: 'NGAYSINH',
            severity: 'error',
            source: 'server-mirror',
          },
        ],
      },
    ]);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(excelBuf.buffer.slice(excelBuf.byteOffset, excelBuf.byteOffset + excelBuf.byteLength) as ArrayBuffer);
    const sheet = wb.getWorksheet('GKSK');
    expect(sheet).toBeDefined();

    // Kiểm tra dòng 1 có đúng 29 cột theo thứ tự
    const headerRow = sheet!.getRow(1);
    const actualHeaders: string[] = [];
    for (let col = 1; col <= RECONCILE_ALL_COLUMNS.length; col++) {
      actualHeaders.push(String(headerRow.getCell(col).value ?? ''));
    }
    expect(actualHeaders).toHaveLength(29);
    expect(actualHeaders.slice(0, 23)).toEqual(RECONCILE_TEMPLATE_COLUMNS);
    expect(actualHeaders.slice(23)).toEqual([...RECONCILE_EXTRA_COLUMNS]);

    // Kiểm tra dòng 2 (Đã đẩy thành công) giữ nguyên số 0 đầu của CCCD và định dạng Text '@'
    const row2 = sheet!.getRow(2);
    expect(row2.getCell(1).value).toBe('TEST.75001.ACC');
    expect(row2.getCell(1).numFmt).toBe('@');
    const cccdColIndex = RECONCILE_TEMPLATE_COLUMNS.indexOf('SOCMND_PASSPORT') + 1;
    expect(row2.getCell(cccdColIndex).value).toBe('079000012345');
    expect(row2.getCell(cccdColIndex).numFmt).toBe('@');

    expect(row2.getCell(24).value).toBe('Đã đẩy thành công');
    expect(row2.getCell(25).value).toBe('dot_1.xlsx (dòng 2)');
    expect(row2.getCell(26).value).toBe('23/11/2026 08:30:00');
    expect(row2.getCell(27).value).toBe(
      '7500126112300000000000000000000000000000001',
    );
    expect(row2.getCell(28).value).toBe('CERT-75001-01');
    expect(String(row2.getCell(29).value)).toContain('GKSK_UNSIGNED');

    // Kiểm tra dòng 3 (Lỗi dữ liệu Excel)
    const row3 = sheet!.getRow(3);
    expect(row3.getCell(24).value).toBe('Lỗi dữ liệu Excel');
    expect(String(row3.getCell(29).value)).toContain('GKSK_NGAYSINH_INVALID');
  });

  it('4. GET /api/batches và GET /api/certificates trả đúng counts 4 tab, lọc batchId/tab/status/q và ẩn tuyệt đối 4 trường nhạy cảm', async () => {
    const repos = createInMemoryRepositories();
    const app = createApp({
      repos,
      facilityId: '75001',
      today: '2026-11-23',
      now: () => Date.parse('2026-11-23T02:00:00.000Z'),
    });

    const batch1 = await repos.batches.create({
      filename: 'ksk_sang_23_11.xlsx',
      rowCount: 3,
      createdAt: '2026-11-23T01:00:00.000Z',
    });
    const batch2 = await repos.batches.create({
      filename: 'ksk_chieu_23_11.xlsx',
      rowCount: 2,
      createdAt: '2026-11-23T05:00:00.000Z',
    });

    // 1 ready, 1 accepted, 1 invalid (batch 1); 1 rejected, 1 error (batch 2)
    const recReady = makeSampleRecord({
      SO: 'TEST.75001.READY',
      HOTEN: 'TEST NGUYEN READY',
    });
    const recAccepted = makeSampleRecord({
      SO: 'TEST.75001.ACCEPTED',
      HOTEN: 'TEST NGUYEN ACCEPTED',
    });
    const recInvalid = makeSampleRecord({
      SO: 'TEST.75001.INVALID',
      HOTEN: 'TEST NGUYEN INVALID',
      NGAYSINH: '31/02/1990',
    });
    const recRejected = makeSampleRecord({
      SO: 'TEST.75001.REJECTED',
      HOTEN: 'TEST NGUYEN REJECTED',
    });
    const recError = makeSampleRecord({
      SO: 'TEST.75001.ERROR',
      HOTEN: 'TEST NGUYEN ERROR',
    });

    await repos.certificates.upsertBySo({
      so: recReady.SO,
      fields: recReady,
      dataSha256: computeCertificatePayload(recReady).dataSha256,
      status: 'ready',
      batchId: batch1.id,
      excelRowNumber: 2,
      now: '2026-11-23T01:01:00.000Z',
    });
    await repos.certificates.upsertBySo({
      so: recAccepted.SO,
      fields: recAccepted,
      dataSha256: computeCertificatePayload(recAccepted).dataSha256,
      status: 'accepted',
      batchId: batch1.id,
      excelRowNumber: 3,
      serverCertificateId: 'CERT-ACC-01',
      now: '2026-11-23T01:02:00.000Z',
    });
    await repos.certificates.upsertBySo({
      so: recInvalid.SO,
      fields: recInvalid,
      dataSha256: computeCertificatePayload(recInvalid).dataSha256,
      status: 'invalid',
      batchId: batch1.id,
      excelRowNumber: 4,
      now: '2026-11-23T01:03:00.000Z',
    });
    await repos.certificates.upsertBySo({
      so: recRejected.SO,
      fields: recRejected,
      dataSha256: computeCertificatePayload(recRejected).dataSha256,
      status: 'rejected',
      batchId: batch2.id,
      excelRowNumber: 2,
      now: '2026-11-23T05:01:00.000Z',
    });
    await repos.certificates.upsertBySo({
      so: recError.SO,
      fields: recError,
      dataSha256: computeCertificatePayload(recError).dataSha256,
      status: 'error',
      batchId: batch2.id,
      excelRowNumber: 3,
      now: '2026-11-23T05:02:00.000Z',
    });

    // Kiểm tra GET /api/batches
    const batchesRes = await request(app).get('/api/batches');
    expect(batchesRes.status).toBe(200);
    expect(batchesRes.body.items).toHaveLength(2);
    expect(batchesRes.body.items[0].filename).toBe('ksk_chieu_23_11.xlsx');

    // Kiểm tra GET /api/certificates (tất cả)
    const allRes = await request(app).get('/api/certificates');
    expect(allRes.status).toBe(200);
    expect(allRes.body.total).toBe(5);
    expect(allRes.body.counts).toEqual({
      all: 5,
      unsent: 1,
      accepted: 1,
      attention: 3,
      ready: 1,
      invalid: 1,
      rejected: 1,
      error: 1,
      sending: 0,
    });

    // Khẳng định tuyệt đối KHÔNG có 4 trường nhạy cảm trong từng item của danh sách
    for (const item of allRes.body.items) {
      for (const sensitiveTag of SENSITIVE_TAGS) {
        expect(item.fields).not.toHaveProperty(sensitiveTag);
      }
      expect(Object.keys(item.fields)).toHaveLength(
        FIELD_ORDER.length - SENSITIVE_TAGS.length,
      );
    }
    const rawJsonText = JSON.stringify(allRes.body);
    expect(rawJsonText).not.toContain('Secret Ly Do Suc Khoe');
    expect(rawJsonText).not.toContain('Secret Tinh Trang Benh');

    // Lọc theo tab=unsent | accepted | attention
    const unsentRes = await request(app)
      .get('/api/certificates')
      .query({ tab: 'unsent' });
    expect(unsentRes.status).toBe(200);
    expect(unsentRes.body.items).toHaveLength(1);
    expect(unsentRes.body.items[0].so).toBe('TEST.75001.READY');

    const acceptedRes = await request(app)
      .get('/api/certificates')
      .query({ tab: 'accepted' });
    expect(acceptedRes.status).toBe(200);
    expect(acceptedRes.body.items).toHaveLength(1);
    expect(acceptedRes.body.items[0].so).toBe('TEST.75001.ACCEPTED');

    const attentionRes = await request(app)
      .get('/api/certificates')
      .query({ tab: 'attention' });
    expect(attentionRes.status).toBe(200);
    expect(attentionRes.body.items).toHaveLength(3);

    // Lọc theo batchId
    const batch1Res = await request(app)
      .get('/api/certificates')
      .query({ batchId: batch1.id });
    expect(batch1Res.status).toBe(200);
    expect(batch1Res.body.total).toBe(3);
    expect(batch1Res.body.counts.all).toBe(3);

    // Lọc theo từ khóa q
    const qRes = await request(app)
      .get('/api/certificates')
      .query({ q: 'REJECTED' });
    expect(qRes.status).toBe(200);
    expect(qRes.body.total).toBe(1);
    expect(qRes.body.items[0].so).toBe('TEST.75001.REJECTED');
  });

  it('5. GET /api/certificates/:id trả đủ 25 trường + xml + issues; GET /:id/xml làm sạch tên file và trả 422 khi invalid', async () => {
    const repos = createInMemoryRepositories();
    const app = createApp({
      repos,
      facilityId: '75001',
      today: '2026-11-23',
    });

    const recValid = makeSampleRecord({
      SO: 'TEST.75001.1',
    });
    const recTraversal = makeSampleRecord({
      SO: '../../TEST.75001.TRAVERSAL',
    });
    const recInvalid = makeSampleRecord({
      SO: 'TEST.75001.BAD',
      NGAYSINH: '31/02/1990',
    });

    const upValid = await repos.certificates.upsertBySo({
      so: recValid.SO,
      fields: recValid,
      dataSha256: computeCertificatePayload(recValid).dataSha256,
      status: 'ready',
    });
    const upTraversal = await repos.certificates.upsertBySo({
      so: recTraversal.SO,
      fields: recTraversal,
      dataSha256: computeCertificatePayload(recTraversal).dataSha256,
      status: 'ready',
    });
    const upInvalid = await repos.certificates.upsertBySo({
      so: recInvalid.SO,
      fields: recInvalid,
      dataSha256: computeCertificatePayload(recInvalid).dataSha256,
      status: 'invalid',
    });

    // Chi tiết giấy hợp lệ: đủ 25 trường (có cả 4 trường nhạy cảm) + chuỗi XML
    const detailValid = await request(app).get(
      `/api/certificates/${upValid.row.id}`,
    );
    expect(detailValid.status).toBe(200);
    expect(Object.keys(detailValid.body.fields)).toEqual([...FIELD_ORDER]);
    expect(detailValid.body.fields.LYDO).toBe('Secret Ly Do Suc Khoe');
    expect(detailValid.body.fields.TINHTRANGBENH).toBe('Secret Tinh Trang Benh');
    expect(detailValid.body.xml).toBe(buildGkskXml(recValid));

    // Chi tiết giấy invalid: xml = null, issues có lỗi chặn GKSK_NGAYSINH_INVALID
    const detailInvalid = await request(app).get(
      `/api/certificates/${upInvalid.row.id}`,
    );
    expect(detailInvalid.status).toBe(200);
    expect(detailInvalid.body.xml).toBeNull();
    expect(
      detailInvalid.body.issues.some(
        (i: { code: string }) => i.code === 'GKSK_NGAYSINH_INVALID',
      ),
    ).toBe(true);

    // Tải XML lẻ cho TEST.75001.1
    const xmlRes = await request(app).get(
      `/api/certificates/${upValid.row.id}/xml`,
    );
    expect(xmlRes.status).toBe(200);
    expect(xmlRes.headers['content-disposition']).toContain(
      'filename="TEST.75001.1.xml"',
    );
    expect(xmlRes.text).toBe(buildGkskXml(recValid));

    // Tải XML lẻ cho SO chứa ../ -> tên file không chứa ../
    const xmlTraversalRes = await request(app).get(
      `/api/certificates/${upTraversal.row.id}/xml`,
    );
    expect(xmlTraversalRes.status).toBe(200);
    expect(xmlTraversalRes.headers['content-disposition']).toContain(
      'filename="TEST.75001.TRAVERSAL.xml"',
    );
    expect(xmlTraversalRes.headers['content-disposition']).not.toContain('..');

    // Tải XML lẻ cho giấy invalid -> trả HTTP 422
    const xmlInvalidRes = await request(app).get(
      `/api/certificates/${upInvalid.row.id}/xml`,
    );
    expect(xmlInvalidRes.status).toBe(422);
    expect(xmlInvalidRes.body.error.code).toBe('CERTIFICATE_INVALID_XML');
  });

  it('6. POST /api/certificates/xml-zip và GET /api/certificates/export-excel hoạt động đúng qua HTTP', async () => {
    const repos = createInMemoryRepositories();
    const app = createApp({
      repos,
      facilityId: '75001',
      today: '2026-11-23',
      now: () => Date.parse('2026-11-23T03:00:00.000Z'), // 10:00:00 VN
    });

    const batch = await repos.batches.create({
      filename: 'dot_test_s10.xlsx',
      rowCount: 3,
    });

    const rec1 = makeSampleRecord({
      SO: 'TEST.75001.ZIP.1',
      HOTEN: 'TEST ZIP 1',
    });
    const rec2 = makeSampleRecord({
      SO: 'TEST.75001.ZIP.2',
      HOTEN: 'TEST ZIP 2',
    });
    const recBad = makeSampleRecord({
      SO: 'TEST.75001.ZIP.BAD',
      NGAYSINH: '31/02/1990',
    });

    const up1 = await repos.certificates.upsertBySo({
      so: rec1.SO,
      fields: rec1,
      dataSha256: computeCertificatePayload(rec1).dataSha256,
      status: 'ready',
      batchId: batch.id,
      excelRowNumber: 2,
    });
    const up2 = await repos.certificates.upsertBySo({
      so: rec2.SO,
      fields: rec2,
      dataSha256: computeCertificatePayload(rec2).dataSha256,
      status: 'accepted',
      batchId: batch.id,
      excelRowNumber: 3,
      serverCertificateId: 'CERT-ZIP-2',
    });
    const upBad = await repos.certificates.upsertBySo({
      so: recBad.SO,
      fields: recBad,
      dataSha256: computeCertificatePayload(recBad).dataSha256,
      status: 'invalid',
      batchId: batch.id,
      excelRowNumber: 4,
    });

    // Gọi POST /api/certificates/xml-zip với cả 3 ID (2 hợp lệ + 1 invalid)
    const zipRes = await request(app)
      .post('/api/certificates/xml-zip')
      .send({ ids: [up1.row.id, up2.row.id, upBad.row.id] })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(zipRes.status).toBe(200);
    expect(zipRes.headers['content-type']).toContain('application/zip');
    expect(zipRes.headers['content-disposition']).toContain(
      'filename="GKSK_XML_20261123_100000.zip"',
    );

    const extracted = extractZipArchiveBuffer(zipRes.body as Buffer);
    expect(extracted).toHaveLength(2);
    expect(extracted[0]?.fileName).toBe('TEST.75001.ZIP.1.xml');
    expect(extracted[0]?.content.toString('utf8')).toBe(buildGkskXml(rec1));
    expect(extracted[1]?.fileName).toBe('TEST.75001.ZIP.2.xml');
    expect(extracted[1]?.content.toString('utf8')).toBe(buildGkskXml(rec2));

    // Nếu chỉ chọn toàn giấy invalid -> trả HTTP 422
    const zipOnlyInvalidRes = await request(app)
      .post('/api/certificates/xml-zip')
      .send({ ids: [upBad.row.id] });
    expect(zipOnlyInvalidRes.status).toBe(422);
    expect(zipOnlyInvalidRes.body.error.code).toBe(
      'NO_VALID_CERTIFICATES_FOR_ZIP',
    );

    // Gọi GET /api/certificates/export-excel
    const excelRes = await request(app)
      .get('/api/certificates/export-excel')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(excelRes.status).toBe(200);
    expect(excelRes.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(excelRes.headers['content-disposition']).toContain(
      'filename="GKSK_doi_soat_20261123_100000.xlsx"',
    );

    const wb = new ExcelJS.Workbook();
    const bodyBuf = excelRes.body as Buffer;
    await wb.xlsx.load(bodyBuf.buffer.slice(bodyBuf.byteOffset, bodyBuf.byteOffset + bodyBuf.byteLength) as ArrayBuffer);
    const sheet = wb.getWorksheet('GKSK');
    expect(sheet).toBeDefined();
    expect(sheet!.columnCount).toBe(29);
    expect(sheet!.rowCount).toBe(4); // 1 header + 3 data rows
  });

  it('7. GET /api/certificates/:id/submissions, DELETE /api/certificates/:id và khẳng định KHÔNG có POST/PUT tạo/sửa tay', async () => {
    const repos = createInMemoryRepositories();
    const app = createApp({
      repos,
      facilityId: '75001',
      today: '2026-11-23',
    });

    const rec = makeSampleRecord({ SO: 'TEST.75001.SUBDEL' });
    const up = await repos.certificates.upsertBySo({
      so: rec.SO,
      fields: rec,
      dataSha256: computeCertificatePayload(rec).dataSha256,
      status: 'accepted',
    });

    await repos.submissions.create({
      certificateId: up.row.id,
      msgId: '7500126112300000000000000000000000000000099',
      sendDatetime: 1781084650736,
      dataSha256: up.row.dataSha256,
      attempts: 1,
      httpStatus: 200,
      resCode: 'PS_SYNC_SUCCESS',
      resultStatus: 'accepted',
      serverSubmissionId: 'SUB-99',
      warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
    });

    const subRes = await request(app).get(
      `/api/certificates/${up.row.id}/submissions`,
    );
    expect(subRes.status).toBe(200);
    expect(subRes.body.items).toHaveLength(1);
    expect(subRes.body.items[0].msgId).toBe(
      '7500126112300000000000000000000000000000099',
    );

    // Xóa cục bộ giấy khỏi DB
    const delRes = await request(app).delete(`/api/certificates/${up.row.id}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body).toEqual({ ok: true, id: up.row.id });

    const afterDelRes = await request(app).get(
      `/api/certificates/${up.row.id}`,
    );
    expect(afterDelRes.status).toBe(404);
    expect(afterDelRes.body.error.code).toBe('CERTIFICATE_NOT_FOUND');

    // Khẳng định không tồn tại endpoint tạo/sửa tay POST /api/certificates hay PUT /api/certificates/:id
    const postManualRes = await request(app)
      .post('/api/certificates')
      .send({ so: 'TEST.MANUAL' });
    expect(postManualRes.status).toBe(404);

    const putManualRes = await request(app)
      .put(`/api/certificates/${up.row.id}`)
      .send({ so: 'TEST.MANUAL' });
    expect(putManualRes.status).toBe(404);
  });
});
