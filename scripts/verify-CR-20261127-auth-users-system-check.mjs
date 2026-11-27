#!/usr/bin/env node
// Script kiểm chứng CR-20261127-auth-users-system-check:
// - Kiểm chứng toàn bộ cổng chất lượng: lint, typecheck, test (273/273), test:mssql (5 bảng gksk_*), build.
// - Khởi chạy Mock Cổng Sở Y tế + Server GKSKLaiXe (cấu hình CSYT 75009 - Bệnh viện Đa khoa khu vực Long Khánh,
//   ksktd.dongnai.gov.vn, tự seed tài khoản `thangnh` vào `dbo.gksk_users`).
// - Mở trình duyệt Playwright thực hiện:
//   1. Đăng nhập thành công bằng tài khoản `thangnh` -> chụp `01-login-thangnh-success.png`.
//   2. Mở hộp thoại "⚙️ Hệ thống & Tài khoản" -> Tab 1 "Kiểm tra kết nối SYT & DB" -> bấm kiểm tra kết nối
//      trực tiếp tới Database (5 bảng `gksk_*`) và Cổng Sở Y tế (CSYT 75009) -> chụp `02-system-connection-check.png`.
//   3. Chuyển sang Tab 2 "Quản trị người dùng" (`dbo.gksk_users`) -> thêm tài khoản nhân viên mới `nhanvien_khth`
//      -> chụp `03-user-management-gksk-users.png`.
//   4. Chuyển sang Tab 3 "Đổi mật khẩu của tôi" -> đổi mật khẩu cho `thangnh` -> chụp `04-change-password-success.png`.
// - Lưu biên bản kiểm chứng vào `docs/evidence/CR-20261127-auth-users-system-check/verify-output.txt`.

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createMockGkskApp } from '../tools/mock-gksk-api/dist/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(
  ROOT_DIR,
  'docs',
  'evidence',
  'CR-20261127-auth-users-system-check',
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
  log('=== BẮT ĐẦU KIỂM CHỨNG CR-20261127-auth-users-system-check ===');

  // 1. Chạy ESLint + TypeScript typecheck + Vitest + test:mssql + Build
  runCmd('ESLint (npm run lint)', `${npmBin} run lint`);
  runCmd('TypeScript Typecheck (npm run typecheck)', `${npmBin} run typecheck`);
  const testOut = runCmd('Vitest Suite (npm test)', `${npmBin} test`);
  assert(
    testOut.includes('145 passed') &&
      testOut.includes('96 passed') &&
      testOut.includes('22 passed') &&
      testOut.includes('10 passed'),
    'Toàn bộ 4 workspaces (145 + 96 + 22 + 10 = 273 tests) đều PASS 100%',
  );

  const mssqlOut = runCmd(
    'Kiểm thử MSSQL 5 bảng gksk_* (npm run test:mssql)',
    `${npmBin} run test:mssql`,
  );
  assert(
    mssqlOut.includes('gksk_users') && mssqlOut.includes('PASS 100%'),
    'npm run test:mssql xác nhận đủ 5 bảng tiền tố gksk_* (bao gồm gksk_users)',
  );

  runCmd('Build Production (npm run build)', `${npmBin} run build`);

  // 2. Khởi chạy Mock GKSK API (giả lập cổng Sở Y tế cho CSYT 75009) + Server GKSKLaiXe 1 cổng
  const mockPort = await getFreePort();
  const appPort = await getFreePort();
  const mockUrl = `http://127.0.0.1:${mockPort}`;
  const appBaseUrl = `http://127.0.0.1:${appPort}`;

  const mockApp = createMockGkskApp({
    accounts: [
      {
        username: '75009',
        password: 'mock-csyt-password',
        facilityId: '75009',
        role: 'csyt',
      },
    ],
  });
  const mockServer = await new Promise((resolve) => {
    const srv = mockApp.listen(mockPort, '127.0.0.1', () => resolve(srv));
  });
  log(`PASS: Mock Cổng Sở Y tế đã sẵn sàng tại ${mockUrl} (CSYT 75009)`);

  const initialPassword = 'ThangPassword@2026';
  const updatedPassword = 'ThangNewPassword@2027';

  const serverEntry = path.join(ROOT_DIR, 'server', 'dist', 'index.js');
  const serverProc = spawn(process.execPath, [serverEntry], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      APP_ENV: 'test',
      ALLOW_INSECURE_COOKIE: 'true',
      PORT: String(appPort),
      LOG_LEVEL: 'info',
      GKSK_USE_IN_MEMORY_DB: '1',
      DB_HOST: '127.0.0.1',
      DB_PORT: '1433',
      DB_USER: 'gksk_app_user',
      DB_PASSWORD: 'VerifyPlaceholderDbPassword',
      DB_NAME: 'GKSKLaiXe',
      DB_ENCRYPT: 'false',
      DB_TRUST_SERVER_CERT: 'true',
      GKSK_BASE_URL: mockUrl,
      GKSK_FACILITY_ID: '75009',
      GKSK_FACILITY_NAME: 'BỆNH VIỆN ĐA KHOA KHU VỰC LONG KHÁNH',
      GKSK_SENDER_ID: '75009',
      GKSK_USERNAME: '75009',
      GKSK_PASSWORD: 'mock-csyt-password',
      APP_LOGIN_USER: 'thangnh',
      APP_LOGIN_PASSWORD: initialPassword,
      APP_LOGIN_PASSWORD_HASH: '',
      SESSION_SECRET: 'cr-20261127-auth-users-system-check-secret-64chars-ok',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const appHealthy = await waitForHealth(`${appBaseUrl}/api/health`);
    assert(appHealthy, 'Server GKSKLaiXe đã sẵn sàng');

    const executablePath = resolveBrowserExecutablePath();
    const browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });

    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
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

      // Bước 1: Mở trang đăng nhập và đăng nhập bằng tài khoản `thangnh`
      await page.goto(`${appBaseUrl}/login`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#login-username', { timeout: 10000 });
      await page.fill('#login-username', 'thangnh');
      await page.fill('#login-password', initialPassword);
      await page.click('button[type="submit"]');

      await page.waitForSelector('[data-testid="current-username"]', {
        timeout: 10000,
      });
      const currentUsernameText = await page
        .getByTestId('current-username')
        .textContent();
      assert(
        currentUsernameText?.trim() === 'thangnh',
        'Đăng nhập bằng tài khoản thangnh thành công (hiển thị pill thangnh trên thanh điều hướng)',
      );

      const shot1 = path.join(EVIDENCE_DIR, '01-login-thangnh-success.png');
      await page.screenshot({ path: shot1, fullPage: true });
      log(`Đã chụp ảnh đăng nhập thangnh thành công: ${shot1}`);

      // Bước 2: Mở hộp thoại "⚙️ Hệ thống & Tài khoản" -> Kiểm tra kết nối Cổng Sở Y tế & Database
      await page.getByTestId('open-system-admin-btn').click();
      await page.waitForSelector('[data-testid="system-admin-modal"]');
      await page.getByTestId('run-connection-check-btn').click();
      await page.waitForSelector('[data-testid="conn-check-result"]');

      const dbStatus = await page.getByTestId('conn-db-status').textContent();
      const sytStatus = await page.getByTestId('conn-syt-status').textContent();
      assert(
        dbStatus?.includes('Sẵn sàng') &&
          sytStatus?.includes('Xác thực CSYT thành công'),
        'Kiểm tra kết nối Database (5 bảng gksk_*) và xác thực CSYT 75009 trên Cổng Sở Y tế đều thành công',
      );

      const shot2 = path.join(EVIDENCE_DIR, '02-system-connection-check.png');
      await page.screenshot({ path: shot2, fullPage: true });
      log(`Đã chụp ảnh Kiểm tra kết nối SYT & Database: ${shot2}`);

      // Bước 3: Chuyển sang Tab "Quản trị người dùng" -> Thêm tài khoản nhân viên mới
      await page.getByTestId('sys-tab-users').click();
      await page.waitForSelector('[data-testid="users-table"]');
      await page.fill('[data-testid="new-user-username-input"]', 'nhanvien_khth');
      await page.fill(
        '[data-testid="new-user-fullname-input"]',
        'Nhân viên Phòng KHTH',
      );
      await page.fill(
        '[data-testid="new-user-password-input"]',
        'KhthPass@2026',
      );
      await page.getByTestId('save-user-btn').click();

      await page.waitForSelector('[data-testid="user-row-nhanvien_khth"]');
      const shot3 = path.join(
        EVIDENCE_DIR,
        '03-user-management-gksk-users.png',
      );
      await page.screenshot({ path: shot3, fullPage: true });
      log(`Đã chụp ảnh Quản trị người dùng (dbo.gksk_users): ${shot3}`);

      // Bước 4: Chuyển sang Tab "Đổi mật khẩu của tôi" -> Đổi mật khẩu cho `thangnh`
      await page.getByTestId('sys-tab-password').click();
      await page.fill(
        '[data-testid="own-current-password-input"]',
        initialPassword,
      );
      await page.fill(
        '[data-testid="own-next-password-input"]',
        updatedPassword,
      );
      await page.fill(
        '[data-testid="own-confirm-password-input"]',
        updatedPassword,
      );
      await page.getByTestId('submit-change-password-btn').click();

      await page.waitForSelector('[data-testid="change-pass-notice"]');
      const shot4 = path.join(EVIDENCE_DIR, '04-change-password-success.png');
      await page.screenshot({ path: shot4, fullPage: true });
      log(`Đã chụp ảnh Đổi mật khẩu cá nhân thành công: ${shot4}`);

      assert(
        consoleErrors.length === 0,
        'Trình duyệt có 0 lỗi console/pageerror trong suốt quá trình thao tác',
      );
    } finally {
      await browser.close();
    }
  } finally {
    serverProc.kill('SIGTERM');
    mockServer.close();
  }

  log('=== HOÀN TẤT KIỂM CHỨNG CR-20261127-auth-users-system-check: 100% PASS ===');
  const outPath = path.join(EVIDENCE_DIR, 'verify-output.txt');
  fs.writeFileSync(outPath, `${logLines.join('\n')}\n`, 'utf8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
