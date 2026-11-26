import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import {
  getPublicConfig,
  type AppConfig,
  type AppEnv,
  type PublicConfig,
} from './config.js';
import { createRepositories } from './db/connection.js';
import type { DbRepositories } from './db/types.js';
import { createGkskClient, type GkskClient } from './gksk/client.js';
import { logger as defaultLogger } from './logger.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import {
  createLoginRateLimiter,
  type LoginRateLimiter,
} from './middleware/rateLimit.js';
import {
  createCsrfMiddleware,
  createRequireAuthMiddleware,
  createSessionStore,
  type SessionStore,
} from './middleware/requireAuth.js';
import { createAuthRouter, createConfigRouter } from './routes/auth.js';
import { createCertificatesRouter } from './routes/certificates.js';
import { healthRouter } from './routes/health.js';
import { createImportRouter } from './routes/import.js';
import { createSendRouter } from './routes/send.js';
import {
  createCertificateService,
  type CertificateService,
} from './services/certificateService.js';
import {
  createImportService,
  type ImportService,
} from './services/importService.js';
import { createJobService, type JobService } from './services/jobService.js';
import { createSendService, type SendService } from './services/sendService.js';

export const DEFAULT_TEST_LOGIN_USER = 'admin';
export const DEFAULT_TEST_LOGIN_PASSWORD = 'gksk-test-password';
export const DEFAULT_TEST_SESSION_SECRET =
  'gksk-test-session-secret-do-not-use-in-production-32chars';

let cachedTestPasswordHash: string | null = null;
function getDefaultTestPasswordHash(): string {
  if (!cachedTestPasswordHash) {
    cachedTestPasswordHash = bcrypt.hashSync(DEFAULT_TEST_LOGIN_PASSWORD, 4);
  }
  return cachedTestPasswordHash;
}

export interface AuthAppOptions {
  loginUser: string;
  loginPasswordHash: string;
  sessionSecret: string;
}

