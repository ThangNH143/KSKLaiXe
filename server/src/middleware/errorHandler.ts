import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';
import { logger as defaultLogger } from '../logger.js';

/**
 * Lỗi ứng dụng chuẩn hóa trả về cho client theo ARCHITECTURE.md §4:
 * `{ "error": { "code": "...", "message": "..." } }`
 * Tuyệt đối không bao giờ chứa dữ liệu cá nhân (PII), mật khẩu hay token.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function isStructuredHttpError(
  err: unknown,
): err is Error & { code: string; httpStatus: number } {
  if (!(err instanceof Error)) {
    return false;
  }
  const candidate = err as unknown as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    typeof candidate.httpStatus === 'number' &&
    Number.isInteger(candidate.httpStatus) &&
    candidate.httpStatus >= 400 &&
    candidate.httpStatus <= 599
  );
}

export function sendErrorResponse(
  res: Response,
  httpStatus: number,
  code: string,
  message: string,
): void {
  res.status(httpStatus).json({
    error: {
      code,
      message,
    },
  });
}

export function createErrorHandler(log: Logger = defaultLogger) {
  return function errorHandler(
    err: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (isStructuredHttpError(err)) {
      sendErrorResponse(res, err.httpStatus, err.code, err.message);
      return;
    }

    if (
      err instanceof SyntaxError &&
      'status' in err &&
      (err as { status?: unknown }).status === 400
    ) {
      sendErrorResponse(
        res,
        400,
        'INVALID_JSON_BODY',
        'Nội dung JSON gửi lên không đúng cú pháp.',
      );
      return;
    }

    log.error(
      {
        method: req.method,
        path: req.path,
        errName: err instanceof Error ? err.name : 'UnknownError',
      },
      'Lỗi nội bộ không mong đợi tại API route',
    );

    sendErrorResponse(
      res,
      500,
      'INTERNAL_SERVER_ERROR',
      'Đã xảy ra lỗi hệ thống nội bộ.',
    );
  };
}
