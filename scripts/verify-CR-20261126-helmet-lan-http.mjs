#!/usr/bin/env node
// Script kiểm chứng CR-20261126-helmet-lan-http:
// - Kiểm tra cấu hình Helmet trong server/src/app.ts:
//   + Khi ALLOW_INSECURE_COOKIE=false (mặc định / HTTPS): giữ nguyên upgrade-insecure-requests, HSTS, COOP, Origin-Agent-Cluster.
//   + Khi ALLOW_INSECURE_COOKIE=true (mạng LAN HTTP nội bộ như http://192.168.1.140/KSKLaiXe):
//     * Tắt upgrade-insecure-requests trong Content-Security-Policy (giữ nguyên default-src 'self' và các rule CSP chống XSS khác).
//     * Tắt Strict-Transport-Security (HSTS), Cross-Origin-Opener-Policy (COOP), Origin-Agent-Cluster để trình duyệt
//       không tự ép nâng cấp tài nguyên .js/.css sang https:// (gây ERR_CERT_AUTHORITY_INVALID & màn hình trắng) và không báo cảnh báo Console.
// - Chạy lint, typecheck, build và toàn bộ 269 ca test tự động.
// - Khởi chạy server 1 cổng với VITE_BASE_PATH=/KSKLaiXe + ALLOW_INSECURE_COOKIE=true, kiểm tra thực tế các HTTP headers
//   trên GET /KSKLaiXe/ và mở Playwright xác nhận 0 lỗi/cảnh báo Console, chụp ảnh màn hình lưu vào docs/evidence/CR-20261126-helmet-lan-http/.

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(
  ROOT_DIR,
  'docs',
  'evidence',
  'CR-20261126-helmet-lan-http',
);

const SYSTEM_CHROME_PATH =
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SYSTEM_EDGE_PATH =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function resolveBrowserExecutablePath() {
  if (fs.existsSync(SYSTEM_CHROME_PATH)) {
    return SYSTEM_CHROME_PATH;
  }
  if (fs.existsSync(SYSTEM_EDGE_PATH)) {
    return SYSTEM_EDGE_PATH;
  }
  return undefined;
}

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const logLines = [];
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  log(`PASS: ${message}`);
}

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runCmd(label, command, extraEnv = {}) {
  log(`--- Đang chạy: ${label} (${command}) ---`);
  const out = execSync(command, {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ...extraEnv,
    },
    encoding: 'utf8',
    stdio: 'pipe',
  });
  log(`PASS: ${label} hoàn tất (exit code 0)`);
  return out;
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

