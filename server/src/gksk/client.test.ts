import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GkskRecord } from '@gksk/shared';
import { createMockGkskApp } from '../../../tools/mock-gksk-api/dist/app.js';
import { createLogger } from '../logger.js';
import {
  createGkskClient,
  TOKEN_EXPIRY_BUFFER_MS,
} from './client.js';
import {
  buildEnvelope,
  newMsgId,
  type GkskEnvelope,
} from './envelope.js';
import {
  classifyHttpFailure,
  normalizeServerIssues,
  parseLenientPushData,
  parseRetryAfterSeconds,
} from './errors.js';
import { defaultSleep } from './retry.js';
import { buildGkskXml } from './xml.js';

function makeValidRecord(overrides: Partial<GkskRecord> = {}): GkskRecord {
  return {
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
    ...overrides,
  };
}

function makeTestEnvelope(params?: {
  senderId?: string;
  nowMs?: number;
  recordOverrides?: Partial<GkskRecord>;
}): GkskEnvelope {
  const senderId = params?.senderId ?? '75001';
  const nowMs = params?.nowMs ?? Date.parse('2026-11-23T08:00:00Z');
  const record = makeValidRecord(params?.recordOverrides);
  const xml = buildGkskXml(record);
  const msgId = newMsgId(senderId, nowMs);
  return buildEnvelope({
    senderId,
    xml,
    msgId,
    sendDatetime: nowMs,
  });
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

describe('server/src/gksk/{client,errors,retry}.ts — S7 GKSK Client & 13 kịch bản TEST-PLAN §3.3', () => {
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = createMockGkskApp({
      currentYear: 2026,
      defaultTimeoutMs: 250,
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  beforeEach(async () => {
    await fetch(`${baseUrl}/__mock/reset`, { method: 'POST' });
  });

  async function setMockFail(payload: {
    mode: string | null;
    count?: number;
    retryAfterSec?: number;
    timeoutMs?: number;
  }): Promise<void> {
    const res = await fetch(`${baseUrl}/__mock/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
  }

  async function getMockState(): Promise<MockServerState> {
    const res = await fetch(`${baseUrl}/__mock/state`);
    expect(res.status).toBe(200);
    return (await res.json()) as MockServerState;
  }

  it('1. login() cache token đúng tới (now + duration - 5 phút) và tự làm mới khi chạm mốc hết hạn', async () => {
    let clockMs = Date.parse('2026-11-23T01:00:00Z');
    const logCollector = createLogCollector();
    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      now: () => clockMs,
      sleep: async (ms) => {
        clockMs += ms;
      },
      logger: logCollector.logger,
    });

    const firstLogin = await client.login();
    expect(firstLogin.ok).toBe(true);
    if (!firstLogin.ok) {
      throw new Error('Expected firstLogin.ok === true');
    }
    expect(firstLogin.fromCache).toBe(false);
    expect(firstLogin.durationMinutes).toBe(720);

    // Kỳ vọng cache tới: now + 720 phút - 5 phút = now + 715 phút
    const expectedExpiresAt =
      Date.parse('2026-11-23T01:00:00Z') + 720 * 60_000 - TOKEN_EXPIRY_BUFFER_MS;
    expect(firstLogin.expiresAtMs).toBe(expectedExpiresAt);
    expect(client.getCachedTokenMetadata()?.expiresAtMs).toBe(expectedExpiresAt);

    // Trước mốc hết hạn 1 ms -> dùng cache, không gọi HTTP login lần 2
    clockMs = expectedExpiresAt - 1;
    const secondLogin = await client.login();
    expect(secondLogin.ok).toBe(true);
    if (secondLogin.ok) {
      expect(secondLogin.fromCache).toBe(true);
      expect(secondLogin.token).toBe(firstLogin.token);
    }

    let state = await getMockState();
    expect(state.requests.filter((r) => r.path === '/api/auth/login')).toHaveLength(1);

    // Đúng tại mốc (now + duration - 5 phút) -> cache hết hạn, gọi HTTP login mới
    clockMs = expectedExpiresAt;
    const thirdLogin = await client.login();
    expect(thirdLogin.ok).toBe(true);
    if (thirdLogin.ok) {
      expect(thirdLogin.fromCache).toBe(false);
      expect(thirdLogin.token).not.toBe(firstLogin.token);
    }

    state = await getMockState();
    expect(state.requests.filter((r) => r.path === '/api/auth/login')).toHaveLength(2);
  });

  it('2. [TEST-PLAN §3.3 #1] Thành công + GKSK_UNSIGNED -> kind=accepted, warnings có GKSK_UNSIGNED', async () => {
    let clockMs = Date.parse('2026-11-23T02:00:00Z');
    const logCollector = createLogCollector();
    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      now: () => clockMs,
      sleep: async (ms) => {
        clockMs += ms;
      },
      logger: logCollector.logger,
    });

    const envelope = makeTestEnvelope({ nowMs: clockMs });
    const result = await client.push(envelope);

    expect(result.kind).toBe('accepted');
    if (result.kind !== 'accepted') {
      throw new Error('Expected accepted result');
    }
    expect(result.status).toBe('accepted');
    expect(result.attempts).toBe(1);
    expect(result.recoveredViaStatus).toBe(false);
    expect(result.msgId).toBe(envelope.header.msg_id);
    expect(result.submissionId.length).toBeGreaterThan(10);
    expect(result.certificateId).not.toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContainEqual({ code: 'GKSK_UNSIGNED', field: null });
  });

  it('3. [TEST-PLAN §3.3 #2] Bị từ chối (IDBENHVIEN khác) -> kind=rejected, errors có GKSK_FACILITY_MISMATCH, KHÔNG retry', async () => {
    let clockMs = Date.parse('2026-11-23T02:10:00Z');
    const sleepCalls: number[] = [];
    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      now: () => clockMs,
      sleep: async (ms) => {
        sleepCalls.push(ms);
        clockMs += ms;
      },
    });

    const envelope = makeTestEnvelope({
      nowMs: clockMs,
      recordOverrides: { IDBENHVIEN: '75999' },
    });
    const result = await client.push(envelope);

    expect(result.kind).toBe('rejected');
    if (result.kind !== 'rejected') {
      throw new Error('Expected rejected result');
    }
    expect(result.status).toBe('rejected');
    expect(result.httpStatus).toBe(200);
    expect(result.resCode).toBe('PS_SYNC_SUCCESS');
    expect(result.attempts).toBe(1);
    expect(result.certificateId).toBeNull();
    expect(result.errors).toContainEqual({
      code: 'GKSK_FACILITY_MISMATCH',
      field: 'IDBENHVIEN',
    });
    expect(sleepCalls).toEqual([]);

    const state = await getMockState();
    expect(
      state.requests.filter((r) => r.path === '/api/platform/gksk-lai-xe/push'),
    ).toHaveLength(1);
    expect(
      state.requests.filter((r) => r.path === '/api/platform/gksk-lai-xe/status'),
    ).toHaveLength(0);
  });

  it('4. [TEST-PLAN §3.3 #3] Timeout lần 1 (fail timeout ×1) -> gọi status 404 ở giữa rồi push lần 2 thành công với CÙNG msg_id, send_datetime, data, signature', async () => {
    let clockMs = Date.parse('2026-11-23T02:20:00Z');
    const sleepCalls: number[] = [];
    const capturedPushBodies: Array<{
      header: Record<string, unknown>;
      data: string;
      signature: string;
    }> = [];

    const customFetch: typeof fetch = async (input, init) => {
      const urlStr = typeof input === 'string' ? input : input.toString();
      if (urlStr.endsWith('/api/platform/gksk-lai-xe/push') && init?.body) {
        capturedPushBodies.push(
          JSON.parse(String(init.body)) as {
            header: Record<string, unknown>;
            data: string;
            signature: string;
          },
        );
      }
      return globalThis.fetch(input, init);
    };

    await setMockFail({ mode: 'timeout', count: 1, timeoutMs: 300 });

    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      httpTimeoutMs: 60,
      now: () => clockMs,
      sleep: async (ms) => {
        sleepCalls.push(ms);
        clockMs += ms;
      },
      fetchImpl: customFetch,
    });

    const envelope = makeTestEnvelope({ nowMs: clockMs });
    const result = await client.push(envelope);

    expect(result.kind).toBe('accepted');
    expect(result.attempts).toBe(2);
    expect(result.recoveredViaStatus).toBe(false);
    expect(sleepCalls).toEqual([5_000]);

    // Xác nhận 2 lần push có CÙNG msg_id, send_datetime, data, signature
    expect(capturedPushBodies).toHaveLength(2);
    const [firstPush, secondPush] = capturedPushBodies;
    expect(firstPush).toBeDefined();
    expect(secondPush).toBeDefined();
    expect(secondPush?.header.msg_id).toBe(envelope.header.msg_id);
    expect(secondPush?.header.msg_id).toBe(firstPush?.header.msg_id);
    expect(secondPush?.header.send_datetime).toBe(firstPush?.header.send_datetime);
    expect(secondPush?.data).toBe(firstPush?.data);
    expect(secondPush?.signature).toBe(firstPush?.signature);

    // Xác nhận thứ tự gọi trên Mock Server: login -> push (timeout) -> status (404) -> push (200)
    const state = await getMockState();
    const apiOrder = state.requests.map((r) => `${r.method} ${r.path} (${r.note})`);
    expect(apiOrder).toEqual([
      'POST /api/auth/login (login_success)',
      'POST /api/platform/gksk-lai-xe/push (mock_fail_timeout_300ms)',
      'GET /api/platform/gksk-lai-xe/status (status_not_found)',
      'POST /api/platform/gksk-lai-xe/push (push_accepted)',
    ]);
  });

  it('5. [TEST-PLAN §3.3 #4] Mất phản hồi nhưng server đã xử lý (disconnect-after-save) -> status trả 200 -> trả kết quả luôn, KHÔNG push lần 2', async () => {
    let clockMs = Date.parse('2026-11-23T02:30:00Z');
    const sleepCalls: number[] = [];

    await setMockFail({ mode: 'disconnect-after-save', count: 1 });

    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      now: () => clockMs,
      sleep: async (ms) => {
        sleepCalls.push(ms);
        clockMs += ms;
      },
    });

    const envelope = makeTestEnvelope({ nowMs: clockMs });
    const result = await client.push(envelope);

    expect(result.kind).toBe('accepted');
    if (result.kind !== 'accepted') {
      throw new Error('Expected accepted result recovered via status');
    }
    expect(result.recoveredViaStatus).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.msgId).toBe(envelope.header.msg_id);
    expect(sleepCalls).toEqual([5_000]);

    // Xác nhận chỉ có ĐÚNG 1 lần gọi push và 1 lần gọi status (200)
    const state = await getMockState();
    const pushRequests = state.requests.filter(
      (r) => r.path === '/api/platform/gksk-lai-xe/push',
    );
    const statusRequests = state.requests.filter(
      (r) => r.path === '/api/platform/gksk-lai-xe/status',
    );
    expect(pushRequests).toHaveLength(1);
    expect(statusRequests).toHaveLength(1);
    expect(statusRequests[0]?.httpStatus).toBe(200);
  });

  it('6. [TEST-PLAN §3.3 #5] HTTP 429 (Retry-After: 2 ×1) -> chờ đúng 2s (đồng hồ giả), push lại cùng msg_id thành công', async () => {
    let clockMs = Date.parse('2026-11-23T02:40:00Z');
    const sleepCalls: number[] = [];

    await setMockFail({ mode: '429', count: 1, retryAfterSec: 2 });

    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      now: () => clockMs,
      sleep: async (ms) => {
        sleepCalls.push(ms);
        clockMs += ms;
      },
    });

    const envelope = makeTestEnvelope({ nowMs: clockMs });
    const result = await client.push(envelope);

    expect(result.kind).toBe('accepted');
    expect(result.attempts).toBe(2);
    expect(result.msgId).toBe(envelope.header.msg_id);
    // Phải chờ đúng 2000 ms theo Retry-After: 2 chứ không phải 5000 ms mặc định
    expect(sleepCalls).toEqual([2_000]);

    const state = await getMockState();
    const pushRequests = state.requests.filter(
      (r) => r.path === '/api/platform/gksk-lai-xe/push',
    );
    expect(pushRequests).toHaveLength(2);
    expect(pushRequests[0]?.msgId).toBe(envelope.header.msg_id);
    expect(pushRequests[1]?.msgId).toBe(envelope.header.msg_id);
  });

  it('7. [TEST-PLAN §3.3 #6] HTTP 500 liên tục (500 ×4) -> kind=transient sau 3 lần thử lại, đúng khoảng chờ 5s -> 15s -> 45s', async () => {
    let clockMs = Date.parse('2026-11-23T02:50:00Z');
    const sleepCalls: number[] = [];

    await setMockFail({ mode: '500', count: 4 });

    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      now: () => clockMs,
      sleep: async (ms) => {
        sleepCalls.push(ms);
        clockMs += ms;
      },
    });

    const envelope = makeTestEnvelope({ nowMs: clockMs });
    const result = await client.push(envelope);

    expect(result.kind).toBe('transient');
    if (result.kind !== 'transient') {
      throw new Error('Expected transient failure after 4 x 500');
    }
    expect(result.reason).toBe('http_5xx');
    expect(result.httpStatus).toBe(500);
    expect(result.resCode).toBe('PS_DS_SAVE_FAIL');
    expect(result.attempts).toBe(4);
    expect(sleepCalls).toEqual([5_000, 15_000, 45_000]);

    const state = await getMockState();
    const pushRequests = state.requests.filter(
      (r) => r.path === '/api/platform/gksk-lai-xe/push',
    );
    const statusRequests = state.requests.filter(
      (r) => r.path === '/api/platform/gksk-lai-xe/status',
    );
    expect(pushRequests).toHaveLength(4);
    // Trước mỗi lần retry (3 lần) sau lỗi 500 đều phải gọi status trước
    expect(statusRequests).toHaveLength(3);
    expect(pushRequests.every((r) => r.msgId === envelope.header.msg_id)).toBe(true);
  });

  it('8. [TEST-PLAN §3.3 #7] HTTP 403 hết hạn (403-once) -> tự động login lại đúng 1 lần, push lại cùng msg_id thành công', async () => {
    let clockMs = Date.parse('2026-11-23T03:00:00Z');
    const sleepCalls: number[] = [];

    await setMockFail({ mode: '403-once', count: 1 });

    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      now: () => clockMs,
      sleep: async (ms) => {
        sleepCalls.push(ms);
        clockMs += ms;
      },
    });

    const envelope = makeTestEnvelope({ nowMs: clockMs });
    const result = await client.push(envelope);

    expect(result.kind).toBe('accepted');
    expect(result.attempts).toBe(2);
    expect(result.msgId).toBe(envelope.header.msg_id);
    expect(sleepCalls).toEqual([]);

    const state = await getMockState();
    const loginRequests = state.requests.filter((r) => r.path === '/api/auth/login');
    const pushRequests = state.requests.filter(
      (r) => r.path === '/api/platform/gksk-lai-xe/push',
    );
    // 1 lần login đầu + 1 lần login lại sau 403 = 2 lần login
    expect(loginRequests).toHaveLength(2);
    expect(pushRequests).toHaveLength(2);
    expect(pushRequests[0]?.httpStatus).toBe(403);
    expect(pushRequests[1]?.httpStatus).toBe(200);
    expect(pushRequests[1]?.msgId).toBe(envelope.header.msg_id);
  });

  it('9. [TEST-PLAN §3.3 #8] HTTP 403 kéo dài (403 ×2) -> login lại đúng 1 lần, lần push 2 vẫn 403 -> trả kind=config và dừng', async () => {
    let clockMs = Date.parse('2026-11-23T03:10:00Z');
    const sleepCalls: number[] = [];

    await setMockFail({ mode: '403', count: 2 });

    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      now: () => clockMs,
      sleep: async (ms) => {
        sleepCalls.push(ms);
        clockMs += ms;
      },
    });

    const envelope = makeTestEnvelope({ nowMs: clockMs });
    const result = await client.push(envelope);

    expect(result.kind).toBe('config');
    if (result.kind !== 'config') {
      throw new Error('Expected config error on persistent 403');
    }
    expect(result.reason).toBe('http_403');
    expect(result.httpStatus).toBe(403);
    expect(result.resCode).toBe('CM_PERMISSION_DENY');
    expect(result.attempts).toBe(2);
    expect(sleepCalls).toEqual([]);

    const state = await getMockState();
    // Chỉ login lại đúng 1 lần (tổng 2 lần login), không lặp vô tận
    expect(state.requests.filter((r) => r.path === '/api/auth/login')).toHaveLength(2);
    expect(
      state.requests.filter((r) => r.path === '/api/platform/gksk-lai-xe/push'),
    ).toHaveLength(2);
  });

  it('10. [TEST-PLAN §3.3 #9] Login sai -> kind=config, không retry, không chứa mật khẩu/token trong thông điệp', async () => {
    let clockMs = Date.parse('2026-11-23T03:20:00Z');
    const sleepCalls: number[] = [];
    const secretWrongPassword = 'SUPER_SECRET_WRONG_PASS_999';
    const logCollector = createLogCollector();

    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: secretWrongPassword,
      now: () => clockMs,
      sleep: async (ms) => {
        sleepCalls.push(ms);
        clockMs += ms;
      },
      logger: logCollector.logger,
    });

    const envelope = makeTestEnvelope({ nowMs: clockMs });
    const result = await client.push(envelope);

    expect(result.kind).toBe('config');
    if (result.kind !== 'config') {
      throw new Error('Expected config result on login failure');
    }
    expect(result.reason).toBe('login_failed');
    expect(result.httpStatus).toBe(401);
    expect(result.attempts).toBe(0);
    expect(sleepCalls).toEqual([]);
    expect(result.message).not.toContain(secretWrongPassword);
    expect(result.message).not.toContain('mock-token');
    expect(logCollector.getRawOutput()).not.toContain(secretWrongPassword);

    const state = await getMockState();
    expect(state.requests.filter((r) => r.path === '/api/auth/login')).toHaveLength(1);
    expect(
      state.requests.filter((r) => r.path === '/api/platform/gksk-lai-xe/push'),
    ).toHaveLength(0);
  });

  it('11. [TEST-PLAN §3.3 #10] HTTP 400 envelope (CM_INVALID_REQUEST) -> kind=config (lỗi lập trình), KHÔNG retry', async () => {
    let clockMs = Date.parse('2026-11-23T03:30:00Z');
    const sleepCalls: number[] = [];

    await setMockFail({ mode: '400', count: 1 });

    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      now: () => clockMs,
      sleep: async (ms) => {
        sleepCalls.push(ms);
        clockMs += ms;
      },
    });

    const envelope = makeTestEnvelope({ nowMs: clockMs });
    const result = await client.push(envelope);

    expect(result.kind).toBe('config');
    if (result.kind !== 'config') {
      throw new Error('Expected config result on HTTP 400');
    }
    expect(result.reason).toBe('http_400');
    expect(result.httpStatus).toBe(400);
    expect(result.resCode).toBe('CM_INVALID_REQUEST');
    expect(result.attempts).toBe(1);
    expect(sleepCalls).toEqual([]);

    const state = await getMockState();
    expect(
      state.requests.filter((r) => r.path === '/api/platform/gksk-lai-xe/push'),
    ).toHaveLength(1);
  });

  it('12. [TEST-PLAN §3.3 #11] HTTP 409 trùng msg_id -> sinh msg_id mới, ký lại và thử đúng 1 lần', async () => {
    let clockMs = Date.parse('2026-11-23T03:40:00Z');
    await setMockFail({ mode: '409', count: 1 });

    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      now: () => clockMs,
      sleep: async (ms) => {
        clockMs += ms;
      },
    });

    const initialEnvelope = makeTestEnvelope({ nowMs: clockMs });
    const initialMsgId = initialEnvelope.header.msg_id;

    const result = await client.push(initialEnvelope);

    expect(result.kind).toBe('accepted');
    expect(result.attempts).toBe(2);
    expect(result.msgId).not.toBe(initialMsgId);
    expect(result.envelope.header.msg_id).toBe(result.msgId);
    expect(result.envelope.signature).not.toBe(initialEnvelope.signature);

    const state = await getMockState();
    const pushRequests = state.requests.filter(
      (r) => r.path === '/api/platform/gksk-lai-xe/push',
    );
    expect(pushRequests).toHaveLength(2);
    expect(pushRequests[0]?.msgId).toBe(initialMsgId);
    expect(pushRequests[1]?.msgId).toBe(result.msgId);

    // Nếu 409 lặp lại lần 2 -> dừng ngay sau đúng 1 lần đổi msg_id
    await setMockFail({ mode: '409', count: 2 });
    const secondEnvelope = makeTestEnvelope({ nowMs: clockMs });
    const fail409Result = await client.push(secondEnvelope);
    expect(fail409Result.kind).toBe('config');
    if (fail409Result.kind === 'config') {
      expect(fail409Result.reason).toBe('http_409');
      expect(fail409Result.attempts).toBe(2);
    }
  });

  it('13. [TEST-PLAN §3.3 #12] header.ref_msg_id lệch -> báo lỗi bất thường (isAbnormal=true), không retry, không ghi đè kết quả', async () => {
    let clockMs = Date.parse('2026-11-23T03:50:00Z');
    await setMockFail({ mode: 'mismatched-ref-msg-id', count: 1 });

    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      now: () => clockMs,
      sleep: async (ms) => {
        clockMs += ms;
      },
    });

    const envelope = makeTestEnvelope({ nowMs: clockMs });
    const result = await client.push(envelope);

    expect(result.kind).not.toBe('accepted');
    expect(result.kind).not.toBe('rejected');
    expect(result.kind).toBe('transient');
    if (result.kind !== 'transient') {
      throw new Error('Expected transient abnormal error for ref_msg_id mismatch');
    }
    expect(result.reason).toBe('ref_msg_id_mismatch');
    expect(result.isAbnormal).toBe(true);
    expect(result.retryable).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.message).toContain('Lỗi bất thường');
    expect(result.message).toContain('ref_msg_id');

    const state = await getMockState();
    expect(
      state.requests.filter((r) => r.path === '/api/platform/gksk-lai-xe/push'),
    ).toHaveLength(1);
  });

  it('14. [TEST-PLAN §3.3 #13] Phản hồi lạ (thiếu warnings/errors, thêm trường mới) -> parse khoan dung, không ném lỗi', async () => {
    let clockMs = Date.parse('2026-11-23T04:00:00Z');
    await setMockFail({ mode: 'sparse-response', count: 1 });

    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      now: () => clockMs,
      sleep: async (ms) => {
        clockMs += ms;
      },
    });

    const envelope = makeTestEnvelope({ nowMs: clockMs });
    const result = await client.push(envelope);

    expect(result.kind).toBe('accepted');
    if (result.kind !== 'accepted') {
      throw new Error('Expected accepted result for sparse-response');
    }
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.submissionId.length).toBeGreaterThan(10);
  });

  it('15. Spy logger khẳng định TUYỆT ĐỐI KHÔNG bao giờ log token, Authorization, mật khẩu hay dữ liệu PII', async () => {
    let clockMs = Date.parse('2026-11-23T05:00:00Z');
    const logCollector = createLogCollector();

    const client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      now: () => clockMs,
      sleep: async (ms) => {
        clockMs += ms;
      },
      logger: logCollector.logger,
    });

    // Chạy qua cả luồng login, push thành công, status 200, status 404, và 403 re-login
    const envelope1 = makeTestEnvelope({
      nowMs: clockMs,
      recordOverrides: {
        HOTEN: 'TEST NGUYEN BI MAT PII',
        SOCMND_PASSPORT: 'TESTGKSK99',
        NONGDOCON: '0.35',
        LYDO: 'LY DO NHAY CAM KHONG DUOC LOG',
      },
    });
    const res1 = await client.push(envelope1);
    expect(res1.kind).toBe('accepted');

    const statusFound = await client.status(envelope1.header.msg_id);
    expect(statusFound.found).toBe(true);

    const statusMissing = await client.status(newMsgId('75001', clockMs));
    expect(statusMissing.kind).toBe('not_found');

    await setMockFail({ mode: '403-once', count: 1 });
    const envelope2 = makeTestEnvelope({ nowMs: clockMs });
    const res2 = await client.push(envelope2);
    expect(res2.kind).toBe('accepted');

    // Kiểm tra toàn bộ dòng JSON xuất ra từ pino logger
    const rawLog = logCollector.getRawOutput();
    expect(rawLog.length).toBeGreaterThan(0);
    expect(rawLog).not.toContain('mock-token-');
    expect(rawLog).not.toContain('mock-refresh-');
    expect(rawLog).not.toContain('Bearer ');
    expect(rawLog).not.toContain('"password"');
    expect(rawLog).not.toContain('TEST NGUYEN BI MAT PII');
    expect(rawLog).not.toContain('TESTGKSK99');
    expect(rawLog).not.toContain('LY DO NHAY CAM KHONG DUOC LOG');
    expect(rawLog).not.toContain(envelope1.data);

    // Kiểm tra cả tham số truyền trực tiếp vào spy logger.info/warn/error/debug
    for (const spy of logCollector.spies) {
      for (const call of spy.mock.calls) {
        const serializedCall = JSON.stringify(call);
        expect(serializedCall).not.toContain('mock-token-');
        expect(serializedCall).not.toContain('Bearer ');
        expect(serializedCall).not.toContain('TEST NGUYEN BI MAT PII');
        expect(serializedCall).not.toContain(envelope1.data);
      }
    }
  });

  it('16. Kiểm thử đơn vị các hàm phân loại và parse khoan dung trong errors.ts', () => {
    expect(normalizeServerIssues(null)).toEqual([]);
    expect(normalizeServerIssues('invalid')).toEqual([]);
    expect(
      normalizeServerIssues([
        null,
        { code: '  ' },
        { code: 'GKSK_UNSIGNED', field: null, extra: 'ignored' },
        { code: 'GKSK_FACILITY_MISMATCH', field: 'IDBENHVIEN' },
      ]),
    ).toEqual([
      { code: 'GKSK_UNSIGNED', field: null },
      { code: 'GKSK_FACILITY_MISMATCH', field: 'IDBENHVIEN' },
    ]);

    expect(parseLenientPushData(null)).toBeNull();
    expect(parseLenientPushData({ status: 'unknown' })).toBeNull();
    expect(
      parseLenientPushData({
        status: 'accepted',
        submission_id: 'sub-1',
        certificate_id: 'cert-1',
        so: 'TEST.75001.1',
      }),
    ).toEqual({
      status: 'accepted',
      submission_id: 'sub-1',
      certificate_id: 'cert-1',
      so: 'TEST.75001.1',
      errors: [],
      warnings: [],
    });

    expect(parseRetryAfterSeconds(null)).toBeNull();
    expect(parseRetryAfterSeconds('abc')).toBeNull();
    expect(parseRetryAfterSeconds('0')).toBeNull();
    expect(parseRetryAfterSeconds('15')).toBe(15);
    expect(parseRetryAfterSeconds('999')).toBe(120);

    expect(
      classifyHttpFailure({
        httpStatus: 400,
        resCode: 'PS_DS_RSA_SIGNATURE_MISSING',
        resMsg: 'Thiếu chữ ký',
      }).kind,
    ).toBe('config');
    expect(
      classifyHttpFailure({
        httpStatus: 503,
        resCode: null,
        resMsg: 'Service Unavailable',
      }),
    ).toMatchObject({
      kind: 'transient',
      reason: 'http_5xx',
      retryable: true,
    });
    expect(
      classifyHttpFailure({
        httpStatus: 401,
        resCode: 'CM_PERMISSION_DENY',
        resMsg: null,
      }).kind,
    ).toBe('config');
    expect(
      classifyHttpFailure({
        httpStatus: 418,
        resCode: null,
        resMsg: null,
      }),
    ).toMatchObject({
      kind: 'config',
      reason: 'invalid_response',
      retryable: false,
    });
  });

  it('17. Kiểm thử các nhánh biên: clearTokenCache, defaultSleep, lỗi 5xx/mạng ở login & status, status 403 relogin và phản hồi 200 hỏng JSON', async () => {
    await defaultSleep(5);

    // 1. clearTokenCache & getCachedTokenMetadata
    const baseClient = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
    });
    expect(baseClient.getCachedTokenMetadata()).toBeNull();
    await baseClient.login();
    expect(baseClient.getCachedTokenMetadata()).not.toBeNull();
    baseClient.clearTokenCache();
    expect(baseClient.getCachedTokenMetadata()).toBeNull();

    // 2. login gặp lỗi mạng & lỗi 502
    const netFailClient = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const envelope = makeTestEnvelope();
    const netFailPush = await netFailClient.push(envelope);
    expect(netFailPush.kind).toBe('transient');
    const netFailPushOnce = await netFailClient.pushOnce(envelope);
    expect(netFailPushOnce.kind).toBe('transient');
    const netFailStatus = await netFailClient.status(envelope.header.msg_id);
    expect(netFailStatus.kind).toBe('transient');

    const login502Client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      fetchImpl: async () => new Response('Bad Gateway', { status: 502 }),
    });
    const login502Res = await login502Client.login();
    expect(login502Res.ok).toBe(false);
    if (!login502Res.ok) {
      expect(login502Res.kind).toBe('transient');
      expect(login502Res.reason).toBe('http_5xx');
    }

    // 3. push & status nhận HTTP 200 nhưng thiếu data.status hợp lệ, và status nhận 403 tự relogin
    let statusCallCount = 0;
    const customEdgeClient = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      fetchImpl: async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/api/auth/login')) {
          return new Response(
            JSON.stringify({
              header: { res_code: 'CM_SUCCESS' },
              data: { token: 'custom-tok', duration: 0 },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith('/push')) {
          return new Response(
            JSON.stringify({
              header: {
                res_code: 'PS_SYNC_SUCCESS',
                ref_msg_id: envelope.header.msg_id,
              },
              data: { status: 'invalid_status_value' },
            }),
            { status: 200 },
          );
        }
        statusCallCount += 1;
        if (statusCallCount === 1) {
          return new Response(
            JSON.stringify({ code: 'CM_PERMISSION_DENY', message: 'Expired' }),
            { status: 403 },
          );
        }
        if (statusCallCount === 2) {
          return new Response(
            JSON.stringify({ code: 'CM_SUCCESS', data: { status: 'bad' } }),
            { status: 200 },
          );
        }
        return new Response('Server error', { status: 500 });
      },
    });

    const malformedPushRes = await customEdgeClient.push(envelope);
    expect(malformedPushRes.kind).toBe('transient');
    if (malformedPushRes.kind === 'transient') {
      expect(malformedPushRes.reason).toBe('invalid_response');
      expect(malformedPushRes.isAbnormal).toBe(true);
    }

    const statusReloginThenInvalid = await customEdgeClient.status(envelope.header.msg_id);
    expect(statusReloginThenInvalid.kind).toBe('transient');
    expect(statusCallCount).toBe(2);

    const status500 = await customEdgeClient.status(envelope.header.msg_id);
    expect(status500.kind).toBe('transient');

    // 4. checkStatusFirst: gặp lỗi cấu hình (403 kéo dài) khi tra status
    const statusAlways403Client = createGkskClient({
      baseUrl,
      username: '75001',
      password: 'mock',
      fetchImpl: async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/api/auth/login')) {
          return new Response(
            JSON.stringify({
              header: { res_code: 'CM_SUCCESS' },
              data: { token: 'tok-1', duration: 720 },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ code: 'CM_PERMISSION_DENY', message: 'Forbidden' }),
          { status: 403 },
        );
      },
    });
    const status403PushRes = await statusAlways403Client.push(envelope, {
      checkStatusFirst: true,
    });
    expect(status403PushRes.kind).toBe('config');
  });
});
