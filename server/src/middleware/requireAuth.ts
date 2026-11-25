import crypto from 'node:crypto';
import type {
  CookieOptions,
  Express,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express';
import type { AppEnv } from '../config.js';
import { sendErrorResponse } from './errorHandler.js';

export const SESSION_COOKIE_NAME = 'gksk_session';
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 giờ theo ARCHITECTURE.md §7
export const CSRF_HEADER_NAME = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'gksk';

const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

export interface SessionRecord {
  sessionId: string;
  username: string;
  createdAt: number;
  expiresAt: number;
}

export interface SessionStoreOptions {
  sessionSecret: string;
  ttlMs?: number;
  now?: () => number;
}

export interface SessionStore {
  readonly ttlMs: number;
  createSession(username: string): { session: SessionRecord; signedToken: string };
  verifySignedToken(signedToken: string | undefined): SessionRecord | null;
  revokeSignedToken(signedToken: string | undefined): void;
  extractSignedTokenFromRequest(req: Request): string | undefined;
  getSessionFromRequest(req: Request): SessionRecord | null;
  buildCookieOptions(req: Request, appEnv: AppEnv): CookieOptions;
  buildClearCookieOptions(req: Request, appEnv: AppEnv): CookieOptions;
  clearAll(): void;
}

const requestSessions = new WeakMap<Request, SessionRecord>();

/**
 * Lấy thông tin phiên đăng nhập đã xác thực gắn với request (nếu có).
 */
export function getAuthSession(req: Request): SessionRecord | undefined {
  return requestSessions.get(req);
}

/**
 * Phân tách header `Cookie` thành bản đồ khóa → giá trị an toàn.
 */
export function parseCookieHeader(
  cookieHeader: string | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return result;
  }

  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const name = part.slice(0, eqIndex).trim();
    if (!name) {
      continue;
    }
    const rawValue = part.slice(eqIndex + 1).trim();
    try {
      result[name] = decodeURIComponent(rawValue);
    } catch {
      result[name] = rawValue;
    }
  }
  return result;
}

function isHttpsRequest(req: Request): boolean {
  if (req.secure) {
    return true;
  }
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string') {
    const first = forwardedProto.split(',')[0]?.trim().toLowerCase();
    return first === 'https';
  }
  return false;
}

/**
 * Tạo kho phiên trong bộ nhớ kết hợp chữ ký HMAC-SHA256 chống giả mạo cookie:
 * - Cookie chỉ mang `<sessionId>.<hmac>` (không chứa thông tin nhạy cảm).
 * - Hết hạn sau 8 giờ (`SESSION_TTL_MS`).
 * - Hỗ trợ thu hồi tức thì khi người dùng gọi `POST /api/auth/logout`.
 */
export function createSessionStore(options: SessionStoreOptions): SessionStore {
  const { sessionSecret } = options;
  const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const sessions = new Map<string, SessionRecord>();

  function signSessionId(sessionId: string): string {
    return crypto
      .createHmac('sha256', sessionSecret)
      .update(sessionId)
      .digest('base64url');
  }

  function verifySignature(sessionId: string, providedSig: string): boolean {
    const expectedSig = signSessionId(sessionId);
    const expectedBuf = Buffer.from(expectedSig, 'utf8');
    const providedBuf = Buffer.from(providedSig, 'utf8');
    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  }

  function pruneExpired(currentMs: number): void {
    if (sessions.size <= 500) {
      return;
    }
    for (const [id, rec] of sessions.entries()) {
      if (rec.expiresAt <= currentMs) {
        sessions.delete(id);
      }
    }
  }

  function createSession(username: string): {
    session: SessionRecord;
    signedToken: string;
  } {
    const currentMs = now();
    pruneExpired(currentMs);
    const sessionId = crypto.randomBytes(32).toString('base64url');
    const session: SessionRecord = {
      sessionId,
      username,
      createdAt: currentMs,
      expiresAt: currentMs + ttlMs,
    };
    sessions.set(sessionId, session);
    const signedToken = `${sessionId}.${signSessionId(sessionId)}`;
    return { session, signedToken };
  }

  function parseAndVerifyToken(signedToken: string | undefined): string | null {
    if (!signedToken || typeof signedToken !== 'string') {
      return null;
    }
    const dotIndex = signedToken.indexOf('.');
    if (dotIndex <= 0 || dotIndex === signedToken.length - 1) {
      return null;
    }
    const sessionId = signedToken.slice(0, dotIndex);
    const providedSig = signedToken.slice(dotIndex + 1);
    if (!verifySignature(sessionId, providedSig)) {
      return null;
    }
    return sessionId;
  }

  function verifySignedToken(signedToken: string | undefined): SessionRecord | null {
    const sessionId = parseAndVerifyToken(signedToken);
    if (!sessionId) {
      return null;
    }
    const rec = sessions.get(sessionId);
    if (!rec) {
      return null;
    }
    if (rec.expiresAt <= now()) {
      sessions.delete(sessionId);
      return null;
    }
    return rec;
  }

  function revokeSignedToken(signedToken: string | undefined): void {
    const sessionId = parseAndVerifyToken(signedToken);
    if (sessionId) {
      sessions.delete(sessionId);
    }
  }

  function extractSignedTokenFromRequest(req: Request): string | undefined {
    const cookies = parseCookieHeader(req.headers.cookie);
    return cookies[SESSION_COOKIE_NAME];
  }

  function getSessionFromRequest(req: Request): SessionRecord | null {
    const token = extractSignedTokenFromRequest(req);
    return verifySignedToken(token);
  }

  function buildClearCookieOptions(req: Request, appEnv: AppEnv): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: appEnv === 'production' || isHttpsRequest(req),
      path: '/',
    };
  }

  function buildCookieOptions(req: Request, appEnv: AppEnv): CookieOptions {
    return {
      ...buildClearCookieOptions(req, appEnv),
      maxAge: ttlMs,
    };
  }

  function clearAll(): void {
    sessions.clear();
  }

  return {
    ttlMs,
    createSession,
    verifySignedToken,
    revokeSignedToken,
    extractSignedTokenFromRequest,
    getSessionFromRequest,
    buildCookieOptions,
    buildClearCookieOptions,
    clearAll,
  };
}

