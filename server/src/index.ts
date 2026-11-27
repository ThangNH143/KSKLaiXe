import fs from 'node:fs';
import { ping } from '@gksk/shared';
import { createApp } from './app.js';
import { ConfigError, loadConfigFromEnvFile } from './config.js';
import {
  createMssqlPool,
  createRepositories,
  runMigrations,
} from './db/connection.js';
import type { DbRepositories } from './db/types.js';
import { createLogger } from './logger.js';

async function start(): Promise<void> {
  let config;
  try {
    config = loadConfigFromEnvFile();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
    } else {
      process.stderr.write(
        `Lỗi khởi động cấu hình: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    process.exit(1);
  }

  const logger = createLogger({ level: config.logLevel });

  let repos: DbRepositories;
  if (process.env.GKSK_USE_IN_MEMORY_DB === '1') {
    repos = createRepositories();
    await repos.users.upsertByUsername({
      username: config.auth.loginUser,
      passwordHash: config.auth.loginPasswordHash,
      fullName: 'Quản trị viên CSYT',
      isActive: true,
    });
    logger.info(
      { dbKind: repos.kind },
      'Đang sử dụng InMemoryRepositories (GKSK_USE_IN_MEMORY_DB=1)',
    );
  } else {
    try {
      const pool = await createMssqlPool(config.db);
      const appliedMigrations = await runMigrations(pool);
      repos = createRepositories(pool);
      const recoveredCount = await repos.certificates.recoverOnStartup();

      // Tự động seed tài khoản cấu hình trong .env vào bảng dbo.gksk_users nếu chưa tồn tại
      const existingEnvUser = await repos.users.findByUsername(
        config.auth.loginUser,
      );
      let seededDefaultUser = false;
      if (!existingEnvUser) {
        await repos.users.upsertByUsername({
          username: config.auth.loginUser,
          passwordHash: config.auth.loginPasswordHash,
          fullName: 'Quản trị viên CSYT',
          isActive: true,
        });
        seededDefaultUser = true;
      }

      logger.info(
        {
          dbKind: repos.kind,
          dbHost: config.db.host,
          dbPort: config.db.port,
          dbName: config.db.name,
          appliedMigrations,
          recoveredStuckSendingCount: recoveredCount,
          seededDefaultUser,
          defaultLoginUser: config.auth.loginUser,
        },
        'Đã kết nối MSSQL và khởi tạo an toàn 5 bảng gksk_*',
      );
    } catch (err) {
      logger.error(
        {
          dbHost: config.db.host,
          dbPort: config.db.port,
          dbName: config.db.name,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
        'Không thể kết nối hoặc chạy migration trên MSSQL Server',
      );
      process.exit(1);
    }
  }

  let privateKeyPem: string | undefined;
  if (config.gksk.privateKeyPath) {
    try {
      privateKeyPem = fs.readFileSync(config.gksk.privateKeyPath, 'utf8');
    } catch (err) {
      logger.error(
        {
          errorMessage: err instanceof Error ? err.message : String(err),
        },
        'Không thể đọc file khóa riêng RSA (GKSK_PRIVATE_KEY_PATH)',
      );
      process.exit(1);
    }
  }

  const app = createApp({
    config,
    repos,
    ...(privateKeyPem !== undefined ? { privateKeyPem } : {}),
    logger,
  });

  app.listen(config.port, '127.0.0.1', () => {
    logger.info(
      {
        port: config.port,
        appEnv: config.appEnv,
        facilityId: config.gksk.facilityId,
        dbKind: repos.kind,
        shared: ping(),
      },
      'GKSKLaiXe server listening',
    );
  });
}

void start();
