import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type sql from 'mssql';
import { describe, expect, it } from 'vitest';
import { createEmptyRecord, type GkskRecord } from '@gksk/shared';
import {
  buildMssqlPoolConfig,
  createRepositories,
  resolveDefaultMigrationsDir,
  runMigrations,
} from './connection.js';
import { escapeSqlLikePattern, MssqlRepositories } from './mssqlRepo.js';
import { GKSK_TABLE_NAMES } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function makeRecord(overrides: Partial<GkskRecord> = {}): GkskRecord {
  const base = createEmptyRecord();
  return {
    ...base,
    SO: 'TEST.75001.0001',
    NGAYKHAM: '05/11/2026',
    HOTEN: 'TEST NGUYEN VAN A',
    GIOITINHVAL: '0',
    NGAYSINH: '21/05/1990',
    DIACHITHUONGTRU: 'Bien Hoa, Dong Nai',
    MATINH_THUONGTRU: '75',
    MAHUYEN_THUONGTRU: '75731',
    MAXA_THUONGTRU: '7573126041',
    SOCMND_PASSPORT: 'TESTGKSK01',
    NGAYTHANGNAMCAP: '01/02/2021',
    NOICAP: 'Cuc CS QLHC',
    HANGBANGLAI: 'B2',
    IDBENHVIEN: '75001',
    BENHVIEN: 'Benh vien Thu',
    NGAYKETLUAN: '06/11/2026',
    NONGDOCON: '0',
    DVINONGDOCON: '0',
    MATUY: '0',
    BACSYKETLUAN: 'TEST BAC SI',
    KETLUAN: 'A0-1',
    STATE: 'ADD',
    ...overrides,
  };
}

function sha(tag: string): string {
  return tag.padEnd(64, '0').slice(0, 64).toUpperCase();
}

