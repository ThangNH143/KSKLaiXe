import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from '../server/src/config.js';
import { createLogger } from '../server/src/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'S1');
const EVIDENCE_FILE = path.join(EVIDENCE_DIR, 'verify-output.txt');

const outputLines: string[] = [];

function log(line = ''): void {
  outputLines.push(line);
  process.stdout.write(`${line}\n`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`VERIFY FAILED: ${message}`);
  }
}

log('======================================================================');
log('GKSKLaiXe — KIỂM CHỨNG BƯỚC S1: CẤU HÌNH (ZOD) & LOGGER (PINO REDACT)');
log(`Thời điểm chạy: ${new Date().toISOString()}`);
log('======================================================================\n');

// 1. Kiểm tra .env.example có đầy đủ các biến theo project_context.md §7
log('[1] Kiểm tra file .env.example');
const envExamplePath = path.join(ROOT_DIR, '.env.example');
assert(fs.existsSync(envExamplePath), 'Thiếu file .env.example');
const envExampleContent = fs.readFileSync(envExamplePath, 'utf8');
const requiredEnvKeys = [
  'APP_ENV',
  'PORT',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'DB_ENCRYPT',
  'DB_TRUST_SERVER_CERT',
  'GKSK_BASE_URL',
  'GKSK_USERNAME',
  'GKSK_PASSWORD',
  'GKSK_FACILITY_ID',
  'GKSK_FACILITY_NAME',
  'GKSK_SENDER_ID',
  'GKSK_PRIVATE_KEY_PATH',
  'GKSK_HTTP_TIMEOUT_MS',
  'APP_LOGIN_USER',
  'APP_LOGIN_PASSWORD_HASH',
  'SESSION_SECRET',
];
const missingInExample = requiredEnvKeys.filter(
  (key) => !new RegExp(`^${key}=`, 'm').test(envExampleContent),
);
assert(
  missingInExample.length === 0,
  `Thiếu biến trong .env.example: ${missingInExample.join(', ')}`,
);
log(`PASS: .env.example chứa đủ ${requiredEnvKeys.length}/${requiredEnvKeys.length} biến chuẩn.\n`);

// 2. Thử loadConfig với bộ biến thiếu -> fail-fast nêu rõ tên biến, không in giá trị bí mật
log('[2] Kiểm chứng fail-fast khi thiếu biến cấu hình');
try {
  loadConfig({
    APP_ENV: 'test',
    DB_HOST: 'localhost',
    DB_PASSWORD: 'SUPER_SECRET_DB_VALUE_MUST_NOT_APPEAR',
    SESSION_SECRET: 'TOO_SHORT_VAL',
  });
  assert(false, 'loadConfig lẽ ra phải ném ConfigError');
} catch (err) {
  assert(err instanceof ConfigError, 'Lỗi phải là ConfigError');
  const message = (err as ConfigError).message;
  assert(message.includes('DB_USER'), 'Phải nêu thiếu DB_USER');
  assert(message.includes('DB_NAME'), 'Phải nêu thiếu DB_NAME');
  assert(message.includes('GKSK_BASE_URL'), 'Phải nêu thiếu GKSK_BASE_URL');
  assert(message.includes('GKSK_PASSWORD'), 'Phải nêu thiếu GKSK_PASSWORD');
  assert(message.includes('SESSION_SECRET'), 'Phải nêu lỗi SESSION_SECRET');
  assert(
    !message.includes('SUPER_SECRET_DB_VALUE_MUST_NOT_APPEAR'),
    'Không được in giá trị DB_PASSWORD',
  );
  assert(!message.includes('TOO_SHORT_VAL'), 'Không được in giá trị SESSION_SECRET');
  log('Thông báo lỗi fail-fast thực tế:');
  log(message);
  log('PASS: Nêu rõ tên biến thiếu/sai và không lộ giá trị bí mật.\n');
}

// 3. Kiểm chứng chuẩn hóa GKSK_BASE_URL, production + http://, GKSK_SENDER_ID mặc định
log('[3] Kiểm chứng chuẩn hóa GKSK_BASE_URL, production HTTPS và GKSK_SENDER_ID mặc định');
const validEnv: NodeJS.ProcessEnv = {
  APP_ENV: 'test',
  PORT: '3001',
  DB_HOST: 'localhost',
  DB_PORT: '1433',
  DB_USER: 'sa',
  DB_PASSWORD: 'TestDbPassword!1',
  DB_NAME: 'GKSKLaiXe',
  DB_ENCRYPT: 'false',
  DB_TRUST_SERVER_CERT: 'true',
  GKSK_BASE_URL: 'https://api.dongnai.gov.vn///',
  GKSK_USERNAME: '75001',
  GKSK_PASSWORD: 'TestCsytPassword!1',
  GKSK_FACILITY_ID: '75001',
  GKSK_FACILITY_NAME: 'TTYT Mau Dong Nai',
  GKSK_SENDER_ID: '',
  GKSK_HTTP_TIMEOUT_MS: '30000',
  APP_LOGIN_USER: 'admin',
  APP_LOGIN_PASSWORD_HASH: '$2b$10$dummyhashvalueforverification1234567890123456789012',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
};
const parsed = loadConfig(validEnv);
assert(parsed.gksk.baseUrl === 'https://api.dongnai.gov.vn', 'Phải bỏ dấu / cuối GKSK_BASE_URL');
assert(parsed.gksk.senderId === '75001', 'GKSK_SENDER_ID trống phải mặc định bằng GKSK_FACILITY_ID');
log(`- GKSK_BASE_URL chuẩn hóa: "https://api.dongnai.gov.vn///" -> "${parsed.gksk.baseUrl}"`);
log(`- GKSK_SENDER_ID mặc định: "" -> "${parsed.gksk.senderId}"`);

