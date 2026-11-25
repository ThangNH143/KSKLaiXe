import express, { type Express } from 'express';
import type { Logger } from 'pino';
import { createRepositories } from './db/connection.js';
import type { DbRepositories } from './db/types.js';
import { createGkskClient, type GkskClient } from './gksk/client.js';
import { logger as defaultLogger } from './logger.js';
import { createErrorHandler } from './middleware/errorHandler.js';
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

export interface CreateAppOptions {
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
}

export function createApp(options?: CreateAppOptions): Express {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const log = options?.logger ?? defaultLogger;
  const repos = options?.repos ?? createRepositories();
  const facilityId = (options?.facilityId ?? process.env.GKSK_FACILITY_ID ?? '75001').trim();
  const facilityName = (
    options?.facilityName ??
    process.env.GKSK_FACILITY_NAME ??
    'Benh vien Da khoa Dong Nai'
  ).trim();
  const senderId = (options?.senderId ?? process.env.GKSK_SENDER_ID ?? facilityId).trim();

  const gkskClient =
    options?.gkskClient ??
    createGkskClient({
      baseUrl: process.env.GKSK_BASE_URL ?? 'http://127.0.0.1:4010',
      username: process.env.GKSK_USERNAME ?? facilityId,
      password: process.env.GKSK_PASSWORD ?? 'mock',
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

  app.use('/api', healthRouter);
  app.use('/api', createImportRouter({ importService }));
  app.use('/api', createCertificatesRouter({ certificateService }));
  app.use('/api', createSendRouter({ sendService, jobService }));
  app.use(createErrorHandler(log));

  return app;
}
