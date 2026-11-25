import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { sendErrorResponse } from './errorHandler.js';

export const DEFAULT_LOGIN_MAX_FAILED_ATTEMPTS = 10;
export const DEFAULT_LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 phút

export interface LoginRateLimitStatus {
  blocked: boolean;
  failedCount: number;
  remainingAttempts: number;
  retryAfterSeconds: number;
}

export interface LoginRateLimiterOptions {
  maxFailedAttempts?: number;
  windowMs?: number;
  now?: () => number;
}

export interface LoginRateLimiter {
  readonly maxFailedAttempts: number;
  readonly windowMs: number;
  check(ip: string): LoginRateLimitStatus;
  recordFailure(ip: string): LoginRateLimitStatus;
  reset(ip: string): void;
  clearAll(): void;
  middleware: RequestHandler;
}

/**
 * Chuẩn hóa địa chỉ IP client (bỏ tiền tố ::ffff: của IPv4-mapped IPv6).
 */
export function extractClientIp(req: Request): string {
  const raw = req.ip || req.socket?.remoteAddress || 'unknown';
  const trimmed = raw.trim();
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice('::ffff:'.length);
  }
  return trimmed || 'unknown';
}

/**
 * Bộ giới hạn số lần đăng nhập sai theo IP (ARCHITECTURE.md §7):
 * - Mặc định: tối đa 10 lần đăng nhập sai trong cửa sổ trượt 15 phút / IP.
 * - Khi vượt ngưỡng (lần thứ 11 trở đi), chặn trước khi kiểm mật khẩu và trả HTTP 429 kèm Retry-After.
 * - Hỗ trợ truyền đồng hồ giả `now` để kiểm thử xác định không cần sleep.
 */
export function createLoginRateLimiter(
  options: LoginRateLimiterOptions = {},
): LoginRateLimiter {
  const maxFailedAttempts =
    options.maxFailedAttempts ?? DEFAULT_LOGIN_MAX_FAILED_ATTEMPTS;
  const windowMs = options.windowMs ?? DEFAULT_LOGIN_WINDOW_MS;
  const now = options.now ?? (() => Date.now());

  const buckets = new Map<string, number[]>();

  function pruneBucket(ip: string, currentMs: number): number[] {
    const existing = buckets.get(ip);
    if (!existing || existing.length === 0) {
      return [];
    }
    const cutoff = currentMs - windowMs;
    const valid = existing.filter((ts) => ts > cutoff);
    if (valid.length === 0) {
      buckets.delete(ip);
    } else if (valid.length !== existing.length) {
      buckets.set(ip, valid);
    }
    return valid;
  }

  function pruneAllIfLarge(currentMs: number): void {
    if (buckets.size <= 1000) {
      return;
    }
    const cutoff = currentMs - windowMs;
    for (const [ip, timestamps] of buckets.entries()) {
      const valid = timestamps.filter((ts) => ts > cutoff);
      if (valid.length === 0) {
        buckets.delete(ip);
      } else if (valid.length !== timestamps.length) {
        buckets.set(ip, valid);
      }
    }
  }

  function buildStatus(timestamps: number[], currentMs: number): LoginRateLimitStatus {
    const failedCount = timestamps.length;
    const blocked = failedCount >= maxFailedAttempts;
    const remainingAttempts = Math.max(0, maxFailedAttempts - failedCount);
    let retryAfterSeconds = 0;
    if (blocked && timestamps[0] !== undefined) {
      const unblockAt = timestamps[0] + windowMs;
      retryAfterSeconds = Math.max(1, Math.ceil((unblockAt - currentMs) / 1000));
    }
    return {
      blocked,
      failedCount,
      remainingAttempts,
      retryAfterSeconds,
    };
  }

  function check(ip: string): LoginRateLimitStatus {
    const currentMs = now();
    const valid = pruneBucket(ip, currentMs);
    return buildStatus(valid, currentMs);
  }

  function recordFailure(ip: string): LoginRateLimitStatus {
    const currentMs = now();
    pruneAllIfLarge(currentMs);
    const valid = pruneBucket(ip, currentMs);
    const updated = [...valid, currentMs];
    buckets.set(ip, updated);
    return buildStatus(updated, currentMs);
  }

  function reset(ip: string): void {
    buckets.delete(ip);
  }

  function clearAll(): void {
    buckets.clear();
  }

  const middleware: RequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction,
  ): void => {
    const ip = extractClientIp(req);
    const status = check(ip);
    if (status.blocked) {
      res.setHeader('Retry-After', String(status.retryAfterSeconds));
      sendErrorResponse(
        res,
        429,
        'TOO_MANY_LOGIN_ATTEMPTS',
        `Bạn đã đăng nhập sai quá ${maxFailedAttempts} lần. Vui lòng thử lại sau ${status.retryAfterSeconds} giây.`,
      );
      return;
    }
    next();
  };

  return {
    maxFailedAttempts,
    windowMs,
    check,
    recordFailure,
    reset,
    clearAll,
    middleware,
  };
}