let prodHttpRejected = false;
try {
  loadConfig({
    ...validEnv,
    APP_ENV: 'production',
    GKSK_BASE_URL: 'http://api.dongnai.gov.vn',
  });
} catch (err) {
  if (err instanceof ConfigError && err.message.includes('https://')) {
    prodHttpRejected = true;
    log(`- APP_ENV=production + http:// -> bị chặn đúng: ${err.issues[0]?.message}`);
  }
}
assert(prodHttpRejected, 'APP_ENV=production phải từ chối http://');
log('PASS: Chuẩn hóa URL, HTTPS production và mặc định GKSK_SENDER_ID hoạt động chính xác.\n');

// 4. Chạy thực tế server thiếu .env -> phải thoát mã != 0 với thông báo rõ
log('[4] Kiểm chứng chạy server/src/index.ts khi thiếu .env (thoát mã != 0)');
const tsxCli = path.join(ROOT_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverEntry = path.join(ROOT_DIR, 'server', 'src', 'index.ts');
const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gksk-verify-s1-'));
try {
  const proc = spawnSync(process.execPath, [tsxCli, serverEntry], {
    cwd: isolatedDir,
    env: {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
    },
    encoding: 'utf8',
    timeout: 15000,
  });
  log(`- Exit code: ${proc.status}`);
  log('- Stderr:');
  log((proc.stderr || '').trim());
  assert(proc.status !== null && proc.status !== 0, 'Server thiếu .env phải thoát mã khác 0');
  assert(
    (proc.stderr || '').includes('GKSK_BASE_URL') && (proc.stderr || '').includes('DB_HOST'),
    'Stderr phải nêu rõ tên biến môi trường bị thiếu',
  );
  log('PASS: Server fail-fast thoát mã khác 0 với thông báo rõ ràng.\n');
} finally {
  fs.rmSync(isolatedDir, { recursive: true, force: true });
}

// 5. Kiểm chứng logger.info redact toàn bộ mật khẩu, token, PII
log('[5] Kiểm chứng Pino logger redact mật khẩu, token và PII');
const capturedChunks: string[] = [];
const captureStream = new Writable({
  write(chunk, _encoding, callback) {
    capturedChunks.push(chunk.toString('utf8'));
    callback();
  },
});

const testLogger = createLogger({ level: 'info', destination: captureStream });
testLogger.info(
  {
    msgId: '750012611230123456789abcdef01234567',
    password: 'SECRET_123',
    dbPassword: 'DB_SECRET_456',
    authorization: 'Bearer TOKEN_789',
    token: 'JWT_SECRET_000',
    data: 'BASE64_XML_SECRET_DATA',
    fields: {
      HOTEN: 'NGUYEN VAN A',
      SOCMND_PASSPORT: '079000012345',
    },
    nested: {
      headers: {
        Authorization: 'Bearer NESTED_SECRET_999',
      },
      db: {
        dbPassword: 'NESTED_DB_SECRET_888',
      },
    },
  },
  'Kiểm thử redact S1',
);

const rawJsonLog = capturedChunks.join('').trim();
log('Dòng JSON log thực tế sau redact:');
log(rawJsonLog);

const forbiddenSecrets = [
  'SECRET_123',
  'DB_SECRET_456',
  'TOKEN_789',
  'JWT_SECRET_000',
  'BASE64_XML_SECRET_DATA',
  'NGUYEN VAN A',
  '079000012345',
  'NESTED_SECRET_999',
  'NESTED_DB_SECRET_888',
];
for (const secret of forbiddenSecrets) {
  assert(!rawJsonLog.includes(secret), `RÒ RỈ BÍ MẬT/PII trong log: ${secret}`);
}
const parsedLog = JSON.parse(rawJsonLog) as Record<string, unknown>;
assert(parsedLog.password === '[Redacted]', 'password phải thành [Redacted]');
assert(parsedLog.dbPassword === '[Redacted]', 'dbPassword phải thành [Redacted]');
assert(parsedLog.authorization === '[Redacted]', 'authorization phải thành [Redacted]');
assert(parsedLog.token === '[Redacted]', 'token phải thành [Redacted]');
assert(parsedLog.data === '[Redacted]', 'data phải thành [Redacted]');
assert(parsedLog.fields === '[Redacted]', 'fields phải thành [Redacted]');
log('PASS: 100% trường bí mật & PII đã bị che thành "[Redacted]", 0 giá trị bị rò rỉ.\n');

log('======================================================================');
log('KẾT LUẬN: TOÀN BỘ 5 MỤC KIỂM CHỨNG BƯỚC S1 ĐỀU ĐẠT (PASS)');
log('======================================================================');

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.writeFileSync(EVIDENCE_FILE, `${outputLines.join('\n')}\n`, 'utf8');
process.stdout.write(`\nĐã lưu bằng chứng tại: ${EVIDENCE_FILE}\n`);
