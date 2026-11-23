import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import type { AppConfig } from '../config.js';
import { createInMemoryRepositories } from './inMemoryRepo.js';
import { MssqlRepositories } from './mssqlRepo.js';
import type { DbRepositories } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Chuyển đổi cấu hình `AppConfig['db']` sang cấu hình `sql.config` của gói `mssql`.
 */
export function buildMssqlPoolConfig(dbConfig: AppConfig['db']): sql.config {
  return {
    server: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.dbPassword,
    database: dbConfig.name,
    options: {
      encrypt: dbConfig.encrypt,
      trustServerCertificate: dbConfig.trustServerCert,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
  };
}

/**
 * Mở `ConnectionPool` kết nối tới MSSQL Server.
 */
export async function createMssqlPool(
  dbConfig: AppConfig['db'],
): Promise<sql.ConnectionPool> {
  const poolConfig = buildMssqlPoolConfig(dbConfig);
  const pool = new sql.ConnectionPool(poolConfig);
  return pool.connect();
}

/**
 * Xác định thư mục chứa các file migration `.sql` (hỗ trợ cả khi chạy trực tiếp từ `src/` và sau khi build vào `dist/`).
 */
export function resolveDefaultMigrationsDir(): string {
  const directCandidate = path.resolve(__dirname, 'migrations');
  if (fs.existsSync(directCandidate)) {
    return directCandidate;
  }
  return path.resolve(__dirname, '../../src/db/migrations');
}

/**
 * Tự động chạy các file migration tạo bảng `gksk_*` nếu chưa tồn tại (`IF OBJECT_ID(...) IS NULL`).
 * Ghi nhận lịch sử các bản migration đã chạy vào bảng `dbo.gksk_schema_migrations`.
 */
export async function runMigrations(
  pool: sql.ConnectionPool,
  migrationsDir: string = resolveDefaultMigrationsDir(),
): Promise<string[]> {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const appliedVersions: string[] = [];

  for (const filename of files) {
    const version = filename.replace(/\.sql$/i, '');
    const fullPath = path.join(migrationsDir, filename);
    const sqlScript = fs.readFileSync(fullPath, 'utf8');

    // Thực thi script migration (sử dụng IF OBJECT_ID(...) IS NULL nên idempotent tuyệt đối)
    await pool.request().query(sqlScript);

    // Ghi nhận phiên bản vào bảng dbo.gksk_schema_migrations bằng truy vấn tham số hóa
    await pool
      .request()
      .input('version', sql.NVarChar(64), version)
      .query(
        `
        IF NOT EXISTS (
          SELECT 1 FROM dbo.gksk_schema_migrations WHERE version = @version
        )
        BEGIN
          INSERT INTO dbo.gksk_schema_migrations (version, applied_at)
          VALUES (@version, SYSUTCDATETIME());
        END;
        `,
      );

    appliedVersions.push(version);
  }

  return appliedVersions;
}

/**
 * Factory khởi tạo bộ `DbRepositories`:
 * - Nếu không truyền `pool` (mặc định khi chạy `npm test`): trả về `InMemoryRepositories` để tuyệt đối không đụng vào MSSQL đang vận hành.
 * - Nếu truyền `pool` (`sql.ConnectionPool`): trả về `MssqlRepositories` làm việc trên các bảng `gksk_*`.
 */
export function createRepositories(pool?: sql.ConnectionPool): DbRepositories {
  if (!pool) {
    return createInMemoryRepositories();
  }
  return new MssqlRepositories(pool);
}
