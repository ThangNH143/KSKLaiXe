import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyRecord, type GkskRecord } from '@gksk/shared';
import { createMockGkskApp } from '../../../tools/mock-gksk-api/dist/app.js';
import { createApp } from '../app.js';
import { createInMemoryRepositories } from '../db/inMemoryRepo.js';
import type { CertificateRow, DbRepositories } from '../db/types.js';
import { createGkskClient } from '../gksk/client.js';
import { createLogger } from '../logger.js';
import {
  BATCH_SEND_INTERVAL_MS,
  createJobService,
  MAX_BATCH_CONCURRENCY,
} from './jobService.js';
import {
  computeCertificatePayload,
  createSendService,
} from './sendService.js';

function makeValidRecord(overrides: Partial<GkskRecord> = {}): GkskRecord {
  const base = createEmptyRecord();
  return {
    ...base,
    SO: 'TEST.75001.S9.0001',
    NGAYKHAM: '05/11/2026',
    HOTEN: 'TEST NGUYEN VAN S9',
    GIOITINHVAL: '0',
    NGAYSINH: '21/05/1990',
    DIACHITHUONGTRU: 'So 9 Duong Thu, Bien Hoa, Dong Nai',
    MATINH_THUONGTRU: '75',
    MAHUYEN_THUONGTRU: '75731',
    MAXA_THUONGTRU: '7573126041',
    SOCMND_PASSPORT: 'TESTGKSK09',
    NGAYTHANGNAMCAP: '01/02/2021',
    NOICAP: 'Cuc CS QLHC',
    HANGBANGLAI: 'B2',
    IDBENHVIEN: '75001',
    BENHVIEN: 'Benh vien Da khoa Dong Nai',
    NGAYKETLUAN: '06/11/2026',
    NONGDOCON: '0.15',
    DVINONGDOCON: '0',
    MATUY: '0',
    BACSYKETLUAN: 'TEST BS NGUYEN',
    KETLUAN: 'A0-1',
    NGAYKHAMLAI: '',
    LYDO: 'Kham suc khoe dinh ky',
    TINHTRANGBENH: 'Binh thuong',
    STATE: 'ADD',
    ...overrides,
  };
}

async function seedCertificate(
  repos: DbRepositories,
  overrides: Partial<GkskRecord> = {},
  status: CertificateRow['status'] = 'ready',
): Promise<CertificateRow> {
  const fields = makeValidRecord(overrides);
  const { dataSha256 } = computeCertificatePayload(fields);
  const upserted = await repos.certificates.upsertBySo({
    so: fields.SO,
    fields,
    dataSha256,
    status,
    now: '2026-11-23T08:00:00.000Z',
  });
  return upserted.row;
}

function createLogCollector() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger = createLogger({ level: 'debug', destination: stream });
  const infoSpy = vi.spyOn(logger, 'info');
  const warnSpy = vi.spyOn(logger, 'warn');
  const errorSpy = vi.spyOn(logger, 'error');
  const debugSpy = vi.spyOn(logger, 'debug');

  return {
    logger,
    lines,
    spies: [infoSpy, warnSpy, errorSpy, debugSpy],
    getRawOutput(): string {
      return lines.join('\n');
    },
  };
}

interface MockServerState {
  activeFail: unknown;
  tokenCount: number;
  submissionCount: number;
  certificateCount: number;
  requests: Array<{
    method: string;
    path: string;
    timestampMs: number;
    msgId?: string;
    senderId?: string;
    httpStatus?: number;
    note?: string;
  }>;
}

