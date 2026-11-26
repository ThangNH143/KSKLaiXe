import { Writable } from 'node:stream';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  createApp,
  DEFAULT_TEST_LOGIN_PASSWORD,
  DEFAULT_TEST_LOGIN_USER,
} from '../app.js';
import type { AppConfig } from '../config.js';
import { createLogger } from '../logger.js';
import {
  CSRF_HEADER_VALUE,
  listExpressRoutes,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from '../middleware/requireAuth.js';

function concretePath(routePath: string): string {
  return routePath.replace(/:([a-zA-Z0-9_]+)/g, (_match, paramName: string) =>
    paramName === 'jobId' ? 'test-job-id' : '1',
  );
}

function sendDynamicRequest(
  target: ReturnType<typeof request> | ReturnType<typeof request.agent>,
  method: string,
  path: string,
) {
  const lower = method.toLowerCase();
  switch (lower) {
    case 'get':
      return target.get(path);
    case 'post':
      return target.post(path);
    case 'put':
      return target.put(path);
    case 'delete':
      return target.delete(path);
    case 'patch':
      return target.patch(path);
    default:
      throw new Error(`Unsupported HTTP method: ${method}`);
  }
}

async function loginAgent(
  app: Express,
  username = DEFAULT_TEST_LOGIN_USER,
  password = DEFAULT_TEST_LOGIN_PASSWORD,
) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/login')
    .set('X-Requested-With', CSRF_HEADER_VALUE)
    .send({ username, password });
  return { agent, res };
}

