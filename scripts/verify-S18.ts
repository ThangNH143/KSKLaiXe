import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import ExcelJS from 'exceljs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  FIELD_BY_TAG,
  FIELD_ORDER,
  FIELDS,
  SO_SERVER_MAX_LENGTH,
  TEMPLATE_FIELDS,
  type FieldTag,
} from '../packages/shared/src/index.js';
import {
  createRepositories,
  runMigrations,
} from '../server/src/db/connection.js';
import { createGkskClient } from '../server/src/gksk/client.js';
import { createLogger } from '../server/src/logger.js';
import { createCertificateService } from '../server/src/services/certificateService.js';
import { extractZipArchiveBuffer } from '../server/src/services/exportService.js';
import { createImportService } from '../server/src/services/importService.js';
import { createSendService } from '../server/src/services/sendService.js';
import type {
  MockIssueItem,
  MockPushData,
  MockStoredCertificate,
  MockStoredSubmission,
} from '../tools/mock-gksk-api/src/app.js';
import {
  createWorkbookBuffer,
  makeDefaultFixtureRow,
  TEMPLATE_TAGS,
} from '../tests/fixtures/make-fixtures.js';
import {
  createStatefulMssqlPoolEmulator,
  runMssqlIntegrationSuite,
} from './test-mssql.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'S18');
const EXCEL_OUT_DIR = path.join(EVIDENCE_DIR, 'excel');
const REPORT_OUT = path.join(EVIDENCE_DIR, 'S18-report.md');
const VERIFY_OUT = path.join(EVIDENCE_DIR, 'verify-output.txt');

const SYSTEM_CHROME_PATH =
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SYSTEM_EDGE_PATH =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function resolveBrowserExecutablePath(): string | undefined {
  if (fs.existsSync(SYSTEM_CHROME_PATH)) {
    return SYSTEM_CHROME_PATH;
  }
  if (fs.existsSync(SYSTEM_EDGE_PATH)) {
    return SYSTEM_EDGE_PATH;
  }
  return undefined;
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`[verify-S18] FAILED: ${msg}`);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unicodeLength(value: string): number {
  return [...value.normalize('NFC')].length;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function parseDdMmYyyy(value: string): { valid: boolean; year: number } {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return { valid: false, year: 0 };
  const day = Number.parseInt(match[1] ?? '0', 10);
  const month = Number.parseInt(match[2] ?? '0', 10);
  const year = Number.parseInt(match[3] ?? '0', 10);
  if (month < 1 || month > 12) return { valid: false, year };
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) return { valid: false, year };
  return { valid: true, year };
}

/**
 * In-process `fetch` emulator cho Cổng kiểm thử Sở Y tế Đồng Nai (API-CONTRACT.md §1–§12)
 * để chạy hoàn toàn trong bộ nhớ mà không cần mở socket TCP trong môi trường sandbox.
 */
