#!/usr/bin/env node
/**
 * Script kiểm chứng CR-20261126-iis-subpath:
 * - Build giao diện với VITE_BASE_PATH=/KSKLaiXe, kiểm tra client/dist/index.html chứa /KSKLaiXe/assets/...
 * - Khởi chạy server 1 cổng với NODE_ENV=production, APP_ENV=production, ALLOW_INSECURE_COOKIE=true, VITE_BASE_PATH=/KSKLaiXe
 * - Kiểm tra HTTP API dưới cả /KSKLaiXe/api/* và /api/*
 * - Kiểm tra đăng nhập HTTP LAN (APP_ENV=production + ALLOW_INSECURE_COOKIE=true) không gắn cờ Secure lên cookie
 * - Mở trình duyệt Playwright thật vào http://127.0.0.1:<port>/KSKLaiXe/login, đăng nhập, chuyển trang /KSKLaiXe/ và /KSKLaiXe/import,
 *   xác nhận 0 lỗi console và chụp ảnh màn hình lưu vào docs/evidence/CR-20261126-iis-subpath/*.png
 * - Build trả lại mặc định VITE_BASE_PATH="" để giữ trạng thái sạch cho client/dist
 */

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
const EVIDENCE_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'CR-20261126-iis-subpath');

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
  log('=== BẮT ĐẦU KIỂM CHỨNG CR-20261126-iis-subpath (Phương án 3: Subpath IIS /KSKLaiXe + ALLOW_INSECURE_COOKIE=true) ===');

  // 1. Build với VITE_BASE_PATH=/KSKLaiXe
  log('Bước 1: Chạy npm run build với VITE_BASE_PATH=/KSKLaiXe ...');
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execSync(`${npmBin} run build`, {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      VITE_BASE_PATH: '/KSKLaiXe',
    },
    stdio: 'pipe',
  });

  const indexHtmlPath = path.join(ROOT_DIR, 'client', 'dist', 'index.html');
  assert(fs.existsSync(indexHtmlPath), 'client/dist/index.html tồn tại sau khi build');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  assert(
    indexHtml.includes('"/KSKLaiXe/assets/'),
    'client/dist/index.html tham chiếu tài nguyên tĩnh với tiền tố "/KSKLaiXe/assets/"',
  );

  // 2. Khởi chạy server production 1 cổng với VITE_BASE_PATH=/KSKLaiXe và ALLOW_INSECURE_COOKIE=true
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const passwordPlain = 'VerifyCrSubpathPass123!';
  const passwordHash = bcrypt.hashSync(passwordPlain, 10);

  log(`Bước 2: Khởi chạy server 1 cổng tại ${baseUrl}/KSKLaiXe (APP_ENV=production, ALLOW_INSECURE_COOKIE=true) ...`);

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
      DB_PASSWORD: 'VerifyCrPlaceholderDbPassword',
      DB_NAME: 'GKSKLaiXe',
      DB_ENCRYPT: 'false',
      DB_TRUST_SERVER_CERT: 'true',
      GKSK_BASE_URL: 'https://ksktd.dongnai.gov.vn',
      GKSK_FACILITY_ID: '75001',
      GKSK_FACILITY_NAME: 'Bệnh viện Đa khoa khu vực Long Khánh',
      GKSK_SENDER_ID: '75001',
      GKSK_USERNAME: '75001',
      GKSK_PASSWORD: 'VerifyCrPlaceholderCsytPassword',
      APP_LOGIN_USER: 'admin',
      APP_LOGIN_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: 'cr-20261126-iis-subpath-session-secret-64chars-ok',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverStderr = '';
  serverProc.stderr.on('data', (chunk) => {
    serverStderr += chunk.toString('utf8');
  });

  try {
    const healthy = await waitForHealth(`${baseUrl}/KSKLaiXe/api/health`);
    if (!healthy) {
      log(`Server stderr: ${serverStderr}`);
    }
    assert(healthy, 'GET /KSKLaiXe/api/health trả HTTP 200 {"ok":true}');

    const rootHealthRes = await fetch(`${baseUrl}/api/health`);
    assert(rootHealthRes.status === 200, 'GET /api/health (khi IIS strip subpath) cũng trả HTTP 200');

    // 3. Kiểm tra Set-Cookie khi đăng nhập HTTP LAN với APP_ENV=production + ALLOW_INSECURE_COOKIE=true
    log('Bước 3: Kiểm tra POST /KSKLaiXe/api/auth/login qua HTTP LAN không gắn cờ Secure khi ALLOW_INSECURE_COOKIE=true ...');
    const loginRes = await fetch(`${baseUrl}/KSKLaiXe/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'gksk',
      },
      body: JSON.stringify({ username: 'admin', password: passwordPlain }),
    });
    assert(loginRes.status === 200, 'POST /KSKLaiXe/api/auth/login trả HTTP 200');
    const setCookieHeader = loginRes.headers.get('set-cookie') ?? '';
    assert(setCookieHeader.includes('gksk_session='), 'Header Set-Cookie có chứa gksk_session');
    assert(setCookieHeader.includes('HttpOnly'), 'Header Set-Cookie có cờ HttpOnly');
    assert(!setCookieHeader.includes('Secure'), 'Header Set-Cookie KHÔNG gắn cờ Secure khi ALLOW_INSECURE_COOKIE=true trên HTTP');

    // 4. Mở trình duyệt Playwright thật kiểm tra giao diện dưới /KSKLaiXe
    log('Bước 4: Mở trình duyệt Playwright kiểm tra giao diện tại /KSKLaiXe/login, đăng nhập và chuyển trang ...');
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

      await page.goto(`${baseUrl}/KSKLaiXe/login`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#login-username', { timeout: 10000 });
      assert(page.url().endsWith('/KSKLaiXe/login'), 'Trình duyệt mở đúng URL /KSKLaiXe/login');

      const loginShotPath = path.join(EVIDENCE_DIR, '01-subpath-login-http-prod.png');
      await page.screenshot({ path: loginShotPath, fullPage: true });
      log(`Đã chụp ảnh màn hình đăng nhập Subpath: ${loginShotPath}`);

      await page.fill('#login-username', 'admin');
      await page.fill('#login-password', passwordPlain);
      await page.click('button[type="submit"]');

      await page.waitForURL((url) => url.pathname === '/KSKLaiXe/' || url.pathname === '/KSKLaiXe', {
        timeout: 10000,
      });
      await page.waitForLoadState('networkidle');
      assert(
        page.url().includes('/KSKLaiXe'),
        `Đăng nhập qua HTTP thành công, giữ phiên cookie và điều hướng về ${page.url()}`,
      );

      // Kiểm tra banner đỏ MÔI TRƯỜNG SẢN XUẤT (PRODUCTION) vẫn hiển thị đầy đủ
      const bodyText = await page.textContent('body');
      assert(
        bodyText && bodyText.includes('MÔI TRƯỜNG SẢN XUẤT (PRODUCTION)'),
        'Banner đỏ cảnh báo MÔI TRƯỜNG SẢN XUẤT (PRODUCTION) vẫn hiển thị đầy đủ',
      );

      const reconcileShotPath = path.join(EVIDENCE_DIR, '02-subpath-reconcile-authenticated.png');
      await page.screenshot({ path: reconcileShotPath, fullPage: true });
      log(`Đã chụp ảnh màn hình Danh sách đối soát dưới Subpath /KSKLaiXe: ${reconcileShotPath}`);

      // Điều hướng sang /KSKLaiXe/import
      await page.goto(`${baseUrl}/KSKLaiXe/import`, { waitUntil: 'networkidle' });
      assert(page.url().endsWith('/KSKLaiXe/import'), 'Điều hướng trực tiếp tới SPA route /KSKLaiXe/import thành công');

      const importShotPath = path.join(EVIDENCE_DIR, '03-subpath-import-page.png');
      await page.screenshot({ path: importShotPath, fullPage: true });
      log(`Đã chụp ảnh màn hình Import Excel dưới Subpath /KSKLaiXe/import: ${importShotPath}`);

      assert(consoleErrors.length === 0, `Trình duyệt có 0 lỗi console/pageerror (ghi nhận: ${consoleErrors.length})`);
    } finally {
      await browser.close();
    }
  } finally {
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    if (!serverProc.killed) {
      serverProc.kill('SIGKILL');
    }
    log('Bước 5: Khôi phục bản build mặc định (VITE_BASE_PATH="") cho client/dist ...');
    execSync(`${npmBin} run build`, {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        VITE_BASE_PATH: '',
      },
      stdio: 'pipe',
    });
  }

  log('=== HOÀN TẤT KIỂM CHỨNG CR-20261126-iis-subpath: 100% PASS ===');
  const outPath = path.join(EVIDENCE_DIR, 'verify-output.txt');
  fs.writeFileSync(outPath, `${logLines.join('\n')}\n`, 'utf8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