describe('S12 — Xác thực ứng dụng (auth, requireAuth, CSRF, rateLimit, /api/config, helmet)', () => {
  it('1. Quét toàn bộ router của Express app: 100% endpoint nghiệp vụ trả HTTP 401 khi chưa đăng nhập', async () => {
    const app = createApp();
    const routes = listExpressRoutes(app);

    // Đảm bảo bộ quét phát hiện đầy đủ toàn bộ route đang gắn trên app
    expect(routes.length).toBeGreaterThanOrEqual(18);

    const publicRoutes = routes.filter(
      (r) =>
        (r.method === 'GET' && r.path === '/api/health') ||
        (r.method === 'GET' && r.path === '/api/config'),
    );
    const authRoutes = routes.filter((r) => r.path.startsWith('/api/auth/'));
    const businessRoutes = routes.filter(
      (r) =>
        r.path !== '/api/health' &&
        r.path !== '/api/config' &&
        !r.path.startsWith('/api/auth/'),
    );

    expect(publicRoutes).toHaveLength(2);
    expect(authRoutes).toHaveLength(3);
    expect(businessRoutes.length).toBeGreaterThanOrEqual(15);

    // Các route công khai (health, config) truy cập được không cần đăng nhập
    for (const route of publicRoutes) {
      const res = await sendDynamicRequest(
        request(app),
        route.method,
        concretePath(route.path),
      );
      expect(res.status).toBe(200);
    }

    // GET /api/auth/me chưa đăng nhập trả 401
    const meRes = await request(app).get('/api/auth/me');
    expect(meRes.status).toBe(401);
    expect(meRes.body.error.code).toBe('UNAUTHORIZED');

    // 100% endpoint nghiệp vụ trả 401 khi chưa đăng nhập (cả khi không có lẫn khi có X-Requested-With)
    for (const route of businessRoutes) {
      const url = concretePath(route.path);

      const resNoHeader = await sendDynamicRequest(request(app), route.method, url);
      expect(
        resNoHeader.status,
        `Mong đợi 401 (không header) cho ${route.method} ${route.path}`,
      ).toBe(401);
      expect(resNoHeader.body.error.code).toBe('UNAUTHORIZED');

      const resWithCsrf = await sendDynamicRequest(request(app), route.method, url).set(
        'X-Requested-With',
        CSRF_HEADER_VALUE,
      );
      expect(
        resWithCsrf.status,
        `Mong đợi 401 (có CSRF header) cho ${route.method} ${route.path}`,
      ).toBe(401);
      expect(resWithCsrf.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('2. Kiểm tra CSRF header X-Requested-With: gksk cho 100% method ghi (POST, PUT, DELETE -> thiếu/sai trả 403)', async () => {
    const app = createApp();
    const routes = listExpressRoutes(app);
    const writeRoutes = routes.filter((r) =>
      ['POST', 'PUT', 'DELETE', 'PATCH'].includes(r.method),
    );
    expect(writeRoutes.length).toBeGreaterThanOrEqual(8);

    // 2a. POST /api/auth/login thiếu X-Requested-With -> 403
    const loginNoCsrf = await request(app).post('/api/auth/login').send({
      username: DEFAULT_TEST_LOGIN_USER,
      password: DEFAULT_TEST_LOGIN_PASSWORD,
    });
    expect(loginNoCsrf.status).toBe(403);
    expect(loginNoCsrf.body.error.code).toBe('CSRF_HEADER_REQUIRED');

    // 2b. Đăng nhập hợp lệ và kiểm tra mọi route ghi khi thiếu hoặc sai X-Requested-With -> 403
    const { agent, res: loginRes } = await loginAgent(app);
    expect(loginRes.status).toBe(200);

    for (const route of writeRoutes) {
      const url = concretePath(route.path);

      const missingHeaderRes = await sendDynamicRequest(agent, route.method, url);
      expect(
        missingHeaderRes.status,
        `Mong đợi 403 khi thiếu X-Requested-With cho ${route.method} ${route.path}`,
      ).toBe(403);
      expect(missingHeaderRes.body.error.code).toBe('CSRF_HEADER_REQUIRED');

      const wrongHeaderRes = await sendDynamicRequest(agent, route.method, url).set(
        'X-Requested-With',
        'XMLHttpRequest',
      );
      expect(
        wrongHeaderRes.status,
        `Mong đợi 403 khi sai X-Requested-With cho ${route.method} ${route.path}`,
      ).toBe(403);
      expect(wrongHeaderRes.body.error.code).toBe('CSRF_HEADER_REQUIRED');
    }

    // 2c. Kiểm tra cả method PUT (không có route thật) khi thiếu X-Requested-With -> 403; có header -> 404
    const putNoCsrf = await agent.put('/api/certificates/1').send({});
    expect(putNoCsrf.status).toBe(403);
    expect(putNoCsrf.body.error.code).toBe('CSRF_HEADER_REQUIRED');

    const putWithCsrf = await agent
      .put('/api/certificates/1')
      .set('X-Requested-With', CSRF_HEADER_VALUE)
      .send({});
    expect(putWithCsrf.status).toBe(404);

    // 2d. Chặn Content-Type không phải application/json hoặc multipart/form-data (vd form submit urlencoded)
    const badContentType = await agent
      .post('/api/send')
      .set('X-Requested-With', CSRF_HEADER_VALUE)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('ids=1');
    expect(badContentType.status).toBe(403);
    expect(badContentType.body.error.code).toBe('CSRF_INVALID_CONTENT_TYPE');
  });

  it('3. Vòng đời phiên đăng nhập (login -> me -> logout -> thu hồi phiên), cờ cookie HttpOnly/SameSite=Lax/Secure và hết hạn 8 giờ', async () => {
    let fakeNowMs = Date.parse('2026-11-25T08:00:00.000Z');
    const customPassword = 'StrongPassword#2026!';
    const customHash = await bcrypt.hash(customPassword, 4);

    const app = createApp({
      appEnv: 'test',
      auth: {
        loginUser: 'admin_dn',
        loginPasswordHash: customHash,
        sessionSecret: 'test-secret-for-lifecycle-at-least-32-chars',
      },
      now: () => fakeNowMs,
    });

    // Đăng nhập thành công
    const { agent, res: loginRes } = await loginAgent(
      app,
      'admin_dn',
      customPassword,
    );
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.authenticated).toBe(true);
    expect(loginRes.body.user).toEqual({ username: 'admin_dn' });

    const setCookieHeaders = loginRes.headers['set-cookie'];
    const cookieList = Array.isArray(setCookieHeaders)
      ? setCookieHeaders
      : typeof setCookieHeaders === 'string'
        ? [setCookieHeaders]
        : [];
    const sessionCookie = cookieList.find((c) =>
      c.startsWith(`${SESSION_COOKIE_NAME}=`),
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Path=/');
    expect(sessionCookie).not.toContain('; Secure');

    // GET /api/auth/me trả thông tin người dùng
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.authenticated).toBe(true);
    expect(meRes.body.user).toEqual({ username: 'admin_dn' });

    // Truy cập endpoint nghiệp vụ thành công khi đã đăng nhập
    const batchesRes = await agent.get('/api/batches');
    expect(batchesRes.status).toBe(200);

    // Giả mạo chữ ký cookie -> 401
    const rawCookiePair = sessionCookie!.split(';')[0]!;
    const tamperedCookie = `${rawCookiePair.slice(0, -3)}XYZ`;
    const tamperedRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', tamperedCookie);
    expect(tamperedRes.status).toBe(401);

    // Đăng xuất -> xóa cookie và thu hồi phiên phía server (dùng lại cookie cũ vẫn bị 401)
    const logoutRes = await agent
      .post('/api/auth/logout')
      .set('X-Requested-With', CSRF_HEADER_VALUE);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body).toEqual({ ok: true });

    const meAfterLogout = await agent.get('/api/auth/me');
    expect(meAfterLogout.status).toBe(401);

    const replayOldCookie = await request(app)
      .get('/api/batches')
      .set('Cookie', rawCookiePair);
    expect(replayOldCookie.status).toBe(401);

    // Kiểm tra hết hạn tự động sau 8 giờ
    const { agent: agent2, res: login2 } = await loginAgent(
      app,
      'admin_dn',
      customPassword,
    );
    expect(login2.status).toBe(200);

    fakeNowMs += SESSION_TTL_MS - 1_000;
    const stillValid = await agent2.get('/api/auth/me');
    expect(stillValid.status).toBe(200);

    fakeNowMs += 2_000;
    const expired = await agent2.get('/api/auth/me');
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('UNAUTHORIZED');

    // Khi APP_ENV=production -> cookie bắt buộc có cờ Secure
    const prodApp = createApp({
      appEnv: 'production',
      baseUrl: 'https://api.dongnai.gov.vn',
      auth: {
        loginUser: 'admin_prod',
        loginPasswordHash: customHash,
        sessionSecret: 'prod-secret-for-secure-cookie-test-32-chars',
      },
    });
    const prodLogin = await request(prodApp)
      .post('/api/auth/login')
      .set('X-Requested-With', CSRF_HEADER_VALUE)
      .send({ username: 'admin_prod', password: customPassword });
    expect(prodLogin.status).toBe(200);
    const prodCookieHeader = Array.isArray(prodLogin.headers['set-cookie'])
      ? prodLogin.headers['set-cookie'][0]
      : String(prodLogin.headers['set-cookie'] ?? '');
    expect(prodCookieHeader).toContain('HttpOnly');
    expect(prodCookieHeader).toContain('SameSite=Lax');
    expect(prodCookieHeader).toContain('Secure');

    // Khi APP_ENV=production nhưng bật allowInsecureCookie=true cho mạng LAN HTTP nội bộ -> không gắn cờ Secure khi gọi qua HTTP
    const lanProdApp = createApp({
      appEnv: 'production',
      baseUrl: 'https://api.dongnai.gov.vn',
      auth: {
        loginUser: 'admin_lan',
        loginPasswordHash: customHash,
        sessionSecret: 'lan-prod-secret-for-insecure-cookie-test-32chars',
        allowInsecureCookie: true,
      },
    });
    const lanLogin = await request(lanProdApp)
      .post('/api/auth/login')
      .set('X-Requested-With', CSRF_HEADER_VALUE)
      .send({ username: 'admin_lan', password: customPassword });
    expect(lanLogin.status).toBe(200);
    const lanCookieHeader = Array.isArray(lanLogin.headers['set-cookie'])
      ? lanLogin.headers['set-cookie'][0]
      : String(lanLogin.headers['set-cookie'] ?? '');
    expect(lanCookieHeader).toContain('HttpOnly');
    expect(lanCookieHeader).toContain('SameSite=Lax');
    expect(lanCookieHeader).not.toContain('; Secure');
  });

  it('4. Giới hạn 10 lần đăng nhập sai / 15 phút / IP -> lần thứ 11 trả 429 kèm Retry-After; hết 15 phút được mở khóa', async () => {
    let fakeNowMs = Date.parse('2026-11-25T09:00:00.000Z');
    const app = createApp({
      now: () => fakeNowMs,
    });

    // 10 lần sai mật khẩu liên tiếp -> trả 401
    for (let attempt = 1; attempt <= 10; attempt++) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Requested-With', CSRF_HEADER_VALUE)
        .send({
          username: DEFAULT_TEST_LOGIN_USER,
          password: `wrong-password-${attempt}`,
        });
      expect(res.status, `Lần thử sai #${attempt} phải trả 401`).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    }

    // Lần thứ 11 (kể cả khi gửi đúng mật khẩu) -> bị chặn 429 + Retry-After
    const res11Wrong = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', CSRF_HEADER_VALUE)
      .send({
        username: DEFAULT_TEST_LOGIN_USER,
        password: 'still-wrong-password',
      });
    expect(res11Wrong.status).toBe(429);
    expect(res11Wrong.body.error.code).toBe('TOO_MANY_LOGIN_ATTEMPTS');
    const retryAfter = Number.parseInt(
      String(res11Wrong.headers['retry-after'] ?? '0'),
      10,
    );
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(900);

    const res11CorrectWhileBlocked = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', CSRF_HEADER_VALUE)
      .send({
        username: DEFAULT_TEST_LOGIN_USER,
        password: DEFAULT_TEST_LOGIN_PASSWORD,
      });
    expect(res11CorrectWhileBlocked.status).toBe(429);

    // Sau khi hết cửa sổ 15 phút -> đăng nhập đúng thành công trở lại (200)
    fakeNowMs += 15 * 60 * 1000 + 1_000;
    const resAfterWindow = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', CSRF_HEADER_VALUE)
      .send({
        username: DEFAULT_TEST_LOGIN_USER,
        password: DEFAULT_TEST_LOGIN_PASSWORD,
      });
    expect(resAfterWindow.status).toBe(200);
    expect(resAfterWindow.body.authenticated).toBe(true);
  });

  it('5. GET /api/config chỉ trả 4 trường công khai an toàn, có helmet headers và log không rò rỉ mật khẩu/bí mật', async () => {
    const logLines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        logLines.push(chunk.toString('utf8'));
        cb();
      },
    });
    const logger = createLogger({ level: 'debug', destination: stream });

    const passwordPlain = 'CanaryAppPassword!999';
    const passwordHash = await bcrypt.hash(passwordPlain, 4);

    const fullConfig: AppConfig = {
      appEnv: 'test',
      port: 3001,
      logLevel: 'debug',
      db: {
        host: 'mssql-secret-host.internal',
        port: 1433,
        user: 'sa_secret_user',
        dbPassword: 'SUPER_SECRET_DB_PASSWORD_123',
        name: 'GKSK_PROD_DB',
        encrypt: false,
        trustServerCert: true,
      },
      gksk: {
        baseUrl: 'https://gksk-test.dongnai.gov.vn:8443/api-root',
        username: '75001',
        password: 'SUPER_SECRET_CSYT_PASSWORD_456',
        facilityId: '75001',
        facilityName: 'Benh vien Da khoa Dong Nai',
        senderId: '75001',
        privateKeyPath: 'C:/secrets/gksk_private_rsa.pem',
        httpTimeoutMs: 30000,
      },
      auth: {
        loginUser: 'admin_audit',
        loginPasswordHash: passwordHash,
        sessionSecret: 'SUPER_SECRET_SESSION_KEY_789_XYZ_123456',
      },
    };

    const app = createApp({ config: fullConfig, logger });

    const cfgRes = await request(app).get('/api/config');
    expect(cfgRes.status).toBe(200);
    expect(Object.keys(cfgRes.body).sort()).toEqual([
      'appEnv',
      'baseUrlHost',
      'facilityId',
      'facilityName',
    ]);
    expect(cfgRes.body).toEqual({
      appEnv: 'test',
      facilityId: '75001',
      facilityName: 'Benh vien Da khoa Dong Nai',
      baseUrlHost: 'gksk-test.dongnai.gov.vn:8443',
    });

    const rawConfigJson = JSON.stringify(cfgRes.body);
    const forbiddenSubstrings = [
      'password',
      'token',
      'secret',
      'privateKey',
      '.pem',
      'SUPER_SECRET_DB_PASSWORD_123',
      'SUPER_SECRET_CSYT_PASSWORD_456',
      'SUPER_SECRET_SESSION_KEY_789',
      'mssql-secret-host',
      'sa_secret_user',
      'GKSK_PROD_DB',
      passwordHash,
    ];
    for (const needle of forbiddenSubstrings) {
      expect(rawConfigJson.toLowerCase()).not.toContain(needle.toLowerCase());
    }

    // Kiểm tra security headers từ helmet
    expect(cfgRes.headers['x-content-type-options']).toBe('nosniff');
    expect(cfgRes.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(cfgRes.headers['x-powered-by']).toBeUndefined();

    // Kiểm tra log khi đăng nhập sai, đúng và đăng xuất không chứa mật khẩu/hash/secret
    await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', CSRF_HEADER_VALUE)
      .send({ username: 'admin_audit', password: 'WrongCanaryPassword!888' });
    const { agent } = await loginAgent(app, 'admin_audit', passwordPlain);
    await agent
      .post('/api/auth/logout')
      .set('X-Requested-With', CSRF_HEADER_VALUE);

    const rawLogs = logLines.join('\n');
    expect(rawLogs).not.toContain(passwordPlain);
    expect(rawLogs).not.toContain('WrongCanaryPassword!888');
    expect(rawLogs).not.toContain(passwordHash);
    expect(rawLogs).not.toContain('SUPER_SECRET_SESSION_KEY_789');
    expect(rawLogs).not.toContain(SESSION_COOKIE_NAME);
  });
});
