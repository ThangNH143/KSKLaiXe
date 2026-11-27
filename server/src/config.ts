import path from 'node:path';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { z } from 'zod';

export type AppEnv = 'test' | 'production';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface AppConfig {
  appEnv: AppEnv;
  port: number;
  logLevel: LogLevel;
  db: {
    host: string;
    port: number;
    user: string;
    dbPassword: string;
    name: string;
    encrypt: boolean;
    trustServerCert: boolean;
  };
  gksk: {
    baseUrl: string;
    username: string;
    password: string;
    facilityId: string;
    facilityName: string;
    senderId: string;
    privateKeyPath?: string;
    httpTimeoutMs: number;
  };
  auth: {
    loginUser: string;
    loginPasswordHash: string;
    sessionSecret: string;
    allowInsecureCookie?: boolean;
  };
}

export interface PublicConfig {
  appEnv: AppEnv;
  facilityId: string;
  facilityName: string;
  baseUrlHost: string;
}

export interface ConfigIssue {
  variable: string;
  message: string;
}

export class ConfigError extends Error {
  public readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.variable}: ${issue.message}`);
    super(`Cấu hình môi trường (.env) không hợp lệ:\n${lines.join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

function emptyToUndefined(value: unknown): unknown {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
}

function requiredString(varName: string, minLength = 1) {
  return z.preprocess(
    emptyToUndefined,
    z
      .string({
        error: (issue) =>
          issue.input === undefined
            ? `Thiếu biến bắt buộc ${varName}`
            : `Biến ${varName} phải là chuỗi`,
      })
      .trim()
      .min(
        minLength,
        minLength === 1
          ? `Biến ${varName} không được để trống`
          : `Biến ${varName} phải có ít nhất ${minLength} ký tự`,
      ),
  );
}

function optionalPort(varName: string, defaultValue: number) {
  return z.preprocess(
    emptyToUndefined,
    z
      .string()
      .default(String(defaultValue))
      .refine((v) => /^\d+$/.test(v.trim()), {
        message: `Biến ${varName} phải là số nguyên dương`,
      })
      .transform((v) => Number.parseInt(v.trim(), 10))
      .refine((n) => n >= 1 && n <= 65535, {
        message: `Biến ${varName} phải nằm trong khoảng 1–65535`,
      }),
  );
}

function optionalPositiveInt(varName: string, defaultValue: number, min = 1000, max = 300000) {
  return z.preprocess(
    emptyToUndefined,
    z
      .string()
      .default(String(defaultValue))
      .refine((v) => /^\d+$/.test(v.trim()), {
        message: `Biến ${varName} phải là số nguyên dương`,
      })
      .transform((v) => Number.parseInt(v.trim(), 10))
      .refine((n) => n >= min && n <= max, {
        message: `Biến ${varName} phải nằm trong khoảng ${min}–${max}`,
      }),
  );
}

function optionalBoolean(varName: string, defaultValue: boolean) {
  return z.preprocess(
    emptyToUndefined,
    z
      .string()
      .default(defaultValue ? 'true' : 'false')
      .transform((v) => v.trim().toLowerCase())
      .refine((v) => v === 'true' || v === 'false' || v === '1' || v === '0', {
        message: `Biến ${varName} chỉ chấp nhận true/false`,
      })
      .transform((v) => v === 'true' || v === '1'),
  );
}

const envSchema = z
  .object({
    APP_ENV: z.preprocess(
      emptyToUndefined,
      z
        .enum(['test', 'production'], {
          error: 'APP_ENV chỉ chấp nhận "test" hoặc "production"',
        })
        .default('test'),
    ),
    PORT: optionalPort('PORT', 3001),
    LOG_LEVEL: z.preprocess(
      emptyToUndefined,
      z
        .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], {
          error: 'LOG_LEVEL phải là một trong: fatal, error, warn, info, debug, trace, silent',
        })
        .default('info'),
    ),

    // MSSQL
    DB_HOST: requiredString('DB_HOST'),
    DB_PORT: optionalPort('DB_PORT', 1433),
    DB_USER: requiredString('DB_USER'),
    DB_PASSWORD: requiredString('DB_PASSWORD'),
    DB_NAME: requiredString('DB_NAME'),
    DB_ENCRYPT: optionalBoolean('DB_ENCRYPT', false),
    DB_TRUST_SERVER_CERT: optionalBoolean('DB_TRUST_SERVER_CERT', true),

    // CSYT / GKSK API
    GKSK_BASE_URL: requiredString('GKSK_BASE_URL').transform((raw) => raw.replace(/\/+$/, '')),
    GKSK_USERNAME: requiredString('GKSK_USERNAME'),
    GKSK_PASSWORD: requiredString('GKSK_PASSWORD'),
    GKSK_FACILITY_ID: requiredString('GKSK_FACILITY_ID'),
    GKSK_FACILITY_NAME: requiredString('GKSK_FACILITY_NAME'),
    GKSK_SENDER_ID: z.preprocess(emptyToUndefined, z.string().trim().optional()),
    GKSK_PRIVATE_KEY_PATH: z.preprocess(emptyToUndefined, z.string().trim().optional()),
    GKSK_HTTP_TIMEOUT_MS: optionalPositiveInt('GKSK_HTTP_TIMEOUT_MS', 30000),

    // Đăng nhập nội bộ ứng dụng
    APP_LOGIN_USER: requiredString('APP_LOGIN_USER'),
    APP_LOGIN_PASSWORD_HASH: z.preprocess(
      emptyToUndefined,
      z.string().trim().optional(),
    ),
    APP_LOGIN_PASSWORD: z.preprocess(
      emptyToUndefined,
      z.string().trim().optional(),
    ),
    SESSION_SECRET: requiredString('SESSION_SECRET', 16),
    ALLOW_INSECURE_COOKIE: optionalBoolean('ALLOW_INSECURE_COOKIE', false),
  })
  .superRefine((data, ctx) => {
    if (!data.APP_LOGIN_PASSWORD_HASH && !data.APP_LOGIN_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_LOGIN_PASSWORD_HASH'],
        message:
          'Thiếu biến bắt buộc APP_LOGIN_PASSWORD_HASH (hoặc APP_LOGIN_PASSWORD)',
      });
    }

    let parsedUrl: URL | null = null;
    try {
      parsedUrl = new URL(data.GKSK_BASE_URL);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GKSK_BASE_URL'],
        message: 'GKSK_BASE_URL phải là URL hợp lệ (bắt đầu bằng http:// hoặc https://)',
      });
      return;
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GKSK_BASE_URL'],
        message: 'GKSK_BASE_URL chỉ hỗ trợ giao thức http:// hoặc https://',
      });
      return;
    }

    if (data.APP_ENV === 'production' && parsedUrl.protocol !== 'https:') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GKSK_BASE_URL'],
        message: 'Khi APP_ENV=production, GKSK_BASE_URL bắt buộc phải dùng https://',
      });
    }
  });

