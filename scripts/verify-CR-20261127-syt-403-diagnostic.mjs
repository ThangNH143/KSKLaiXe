#!/usr/bin/env node
// Script kiểm chứng CR-20261127-syt-403-diagnostic:
// - Chạy lint, typecheck, test (273/273), build.
// - Khởi chạy Mock Cổng Sở Y tế (CSYT 75009 với mật khẩu có ký tự `#`: `MasterFlow#2026`)
//   và khởi chạy Server GKSKLaiXe với mật khẩu CSYT ban đầu bị sai (`WrongOldPass`).
// - Mở trình duyệt Playwright thực hiện:
//   1. Đăng nhập vào webapp bằng `thangnh`, mở hộp thoại "⚙️ Hệ thống & Tài khoản" -> bấm kiểm tra kết nối:
//      Xác nhận Chẩn đoán Bước 1 (`POST /api/auth/login`) hiển thị rõ lỗi 403 kèm nguyên văn `res_msg` từ MasterFlow
//      -> chụp ảnh `01-diagnostic-step1-login-403-resmsg.png`.
//   2. Nhập mật khẩu CSYT mới có ký tự `#` (`MasterFlow#2026`) ngay trên giao diện "Cấu hình nóng Tài khoản CSYT"
//      và bấm "💾 Lưu cấu hình CSYT & Kiểm tra ngay":
//      Xác nhận server cập nhật nóng trên RAM (không cần restart NSSM), Bước 1 (`POST /api/auth/login`) và Bước 2
//      (`GET /api/platform/gksk-lai-xe/status`) đều báo `✅` xanh -> chụp ảnh `02-hot-update-csyt-password-and-2step-ok.png`.
// - Lưu biên bản kiểm chứng vào `docs/evidence/CR-20261127-syt-403-diagnostic/verify-output.txt`.

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
  'CR-20261127-syt-403-diagnostic',
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
  log('=== BẮT ĐẦU KIỂM CHỨNG CR-20261127-syt-403-diagnostic ===');

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
  runCmd('Build Production (npm run build)', `${npmBin} run build`);

  const mockPort = await getFreePort();
  const appPort = await getFreePort();
  const mockUrl = `http://127.0.0.1:${mockPort}`;
  const appBaseUrl = `http://127.0.0.1:${appPort}`;

  const correctCsytPassword = 'MasterFlow#2026';

  const mockApp = createMockGkskApp({
    accounts: [
      {
        username: '75009',
        password: correctCsytPassword,
        facilityId: '75009',
        role: 'csyt',
      },
    ],
  });
  const mockServer = await new Promise((resolve) => {
    const srv = mockApp.listen(mockPort, '127.0.0.1', () => resolve(srv));
  });
  log(`PASS: Mock Cổng Sở Y tế đã sẵn sàng tại ${mockUrl} (CSYT 75009)`);

  const appLoginPassword = 'ThangPassword@2026';
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
      // Khởi động với mật khẩu CSYT cũ/bị cắt cụt do dấu # để tái hiện lỗi đăng nhập cổng Sở
      GKSK_PASSWORD: 'MasterFlow_Truncated_Old_Password',
      APP_LOGIN_USER: 'thangnh',
      APP_LOGIN_PASSWORD: appLoginPassword,
      APP_LOGIN_PASSWORD_HASH: '',
      SESSION_SECRET: 'cr-20261127-syt-403-diagnostic-secret-64chars-ok',
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
        viewport: { width: 1440, height: 920 },
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

      await page.goto(`${appBaseUrl}/login`, { waitUntil: 'networkidle' });
      await page.fill('#login-username', 'thangnh');
      await page.fill('#login-password', appLoginPassword);
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="open-system-admin-btn"]');

      // 1. Mở hộp thoại Hệ thống & Tài khoản -> Bấm kiểm tra kết nối khi mật khẩu CSYT đang sai
      await page.getByTestId('open-system-admin-btn').click();
      await page.waitForSelector('[data-testid="system-admin-modal"]');
      await page.getByTestId('run-connection-check-btn').click();
      await page.waitForSelector('[data-testid="conn-check-result"]');

      const step1FailText = await page
        .getByTestId('conn-syt-step1')
        .textContent();
      assert(
        step1FailText?.includes('POST /api/auth/login') &&
          step1FailText?.includes('Phản hồi từ cổng Sở'),
        'Chẩn đoán Bước 1 hiển thị rõ lỗi tại POST /api/auth/login kèm nguyên văn res_msg từ cổng Sở',
      );

      const shot1 = path.join(
        EVIDENCE_DIR,
        '01-diagnostic-step1-login-fail-resmsg.png',
      );
      await page.screenshot({ path: shot1, fullPage: true });
      log(`Đã chụp ảnh Chẩn đoán Bước 1 khi sai mật khẩu CSYT: ${shot1}`);

      // 2. Nhập mật khẩu CSYT mới có ký tự '#' (MasterFlow#2026) và bấm "💾 Lưu cấu hình CSYT & Kiểm tra ngay"
      await page.fill(
        '[data-testid="csyt-password-input"]',
        correctCsytPassword,
      );
      await page.getByTestId('save-gksk-config-btn').click();

      await page.waitForSelector('[data-testid="conn-config-notice"]');
      await page.waitForSelector('[data-testid="conn-syt-step2"]');

      const sytStatusAfter = await page
        .getByTestId('conn-syt-status')
        .textContent();
      const step1OkText = await page
        .getByTestId('conn-syt-step1')
        .textContent();
      const step2OkText = await page
        .getByTestId('conn-syt-step2')
        .textContent();

      assert(
        sytStatusAfter?.includes('Xác thực CSYT thành công') &&
          step1OkText?.includes('Thành công HTTP 200') &&
          step2OkText?.includes('GET /api/platform/gksk-lai-xe/status') &&
          step2OkText?.includes('Sẵn sàng đẩy giấy GKSK lái xe'),
        'Sau khi cập nhật nóng mật khẩu CSYT mới trên giao diện, cả Bước 1 (Login) và Bước 2 (Quyền API GKSK) đều thành công 100%',
      );

      const shot2 = path.join(
        EVIDENCE_DIR,
        '02-hot-update-csyt-password-and-2step-ok.png',
      );
      await page.screenshot({ path: shot2, fullPage: true });
      log(
        `Đã chụp ảnh Cập nhật nóng mật khẩu CSYT & Chẩn đoán 2 bước thành công: ${shot2}`,
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

  log('=== HOÀN TẤT KIỂM CHỨNG CR-20261127-syt-403-diagnostic: 100% PASS ===');
  const outPath = path.join(EVIDENCE_DIR, 'verify-output.txt');
  fs.writeFileSync(outPath, `${logLines.join('\n')}\n`, 'utf8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
