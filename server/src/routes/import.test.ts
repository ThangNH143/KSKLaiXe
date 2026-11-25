import { Writable } from 'node:stream';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  FIELDS,
  normalizeRecord,
  TEMPLATE_FIELDS,
  type GkskRecord,
} from '@gksk/shared';
import {
  buildAllExcelFixtures,
  createWorkbookBuffer,
  makeDefaultFixtureRow,
  TEMPLATE_TAGS,
} from '../../../tests/fixtures/make-fixtures.js';
import { createApp } from '../app.js';
import { createInMemoryRepositories } from '../db/inMemoryRepo.js';
import { createLogger } from '../logger.js';
import {
  buildReconcileExcel,
  RECONCILE_EXTRA_COLUMNS,
} from '../services/exportService.js';
import {
  createImportService,
  TEMPLATE_FORMATTED_ROWS,
} from '../services/importService.js';
import { computeCertificatePayload } from '../services/sendService.js';

function bufferToArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
}

describe('S11 — Excel: mẫu GKSK_mau_nhap_lieu.xlsx và import ghi đè thông minh', () => {
  let fixtures: Map<string, Buffer>;

  beforeAll(async () => {
    fixtures = await buildAllExcelFixtures();
  });

  it('1. GET /api/import/template tạo file GKSK_mau_nhap_lieu.xlsx có 2 sheet (GKSK 23 cột Text @ 2000 dòng + dropdown, HuongDan 25 trường từ FIELDS)', async () => {
    const repos = createInMemoryRepositories();
    const app = createApp({
      repos,
      facilityId: '75001',
      facilityName: 'Benh vien Da khoa Dong Nai',
      today: '2026-11-23',
    });

    const res = await request(app)
      .get('/api/import/template')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toContain(
      'filename="GKSK_mau_nhap_lieu.xlsx"',
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bufferToArrayBuffer(res.body as Buffer));

    const gkskSheet = wb.getWorksheet('GKSK');
    const guideSheet = wb.getWorksheet('HuongDan');
    expect(gkskSheet).toBeDefined();
    expect(guideSheet).toBeDefined();

    // Kiểm tra dòng 1 của sheet GKSK có đúng 23 cột theo thứ tự BHXH (trừ IDBENHVIEN, BENHVIEN)
    const headerRow = gkskSheet!.getRow(1);
    const headers: string[] = [];
    for (let c = 1; c <= TEMPLATE_FIELDS.length; c++) {
      headers.push(String(headerRow.getCell(c).value ?? ''));
    }
    expect(headers).toEqual(TEMPLATE_TAGS);
    expect(headers).not.toContain('IDBENHVIEN');
    expect(headers).not.toContain('BENHVIEN');

    // Kiểm tra định dạng Text '@' ít nhất 2000 dòng đầu (dòng 2 -> 2001) và trống dữ liệu
    expect(gkskSheet!.getRow(2).getCell(1).numFmt).toBe('@');
    expect(gkskSheet!.getRow(2).getCell(10).numFmt).toBe('@');
    expect(gkskSheet!.getRow(TEMPLATE_FORMATTED_ROWS + 1).getCell(1).numFmt).toBe(
      '@',
    );
    expect(gkskSheet!.getRow(2).getCell(1).value).toBeNull();

    // Kiểm tra freeze dòng 1
    expect(gkskSheet!.views[0]).toMatchObject({
      state: 'frozen',
      ySplit: 1,
    });

    // Kiểm tra Data Validation dropdown cho GIOITINHVAL (cột D), DVINONGDOCON (cột P), MATUY (cột Q), KETLUAN (cột S), STATE (cột W)
    expect(gkskSheet!.getCell('D2').dataValidation?.type).toBe('list');
    expect(gkskSheet!.getCell('P2').dataValidation?.type).toBe('list');
    expect(gkskSheet!.getCell('Q2').dataValidation?.type).toBe('list');
    expect(gkskSheet!.getCell('S2').dataValidation?.type).toBe('list');
    expect(gkskSheet!.getCell('W2').dataValidation?.type).toBe('list');

    // Kiểm tra sheet HuongDan có đủ 25 dòng tương ứng 25 trường trong FIELDS
    expect(guideSheet!.rowCount).toBe(FIELDS.length + 1);
    for (let idx = 0; idx < FIELDS.length; idx++) {
      const row = guideSheet!.getRow(idx + 2);
      expect(row.getCell(1).value).toBe(FIELDS[idx]!.tag);
      expect(row.getCell(2).value).toBe(FIELDS[idx]!.label);
    }
  });

  it('2. ok_5rows.xlsx và mixed_valid_invalid.xlsx: lưu cả dòng ready lẫn dòng invalid có SO để khớp 100% quân số; dòng thiếu SO có canCommit=false', async () => {
    const repos = createInMemoryRepositories();
    const app = createApp({
      repos,
      facilityId: '75001',
      facilityName: 'Benh vien Da khoa Dong Nai',
      today: '2026-11-23',
    });

    // 2a. ok_5rows.xlsx -> 5 dòng ready, conflictMode='new', defaultSelected=true
    const okBuf = fixtures.get('ok_5rows.xlsx')!;
    const okPreviewRes = await request(app)
      .post('/api/import/excel')
      .attach('file', okBuf, 'ok_5rows.xlsx');

    expect(okPreviewRes.status).toBe(200);
    expect(okPreviewRes.body.summary).toMatchObject({
      totalRows: 5,
      readyCount: 5,
      invalidCount: 0,
      newCount: 5,
      defaultSelectedCount: 5,
    });
    for (const row of okPreviewRes.body.rows) {
      expect(row.status).toBe('ready');
      expect(row.conflictMode).toBe('new');
      expect(row.canCommit).toBe(true);
      expect(row.defaultSelected).toBe(true);
    }

    // 2b. mixed_valid_invalid.xlsx -> 3 dòng ready + 2 dòng invalid (có SO) đều defaultSelected=true; 1 dòng trống SO có canCommit=false
    const mixedBuf = fixtures.get('mixed_valid_invalid.xlsx')!;
    const mixedPreviewRes = await request(app)
      .post('/api/import/excel')
      .attach('file', mixedBuf, 'mixed_valid_invalid.xlsx');

    expect(mixedPreviewRes.status).toBe(200);
    expect(mixedPreviewRes.body.summary).toMatchObject({
      totalRows: 6,
      readyCount: 3,
      invalidCount: 3,
      newCount: 5,
      missingSoCount: 1,
      defaultSelectedCount: 5,
    });

    const row4InvalidWithSo = mixedPreviewRes.body.rows[3];
    expect(row4InvalidWithSo.rowNumber).toBe(5);
    expect(row4InvalidWithSo.so).toBe('TEST.75001.MIX.BAD1');
    expect(row4InvalidWithSo.status).toBe('invalid');
    expect(row4InvalidWithSo.conflictMode).toBe('new');
    expect(row4InvalidWithSo.canCommit).toBe(true);
    expect(row4InvalidWithSo.defaultSelected).toBe(true);

    const row6MissingSo = mixedPreviewRes.body.rows[5];
    expect(row6MissingSo.rowNumber).toBe(7);
    expect(row6MissingSo.so).toBe('');
    expect(row6MissingSo.conflictMode).toBe('missing_so');
    expect(row6MissingSo.canCommit).toBe(false);
    expect(row6MissingSo.defaultSelected).toBe(false);

    // Commit đợt mixed_valid_invalid.xlsx -> lưu đủ 5 dòng có SO (3 ready + 2 invalid) vào DB
    const commitRes = await request(app)
      .post('/api/import/commit')
      .send({
        filename: 'mixed_valid_invalid.xlsx',
        rows: mixedPreviewRes.body.rows.map(
          (r: {
            rowNumber: number;
            fields: GkskRecord;
            defaultSelected: boolean;
          }) => ({
            rowNumber: r.rowNumber,
            fields: r.fields,
            selected: r.defaultSelected,
          }),
        ),
      });

    expect(commitRes.status).toBe(200);
    expect(commitRes.body).toMatchObject({
      totalCommitted: 5,
      inserted: 5,
      updated: 0,
      readyCount: 3,
      invalidCount: 2,
      skippedCount: 1,
    });

    const listInDb = await repos.certificates.list();
    expect(listInDb.counts).toMatchObject({
      all: 5,
      ready: 3,
      invalid: 2,
      unsent: 3,
      attention: 2,
    });
  });

  it('3. reimport_overwrite.xlsx: kiểm chứng kịch bản ghi đè thông minh theo SO (overwrite_pending, accepted_unchanged, accepted_modified)', async () => {
    const repos = createInMemoryRepositories();
    const facilityId = '75001';
    const facilityName = 'Benh vien Da khoa Dong Nai';
    const app = createApp({
      repos,
      facilityId,
      facilityName,
      today: '2026-11-23',
    });

    const seedRow = async (
      index: number,
      overrides: Partial<Record<string, unknown>>,
      status: 'invalid' | 'rejected' | 'accepted',
    ) => {
      const raw = makeDefaultFixtureRow(index, overrides);
      const norm = normalizeRecord(raw);
      norm.IDBENHVIEN = facilityId;
      norm.BENHVIEN = facilityName;
      const { dataSha256 } = computeCertificatePayload(norm);
      await repos.certificates.upsertBySo({
        so: norm.SO,
        fields: norm,
        dataSha256,
        status,
      });
    };

    // Seed 4 bản ghi vào DB:
    // (1) TEST.75001.REIMP.01 đang invalid (NGAYSINH=31/02/1990)
    await seedRow(
      1,
      { SO: 'TEST.75001.REIMP.01', NGAYSINH: '31/02/1990' },
      'invalid',
    );
    // (2) TEST.75001.REIMP.02 đang rejected
    await seedRow(
      2,
      { SO: 'TEST.75001.REIMP.02', KETLUAN: 'A0-2' },
      'rejected',
    );
    // (3) TEST.75001.REIMP.03 đã accepted và dữ liệu giống hệt file reimport_overwrite.xlsx
    await seedRow(
      3,
      { SO: 'TEST.75001.REIMP.03', HOTEN: 'TEST NGUYEN VAN 03' },
      'accepted',
    );
    // (4) TEST.75001.REIMP.04 đã accepted nhưng trong DB là tên cũ, trong file Excel sửa thành 'TEST NGUYEN VAN 04 DA SUA'
    await seedRow(
      4,
      { SO: 'TEST.75001.REIMP.04', HOTEN: 'TEST NGUYEN VAN 04 BAN CU' },
      'accepted',
    );

    const reimportBuf = fixtures.get('reimport_overwrite.xlsx')!;
    const previewRes = await request(app)
      .post('/api/import/excel')
      .attach('file', reimportBuf, 'reimport_overwrite.xlsx');

    expect(previewRes.status).toBe(200);
    expect(previewRes.body.summary).toMatchObject({
      totalRows: 4,
      readyCount: 4,
      invalidCount: 0,
      newCount: 0,
      overwritePendingCount: 2,
      acceptedUnchangedCount: 1,
      acceptedModifiedCount: 1,
      defaultSelectedCount: 2,
    });

    const [r1, r2, r3, r4] = previewRes.body.rows;

    // Dòng 1: cũ invalid -> overwrite_pending, defaultSelected=true, có LOCAL_SO_EXISTS
    expect(r1.conflictMode).toBe('overwrite_pending');
    expect(r1.defaultSelected).toBe(true);
    expect(r1.existingStatus).toBe('invalid');
    expect(r1.issues.some((i: { code: string }) => i.code === 'LOCAL_SO_EXISTS')).toBe(
      true,
    );

    // Dòng 2: cũ rejected -> overwrite_pending, defaultSelected=true, có LOCAL_SO_EXISTS
    expect(r2.conflictMode).toBe('overwrite_pending');
    expect(r2.defaultSelected).toBe(true);
    expect(r2.existingStatus).toBe('rejected');

    // Dòng 3: cũ accepted & không đổi -> accepted_unchanged, defaultSelected=false, có LOCAL_SO_ACCEPTED_UNCHANGED
    expect(r3.conflictMode).toBe('accepted_unchanged');
    expect(r3.defaultSelected).toBe(false);
    expect(
      r3.issues.some(
        (i: { code: string }) => i.code === 'LOCAL_SO_ACCEPTED_UNCHANGED',
      ),
    ).toBe(true);

    // Dòng 4: cũ accepted nhưng dữ liệu đã sửa -> accepted_modified, defaultSelected=false, có LOCAL_SO_ACCEPTED_MODIFIED
    expect(r4.conflictMode).toBe('accepted_modified');
    expect(r4.defaultSelected).toBe(false);
    expect(
      r4.issues.some(
        (i: { code: string }) => i.code === 'LOCAL_SO_ACCEPTED_MODIFIED',
      ),
    ).toBe(true);

    // Commit lần 1 theo mặc định (chỉ r1 & r2 được chọn) -> cập nhật r1, r2 sang ready; r3, r4 giữ nguyên accepted
    const commitDefaultRes = await request(app)
      .post('/api/import/commit')
      .send({
        filename: 'reimport_overwrite.xlsx',
        rows: previewRes.body.rows.map(
          (r: {
            rowNumber: number;
            fields: GkskRecord;
            defaultSelected: boolean;
          }) => ({
            rowNumber: r.rowNumber,
            fields: r.fields,
            selected: r.defaultSelected,
          }),
        ),
      });

    expect(commitDefaultRes.status).toBe(200);
    expect(commitDefaultRes.body).toMatchObject({
      totalCommitted: 2,
      inserted: 0,
      updated: 2,
      readyCount: 2,
      skippedCount: 2,
    });

    expect((await repos.certificates.findBySo('TEST.75001.REIMP.01'))?.status).toBe(
      'ready',
    );
    expect((await repos.certificates.findBySo('TEST.75001.REIMP.02'))?.status).toBe(
      'ready',
    );
    expect((await repos.certificates.findBySo('TEST.75001.REIMP.04'))?.status).toBe(
      'accepted',
    );

    // Nếu người dùng chủ động tick chọn dòng 4 (accepted_modified) và commit -> cập nhật dữ liệu mới và chuyển về ready
    const commitModifiedRes = await request(app)
      .post('/api/import/commit')
      .send({
        filename: 'reimport_overwrite_manual.xlsx',
        rows: [
          {
            rowNumber: r4.rowNumber,
            fields: r4.fields,
            selected: true,
          },
        ],
      });
    expect(commitModifiedRes.status).toBe(200);
    const cert4After = await repos.certificates.findBySo('TEST.75001.REIMP.04');
    expect(cert4After?.status).toBe('ready');
    expect(cert4After?.fields.HOTEN).toBe('TEST NGUYEN VAN 04 DA SUA');
  });

  it('4. Round-trip với file Excel đối soát 29 cột của S10: xuất đối soát -> sửa dòng lỗi ngay trên buffer 29 cột -> previewImport tự bỏ qua 6 cột đối soát và chuyển dòng đã sửa thành ready', async () => {
    const repos = createInMemoryRepositories();
    const importService = createImportService({
      repos,
      facilityId: '75001',
      facilityName: 'Benh vien Da khoa Dong Nai',
      today: '2026-11-23',
    });

    // Bước 1: Tạo 2 bản ghi trong DB: 1 giấy đã accepted, 1 giấy bị invalid (sai ngày sinh 31/02/1990)
    const recAccepted = normalizeRecord(
      makeDefaultFixtureRow(1, {
        SO: 'TEST.75001.RT.ACC',
        HOTEN: 'TEST ROUNDTRIP ACCEPTED',
      }),
    );
    recAccepted.IDBENHVIEN = '75001';
    recAccepted.BENHVIEN = 'Benh vien Da khoa Dong Nai';

    const recInvalid = normalizeRecord(
      makeDefaultFixtureRow(2, {
        SO: 'TEST.75001.RT.INV',
        HOTEN: 'TEST ROUNDTRIP INVALID',
        NGAYSINH: '31/02/1990',
      }),
    );
    recInvalid.IDBENHVIEN = '75001';
    recInvalid.BENHVIEN = 'Benh vien Da khoa Dong Nai';

    await repos.certificates.upsertBySo({
      so: recAccepted.SO,
      fields: recAccepted,
      dataSha256: computeCertificatePayload(recAccepted).dataSha256,
      status: 'accepted',
      serverCertificateId: 'CERT-RT-01',
    });
    await repos.certificates.upsertBySo({
      so: recInvalid.SO,
      fields: recInvalid,
      dataSha256: computeCertificatePayload(recInvalid).dataSha256,
      status: 'invalid',
    });

    // Bước 2: Xuất file Excel đối soát 29 cột bằng buildReconcileExcel (S10)
    const reconcileBuf = await buildReconcileExcel([
      {
        so: recAccepted.SO,
        fields: recAccepted,
        status: 'accepted',
        batchFilename: 'dot_goc.xlsx',
        excelRowNumber: 2,
        serverCertificateId: 'CERT-RT-01',
        lastSentAt: '2026-11-23T01:00:00.000Z',
        lastMsgId: '7500126112300000000000000000000000000000001',
      },
      {
        so: recInvalid.SO,
        fields: recInvalid,
        status: 'invalid',
        batchFilename: 'dot_goc.xlsx',
        excelRowNumber: 3,
      },
    ]);

    // Bước 3: Mở buffer file Excel đối soát 29 cột bằng ExcelJS, sửa NGAYSINH của dòng 3 từ '31/02/1990' -> '21/05/1990' (giữ nguyên 6 cột đối soát ở cuối!)
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bufferToArrayBuffer(reconcileBuf));
    const sheet = wb.getWorksheet('GKSK')!;
    expect(sheet.columnCount).toBe(29);

    const ngaysinhColIdx = TEMPLATE_TAGS.indexOf('NGAYSINH') + 1;
    sheet.getRow(3).getCell(ngaysinhColIdx).value = '21/05/1990';
    const editedReconcileBuf = Buffer.from(await wb.xlsx.writeBuffer());

    // Bước 4: Đưa file Excel đối soát 29 cột đã sửa vào previewImport
    const preview = await importService.previewImport(editedReconcileBuf);

    // 6 cột đối soát cuối được báo trong ignoredColumns, không gây lỗi
    expect(preview.ignoredColumns).toEqual([...RECONCILE_EXTRA_COLUMNS]);
    expect(preview.summary).toMatchObject({
      totalRows: 2,
      readyCount: 2,
      invalidCount: 0,
      acceptedUnchangedCount: 1,
      overwritePendingCount: 1,
      defaultSelectedCount: 1,
    });

    // Dòng 1 (TEST.75001.RT.ACC): accepted_unchanged, defaultSelected=false
    expect(preview.rows[0]?.so).toBe('TEST.75001.RT.ACC');
    expect(preview.rows[0]?.conflictMode).toBe('accepted_unchanged');
    expect(preview.rows[0]?.defaultSelected).toBe(false);

    // Dòng 2 (TEST.75001.RT.INV): sau khi sửa trên file đối soát đã trở thành ready, overwrite_pending, defaultSelected=true!
    expect(preview.rows[1]?.so).toBe('TEST.75001.RT.INV');
    expect(preview.rows[1]?.status).toBe('ready');
    expect(preview.rows[1]?.conflictMode).toBe('overwrite_pending');
    expect(preview.rows[1]?.defaultSelected).toBe(true);
  });

  it('5. Kiểm chứng toàn bộ các fixtures còn lại trong TEST-PLAN.md §2.1 (leading_zero, dates_mixed, dates_bad, extra_cols_reordered, blank_rows, formulas, dup_so, facility_mismatch, alias_gioitinh, over_length, enum_variants, empty, big_1000)', async () => {
    const repos = createInMemoryRepositories();
    const logLines: string[] = [];
    const logStream = new Writable({
      write(chunk, _enc, cb) {
        logLines.push(chunk.toString('utf8'));
        cb();
      },
    });
    const logger = createLogger({ level: 'info', destination: logStream });

    const importService = createImportService({
      repos,
      facilityId: '75001',
      facilityName: 'Benh vien Da khoa Dong Nai',
      today: '2026-11-23',
      logger,
    });

    // 5.1 leading_zero.xlsx: dòng 2 ô số mất số 0 -> 11 chữ số -> GKSK_ID_INVALID; dòng 3 ô chuỗi giữ '079000012345'
    const leadingZero = await importService.previewImport(
      fixtures.get('leading_zero.xlsx')!,
    );
    expect(leadingZero.rows[0]?.fields.SOCMND_PASSPORT).toBe('79000012345');
    expect(
      leadingZero.rows[0]?.issues.some((i) => i.code === 'GKSK_ID_INVALID'),
    ).toBe(true);
    expect(leadingZero.rows[1]?.fields.SOCMND_PASSPORT).toBe('079000012345');
    expect(
      leadingZero.rows[1]?.issues.some((i) => i.code === 'GKSK_ID_INVALID'),
    ).toBe(false);

    // 5.2 dates_mixed.xlsx: cả 4 dòng (Date, serial 33014, '21/5/1990', '1990-05-21') đều chuẩn hóa về '21/05/1990'
    const datesMixed = await importService.previewImport(
      fixtures.get('dates_mixed.xlsx')!,
    );
    expect(datesMixed.rows).toHaveLength(4);
    for (const r of datesMixed.rows) {
      expect(r.fields.NGAYSINH).toBe('21/05/1990');
      expect(r.status).toBe('ready');
    }

    // 5.3 dates_bad.xlsx: 4 dòng đều invalid với GKSK_NGAYSINH_INVALID nhưng vẫn có defaultSelected=true để lưu đối soát
    const datesBad = await importService.previewImport(
      fixtures.get('dates_bad.xlsx')!,
    );
    expect(datesBad.rows).toHaveLength(4);
    for (const r of datesBad.rows) {
      expect(r.status).toBe('invalid');
      expect(r.defaultSelected).toBe(true);
      expect(r.issues.some((i) => i.code === 'GKSK_NGAYSINH_INVALID')).toBe(
        true,
      );
    }

    // 5.4 extra_cols_reordered.xlsx: đảo thứ tự cột + thêm cột GHICHU -> đọc đủ, báo GHICHU trong ignoredColumns
    const extraCols = await importService.previewImport(
      fixtures.get('extra_cols_reordered.xlsx')!,
    );
    expect(extraCols.rows).toHaveLength(2);
    expect(extraCols.ignoredColumns).toEqual(['GHICHU']);
    expect(extraCols.rows[0]?.status).toBe('ready');

    // 5.5 blank_rows.xlsx: bỏ qua 2 dòng trống ở giữa, rowNumber của dòng thứ 2 vẫn là dòng Excel thật (dòng 5)
    const blankRows = await importService.previewImport(
      fixtures.get('blank_rows.xlsx')!,
    );
    expect(blankRows.rows).toHaveLength(2);
    expect(blankRows.rows[0]?.rowNumber).toBe(2);
    expect(blankRows.rows[1]?.rowNumber).toBe(5);

    // 5.6 formulas.xlsx: lấy kết quả công thức HOTEN = "TEST A" và ghép RichText NOICAP = "Cuc CS QLHC"
    const formulas = await importService.previewImport(
      fixtures.get('formulas.xlsx')!,
    );
    expect(formulas.rows[0]?.fields.HOTEN).toBe('TEST A');
    expect(formulas.rows[0]?.fields.NOICAP).toBe('Cuc CS QLHC');

    // 5.7 dup_so.xlsx: 2 dòng cùng SO -> có LOCAL_SO_DUPLICATE_IN_BATCH, chỉ dòng cuối cùng được phép chọn lưu
    const dupSo = await importService.previewImport(
      fixtures.get('dup_so.xlsx')!,
    );
    expect(dupSo.rows).toHaveLength(2);
    expect(dupSo.rows[0]?.canCommit).toBe(false);
    expect(dupSo.rows[0]?.defaultSelected).toBe(false);
    expect(dupSo.rows[1]?.canCommit).toBe(true);
    expect(dupSo.rows[1]?.defaultSelected).toBe(true);
    expect(
      dupSo.rows[1]?.issues.some(
        (i) => i.code === 'LOCAL_SO_DUPLICATE_IN_BATCH',
      ),
    ).toBe(true);

    // 5.8 facility_mismatch.xlsx: cột IDBENHVIEN=75999 khác cấu hình 75001 -> lỗi chặn LOCAL_FACILITY_MISMATCH
    const facilityMismatch = await importService.previewImport(
      fixtures.get('facility_mismatch.xlsx')!,
    );
    expect(facilityMismatch.rows[0]?.status).toBe('invalid');
    expect(
      facilityMismatch.rows[0]?.issues.some(
        (i) => i.code === 'LOCAL_FACILITY_MISMATCH',
      ),
    ).toBe(true);

    // 5.9 alias_gioitinh.xlsx: cột GIOITINH nhận thành GIOITINHVAL; nếu có cả hai cột thì GIOITINHVAL thắng và báo GIOITINH bị bỏ qua
    const aliasOnly = await importService.previewImport(
      fixtures.get('alias_gioitinh.xlsx')!,
    );
    expect(aliasOnly.rows[0]?.fields.GIOITINHVAL).toBe('1');
    expect(aliasOnly.ignoredColumns).toHaveLength(0);

    const bothGioiTinhBuf = await createWorkbookBuffer({
      headers: [...TEMPLATE_TAGS, 'GIOITINH'],
      rows: [
        makeDefaultFixtureRow(1, {
          SO: 'TEST.75001.BOTH.GT',
          GIOITINHVAL: '0',
          GIOITINH: '1',
        }),
      ],
    });
    const bothGioiTinh = await importService.previewImport(bothGioiTinhBuf);
    expect(bothGioiTinh.rows[0]?.fields.GIOITINHVAL).toBe('0');
    expect(bothGioiTinh.ignoredColumns).toContain('GIOITINH');

    // 5.10 over_length.xlsx: NOICAP 31 ký tự, SOCMND_PASSPORT 13 ký tự -> cảnh báo LOCAL_FIELD_OVER_SPEC (không chặn, status='ready')
    const overLen = await importService.previewImport(
      fixtures.get('over_length.xlsx')!,
    );
    expect(overLen.rows[0]?.status).toBe('ready');
    const overSpecFields = overLen.rows[0]?.issues
      .filter((i) => i.code === 'LOCAL_FIELD_OVER_SPEC')
      .map((i) => i.field);
    expect(overSpecFields).toEqual(
      expect.arrayContaining(['NOICAP', 'SOCMND_PASSPORT']),
    );

    // 5.11 enum_variants.xlsx: Nam/nữ/M -> 0/1/0; a0-1/A0–2/A0 - 3 -> A0-1/A0-2/A0-3
    const enumVar = await importService.previewImport(
      fixtures.get('enum_variants.xlsx')!,
    );
    expect(enumVar.rows.map((r) => r.fields.GIOITINHVAL)).toEqual([
      '0',
      '1',
      '0',
    ]);
    expect(enumVar.rows.map((r) => r.fields.KETLUAN)).toEqual([
      'A0-1',
      'A0-2',
      'A0-3',
    ]);

    // 5.12 empty.xlsx: chỉ có dòng tiêu đề -> 0 dòng
    const emptyRes = await importService.previewImport(
      fixtures.get('empty.xlsx')!,
    );
    expect(emptyRes.summary.totalRows).toBe(0);
    expect(emptyRes.rows).toHaveLength(0);

    // 5.13 big_1000.xlsx: 1000 dòng hợp lệ hoàn tất < 10 s
    const t0 = Date.now();
    const big1000 = await importService.previewImport(
      fixtures.get('big_1000.xlsx')!,
    );
    const elapsedMs = Date.now() - t0;
    expect(big1000.summary.totalRows).toBe(1000);
    expect(big1000.summary.readyCount).toBe(1000);
    expect(elapsedMs).toBeLessThan(10_000);

    // Kiểm tra log không chứa bất kỳ PII nào (HOTEN, SOCMND_PASSPORT...)
    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain('TEST NGUYEN');
    expect(allLogs).not.toContain('079000012345');
  });

  it('6. Từ chối đúng mã lỗi cho missing_required_col.xlsx (400), too_many_rows.xlsx (400), not_xlsx.xlsx (415) và file > 5 MB (413)', async () => {
    const repos = createInMemoryRepositories();
    const app = createApp({
      repos,
      facilityId: '75001',
      facilityName: 'Benh vien Da khoa Dong Nai',
      today: '2026-11-23',
    });

    // Thiếu cột KETLUAN -> 400 EXCEL_MISSING_REQUIRED_COLUMNS, nêu rõ KETLUAN
    const missingColRes = await request(app)
      .post('/api/import/excel')
      .attach(
        'file',
        fixtures.get('missing_required_col.xlsx')!,
        'missing_required_col.xlsx',
      );
    expect(missingColRes.status).toBe(400);
    expect(missingColRes.body.error.code).toBe(
      'EXCEL_MISSING_REQUIRED_COLUMNS',
    );
    expect(missingColRes.body.error.message).toContain('KETLUAN');

    // 1001 dòng -> 400 EXCEL_TOO_MANY_ROWS
    const tooManyRes = await request(app)
      .post('/api/import/excel')
      .attach(
        'file',
        fixtures.get('too_many_rows.xlsx')!,
        'too_many_rows.xlsx',
      );
    expect(tooManyRes.status).toBe(400);
    expect(tooManyRes.body.error.code).toBe('EXCEL_TOO_MANY_ROWS');

    // File giả đổi đuôi .xlsx (sai magic bytes PK) -> 415 INVALID_EXCEL_FORMAT
    const notXlsxRes = await request(app)
      .post('/api/import/excel')
      .attach('file', fixtures.get('not_xlsx.xlsx')!, 'not_xlsx.xlsx');
    expect(notXlsxRes.status).toBe(415);
    expect(notXlsxRes.body.error.code).toBe('INVALID_EXCEL_FORMAT');

    // File đuôi .csv -> 415 INVALID_FILE_EXTENSION
    const csvExtRes = await request(app)
      .post('/api/import/excel')
      .attach('file', fixtures.get('not_xlsx.xlsx')!, 'data.csv');
    expect(csvExtRes.status).toBe(415);
    expect(csvExtRes.body.error.code).toBe('INVALID_FILE_EXTENSION');

    // File > 5 MB -> 413 EXCEL_FILE_TOO_LARGE
    const over5MbBuf = Buffer.alloc(5 * 1024 * 1024 + 128, 0x50);
    const over5MbRes = await request(app)
      .post('/api/import/excel')
      .attach('file', over5MbBuf, 'huge.xlsx');
    expect(over5MbRes.status).toBe(413);
    expect(over5MbRes.body.error.code).toBe('EXCEL_FILE_TOO_LARGE');
  });
});