/**
 * Đọc và kiểm tra cấu hình từ đối tượng biến môi trường theo cơ chế fail-fast.
 * Không bao giờ in giá trị bí mật trong thông báo lỗi.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues: ConfigIssue[] = result.error.issues.map((issue) => {
      const variable = issue.path.length > 0 ? String(issue.path[0]) : 'ENV';
      return {
        variable,
        message: issue.message,
      };
    });
    throw new ConfigError(issues);
  }

  const d = result.data;
  return {
    appEnv: d.APP_ENV,
    port: d.PORT,
    logLevel: d.LOG_LEVEL,
    db: {
      host: d.DB_HOST,
      port: d.DB_PORT,
      user: d.DB_USER,
      dbPassword: d.DB_PASSWORD,
      name: d.DB_NAME,
      encrypt: d.DB_ENCRYPT,
      trustServerCert: d.DB_TRUST_SERVER_CERT,
    },
    gksk: {
      baseUrl: d.GKSK_BASE_URL,
      username: d.GKSK_USERNAME,
      password: d.GKSK_PASSWORD,
      facilityId: d.GKSK_FACILITY_ID,
      facilityName: d.GKSK_FACILITY_NAME,
      senderId: d.GKSK_SENDER_ID ?? d.GKSK_FACILITY_ID,
      ...(d.GKSK_PRIVATE_KEY_PATH !== undefined
        ? { privateKeyPath: d.GKSK_PRIVATE_KEY_PATH }
        : {}),
      httpTimeoutMs: d.GKSK_HTTP_TIMEOUT_MS,
    },
    auth: {
      loginUser: d.APP_LOGIN_USER,
      loginPasswordHash:
        d.APP_LOGIN_PASSWORD_HASH ??
        bcrypt.hashSync(d.APP_LOGIN_PASSWORD ?? '', 10),
      sessionSecret: d.SESSION_SECRET,
      allowInsecureCookie: d.ALLOW_INSECURE_COOKIE,
    },
  };
}

/**
 * Nạp file `.env` (mặc định tìm ở thư mục hiện tại và thư mục cha cho monorepo) rồi kiểm tra cấu hình.
 */
export function loadConfigFromEnvFile(envPath?: string): AppConfig {
  if (envPath) {
    dotenv.config({ path: envPath });
  } else {
    // Ưu tiên .env ở cwd; nếu đang chạy từ workspace server/, thử thêm ../.env
    dotenv.config();
    dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
  }
  return loadConfig(process.env);
}

/**
 * Trích xuất cấu hình công khai an toàn cho `/api/config` (tuyệt đối không có bí mật hay thông tin DB).
 */
export function getPublicConfig(config: AppConfig): PublicConfig {
  const url = new URL(config.gksk.baseUrl);
  return {
    appEnv: config.appEnv,
    facilityId: config.gksk.facilityId,
    facilityName: config.gksk.facilityName,
    baseUrlHost: url.host,
  };
}
