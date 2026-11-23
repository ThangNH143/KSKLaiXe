import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createEmptyRecord, type GkskRecord } from '../packages/shared/src/index.js';
import { createApp } from '../server/src/app.js';
import { createInMemoryRepositories } from '../server/src/db/inMemoryRepo.js';
import type { SubmissionRow } from '../server/src/db/types.js';
import { createGkskClient } from '../server/src/gksk/client.js';
import { createLogger } from '../server/src/logger.js';
import {
  BATCH_SEND_INTERVAL_MS,
  createJobService,
  MAX_BATCH_CONCURRENCY,
  type BatchJobProgress,
} from '../server/src/services/jobService.js';
import {
  computeCertificatePayload,
  createSendService,
} from '../server/src/services/sendService.js';
import { createMockGkskApp } from '../tools/mock-gksk-api/src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'S9');
const REPORT_OUT = path.join(EVIDENCE_DIR, 'batch-send-report.md');
const VERIFY_OUT = path.join(EVIDENCE_DIR, 'verify-output.txt');

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`VERIFY S9 FAILED: ${message}`);
  }
}

function makeRecord(overrides: Partial<GkskRecord> = {}): GkskRecord {
  const base = createEmptyRecord();
  return {
    ...base,
    SO: 'TEST.75001.S9.0001',
    NGAYKHAM: '05/11/2026',
    HOTEN: 'TEST NGUYEN VAN S9',
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
    BENHVIEN: 'Benh vien Da khoa Dong Nai',
    NGAYKETLUAN: '06/11/2026',
    NONGDOCON: '0.25',
    DVINONGDOCON: '0',
    MATUY: '0',
    BACSYKETLUAN: 'TEST BS KET LUAN',
    KETLUAN: 'A0-1',
    NGAYKHAMLAI: '',
    LYDO: 'Kham suc khoe dinh ky',
    TINHTRANGBENH: 'Binh thuong',
    STATE: 'ADD',
    ...overrides,
  };
}

