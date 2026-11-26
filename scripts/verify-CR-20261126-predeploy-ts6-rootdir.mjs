#!/usr/bin/env node
// Script kiểm chứng CR-20261126-predeploy-ts6-rootdir:
// - Kiểm tra toàn bộ các file tsconfig*.json trong monorepo:
//   + server/tsconfig.json phải có compilerOptions.rootDir = ".." để tương thích TypeScript 6 (VS Code tsserver)
//   + server/tsconfig.build.json phải có compilerOptions.rootDir = "src" để khi build chỉ xuất ra server/dist/index.js
// - Chạy cổng kiểm tra toàn diện trước khi commit / deploy production:
//   1. npm run lint (ESLint toàn bộ dự án)
//   2. npm run typecheck (tsc --noEmit toàn bộ 4 workspaces)
//   3. npm run build (build production cho shared, server, client + xác nhận cấu trúc server/dist/index.js)
//   4. npm test (toàn bộ 22 file test / 268 ca kiểm thử trên InMemoryRepositories)
// - Lưu biên bản kiểm chứng vào docs/evidence/CR-20261126-predeploy-ts6-rootdir/verify-output.txt

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(
  ROOT_DIR,
  'docs',
  'evidence',
  'CR-20261126-predeploy-ts6-rootdir',
);

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

function runCmd(label, command) {
  log(`--- Đang chạy: ${label} (${command}) ---`);
  const out = execSync(command, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  log(`PASS: ${label} hoàn tất (exit code 0)`);
  return out;
}

function main() {
  log('=== BẮT ĐẦU KIỂM CHỨNG CR-20261126-predeploy-ts6-rootdir & RÀ SOÁT TOÀN BỘ DỰ ÁN TRƯỚC DEPLOY ===');

  // 1. Kiểm tra cấu hình server/tsconfig.json và server/tsconfig.build.json
  const serverTsconfigPath = path.join(ROOT_DIR, 'server', 'tsconfig.json');
  const serverTsconfigBuildPath = path.join(ROOT_DIR, 'server', 'tsconfig.build.json');

  const serverTsconfig = JSON.parse(fs.readFileSync(serverTsconfigPath, 'utf8'));
  const serverTsconfigBuild = JSON.parse(fs.readFileSync(serverTsconfigBuildPath, 'utf8'));

  assert(
    serverTsconfig?.compilerOptions?.rootDir === '..',
    'server/tsconfig.json có compilerOptions.rootDir === ".." (sửa triệt để lỗi VS Code TypeScript 6 rootDir)',
  );
  assert(
    serverTsconfigBuild?.compilerOptions?.rootDir === 'src',
    'server/tsconfig.build.json có compilerOptions.rootDir === "src" (giữ nguyên đường dẫn build server/dist/index.js)',
  );

  // 2. Kiểm tra tất cả các tsconfig.json khác trong monorepo đều có rootDir hoặc noEmit hợp lệ
  const sharedTsconfig = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'packages', 'shared', 'tsconfig.json'), 'utf8'),
  );
  const mockTsconfig = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'tools', 'mock-gksk-api', 'tsconfig.json'), 'utf8'),
  );
  const clientTsconfig = JSON.parse(
    fs.readFileSync(path.join(ROOT_DIR, 'client', 'tsconfig.json'), 'utf8'),
  );

  assert(
    sharedTsconfig?.compilerOptions?.rootDir === 'src',
    'packages/shared/tsconfig.json có compilerOptions.rootDir === "src"',
  );
  assert(
    mockTsconfig?.compilerOptions?.rootDir === 'src',
    'tools/mock-gksk-api/tsconfig.json có compilerOptions.rootDir === "src"',
  );
  assert(
    clientTsconfig?.compilerOptions?.noEmit === true,
    'client/tsconfig.json có compilerOptions.noEmit === true',
  );

  // 3. Chạy ESLint
  runCmd('ESLint (npm run lint)', `${npmBin} run lint`);

  // 4. Chạy TypeScript typecheck toàn monorepo
  runCmd('TypeScript Typecheck (npm run typecheck)', `${npmBin} run typecheck`);

  // 5. Xóa thử server/dist cũ rồi chạy npm run build để đảm bảo layout đầu ra của server/dist chuẩn 100%
  const serverDistDir = path.join(ROOT_DIR, 'server', 'dist');
  fs.rmSync(serverDistDir, { recursive: true, force: true });
  runCmd('Production Build (npm run build)', `${npmBin} run build`);

  assert(
    fs.existsSync(path.join(serverDistDir, 'index.js')),
    'Sau khi build, server/dist/index.js tồn tại đúng ở gốc server/dist/',
  );
  assert(
    !fs.existsSync(path.join(serverDistDir, 'src', 'index.js')),
    'Sau khi build, KHÔNG bị lồng thư mục server/dist/src/index.js',
  );
  assert(
    fs.existsSync(path.join(ROOT_DIR, 'client', 'dist', 'index.html')),
    'Sau khi build, client/dist/index.html tồn tại đầy đủ',
  );

  // 6. Chạy toàn bộ bộ test tự động (22 test files / 268 tests)
  const testOut = runCmd('Vitest Suite (npm test)', `${npmBin} test`);
  assert(
    testOut.includes('145 passed') &&
      testOut.includes('92 passed') &&
      testOut.includes('21 passed') &&
      testOut.includes('10 passed'),
    'Toàn bộ 4 workspaces (145 + 92 + 21 + 10 = 268 tests) đều PASS 100%',
  );

  // 7. Kiểm tra an toàn Git trước khi commit (.env không bị lộ, .gitignore chuẩn)
  const gitignoreContent = fs.readFileSync(path.join(ROOT_DIR, '.gitignore'), 'utf8');
  assert(
    gitignoreContent.includes('.env') && gitignoreContent.includes('dist'),
    '.gitignore đã chặn đầy đủ .env và dist/',
  );
  assert(
    !fs.existsSync(path.join(ROOT_DIR, '.env')),
    'Không có file .env chứa mật khẩu thật nằm trong thư mục gốc',
  );

  log('=== HOÀN TẤT KIỂM CHỨNG CR-20261126-predeploy-ts6-rootdir: 100% PASS, SẴN SÀNG COMMIT & DEPLOY PRODUCTION ===');

  const outPath = path.join(EVIDENCE_DIR, 'verify-output.txt');
  fs.writeFileSync(outPath, `${logLines.join('\n')}\n`, 'utf8');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