describe('server/src/db — S8 Repository Contract Tests & MSSQL gksk_* Safety Verification', () => {
  it('1. createRepositories() mặc định trả về InMemoryRepositories để bảo vệ tuyệt đối MSSQL đang vận hành', () => {
    const repo = createRepositories();
    expect(repo.kind).toBe('in-memory');
  });

  it('2. Quản lý đợt import (batches) và upsert giấy theo SO (lưu cả bản ghi ready và invalid, ghi đè giữ nguyên id & lịch sử)', async () => {
    const repo = createRepositories();

    const batch1 = await repo.batches.create({
      filename: 'dot_1_ksk.xlsx',
      rowCount: 3,
      createdAt: '2026-11-20T08:00:00.000Z',
    });
    const batch2 = await repo.batches.create({
      filename: 'dot_2_sua_loi.xlsx',
      rowCount: 2,
      createdAt: '2026-11-21T09:00:00.000Z',
    });

    expect(batch1.id).toBe(1);
    expect(batch2.id).toBe(2);
    expect(await repo.batches.findById(1)).toEqual(batch1);
    expect(await repo.batches.findById(999)).toBeNull();

    const batchesList = await repo.batches.list();
    expect(batchesList.map((b) => b.id)).toEqual([2, 1]);

    // Lưu bản ghi hợp lệ (ready)
    const up1 = await repo.certificates.upsertBySo({
      so: 'TEST.75001.0001',
      fields: makeRecord({ SO: 'TEST.75001.0001', HOTEN: 'TEST NGUYEN VAN A' }),
      dataSha256: sha('SHA1'),
      status: 'ready',
      batchId: batch1.id,
      excelRowNumber: 2,
      now: '2026-11-20T08:01:00.000Z',
    });
    expect(up1.created).toBe(true);
    expect(up1.row.id).toBe(1);
    expect(up1.row.status).toBe('ready');
    expect(up1.row.batchFilename).toBe('dot_1_ksk.xlsx');

    // Lưu bản ghi có lỗi dữ liệu chặn (invalid) nhưng có SO hợp lệ để khớp 100% quân số đối soát
    const up2 = await repo.certificates.upsertBySo({
      so: 'TEST.75001.0002',
      fields: makeRecord({
        SO: 'TEST.75001.0002',
        HOTEN: 'TEST TRAN THI B',
        NGAYSINH: '31/02/1990',
      }),
      dataSha256: sha('SHA2_BAD'),
      status: 'invalid',
      batchId: batch1.id,
      excelRowNumber: 3,
      now: '2026-11-20T08:01:00.000Z',
    });
    expect(up2.created).toBe(true);
    expect(up2.row.id).toBe(2);
    expect(up2.row.status).toBe('invalid');

    // Ghi đè (upsert) bản ghi TEST.75001.0002 ở đợt import 2 sau khi đã sửa ngày sinh đúng
    const up2Overwrite = await repo.certificates.upsertBySo({
      so: 'TEST.75001.0002',
      fields: makeRecord({
        SO: 'TEST.75001.0002',
        HOTEN: 'TEST TRAN THI B (DA SUA)',
        NGAYSINH: '28/02/1990',
      }),
      dataSha256: sha('SHA2_FIXED'),
      status: 'ready',
      batchId: batch2.id,
      excelRowNumber: 2,
      now: '2026-11-21T09:05:00.000Z',
    });

    expect(up2Overwrite.created).toBe(false);
    expect(up2Overwrite.row.id).toBe(2); // Giữ nguyên ID cũ
    expect(up2Overwrite.row.status).toBe('ready');
    expect(up2Overwrite.row.fields.HOTEN).toBe('TEST TRAN THI B (DA SUA)');
    expect(up2Overwrite.row.dataSha256).toBe(sha('SHA2_FIXED'));
    expect(up2Overwrite.row.batchId).toBe(batch2.id);
    expect(up2Overwrite.row.batchFilename).toBe('dot_2_sua_loi.xlsx');

    // Kiểm tra upsertManyBySo
    const batchUpsert = await repo.certificates.upsertManyBySo([
      {
        so: 'TEST.75001.0001',
        fields: makeRecord({ SO: 'TEST.75001.0001', HOTEN: 'TEST NGUYEN VAN A V2' }),
        dataSha256: sha('SHA1_V2'),
        status: 'ready',
        batchId: batch2.id,
        excelRowNumber: 3,
      },
      {
        so: 'TEST.75001.0003',
        fields: makeRecord({ SO: 'TEST.75001.0003', HOTEN: 'TEST LE VAN C' }),
        dataSha256: sha('SHA3'),
        status: 'ready',
        batchId: batch2.id,
        excelRowNumber: 4,
      },
    ]);
    expect(batchUpsert.inserted).toBe(1);
    expect(batchUpsert.updated).toBe(1);
  });

  it('3. Tra cứu hàng loạt findBySoList và findByIds phục vụ xem trước Import Excel và xuất ZIP', async () => {
    const repo = createRepositories();

    await repo.certificates.upsertManyBySo([
      {
        so: 'TEST.75001.A1',
        fields: makeRecord({ SO: 'TEST.75001.A1' }),
        dataSha256: sha('A1'),
        status: 'accepted',
        serverCertificateId: 'srv-cert-a1',
      },
      {
        so: 'TEST.75001.A2',
        fields: makeRecord({ SO: 'TEST.75001.A2' }),
        dataSha256: sha('A2'),
        status: 'rejected',
      },
      {
        so: 'TEST.75001.A3',
        fields: makeRecord({ SO: 'TEST.75001.A3' }),
        dataSha256: sha('A3'),
        status: 'invalid',
      },
    ]);

    const foundBySoList = await repo.certificates.findBySoList([
      'TEST.75001.A1',
      'TEST.75001.KHONG_TON_TAI',
      '  TEST.75001.A3  ',
      'TEST.75001.A1', // trùng lặp trong input
    ]);

    expect(foundBySoList.map((r) => r.so)).toEqual(['TEST.75001.A1', 'TEST.75001.A3']);
    expect(foundBySoList[0]?.serverCertificateId).toBe('srv-cert-a1');

    const foundByIds = await repo.certificates.findByIds([1, 3, 999]);
    expect(foundByIds.map((r) => r.so)).toEqual(['TEST.75001.A1', 'TEST.75001.A3']);
  });

  it('4. Đếm thống kê counts và lọc theo 4 tab đối soát (all | unsent | accepted | attention), batchId, khoảng ngày và phân trang', async () => {
    const repo = createRepositories();
    const b1 = await repo.batches.create({ filename: 'b1.xlsx', rowCount: 4 });
    const b2 = await repo.batches.create({ filename: 'b2.xlsx', rowCount: 3 });

    const fixtures = [
      { so: 'TEST.75001.1', status: 'ready' as const, batchId: b1.id, date: '2026-11-10T10:00:00.000Z' },
      { so: 'TEST.75001.2', status: 'ready' as const, batchId: b1.id, date: '2026-11-11T10:00:00.000Z' },
      { so: 'TEST.75001.3', status: 'accepted' as const, batchId: b1.id, date: '2026-11-12T10:00:00.000Z' },
      { so: 'TEST.75001.4', status: 'invalid' as const, batchId: b1.id, date: '2026-11-13T10:00:00.000Z' },
      { so: 'TEST.75001.5', status: 'rejected' as const, batchId: b2.id, date: '2026-11-14T10:00:00.000Z' },
      { so: 'TEST.75001.6', status: 'error' as const, batchId: b2.id, date: '2026-11-15T10:00:00.000Z' },
      { so: 'TEST.75001.7', status: 'sending' as const, batchId: b2.id, date: '2026-11-16T10:00:00.000Z' },
    ];

    for (const f of fixtures) {
      await repo.certificates.upsertBySo({
        so: f.so,
        fields: makeRecord({ SO: f.so }),
        dataSha256: sha(f.so),
        status: f.status,
        batchId: f.batchId,
        now: f.date,
      });
    }

    // Kiểm tra counts tổng
    const allCounts = await repo.certificates.countByStatus();
    expect(allCounts).toEqual({
      all: 7,
      unsent: 2,
      accepted: 1,
      attention: 3, // invalid (1) + rejected (1) + error (1)
      ready: 2,
      invalid: 1,
      rejected: 1,
      error: 1,
      sending: 1,
    });

    // Tab unsent -> chỉ gồm ready (2 bản ghi)
    const unsentList = await repo.certificates.list({ tab: 'unsent' });
    expect(unsentList.total).toBe(2);
    expect(unsentList.items.map((r) => r.so)).toEqual(['TEST.75001.2', 'TEST.75001.1']);

    // Tab accepted -> chỉ gồm accepted (1 bản ghi)
    const acceptedList = await repo.certificates.list({ tab: 'accepted' });
    expect(acceptedList.total).toBe(1);
    expect(acceptedList.items[0]?.so).toBe('TEST.75001.3');

    // Tab attention -> gồm invalid, rejected, error (3 bản ghi)
    const attentionList = await repo.certificates.list({ tab: 'attention' });
    expect(attentionList.total).toBe(3);
    expect(attentionList.items.map((r) => r.so)).toEqual([
      'TEST.75001.6',
      'TEST.75001.5',
      'TEST.75001.4',
    ]);

    // Bộ lọc con trong tab attention: chỉ lấy status='rejected'
    const rejectedOnly = await repo.certificates.list({
      tab: 'attention',
      status: 'rejected',
    });
    expect(rejectedOnly.total).toBe(1);
    expect(rejectedOnly.items[0]?.so).toBe('TEST.75001.5');
    // counts vẫn phản ánh đầy đủ 7 bản ghi để hiển thị trên huy hiệu 4 tab
    expect(rejectedOnly.counts.all).toBe(7);

    // Lọc theo batchId = b2.id
    const b2List = await repo.certificates.list({ batchId: b2.id });
    expect(b2List.total).toBe(3);
    expect(b2List.counts).toMatchObject({
      all: 3,
      attention: 2,
      rejected: 1,
      error: 1,
      sending: 1,
    });

    // Lọc theo khoảng ngày fromDate / toDate
    const dateRangeList = await repo.certificates.list({
      fromDate: '2026-11-12',
      toDate: '2026-11-14',
    });
    expect(dateRangeList.total).toBe(3);
    expect(dateRangeList.items.map((r) => r.so)).toEqual([
      'TEST.75001.5',
      'TEST.75001.4',
      'TEST.75001.3',
    ]);

    // Phân trang page=2, pageSize=2
    const paged = await repo.certificates.list({ page: 2, pageSize: 2 });
    expect(paged.total).toBe(7);
    expect(paged.items.map((r) => r.so)).toEqual(['TEST.75001.5', 'TEST.75001.4']);
  });

  it('5. Tìm kiếm q theo so/hoten/socmnd an toàn tuyệt đối với các ký tự đặc biệt %, _, \', [', async () => {
    const repo = createRepositories();

    await repo.certificates.upsertManyBySo([
      {
        so: 'TEST.75001.100%',
        fields: makeRecord({
          SO: 'TEST.75001.100%',
          HOTEN: 'TEST NGUYEN VAN_A',
          SOCMND_PASSPORT: 'TESTGKSK01',
        }),
        dataSha256: sha('S1'),
        status: 'ready',
      },
      {
        so: 'TEST.75001.1001',
        fields: makeRecord({
          SO: 'TEST.75001.1001',
          HOTEN: 'TEST NGUYEN VANXA',
          SOCMND_PASSPORT: 'TESTGKSK02',
        }),
        dataSha256: sha('S2'),
        status: 'ready',
      },
      {
        so: 'TEST.75001.QUOTE',
        fields: makeRecord({
          SO: 'TEST.75001.QUOTE',
          HOTEN: "TEST O'CONNOR",
          SOCMND_PASSPORT: 'TEST_ID_99',
        }),
        dataSha256: sha('S3'),
        status: 'ready',
      },
    ]);

    // Tìm theo ký tự '%' -> chỉ khớp đúng bản ghi có dấu '%', không coi '%' là wildcard
    const searchPercent = await repo.certificates.list({ q: '100%' });
    expect(searchPercent.total).toBe(1);
    expect(searchPercent.items[0]?.so).toBe('TEST.75001.100%');

    // Tìm theo ký tự '_' -> chỉ khớp đúng 'VAN_A', không khớp 'VANXA'
    const searchUnderscore = await repo.certificates.list({ q: 'VAN_A' });
    expect(searchUnderscore.total).toBe(1);
    expect(searchUnderscore.items[0]?.fields.HOTEN).toBe('TEST NGUYEN VAN_A');

    // Tìm theo dấu nháy đơn "'" -> khớp đúng "O'CONNOR"
    const searchSingleQuote = await repo.certificates.list({ q: "O'CONNOR" });
    expect(searchSingleQuote.total).toBe(1);
    expect(searchSingleQuote.items[0]?.so).toBe('TEST.75001.QUOTE');

    // Thử chuỗi SQL injection kinh điển -> 0 kết quả, an toàn tuyệt đối
    const searchSqlInjection = await repo.certificates.list({
      q: "' OR '1'='1' --",
    });
    expect(searchSqlInjection.total).toBe(0);

    // Kiểm tra hàm escapeSqlLikePattern cho T-SQL LIKE ... ESCAPE N'\'
    expect(escapeSqlLikePattern("100%_test[a]\\b'c")).toBe("100\\%\\_test\\[a]\\\\b'c");
  });

  it('6. Xóa giấy (deleteById) tự động xóa dây chuyền (CASCADE) toàn bộ submissions của giấy đó', async () => {
    const repo = createRepositories();

    const c1 = await repo.certificates.upsertBySo({
      so: 'TEST.75001.DEL1',
      fields: makeRecord({ SO: 'TEST.75001.DEL1' }),
      dataSha256: sha('DEL1'),
      status: 'error',
    });
    const c2 = await repo.certificates.upsertBySo({
      so: 'TEST.75001.DEL2',
      fields: makeRecord({ SO: 'TEST.75001.DEL2' }),
      dataSha256: sha('DEL2'),
      status: 'accepted',
    });

    const sub1 = await repo.submissions.create({
      certificateId: c1.row.id,
      msgId: '7500126112300000000000004000800000000000001',
      sendDatetime: 1781084650001,
      dataSha256: sha('DEL1'),
      attempts: 1,
      lastError: 'Timeout',
    });
    const sub2 = await repo.submissions.create({
      certificateId: c1.row.id,
      msgId: '7500126112300000000000004000800000000000002',
      sendDatetime: 1781084650002,
      dataSha256: sha('DEL1'),
      attempts: 2,
      lastError: 'HTTP 500',
    });
    const subOther = await repo.submissions.create({
      certificateId: c2.row.id,
      msgId: '7500126112300000000000004000800000000000003',
      sendDatetime: 1781084650003,
      dataSha256: sha('DEL2'),
      attempts: 1,
      httpStatus: 200,
      resCode: 'PS_SYNC_SUCCESS',
      resultStatus: 'accepted',
    });

    expect(await repo.submissions.listByCertificateId(c1.row.id)).toHaveLength(2);

    const deleted = await repo.certificates.deleteById(c1.row.id);
    expect(deleted).toBe(true);
    expect(await repo.certificates.deleteById(c1.row.id)).toBe(false);
    expect(await repo.certificates.findById(c1.row.id)).toBeNull();
    expect(await repo.certificates.findBySo('TEST.75001.DEL1')).toBeNull();

    // Toàn bộ submissions của c1 đã bị xóa theo
    expect(await repo.submissions.listByCertificateId(c1.row.id)).toEqual([]);
    expect(await repo.submissions.findById(sub1.id)).toBeNull();
    expect(await repo.submissions.findByMsgId(sub2.msgId)).toBeNull();

    // Submission của c2 vẫn còn nguyên
    expect(await repo.submissions.findById(subOther.id)).not.toBeNull();
  });

  it('7. Khởi động lại (recoverOnStartup): chuyển toàn bộ giấy đang kẹt ở sending -> error', async () => {
    const repo = createRepositories();

    await repo.certificates.upsertManyBySo([
      {
        so: 'TEST.75001.REC1',
        fields: makeRecord({ SO: 'TEST.75001.REC1' }),
        dataSha256: sha('R1'),
        status: 'sending',
      },
      {
        so: 'TEST.75001.REC2',
        fields: makeRecord({ SO: 'TEST.75001.REC2' }),
        dataSha256: sha('R2'),
        status: 'sending',
      },
      {
        so: 'TEST.75001.REC3',
        fields: makeRecord({ SO: 'TEST.75001.REC3' }),
        dataSha256: sha('R3'),
        status: 'ready',
      },
      {
        so: 'TEST.75001.REC4',
        fields: makeRecord({ SO: 'TEST.75001.REC4' }),
        dataSha256: sha('R4'),
        status: 'accepted',
      },
    ]);

    const recoveredCount = await repo.certificates.recoverOnStartup(
      '2026-11-23T12:00:00.000Z',
    );
    expect(recoveredCount).toBe(2);

    const counts = await repo.certificates.countByStatus();
    expect(counts.sending).toBe(0);
    expect(counts.error).toBe(2);
    expect(counts.ready).toBe(1);
    expect(counts.accepted).toBe(1);
  });

  it('8. Submissions repository: create, update, findPendingByCertificateAndSha và findLatestByCertificateIds', async () => {
    const repo = createRepositories();
    const cert = await repo.certificates.upsertBySo({
      so: 'TEST.75001.SUB1',
      fields: makeRecord({ SO: 'TEST.75001.SUB1' }),
      dataSha256: sha('SUB_SHA_1'),
      status: 'ready',
    });

    const sub1 = await repo.submissions.create({
      certificateId: cert.row.id,
      msgId: '7500126112300000000000004000800000000000101',
      sendDatetime: 1781084651000,
      dataSha256: sha('SUB_SHA_1'),
      attempts: 1,
    });

    // Tìm submission đang chờ kết quả (resultStatus === null) và cùng dataSha256
    const pending = await repo.submissions.findPendingByCertificateAndSha(
      cert.row.id,
      sha('SUB_SHA_1'),
    );
    expect(pending?.id).toBe(sub1.id);
    expect(pending?.msgId).toBe(sub1.msgId);

    // Cập nhật kết quả sau khi đẩy thành công
    const updated = await repo.submissions.update(sub1.id, {
      attempts: 2,
      httpStatus: 200,
      resCode: 'PS_SYNC_SUCCESS',
      resultStatus: 'accepted',
      serverSubmissionId: 'srv-sub-101',
      warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
      errors: [],
      finishedAt: '2026-11-23T12:05:00.000Z',
    });

    expect(updated?.resultStatus).toBe('accepted');
    expect(updated?.warnings).toEqual([{ code: 'GKSK_UNSIGNED', field: null }]);
    expect(updated?.serverSubmissionId).toBe('srv-sub-101');

    // Khi đã có resultStatus='accepted', findPendingByCertificateAndSha trả về null
    expect(
      await repo.submissions.findPendingByCertificateAndSha(
        cert.row.id,
        sha('SUB_SHA_1'),
      ),
    ).toBeNull();

    // Tạo thêm lần gửi thứ 2
    const sub2 = await repo.submissions.create({
      certificateId: cert.row.id,
      msgId: '7500126112300000000000004000800000000000102',
      sendDatetime: 1781084652000,
      dataSha256: sha('SUB_SHA_2'),
      attempts: 1,
      httpStatus: 200,
      resCode: 'PS_SYNC_SUCCESS',
      resultStatus: 'rejected',
      errors: [{ code: 'GKSK_FACILITY_MISMATCH', field: 'IDBENHVIEN' }],
    });

    const latest = await repo.submissions.findLatestByCertificateId(cert.row.id);
    expect(latest?.id).toBe(sub2.id);

    const latestMap = await repo.submissions.findLatestByCertificateIds([cert.row.id]);
    expect(latestMap.get(cert.row.id)?.id).toBe(sub2.id);
  });

  it('9. Kiểm thử MssqlRepositories và runMigrations qua Mock ConnectionPool (xác nhận 100% tham số hóa qua .input())', async () => {
    const recordedCalls: Array<{
      inputs: Array<{ name: string; value: unknown }>;
      sqlText: string;
    }> = [];

    const fakePool = {
      request() {
        const inputs: Array<{ name: string; value: unknown }> = [];
        const reqObj = {
          input(name: string, _type: unknown, value: unknown) {
            inputs.push({ name, value });
            return reqObj;
          },
          async query(sqlText: string) {
            recordedCalls.push({ inputs: [...inputs], sqlText });
            if (sqlText.includes('INSERT INTO dbo.gksk_import_batches')) {
              return {
                recordset: [
                  {
                    id: 10,
                    filename: 'batch_mssql.xlsx',
                    row_count: 5,
                    created_at: new Date('2026-11-23T10:00:00.000Z'),
                  },
                ],
                rowsAffected: [1],
              };
            }
            if (sqlText.includes('GROUP BY c.status')) {
              return {
                recordset: [
                  { status: 'ready', cnt: 3 },
                  { status: 'accepted', cnt: 2 },
                  { status: 'invalid', cnt: 1 },
                ],
                rowsAffected: [3],
              };
            }
            if (sqlText.includes('SELECT COUNT(1) AS total')) {
              return {
                recordset: [{ total: 6 }],
                rowsAffected: [1],
              };
            }
            if (sqlText.includes('FROM dbo.gksk_certificates')) {
              return {
                recordset: [
                  {
                    id: 1,
                    so: 'TEST.75001.MSSQL.1',
                    fields_json: JSON.stringify(
                      makeRecord({ SO: 'TEST.75001.MSSQL.1' }),
                    ),
                    data_sha256: sha('MSSQL1'),
                    status: 'ready',
                    batch_id: 10,
                    batch_filename: 'batch_mssql.xlsx',
                    excel_row_number: 2,
                    server_certificate_id: null,
                    created_at: new Date('2026-11-23T10:00:00.000Z'),
                    updated_at: new Date('2026-11-23T10:00:00.000Z'),
                  },
                ],
                rowsAffected: [1],
              };
            }
            if (sqlText.includes(' dbo.gksk_submissions')) {
              return {
                recordset: [
                  {
                    id: 50,
                    certificate_id: 1,
                    msg_id: '7500126112300000000000004000800000000000999',
                    send_datetime: 1781084650999,
                    data_sha256: sha('MSSQL1'),
                    attempts: 1,
                    http_status: 200,
                    res_code: 'PS_SYNC_SUCCESS',
                    result_status: 'accepted',
                    server_submission_id: 'srv-50',
                    errors_json: '[]',
                    warnings_json: '[{"code":"GKSK_UNSIGNED","field":null}]',
                    last_error: null,
                    created_at: new Date('2026-11-23T10:01:00.000Z'),
                    finished_at: new Date('2026-11-23T10:01:02.000Z'),
                  },
                ],
                rowsAffected: [1],
              };
            }
            return { recordset: [], rowsAffected: [1] };
          },
        };
        return reqObj;
      },
    } as unknown as sql.ConnectionPool;

    const poolCfg = buildMssqlPoolConfig({
      host: 'localhost',
      port: 1433,
      user: 'sa',
      dbPassword: 'secret',
      name: 'GKSKLaiXe',
      encrypt: false,
      trustServerCert: true,
    });
    expect(poolCfg.server).toBe('localhost');
    expect(poolCfg.database).toBe('GKSKLaiXe');

    const applied = await runMigrations(fakePool);
    expect(applied).toEqual(['001_init']);

    const mssqlRepo = new MssqlRepositories(fakePool);
    expect(mssqlRepo.kind).toBe('mssql');

    const batch = await mssqlRepo.batches.create({
      filename: 'batch_mssql.xlsx',
      rowCount: 5,
    });
    expect(batch.id).toBe(10);

    const listRes = await mssqlRepo.certificates.list({
      tab: 'unsent',
      batchId: 10,
      q: "100%_test'quote",
      page: 1,
      pageSize: 20,
    });
    expect(listRes.total).toBe(6);
    expect(listRes.counts.all).toBe(6);
    expect(listRes.items[0]?.so).toBe('TEST.75001.MSSQL.1');

    // Kiểm tra tham số @qPattern đã được escape % và _ và truyền qua .input()
    const listQueryCall = recordedCalls.find((c) =>
      c.sqlText.includes('OFFSET @offset ROWS'),
    );
    expect(listQueryCall).toBeDefined();
    expect(listQueryCall?.inputs).toContainEqual({
      name: 'qPattern',
      value: "%100\\%\\_test'quote%",
    });

    await mssqlRepo.certificates.findBySoList(['TEST.75001.MSSQL.1']);
    await mssqlRepo.certificates.findByIds([1]);
    await mssqlRepo.certificates.updateStatus(1, {
      status: 'accepted',
      serverCertificateId: 'srv-cert-1',
    });
    await mssqlRepo.certificates.recoverOnStartup();
    await mssqlRepo.certificates.deleteById(1);

    const createdSub = await mssqlRepo.submissions.create({
      certificateId: 1,
      msgId: '7500126112300000000000004000800000000000999',
      sendDatetime: 1781084650999,
      dataSha256: sha('MSSQL1'),
    });
    expect(createdSub.id).toBe(50);
    await mssqlRepo.submissions.update(50, { attempts: 2 });
    await mssqlRepo.submissions.findByMsgId(createdSub.msgId);
    await mssqlRepo.submissions.listByCertificateId(1);
    await mssqlRepo.submissions.findLatestByCertificateId(1);
    await mssqlRepo.submissions.findLatestByCertificateIds([1]);
    await mssqlRepo.submissions.findPendingByCertificateAndSha(1, sha('MSSQL1'));
  });

  it('10. Quét tĩnh 001_init.sql, mssqlRepo.ts và connection.ts: 100% bảng gksk_*, 0 DROP/TRUNCATE, 100% truy vấn dùng @param qua .input()', () => {
    const migrationsDir = resolveDefaultMigrationsDir();
    const sqlPath = path.join(migrationsDir, '001_init.sql');
    const mssqlRepoPath = path.join(__dirname, 'mssqlRepo.ts');
    const connectionPath = path.join(__dirname, 'connection.ts');

    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    const mssqlRepoContent = fs.readFileSync(mssqlRepoPath, 'utf8');
    const connectionContent = fs.readFileSync(connectionPath, 'utf8');

    // 1. Không có lệnh DROP hoặc TRUNCATE trong migration SQL, mssqlRepo.ts và connection.ts
    expect(/\b(DROP|TRUNCATE)\b/i.test(sqlContent)).toBe(false);
    expect(/\b(DROP|TRUNCATE)\b/i.test(mssqlRepoContent)).toBe(false);
    expect(/\b(DROP|TRUNCATE)\b/i.test(connectionContent)).toBe(false);

    // 2. Mọi bảng tạo trong 001_init.sql đều thuộc đúng 4 bảng tiền tố gksk_ và có IF OBJECT_ID(...) IS NULL
    const createdTables = Array.from(
      sqlContent.matchAll(/CREATE\s+TABLE\s+(?:dbo\.)?([A-Za-z0-9_]+)/gi),
      (m) => m[1] ?? '',
    );
    expect(createdTables).toEqual([...GKSK_TABLE_NAMES]);
    for (const tbl of createdTables) {
      expect(tbl.startsWith('gksk_')).toBe(true);
      expect(sqlContent).toContain(`IF OBJECT_ID(N'dbo.${tbl}', N'U') IS NULL`);
    }

    // 3. Mọi bảng tham chiếu trong câu SQL của mssqlRepo.ts đều bắt đầu bằng gksk_
    const referencedTables = Array.from(
      mssqlRepoContent.matchAll(
        /\b(?:FROM|INTO|UPDATE|JOIN)\s+dbo\.([A-Za-z0-9_]+)/gi,
      ),
      (m) => m[1] ?? '',
    );
    expect(referencedTables.length).toBeGreaterThan(0);
    for (const tbl of referencedTables) {
      expect(tbl.startsWith('gksk_')).toBe(true);
    }

    // 4. Mọi câu lệnh DELETE trong mssqlRepo.ts đều phải có mệnh đề WHERE @id
    const deleteMatches = Array.from(
      mssqlRepoContent.matchAll(/DELETE\s+FROM\s+dbo\.([A-Za-z0-9_]+)[\s\S]*?;/gi),
      (m) => m[0],
    );
    expect(deleteMatches.length).toBe(1);
    expect(deleteMatches[0]).toMatch(/WHERE\s+id\s*=\s*@id/i);

    // 5. Tuyệt đối không có phép nội suy chuỗi ${...} bên trong bất kỳ lời gọi .query(`...`) nào của mssqlRepo.ts và connection.ts
    const mssqlQueryBlocks = Array.from(
      mssqlRepoContent.matchAll(/\.query(?:<[^>]+>)?\(\s*`([\s\S]*?)`\s*,?\s*\)/g),
      (m) => m[1] ?? '',
    );
    const connectionQueryBlocks = Array.from(
      connectionContent.matchAll(/\.query(?:<[^>]+>)?\(\s*`([\s\S]*?)`\s*,?\s*\)/g),
      (m) => m[1] ?? '',
    );
    const queryBlocks = [...mssqlQueryBlocks, ...connectionQueryBlocks];
    expect(queryBlocks.length).toBeGreaterThanOrEqual(19);
    for (const sqlBlock of queryBlocks) {
      expect(sqlBlock).not.toContain('${');
    }

    // 6. Mọi tham số @param sử dụng trong các câu SQL của mssqlRepo.ts đều được đăng ký qua .input('param', ...)
    const declaredInputs = new Set(
      Array.from(
        mssqlRepoContent.matchAll(/\.input\(\s*'([A-Za-z0-9_]+)'/g),
        (m) => m[1] ?? '',
      ),
    );
    const usedSqlParams = new Set(
      mssqlQueryBlocks.flatMap((block) =>
        Array.from(block.matchAll(/@([A-Za-z0-9_]+)/g), (m) => m[1] ?? ''),
      ),
    );
    expect(usedSqlParams.size).toBeGreaterThanOrEqual(20);
    for (const param of usedSqlParams) {
      expect(declaredInputs.has(param)).toBe(true);
    }
  });
});
