#!/usr/bin/env node
// Script kiểm chứng CR-20261127-restrict-system-admin:
// - Chạy lint, typecheck, test (274/274), build.
// - Khởi chạy Server GKSKLaiXe:
//   1. Đăng nhập bằng tài khoản quản trị `thangnh` (thuộc nhóm 3 tài khoản được cấp quyền `admin`, `thangnh`, `kienvd`):
//      - Xác nhận hiển thị nút "⚙️ Hệ thống & Tài khoản" và đầy đủ 3 tab (Kiểm tra kết nối SYT & Cấu hình nóng CSYT, Quản trị người dùng, Đổi mật khẩu).
//      - Tạo thêm tài khoản `kienvd` (quản trị viên thứ 3) và tài khoản nhân viên thường `nhanvien_khth`
//      - Chụp ảnh `01-admin-thangnh-full-system-access.png`.
//   2. Đăng xuất và đăng nhập bằng tài khoản `kienvd`:
//      - Xác nhận `kienvd` cũng có đầy đủ quyền truy cập "⚙️ Hệ thống & Tài khoản" và "Cấu hình nóng Tài khoản CSYT"
//      - Chụp ảnh `02-admin-kienvd-full-system-access.png`.
//   3. Đăng xuất và đăng nhập bằng tài khoản nhân viên thường `nhanvien_khth`:
//      - Xác nhận thanh điều hướng chỉ hiển thị nút "🔑 Đổi mật khẩu" (ẩn "⚙️ Hệ thống & Tài khoản").
//      - Khi bấm vào nút "🔑 Đổi mật khẩu", hộp thoại chỉ hiển thị duy nhất chức năng "🔑 Đổi mật khẩu của tôi"
//        (ẩn hoàn toàn Kiểm tra kết nối SYT, Cấu hình nóng Tài khoản CSYT và Quản trị người dùng).
//      - Thực hiện đổi mật khẩu cá nhân thành công và chụp ảnh `03-regular-user-only-change-password.png`.
// - Lưu biên bản kiểm chứng vào `docs/evidence/CR-20261127-restrict-system-admin/verify-output.txt`.

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
  'CR-20261127-restrict-system-admin',
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
  log('=== BẮT ĐẦU KIỂM CHỨNG CR-20261127-restrict-system-admin ===');

  runCmd('ESLint (npm run lint)', `${npmBin} run lint`);
  runCmd('TypeScript Typecheck (npm run typecheck)', `${npmBin} run typecheck`);
  const testOut = runCmd('Vitest Suite (npm test)', `${npmBin} test`);
  assert(
    testOut.includes('145 passed') &&
      testOut.includes('96 passed') &&
      testOut.includes('23 passed') &&
      testOut.includes('10 passed'),
    'Toàn bộ 4 workspaces (145 + 96 + 23 + 10 = 274 tests) đều PASS 100%',
  );
  runCmd('Build Production (npm run build)', `${npmBin} run build`);

  const mockPort = await getFreePort();
  const appPort = await getFreePort();
  const mockUrl = `http://127.0.0.1:${mockPort}`;
  const appBaseUrl = `http://127.0.0.1:${appPort}`;

  const mockApp = createMockGkskApp({
    accounts: [
      {
        username: '75009',
        password: 'MockCsytPassword#2026',
        facilityId: '75009',
        role: 'csyt',
      },
    ],
  });
  const mockServer = await new Promise((resolve) => {
    const srv = mockApp.listen(mockPort, '127.0.0.1', () => resolve(srv));
  });
  log(`PASS: Mock Cổng Sở Y tế đã sẵn sàng tại ${mockUrl}`);

  const thangPassword = 'ThangPassword@2026';
  const kienPassword = 'KienPassword@2026';
  const staffPassword = 'StaffPassword@2026';

  const serverEntry = path.join(ROOT_DIR, 'server', 'dist', 'index.js');
  const serverProc = spawn(process.execPath, [serverEntry], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      APP_ENV: 'production',
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
      GKSK_BASE_URL: 'https://ksktd.dongnai.gov.vn',
      GKSK_FACILITY_ID: '75009',
      GKSK_FACILITY_NAME: 'BỆNH VIỆN ĐA KHOA KHU VỰC LONG KHÁNH',
      GKSK_SENDER_ID: '75009',
      GKSK_USERNAME: '75009',
      GKSK_PASSWORD: 'MockCsytPassword#2026',
      APP_LOGIN_USER: 'thangnh',
      APP_LOGIN_PASSWORD: thangPassword,
      APP_LOGIN_PASSWORD_HASH: '',
      SESSION_SECRET: 'cr-20261127-restrict-system-admin-secret-64chars-ok',
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
        viewport: { width: 1440, height: 960 },
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

      // 1. Đăng nhập bằng tài khoản quản trị `thangnh`
      await page.goto(`${appBaseUrl}/login`, { waitUntil: 'networkidle' });
      await page.fill('#login-username', 'thangnh');
      await page.fill('#login-password', thangPassword);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="open-system-admin-btn"]');

      const thangBtnText = await page
        .getByTestId('open-system-admin-btn')
        .textContent();
      assert(
        thangBtnText?.includes('Hệ thống & Tài khoản'),
        'Tài khoản thangnh thấy nút "⚙️ Hệ thống & Tài khoản"',
      );

      await page.getByTestId('open-system-admin-btn').click();
      await page.waitForSelector('[data-testid="csyt-config-form"]');

      const shot1 = path.join(
        EVIDENCE_DIR,
        '01-admin-thangnh-full-system-access.png',
      );
      await page.screenshot({ path: shot1, fullPage: true });
      log(`Đã chụp ảnh quyền quản trị của thangnh: ${shot1}`);

      // Tạo tài khoản `kienvd` và `nhanvien_khth` trong tab Quản trị người dùng
      await page.getByTestId('sys-tab-users').click();
      await page.waitForSelector('[data-testid="users-table"]');

      await page.fill('[data-testid="new-user-username-input"]', 'kienvd');
      await page.fill('[data-testid="new-user-fullname-input"]', 'Vũ Đức Kiên');
      await page.fill('[data-testid="new-user-password-input"]', kienPassword);
      await page.getByTestId('save-user-btn').click();
      await page.waitForSelector('[data-testid="user-row-kienvd"]');

      await page.fill(
        '[data-testid="new-user-username-input"]',
        'nhanvien_khth',
      );
      await page.fill(
        '[data-testid="new-user-fullname-input"]',
        'Nhân viên Phòng KHTH',
      );
      await page.fill('[data-testid="new-user-password-input"]', staffPassword);
      await page.getByTestId('save-user-btn').click();
      await page.waitForSelector('[data-testid="user-row-nhanvien_khth"]');

      await page.getByTestId('system-admin-close-btn').click();
      await page.getByRole('button', { name: 'Đăng xuất' }).click();
      await page.waitForSelector('#login-username');

      // 2. Đăng nhập bằng tài khoản quản trị thứ 3: `kienvd`
      await page.fill('#login-username', 'kienvd');
      await page.fill('#login-password', kienPassword);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="open-system-admin-btn"]');

      const kienBtnText = await page
        .getByTestId('open-system-admin-btn')
        .textContent();
      assert(
        kienBtnText?.includes('Hệ thống & Tài khoản'),
        'Tài khoản kienvd thấy nút "⚙️ Hệ thống & Tài khoản"',
      );
      await page.getByTestId('open-system-admin-btn').click();
      await page.waitForSelector('[data-testid="csyt-config-form"]');

      const shot2 = path.join(
        EVIDENCE_DIR,
        '02-admin-kienvd-full-system-access.png',
      );
      await page.screenshot({ path: shot2, fullPage: true });
      log(`Đã chụp ảnh quyền quản trị của kienvd: ${shot2}`);

      await page.getByTestId('system-admin-close-btn').click();
      await page.getByRole('button', { name: 'Đăng xuất' }).click();
      await page.waitForSelector('#login-username');

      // 3. Đăng nhập bằng tài khoản nhân viên thường: `nhanvien_khth`
      await page.fill('#login-username', 'nhanvien_khth');
      await page.fill('#login-password', staffPassword);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="open-system-admin-btn"]');

      const staffBtnText = await page
        .getByTestId('open-system-admin-btn')
        .textContent();
      assert(
        staffBtnText?.trim() === '🔑 Đổi mật khẩu',
        'Tài khoản thường nhanvien_khth chỉ thấy nút "🔑 Đổi mật khẩu" (ẩn Hệ thống & Tài khoản)',
      );

      await page.getByTestId('open-system-admin-btn').click();
      await page.waitForSelector('[data-testid="sys-panel-password"]');

      const hasConnTab = await page.getByTestId('sys-tab-connection').count();
      const hasUsersTab = await page.getByTestId('sys-tab-users').count();
      const hasCsytForm = await page.getByTestId('csyt-config-form').count();
      assert(
        hasConnTab === 0 && hasUsersTab === 0 && hasCsytForm === 0,
        'Hộp thoại của user thường ẩn hoàn toàn tab Kiểm tra kết nối SYT, Cấu hình nóng CSYT và Quản trị người dùng',
      );

      // Thực hiện đổi mật khẩu cá nhân cho `nhanvien_khth`
      await page.fill(
        '[data-testid="own-current-password-input"]',
        staffPassword,
      );
      await page.fill(
        '[data-testid="own-next-password-input"]',
        'StaffNewPass@2027',
      );
      await page.fill(
        '[data-testid="own-confirm-password-input"]',
        'StaffNewPass@2027',
      );
      await page.getByTestId('submit-change-password-btn').click();
      await page.waitForSelector('[data-testid="change-pass-notice"]');

      const shot3 = path.join(
        EVIDENCE_DIR,
        '03-regular-user-only-change-password.png',
      );
      await page.screenshot({ path: shot3, fullPage: true });
      log(
        `Đã chụp ảnh giao diện của user thường (chỉ hiển thị Đổi mật khẩu cá nhân): ${shot3}`,
      );

      assert(
        consoleErrors.length === 0,
        'Trình duyệt có 0 lỗi console/pageerror',
      );
    } finally {
      await browser.close();
    }
  } finally {
    serverProc.kill('SIGTERM');
    mockServer.close();
  }

  log(
    '=== HOÀN TẤT KIỂM CHỨNG CR-20261127-restrict-system-admin: 100% PASS ===',
  );
  const outPath = path.join(EVIDENCE_DIR, 'verify-output.txt');
  fs.writeFileSync(outPath, `${logLines.join('\n')}\n`, 'utf8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
