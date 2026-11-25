import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createMockGkskApp } from '../../tools/mock-gksk-api/src/app.js';
import { createApp } from '../../server/src/app.js';
import { createInMemoryRepositories } from '../../server/src/db/inMemoryRepo.js';
import { createGkskClient } from '../../server/src/gksk/client.js';
import { createLogger } from '../../server/src/logger.js';
import { createSendService } from '../../server/src/services/sendService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const EVIDENCE_S17_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'S17');
const LOG_FILE_PATH = path.join(EVIDENCE_S17_DIR, 'e2e-server.log');

async function main(): Promise<void> {
  fs.mkdirSync(EVIDENCE_S17_DIR, { recursive: true });
  const logFileStream = fs.createWriteStream(LOG_FILE_PATH, {
    flags: 'a',
    encoding: 'utf8',
  });

  const teeStream = new Writable({
    write(chunk, _encoding, callback) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      process.stdout.write(buf);
      logFileStream.write(buf, callback);
    },
  });

  const logger = createLogger({
    level: 'info',
    destination: teeStream,
  });

  const repos = createInMemoryRepositories();

  // 1. Khởi chạy Mock GKSK API trên cổng 4010
  const mockApp = createMockGkskApp({ verifySignature: false });
  mockApp.post('/__e2e/reset', (_req, res) => {
    repos.resetAll();
    logger.info(
      { event: 'e2e_reset' },
      'Đã làm sạch InMemoryRepositories cho lượt chạy E2E',
    );
    res.status(200).json({ ok: true });
  });

  await new Promise<void>((resolve) => {
    mockApp.listen(4010, '127.0.0.1', () => {
      logger.info({ port: 4010 }, 'E2E Mock GKSK API listening');
      resolve();
    });
  });

  // 2. Khởi tạo GKSKLaiXe Express Server trên cổng 3001
  const facilityId = '75001';
  const facilityName = 'Benh vien Da khoa Dong Nai';
  const baseUrl = 'http://127.0.0.1:4010';

  const gkskClient = createGkskClient({
    baseUrl,
    username: facilityId,
    password: 'mock',
    httpTimeoutMs: 5000,
    logger,
  });

  const sendService = createSendService({
    repos,
    gkskClient,
    facilityId,
    senderId: facilityId,
    today: '2026-11-25',
    retryOptions: {
      maxRetries: 3,
      retryDelaysMs: [20, 40, 60],
    },
    logger,
  });

  const app = createApp({
    appEnv: 'test',
    baseUrl,
    facilityId,
    facilityName,
    repos,
    gkskClient,
    sendService,
    today: '2026-11-25',
    logger,
  });

  await new Promise<void>((resolve) => {
    app.listen(3001, '127.0.0.1', () => {
      logger.info({ port: 3001 }, 'E2E GKSKLaiXe API Server listening');
      resolve();
    });
  });

  // 3. Khởi chạy Vite Client trên cổng 5173
  const vite = await createViteServer({
    root: path.join(ROOT_DIR, 'client'),
    configFile: path.join(ROOT_DIR, 'client', 'vite.config.ts'),
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
  });
  await vite.listen();
  logger.info({ port: 5173 }, 'E2E Vite Client listening');
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