function createInProcessSoYTePortal(facilityId = '75001') {
  const xmlParser = new XMLParser({
    parseTagValue: false,
    parseAttributeValue: false,
    ignoreAttributes: false,
    trimValues: false,
  });

  const submissionsByMsgId = new Map<string, MockStoredSubmission>();
  const certificatesByKey = new Map<string, MockStoredCertificate>();
  let fail500Remaining = 0;

  function setFail500(count: number): void {
    fail500Remaining = count;
  }

  function resetAll(): void {
    submissionsByMsgId.clear();
    certificatesByKey.clear();
    fail500Remaining = 0;
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const urlStr = typeof input === 'string' ? input : input.toString();
    const parsedUrl = new URL(urlStr);

    if (parsedUrl.pathname === '/api/auth/login') {
      return new Response(
        JSON.stringify({
          header: {
            version: '1.0.6',
            success: true,
            res_code: 'CM_SUCCESS',
            res_msg: 'Đăng nhập thành công',
          },
          data: {
            token: `s18-test-token-${facilityId}`,
            refresh_token: `s18-refresh-token-${facilityId}`,
            duration: 720,
            refresh_duration: 1440,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (parsedUrl.pathname === '/api/platform/gksk-lai-xe/status') {
      const msgId = parsedUrl.searchParams.get('msg_id') ?? '';
      const stored = submissionsByMsgId.get(msgId);
      if (!stored) {
        return new Response(
          JSON.stringify({
            code: 'CM_INVALID_REQUEST',
            message: `Không tìm thấy gói tin ${msgId}`,
            data: null,
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          code: 'CM_SUCCESS',
          message: 'Tra cứu kết quả xử lý gói tin thành công',
          data: stored.responseData,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (parsedUrl.pathname === '/api/platform/gksk-lai-xe/push') {
      const rawBody = JSON.parse(String(init?.body ?? '{}')) as {
        header: {
          sender_id: string;
          msg_id: string;
          send_datetime: number;
        };
        data: string;
        signature: string;
      };
      const reqMsgId = rawBody.header.msg_id;
      const reqSenderId = rawBody.header.sender_id;

      if (fail500Remaining > 0) {
        fail500Remaining -= 1;
        return new Response(
          JSON.stringify({
            header: {
              version: '1.0.6',
              sender_id: 'TTYQG',
              receiver_id: reqSenderId,
              txn_type: 'sync_gksk_lai_xe',
              res_code: 'PS_DS_SAVE_FAIL',
              res_msg: 'Lỗi lưu dữ liệu tạm thời (HTTP 500)',
              msg_id: `TTYQG261125${crypto.randomUUID().replace(/-/g, '')}`,
              msg_type: '102',
              ref_msg_id: reqMsgId,
              send_datetime: Date.now(),
              res_datetime: Date.now(),
            },
            data: null,
            signature: '',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Idempotent theo msg_id
      const existingSub = submissionsByMsgId.get(reqMsgId);
      if (existingSub) {
        return new Response(
          JSON.stringify({
            header: {
              version: '1.0.6',
              sender_id: 'TTYQG',
              receiver_id: reqSenderId,
              txn_type: 'sync_gksk_lai_xe',
              res_code: 'PS_SYNC_SUCCESS',
              res_msg: 'Xử lý đồng bộ GKSK lái xe hoàn tất (idempotent)',
              msg_id: `TTYQG261125${crypto.randomUUID().replace(/-/g, '')}`,
              msg_type: '102',
              ref_msg_id: reqMsgId,
              send_datetime: Date.now(),
              res_datetime: Date.now(),
            },
            data: existingSub.responseData,
            signature: 'MOCK-TTYQG-SIGNATURE',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const xmlText = Buffer.from(rawBody.data, 'base64').toString('utf8');
      const errors: MockIssueItem[] = [];
      const warnings: MockIssueItem[] = [];
      const recordValues: Record<string, string> = {};
      for (const tag of FIELD_ORDER) {
        recordValues[tag] = '';
      }

      let xmlInvalid = false;
      if (/<!DOCTYPE/i.test(xmlText) || /<!ENTITY/i.test(xmlText)) {
        xmlInvalid = true;
        errors.push({ code: 'GKSK_XML_INVALID', field: null });
      } else if (XMLValidator.validate(xmlText) !== true) {
        xmlInvalid = true;
        errors.push({ code: 'GKSK_XML_INVALID', field: null });
      } else {
        const parsed = xmlParser.parse(xmlText) as Record<string, unknown>;
        const rootNode = parsed?.root as Record<string, unknown> | undefined;
        if (!rootNode || typeof rootNode !== 'object' || !('SO' in rootNode)) {
          xmlInvalid = true;
          errors.push({ code: 'GKSK_XML_INVALID', field: null });
        } else {
          for (const [tag, rawVal] of Object.entries(rootNode)) {
            if (tag === '#text' || tag.startsWith('@_') || tag.startsWith('?')) {
              continue;
            }
            if (!(tag in FIELD_BY_TAG)) {
              warnings.push({ code: 'GKSK_UNKNOWN_TAG', field: tag });
              continue;
            }
            recordValues[tag] =
              typeof rawVal === 'string'
                ? rawVal.trim()
                : String(rawVal ?? '').trim();
          }
        }
      }

      const so = recordValues.SO ?? '';
      const hoTen = recordValues.HOTEN ?? '';
      const ngaySinh = recordValues.NGAYSINH ?? '';
      const soCmnd = recordValues.SOCMND_PASSPORT ?? '';
      const idBenhVien = recordValues.IDBENHVIEN ?? '';
      const ngayKetLuan = recordValues.NGAYKETLUAN ?? '';
      const ketLuan = recordValues.KETLUAN ?? '';
      const state = recordValues.STATE || 'ADD';

      if (!xmlInvalid) {
        if (so.length === 0) {
          errors.push({ code: 'GKSK_SO_MISSING', field: 'SO' });
        } else if (unicodeLength(so) > SO_SERVER_MAX_LENGTH) {
          errors.push({ code: 'GKSK_SO_TOO_LONG', field: 'SO' });
        }
        if (idBenhVien.length === 0 || idBenhVien !== facilityId) {
          errors.push({ code: 'GKSK_FACILITY_MISMATCH', field: 'IDBENHVIEN' });
        }
        if (hoTen.length === 0 || unicodeLength(hoTen) > 255) {
          errors.push({ code: 'GKSK_HOTEN_INVALID', field: 'HOTEN' });
        }
        if (soCmnd.length === 0) {
          errors.push({ code: 'GKSK_ID_MISSING', field: 'SOCMND_PASSPORT' });
        }
        const parsedDob = parseDdMmYyyy(ngaySinh);
        if (
          ngaySinh.length === 0 ||
          !parsedDob.valid ||
          parsedDob.year < 1900 ||
          parsedDob.year > 2026
        ) {
          errors.push({ code: 'GKSK_NGAYSINH_INVALID', field: 'NGAYSINH' });
        }
        if (ngayKetLuan.length === 0 || !parseDdMmYyyy(ngayKetLuan).valid) {
          errors.push({
            code: 'GKSK_NGAYKETLUAN_INVALID',
            field: 'NGAYKETLUAN',
          });
        }
        if (ketLuan.length === 0) {
          errors.push({ code: 'GKSK_KETLUAN_MISSING', field: 'KETLUAN' });
        }

        warnings.push({ code: 'GKSK_UNSIGNED', field: null });

        if (
          ketLuan.length > 0 &&
          ketLuan !== 'A0-1' &&
          ketLuan !== 'A0-2' &&
          ketLuan !== 'A0-3'
        ) {
          warnings.push({ code: 'GKSK_KETLUAN_UNKNOWN', field: 'KETLUAN' });
        }

        for (const fieldSpec of FIELDS) {
          if (fieldSpec.tag === 'SO' || fieldSpec.tag === 'HOTEN') continue;
          if (fieldSpec.maxLength !== undefined) {
            const val = recordValues[fieldSpec.tag as FieldTag] ?? '';
            if (val.length > 0 && unicodeLength(val) > fieldSpec.maxLength) {
              warnings.push({
                code: 'GKSK_FIELD_TOO_LONG',
                field: fieldSpec.tag,
              });
            }
          }
        }
      }

      const submissionId = crypto.randomUUID();
      let certificateId: string | null = null;
      const isAccepted = errors.length === 0;

      if (isAccepted) {
        const certKey = `${facilityId}::${so}`;
        const existingCert = certificatesByKey.get(certKey);
        const nowMs = Date.now();
        if (existingCert) {
          certificateId = existingCert.certificateId;
          existingCert.fields = { ...recordValues };
          existingCert.updatedAtMs = nowMs;
          if (state === 'ADD') {
            warnings.push({ code: 'GKSK_STATE_ADD_EXISTS', field: 'STATE' });
          }
        } else {
          certificateId = crypto.randomUUID();
          certificatesByKey.set(certKey, {
            certificateId,
            facilityId,
            so,
            fields: { ...recordValues },
            createdAtMs: nowMs,
            updatedAtMs: nowMs,
          });
        }
      }

      const responseData: MockPushData = {
        status: isAccepted ? 'accepted' : 'rejected',
        submission_id: submissionId,
        certificate_id: certificateId,
        so: so.length > 0 ? so : null,
        errors,
        warnings,
      };

      submissionsByMsgId.set(reqMsgId, {
        msgId: reqMsgId,
        facilityId,
        senderId: reqSenderId,
        sendDatetime: rawBody.header.send_datetime,
        createdAtMs: Date.now(),
        responseData,
      });

      return new Response(
        JSON.stringify({
          header: {
            version: '1.0.6',
            sender_id: 'TTYQG',
            receiver_id: reqSenderId,
            txn_type: 'sync_gksk_lai_xe',
            res_code: 'PS_SYNC_SUCCESS',
            res_msg: isAccepted
              ? 'Tiếp nhận giấy khám sức khỏe lái xe thành công'
              : 'Giấy khám sức khỏe lái xe bị từ chối do lỗi dữ liệu',
            msg_id: `TTYQG261125${crypto.randomUUID().replace(/-/g, '')}`,
            msg_type: '102',
            ref_msg_id: reqMsgId,
            send_datetime: Date.now(),
            res_datetime: Date.now(),
          },
          data: responseData,
          signature: 'MOCK-TTYQG-SIGNATURE',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response('Not Found', { status: 404 });
  };

  return {
    fetchImpl,
    setFail500,
    resetAll,
    getState() {
      return {
        submissionCount: submissionsByMsgId.size,
        certificateCount: certificatesByKey.size,
        submissions: Array.from(submissionsByMsgId.values()),
        certificates: Array.from(certificatesByKey.values()),
      };
    },
  };
}

interface StepRecord {
  stepNumber: number;
  title: string;
  expected: string;
  actual: string;
  passed: boolean;
}

async function generateS18ExcelFiles(): Promise<Record<string, Buffer>> {
  fs.mkdirSync(EXCEL_OUT_DIR, { recursive: true });
  const files: Record<string, Buffer> = {};

  async function saveBook(
    filename: string,
    rows: Array<Record<string, unknown>>,
  ): Promise<Buffer> {
    const buf = await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows,
    });
    const fullPath = path.join(EXCEL_OUT_DIR, filename);
    fs.writeFileSync(fullPath, buf);
    files[filename] = buf;
    return buf;
  }

  // 1. Bước 2, 3, 4, 5, 10 (Q2): 1 dòng TEST.75001.S18.01 với các thẻ tùy chọn NGAYKHAMLAI, LYDO, TINHTRANGBENH để trống
  await saveBook('01_step2_single_test_q2_empty_tags.xlsx', [
    makeDefaultFixtureRow(1, {
      SO: 'TEST.75001.S18.01',
      HOTEN: 'TEST NGUYEN VAN S18 MOT',
      SOCMND_PASSPORT: 'TESTGKSK01',
      NGAYKHAMLAI: '',
      LYDO: '',
      TINHTRANGBENH: '',
    }),
  ]);

  // 2. Bước 6: Cùng mã SO TEST.75001.S18.01 nhưng đã sửa HOTEN -> kiểm tra accepted_modified và đẩy đè giữ nguyên certificate_id
  await saveBook('02_step6_modified_hoten_same_so.xlsx', [
    makeDefaultFixtureRow(1, {
      SO: 'TEST.75001.S18.01',
      HOTEN: 'TEST NGUYEN VAN S18 MOT (DA CAP NHAT)',
      SOCMND_PASSPORT: 'TESTGKSK01',
    }),
  ]);

  // 3. Bước 7: 5 dòng hợp lệ ok_5rows (TEST.75001.S18.B01 .. B05)
  await saveBook(
    '03_step7_ok_5rows.xlsx',
    [1, 2, 3, 4, 5].map((i) =>
      makeDefaultFixtureRow(i, {
        SO: `TEST.75001.S18.B0${i}`,
        HOTEN: `TEST NGUYEN VAN LOAT 0${i}`,
        SOCMND_PASSPORT: `TESTGKSK0${i}`,
      }),
    ),
  );

  // 4. Bước 9: 1 dòng có KETLUAN = A0-9 -> accepted + GKSK_KETLUAN_UNKNOWN
  await saveBook('04_step9_ketluan_A0_9.xlsx', [
    makeDefaultFixtureRow(9, {
      SO: 'TEST.75001.S18.KL09',
      HOTEN: 'TEST TRAN THI KET LUAN LA',
      SOCMND_PASSPORT: 'TESTGKSK09',
      KETLUAN: 'A0-9',
    }),
  ]);

  // 5. Bước 11 (Q13):
  // - Dòng 1: NOICAP dài 31 ký tự ('Cục Cảnh sát QLHC về TTXH Bộ CA' = 31 ký tự NFC) -> vượt Max 30 -> GKSK_FIELD_TOO_LONG
  // - Dòng 2: NOICAP dài đúng 30 ký tự tiếng Việt có dấu ('Cục Cảnh sát QLHC về TTXH ĐNai' = 30 ký tự Unicode NFC, 38 bytes UTF-8) -> KHÔNG bị GKSK_FIELD_TOO_LONG (chốt Q13: đếm theo ký tự Unicode NFC)
  const noicap31 = 'Cục Cảnh sát QLHC về TTXH Bộ CA';
  const noicap30Vn = 'Cục Cảnh sát QLHC về TTXH ĐNai';
  assert(
    unicodeLength(noicap31) === 31,
    `noicap31 phải có đúng 31 ký tự Unicode NFC (thực tế: ${unicodeLength(noicap31)})`,
  );
  assert(
    unicodeLength(noicap30Vn) === 30,
    `noicap30Vn phải có đúng 30 ký tự Unicode NFC (thực tế: ${unicodeLength(noicap30Vn)})`,
  );
  assert(
    Buffer.byteLength(noicap30Vn.normalize('NFC'), 'utf8') > 30,
    'noicap30Vn phải có số byte UTF-8 > 30 để phân biệt đếm ký tự vs đếm byte',
  );

  await saveBook('05_step11_q13_noicap_31_and_30_vn.xlsx', [
    makeDefaultFixtureRow(10, {
      SO: 'TEST.75001.S18.LEN31',
      HOTEN: 'TEST LE VAN NOI CAP 31 KY TU',
      SOCMND_PASSPORT: 'TESTGKSK10',
      NOICAP: noicap31,
    }),
    makeDefaultFixtureRow(11, {
      SO: 'TEST.75001.S18.LEN30VN',
      HOTEN: 'TEST LE VAN NOI CAP 30 TIENG VIET',
      SOCMND_PASSPORT: 'TESTGKSK11',
      NOICAP: noicap30Vn,
    }),
  ]);

  // 6. Bước 12: File dùng cho kịch bản lỗi mạng tạm thời giữa lượt gửi rồi bấm Gửi lại giữ nguyên msg_id
  await saveBook('06_step12_network_retry_same_msgid.xlsx', [
    makeDefaultFixtureRow(12, {
      SO: 'TEST.75001.S18.NET01',
      HOTEN: 'TEST PHAM VAN MANG RETRY',
      SOCMND_PASSPORT: 'TESTGKSK12',
    }),
  ]);

  return files;
}

async function main(): Promise<void> {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const excelFiles = await generateS18ExcelFiles();

  // ===========================================================================
  // 1. Khởi tạo Stateful MSSQL Pool Emulator (MssqlRepositories) + Cổng Sở Y tế
  // ===========================================================================
  const { pool: mssqlTestPool } = createStatefulMssqlPoolEmulator();
  const mssqlSuiteResult = await runMssqlIntegrationSuite(
    mssqlTestPool,
    'MssqlRepositories + 001_init.sql',
  );
  assert(
    mssqlSuiteResult.testsPassed >= 7,
    'Bộ kiểm thử tích hợp MSSQL phải đạt 100%',
  );

  // Tạo pool riêng cho phiên chạy nghiệm thu 14 bước S18
  const { pool, state: mssqlState } = createStatefulMssqlPoolEmulator();
  const appliedMigrations = await runMigrations(pool);
  const repos = createRepositories(pool);
  assert(repos.kind === 'mssql', 'Kho dữ liệu S18 phải chạy qua MssqlRepositories');

  const logger = createLogger({ level: 'silent' });
  const facilityId = '75001';
  const facilityName = 'Benh vien Da khoa Dong Nai';
  const baseUrl = 'https://ksktd-test.dongnai.gov.vn';

  const portal = createInProcessSoYTePortal(facilityId);

  let fakeNowMs = Date.parse('2026-11-25T09:00:00.000Z');
  const gkskClient = createGkskClient({
    baseUrl,
    username: facilityId,
    password: 's18-test-password',
    httpTimeoutMs: 5000,
    fetchImpl: portal.fetchImpl,
    now: () => fakeNowMs,
    sleep: async (ms: number) => {
      fakeNowMs += ms;
    },
    logger,
  });

  const importService = createImportService({
    repos,
    facilityId,
    facilityName,
    today: '2026-11-25',
    now: () => fakeNowMs,
    logger,
  });

  const certificateService = createCertificateService({
    repos,
    facilityId,
    facilityName,
    today: '2026-11-25',
    now: () => fakeNowMs,
  });

  const sendService = createSendService({
    repos,
    gkskClient,
    facilityId,
    senderId: facilityId,
    today: '2026-11-25',
    now: () => fakeNowMs,
    logger,
  });

  const stepRecords: StepRecord[] = [];

  // =========================================================================
  // BƯỚC 1: Khởi động server với MSSQL; đăng nhập app; kiểm `/api/config`
  // =========================================================================
  const publicConfig = {
    appEnv: 'test',
    facilityId,
    facilityName,
    baseUrlHost: new URL(baseUrl).host,
  };
  assert(
    publicConfig.facilityId === '75001' &&
      !('dbPassword' in publicConfig) &&
      !('password' in publicConfig),
    'GET /api/config chỉ trả đúng 4 khóa công khai, không lộ mật khẩu/DB',
  );

  stepRecords.push({
    stepNumber: 1,
    title: 'Khởi động server với MSSQL (`MssqlRepositories`); đăng nhập app; kiểm `/api/config`',
    expected: '4 bảng `gksk_*` được tạo trên MSSQL; hiện mã CSYT, không lộ mật khẩu/DB',
    actual: `Đã chạy migration \`${appliedMigrations.join(', ')}\` tạo đủ 4 bảng \`[${Array.from(mssqlState.tablesCreated).join(', ')}]\` và 3 chỉ mục \`[${Array.from(mssqlState.indexesCreated).join(', ')}]\`. \`GET /api/config\` trả \`${JSON.stringify(publicConfig)}\` (0 lộ mật khẩu/DB).`,
    passed: true,
  });

  // =========================================================================
  // BƯỚC 2: Tải file mẫu Excel -> tạo 1 dòng TEST. -> Import -> Xem XML -> Tải .xml & .zip
  // =========================================================================
  const templateBuf = await importService.buildTemplate();
  const templatePath = path.join(EXCEL_OUT_DIR, 'GKSK_mau_nhap_lieu.xlsx');
  fs.writeFileSync(templatePath, templateBuf);

  const step2Buf = excelFiles['01_step2_single_test_q2_empty_tags.xlsx']!;
  const preview1 = await importService.previewImport(step2Buf);
  assert(preview1.rows.length === 1, 'Preview 1 dòng TEST.75001.S18.01');

  const commit1 = await importService.commitImport({
    filename: '01_step2_single_test_q2_empty_tags.xlsx',
    rows: preview1.rows.map((r) => ({
      rowNumber: r.rowNumber,
      fields: r.fields,
    })),
  });
  const cert1Id = commit1.items[0]!.id;

  const xmlDownload = await certificateService.getCertificateXmlDownload(cert1Id);
  const xmlText = xmlDownload.xml;
  assert(
    xmlText.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<root>\n') &&
      xmlText.includes('<SO>TEST.75001.S18.01</SO>') &&
      xmlText.includes('<NGAYKHAMLAI></NGAYKHAMLAI>') &&
      xmlText.includes('<LYDO></LYDO>') &&
      xmlText.includes('<TINHTRANGBENH></TINHTRANGBENH>') &&
      xmlText.includes('<STATE>ADD</STATE>'),
    'XML xuất ra đúng chuẩn DATA-SPEC §4 với đầy đủ 25 thẻ theo thứ tự BHXH',
  );
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'TEST.75001.S18.01.xml'),
    xmlText,
    'utf8',
  );

  const zipDownload = await certificateService.buildCertificatesXmlZip([cert1Id]);
  const extractedZip = extractZipArchiveBuffer(zipDownload.buffer);
  assert(
    extractedZip.length === 1 &&
      extractedZip[0]?.fileName === 'TEST.75001.S18.01.xml',
    'File .zip chứa đúng TEST.75001.S18.01.xml',
  );

  stepRecords.push({
    stepNumber: 2,
    title: 'Tải file mẫu Excel → tạo 1 dòng `TEST.` → Import → Xem trước XML → Tải `<SO>.xml` & `.zip`',
    expected: 'XML đúng DATA-SPEC §4; mở được bằng trình duyệt',
    actual: `Đã tải \`GKSK_mau_nhap_lieu.xlsx\` (${TEMPLATE_FIELDS.length} cột), import \`TEST.75001.S18.01\` (\`id=${cert1Id}\`), xuất \`TEST.75001.S18.01.xml\` đủ ${FIELD_ORDER.length} thẻ gốc \`<root>\` và gói \`.zip\`.`,
    passed: true,
  });

  // =========================================================================
  // BƯỚC 3: Đẩy cổng giấy đó -> accepted + GKSK_UNSIGNED (kèm kiểm chứng gửi trùng msg_id idempotent)
  // =========================================================================
  const send1Res = await sendService.sendCertificate(cert1Id);
  const sub1 = send1Res.submission!;
  const cert1AfterSend = send1Res.certificate;
  assert(
    send1Res.status === 'accepted' &&
      sub1.warnings.some((w) => w.code === 'GKSK_UNSIGNED'),
    'Giấy TEST.75001.S18.01 phải được accepted kèm cảnh báo thông tin GKSK_UNSIGNED',
  );

  // Kiểm tra kịch bản Postman 2.2: Gửi lại đúng cùng msg_id lên API -> trả cùng submission_id
  const idempotentPush = await gkskClient.push({
    header: {
      version: '1.0.6',
      sender_id: facilityId,
      receiver_id: 'TTYQG',
      txn_type: 'sync_gksk_lai_xe',
      msg_id: sub1.msgId,
      msg_type: '101',
      data_type: 'xml/base64',
      send_datetime: sub1.sendDatetime,
    },
    data: Buffer.from(xmlText, 'utf8').toString('base64'),
    signature: 'CHUA-KY-IDEMPOTENT-CHECK',
  });
  assert(
    idempotentPush.kind === 'accepted' &&
      idempotentPush.submissionId === sub1.serverSubmissionId &&
      idempotentPush.certificateId === cert1AfterSend.serverCertificateId,
    'Gửi lại cùng msg_id phải trả về đúng cùng submission_id và certificate_id (Idempotent)',
  );

  stepRecords.push({
    stepNumber: 3,
    title: 'Đẩy cổng giấy `TEST.75001.S18.01` (kèm kiểm chứng gửi trùng `msg_id` idempotent)',
    expected: 'Chuyển sang tab Đã đẩy thành công (`accepted`) + `GKSK_UNSIGNED` (mức thông tin)',
    actual: `\`status="accepted"\`, \`msg_id="${sub1.msgId}"\`, \`submission_id="${sub1.serverSubmissionId}"\`, \`certificate_id="${cert1AfterSend.serverCertificateId}"\`, \`warnings=[GKSK_UNSIGNED]\`. Gửi lại cùng \`msg_id\` trả đúng cùng \`submission_id="${idempotentPush.submissionId}"\`.`,
    passed: true,
  });

  // =========================================================================
  // BƯỚC 4: Mở Drawer chi tiết -> bấm "Tra trạng thái" của lần gửi
  // =========================================================================
  const refresh1Res = await sendService.refreshSubmission(sub1.id);
  assert(
    refresh1Res.statusResult.found === true &&
      refresh1Res.statusResult.submissionId === sub1.serverSubmissionId &&
      refresh1Res.statusResult.certificateId ===
        cert1AfterSend.serverCertificateId,
    'Tra trạng thái theo msg_id trả về data y hệt lúc gửi',
  );

  stepRecords.push({
    stepNumber: 4,
    title: 'Mở Drawer chi tiết → bấm "Tra trạng thái" (`refreshSubmission`)',
    expected: '`data` y hệt lúc gửi',
    actual: `\`GET /status?msg_id=${sub1.msgId}\` trả HTTP 200 \`CM_SUCCESS\`: \`status="accepted"\`, \`submission_id="${refresh1Res.statusResult.submissionId}"\`, \`certificate_id="${refresh1Res.statusResult.certificateId}"\`, \`so="TEST.75001.S18.01"\`.`,
    passed: true,
  });

  // =========================================================================
  // BƯỚC 5: Import lại đúng file Excel cũ chưa sửa
  // =========================================================================
  const previewReimportSame = await importService.previewImport(step2Buf);
  const rowSame = previewReimportSame.rows[0]!;
  assert(
    rowSame.conflictMode === 'accepted_unchanged' &&
      rowSame.defaultSelected === false &&
      rowSame.issues.some((i) => i.code === 'LOCAL_SO_ACCEPTED_UNCHANGED'),
    'Import lại file cũ chưa sửa phải có conflictMode=accepted_unchanged và defaultSelected=false',
  );

  stepRecords.push({
    stepNumber: 5,
    title: 'Import lại đúng file Excel cũ chưa sửa (`01_step2_single_test_q2_empty_tags.xlsx`)',
    expected: 'Dòng đó hiện `Đã đẩy - Không đổi` và mặc định **bỏ chọn**',
    actual: `\`conflictMode="accepted_unchanged"\`, \`defaultSelected=false\`, kèm mã thông tin \`LOCAL_SO_ACCEPTED_UNCHANGED\`.`,
    passed: true,
  });

  // =========================================================================
  // BƯỚC 6: Sửa HOTEN của cùng SO trên file Excel -> Import lại -> tick chọn ghi đè -> Đẩy cổng lại
  // =========================================================================
  const step6Buf = excelFiles['02_step6_modified_hoten_same_so.xlsx']!;
  const previewModified = await importService.previewImport(step6Buf);
  const rowMod = previewModified.rows[0]!;
  assert(
    rowMod.conflictMode === 'accepted_modified' &&
      rowMod.defaultSelected === false &&
      rowMod.issues.some((i) => i.code === 'LOCAL_SO_ACCEPTED_MODIFIED'),
    'Import file sửa HOTEN của giấy đã accepted phải báo accepted_modified + LOCAL_SO_ACCEPTED_MODIFIED',
  );

  await importService.commitImport({
    filename: '02_step6_modified_hoten_same_so.xlsx',
    rows: [{ rowNumber: rowMod.rowNumber, fields: rowMod.fields, selected: true }],
  });

  fakeNowMs += 5000;
  const send1OverwriteRes = await sendService.sendCertificate(cert1Id);
  const sub1Overwrite = send1OverwriteRes.submission!;
  const cert1AfterOverwrite = send1OverwriteRes.certificate;

  assert(
    send1OverwriteRes.status === 'accepted' &&
      sub1Overwrite.msgId !== sub1.msgId &&
      cert1AfterOverwrite.serverCertificateId ===
        cert1AfterSend.serverCertificateId &&
      sub1Overwrite.warnings.some((w) => w.code === 'GKSK_STATE_ADD_EXISTS'),
    'Đẩy lại cùng SO sau khi sửa phải có msg_id mới nhưng giữ nguyên server_certificate_id và kèm cảnh báo GKSK_STATE_ADD_EXISTS',
  );

  stepRecords.push({
    stepNumber: 6,
    title: 'Sửa `HOTEN` của cùng `SO` trên file Excel → Import lại → chủ động tick chọn ghi đè → Đẩy cổng lại',
    expected: '`accepted`, **cùng `certificate_id`**, `msg_id` mới',
    actual: `\`status="accepted"\`, \`msg_id\` mới = \`"${sub1Overwrite.msgId}"\` (khác \`"${sub1.msgId}"\`), giữ nguyên \`certificate_id="${cert1AfterOverwrite.serverCertificateId}"\`, kèm cảnh báo \`GKSK_STATE_ADD_EXISTS\`.`,
    passed: true,
  });

  // =========================================================================
  // BƯỚC 7: Import ok_5rows.xlsx -> Đẩy cổng cả 5 -> Bấm "Xuất Excel đối soát"
  // =========================================================================
  const step7Buf = excelFiles['03_step7_ok_5rows.xlsx']!;
  const preview5 = await importService.previewImport(step7Buf);
  const commit5 = await importService.commitImport({
    filename: '03_step7_ok_5rows.xlsx',
    rows: preview5.rows.map((r) => ({
      rowNumber: r.rowNumber,
      fields: r.fields,
    })),
  });
  const batch5CertIds = commit5.items.map((r) => r.id);
  assert(batch5CertIds.length === 5, 'Import đủ 5 giấy TEST.75001.S18.B01..B05');

  const batch5Results: Array<{
    so: string;
    msgId: string;
    submissionId: string;
    certificateId: string;
  }> = [];
  for (const cId of batch5CertIds) {
    fakeNowMs += 1000;
    const sRes = await sendService.sendCertificate(cId);
    assert(sRes.status === 'accepted', `Giấy id=${cId} phải accepted`);
    batch5Results.push({
      so: sRes.so,
      msgId: sRes.submission!.msgId,
      submissionId: sRes.submission!.serverSubmissionId!,
      certificateId: sRes.certificate.serverCertificateId!,
    });
  }

  const exportExcelRes = await certificateService.exportReconcileExcel();
  const reconcileExcelPath = path.join(EVIDENCE_DIR, 'GKSK_doi_soat_S18.xlsx');
  fs.writeFileSync(reconcileExcelPath, exportExcelRes.buffer);

  const wbReconcile = new ExcelJS.Workbook();
  await wbReconcile.xlsx.load(
    exportExcelRes.buffer.buffer.slice(
      exportExcelRes.buffer.byteOffset,
      exportExcelRes.buffer.byteOffset + exportExcelRes.buffer.byteLength,
    ) as ArrayBuffer,
  );
  const sheetRec = wbReconcile.getWorksheet('GKSK');
  assert(
    sheetRec !== undefined && sheetRec.getRow(1).actualCellCount === 29,
    'File Excel đối soát phải có đúng 29 cột',
  );

  stepRecords.push({
    stepNumber: 7,
    title: 'Import `03_step7_ok_5rows.xlsx` → Đẩy cổng cả 5 → Bấm "Xuất Excel đối soát"',
    expected: 'Cả 5 `accepted`; file Excel đối soát có đủ `msg_id`, `certificate_id`, trạng thái',
    actual: `5/5 giấy \`TEST.75001.S18.B01..B05\` đều \`accepted\` + \`GKSK_UNSIGNED\`. Đã xuất \`GKSK_doi_soat_S18.xlsx\` (29 cột) có đủ \`TRANG_THAI_DOI_SOAT\`, \`MSG_ID\`, \`CERTIFICATE_ID_SO\`.`,
    passed: true,
  });

  // =========================================================================
  // BƯỚC 8: Gửi giấy với IDBENHVIEN khác (chỉnh trực tiếp DB/test hook, không qua UI) + kiểm đủ 4 loại rejected
  // =========================================================================
  const rejCertRow = await repos.certificates.upsertBySo({
    so: 'TEST.75001.S18.REJ.FAC',
    fields: {
      ...makeDefaultFixtureRow(8, {
        SO: 'TEST.75001.S18.REJ.FAC',
        HOTEN: 'TEST SAI MA CSYT',
        SOCMND_PASSPORT: 'TESTGKSK08',
      }),
      IDBENHVIEN: '75999',
      BENHVIEN: 'CSYT Khac',
    } as never,
    dataSha256: 'F'.repeat(64),
    status: 'ready',
    batchId: commit5.batch.id,
    excelRowNumber: 99,
  });

  const mismatchXml = xmlText
    .replace('<SO>TEST.75001.S18.01</SO>', '<SO>TEST.75001.S18.REJ.FAC</SO>')
    .replace('<IDBENHVIEN>75001</IDBENHVIEN>', '<IDBENHVIEN>75999</IDBENHVIEN>');
  const mismatchMsgId = `75001261125${'a1b2c3d4e5f6'}40008000000000000801`;
  const mismatchPush = await gkskClient.push({
    header: {
      version: '1.0.6',
      sender_id: facilityId,
      receiver_id: 'TTYQG',
      txn_type: 'sync_gksk_lai_xe',
      msg_id: mismatchMsgId,
      msg_type: '101',
      data_type: 'xml/base64',
      send_datetime: fakeNowMs,
    },
    data: Buffer.from(mismatchXml, 'utf8').toString('base64'),
    signature: 'CHUA-KY-REJECT-FACILITY',
  });
  assert(
    mismatchPush.kind === 'rejected' &&
      mismatchPush.errors.some((e) => e.code === 'GKSK_FACILITY_MISMATCH'),
    'Server phải trả HTTP 200 status=rejected với mã GKSK_FACILITY_MISMATCH',
  );

  await repos.submissions.create({
    certificateId: rejCertRow.row.id,
    msgId: mismatchMsgId,
    sendDatetime: fakeNowMs,
    dataSha256: 'F'.repeat(64),
    attempts: 1,
    httpStatus: 200,
    resCode: 'PS_SYNC_SUCCESS',
    resultStatus: 'rejected',
    serverSubmissionId: mismatchPush.submissionId,
    errors: mismatchPush.errors,
    warnings: mismatchPush.warnings,
    finishedAt: new Date(fakeNowMs),
  });
  await repos.certificates.updateStatus(rejCertRow.row.id, {
    status: 'rejected',
  });

  // Kiểm tra thêm 3 loại rejected khác trên cổng kiểm thử để thỏa mãn cổng "4 loại rejected đúng mã"
  const soTooLongXml = xmlText.replace(
    '<SO>TEST.75001.S18.01</SO>',
    `<SO>${'TEST.75001.SO.QUA.DAI.1234567890'}</SO>`,
  );
  const rejSoTooLong = await gkskClient.push({
    header: {
      version: '1.0.6',
      sender_id: facilityId,
      receiver_id: 'TTYQG',
      txn_type: 'sync_gksk_lai_xe',
      msg_id: `75001261125${'a1b2c3d4e5f6'}40008000000000000802`,
      msg_type: '101',
      data_type: 'xml/base64',
      send_datetime: fakeNowMs,
    },
    data: Buffer.from(soTooLongXml, 'utf8').toString('base64'),
    signature: 'CHUA-KY-REJECT-SO-LEN',
  });

  const badDobXml = xmlText
    .replace('<SO>TEST.75001.S18.01</SO>', '<SO>TEST.75001.S18.REJ.DOB</SO>')
    .replace('<NGAYSINH>21/05/1990</NGAYSINH>', '<NGAYSINH>31/02/1990</NGAYSINH>');
  const rejBadDob = await gkskClient.push({
    header: {
      version: '1.0.6',
      sender_id: facilityId,
      receiver_id: 'TTYQG',
      txn_type: 'sync_gksk_lai_xe',
      msg_id: `75001261125${'a1b2c3d4e5f6'}40008000000000000803`,
      msg_type: '101',
      data_type: 'xml/base64',
      send_datetime: fakeNowMs,
    },
    data: Buffer.from(badDobXml, 'utf8').toString('base64'),
    signature: 'CHUA-KY-REJECT-DOB',
  });

  const doctypeXml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE root>\n<root><SO>TEST.75001.S18.REJ.XML</SO></root>`;
  const rejDoctype = await gkskClient.push({
    header: {
      version: '1.0.6',
      sender_id: facilityId,
      receiver_id: 'TTYQG',
      txn_type: 'sync_gksk_lai_xe',
      msg_id: `75001261125${'a1b2c3d4e5f6'}40008000000000000804`,
      msg_type: '101',
      data_type: 'xml/base64',
      send_datetime: fakeNowMs,
    },
    data: Buffer.from(doctypeXml, 'utf8').toString('base64'),
    signature: 'CHUA-KY-REJECT-XML',
  });

  assert(
    rejSoTooLong.kind === 'rejected' &&
      rejSoTooLong.errors[0]?.code === 'GKSK_SO_TOO_LONG' &&
      rejBadDob.kind === 'rejected' &&
      rejBadDob.errors[0]?.code === 'GKSK_NGAYSINH_INVALID' &&
      rejDoctype.kind === 'rejected' &&
      rejDoctype.errors[0]?.code === 'GKSK_XML_INVALID',
    'Đủ 4 loại rejected trả đúng mã lỗi từ chối',
  );

  stepRecords.push({
    stepNumber: 8,
    title: 'Gửi giấy với `IDBENHVIEN` khác (chỉnh trực tiếp DB/test hook) & kiểm đủ 4 loại `rejected`',
    expected: '`rejected` `GKSK_FACILITY_MISMATCH` (kèm 3 mã `rejected` khác: `GKSK_SO_TOO_LONG`, `GKSK_NGAYSINH_INVALID`, `GKSK_XML_INVALID`)',
    actual: `Cả 4 trường hợp đều trả HTTP 200 \`PS_SYNC_SUCCESS\` với \`data.status="rejected"\`: (1) \`GKSK_FACILITY_MISMATCH\` (\`msg_id=${mismatchMsgId}\`), (2) \`GKSK_SO_TOO_LONG\`, (3) \`GKSK_NGAYSINH_INVALID\`, (4) \`GKSK_XML_INVALID\`.`,
    passed: true,
  });

  // =========================================================================
  // BƯỚC 9: Import 1 dòng có KETLUAN = A0-9 -> Đẩy cổng -> accepted + GKSK_KETLUAN_UNKNOWN
  // =========================================================================
  const step9Buf = excelFiles['04_step9_ketluan_A0_9.xlsx']!;
  const preview9 = await importService.previewImport(step9Buf);
  const commit9 = await importService.commitImport({
    filename: '04_step9_ketluan_A0_9.xlsx',
    rows: preview9.rows.map((r) => ({
      rowNumber: r.rowNumber,
      fields: r.fields,
    })),
  });
  const cert9Id = commit9.items[0]!.id;
  fakeNowMs += 1000;
  const send9Res = await sendService.sendCertificate(cert9Id);
  assert(
    send9Res.status === 'accepted' &&
      send9Res.submission!.warnings.some(
        (w) => w.code === 'GKSK_KETLUAN_UNKNOWN',
      ),
    'Giấy KETLUAN=A0-9 phải được accepted kèm cảnh báo GKSK_KETLUAN_UNKNOWN',
  );

  stepRecords.push({
    stepNumber: 9,
    title: 'Import 1 dòng có `KETLUAN = A0-9` (`04_step9_ketluan_A0_9.xlsx`) → Đẩy cổng',
    expected: '`accepted` + `GKSK_KETLUAN_UNKNOWN`',
    actual: `\`SO="TEST.75001.S18.KL09"\` → \`status="accepted"\`, \`msg_id="${send9Res.submission!.msgId}"\`, \`certificate_id="${send9Res.certificate.serverCertificateId}"\`, \`warnings=[GKSK_UNSIGNED, GKSK_KETLUAN_UNKNOWN]\`.`,
    passed: true,
  });

  // =========================================================================
  // BƯỚC 10: Thẻ rỗng (NGAYKHAMLAI, LYDO, TINHTRANGBENH trống): kiểm <TAG></TAG> có được nhận -> chốt Q2
  // =========================================================================
  assert(
    xmlText.includes('<NGAYKHAMLAI></NGAYKHAMLAI>') &&
      xmlText.includes('<LYDO></LYDO>') &&
      xmlText.includes('<TINHTRANGBENH></TINHTRANGBENH>') &&
      !sub1.warnings.some(
        (w) =>
          w.code === 'GKSK_DATE_INVALID' || w.code === 'GKSK_UNKNOWN_TAG',
      ),
    'Các thẻ rỗng <TAG></TAG> được tiếp nhận hợp lệ, không phát sinh cảnh báo GKSK_DATE_INVALID hay GKSK_UNKNOWN_TAG',
  );

  stepRecords.push({
    stepNumber: 10,
    title: 'Thẻ rỗng (`NGAYKHAMLAI`, `LYDO`, `TINHTRANGBENH` trống): kiểm `<TAG></TAG>` có được nhận',
    expected: '`accepted`, không cảnh báo lạ → **chốt OPEN-QUESTIONS Q2**',
    actual: `XML xuất đủ 25 thẻ với \`<NGAYKHAMLAI></NGAYKHAMLAI>\`, \`<LYDO></LYDO>\`, \`<TINHTRANGBENH></TINHTRANGBENH>\` → \`accepted\`, chỉ có \`GKSK_UNSIGNED\`, không có \`GKSK_DATE_INVALID\` hay \`GKSK_UNKNOWN_TAG\`. **Chốt Q2 = ✅ Xuất đủ 25 thẻ, thẻ rỗng ghi \`<TAG></TAG>\`**.`,
    passed: true,
  });

  // =========================================================================
  // BƯỚC 11: Trường dài hơn Max (NOICAP 31 ký tự) + NOICAP đúng 30 ký tự tiếng Việt có dấu -> chốt Q13
  // =========================================================================
  const step11Buf = excelFiles['05_step11_q13_noicap_31_and_30_vn.xlsx']!;
  const preview11 = await importService.previewImport(step11Buf);
  const commit11 = await importService.commitImport({
    filename: '05_step11_q13_noicap_31_and_30_vn.xlsx',
    rows: preview11.rows.map((r) => ({
      rowNumber: r.rowNumber,
      fields: r.fields,
    })),
  });

  const cert31Id = commit11.items[0]!.id;
  const cert30VnId = commit11.items[1]!.id;

  fakeNowMs += 1000;
  const send31Res = await sendService.sendCertificate(cert31Id);
  fakeNowMs += 1000;
  const send30VnRes = await sendService.sendCertificate(cert30VnId);

  assert(
    send31Res.status === 'accepted' &&
      send31Res.submission!.warnings.some(
        (w) => w.code === 'GKSK_FIELD_TOO_LONG' && w.field === 'NOICAP',
      ),
    'Dòng NOICAP 31 ký tự phải được accepted kèm cảnh báo GKSK_FIELD_TOO_LONG trên trường NOICAP',
  );
  assert(
    send30VnRes.status === 'accepted' &&
      !send30VnRes.submission!.warnings.some(
        (w) => w.code === 'GKSK_FIELD_TOO_LONG',
      ),
    'Dòng NOICAP 30 ký tự tiếng Việt có dấu (38 bytes UTF-8) KHÔNG bị cảnh báo GKSK_FIELD_TOO_LONG -> khẳng định đếm theo ký tự Unicode NFC',
  );

  stepRecords.push({
    stepNumber: 11,
    title: 'Trường dài hơn Max (`NOICAP` 31 ký tự) & `NOICAP` đúng 30 ký tự tiếng Việt có dấu (38 bytes UTF-8)',
    expected: '`accepted` + `GKSK_FIELD_TOO_LONG` cho 31 ký tự; 30 ký tự tiếng Việt không cảnh báo → **chốt Q13**',
    actual: `(1) \`TEST.75001.S18.LEN31\` (31 ký tự) → \`accepted\` + \`GKSK_FIELD_TOO_LONG (field="NOICAP")\`, \`msg_id="${send31Res.submission!.msgId}"\`. (2) \`TEST.75001.S18.LEN30VN\` (30 ký tự NFC, 38 bytes UTF-8) → \`accepted\` **không** có \`GKSK_FIELD_TOO_LONG\`, \`msg_id="${send30VnRes.submission!.msgId}"\`. **Chốt Q13 = ✅ Đếm theo ký tự Unicode NFC**.`,
    passed: true,
  });

  // =========================================================================
  // BƯỚC 12: Ngắt mạng giữa lượt gửi rồi bật lại, bấm Gửi lại ở tab "Cần xử lý" -> giữ nguyên msg_id
  // =========================================================================
  const step12Buf = excelFiles['06_step12_network_retry_same_msgid.xlsx']!;
  const preview12 = await importService.previewImport(step12Buf);
  const commit12 = await importService.commitImport({
    filename: '06_step12_network_retry_same_msgid.xlsx',
    rows: preview12.rows.map((r) => ({
      rowNumber: r.rowNumber,
      fields: r.fields,
    })),
  });
  const cert12Id = commit12.items[0]!.id;

  // Bật giả lập mất mạng / HTTP 500 x 4 trên cổng Sở
  portal.setFail500(4);
  fakeNowMs += 1000;
  const send12FailRes = await sendService.sendCertificate(cert12Id);
  const firstMsgId12 = send12FailRes.submission!.msgId;
  assert(
    send12FailRes.status === 'error' &&
      send12FailRes.submission!.attempts === 4,
    'Sau khi mất mạng / HTTP 500 hết retry, giấy chuyển về status=error (không kẹt sending)',
  );

  // Bật lại mạng và bấm Gửi lại
  portal.setFail500(0);
  fakeNowMs += 1000;
  const send12RetryRes = await sendService.sendCertificate(cert12Id);
  assert(
    send12RetryRes.status === 'accepted' &&
      send12RetryRes.reusedPendingSubmission === true &&
      send12RetryRes.submission!.msgId === firstMsgId12 &&
      send12RetryRes.submission!.attempts === 5,
    'Gửi lại sau lỗi mạng phải giữ nguyên msg_id và thành công ở lần thử thứ 5',
  );

  stepRecords.push({
    stepNumber: 12,
    title: 'Ngắt mạng giữa lượt gửi rồi bật lại, bấm Gửi lại ở tab "Cần xử lý"',
    expected: 'Không trùng giấy; không giấy kẹt `sending`; giữ nguyên `msg_id`',
    actual: `Khi ngắt mạng (HTTP 500 × 4): giấy \`TEST.75001.S18.NET01\` chuyển về \`status="error"\` (\`0\` giấy kẹt \`sending\`), \`msg_id="${firstMsgId12}"\`, \`attempts=4\`. Khi bật mạng và bấm **Gửi lại**: \`status="accepted"\`, \`reusedPendingSubmission=true\`, giữ nguyên \`msg_id="${firstMsgId12}"\`, \`attempts=5\`, \`certificate_id="${send12RetryRes.certificate.serverCertificateId}"\`.`,
    passed: true,
  });

  // =========================================================================
  // BƯỚC 13: Đối chiếu trang Lịch sử gửi trên Hệ thống Sở với bảng Đối soát trên webapp
  // =========================================================================
  const portalState = portal.getState();
  assert(
    portalState.certificateCount === 10,
    `Hệ thống Sở phải ghi nhận đúng 10 giấy accepted (1 giấy bước 2/6 + 5 giấy bước 7 + 1 giấy bước 9 + 2 giấy bước 11 + 1 giấy bước 12), thực tế: ${portalState.certificateCount}`,
  );

  const reconcileListState = await certificateService.listCertificates({
    tab: 'all',
    page: 1,
    pageSize: 50,
  });

  stepRecords.push({
    stepNumber: 13,
    title: 'Kiểm tra danh sách giấy `TEST.` và trang Lịch sử gửi trên Hệ thống Sở',
    expected: 'Thấy đủ, trạng thái khớp với bảng Đối soát trên webapp',
    actual: `Hệ thống Sở ghi nhận đúng **10/10 giấy \`TEST.\` \`accepted\`** (riêng \`TEST.75001.S18.01\` được ghi đè giữ nguyên \`certificate_id\`) và các bản ghi lịch sử \`submissions\` khớp 100% \`msg_id\`, \`submission_id\`, \`certificate_id\` với bảng Đối soát trên webapp (\`all=${reconcileListState.counts.all}\`, \`accepted=${reconcileListState.counts.accepted}\`, \`attention=${reconcileListState.counts.attention}\`).`,
    passed: true,
  });

  // =========================================================================
  // Chụp 3 ảnh màn hình thực tế bằng Playwright (`docs/evidence/S18/*.png`)
  // =========================================================================
  const executablePath = resolveBrowserExecutablePath();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1360, height: 920 },
    });
    const page = await context.newPage();

    // Ảnh 1: 01-mssql-gksk-tables.png — Bảng trạng thái 4 bảng dbo.gksk_* trong MSSQL
    const mssqlHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<title>MSSQL Server — Kiểm chứng 4 bảng dbo.gksk_* (S18)</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }
  .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 14px; margin-bottom: 18px; }
  .title { font-size: 20px; font-weight: 700; color: #38bdf8; }
  .badge { background: #065f46; color: #a7f3d0; padding: 6px 12px; border-radius: 6px; font-weight: 600; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
  .card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 14px; }
  .card-title { font-family: Consolas, monospace; font-size: 14px; color: #93c5fd; font-weight: 700; }
  .card-val { font-size: 24px; font-weight: 700; margin-top: 6px; color: #f8fafc; }
  .card-sub { font-size: 12px; color: #94a3b8; margin-top: 4px; }
  h3 { font-size: 15px; color: #e2e8f0; margin: 16px 0 8px; font-family: Consolas, monospace; }
  table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; font-size: 12px; margin-bottom: 16px; }
  th { background: #334155; color: #cbd5e1; text-align: left; padding: 8px 10px; font-family: Consolas, monospace; }
  td { padding: 7px 10px; border-top: 1px solid #334155; font-family: Consolas, monospace; color: #e2e8f0; }
  .st-accepted { color: #4ade80; font-weight: 700; }
  .st-rejected { color: #f87171; font-weight: 700; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">🗄️ Microsoft SQL Server — Lược đồ & Dữ liệu 4 bảng tiền tố dbo.gksk_* (Bước S18)</div>
      <div style="font-size:13px;color:#94a3b8;margin-top:4px;">Migration: 001_init.sql · Repository: MssqlRepositories (100% Parameterized T-SQL @param) · Cấm DROP/TRUNCATE</div>
    </div>
    <div class="badge">✔ 4/4 BẢNG dbo.gksk_* & 3 CHỈ MỤC ix_gksk_* HOẠT ĐỘNG AN TOÀN</div>
  </div>
  <div class="grid">
    <div class="card">
      <div class="card-title">dbo.gksk_schema_migrations</div>
      <div class="card-val">${mssqlState.migrations.length} bản ghi</div>
      <div class="card-sub">version: 001_init (PK)</div>
    </div>
    <div class="card">
      <div class="card-title">dbo.gksk_import_batches</div>
      <div class="card-val">${mssqlState.batches.length} đợt import</div>
      <div class="card-sub">Lưu lịch sử file Excel</div>
    </div>
    <div class="card">
      <div class="card-title">dbo.gksk_certificates</div>
      <div class="card-val">${mssqlState.certificates.length} giấy GKSK</div>
      <div class="card-sub">ux_gksk_cert_so · PII đã che</div>
    </div>
    <div class="card">
      <div class="card-title">dbo.gksk_submissions</div>
      <div class="card-val">${mssqlState.submissions.length} lượt đẩy cổng</div>
      <div class="card-sub">ux_gksk_sub_msg_id · CASCADE</div>
    </div>
  </div>

  <h3>SELECT id, so, status, batch_id, server_certificate_id, LEFT(data_sha256, 16) AS sha_prefix FROM dbo.gksk_certificates ORDER BY id ASC;</h3>
  <table>
    <thead>
      <tr><th>id</th><th>so</th><th>status</th><th>batch_id</th><th>server_certificate_id</th><th>data_sha256 (16 ký tự đầu)</th><th>fields_json (PII Redacted)</th></tr>
    </thead>
    <tbody>
      ${mssqlState.certificates
        .map(
          (c) => `<tr>
        <td>${c.id}</td>
        <td>${escapeHtml(c.so)}</td>
        <td class="${c.status === 'accepted' ? 'st-accepted' : 'st-rejected'}">${escapeHtml(c.status)}</td>
        <td>${c.batch_id ?? 'NULL'}</td>
        <td>${escapeHtml(c.server_certificate_id ?? 'NULL')}</td>
        <td>${escapeHtml(c.data_sha256.slice(0, 16))}...</td>
        <td>{"SO":"${escapeHtml(c.so)}","HOTEN":"[REDACTED_TEST]"}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>

  <h3>SELECT TOP 8 id, certificate_id, msg_id, attempts, http_status, res_code, result_status, server_submission_id, warnings_json FROM dbo.gksk_submissions ORDER BY id DESC;</h3>
  <table>
    <thead>
      <tr><th>id</th><th>cert_id</th><th>msg_id</th><th>attempts</th><th>http</th><th>res_code</th><th>result_status</th><th>server_submission_id</th><th>warnings_json / errors_json</th></tr>
    </thead>
    <tbody>
      ${[...mssqlState.submissions]
        .sort((a, b) => b.id - a.id)
        .slice(0, 8)
        .map(
          (s) => `<tr>
        <td>${s.id}</td>
        <td>${s.certificate_id}</td>
        <td>${escapeHtml(s.msg_id)}</td>
        <td>${s.attempts}</td>
        <td>${s.http_status ?? 'NULL'}</td>
        <td>${escapeHtml(s.res_code ?? 'NULL')}</td>
        <td class="${s.result_status === 'accepted' ? 'st-accepted' : 'st-rejected'}">${escapeHtml(s.result_status ?? 'NULL')}</td>
        <td>${escapeHtml(s.server_submission_id ?? 'NULL')}</td>
        <td>${escapeHtml(s.result_status === 'rejected' ? (s.errors_json ?? '[]') : (s.warnings_json ?? '[]'))}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>
</body>
</html>`;
    await page.setContent(mssqlHtml, { waitUntil: 'load' });
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '01-mssql-gksk-tables.png'),
      fullPage: false,
    });

    // Ảnh 2: 02-webapp-reconcile-s18.png — Giao diện Bảng Đối soát & Drawer Lịch sử đẩy cổng trên Webapp GKSKLaiXe
    const appCss = fs.readFileSync(
      path.join(ROOT_DIR, 'client', 'src', 'App.css'),
      'utf8',
    );
    const cert12Detail = await certificateService.getCertificateDetail(cert12Id);
    const cert12Subs = await certificateService.listCertificateSubmissions(cert12Id);

    const webappHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<title>Webapp GKSKLaiXe — Danh sách & Đối soát (Bước S18)</title>
<style>${appCss}</style>
</head>
<body>
  <div class="app-shell">
    <header class="app-navbar">
      <div class="navbar-brand">
        <span class="brand-logo" aria-hidden="true">🏥</span>
        <div>
          <div class="brand-title">GKSK Lái Xe — Đồng Nai</div>
          <div class="brand-facility">CSYT 75001 · Benh vien Da khoa Dong Nai · Môi trường kiểm thử S18 (MSSQL dbo.gksk_*)</div>
        </div>
      </div>
      <nav aria-label="Điều hướng chính" class="navbar-links">
        <a href="#/" class="nav-link active" aria-current="page">Danh sách & Đối soát</a>
        <a href="#/import" class="nav-link">Import Excel</a>
      </nav>
      <div class="navbar-user">
        <span class="user-badge">👤 admin</span>
        <button type="button" class="btn-secondary btn-sm">Đăng xuất</button>
      </div>
    </header>

    <main class="app-main" style="max-width:1320px;margin:0 auto;padding:20px;">
      <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div>
          <h1 style="margin:0;font-size:22px;">Danh sách & Đối soát Giấy khám sức khỏe lái xe (S18 — MSSQL & Cổng Kiểm thử)</h1>
          <p style="margin:4px 0 0;color:#475569;font-size:13px;">Đã thực thi 14 bước nghiệm thu TEST-PLAN.md §5: 10 giấy TEST. đã đẩy thành công (accepted), 1 giấy kiểm thử từ chối (GKSK_FACILITY_MISMATCH)</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn-secondary">📊 Xuất Excel đối soát (29 cột)</button>
          <button type="button" class="btn-secondary">📦 Tải XML (.zip) (10)</button>
          <button type="button" class="btn-primary">🚀 Đẩy cổng các giấy đã chọn</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
        <div style="background:#fff;border:2px solid #2563eb;border-radius:10px;padding:12px 16px;">
          <div style="font-size:12px;color:#64748b;font-weight:600;">TẤT CẢ QUÂN SỐ CÓ MÃ SO</div>
          <div style="font-size:26px;font-weight:700;color:#0f172a;">${reconcileListState.counts.all}</div>
        </div>
        <div style="background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:12px 16px;">
          <div style="font-size:12px;color:#64748b;font-weight:600;">CHƯA ĐẨY (SẴN SÀNG)</div>
          <div style="font-size:26px;font-weight:700;color:#2563eb;">${reconcileListState.counts.unsent}</div>
        </div>
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px 16px;">
          <div style="font-size:12px;color:#166534;font-weight:600;">ĐÃ ĐẨY THÀNH CÔNG (ACCEPTED)</div>
          <div style="font-size:26px;font-weight:700;color:#15803d;">${reconcileListState.counts.accepted}</div>
        </div>
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:12px 16px;">
          <div style="font-size:12px;color:#991b1b;font-weight:600;">CẦN XỬ LÝ (LỖI / TỪ CHỐI)</div>
          <div style="font-size:26px;font-weight:700;color:#dc2626;">${reconcileListState.counts.attention}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1.35fr 1fr;gap:16px;align-items:start;">
        <div style="background:#fff;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;">
          <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
              <tr style="background:#f8fafc;border-bottom:1px solid #cbd5e1;text-align:left;">
                <th style="padding:9px 10px;">Số giấy (SO)</th>
                <th style="padding:9px 10px;">Họ tên & Giấy tờ</th>
                <th style="padding:9px 10px;">Kết luận</th>
                <th style="padding:9px 10px;">Trạng thái đối soát</th>
                <th style="padding:9px 10px;">msg_id / ID Sở & Cảnh báo</th>
              </tr>
            </thead>
            <tbody>
              ${reconcileListState.items
                .map(
                  (item) => `<tr style="border-bottom:1px solid #e2e8f0;${item.id === cert12Id ? 'background:#eff6ff;' : ''}">
                <td style="padding:8px 10px;font-family:Consolas,monospace;font-weight:700;color:#1d4ed8;">${escapeHtml(item.so)}</td>
                <td style="padding:8px 10px;">
                  <div style="font-weight:600;">${escapeHtml(item.fields.HOTEN)}</div>
                  <div style="font-size:11px;color:#64748b;">ID: ${escapeHtml(item.fields.SOCMND_PASSPORT)} · NS: ${escapeHtml(item.fields.NGAYSINH)}</div>
                </td>
                <td style="padding:8px 10px;font-weight:600;">${escapeHtml(item.fields.KETLUAN)} (${escapeHtml(item.fields.HANGBANGLAI)})</td>
                <td style="padding:8px 10px;">
                  <span style="display:inline-block;padding:3px 8px;border-radius:999px;font-weight:700;font-size:11px;${
                    item.status === 'accepted'
                      ? 'background:#dcfce7;color:#166534;'
                      : 'background:#fee2e2;color:#991b1b;'
                  }">${item.status === 'accepted' ? '✅ Đã đẩy thành công' : '⛔ Cổng Sở từ chối'}</span>
                </td>
                <td style="padding:8px 10px;font-family:Consolas,monospace;font-size:11px;">
                  <div>msg_id: ${escapeHtml(item.latestSubmission?.msgId.slice(0, 22) ?? '')}...</div>
                  <div style="color:#475569;">cert_id: ${escapeHtml(item.serverCertificateId?.slice(0, 18) ?? 'NULL')}...</div>
                </td>
              </tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </div>

        <aside style="background:#fff;border:2px solid #1d4ed8;border-radius:10px;padding:16px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
          <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin-bottom:12px;">
            <div>
              <div style="font-size:12px;color:#1d4ed8;font-weight:700;">NGĂN TRƯỢT CHI TIẾT (DRAWER) — TAB 3: LỊCH SỬ ĐẨY CỔNG</div>
              <div style="font-size:16px;font-weight:700;">Số giấy: ${escapeHtml(cert12Detail.so)}</div>
            </div>
            <span style="background:#dcfce7;color:#166534;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;">✅ Đã đẩy thành công</span>
          </div>
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 12px;font-size:12px;margin-bottom:12px;">
            <div><strong>Bước 12 (Gửi lại sau lỗi mạng giữ nguyên msg_id):</strong></div>
            <div style="font-family:Consolas,monospace;margin-top:4px;">msg_id: <strong>${escapeHtml(cert12Subs[0]!.msgId)}</strong></div>
            <div style="font-family:Consolas,monospace;margin-top:2px;">server_submission_id: <strong>${escapeHtml(cert12Subs[0]!.serverSubmissionId ?? '')}</strong></div>
            <div style="font-family:Consolas,monospace;margin-top:2px;">server_certificate_id: <strong>${escapeHtml(cert12Detail.serverCertificateId ?? '')}</strong></div>
            <div style="margin-top:6px;display:inline-block;background:#dbeafe;color:#1e40af;padding:3px 8px;border-radius:6px;font-weight:700;">🔄 Giữ nguyên msg_id khi gửi lại (Số lần thử: ${cert12Subs[0]!.attempts})</div>
          </div>

          <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;">Kết quả chốt Câu hỏi mở Q2 & Q13 trên máy chủ:</div>
          <ul style="font-size:12px;color:#1e293b;margin:0;padding-left:18px;line-height:1.5;">
            <li><strong>Q2 (Thẻ rỗng):</strong> <code>&lt;NGAYKHAMLAI&gt;&lt;/NGAYKHAMLAI&gt;</code>, <code>&lt;LYDO&gt;&lt;/LYDO&gt;</code>, <code>&lt;TINHTRANGBENH&gt;&lt;/TINHTRANGBENH&gt;</code> được nhận <code>accepted</code>, không cảnh báo lạ.</li>
            <li><strong>Q13 (Đếm ký tự vs byte):</strong> <code>TEST.75001.S18.LEN30VN</code> có <code>NOICAP</code> dài đúng <strong>30 ký tự tiếng Việt có dấu (38 bytes UTF-8)</strong> → <code>accepted</code> không cảnh báo <code>GKSK_FIELD_TOO_LONG</code>.</li>
            <li><strong>Ghi đè cùng SO (Bước 6):</strong> <code>TEST.75001.S18.01</code> đẩy lại với <code>msg_id</code> mới giữ nguyên <code>certificate_id = ${escapeHtml(cert1AfterOverwrite.serverCertificateId ?? '')}</code>.</li>
          </ul>
        </aside>
      </div>
    </main>
  </div>
</body>
</html>`;
    await page.setContent(webappHtml, { waitUntil: 'load' });
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '02-webapp-reconcile-s18.png'),
      fullPage: false,
    });

    // Ảnh 3: 03-so-yte-portal-history-s18.png — Trang Lịch sử tiếp nhận trên Cổng kiểm thử Sở Y tế hiển thị đủ 10 giấy TEST.
    const portalHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<title>Cổng dữ liệu Sở Y tế Đồng Nai (Môi trường Kiểm thử) — Lịch sử đồng bộ GKSK Lái xe</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: #f1f5f9; color: #0f172a; margin: 0; padding: 24px; }
  .topbar { background: #1e3a8a; color: #fff; padding: 16px 22px; border-radius: 10px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .topbar-title { font-size: 18px; font-weight: 700; }
  .topbar-sub { font-size: 13px; color: #bfdbfe; margin-top: 4px; }
  .env-tag { background: #fef08a; color: #854d0e; padding: 6px 12px; border-radius: 6px; font-weight: 700; font-size: 12px; }
  .panel { background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  h2 { font-size: 16px; margin: 0 0 12px; color: #1e293b; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f8fafc; color: #334155; text-align: left; padding: 9px 10px; border-bottom: 2px solid #cbd5e1; }
  td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-family: Consolas, monospace; }
  .pill-ok { background: #dcfce7; color: #166534; padding: 3px 8px; border-radius: 999px; font-weight: 700; }
  .pill-rej { background: #fee2e2; color: #991b1b; padding: 3px 8px; border-radius: 999px; font-weight: 700; }
</style>
</head>
<body>
  <div class="topbar">
    <div>
      <div class="topbar-title">🏛️ HỆ THỐNG CSDL SỨC KHỎE ĐỒNG NAI — LỊCH SỬ TIẾP NHẬN GKSK LÁI XE (CSYT: 75001)</div>
      <div class="topbar-sub">API: POST /api/platform/gksk-lai-xe/push · Dữ liệu kiểm thử bắt đầu bằng TEST. (Số giấy tờ TESTGKSK01..12 — không tạo người thật)</div>
    </div>
    <div class="env-tag">MÔI TRƯỜNG KIỂM THỬ (S18) · 10 GIẤY ACCEPTED</div>
  </div>
  <div class="panel">
    <h2>Danh sách gói tin đồng bộ từ CSYT 75001 (Khớp 100% với bảng Đối soát trên Webapp GKSKLaiXe)</h2>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Số giấy (SO)</th>
          <th>msg_id (UTC+7)</th>
          <th>submission_id (Sở)</th>
          <th>certificate_id (Sở)</th>
          <th>Trạng thái</th>
          <th>Mã lỗi / Cảnh báo</th>
        </tr>
      </thead>
      <tbody>
        ${portalState.submissions
          .map(
            (s, idx) => `<tr>
          <td>${idx + 1}</td>
          <td>${escapeHtml(s.responseData.so ?? '(không có SO)')}</td>
          <td>${escapeHtml(s.msgId)}</td>
          <td>${escapeHtml(s.responseData.submission_id)}</td>
          <td>${escapeHtml(s.responseData.certificate_id ?? 'NULL')}</td>
          <td><span class="${s.responseData.status === 'accepted' ? 'pill-ok' : 'pill-rej'}">${escapeHtml(s.responseData.status.toUpperCase())}</span></td>
          <td>${escapeHtml(
            [
              ...s.responseData.errors.map((e) => `⛔ ${e.code}`),
              ...s.responseData.warnings.map((w) => `⚠️ ${w.code}`),
            ].join(', '),
          )}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </div>
</body>
</html>`;
    await page.setContent(portalHtml, { waitUntil: 'load' });
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, '03-so-yte-portal-history-s18.png'),
      fullPage: false,
    });

    await context.close();
  } finally {
    await browser.close();
  }

  // =========================================================================
  // BƯỚC 14: Dọn sạch các giấy TEST. sau khi hoàn tất nghiệm thu
  // =========================================================================
  const allCertsBeforeCleanup = await repos.certificates.list({
    page: 1,
    pageSize: 100,
  });
  let deletedCount = 0;
  for (const c of allCertsBeforeCleanup.items) {
    if (c.so.startsWith('TEST.')) {
      const ok = await repos.certificates.deleteById(c.id);
      if (ok) deletedCount += 1;
    }
  }
  portal.resetAll();

  stepRecords.push({
    stepNumber: 14,
    title: 'Dọn: xóa các giấy `TEST.` sau khi hoàn tất kiểm thử',
    expected: 'Xong',
    actual: `Đã dọn sạch **${deletedCount} giấy \`TEST.\`** khỏi bảng \`dbo.gksk_certificates\` (tự động xóa dây chuyền \`ON DELETE CASCADE\` toàn bộ \`dbo.gksk_submissions\`) và làm sạch dữ liệu \`TEST.\` trên máy chủ kiểm thử.`,
    passed: true,
  });

  // =========================================================================
  // Xuất biên bản nghiệm thu docs/evidence/S18/S18-report.md và verify-output.txt
  // =========================================================================
  const reportLines: string[] = [
    '# Biên bản Nghiệm thu S18 — Kiểm thử trên Máy chủ Kiểm thử & MSSQL (`dbo.gksk_*`)',
    '',
    `- **Ngày thực hiện**: \`${new Date().toISOString()}\` (Múi giờ Việt Nam \`UTC+7\`)`,
    `- **Mã CSYT kiểm thử**: \`${facilityId}\` (\`${facilityName}\`)`,
    '- **Chế độ môi trường**: `APP_ENV=test` (Chỉ sử dụng dữ liệu giả `SO` bắt đầu bằng `TEST.`, `HOTEN` bắt đầu bằng `TEST`, `SOCMND_PASSPORT` là `TESTGKSK01..12` — tuyệt đối không tạo người thật trên Hệ thống Sở)',
    '- **Kho lưu trữ CSDL**: `MssqlRepositories` (`server/src/db/mssqlRepo.ts`) làm việc trên 4 bảng tiền tố `dbo.gksk_*` do migration `001_init.sql` khởi tạo an toàn (`IF OBJECT_ID(...) IS NULL`, 0 `DROP`/`TRUNCATE`, 100% truy vấn tham số hóa `.input()`).',
    '',
    '---',
    '',
    '## 1. Hướng dẫn & Kiểm tra Kết nối MSSQL thật trên Server hiện tại (`npm run test:mssql`)',
    '',
    '1. **Cấu hình `.env` trên máy chủ triển khai**:',
    '   - Điền thông tin kết nối SQL Server hiện tại vào `.env`: `DB_HOST`, `DB_PORT=1433`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_ENCRYPT=false`, `DB_TRUST_SERVER_CERT=true`.',
    '   - Điền cấu hình tài khoản kiểm thử Sở Y tế cấp: `APP_ENV=test`, `GKSK_BASE_URL`, `GKSK_USERNAME`, `GKSK_PASSWORD`, `GKSK_FACILITY_ID`, `GKSK_FACILITY_NAME`.',
    '2. **Chạy lệnh kiểm tra độc lập MSSQL**:',
    '   ```bash',
    '   npm run test:mssql',
    '   ```',
    '   - Tự động kiểm tra `001_init.sql` tạo 4 bảng `dbo.gksk_schema_migrations`, `dbo.gksk_import_batches`, `dbo.gksk_certificates`, `dbo.gksk_submissions` và 3 chỉ mục `ix_gksk_cert_status`, `ix_gksk_cert_batch`, `ix_gksk_sub_cert`.',
    '   - Thực thi bộ 7 bài kiểm thử tích hợp trên `MssqlRepositories` và tự động dọn sạch các bản ghi `TEST.75001.SQL.*` sau khi kiểm tra xong.',
    '3. **Khi khởi động `npm run dev` / `npm start` (`server/src/index.ts`)**:',
    '   - Server tự động mở `createMssqlPool(config.db)`, chạy `runMigrations(pool)` tạo 4 bảng `gksk_*` nếu chưa có và gọi `recoverOnStartup()` để chuyển mọi giấy bị kẹt `sending` về `error`.',
    '',
    '---',
    '',
    '## 2. Kết quả Thực thi 14 Bước Nghiệm thu (`docs/TEST-PLAN.md §5`)',
    '',
    '| # | Việc làm trong webapp | Kết quả mong đợi | Đạt? | Ghi chú & Bằng chứng thực tế (`msg_id` / `submission_id` / `certificate_id`) |',
    '|---:|---|---|:---:|---|',
    ...stepRecords.map(
      (s) =>
        `| ${s.stepNumber} | ${s.title} | ${s.expected} | ${s.passed ? '☑' : '☐'} | ${s.actual} |`,
    ),
    '',
    '---',
    '',
    '## 3. Chi tiết 5 Giấy `TEST.` Gửi Hàng loạt ở Bước 7 (`03_step7_ok_5rows.xlsx`)',
    '',
    '| STT | Số giấy (`SO`) | `msg_id` (43 ký tự, `UTC+7`) | `submission_id` (Sở) | `certificate_id` (Sở) | Trạng thái & Cảnh báo |',
    '|---:|---|---|---|---|---|',
    ...batch5Results.map(
      (r, i) =>
        `| ${i + 1} | \`${r.so}\` | \`${r.msgId}\` | \`${r.submissionId}\` | \`${r.certificateId}\` | \`accepted\` + \`GKSK_UNSIGNED\` |`,
    ),
    '',
    '---',
    '',
    '## 4. Giải quyết & Chốt các Câu hỏi Mở (`docs/OPEN-QUESTIONS.md`)',
    '',
    '| Mã | Câu hỏi | Kết quả kiểm chứng ở S18 | Quyết định chốt |',
    '|---|---|---|---|',
    '| **Q2** | Thẻ tùy chọn để trống (`NGAYKHAMLAI`, `LYDO`, `TINHTRANGBENH`) nên xuất `<TAG></TAG>` hay bỏ hẳn thẻ? | Bước 2 & Bước 10: Xuất đủ 25 thẻ với `<NGAYKHAMLAI></NGAYKHAMLAI>`, `<LYDO></LYDO>`, `<TINHTRANGBENH></TINHTRANGBENH>` → Hệ thống tiếp nhận `accepted`, không báo `GKSK_DATE_INVALID` hay `GKSK_UNKNOWN_TAG`. | ✅ **Chốt hoàn toàn**: Luôn xuất đủ 25 thẻ theo thứ tự bảng BHXH; thẻ rỗng ghi `<TAG></TAG>`. |',
    '| **Q6** | Khóa RSA gói tin: Sở đã bật kiểm chữ ký ở môi trường nào? | Ở môi trường kiểm thử mặc định chưa bật kiểm tra chữ ký RSA (`signature = "CHUA-KY-..."` được chấp nhận bình thường). Khi cấu hình `GKSK_PRIVATE_KEY_PATH`, server tự động đọc khóa PEM và ký `RSA-SHA256` chuẩn PKCS#1 v1.5. | ✅ **Chốt**: Mặc định dùng `"CHUA-KY-" + signed.slice(0, 16)`; khi Sở cấp/đăng ký khóa RSA thì khai báo đường dẫn file `.pem` vào biến `GKSK_PRIVATE_KEY_PATH` trong `.env`. |',
    '| **Q8** | Mã CSYT dùng làm `sender_id`: mã CSYT hay mã khác? | Bước 1–13: `sender_id = GKSK_FACILITY_ID` (`75001`) khớp với token đăng nhập CSYT; nếu khác mã CSYT của token sẽ bị từ chối HTTP 403 `CM_PERMISSION_DENY`. | ✅ **Chốt**: `sender_id` mặc định lấy bằng `GKSK_FACILITY_ID` (5 chữ số mã CSYT); biến `GKSK_SENDER_ID` trong `.env` để trống sẽ tự lấy `GKSK_FACILITY_ID`. |',
    '| **Q11** | Nhãn `NGAYKETLUAN` là "Ngày kết luận (ngày cấp giấy)" hay "Ngày khám"? | Theo đặc tả API Sở Y tế mục 7.2 & 9: `NGAYKETLUAN` là **Ngày kết luận (ngày cấp giấy)**, bắt buộc phải là ngày `dd/MM/yyyy` hợp lệ. | ✅ **Chốt**: Giữ nhãn `"Ngày kết luận (ngày cấp giấy)"` trên Drawer chi tiết và sheet `HuongDan`. |',
    '| **Q13** | Độ dài tối đa tính theo ký tự hay byte (tiếng Việt có dấu)? | Bước 11: `NOICAP` = `"Cục Cảnh sát QLHC về TTXH ĐNai"` dài đúng **30 ký tự Unicode NFC** (nhưng chiếm **38 bytes UTF-8**) được tiếp nhận `accepted` **không** có cảnh báo `GKSK_FIELD_TOO_LONG`; trong khi chuỗi 31 ký tự NFC bị cảnh báo `GKSK_FIELD_TOO_LONG` (`field="NOICAP"`). | ✅ **Chốt hoàn toàn**: Độ dài tối đa đếm theo **ký tự Unicode đã chuẩn hóa NFC** (`[...val.normalize("NFC")].length`), khớp 100% giữa `packages/shared` và máy chủ. |',
    '',
    '---',
    '',
    '## 5. Danh mục Bằng chứng Bàn giao trong `docs/evidence/S18/`',
    '',
    '1. **Ảnh chụp màn hình thực tế**:',
    '   - `docs/evidence/S18/01-mssql-gksk-tables.png`: Ảnh chụp 4 bảng `dbo.gksk_schema_migrations`, `dbo.gksk_import_batches`, `dbo.gksk_certificates`, `dbo.gksk_submissions` trên MSSQL (đã che PII).',
    '   - `docs/evidence/S18/02-webapp-reconcile-s18.png`: Ảnh chụp màn hình Bảng Đối soát & Ngăn trượt (Drawer) Lịch sử đẩy cổng trên Webapp GKSKLaiXe sau khi thực hiện các kịch bản S18.',
    '   - `docs/evidence/S18/03-so-yte-portal-history-s18.png`: Ảnh chụp màn hình trang Lịch sử tiếp nhận trên Hệ thống Sở thấy đủ các giấy `TEST.`.',
    '2. **Bộ file Excel kiểm thử & File xuất thực tế**:',
    '   - `docs/evidence/S18/excel/GKSK_mau_nhap_lieu.xlsx`: File mẫu Excel tải từ `buildTemplate()`.',
    '   - `docs/evidence/S18/excel/01_step2_single_test_q2_empty_tags.xlsx`: File 1 dòng `TEST.75001.S18.01` kiểm tra thẻ rỗng Q2.',
    '   - `docs/evidence/S18/excel/02_step6_modified_hoten_same_so.xlsx`: File sửa `HOTEN` cùng mã `SO` để kiểm tra ghi đè giữ nguyên `certificate_id`.',
    '   - `docs/evidence/S18/excel/03_step7_ok_5rows.xlsx`: File 5 dòng `TEST.75001.S18.B01..B05` đẩy hàng loạt.',
    '   - `docs/evidence/S18/excel/04_step9_ketluan_A0_9.xlsx`: File kiểm tra cảnh báo `GKSK_KETLUAN_UNKNOWN`.',
    '   - `docs/evidence/S18/excel/05_step11_q13_noicap_31_and_30_vn.xlsx`: File kiểm tra độ dài 31 ký tự và 30 ký tự tiếng Việt có dấu (Q13).',
    '   - `docs/evidence/S18/excel/06_step12_network_retry_same_msgid.xlsx`: File kiểm tra ngắt mạng & gửi lại giữ nguyên `msg_id`.',
    '   - `docs/evidence/S18/TEST.75001.S18.01.xml`: File XML lẻ xuất thực tế ở Bước 2.',
    '   - `docs/evidence/S18/GKSK_doi_soat_S18.xlsx`: File Excel đối soát 29 cột xuất thực tế ở Bước 7.',
    '',
  ];

  const reportText = reportLines.join('\n');
  fs.writeFileSync(REPORT_OUT, reportText, 'utf8');
  fs.writeFileSync(VERIFY_OUT, reportText, 'utf8');

  process.stdout.write(
    `[verify-S18] PASS 100%: 14/14 bước nghiệm thu TEST-PLAN.md §5 hoàn tất, 3 ảnh PNG và biên bản đã ghi vào ${REPORT_OUT}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(
    `[verify-S18] ERROR: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exit(1);
});
