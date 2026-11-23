import fs from 'node:fs';
import { createMockGkskApp } from './app.js';

function startMockServer(): void {
  const portRaw = process.env.MOCK_PORT ?? '4010';
  const port = Number.parseInt(portRaw, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    process.stderr.write(`MOCK_PORT không hợp lệ: ${portRaw}\n`);
    process.exit(1);
  }

  const verifySignature = process.env.MOCK_VERIFY_SIGNATURE === '1';
  let publicKeyPem = process.env.MOCK_PUBLIC_KEY_PEM ?? '';
  if (!publicKeyPem && process.env.MOCK_PUBLIC_KEY_PATH) {
    publicKeyPem = fs.readFileSync(process.env.MOCK_PUBLIC_KEY_PATH, 'utf8');
  }

  const app = createMockGkskApp({
    verifySignature,
    publicKeyPem,
  });

  app.listen(port, '127.0.0.1', () => {
    process.stdout.write(
      `[mock-gksk-api] Listening on http://127.0.0.1:${port} (verifySignature=${verifySignature})\n`,
    );
  });
}

startMockServer();