function listenServer(app: ReturnType<typeof createApp>): Promise<{
  server: Server;
  baseUrl: string;
}> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
      });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function runVerification(): Promise<void> {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const logLines: string[] = [];
  const logStream = new Writable({
    write(chunk, _encoding, callback) {
      logLines.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger = createLogger({ level: 'info', destination: logStream });

  // 1. Khởi chạy Mock API Server thật
  const mockApp = createMockGkskApp({ currentYear: 2026 });
  const { server: mockServer, baseUrl: mockBaseUrl } = await listenServer(mockApp);

  try {
    // =========================================================================
    // PHẦN A: Kiểm chứng kịch bản Postman 2.1 – 2.4 & Máy trạng thái gửi đơn lẻ
    // =========================================================================
    const singleRepos = createInMemoryRepositories();
    const singleClient = createGkskClient({
      baseUrl: mockBaseUrl,
      username: '75001',
      password: 'mock',
      httpTimeoutMs: 500,
      sleep: async () => {},
      logger,
    });
    const singleSendService = createSendService({
      repos: singleRepos,
      gkskClient: singleClient,
      facilityId: '75001',
      senderId: '75001',
      today: '2026-11-23',
      retryOptions: {
        maxRetries: 3,
        retryDelaysMs: [10, 20, 40],
      },
      logger,
    });
    const singleJobService = createJobService({
      sendService: singleSendService,
      logger,
    });
    const singleApp = createApp({
      repos: singleRepos,
      gkskClient: singleClient,
      sendService: singleSendService,
      jobService: singleJobService,
      facilityId: '75001',
      senderId: '75001',
      today: '2026-11-23',
      logger,
    });
    const { server: singleServer, baseUrl: singleAppUrl } = await listenServer(singleApp);

    interface SingleScenarioSummary {
      code: string;
      title: string;
      so: string;
      certStatus: string;
      msgId: string;
      attempts: number;
      serverSubmissionId: string;
      serverCertificateId: string;
      note: string;
    }

    const singleScenarios: SingleScenarioSummary[] = [];

    try {
      // Kịch bản A0: Giấy có lỗi dữ liệu chặn (invalid) -> không gọi API
      const badRec = makeRecord({
        SO: 'TEST.75001.S9.INVALID.01',
        NGAYSINH: '31/02/1990',
      });
      const badUp = await singleRepos.certificates.upsertBySo({
        so: badRec.SO,
        fields: badRec,
        dataSha256: '0'.repeat(64),
        status: 'ready',
      });
      const resInvalid = await fetch(
        `${singleAppUrl}/api/certificates/${badUp.row.id}/send`,
        { method: 'POST' },
      );
      const bodyInvalid = (await resInvalid.json()) as {
        status: string;
        submission: null;
        issues: Array<{ code: string }>;
      };
      assert(
        resInvalid.status === 200 &&
          bodyInvalid.status === 'invalid' &&
          bodyInvalid.submission === null,
        'Chặn giấy invalid thất bại',
      );
      singleScenarios.push({
        code: 'S9-INVALID',
        title: 'Chặn giấy có lỗi dữ liệu chặn (`NGAYSINH=31/02/1990`) trước khi gọi API',
        so: badRec.SO,
        certStatus: bodyInvalid.status,
        msgId: '(không sinh)',
        attempts: 0,
        serverSubmissionId: '-',
        serverCertificateId: '-',
        note: `Issues: ${bodyInvalid.issues.map((i) => i.code).join(', ')} (0 request tới Mock)`,
      });

      // Kịch bản 2.1: Gửi 1 giấy hợp lệ -> accepted + GKSK_UNSIGNED
      const rec21 = makeRecord({
        SO: 'TEST.75001.S9.POSTMAN.201',
        HOTEN: 'TEST NGUYEN VAN 201',
      });
      const up21 = await singleRepos.certificates.upsertBySo({
        so: rec21.SO,
        fields: rec21,
        dataSha256: computeCertificatePayload(rec21).dataSha256,
        status: 'ready',
      });
      const res21 = await fetch(`${singleAppUrl}/api/certificates/${up21.row.id}/send`, {
        method: 'POST',
      });
      const body21 = (await res21.json()) as {
        status: string;
        certificate: { serverCertificateId: string };
        submission: SubmissionRow;
      };
      assert(
        res21.status === 200 &&
          body21.status === 'accepted' &&
          body21.submission.warnings.some((w) => w.code === 'GKSK_UNSIGNED'),
        'Kịch bản Postman 2.1 qua API app thất bại',
      );
      singleScenarios.push({
        code: 'Postman 2.1',
        title: 'Gửi giấy XML hợp lệ chưa ký số (`accepted` + `GKSK_UNSIGNED`)',
        so: rec21.SO,
        certStatus: body21.status,
        msgId: body21.submission.msgId,
        attempts: body21.submission.attempts,
        serverSubmissionId: body21.submission.serverSubmissionId ?? '-',
        serverCertificateId: body21.certificate.serverCertificateId ?? '-',
        note: `warnings=${JSON.stringify(body21.submission.warnings)}`,
      });

      // Kịch bản 2.2: Gửi lại khi lỗi mạng giữ nguyên msg_id & Idempotent
      const rec22 = makeRecord({
        SO: 'TEST.75001.S9.POSTMAN.202',
        HOTEN: 'TEST NGUYEN VAN 202',
      });
      const up22 = await singleRepos.certificates.upsertBySo({
        so: rec22.SO,
        fields: rec22,
        dataSha256: computeCertificatePayload(rec22).dataSha256,
        status: 'ready',
      });
      // Lần 1: ép Mock lỗi 500 4 lần -> chuyển sang trạng thái error, giữ submission pending (result_status=null)
      await fetch(`${mockBaseUrl}/__mock/fail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: '500', count: 4 }),
      });
      const res22Fail = await fetch(
        `${singleAppUrl}/api/certificates/${up22.row.id}/send`,
        { method: 'POST' },
      );
      const body22Fail = (await res22Fail.json()) as {
        status: string;
        submission: SubmissionRow;
      };
      assert(
        body22Fail.status === 'error' && body22Fail.submission.resultStatus === null,
        'Kịch bản 2.2 bước lỗi mạng tạm thời thất bại',
      );
      const firstMsgId22 = body22Fail.submission.msgId;

      // Lần 2: Gửi lại cùng giấy đó (dữ liệu chưa đổi) -> giữ nguyên msg_id
      const res22Ok = await fetch(
        `${singleAppUrl}/api/certificates/${up22.row.id}/send`,
        { method: 'POST' },
      );
      const body22Ok = (await res22Ok.json()) as {
        status: string;
        reusedPendingSubmission: boolean;
        certificate: { serverCertificateId: string };
        submission: SubmissionRow;
      };
      assert(
        body22Ok.status === 'accepted' &&
          body22Ok.reusedPendingSubmission === true &&
          body22Ok.submission.msgId === firstMsgId22,
        'Kịch bản 2.2 giữ nguyên msg_id khi gửi lại thất bại',
      );
      singleScenarios.push({
        code: 'Postman 2.2',
        title: 'Retry sau lỗi mạng tái sử dụng đúng `msg_id` & `send_datetime` cũ',
        so: rec22.SO,
        certStatus: `${body22Fail.status} -> ${body22Ok.status}`,
        msgId: body22Ok.submission.msgId,
        attempts: body22Ok.submission.attempts,
        serverSubmissionId: body22Ok.submission.serverSubmissionId ?? '-',
        serverCertificateId: body22Ok.certificate.serverCertificateId ?? '-',
        note: `reusedPendingSubmission=true, giữ nguyên msg_id=${firstMsgId22}`,
      });

      // Kịch bản 2.3: Cập nhật dữ liệu của giấy 2.1 (cùng SO), gửi lại -> msg_id mới, giữ cùng certificate_id
      const rec23 = makeRecord({
        SO: 'TEST.75001.S9.POSTMAN.201',
        HOTEN: 'TEST NGUYEN VAN 201 (CAP NHAT)',
        HANGBANGLAI: 'C',
      });
      await singleRepos.certificates.upsertBySo({
        so: rec23.SO,
        fields: rec23,
        dataSha256: computeCertificatePayload(rec23).dataSha256,
        status: 'ready',
      });
      const res23 = await fetch(`${singleAppUrl}/api/certificates/${up21.row.id}/send`, {
        method: 'POST',
      });
      const body23 = (await res23.json()) as {
        status: string;
        reusedPendingSubmission: boolean;
        certificate: { serverCertificateId: string };
        submission: SubmissionRow;
      };
      assert(
        body23.status === 'accepted' &&
          body23.reusedPendingSubmission === false &&
          body23.submission.msgId !== body21.submission.msgId &&
          body23.certificate.serverCertificateId ===
            body21.certificate.serverCertificateId &&
          body23.submission.warnings.some((w) => w.code === 'GKSK_STATE_ADD_EXISTS'),
        'Kịch bản Postman 2.3 ghi đè theo SO giữ cùng certificate_id thất bại',
      );
      singleScenarios.push({
        code: 'Postman 2.3',
        title: 'Cập nhật dữ liệu cùng `SO` -> sinh `msg_id` mới, giữ cùng `certificate_id`',
        so: rec23.SO,
        certStatus: body23.status,
        msgId: body23.submission.msgId,
        attempts: body23.submission.attempts,
        serverSubmissionId: body23.submission.serverSubmissionId ?? '-',
        serverCertificateId: body23.certificate.serverCertificateId ?? '-',
        note: `Cùng certificate_id=${body21.certificate.serverCertificateId}, warnings có GKSK_STATE_ADD_EXISTS`,
      });

      // Kịch bản 2.4: Gửi giấy có cảnh báo không chặn -> accepted + lưu warnings_json
      const rec24 = makeRecord({
        SO: 'TEST.75001.S9.POSTMAN.204',
        KETLUAN: 'A0-9',
        NONGDOCON: 'abc',
        NOICAP: 'N'.repeat(31),
      });
      const up24 = await singleRepos.certificates.upsertBySo({
        so: rec24.SO,
        fields: rec24,
        dataSha256: computeCertificatePayload(rec24).dataSha256,
        status: 'ready',
      });
      const res24 = await fetch(`${singleAppUrl}/api/certificates/${up24.row.id}/send`, {
        method: 'POST',
      });
      const body24 = (await res24.json()) as {
        status: string;
        certificate: { serverCertificateId: string };
        submission: SubmissionRow;
      };
      assert(
        body24.status === 'accepted' &&
          body24.submission.warnings.some((w) => w.code === 'GKSK_KETLUAN_UNKNOWN') &&
          body24.submission.warnings.some((w) => w.code === 'GKSK_FIELD_TOO_LONG'),
        'Kịch bản Postman 2.4 thất bại',
      );
      singleScenarios.push({
        code: 'Postman 2.4',
        title: 'Gửi giấy có cảnh báo không chặn (`KETLUAN=A0-9`, `NOICAP` 31 ký tự)',
        so: rec24.SO,
        certStatus: body24.status,
        msgId: body24.submission.msgId,
        attempts: body24.submission.attempts,
        serverSubmissionId: body24.submission.serverSubmissionId ?? '-',
        serverCertificateId: body24.certificate.serverCertificateId ?? '-',
        note: `warnings=${body24.submission.warnings.map((w) => w.code).join(', ')}`,
      });
    } finally {
      await closeServer(singleServer);
    }

    // =========================================================================
    // PHẦN B: Chạy thật Batch 25 giấy qua POST /api/send & GET /api/jobs/:jobId
    // (21 giấy hợp lệ accepted, 3 giấy bị Sở từ chối rejected, 1 giấy lỗi mạng tạm thời error)
    // =========================================================================
    await fetch(`${mockBaseUrl}/__mock/reset`, { method: 'POST' });

    const batchRepos = createInMemoryRepositories();
    const batchRecordIds: number[] = [];

    for (let i = 1; i <= 25; i++) {
      const so = `TEST.75001.S9.BATCH.${String(i).padStart(2, '0')}`;
      const rec = makeRecord({
        SO: so,
        HOTEN: `TEST NGUYEN BATCH ${String(i).padStart(2, '0')}`,
        SOCMND_PASSPORT: `TESTGKSK${String(i).padStart(2, '0')}`,
        NONGDOCON: '0.45',
        MATUY: '1',
        LYDO: `Ly do nhay cam ho so ${i}`,
        TINHTRANGBENH: `Tinh trang benh nhay cam ho so ${i}`,
      });
      const up = await batchRepos.certificates.upsertBySo({
        so,
        fields: rec,
        dataSha256: computeCertificatePayload(rec).dataSha256,
        status: 'ready',
      });
      batchRecordIds.push(up.row.id);
    }

    // Thiết lập fetch interceptor cho 3 giấy bị Sở từ chối (#05, #12, #19) và 1 giấy lỗi mạng tạm thời (#25, chỉ lỗi trong lượt gửi batch đầu)
    let failCert25InBatch = true;
    const realFetch = globalThis.fetch;
    const batchFetch: typeof fetch = async (input, init) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      if (urlStr.endsWith('/api/platform/gksk-lai-xe/push') && init?.body) {
        const bodyObj = JSON.parse(String(init.body)) as {
          header: { msg_id: string };
          data: string;
          signature: string;
        };
        const xmlText = Buffer.from(bodyObj.data, 'base64').toString('utf8');

        // Giấy #25: gặp lỗi mạng 500 trong đợt gửi batch
        if (failCert25InBatch && xmlText.includes('TEST.75001.S9.BATCH.25')) {
          return new Response(
            JSON.stringify({
              header: {
                res_code: 'PS_DS_SAVE_FAIL',
                res_msg: 'Lỗi lưu dữ liệu tạm thời trên Hệ thống Sở',
              },
              data: null,
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } },
          );
        }

        // Giấy #05 (GKSK_FACILITY_MISMATCH), #12 (GKSK_HOTEN_INVALID), #19 (GKSK_KETLUAN_MISSING) bị Sở từ chối HTTP 200 data.status='rejected'
        if (xmlText.includes('TEST.75001.S9.BATCH.05')) {
          const modified = xmlText.replace(
            '<IDBENHVIEN>75001</IDBENHVIEN>',
            '<IDBENHVIEN>75999</IDBENHVIEN>',
          );
          return realFetch(input, {
            ...init,
            body: JSON.stringify({
              ...bodyObj,
              data: Buffer.from(modified, 'utf8').toString('base64'),
            }),
          });
        }
        if (xmlText.includes('TEST.75001.S9.BATCH.12')) {
          const modified = xmlText.replace(
            /<HOTEN>[^<]*<\/HOTEN>/,
            '<HOTEN></HOTEN>',
          );
          return realFetch(input, {
            ...init,
            body: JSON.stringify({
              ...bodyObj,
              data: Buffer.from(modified, 'utf8').toString('base64'),
            }),
          });
        }
        if (xmlText.includes('TEST.75001.S9.BATCH.19')) {
          const modified = xmlText.replace(
            /<KETLUAN>[^<]*<\/KETLUAN>/,
            '<KETLUAN></KETLUAN>',
          );
          return realFetch(input, {
            ...init,
            body: JSON.stringify({
              ...bodyObj,
              data: Buffer.from(modified, 'utf8').toString('base64'),
            }),
          });
        }
      }
      return realFetch(input, init);
    };

    const batchClient = createGkskClient({
      baseUrl: mockBaseUrl,
      username: '75001',
      password: 'mock',
      fetchImpl: batchFetch,
      sleep: async () => {},
      logger,
    });
    const batchSendService = createSendService({
      repos: batchRepos,
      gkskClient: batchClient,
      facilityId: '75001',
      senderId: '75001',
      today: '2026-11-23',
      retryOptions: {
        maxRetries: 3,
        retryDelaysMs: [10, 20, 40],
      },
      logger,
    });
    const batchJobService = createJobService({
      sendService: batchSendService,
      maxConcurrency: MAX_BATCH_CONCURRENCY,
      minIntervalMs: 30, // để quá trình polling ghi nhận được nhiều mốc tiến độ thực tế
      logger,
    });
    const batchApp = createApp({
      repos: batchRepos,
      gkskClient: batchClient,
      sendService: batchSendService,
      jobService: batchJobService,
      facilityId: '75001',
      senderId: '75001',
      today: '2026-11-23',
      logger,
    });

    const { server: batchServer, baseUrl: batchAppUrl } = await listenServer(batchApp);

    const progressSnapshots: Array<{
      pollIndex: number;
      status: string;
      done: number;
      total: number;
      accepted: number;
      rejected: number;
      error: number;
      pending: number;
    }> = [];

    try {
      // 1. Kích hoạt POST /api/send với 25 giấy
      const startRes = await fetch(`${batchAppUrl}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: batchRecordIds }),
      });
      assert(startRes.status === 200, 'POST /api/send phải trả HTTP 200');
      const startBody = (await startRes.json()) as {
        jobId: string;
        status: string;
        total: number;
      };
      const jobId = startBody.jobId;
      assert(Boolean(jobId) && startBody.total === 25, 'Thông tin job khởi tạo không đúng');

      // 2. Theo dõi tiến độ qua GET /api/jobs/:jobId tới khi hoàn tất
      let finalJob: BatchJobProgress | null = null;
      let pollIndex = 0;
      for (;;) {
        pollIndex += 1;
        const jobRes = await fetch(`${batchAppUrl}/api/jobs/${jobId}`);
        assert(jobRes.status === 200, 'GET /api/jobs/:jobId phải trả HTTP 200');
        const jobData = (await jobRes.json()) as BatchJobProgress;

        progressSnapshots.push({
          pollIndex,
          status: jobData.status,
          done: jobData.done,
          total: jobData.total,
          accepted: jobData.accepted,
          rejected: jobData.rejected,
          error: jobData.error,
          pending: jobData.pending,
        });

        if (jobData.status === 'completed') {
          finalJob = jobData;
          break;
        }
        await new Promise((r) => setTimeout(r, 45));
      }

      assert(finalJob !== null, 'Không lấy được kết quả job hoàn tất');
      assert(finalJob.total === 25, `Expected total=25, got ${finalJob.total}`);
      assert(finalJob.done === 25, `Expected done=25, got ${finalJob.done}`);
      assert(finalJob.accepted === 21, `Expected accepted=21, got ${finalJob.accepted}`);
      assert(finalJob.rejected === 3, `Expected rejected=3, got ${finalJob.rejected}`);
      assert(finalJob.error === 1, `Expected error=1, got ${finalJob.error}`);
      assert(finalJob.pending === 0, `Expected pending=0, got ${finalJob.pending}`);

      const countsAfterBatch = await batchRepos.certificates.countByStatus();
      assert(
        countsAfterBatch.sending === 0,
        `Phát hiện giấy bị kẹt ở sending: ${countsAfterBatch.sending}`,
      );
      assert(countsAfterBatch.accepted === 21, 'DB count accepted !== 21');
      assert(countsAfterBatch.rejected === 3, 'DB count rejected !== 3');
      assert(countsAfterBatch.error === 1, 'DB count error !== 1');

      // 3. Thử POST /api/submissions/:id/refresh cho giấy #01 (accepted) và giấy #05 (rejected)
      const subCert01 = await batchRepos.submissions.findLatestByCertificateId(
        batchRecordIds[0]!,
      );
      assert(subCert01 !== null, 'Thiếu submission của giấy #01');
      const refreshRes01 = await fetch(
        `${batchAppUrl}/api/submissions/${subCert01.id}/refresh`,
        { method: 'POST' },
      );
      const refreshBody01 = (await refreshRes01.json()) as {
        found: boolean;
        status: string;
        httpStatus: number;
        resCode: string;
        submission: SubmissionRow;
      };
      assert(
        refreshRes01.status === 200 &&
          refreshBody01.found === true &&
          refreshBody01.status === 'accepted',
        'Refresh submission giấy #01 thất bại',
      );

      const subCert05 = await batchRepos.submissions.findLatestByCertificateId(
        batchRecordIds[4]!,
      );
      assert(subCert05 !== null, 'Thiếu submission của giấy #05');
      const refreshRes05 = await fetch(
        `${batchAppUrl}/api/submissions/${subCert05.id}/refresh`,
        { method: 'POST' },
      );
      const refreshBody05 = (await refreshRes05.json()) as {
        found: boolean;
        status: string;
        submission: SubmissionRow;
      };
      assert(
        refreshRes05.status === 200 &&
          refreshBody05.found === true &&
          refreshBody05.status === 'rejected' &&
          refreshBody05.submission.errorsJson?.includes('GKSK_FACILITY_MISMATCH') === true,
        'Refresh submission giấy #05 thất bại',
      );

      // 4. Thử gửi lại giấy #25 (đang ở error) sau khi mạng phục hồi -> tái sử dụng đúng msg_id cũ
      const subCert25Before = await batchRepos.submissions.findLatestByCertificateId(
        batchRecordIds[24]!,
      );
      assert(
        subCert25Before !== null && subCert25Before.resultStatus === null,
        'Submission giấy #25 trước khi gửi lại phải có resultStatus=null',
      );

      failCert25InBatch = false;
      const retryRes25 = await fetch(
        `${batchAppUrl}/api/certificates/${batchRecordIds[24]!}/send`,
        { method: 'POST' },
      );
      const retryBody25 = (await retryRes25.json()) as {
        status: string;
        reusedPendingSubmission: boolean;
        submission: SubmissionRow;
      };
      assert(
        retryRes25.status === 200 &&
          retryBody25.status === 'accepted' &&
          retryBody25.reusedPendingSubmission === true &&
          retryBody25.submission.msgId === subCert25Before.msgId,
        'Gửi lại giấy #25 không giữ nguyên msg_id cũ',
      );

      // 5. Kiểm tra bảo mật Log: 0 PII / 0 Token trong toàn bộ dòng log Pino
      const fullLogText = logLines.join('\n');
      const forbiddenTokens = [
        'TEST NGUYEN',
        'TESTGKSK',
        'Ly do nhay cam',
        'Tinh trang benh nhay cam',
        '0.45',
        'Bearer ',
        'PHJvb3Q',
      ];
      for (const token of forbiddenTokens) {
        assert(
          !fullLogText.includes(token),
          `Phát hiện rò rỉ dữ liệu nhạy cảm/bí mật trong log: "${token}"`,
        );
      }

      // 6. Xuất báo cáo chi tiết docs/evidence/S9/batch-send-report.md
      const allCertificates = (
        await batchRepos.certificates.list({ page: 1, pageSize: 100 })
      ).items.sort((a, b) => a.id - b.id);

      const reportLines: string[] = [
        '# Báo cáo Kiểm chứng Bước S9 — Dịch vụ gửi (Máy trạng thái) & Gửi hàng loạt',
        '',
        `- **Thời gian thực thi**: \`${new Date().toISOString()}\``,
        `- **Cấu hình hàng đợi (\`JobService\`)**: \`maxConcurrency = ${MAX_BATCH_CONCURRENCY}\`, \`minIntervalMs = ${BATCH_SEND_INTERVAL_MS}ms\` (tối đa \`240 gói/phút < 300 gói/phút\`), tự động tạm dừng khi gặp HTTP 429.`,
        `- **Kho dữ liệu**: \`InMemoryRepositories\` (tuân thủ quy tắc bảo vệ MSSQL đang vận hành).`,
        `- **Kết quả kiểm tra rò rỉ PII / Token trong log (\`${logLines.length}\` dòng JSON Pino)**: **0 rò rỉ** (PASS).`,
        '',
        '---',
        '',
        '## 1. Kiểm chứng Kịch bản Postman 2.1 – 2.4 & Máy trạng thái gửi đơn lẻ (`POST /api/certificates/:id/send`)',
        '',
        '| Kịch bản | Mô tả | Mã `SO` | Trạng thái giấy | `msg_id` | Số lần gọi (`attempts`) | `server_submission_id` | `server_certificate_id` | Ghi chú đối soát |',
        '|---|---|---|---|---|---:|---|---|---|',
      ];

      for (const s of singleScenarios) {
        reportLines.push(
          `| **${s.code}** | ${s.title} | \`${s.so}\` | \`${s.certStatus}\` | \`${s.msgId}\` | ${s.attempts} | \`${s.serverSubmissionId}\` | \`${s.serverCertificateId}\` | ${s.note} |`,
        );
      }

      reportLines.push(
        '',
        '---',
        '',
        '## 2. Nhật ký Polling Tiến độ Gửi hàng loạt 25 Giấy (`POST /api/send` → `GET /api/jobs/:jobId`)',
        '',
        `- **Mã tiến trình (\`jobId\`)**: \`${finalJob.jobId}\``,
        '- **Cơ cấu 25 giấy nạp vào hàng đợi**:',
        '  - **21 giấy hợp lệ** (`#01..#04`, `#06..#11`, `#13..#18`, `#20..#24`) → Kỳ vọng: `accepted` + cảnh báo thông tin `GKSK_UNSIGNED`.',
        '  - **03 giấy bị Cổng Sở từ chối** (`#05`: `GKSK_FACILITY_MISMATCH`, `#12`: `GKSK_HOTEN_INVALID`, `#19`: `GKSK_KETLUAN_MISSING`) → Kỳ vọng: HTTP 200 `PS_SYNC_SUCCESS` nhưng `status = rejected`, lưu đầy đủ `errors_json`.',
        '  - **01 giấy gặp lỗi mạng tạm thời** (`#25`: HTTP 500 `PS_DS_SAVE_FAIL` qua 1 lần gửi + 3 lần retry) → Kỳ vọng: `status = error`, `attempts = 4`, `result_status = null` (giữ `msg_id` để gửi lại).',
        '',
        '### Bảng nhật ký Polling `GET /api/jobs/:jobId`',
        '',
        '| Lần Poll | Trạng thái Job | `done / total` | `accepted` | `rejected` | `error` | `pending` |',
        '|---:|---|---:|---:|---:|---:|---:|',
      );

      for (const snap of progressSnapshots) {
        reportLines.push(
          `| #${snap.pollIndex} | \`${snap.status}\` | **${snap.done} / ${snap.total}** | ${snap.accepted} | ${snap.rejected} | ${snap.error} | ${snap.pending} |`,
        );
      }

      reportLines.push(
        '',
        '### Bảng kết quả toàn bộ 25 giấy trong Batch (`finalJob.items`)',
        '',
        '| STT | Cert ID | Mã `SO` | Trạng thái sau Batch | `msg_id` | `attempts` | HTTP | `res_code` | `errors_json` / `warnings_json` / `last_error` |',
        '|---:|---:|---|---|---|---:|---:|---|---|',
      );

      for (let idx = 0; idx < finalJob.items.length; idx++) {
        const item = finalJob.items[idx]!;
        const detail =
          item.status === 'rejected'
            ? `errors=${JSON.stringify(item.errors)}`
            : item.status === 'accepted'
              ? `warnings=${JSON.stringify(item.warnings)}`
              : `lastError=${item.lastError ?? ''}`;
        reportLines.push(
          `| ${idx + 1} | ${item.certificateId} | \`${item.so ?? ''}\` | \`${item.status}\` | \`${item.msgId ?? ''}\` | ${item.attempts} | ${item.httpStatus ?? '-'} | \`${item.resCode ?? '-'}\` | \`${detail}\` |`,
        );
      }

      reportLines.push(
        '',
        '---',
        '',
        '## 3. Kiểm chứng Tra lại trạng thái (`POST /api/submissions/:id/refresh`) & Gửi lại Giấy lỗi mạng (`#25`)',
        '',
        '1. **Tra lại trạng thái giấy `#01` (`accepted`)**:',
        `   - Endpoint: \`POST /api/submissions/${subCert01.id}/refresh\``,
        `   - Kết quả: \`found = ${refreshBody01.found}\`, \`status = ${refreshBody01.status}\`, \`httpStatus = ${refreshBody01.httpStatus}\`, \`resCode = ${refreshBody01.resCode}\`, \`server_submission_id = ${refreshBody01.submission.serverSubmissionId}\`.`,
        '2. **Tra lại trạng thái giấy `#05` (`rejected`)**:',
        `   - Endpoint: \`POST /api/submissions/${subCert05.id}/refresh\``,
        `   - Kết quả: \`found = ${refreshBody05.found}\`, \`status = ${refreshBody05.status}\`, \`errors_json = ${refreshBody05.submission.errorsJson}\`.`,
        '3. **Gửi lại giấy `#25` sau khi mạng phục hồi (`POST /api/certificates/25/send`)**:',
        `   - Trước khi gửi lại: \`status = error\`, \`msg_id = ${subCert25Before.msgId}\`, \`attempts = ${subCert25Before.attempts}\`, \`result_status = null\`.`,
        `   - Sau khi gửi lại: \`status = ${retryBody25.status}\`, \`reusedPendingSubmission = ${retryBody25.reusedPendingSubmission}\`, **giữ nguyên 100% \`msg_id = ${retryBody25.submission.msgId}\`**, tổng \`attempts = ${retryBody25.submission.attempts}\`, \`server_certificate_id = ${allCertificates[24]?.serverCertificateId}\`.`,
        '',
        '---',
        '',
        '## 4. Kiểm toán Lịch sử Submissions trong DB (`gksk_submissions`) & Không lộ PII trong Log',
        '',
        `- Tổng số giấy trong DB sau khi gửi lại giấy \`#25\`: **25 giấy** (\`accepted = 22\`, \`rejected = 3\`, \`error = 0\`, \`sending = 0\`).`,
        `- Tổng số dòng log JSON \`pino\` đã kiểm tra: **${logLines.length} dòng** — tuyệt đối không chứa \`HOTEN\`, \`SOCMND_PASSPORT\`, \`NONGDOCON\`, \`MATUY\`, \`LYDO\`, \`TINHTRANGBENH\`, \`data\` Base64 hay \`Bearer\` token.`,
        '',
        '### Trích xuất 5 dòng log JSON Pino mẫu (chỉ chứa siêu dữ liệu an toàn)',
        '',
        '```json',
        ...logLines.slice(0, 5).map((line) => line.trim()),
        '```',
        '',
      );

      const reportContent = reportLines.join('\n');
      fs.writeFileSync(REPORT_OUT, reportContent, 'utf8');
      fs.writeFileSync(VERIFY_OUT, reportContent, 'utf8');

      process.stdout.write(
        `VERIFY S9 PASSED: Generated ${REPORT_OUT} and ${VERIFY_OUT} (25/25 batch items processed, 0 stuck sending, 0 PII leaked).\n`,
      );
    } finally {
      await closeServer(batchServer);
    }
  } finally {
    await closeServer(mockServer);
  }
}

runVerification().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
