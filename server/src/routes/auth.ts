import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AppEnv, PublicConfig } from '../config.js';
import { logger as defaultLogger } from '../logger.js';
import { sendErrorResponse } from '../middleware/errorHandler.js';
import {
  extractClientIp,
  type LoginRateLimiter,
} from '../middleware/rateLimit.js';
import {
  SESSION_COOKIE_NAME,
  type SessionStore,
} from '../middleware/requireAuth.js';

const loginBodySchema = z.object({
  username: z
    .string({ error: 'Vui lòng nhập tên đăng nhập.' })
    .trim()
    .min(1, 'Tên đăng nhập không được để trống.'),
  password: z
    .string({ error: 'Vui lòng nhập mật khẩu.' })
    .min(1, 'Mật khẩu không được để trống.'),
});

function timingSafeEqualString(a: string, b: string): boolean {
  const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

async function safeBcryptCompare(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

export interface AuthRouterDeps {
  appEnv: AppEnv;
  loginUser: string;
  loginPasswordHash: string;
  sessionStore: SessionStore;
  rateLimiter: LoginRateLimiter;
  csrfMiddleware: RequestHandler;
  logger?: Logger;
}

/**
 * Router xác thực ứng dụng nội bộ (ARCHITECTURE.md §4 & §7, IMPLEMENTATION-PLAN.md S12):
 * - `POST /api/auth/login`: kiểm CSRF + rate-limit (10 lần sai/15 phút/IP → 429) + so mật khẩu bằng bcrypt → cấp cookie phiên HttpOnly, SameSite=Lax, Secure (production/HTTPS), TTL 8 giờ.
 * - `POST /api/auth/logout`: kiểm CSRF + thu hồi phiên + xóa cookie.
 * - `GET /api/auth/me`: kiểm tra phiên hiện tại (200 nếu đã đăng nhập, 401 nếu chưa).
 */
export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();
  const {
    appEnv,
    loginUser,
    loginPasswordHash,
    sessionStore,
    rateLimiter,
    csrfMiddleware,
  } = deps;
  const log = deps.logger ?? defaultLogger;

  router.post(
    '/auth/login',
    csrfMiddleware,
    rateLimiter.middleware,
    async (req: Request, res: Response) => {
      const parsed = loginBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendErrorResponse(
          res,
          400,
          'INVALID_LOGIN_PAYLOAD',
          parsed.error.issues[0]?.message ??
            'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.',
        );
        return;
      }

      const ip = extractClientIp(req);
      const { username, password } = parsed.data;

      // Luôn chạy cả so username hằng thời gian và bcrypt.compare để tránh timing oracle
      const usernameMatches = timingSafeEqualString(username, loginUser);
      const passwordMatches = await safeBcryptCompare(password, loginPasswordHash);

      if (!usernameMatches || !passwordMatches) {
        const failStatus = rateLimiter.recordFailure(ip);
        log.warn(
          {
            event: 'auth_login_failed',
            ip,
            failedCount: failStatus.failedCount,
            blocked: failStatus.blocked,
          },
          'Đăng nhập ứng dụng thất bại',
        );
        sendErrorResponse(
          res,
          401,
          'INVALID_CREDENTIALS',
          'Tên đăng nhập hoặc mật khẩu không đúng.',
        );
        return;
      }

      // Đăng nhập thành công: xóa bộ đếm sai của IP, thu hồi phiên cũ (nếu có) và cấp phiên mới
      rateLimiter.reset(ip);
      const existingToken = sessionStore.extractSignedTokenFromRequest(req);
      if (existingToken) {
        sessionStore.revokeSignedToken(existingToken);
      }

      const { session, signedToken } = sessionStore.createSession(loginUser);
      res.cookie(
        SESSION_COOKIE_NAME,
        signedToken,
        sessionStore.buildCookieOptions(req, appEnv),
      );

      log.info(
        {
          event: 'auth_login_success',
          ip,
        },
        'Đăng nhập ứng dụng thành công',
      );

      res.status(200).json({
        authenticated: true,
        user: {
          username: session.username,
        },
        expiresAt: new Date(session.expiresAt).toISOString(),
      });
    },
  );

  router.post('/auth/logout', csrfMiddleware, (req: Request, res: Response) => {
    const existingToken = sessionStore.extractSignedTokenFromRequest(req);
    if (existingToken) {
      sessionStore.revokeSignedToken(existingToken);
    }

    res.clearCookie(
      SESSION_COOKIE_NAME,
      sessionStore.buildClearCookieOptions(req, appEnv),
    );

    log.info(
      {
        event: 'auth_logout',
        ip: extractClientIp(req),
      },
      'Đăng xuất ứng dụng',
    );

    res.status(200).json({ ok: true });
  });

  router.get('/auth/me', (req: Request, res: Response) => {
    const session = sessionStore.getSessionFromRequest(req);
    if (!session) {
      sendErrorResponse(
        res,
        401,
        'UNAUTHORIZED',
        'Chưa đăng nhập hoặc phiên đã hết hạn.',
      );
      return;
    }

    res.status(200).json({
      authenticated: true,
      user: {
        username: session.username,
      },
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  });

  return router;
}

/**
 * Router trả cấu hình công khai an toàn (`GET /api/config`):
 * Chỉ trả đúng 4 trường `{ appEnv, facilityId, facilityName, baseUrlHost }`,
 * tuyệt đối không bao giờ chứa mật khẩu, token, đường dẫn khóa hay thông tin DB.
 */
export function createConfigRouter(publicConfig: PublicConfig): Router {
  const router = Router();

  const safePayload: PublicConfig = {
    appEnv: publicConfig.appEnv,
    facilityId: publicConfig.facilityId,
    facilityName: publicConfig.facilityName,
    baseUrlHost: publicConfig.baseUrlHost,
  };

  router.get('/config', (_req: Request, res: Response) => {
    res.status(200).json({
      appEnv: safePayload.appEnv,
      facilityId: safePayload.facilityId,
      facilityName: safePayload.facilityName,
      baseUrlHost: safePayload.baseUrlHost,
    });
  });

  return router;
}
