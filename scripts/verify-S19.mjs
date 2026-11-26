import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'S19');
const VERIFY_OUT = path.join(EVIDENCE_DIR, 'verify-output.txt');
const SCREENSHOT_OUT = path.join(EVIDENCE_DIR, 'production-single-port.png');

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

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[verify-S19] FAILED: ${message}`);
  }
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // Server đang khởi động
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `[verify-S19] Quá thời gian chờ ${timeoutMs}ms cho ${baseUrl}/api/health`,
  );
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const logs = [];
  const logLine = (line) => {
    logs.push(line);
    process.stdout.write(`${line}\n`);
  };

  logLine('# Báo cáo Kiểm chứng S19 — Đóng gói Production 1 Tiến trình / 1 Cổng');
  logLine(`- Thời gian chạy: ${new Date().toISOString()}`);

  // 1. Kiểm tra tồn tại docs/DEPLOY.md và docs/USER-GUIDE.md (kèm ảnh nhúng)
  const deployPath = path.join(ROOT_DIR, 'docs', 'DEPLOY.md');
  const userGuidePath = path.join(ROOT_DIR, 'docs', 'USER-GUIDE.md');
  assert(fs.existsSync(deployPath), 'Thiếu file docs/DEPLOY.md');
  assert(fs.existsSync(userGuidePath), 'Thiếu file docs/USER-GUIDE.md');

  const userGuideContent = fs.readFileSync(userGuidePath, 'utf8');
  const embeddedImages = Array.from(
    userGuideContent.matchAll(/!\[[^\]]*\]\((evidence\/[^)]+\.png)\)/g),
    (m) => m[1],
  );
  assert(
    embeddedImages.length >= 10,
    `docs/USER-GUIDE.md cần nhúng ảnh hướng dẫn từ docs/evidence/ (hiện có ${embeddedImages.length})`,
  );
  for (const relImg of embeddedImages) {
    const absImg = path.join(ROOT_DIR, 'docs', relImg);
    assert(fs.existsSync(absImg), `Ảnh nhúng trong USER-GUIDE.md không tồn tại: ${relImg}`);
  }
  logLine(
    `- ✅ Tài liệu vận hành & hướng dẫn: docs/DEPLOY.md (${fs.statSync(deployPath).size} bytes), docs/USER-GUIDE.md (${fs.statSync(userGuidePath).size} bytes, ${embeddedImages.length} ảnh minh họa hợp lệ).`,
  );

  // 2. Chạy `npm run build` để tạo shared/dist, server/dist và client/dist
  logLine('- Đang chạy `npm run build`...');
  const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execSync(`${npmBin} run build`, {
    cwd: ROOT_DIR,
    stdio: 'pipe',
    encoding: 'utf8',
  });

  const serverEntry = path.join(ROOT_DIR, 'server', 'dist', 'index.js');
  const clientIndex = path.join(ROOT_DIR, 'client', 'dist', 'index.html');
  assert(fs.existsSync(serverEntry), 'Không tìm thấy server/dist/index.js sau npm run build');
  assert(fs.existsSync(clientIndex), 'Không tìm thấy client/dist/index.html sau npm run build');
  logLine('- ✅ Build thành công: server/dist/index.js và client/dist/index.html đều sẵn sàng.');

  // 3. Khởi chạy tiến trình đơn `NODE_ENV=production node server/dist/index.js` trên cổng 3019
  const prodPort = 3019;
  const baseUrl = `http://127.0.0.1:${prodPort}`;

  const childEnv = {
    ...process.env,
    NODE_ENV: 'production',
    APP_ENV: 'production',
    PORT: String(prodPort),
    LOG_LEVEL: 'info',
    GKSK_USE_IN_MEMORY_DB: '1',
    DB_HOST: '127.0.0.1',
    DB_PORT: '1433',
    DB_USER: 'gksk_app_user',
    DB_PASSWORD: 'VerifyS19PlaceholderPassword',
    DB_NAME: 'GKSKLaiXe',
    DB_ENCRYPT: 'false',
    DB_TRUST_SERVER_CERT: 'true',
    GKSK_BASE_URL: 'https://ksktd.dongnai.gov.vn',
    GKSK_USERNAME: '75001',
    GKSK_PASSWORD: 'VerifyS19PlaceholderCsytPassword',
    GKSK_FACILITY_ID: '75001',
    GKSK_FACILITY_NAME: 'Benh vien Da khoa Dong Nai',
    APP_LOGIN_USER: 'admin',
    APP_LOGIN_PASSWORD_HASH:
      '$2b$10$CwTycUXWue0Thq9StjUM0uJ8l1u7G3bG9O9E8kL9vY9L1k6W8d9K2',
    SESSION_SECRET: 'verify-s19-production-single-port-session-secret-64chars-ok',
  };

  const serverProc = spawn(process.execPath, [serverEntry], {
    cwd: ROOT_DIR,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverStdout = '';
  let serverStderr = '';
  serverProc.stdout.on('data', (chunk) => {
    serverStdout += chunk.toString('utf8');
  });
  serverProc.stderr.on('data', (chunk) => {
    serverStderr += chunk.toString('utf8');
  });

  try {
    await waitForHealth(baseUrl, 15000);
    logLine(`- ✅ Tiến trình đơn server/dist/index.js đã khởi động tại ${baseUrl}`);

    // 3.1 Kiểm tra GET /api/health
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert(healthRes.status === 200, `GET /api/health trả HTTP ${healthRes.status}`);
    const healthJson = await healthRes.json();
    assert(healthJson.ok === true, 'GET /api/health phải trả { ok: true }');
    logLine(`- ✅ GET ${baseUrl}/api/health -> HTTP 200 ${JSON.stringify(healthJson)}`);

    // 3.2 Kiểm tra GET /api/config
    const configRes = await fetch(`${baseUrl}/api/config`);
    assert(configRes.status === 200, `GET /api/config trả HTTP ${configRes.status}`);
    const configJson = await configRes.json();
    assert(
      configJson.appEnv === 'production' &&
        configJson.facilityId === '75001' &&
        configJson.baseUrlHost === 'ksktd.dongnai.gov.vn' &&
        !('dbPassword' in configJson) &&
        !('password' in configJson),
      `GET /api/config không đúng kỳ vọng: ${JSON.stringify(configJson)}`,
    );
    logLine(`- ✅ GET ${baseUrl}/api/config -> HTTP 200 ${JSON.stringify(configJson)}`);

    // 3.3 Kiểm tra truy cập giao diện tĩnh HTML `/` và SPA fallback `/import` trên cùng cổng 3019
    const homeRes = await fetch(`${baseUrl}/`);
    assert(homeRes.status === 200, `GET / trả HTTP ${homeRes.status}`);
    const homeHtml = await homeRes.text();
    assert(
      homeRes.headers.get('content-type')?.includes('text/html') &&
        homeHtml.includes('<div id="root">'),
      'GET / phải trả về HTML giao diện React từ client/dist/index.html',
    );

    const spaRes = await fetch(`${baseUrl}/import`);
    assert(spaRes.status === 200, `GET /import trả HTTP ${spaRes.status}`);
    const spaHtml = await spaRes.text();
    assert(
      spaHtml.includes('<div id="root">'),
      'GET /import (SPA route) phải trả về client/dist/index.html',
    );
    logLine(
      `- ✅ GET ${baseUrl}/ và ${baseUrl}/import -> HTTP 200 text/html (phục vụ trực tiếp từ client/dist trên cùng cổng ${prodPort}).`,
    );

    // 3.4 Kiểm tra route bảo vệ /api/certificates vẫn trả HTTP 401 khi chưa đăng nhập
    const protectedRes = await fetch(`${baseUrl}/api/certificates`);
    assert(
      protectedRes.status === 401,
      `GET /api/certificates khi chưa đăng nhập phải trả 401 (nhận ${protectedRes.status})`,
    );
    logLine(`- ✅ GET ${baseUrl}/api/certificates (chưa đăng nhập) -> HTTP 401 UNAUTHORIZED.`);

    // 4. Mở trình duyệt thật bằng Playwright truy cập trực tiếp http://127.0.0.1:3019 và chụp ảnh production-single-port.png
    const executablePath = resolveBrowserExecutablePath();
    const browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });

    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 820 },
      });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !msg.text().includes('401')) {
          consoleErrors.push(msg.text());
        }
      });

      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.waitForSelector('#login-username', { timeout: 10000 });
      await page.screenshot({
        path: SCREENSHOT_OUT,
        fullPage: false,
      });

      assert(
        consoleErrors.length === 0,
        `Phát hiện lỗi console trên bản build production: ${consoleErrors.join('; ')}`,
      );

      const pngStat = fs.statSync(SCREENSHOT_OUT);
      assert(pngStat.size > 10_000, `Ảnh ${SCREENSHOT_OUT} quá nhỏ (${pngStat.size} bytes)`);
      logLine(
        `- ✅ Chụp ảnh màn hình bản build production (1 cổng ${prodPort}, 0 lỗi console): docs/evidence/S19/production-single-port.png (${pngStat.size} bytes).`,
      );
      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    if (!serverProc.killed) {
      serverProc.kill('SIGKILL');
    }
  }

  // Kiểm tra log server không rò rỉ bí mật
  assert(
    !serverStdout.includes('VerifyS19Placeholder') &&
      !serverStderr.includes('VerifyS19Placeholder'),
    'Log server không được chứa mật khẩu cấu hình',
  );
  logLine('- ✅ Quét log tiến trình đơn production: 0 rò rỉ mật khẩu/bí mật.');
  logLine('');
  logLine('## Kết luận');
  logLine('- **100% điều kiện kiểm chứng bước S19 ĐẠT (PASS).**');

  fs.writeFileSync(VERIFY_OUT, `${logs.join('\n')}\n`, 'utf8');
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