export interface CreateAppOptions {
  config?: AppConfig;
  appEnv?: AppEnv;
  baseUrl?: string;
  auth?: Partial<AuthAppOptions>;
  sessionStore?: SessionStore;
  rateLimiter?: LoginRateLimiter;
  repos?: DbRepositories;
  gkskClient?: GkskClient;
  certificateService?: CertificateService;
  importService?: ImportService;
  sendService?: SendService;
  jobService?: JobService;
  facilityId?: string;
  facilityName?: string;
  senderId?: string;
  privateKeyPem?: string;
  today?: string | Date;
  now?: () => number;
  logger?: Logger;
  /** Bật phục vụ giao diện tĩnh `client/dist` (mặc định tự bật khi `NODE_ENV=production`). */
  serveClientDist?: boolean;
  /** Đường dẫn tùy chỉnh tới thư mục `client/dist` (mặc định tự dò tương đối theo monorepo). */
  clientDistDir?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveClientDistDir(customDir?: string): string | null {
  const candidates = [
    ...(customDir ? [path.resolve(customDir)] : []),
    path.resolve(__dirname, '..', '..', '..', 'client', 'dist'),
    path.resolve(__dirname, '..', '..', 'client', 'dist'),
    path.resolve(process.cwd(), 'client', 'dist'),
    path.resolve(process.cwd(), '..', 'client', 'dist'),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  return null;
}

function resolveHostSafely(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return rawUrl;
  }
}

export function createApp(options?: CreateAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '5mb' }));

  const cfg = options?.config;
  const log = options?.logger ?? defaultLogger;
  const repos = options?.repos ?? createRepositories();

  const appEnv: AppEnv =
    options?.appEnv ??
    cfg?.appEnv ??
    (process.env.APP_ENV === 'production' ? 'production' : 'test');

  const facilityId = (
    options?.facilityId ??
    cfg?.gksk.facilityId ??
    process.env.GKSK_FACILITY_ID ??
    '75001'
  ).trim();

  const facilityName = (
    options?.facilityName ??
    cfg?.gksk.facilityName ??
    process.env.GKSK_FACILITY_NAME ??
    'Benh vien Da khoa Dong Nai'
  ).trim();

  const senderId = (
    options?.senderId ??
    cfg?.gksk.senderId ??
    process.env.GKSK_SENDER_ID ??
    facilityId
  ).trim();

  const baseUrl = (
    options?.baseUrl ??
    cfg?.gksk.baseUrl ??
    process.env.GKSK_BASE_URL ??
    'http://127.0.0.1:4010'
  )
    .trim()
    .replace(/\/+$/, '');

  const loginUser = (
    options?.auth?.loginUser ??
    cfg?.auth.loginUser ??
    process.env.APP_LOGIN_USER ??
    DEFAULT_TEST_LOGIN_USER
  ).trim();

  const rawLoginPasswordHash =
    options?.auth?.loginPasswordHash ??
    cfg?.auth.loginPasswordHash ??
    process.env.APP_LOGIN_PASSWORD_HASH;

  const rawSessionSecret =
    options?.auth?.sessionSecret ??
    cfg?.auth.sessionSecret ??
    process.env.SESSION_SECRET;

  if (appEnv === 'production' && (!rawLoginPasswordHash || !rawSessionSecret)) {
    throw new Error(
      'Khi APP_ENV=production, bắt buộc phải cấu hình APP_LOGIN_PASSWORD_HASH và SESSION_SECRET.',
    );
  }

  const loginPasswordHash = rawLoginPasswordHash ?? getDefaultTestPasswordHash();
  const sessionSecret = rawSessionSecret ?? DEFAULT_TEST_SESSION_SECRET;

  const publicConfig: PublicConfig = cfg
    ? {
        ...getPublicConfig(cfg),
        appEnv,
        facilityId,
        facilityName,
        baseUrlHost: resolveHostSafely(baseUrl),
      }
    : {
        appEnv,
        facilityId,
        facilityName,
        baseUrlHost: resolveHostSafely(baseUrl),
      };

  const sessionStore =
    options?.sessionStore ??
    createSessionStore({
      sessionSecret,
      ...(options?.now !== undefined ? { now: options.now } : {}),
    });

  const rateLimiter =
    options?.rateLimiter ??
    createLoginRateLimiter({
      ...(options?.now !== undefined ? { now: options.now } : {}),
    });

  const csrfMiddleware = createCsrfMiddleware();
  const requireAuth = createRequireAuthMiddleware(sessionStore);

  const gkskClient =
    options?.gkskClient ??
    createGkskClient({
      baseUrl,
      username: cfg?.gksk.username ?? process.env.GKSK_USERNAME ?? facilityId,
      password: cfg?.gksk.password ?? process.env.GKSK_PASSWORD ?? 'mock',
      ...(cfg?.gksk.httpTimeoutMs !== undefined
        ? { httpTimeoutMs: cfg.gksk.httpTimeoutMs }
        : {}),
      logger: log,
    });

  const certificateService =
    options?.certificateService ??
    createCertificateService({
      repos,
      facilityId,
      facilityName,
      ...(options?.today !== undefined ? { today: options.today } : {}),
      ...(options?.now !== undefined ? { now: options.now } : {}),
    });

  const importService =
    options?.importService ??
    createImportService({
      repos,
      facilityId,
      facilityName,
      ...(options?.today !== undefined ? { today: options.today } : {}),
      ...(options?.now !== undefined ? { now: options.now } : {}),
      logger: log,
    });

  const sendService =
    options?.sendService ??
    createSendService({
      repos,
      gkskClient,
      facilityId,
      senderId,
      ...(options?.privateKeyPem !== undefined
        ? { privateKeyPem: options.privateKeyPem }
        : {}),
      ...(options?.today !== undefined ? { today: options.today } : {}),
      ...(options?.now !== undefined ? { now: options.now } : {}),
      logger: log,
    });

  const jobService =
    options?.jobService ??
    createJobService({
      sendService,
      logger: log,
    });

  // Các route công khai / xác thực (miễn requireAuth)
  app.use('/api', healthRouter);
  app.use('/api', createConfigRouter(publicConfig));
  app.use(
    '/api',
    createAuthRouter({
      appEnv,
      loginUser,
      loginPasswordHash,
      sessionStore,
      rateLimiter,
      csrfMiddleware,
      logger: log,
    }),
  );

  // Toàn bộ các route nghiệp vụ bắt buộc phải đăng nhập (401) và có CSRF header khi ghi (403)
  const protectedApi = Router();
  protectedApi.use(requireAuth);
  protectedApi.use(csrfMiddleware);
  protectedApi.use(createImportRouter({ importService }));
  protectedApi.use(createCertificatesRouter({ certificateService }));
  protectedApi.use(createSendRouter({ sendService, jobService }));
  app.use('/api', protectedApi);

  // Chế độ production: phục vụ luôn giao diện tĩnh React (`client/dist`) trên cùng 1 tiến trình & 1 cổng
  const shouldServeClient =
    options?.serveClientDist ?? process.env.NODE_ENV === 'production';
  if (shouldServeClient) {
    const clientDistDir = resolveClientDistDir(options?.clientDistDir);
    if (clientDistDir) {
      const indexHtmlPath = path.join(clientDistDir, 'index.html');
      app.use(
        express.static(clientDistDir, {
          index: false,
          maxAge: '1d',
        }),
      );
      app.get('*', (req, res, next) => {
        if (req.path === '/api' || req.path.startsWith('/api/')) {
          next();
          return;
        }
        res.sendFile(indexHtmlPath);
      });
    } else {
      log.warn(
        { nodeEnv: process.env.NODE_ENV },
        'Không tìm thấy thư mục client/dist/index.html để phục vụ giao diện tĩnh',
      );
    }
  }

  app.use(createErrorHandler(log));

  return app;
}