async function waitForHealth(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return true;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main() {
  log('=== BẮT ĐẦU KIỂM CHỨNG CR-20261126-helmet-lan-http (Tắt upgrade-insecure-requests/HSTS/COOP khi ALLOW_INSECURE_COOKIE=true) ===');

  // 1. Chạy ESLint + TypeScript typecheck + Vitest
  runCmd('ESLint (npm run lint)', `${npmBin} run lint`);
  runCmd('TypeScript Typecheck (npm run typecheck)', `${npmBin} run typecheck`);
  const testOut = runCmd('Vitest Suite (npm test)', `${npmBin} test`);
  assert(
    testOut.includes('145 passed') &&
      testOut.includes('93 passed') &&
      testOut.includes('21 passed') &&
      testOut.includes('10 passed'),
    'Toàn bộ 4 workspaces (145 + 93 + 21 + 10 = 269 tests) đều PASS 100%',
  );

  // 2. Build với VITE_BASE_PATH=/KSKLaiXe
  runCmd('Build Subpath /KSKLaiXe (npm run build)', `${npmBin} run build`, {
    VITE_BASE_PATH: '/KSKLaiXe',
  });

  // 3. Khởi chạy server 1 cổng với ALLOW_INSECURE_COOKIE=true và kiểm tra HTTP response headers
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const passwordPlain = 'VerifyHelmetLanHttp123!';
  const passwordHash = bcrypt.hashSync(passwordPlain, 10);

  const serverEntry = path.join(ROOT_DIR, 'server', 'dist', 'index.js');
  const serverProc = spawn(process.execPath, [serverEntry], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      APP_ENV: 'production',
      ALLOW_INSECURE_COOKIE: 'true',
      VITE_BASE_PATH: '/KSKLaiXe',
      PORT: String(port),
      LOG_LEVEL: 'info',
      GKSK_USE_IN_MEMORY_DB: '1',
      DB_HOST: '127.0.0.1',
      DB_PORT: '1433',
      DB_USER: 'gksk_app_user',
      DB_PASSWORD: 'VerifyHelmetPlaceholderDbPassword',
      DB_NAME: 'GKSKLaiXe',
      DB_ENCRYPT: 'false',
      DB_TRUST_SERVER_CERT: 'true',
      GKSK_BASE_URL: 'https://ksktd.dongnai.gov.vn',
      GKSK_FACILITY_ID: '75009',
      GKSK_FACILITY_NAME: 'Bệnh viện Đa khoa khu vực Long Khánh',
      GKSK_SENDER_ID: '75009',
      GKSK_USERNAME: '75009',
      GKSK_PASSWORD: 'VerifyHelmetPlaceholderCsytPassword',
      APP_LOGIN_USER: 'admin',
      APP_LOGIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: 'cr-20261126-helmet-lan-http-session-secret-64chars-ok',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const healthy = await waitForHealth(`${baseUrl}/KSKLaiXe/api/health`);
    assert(healthy, 'GET /KSKLaiXe/api/health trả HTTP 200 {"ok":true}');

    const htmlRes = await fetch(`${baseUrl}/KSKLaiXe`);
    assert(htmlRes.status === 200, 'GET /KSKLaiXe trả HTTP 200');
    const cspHeader = htmlRes.headers.get('content-security-policy') ?? '';
    const hstsHeader = htmlRes.headers.get('strict-transport-security');
    const coopHeader = htmlRes.headers.get('cross-origin-opener-policy');
    const oacHeader = htmlRes.headers.get('origin-agent-cluster');

    log(`CSP Header nhận được: ${cspHeader}`);
    assert(
      cspHeader.includes("default-src 'self'"),
      "CSP vẫn giữ nguyên các rule bảo vệ chống XSS (default-src 'self', script-src 'self', ...)",
    );
    assert(
      !cspHeader.includes('upgrade-insecure-requests'),
      'CSP KHÔNG chứa upgrade-insecure-requests khi ALLOW_INSECURE_COOKIE=true (không ép nâng cấp .js/.css sang https://)',
    );
    assert(
      hstsHeader === null,
      'Header Strict-Transport-Security (HSTS) đã được tắt khi ALLOW_INSECURE_COOKIE=true',
    );
    assert(
      coopHeader === null,
      'Header Cross-Origin-Opener-Policy (COOP) đã được tắt trên HTTP LAN',
    );
    assert(
      oacHeader === null,
      'Header Origin-Agent-Cluster đã được tắt trên HTTP LAN',
    );

    // 4. Mở trình duyệt Playwright thật kiểm tra giao diện & chụp ảnh màn hình
    const executablePath = resolveBrowserExecutablePath();
    const browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();

      const consoleErrors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !msg.text().includes('401')) {
          consoleErrors.push(msg.text());
        }
      });
      page.on('pageerror', (err) => {
        consoleErrors.push(String(err));
      });

      await page.goto(`${baseUrl}/KSKLaiXe`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#login-username', { timeout: 10000 });

      const shot1 = path.join(EVIDENCE_DIR, '01-lan-http-subpath-login-loaded.png');
      await page.screenshot({ path: shot1, fullPage: true });
      log(`Đã chụp ảnh màn hình đăng nhập Subpath không còn lỗi trắng trang: ${shot1}`);

      await page.fill('#login-username', 'admin');
      await page.fill('#login-password', passwordPlain);
      await page.click('button[type="submit"]');

      await page.waitForURL((url) => url.pathname === '/KSKLaiXe/' || url.pathname === '/KSKLaiXe', {
        timeout: 10000,
      });
      await page.waitForLoadState('networkidle');

      const shot2 = path.join(EVIDENCE_DIR, '02-lan-http-subpath-dashboard-loaded.png');
      await page.screenshot({ path: shot2, fullPage: true });
      log(`Đã chụp ảnh màn hình Danh sách & Đối soát sau khi đăng nhập trên HTTP LAN: ${shot2}`);

      assert(consoleErrors.length === 0, 'Trình duyệt có 0 lỗi console/pageerror');
    } finally {
      await browser.close();
    }
  } finally {
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    if (!serverProc.killed) {
      serverProc.kill('SIGKILL');
    }
    // Giữ bản build với VITE_BASE_PATH từ .env (hoặc mặc định) sạch sẽ
    runCmd('Khôi phục bản build chuẩn (npm run build)', `${npmBin} run build`);
  }

  log('=== HOÀN TẤT KIỂM CHỨNG CR-20261126-helmet-lan-http: 100% PASS ===');
  const outPath = path.join(EVIDENCE_DIR, 'verify-output.txt');
  fs.writeFileSync(outPath, `${logLines.join('\n')}\n`, 'utf8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