/**
 * Middleware yêu cầu phiên đăng nhập hợp lệ (cookie `gksk_session` HttpOnly).
 * Trả HTTP 401 nếu chưa đăng nhập hoặc phiên đã hết hạn/thu hồi.
 */
export function createRequireAuthMiddleware(
  sessionStore: SessionStore,
): RequestHandler {
  return function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const session = sessionStore.getSessionFromRequest(req);
    if (!session) {
      sendErrorResponse(
        res,
        401,
        'UNAUTHORIZED',
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
      );
      return;
    }
    requestSessions.set(req, session);
    next();
  };
}

function isAllowedWriteContentType(rawContentType: string): boolean {
  const mime = rawContentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return mime === 'application/json' || mime === 'multipart/form-data';
}

/**
 * Middleware chống CSRF theo ARCHITECTURE.md §7:
 * - Với mọi method ghi (`POST`, `PUT`, `DELETE`, `PATCH`):
 *   1. Bắt buộc có header tùy biến `X-Requested-With: gksk` (thiếu/sai → HTTP 403).
 *   2. Nếu request có gửi `Content-Type`, chỉ chấp nhận `application/json` hoặc `multipart/form-data`
 *      (chặn form submit `application/x-www-form-urlencoded` / `text/plain` → HTTP 403).
 */
export function createCsrfMiddleware(): RequestHandler {
  return function requireCsrfHeader(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (!WRITE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const rawHeader = req.headers[CSRF_HEADER_NAME];
    const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (typeof headerValue !== 'string' || headerValue.trim() !== CSRF_HEADER_VALUE) {
      sendErrorResponse(
        res,
        403,
        'CSRF_HEADER_REQUIRED',
        'Thiếu hoặc sai header bảo mật X-Requested-With.',
      );
      return;
    }

    const rawContentType = req.headers['content-type'];
    const contentType = Array.isArray(rawContentType)
      ? rawContentType[0]
      : rawContentType;
    if (
      typeof contentType === 'string' &&
      contentType.trim().length > 0 &&
      !isAllowedWriteContentType(contentType)
    ) {
      sendErrorResponse(
        res,
        403,
        'CSRF_INVALID_CONTENT_TYPE',
        'API chỉ chấp nhận Content-Type application/json hoặc multipart/form-data cho thao tác ghi.',
      );
      return;
    }

    next();
  };
}

export interface DiscoveredRoute {
  method: string;
  path: string;
}

interface ExpressLayerLike {
  name?: string;
  regexp?: RegExp & { fast_slash?: boolean };
  route?: {
    path?: string | string[];
    methods?: Record<string, boolean>;
  };
  handle?: {
    stack?: ExpressLayerLike[];
  };
}

function extractMountPrefix(regexp: (RegExp & { fast_slash?: boolean }) | undefined): string {
  if (!regexp || regexp.fast_slash) {
    return '';
  }
  const src = regexp.source;
  // Express 4 mount regex có dạng: ^\/api\/?(?=\/|$)
  const cleaned = src
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\(\?=\\\/\|\$\)$/, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/');
  if (!cleaned || cleaned === '/') {
    return '';
  }
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
}

function joinPaths(prefix: string, routePath: string): string {
  const normalizedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const normalizedRoute = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const combined = `${normalizedPrefix}${normalizedRoute}`;
  return combined.replace(/\/{2,}/g, '/');
}

function walkStack(
  stack: ExpressLayerLike[] | undefined,
  prefix: string,
  out: DiscoveredRoute[],
): void {
  if (!Array.isArray(stack)) {
    return;
  }

  for (const layer of stack) {
    if (layer.route && layer.route.path !== undefined) {
      const paths = Array.isArray(layer.route.path)
        ? layer.route.path
        : [layer.route.path];
      const methods = layer.route.methods ?? {};
      for (const methodName of Object.keys(methods)) {
        if (!methods[methodName]) {
          continue;
        }
        const upperMethod = methodName.toUpperCase();
        if (upperMethod === '_ALL') {
          continue;
        }
        for (const p of paths) {
          out.push({
            method: upperMethod,
            path: joinPaths(prefix, p),
          });
        }
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      const mountPrefix = extractMountPrefix(layer.regexp);
      const nextPrefix = mountPrefix ? joinPaths(prefix, mountPrefix) : prefix;
      walkStack(layer.handle.stack, nextPrefix, out);
    }
  }
}

/**
 * Quét toàn bộ router của ứng dụng Express để liệt kê mọi endpoint `(method, path)`
 * đang được đăng ký — dùng cho test kiểm toán bảo mật tự động (S12, S17).
 */
export function listExpressRoutes(app: Express): DiscoveredRoute[] {
  const router = (app as unknown as { _router?: { stack?: ExpressLayerLike[] } })
    ._router;
  const discovered: DiscoveredRoute[] = [];
  walkStack(router?.stack, '', discovered);
  return discovered;
}