describe('server/src/services/{sendService,jobService}.ts & routes/send.ts — S9 Máy trạng thái gửi & Hàng đợi gửi hàng loạt', () => {
  let mockServer: Server;
  let mockBaseUrl = '';

  beforeAll(async () => {
    const mockApp = createMockGkskApp({
      currentYear: 2026,
    });
    mockServer = await new Promise<Server>((resolve) => {
      const s = mockApp.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = (mockServer.address() as AddressInfo).port;
    mockBaseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      mockServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(async () => {
    await fetch(`${mockBaseUrl}/__mock/reset`, { method: 'POST' });
  });

  async function setMockFailure(payload: {
    mode: string;
    count?: number;
    retryAfterSec?: number;
    timeoutMs?: number;
    target?: 'push' | 'login' | 'status';
  }): Promise<void> {
    const res = await fetch(`${mockBaseUrl}/__mock/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
  }

  async function getMockState(): Promise<MockServerState> {
    const res = await fetch(`${mockBaseUrl}/__mock/state`);
    expect(res.status).toBe(200);
    return (await res.json()) as MockServerState;
  }

  function createTestStack(options?: {
    facilityId?: string;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    maxRetries?: number;
    retryDelaysMs?: readonly number[];
    minIntervalMs?: number;
    maxConcurrency?: number;
    httpTimeoutMs?: number;
  }) {
    const repos = createInMemoryRepositories();
    const logCollector = createLogCollector();
    const facilityId = options?.facilityId ?? '75001';
    let currentNow = Date.parse('2026-11-23T08:00:00.000Z');
    const nowFn = options?.now ?? (() => currentNow);
    const sleepFn =
      options?.sleep ??
      (async (ms: number) => {
        currentNow += ms;
      });

    const gkskClient = createGkskClient({
      baseUrl: mockBaseUrl,
      username: '75001',
      password: 'mock',
      httpTimeoutMs: options?.httpTimeoutMs ?? 2_000,
      now: nowFn,
      sleep: sleepFn,
      logger: logCollector.logger,
    });

    const sendService = createSendService({
      repos,
      gkskClient,
      facilityId,
      senderId: '75001',
      today: '2026-11-23',
      retryOptions: {
        maxRetries: options?.maxRetries ?? 3,
        retryDelaysMs: options?.retryDelaysMs ?? [5_000, 15_000, 45_000],
      },
      now: nowFn,
      logger: logCollector.logger,
    });

    const jobService = createJobService({
      sendService,
      maxConcurrency: options?.maxConcurrency ?? MAX_BATCH_CONCURRENCY,
      minIntervalMs: options?.minIntervalMs ?? BATCH_SEND_INTERVAL_MS,
      now: nowFn,
      sleep: sleepFn,
      logger: logCollector.logger,
    });

    const app = createApp({
      repos,
      gkskClient,
      sendService,
      jobService,
      facilityId,
      senderId: '75001',
      today: '2026-11-23',
      logger: logCollector.logger,
    });

    return {
      repos,
      gkskClient,
      sendService,
      jobService,
      app,
      logCollector,
      advanceClock(ms: number) {
        currentNow += ms;
      },
    };
  }

  it('1. Gửi 1 giấy hợp lệ (ready) qua POST /api/certificates/:id/send -> accepted, DB lưu submission đúng msg_id & GKSK_UNSIGNED (Postman 2.1)', async () => {
    const { app, repos } = createTestStack();
    const cert = await seedCertificate(repos, {
      SO: 'TEST.75001.S9.201',
      HOTEN: 'TEST NGUYEN VAN HOP LE',
    });

    const res = await request(app).post(`/api/certificates/${cert.id}/send`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(res.body.certificateId).toBe(cert.id);
    expect(res.body.so).toBe('TEST.75001.S9.201');
    expect(res.body.reusedPendingSubmission).toBe(false);
    expect(res.body.recoveredViaStatus).toBe(false);

    // Phản hồi API không được rò rỉ fields/fieldsJson chứa dữ liệu nhạy cảm
    expect(res.body.certificate).not.toHaveProperty('fields');
    expect(res.body.certificate).not.toHaveProperty('fieldsJson');
    expect(res.body.certificate.serverCertificateId).toBeTruthy();

    const dbCert = await repos.certificates.findById(cert.id);
    expect(dbCert?.status).toBe('accepted');
    expect(dbCert?.serverCertificateId).toBe(res.body.certificate.serverCertificateId);

    const submissions = await repos.submissions.listByCertificateId(cert.id);
    expect(submissions).toHaveLength(1);
    const sub = submissions[0]!;
    expect(sub.msgId).toMatch(/^75001261123[0-9a-f]{32}$/);
    expect(sub.attempts).toBe(1);
    expect(sub.httpStatus).toBe(200);
    expect(sub.resCode).toBe('PS_SYNC_SUCCESS');
    expect(sub.resultStatus).toBe('accepted');
    expect(sub.serverSubmissionId).toBeTruthy();
    expect(sub.errors).toEqual([]);
    expect(sub.warnings).toEqual([{ code: 'GKSK_UNSIGNED', field: null }]);
    expect(sub.lastError).toBeNull();
    expect(sub.finishedAt).toBeTruthy();
  });

  it('2. Chặn giấy có lỗi dữ liệu chặn (invalid) -> cập nhật trạng thái invalid và KHÔNG gửi request nào tới Mock Server', async () => {
    const { app, repos } = createTestStack();
    // Giả sử giấy đang ở trạng thái ready trong DB nhưng dữ liệu có lỗi chặn (NGAYSINH không tồn tại)
    const badCert = await seedCertificate(
      repos,
      {
        SO: 'TEST.75001.S9.INVALID',
        NGAYSINH: '31/02/1990',
      },
      'ready',
    );

    const res = await request(app).post(`/api/certificates/${badCert.id}/send`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('invalid');
    expect(res.body.submission).toBeNull();
    expect(
      res.body.issues.some(
        (i: { code: string; severity: string }) =>
          i.code === 'GKSK_NGAYSINH_INVALID' && i.severity === 'error',
      ),
    ).toBe(true);

    const dbCert = await repos.certificates.findById(badCert.id);
    expect(dbCert?.status).toBe('invalid');

    const submissions = await repos.submissions.listByCertificateId(badCert.id);
    expect(submissions).toHaveLength(0);

    // Khẳng định Mock Server nhận 0 request nào
    const mockState = await getMockState();
    expect(mockState.requests).toHaveLength(0);
  });

  it('3. Mock timeout & lỗi mạng tạm thời -> retry giữ nguyên msg_id, và gửi lại từ trạng thái error tái sử dụng đúng submission cũ (Postman 2.2)', async () => {
    const { app, repos } = createTestStack({
      httpTimeoutMs: 60,
    });
    const cert = await seedCertificate(repos, {
      SO: 'TEST.75001.S9.RETRY',
    });

    // Kịch bản 3a: Mock timeout 1 lần rồi thành công ở lần thử thứ 2 trong cùng 1 lệnh send
    await setMockFailure({ mode: 'timeout', count: 1, timeoutMs: 300 });
    const res1 = await request(app).post(`/api/certificates/${cert.id}/send`);
    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('accepted');
    expect(res1.body.submission.attempts).toBe(2);

    const mockState1 = await getMockState();
    const pushReqs1 = mockState1.requests.filter((r) => r.path.endsWith('/push'));
    const statusReqs1 = mockState1.requests.filter((r) => r.path.includes('/status'));
    expect(pushReqs1).toHaveLength(2);
    expect(statusReqs1).toHaveLength(1);
    expect(pushReqs1[0]?.msgId).toBe(res1.body.submission.msgId);
    expect(pushReqs1[1]?.msgId).toBe(res1.body.submission.msgId);

    // Kịch bản 3b: Giấy thứ 2 gặp lỗi 500 cả 4 lần (1 lần đầu + 3 lần retry) -> chuyển sang error, resultStatus = null
    const cert2 = await seedCertificate(repos, {
      SO: 'TEST.75001.S9.PERSIST_MSGID',
    });
    await setMockFailure({ mode: '500', count: 4 });

    const resFail = await request(app).post(`/api/certificates/${cert2.id}/send`);
    expect(resFail.status).toBe(200);
    expect(resFail.body.status).toBe('error');
    expect(resFail.body.submission.resultStatus).toBeNull();
    expect(resFail.body.submission.attempts).toBe(4);
    expect(resFail.body.submission.lastError).toContain('HTTP 500');

    const preservedMsgId = resFail.body.submission.msgId as string;
    const preservedSendDatetime = resFail.body.submission.sendDatetime as number;
    const preservedSubmissionId = resFail.body.submission.id as number;

    // Khi bấm "Gửi lại" (POST /api/certificates/:id/send) mà dữ liệu giấy chưa đổi -> tái sử dụng cùng submission & msg_id
    const resRetry = await request(app).post(`/api/certificates/${cert2.id}/send`);
    expect(resRetry.status).toBe(200);
    expect(resRetry.body.status).toBe('accepted');
    expect(resRetry.body.reusedPendingSubmission).toBe(true);
    expect(resRetry.body.submission.id).toBe(preservedSubmissionId);
    expect(resRetry.body.submission.msgId).toBe(preservedMsgId);
    expect(resRetry.body.submission.sendDatetime).toBe(preservedSendDatetime);
    expect(resRetry.body.submission.attempts).toBe(5);

    const allSubsCert2 = await repos.submissions.listByCertificateId(cert2.id);
    expect(allSubsCert2).toHaveLength(1);

    // Kịch bản 3c (Postman 2.2): Mất kết nối sau khi Mock đã lưu (disconnect-after-save) -> lần gửi lại thu hồi đúng submission_id
    const cert3 = await seedCertificate(repos, {
      SO: 'TEST.75001.S9.202_IDEMPOTENT',
    });
    await setMockFailure({ mode: 'disconnect-after-save', count: 1 });
    const resIdempotent = await request(app).post(`/api/certificates/${cert3.id}/send`);
    expect(resIdempotent.status).toBe(200);
    expect(resIdempotent.body.status).toBe('accepted');
    expect(resIdempotent.body.recoveredViaStatus).toBe(true);
    expect(resIdempotent.body.submission.serverSubmissionId).toBeTruthy();
  });

  it('4. Cập nhật dữ liệu giấy (qua upsert import) rồi gửi lại -> sinh msg_id mới, Mock ghi đè giữ cùng certificate_id (Postman 2.3)', async () => {
    const { app, repos, advanceClock } = createTestStack();
    const cert = await seedCertificate(repos, {
      SO: 'TEST.75001.S9.203_OVERWRITE',
      HOTEN: 'TEST NGUYEN VAN BAN DAU',
    });

    // Lần gửi 1
    const res1 = await request(app).post(`/api/certificates/${cert.id}/send`);
    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe('accepted');
    const firstMsgId = res1.body.submission.msgId as string;
    const firstServerSubId = res1.body.submission.serverSubmissionId as string;
    const firstServerCertId = res1.body.certificate.serverCertificateId as string;

    // Người dùng sửa dữ liệu trên Excel và Import đè theo mã SO
    advanceClock(10_000);
    const updatedFields = makeValidRecord({
      SO: 'TEST.75001.S9.203_OVERWRITE',
      HOTEN: 'TEST NGUYEN VAN DA SUA',
      HANGBANGLAI: 'C',
    });
    const { dataSha256: newSha } = computeCertificatePayload(updatedFields);
    await repos.certificates.upsertBySo({
      so: updatedFields.SO,
      fields: updatedFields,
      dataSha256: newSha,
      status: 'ready',
    });

    // Lần gửi 2 sau khi dữ liệu đã thay đổi
    const res2 = await request(app).post(`/api/certificates/${cert.id}/send`);
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe('accepted');
    expect(res2.body.reusedPendingSubmission).toBe(false);

    const secondMsgId = res2.body.submission.msgId as string;
    const secondServerSubId = res2.body.submission.serverSubmissionId as string;
    const secondServerCertId = res2.body.certificate.serverCertificateId as string;

    // msg_id mới và submission_id mới, nhưng giữ nguyên certificate_id trên Hệ thống Sở + cảnh báo GKSK_STATE_ADD_EXISTS
    expect(secondMsgId).not.toBe(firstMsgId);
    expect(secondServerSubId).not.toBe(firstServerSubId);
    expect(secondServerCertId).toBe(firstServerCertId);
    expect(
      res2.body.submission.warnings.some(
        (w: { code: string }) => w.code === 'GKSK_STATE_ADD_EXISTS',
      ),
    ).toBe(true);

    const history = await repos.submissions.listByCertificateId(cert.id);
    expect(history).toHaveLength(2);
  });

  it('5. Kịch bản Postman 2.4 (cảnh báo không chặn), kết quả rejected lưu errors_json, và POST /api/submissions/:id/refresh tra cứu lại status', async () => {
    // Khởi tạo stack với facilityId='75999' cho riêng 1 giấy để vượt qua validateRecord cục bộ nhưng bị Mock Server (token 75001) từ chối GKSK_FACILITY_MISMATCH
    const { app, repos } = createTestStack();

    // 5a. Kịch bản Postman 2.4: giấy có nhiều cảnh báo không chặn (KETLUAN lạ, NONGDOCON chữ, NOICAP > 30 ký tự)
    const warnCert = await seedCertificate(repos, {
      SO: 'TEST.75001.S9.204_WARNINGS',
      KETLUAN: 'A0-9',
      NONGDOCON: 'abc',
      NOICAP: 'N'.repeat(31),
      SOCMND_PASSPORT: '000000000000',
    });
    const resWarn = await request(app).post(`/api/certificates/${warnCert.id}/send`);
    expect(resWarn.status).toBe(200);
    expect(resWarn.body.status).toBe('accepted');
    const warningCodes = (resWarn.body.submission.warnings as Array<{ code: string }>).map(
      (w) => w.code,
    );
    expect(warningCodes).toEqual(
      expect.arrayContaining([
        'GKSK_UNSIGNED',
        'GKSK_KETLUAN_UNKNOWN',
        'GKSK_NONGDOCON_INVALID',
        'GKSK_FIELD_TOO_LONG',
        'GKSK_ID_INVALID',
      ]),
    );

    // 5b. Giấy bị Hệ thống Sở trả HTTP 200 nhưng data.status = 'rejected' -> lưu đầy đủ errors_json
    const mismatchStack = createTestStack({ facilityId: '75999' });
    const rejectedCert = await seedCertificate(mismatchStack.repos, {
      SO: 'TEST.75001.S9.REJECTED',
      IDBENHVIEN: '75999',
    });
    const resRejected = await request(mismatchStack.app).post(
      `/api/certificates/${rejectedCert.id}/send`,
    );
    expect(resRejected.status).toBe(200);
    expect(resRejected.body.status).toBe('rejected');

    const dbRejectedSub = await mismatchStack.repos.submissions.findById(
      resRejected.body.submission.id,
    );
    expect(dbRejectedSub?.resultStatus).toBe('rejected');
    expect(dbRejectedSub?.httpStatus).toBe(200);
    expect(dbRejectedSub?.resCode).toBe('PS_SYNC_SUCCESS');
    expect(dbRejectedSub?.errors).toEqual([
      { code: 'GKSK_FACILITY_MISMATCH', field: 'IDBENHVIEN' },
    ]);
    expect(dbRejectedSub?.errorsJson).toContain('GKSK_FACILITY_MISMATCH');

    // 5c. POST /api/submissions/:id/refresh tra cứu lại trạng thái trên Hệ thống Sở
    const subId = resWarn.body.submission.id as number;
    const resRefresh = await request(app).post(`/api/submissions/${subId}/refresh`);
    expect(resRefresh.status).toBe(200);
    expect(resRefresh.body.found).toBe(true);
    expect(resRefresh.body.status).toBe('accepted');
    expect(resRefresh.body.submission.serverSubmissionId).toBe(
      resWarn.body.submission.serverSubmissionId,
    );

    // Tra cứu submission chưa từng gửi lên Sở -> HTTP 404 từ Sở
    const ghostSub = await repos.submissions.create({
      certificateId: warnCert.id,
      msgId: '7500126112300000000000040008000000000000000',
      sendDatetime: 1781084650736,
      dataSha256: 'A'.repeat(64),
    });
    const resRefresh404 = await request(app).post(
      `/api/submissions/${ghostSub.id}/refresh`,
    );
    expect(resRefresh404.status).toBe(200);
    expect(resRefresh404.body.found).toBe(false);
    expect(resRefresh404.body.httpStatus).toBe(404);
  });

  it('6. Gửi batch 25 giấy (21 hợp lệ + 3 bị Sở từ chối + 1 lỗi mạng tạm thời) -> tiến độ đúng, tổng hợp đúng, 0 giấy kẹt sending, không rò rỉ PII trong log', async () => {
    const { repos, logCollector } = createTestStack({
      minIntervalMs: 5,
    });

    const ids: number[] = [];
    for (let i = 1; i <= 25; i++) {
      const so = `TEST.75001.S9.BATCH.${String(i).padStart(3, '0')}`;
      const cert = await seedCertificate(repos, {
        SO: so,
        HOTEN: `TEST NGUYEN BATCH ${i}`,
        SOCMND_PASSPORT: `TESTGKSK${String(i).padStart(2, '0')}`,
        NONGDOCON: '0.35',
        MATUY: '1',
        LYDO: `Ly do nhay cam ${i}`,
        TINHTRANGBENH: `Tinh trang benh nhay cam ${i}`,
      });
      ids.push(cert.id);
    }

    // Чтобы 3 giấy (#5, #12, #19) bị Mock Server trả HTTP 200 data.status='rejected' (mà vẫn qua được validateRecord cục bộ),
    // dùng 1 client wrapper gắn thẻ lạ hoặc đổi IDBENHVIEN trong payload cho 3 giấy đó, và ép lỗi 500 cho giấy #25:
    const rejectedCertIds = new Set([ids[4]!, ids[11]!, ids[18]!]);
    const transientErrorCertId = ids[24]!;

    const originalFetch = globalThis.fetch;
    const customFetch: typeof fetch = async (input, init) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      if (urlStr.endsWith('/api/platform/gksk-lai-xe/push') && init?.body) {
        const parsedBody = JSON.parse(String(init.body)) as {
          header: { msg_id: string };
          data: string;
          signature: string;
        };
        const xmlDecoded = Buffer.from(parsedBody.data, 'base64').toString('utf8');

        // Giấy #25: giả lập lỗi mạng 500 ở mọi lần gọi push
        if (xmlDecoded.includes('TEST.75001.S9.BATCH.025')) {
          return new Response(
            JSON.stringify({
              header: {
                res_code: 'PS_DS_SAVE_FAIL',
                res_msg: 'Lỗi lưu dữ liệu tạm thời trên máy chủ',
              },
              data: null,
            }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        // 3 giấy #5, #12, #19: giả lập bị Sở từ chối (HTTP 200, data.status = 'rejected')
        if (
          xmlDecoded.includes('TEST.75001.S9.BATCH.005') ||
          xmlDecoded.includes('TEST.75001.S9.BATCH.012') ||
          xmlDecoded.includes('TEST.75001.S9.BATCH.019')
        ) {
          const tamperedXml = xmlDecoded.replace(
            '<IDBENHVIEN>75001</IDBENHVIEN>',
            '<IDBENHVIEN>75999</IDBENHVIEN>',
          );
          const tamperedData = Buffer.from(tamperedXml, 'utf8').toString('base64');
          return originalFetch(input, {
            ...init,
            body: JSON.stringify({
              ...parsedBody,
              data: tamperedData,
            }),
          });
        }
      }
      return originalFetch(input, init);
    };

    // Tạo stack dùng customFetch cho kịch bản batch 25 giấy
    const batchGkskClient = createGkskClient({
      baseUrl: mockBaseUrl,
      username: '75001',
      password: 'mock',
      fetchImpl: customFetch,
      sleep: async () => {},
      logger: logCollector.logger,
    });
    const batchSendService = createSendService({
      repos,
      gkskClient: batchGkskClient,
      facilityId: '75001',
      senderId: '75001',
      today: '2026-11-23',
      logger: logCollector.logger,
    });
    const batchJobService = createJobService({
      sendService: batchSendService,
      maxConcurrency: 2,
      minIntervalMs: 5,
      sleep: async () => {},
      logger: logCollector.logger,
    });
    const batchApp = createApp({
      repos,
      gkskClient: batchGkskClient,
      sendService: batchSendService,
      jobService: batchJobService,
      facilityId: '75001',
      senderId: '75001',
      today: '2026-11-23',
      logger: logCollector.logger,
    });

    const startRes = await request(batchApp).post('/api/send').send({ ids });
    expect(startRes.status).toBe(200);
    expect(startRes.body.total).toBe(25);
    const jobId = startRes.body.jobId as string;
    expect(jobId).toBeTruthy();

    await batchJobService.waitForJob(jobId);

    const jobRes = await request(batchApp).get(`/api/jobs/${jobId}`);
    expect(jobRes.status).toBe(200);
    expect(jobRes.body.status).toBe('completed');
    expect(jobRes.body.total).toBe(25);
    expect(jobRes.body.done).toBe(25);
    expect(jobRes.body.accepted).toBe(21);
    expect(jobRes.body.rejected).toBe(3);
    expect(jobRes.body.error).toBe(1);
    expect(jobRes.body.pending).toBe(0);
    expect(jobRes.body.items).toHaveLength(25);

    // Kiểm tra trạng thái trong DB: 0 giấy kẹt ở sending
    const counts = await repos.certificates.countByStatus();
    expect(counts.all).toBe(25);
    expect(counts.accepted).toBe(21);
    expect(counts.rejected).toBe(3);
    expect(counts.error).toBe(1);
    expect(counts.sending).toBe(0);

    // Kiểm tra 3 giấy bị từ chối đều lưu errors_json
    for (const rejId of rejectedCertIds) {
      const sub = await repos.submissions.findLatestByCertificateId(rejId);
      expect(sub?.resultStatus).toBe('rejected');
      expect(sub?.errors).toEqual([
        { code: 'GKSK_FACILITY_MISMATCH', field: 'IDBENHVIEN' },
      ]);
      expect(sub?.errorsJson).toContain('GKSK_FACILITY_MISMATCH');
    }

    // Kiểm tra giấy #25 gặp lỗi mạng tạm thời có attempts = 4 và resultStatus = null
    const errSub = await repos.submissions.findLatestByCertificateId(
      transientErrorCertId,
    );
    expect(errSub?.resultStatus).toBeNull();
    expect(errSub?.attempts).toBe(4);
    expect(errSub?.lastError).toContain('HTTP 500');

    // Kiểm tra spy logger tuyệt đối KHÔNG chứa PII hoặc token/mật khẩu
    const rawLogs = logCollector.getRawOutput();
    expect(rawLogs.length).toBeGreaterThan(0);
    expect(rawLogs).not.toContain('TEST NGUYEN');
    expect(rawLogs).not.toContain('TESTGKSK');
    expect(rawLogs).not.toContain('Ly do nhay cam');
    expect(rawLogs).not.toContain('Tinh trang benh nhay cam');
    expect(rawLogs).not.toContain('0.35');
    expect(rawLogs).not.toContain('Bearer ');
    expect(rawLogs).not.toContain('PHJvb3Q');

    // Giả lập dừng tiến trình khi có giấy đang sending -> recoverOnStartup chuyển về error (TEST-PLAN.md §3.4)
    await repos.certificates.updateStatus(ids[0]!, { status: 'sending' });
    const recoveredCount = await repos.certificates.recoverOnStartup();
    expect(recoveredCount).toBe(1);
    const recoveredCert = await repos.certificates.findById(ids[0]!);
    expect(recoveredCert?.status).toBe('error');
  });

  it('7. Gặp HTTP 429 (Retry-After) trong hàng đợi -> tạm dừng toàn bộ hàng đợi theo Retry-After rồi tiếp tục thành công', async () => {
    let fakeNowMs = Date.parse('2026-11-23T09:00:00.000Z');
    const sleepHistoryMs: number[] = [];

    const { repos, jobService } = createTestStack({
      now: () => fakeNowMs,
      sleep: async (ms: number) => {
        sleepHistoryMs.push(ms);
        fakeNowMs += ms;
      },
    });

    const ids: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const cert = await seedCertificate(repos, {
        SO: `TEST.75001.S9.429.${i}`,
      });
      ids.push(cert.id);
    }

    // Ép Mock Server trả HTTP 429 với Retry-After: 3 giây ở lần gọi push đầu tiên
    await setMockFailure({ mode: '429', count: 1, retryAfterSec: 3 });

    const job = jobService.startBatch(ids);
    const completed = await jobService.waitForJob(job.jobId);

    expect(completed?.status).toBe('completed');
    expect(completed?.accepted).toBe(4);
    expect(completed?.rateLimitCount).toBeGreaterThanOrEqual(1);
    expect(sleepHistoryMs.some((ms) => ms >= 2_500)).toBe(true);
  });

  it('8. Batch 400 giấy với đồng hồ giả -> luôn giữ ≤ 2 request song song và không bao giờ vượt quá 300 gói/phút ở mọi cửa sổ 60 giây', async () => {
    let virtualNowMs = Date.parse('2026-11-23T10:00:00.000Z');
    let activeInFlight = 0;
    let maxObservedConcurrency = 0;

    const repos = createInMemoryRepositories();
    const logCollector = createLogCollector();

    const fakeFetch: typeof fetch = async (input, init) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      if (urlStr.endsWith('/api/auth/login')) {
        return new Response(
          JSON.stringify({
            header: { version: '1.0.6', success: true, res_code: 'CM_SUCCESS' },
            data: { token: 'fake-token-400', duration: 720, refresh_duration: 1440 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      activeInFlight += 1;
      if (activeInFlight > maxObservedConcurrency) {
        maxObservedConcurrency = activeInFlight;
      }

      try {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          header?: { msg_id?: string };
        };
        const msgId = body.header?.msg_id ?? 'msg-unknown';
        return new Response(
          JSON.stringify({
            header: {
              version: '1.0.6',
              res_code: 'PS_SYNC_SUCCESS',
              ref_msg_id: msgId,
            },
            data: {
              status: 'accepted',
              submission_id: `sub-${msgId}`,
              certificate_id: `cert-${msgId}`,
              so: 'TEST.75001.400',
              errors: [],
              warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      } finally {
        activeInFlight -= 1;
      }
    };

    const sleepFn = async (ms: number): Promise<void> => {
      virtualNowMs += ms;
    };

    const gkskClient = createGkskClient({
      baseUrl: 'http://127.0.0.1:4010',
      username: '75001',
      password: 'mock',
      fetchImpl: fakeFetch,
      now: () => virtualNowMs,
      sleep: sleepFn,
      logger: logCollector.logger,
    });

    const sendService = createSendService({
      repos,
      gkskClient,
      facilityId: '75001',
      senderId: '75001',
      today: '2026-11-23',
      now: () => virtualNowMs,
      logger: logCollector.logger,
    });

    const jobService = createJobService({
      sendService,
      maxConcurrency: 2,
      minIntervalMs: 250,
      now: () => virtualNowMs,
      sleep: sleepFn,
      logger: logCollector.logger,
    });

    const ids: number[] = [];
    const baseFields = makeValidRecord({ SO: 'TEST.75001.S9.400.0001' });
    const { dataSha256: baseSha } = computeCertificatePayload(baseFields);

    for (let i = 1; i <= 400; i++) {
      const so = `TEST.75001.S9.400.${String(i).padStart(4, '0')}`;
      const up = await repos.certificates.upsertBySo({
        so,
        fields: { ...baseFields, SO: so },
        dataSha256: baseSha,
        status: 'ready',
      });
      ids.push(up.row.id);
    }

    const started = jobService.startBatch(ids);
    const finished = await jobService.waitForJob(started.jobId);

    expect(finished?.status).toBe('completed');
    expect(finished?.total).toBe(400);
    expect(finished?.done).toBe(400);
    expect(finished?.accepted).toBe(400);
    expect(maxObservedConcurrency).toBeLessThanOrEqual(2);

    const timestamps = jobService.getDispatchTimestamps();
    expect(timestamps).toHaveLength(400);

    // 1. Khoảng cách giữa 2 lần phát lệnh liên tiếp luôn >= 250 ms
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]! - timestamps[i - 1]!).toBeGreaterThanOrEqual(250);
    }

    // 2. Trong mọi cửa sổ trượt 60.000 ms (1 phút), tổng số gói phát đi luôn <= 240 (< 300 gói/phút)
    let maxInAnyOneMinuteWindow = 0;
    let left = 0;
    for (let right = 0; right < timestamps.length; right++) {
      while (timestamps[right]! - timestamps[left]! >= 60_000) {
        left += 1;
      }
      const countInWindow = right - left + 1;
      if (countInWindow > maxInAnyOneMinuteWindow) {
        maxInAnyOneMinuteWindow = countInWindow;
      }
    }

    expect(maxInAnyOneMinuteWindow).toBeLessThanOrEqual(240);
    expect(maxInAnyOneMinuteWindow).toBeLessThan(300);
  });

  it('9. Kiểm tra xử lý lỗi đầu vào (400/404) trên các endpoint routes/send.ts', async () => {
    const { app } = createTestStack();

    const resBadCertId = await request(app).post('/api/certificates/abc/send');
    expect(resBadCertId.status).toBe(400);
    expect(resBadCertId.body.error.code).toBe('INVALID_CERTIFICATE_ID');

    const resNotFoundCert = await request(app).post('/api/certificates/9999/send');
    expect(resNotFoundCert.status).toBe(404);
    expect(resNotFoundCert.body.error.code).toBe('CERTIFICATE_NOT_FOUND');

    const resEmptyBatch = await request(app).post('/api/send').send({ ids: [] });
    expect(resEmptyBatch.status).toBe(400);
    expect(resEmptyBatch.body.error.code).toBe('INVALID_BATCH_IDS');

    const resNotFoundJob = await request(app).get('/api/jobs/non-existent-job-id');
    expect(resNotFoundJob.status).toBe(404);
    expect(resNotFoundJob.body.error.code).toBe('JOB_NOT_FOUND');

    const resBadSubId = await request(app).post('/api/submissions/0/refresh');
    expect(resBadSubId.status).toBe(400);
    expect(resBadSubId.body.error.code).toBe('INVALID_SUBMISSION_ID');

    const resNotFoundSub = await request(app).post('/api/submissions/9999/refresh');
    expect(resNotFoundSub.status).toBe(404);
    expect(resNotFoundSub.body.error.code).toBe('SUBMISSION_NOT_FOUND');
  });
});
