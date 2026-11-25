import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'S13');
const VERIFY_OUT_PATH = path.join(EVIDENCE_DIR, 'verify-output.txt');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`VERIFY S13 FAILED: ${message}`);
  }
}

async function readAllFiles(dir: string, exts: string[]): Promise<Array<{ file: string; content: string }>> {
  const results: Array<{ file: string; content: string }> = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await readAllFiles(full, exts)));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      const content = await fs.readFile(full, 'utf8');
      results.push({ file: path.relative(ROOT_DIR, full), content });
    }
  }
  return results;
}

async function main(): Promise<void> {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const lines: string[] = [
    '# Báo cáo kiểm chứng bước S13 — Client: khung, đăng nhập, API layer',
    '',
    '## 1. Kiểm tra 3 ảnh chụp màn hình thực tế (Browser Subagent trên dev:mock)',
  ];

  const requiredScreenshots = [
    '01-login-page.png',
    '02-app-shell-test-env.png',
    '03-app-shell-prod-banner.png',
  ];

  for (const name of requiredScreenshots) {
    const filePath = path.join(EVIDENCE_DIR, name);
    const buf = await fs.readFile(filePath);
    assert(buf.length > 5_000, `Ảnh ${name} quá nhỏ (${buf.length} bytes)`);
    assert(
      buf.subarray(0, 8).equals(PNG_MAGIC),
      `Ảnh ${name} không đúng chữ ký PNG hợp lệ`,
    );
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    lines.push(`- ✅ \`docs/evidence/S13/${name}\`: ${buf.length} bytes (${width}x${height} px, PNG hợp lệ)`);
  }

  // 2. Kiểm tra mã nguồn client/src tuân thủ kiến trúc S13
  lines.push('', '## 2. Kiểm tra kiến trúc mã nguồn `client/src`');
  const requiredFiles = [
    'client/src/api/http.ts',
    'client/src/api/auth.ts',
    'client/src/api/certificates.ts',
    'client/src/api/import.ts',
    'client/src/api/send.ts',
    'client/src/pages/LoginPage.tsx',
    'client/src/components/EnvBanner.tsx',
    'client/src/App.tsx',
    'client/src/main.tsx',
  ];
  for (const rel of requiredFiles) {
    const full = path.join(ROOT_DIR, rel);
    const stat = await fs.stat(full);
    assert(stat.isFile(), `Thiếu file bắt buộc: ${rel}`);
    lines.push(`- ✅ \`${rel}\` (${stat.size} bytes)`);
  }

  const httpSrc = await fs.readFile(path.join(ROOT_DIR, 'client/src/api/http.ts'), 'utf8');
  assert(
    httpSrc.includes("'X-Requested-With'") && httpSrc.includes("'gksk'"),
    'client/src/api/http.ts phải tự gắn header X-Requested-With: gksk',
  );
  assert(
    httpSrc.includes("credentials: 'include'"),
    'client/src/api/http.ts phải bật credentials: include cho cookie phiên',
  );

  const clientSrcFiles = await readAllFiles(path.join(ROOT_DIR, 'client/src'), ['.ts', '.tsx']);
  const forbiddenSourcePatterns = [
    'EntryPage',
    'CertificateForm',
    'react-hook-form',
    'GKSK_PASSWORD',
    'DB_PASSWORD',
    'SESSION_SECRET',
    'APP_LOGIN_PASSWORD_HASH',
  ];
  for (const { file, content } of clientSrcFiles) {
    for (const pattern of forbiddenSourcePatterns) {
      assert(
        !content.includes(pattern),
        `Phát hiện chuỗi cấm "${pattern}" trong ${file}`,
      );
    }
  }
  lines.push(
    '- ✅ `client/src/api/http.ts` gắn sẵn `X-Requested-With: gksk` & `credentials: include`.',
    '- ✅ Quét toàn bộ `client/src`: 0 tham chiếu tới `EntryPage`, `CertificateForm`, `react-hook-form` hay biến bí mật server.',
  );

  // 3. Kiểm tra bản build client/dist không rò rỉ bí mật CSYT/DB
  lines.push('', '## 3. Kiểm tra bản build `client/dist`');
  const distDir = path.join(ROOT_DIR, 'client/dist');
  const distFiles = await readAllFiles(distDir, ['.html', '.js', '.css']);
  assert(distFiles.length >= 2, 'Không tìm thấy bản build client/dist');
  const forbiddenBundleStrings = [
    'GKSK_PASSWORD',
    'DB_PASSWORD',
    'SESSION_SECRET',
    'APP_LOGIN_PASSWORD_HASH',
    'mock_db_password_only',
    'gksk-dev-mock-session-secret',
  ];
  for (const { file, content } of distFiles) {
    for (const needle of forbiddenBundleStrings) {
      assert(!content.includes(needle), `Bundle ${file} chứa bí mật: ${needle}`);
    }
  }
  lines.push(
    `- ✅ Quét ${distFiles.length} file trong \`client/dist\`: 0 bí mật/token CSYT/DB bị nhúng vào bundle client.`,
    '',
    '## 4. Kết luận',
    '- **100% hạng mục kiểm chứng bước S13 ĐẠT (PASS).**',
  );

  const output = `${lines.join('\n')}\n`;
  await fs.writeFile(VERIFY_OUT_PATH, output, 'utf8');
  process.stdout.write(
    `[verify-S13] PASS — 3 anh PNG hop le, ${requiredFiles.length} file nguon S13 day du, 0 ro ri bi mat trong client/dist.\n`,
  );
  process.stdout.write(`[verify-S13] Bien ban luu tai: ${VERIFY_OUT_PATH}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
