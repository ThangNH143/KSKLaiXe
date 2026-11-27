import bcrypt from 'bcryptjs';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { UsersRepository } from '../db/types.js';
import { logger as defaultLogger } from '../logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { getAuthSession } from '../middleware/requireAuth.js';

const upsertUserBodySchema = z.object({
  username: z
    .string({ error: 'Vui lòng nhập tên đăng nhập.' })
    .trim()
    .min(2, 'Tên đăng nhập phải có ít nhất 2 ký tự.')
    .max(64, 'Tên đăng nhập tối đa 64 ký tự.')
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      'Tên đăng nhập chỉ được chứa chữ cái, chữ số và các ký tự . _ -',
    ),
  password: z
    .string({ error: 'Vui lòng nhập mật khẩu.' })
    .min(6, 'Mật khẩu phải có ít nhất 6 ký tự.')
    .max(128, 'Mật khẩu tối đa 128 ký tự.'),
  fullName: z
    .string()
    .trim()
    .max(128, 'Họ và tên tối đa 128 ký tự.')
    .optional(),
  isActive: z.boolean().optional(),
});

const resetPasswordBodySchema = z.object({
  newPassword: z
    .string({ error: 'Vui lòng nhập mật khẩu mới.' })
    .min(6, 'Mật khẩu mới phải có ít nhất 6 ký tự.')
    .max(128, 'Mật khẩu mới tối đa 128 ký tự.'),
});

const updateStatusBodySchema = z.object({
  isActive: z.boolean({ error: 'Trạng thái isActive phải là kiểu boolean.' }),
});

function parsePositiveId(raw: unknown): number {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
    throw new AppError('INVALID_USER_ID', 'ID người dùng phải là số nguyên dương.', 400);
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError('INVALID_USER_ID', 'ID người dùng phải là số nguyên dương.', 400);
  }
  return parsed;
}

export interface UsersRouterDeps {
  usersRepo: UsersRepository;
  logger?: Logger;
}

/**
 * Router Quản trị tài khoản người dùng nội bộ (`dbo.gksk_users` — ARCHITECTURE.md §4 & §5):
 * - `GET /api/users`: Danh sách người dùng (tuyệt đối không trả `passwordHash`).
 * - `POST /api/users`: Thêm mới hoặc cập nhật tài khoản theo `username` (mật khẩu băm bcrypt).
 * - `PATCH /api/users/:id/password`: Đặt lại mật khẩu cho nhân viên.
 * - `PATCH /api/users/:id/status`: Khóa hoặc mở khóa tài khoản (`isActive`, chống tự khóa chính mình).
 */
export function createUsersRouter(deps: UsersRouterDeps): Router {
  const router = Router();
  const { usersRepo } = deps;
  const log = deps.logger ?? defaultLogger;

  router.get(
    '/users',
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const items = await usersRepo.list();
        res.status(200).json({ items });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/users',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = upsertUserBodySchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(
            'INVALID_USER_PAYLOAD',
            parsed.error.issues[0]?.message ??
              'Dữ liệu tạo/cập nhật tài khoản không hợp lệ.',
            400,
          );
        }

        const session = getAuthSession(req);
        const { username, password, fullName, isActive } = parsed.data;
        if (
          isActive === false &&
          session &&
          session.username.toLowerCase() === username.toLowerCase()
        ) {
          throw new AppError(
            'CANNOT_DISABLE_SELF',
            'Không thể tự khóa tài khoản đang đăng nhập của chính bạn.',
            400,
          );
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const result = await usersRepo.upsertByUsername({
          username,
          passwordHash,
          ...(fullName !== undefined ? { fullName } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        });

        log.info(
          {
            event: result.created ? 'user_created' : 'user_updated',
            targetUsername: result.row.username,
            actorUsername: session?.username ?? 'unknown',
          },
          result.created
            ? 'Đã tạo tài khoản người dùng mới'
            : 'Đã cập nhật tài khoản người dùng',
        );

        res.status(result.created ? 201 : 200).json({
          user: result.row,
          created: result.created,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/users/:id/password',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = parsePositiveId(req.params.id);
        const parsed = resetPasswordBodySchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(
            'INVALID_PASSWORD_PAYLOAD',
            parsed.error.issues[0]?.message ??
              'Mật khẩu mới phải có từ 6 đến 128 ký tự.',
            400,
          );
        }

        const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
        const updated = await usersRepo.updatePassword(id, passwordHash);
        if (!updated) {
          throw new AppError(
            'USER_NOT_FOUND',
            `Không tìm thấy tài khoản người dùng (id=${id}).`,
            404,
          );
        }

        const session = getAuthSession(req);
        log.info(
          {
            event: 'user_password_reset',
            targetUserId: id,
            targetUsername: updated.username,
            actorUsername: session?.username ?? 'unknown',
          },
          'Quản trị viên đã đặt lại mật khẩu người dùng',
        );

        res.status(200).json({
          ok: true,
          user: updated,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/users/:id/status',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = parsePositiveId(req.params.id);
        const parsed = updateStatusBodySchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(
            'INVALID_STATUS_PAYLOAD',
            parsed.error.issues[0]?.message ??
              'Trạng thái isActive không hợp lệ.',
            400,
          );
        }

        const targetUser = await usersRepo.findById(id);
        if (!targetUser) {
          throw new AppError(
            'USER_NOT_FOUND',
            `Không tìm thấy tài khoản người dùng (id=${id}).`,
            404,
          );
        }

        const session = getAuthSession(req);
        if (
          !parsed.data.isActive &&
          session &&
          session.username.toLowerCase() === targetUser.username.toLowerCase()
        ) {
          throw new AppError(
            'CANNOT_DISABLE_SELF',
            'Không thể tự khóa tài khoản đang đăng nhập của chính bạn.',
            400,
          );
        }

        const updated = await usersRepo.updateActiveStatus(
          id,
          parsed.data.isActive,
        );
        if (!updated) {
          throw new AppError(
            'USER_NOT_FOUND',
            `Không tìm thấy tài khoản người dùng (id=${id}).`,
            404,
          );
        }

        log.info(
          {
            event: 'user_status_updated',
            targetUserId: id,
            targetUsername: updated.username,
            isActive: updated.isActive,
            actorUsername: session?.username ?? 'unknown',
          },
          'Đã cập nhật trạng thái hoạt động của tài khoản người dùng',
        );

        res.status(200).json({
          ok: true,
          user: updated,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
