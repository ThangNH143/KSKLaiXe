import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, REDACT_PATHS } from './logger.js';

function createMemoryStream() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });
  return {
    stream,
    getRawOutput: () => chunks.join(''),
    getParsedLines: () =>
      chunks
        .join('')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('logger redact', () => {
  it('bao gồm đủ các khóa bắt buộc trong REDACT_PATHS', () => {
    for (const key of ['authorization', 'password', 'dbPassword', 'token', 'fields', 'data']) {
      expect(REDACT_PATHS).toContain(key);
      expect(REDACT_PATHS).toContain(`*.${key}`);
      expect(REDACT_PATHS).toContain(`*.*.${key}`);
    }
  });

  it('che toàn bộ mật khẩu, token, authorization, fields và data ở cấp gốc', () => {
    const mem = createMemoryStream();
    const log = createLogger({ level: 'info', destination: mem.stream });

    log.info(
      {
        msgId: '75001261123abcdef0123456789abcdef',
        authorization: 'Bearer TOP_SECRET_BEARER_TOKEN',
        password: 'CSYT_PASSWORD_SECRET',
        dbPassword: 'MSSQL_PASSWORD_SECRET',
        token: 'JWT_TOKEN_SECRET_XYZ',
        fields: { HOTEN: 'NGUYEN VAN A', SOCMND_PASSPORT: '079000012345' },
        data: 'PD94bWwgdmVyc2lvbj0iMS4wIj8+PHJvb3Q+U0VDUkVUPC9yb290Pg==',
      },
      'test top-level redact',
    );

    const raw = mem.getRawOutput();
    expect(raw).not.toContain('TOP_SECRET_BEARER_TOKEN');
    expect(raw).not.toContain('CSYT_PASSWORD_SECRET');
    expect(raw).not.toContain('MSSQL_PASSWORD_SECRET');
    expect(raw).not.toContain('JWT_TOKEN_SECRET_XYZ');
    expect(raw).not.toContain('NGUYEN VAN A');
    expect(raw).not.toContain('079000012345');
    expect(raw).not.toContain('PD94bWwg');

    const lines = mem.getParsedLines();
    expect(lines).toHaveLength(1);
    const entry = lines[0]!;
    expect(entry.msgId).toBe('75001261123abcdef0123456789abcdef');
    expect(entry.authorization).toBe('[Redacted]');
    expect(entry.password).toBe('[Redacted]');
    expect(entry.dbPassword).toBe('[Redacted]');
    expect(entry.token).toBe('[Redacted]');
    expect(entry.fields).toBe('[Redacted]');
    expect(entry.data).toBe('[Redacted]');
  });

  it('che bí mật và PII ở các object lồng nhau nhiều cấp', () => {
    const mem = createMemoryStream();
    const log = createLogger({ level: 'info', destination: mem.stream });

    log.info(
      {
        http: {
          request: {
            headers: {
              authorization: 'Bearer NESTED_TOKEN_111',
              Authorization: 'Bearer NESTED_TOKEN_222',
              'set-cookie': 'sid=SECRET_COOKIE_333',
            },
          },
          response: {
            body: {
              data: 'BASE64_PII_PAYLOAD_444',
              token: 'NESTED_JWT_555',
            },
          },
        },
        db: {
          config: {
            dbPassword: 'NESTED_DB_PASS_666',
          },
        },
        cert: {
          record: {
            fields: {
              HOTEN: 'TRAN THI B',
              MATUY: '1',
            },
          },
        },
        meta: {
          facilityId: '75001',
          httpStatus: 200,
        },
      },
      'test nested redact',
    );

    const raw = mem.getRawOutput();
    expect(raw).not.toContain('NESTED_TOKEN_111');
    expect(raw).not.toContain('NESTED_TOKEN_222');
    expect(raw).not.toContain('SECRET_COOKIE_333');
    expect(raw).not.toContain('BASE64_PII_PAYLOAD_444');
    expect(raw).not.toContain('NESTED_JWT_555');
    expect(raw).not.toContain('NESTED_DB_PASS_666');
    expect(raw).not.toContain('TRAN THI B');

    const entry = mem.getParsedLines()[0] as {
      http: {
        request: { headers: Record<string, unknown> };
        response: { body: Record<string, unknown> };
      };
      db: { config: Record<string, unknown> };
      cert: { record: Record<string, unknown> };
      meta: { facilityId: string; httpStatus: number };
    };

    expect(entry.http.request.headers.authorization).toBe('[Redacted]');
    expect(entry.http.request.headers.Authorization).toBe('[Redacted]');
    expect(entry.http.request.headers['set-cookie']).toBe('[Redacted]');
    expect(entry.http.response.body.data).toBe('[Redacted]');
    expect(entry.http.response.body.token).toBe('[Redacted]');
    expect(entry.db.config.dbPassword).toBe('[Redacted]');
    expect(entry.cert.record.fields).toBe('[Redacted]');
    expect(entry.meta).toEqual({ facilityId: '75001', httpStatus: 200 });
  });
});
