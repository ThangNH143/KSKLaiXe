import pino, { type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from './config.js';

const SENSITIVE_KEYS = [
  'authorization',
  'Authorization',
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'password_hash',
  'dbPassword',
  'token',
  'fields',
  'fields_json',
  'data',
  'cookie',
  'Cookie',
  'set-cookie',
  'sessionSecret',
  'loginPasswordHash',
  'privateKey',
  'privateKeyPem',
  'DB_PASSWORD',
  'GKSK_PASSWORD',
  'SESSION_SECRET',
  'APP_LOGIN_PASSWORD',
  'APP_LOGIN_PASSWORD_HASH',
] as const;

const WILDCARD_PREFIXES = ['', '*.', '*.*.', '*.*.*.', '*.*.*.*.'] as const;

/**
 * Danh sách đường dẫn redact che toàn bộ bí mật và PII ở mọi cấp độ lồng nhau.
 */
export const REDACT_PATHS: string[] = WILDCARD_PREFIXES.flatMap((prefix) =>
  SENSITIVE_KEYS.map((key) => {
    const needsBrackets = key.includes('-');
    const formattedKey = needsBrackets ? `["${key}"]` : key;
    if (!prefix) {
      return formattedKey;
    }
    if (needsBrackets) {
      return `${prefix.slice(0, -1)}${formattedKey}`;
    }
    return `${prefix}${formattedKey}`;
  }),
);

export interface CreateLoggerOptions {
  level?: LogLevel;
  destination?: DestinationStream;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const pinoOptions: pino.LoggerOptions = {
    level: options.level ?? 'info',
    redact: {
      paths: REDACT_PATHS,
      censor: '[Redacted]',
    },
    base: {
      service: 'gksk-server',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (options.destination) {
    return pino(pinoOptions, options.destination);
  }
  return pino(pinoOptions);
}

export const logger: Logger = createLogger({
  level: (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info',
});
