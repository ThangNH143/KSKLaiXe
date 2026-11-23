import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const evidenceDir = resolve(rootDir, 'docs', 'evidence', 'S0');
const outputFile = resolve(evidenceDir, 'verify-output.txt');

const isWin = process.platform === 'win32';
const npmBin = isWin ? 'npm.cmd' : 'npm';

const lines = [];
function log(text = '') {
  lines.push(text);
  process.stdout.write(`${text}\n`);
}

function runStep(title, cmd, args) {
  log(`\n=== ${title} ===`);
  log(`$ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    encoding: 'utf8',
    shell: isWin,
  });

  if (result.stdout) {
    log(result.stdout.trimEnd());
  }
  if (result.stderr) {
    log(result.stderr.trimEnd());
  }
  if (result.status !== 0) {
    throw new Error(`Bước "${title}" thất bại với mã thoát ${result.status}`);
  }
  log(`[PASS] ${title}`);
}

async function checkHealthEndpoint() {
  log('\n=== Kiểm tra thực tế GET /api/health ===');
  const testPort = 3099;
  const serverProc = spawn(process.execPath, [resolve(rootDir, 'server', 'dist', 'index.js')], {
    cwd: rootDir,
    env: { ...process.env, PORT: String(testPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLogs = '';
  serverProc.stdout.on('data', (chunk) => {
    serverLogs += chunk.toString();
  });
  serverProc.stderr.on('data', (chunk) => {
    serverLogs += chunk.toString();
  });

  try {
    const url = `http://127.0.0.1:${testPort}/api/health`;
    let response = null;
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        response = await fetch(url);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    if (!response) {
      throw new Error(`Không thể kết nối tới ${url}. Server logs:\n${serverLogs}`);
    }

    const bodyText = await response.text();
    log(`URL: ${url}`);
    log(`HTTP Status: ${response.status}`);
    log(`Body: ${bodyText}`);

    if (response.status !== 200) {
      throw new Error(`Mong đợi HTTP 200 nhưng nhận ${response.status}`);
    }
    const parsed = JSON.parse(bodyText);
    if (parsed.ok !== true) {
      throw new Error(`Mong đợi {"ok":true} nhưng nhận ${bodyText}`);
    }
    log(`[PASS] GET /api/health trả về HTTP 200 {"ok":true}`);
  } finally {
    serverProc.kill();
  }
}

async function main() {
  log(`GKSKLaiXe — Script kiểm chứng bước S0`);
  log(`Thời gian chạy: ${new Date().toISOString()}`);
  log(`Node version: ${process.version}`);

  runStep('1. ESLint (npm run lint)', npmBin, ['run', 'lint']);
  runStep('2. TypeScript Typecheck (npm run typecheck)', npmBin, ['run', 'typecheck']);
  runStep('3. Vitest Unit & Integration Tests (npm test)', npmBin, ['test']);
  runStep('4. Workspace Build (npm run build)', npmBin, ['run', 'build']);
  runStep('5. Kiểm tra .gitignore chặn .env', 'git', ['check-ignore', '-v', '.env']);
  await checkHealthEndpoint();

  log('\n=== TỔNG KẾT S0 ===');
  log('TẤT CẢ CÁC BƯỚC KIỂM CHỨNG S0 ĐỀU THÀNH CÔNG (PASS).');

  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(outputFile, `${lines.join('\n')}\n`, 'utf8');
  process.stdout.write(`\nĐã lưu bằng chứng tại: ${outputFile}\n`);
}

main().catch((err) => {
  log(`\n[FAIL] ${err instanceof Error ? err.message : String(err)}`);
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(outputFile, `${lines.join('\n')}\n`, 'utf8');
  process.exit(1);
});
