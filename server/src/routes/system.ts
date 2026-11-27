import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import { GKSK_TABLE_NAMES, type DbRepositories } from '../db/types.js';
import type { GkskClient } from '../gksk/client.js';
import { newMsgId } from '../gksk/envelope.js';
import { logger as defaultLogger } from '../logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { getAuthSession } from '../middleware/requireAuth.js';
import type { SendService } from '../services/sendService.js';

export interface GkskConfigSummary {
  baseUrl: string;
  baseUrlHost: string;
  username: string;
  facilityId: string;
  facilityName: string;
  senderId: string;
  hasPassword: boolean;
  passwordLength: number;
}

export interface SytDiagnosticStep {
  ok: boolean;
  endpoint: string;
  httpStatus: number | null;
  resCode: string | null;
  resMsg: string | null;
  message: string;
}

export interface SystemConnectionCheckResponse {
  ok: boolean;
  checkedAt: string;
  database: {
    ok: boolean;
    kind: 'in-memory' | 'mssql';
    tables: readonly string[];
    userCount: number;
    batchCount: number;
    certificateCount: number;
    message: string;
  };
  sytGateway: {
    ok: boolean;
    facilityId: string;
    facilityName: string;
    username: string;
    senderId: string;
    baseUrlHost: string;
    httpStatus: number | null;
    resCode: string | null;
    resMsg: string | null;
    durationMinutes: number | null;
    expiresAt: string | null;
    message: string;
    loginStep: SytDiagnosticStep;
    apiPermissionStep: SytDiagnosticStep | null;
  };
}

export interface SystemRouterDeps {
  repos: DbRepositories;
  gkskClient: GkskClient;
  sendService?: SendService;
  facilityId: string;
  facilityName: string;
  baseUrlHost: string;
  envFilePath?: string;
  logger?: Logger;
}

const updateGkskConfigBodySchema = z.object({
  action: z.enum(['update', 'reload_env']).optional().default('update'),
  baseUrl: z.string().trim().optional(),
  username: z.string().trim().max(64, 'Mã tài khoản CSYT tối đa 64 ký tự.').optional(),
  password: z.string().max(256, 'Mật khẩu CSYT tối đa 256 ký tự.').optional(),
  senderId: z
    .string()
    .trim()
    .max(64, 'Mã người gửi (sender_id) tối đa 64 ký tự.')
    .refine(
      (v) => v.length === 0 || /^[A-Za-z0-9._-]+$/.test(v),
      'Mã người gửi (sender_id) chỉ được chứa chữ cái, chữ số và các ký tự . _ -',
    )
    .optional(),
  persistToEnv: z.boolean().optional().default(true),
});

function resolveHostSafely(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return rawUrl;
  }
}

function resolveExistingEnvFile(customPath?: string): string | null {
  const candidates = [
    ...(customPath ? [path.resolve(customPath)] : []),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Định dạng giá trị ghi vào file `.env`:
 * Bọc trong dấu ngoặc kép `"..."` nếu có ký tự `#`, `$`, khoảng trắng hoặc dấu nháy
 * để `dotenv` không bao giờ cắt cụt mật khẩu chứa ký tự `#` (coi là comment).
 */
export function formatSafeDotenvValue(value: string): string {
  if (/[\s#$"''\\]/.test(value)) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}

/**
 * Cập nhật một số khóa cấu hình trong nội dung file `.env` mà vẫn giữ nguyên cấu trúc & chú thích.
 */
export function patchDotenvContent(
  originalContent: string,
  updates: Record<string, string>,
): string {
  const lines = originalContent.split(/\r?\n/);
  const updatedKeys = new Set<string>();

  const nextLines = lines.map((line) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match?.[1]) {
      return line;
    }
    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      updatedKeys.add(key);
      return `${key}=${formatSafeDotenvValue(updates[key] ?? '')}`;
    }
    return line;
  });

  for (const [key, val] of Object.entries(updates)) {
    if (!updatedKeys.has(key)) {
      nextLines.push(`${key}=${formatSafeDotenvValue(val)}`);
    }
  }

  return nextLines.join('\n');
}

/**
 * Router kiểm tra kết nối hệ thống & cấu hình nóng tài khoản CSYT (`ARCHITECTURE.md §4`):
 * - `GET /api/system/gksk-config`: Xem tóm tắt cấu hình kết nối CSYT hiện tại (không bao giờ trả mật khẩu).
 * - `PUT /api/system/gksk-config`: Cập nhật nóng `GKSK_USERNAME`, `GKSK_PASSWORD`, `GKSK_SENDER_ID`, `GKSK_BASE_URL`
 *   ngay trên bộ nhớ server (xóa cache token cũ), đồng bộ vào file `.env` (bọc ngoặc kép an toàn cho `#`), hoặc đọc lại `.env`.
 * - `POST /api/system/check-connection`: Chẩn đoán 2 bước:
 *   + Bước 1: `POST /api/auth/login` (`forceRefresh: true`) lấy Bearer Token và hiển thị nguyên văn `res_code` / `res_msg`.
 *   + Bước 2: `GET /api/platform/gksk-lai-xe/status?msg_id=<probe>` kiểm tra quyền gọi API GKSK Lái xe & `sender_id`.
 */
export function createSystemRouter(deps: SystemRouterDeps): Router {
  const router = Router();
  const { repos, gkskClient, sendService, facilityId, facilityName } = deps;
  const log = deps.logger ?? defaultLogger;

  function buildConfigSummary(): GkskConfigSummary {
    const cred = gkskClient.getCredentialsSummary();
    const senderCfg = sendService?.getSenderConfig() ?? {
      facilityId,
      senderId: facilityId,
    };
    return {
      baseUrl: cred.baseUrl,
      baseUrlHost: resolveHostSafely(cred.baseUrl) || deps.baseUrlHost,
      username: cred.username,
      facilityId: senderCfg.facilityId,
      facilityName,
      senderId: senderCfg.senderId,
      hasPassword: cred.hasPassword,
      passwordLength: cred.passwordLength,
    };
  }

  router.get('/system/gksk-config', (_req: Request, res: Response) => {
    res.status(200).json({
      config: buildConfigSummary(),
    });
  });

  router.put(
    '/system/gksk-config',
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = updateGkskConfigBodySchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(
            'INVALID_GKSK_CONFIG_PAYLOAD',
            parsed.error.issues[0]?.message ??
              'Dữ liệu cập nhật cấu hình CSYT không hợp lệ.',
            400,
          );
        }

        const session = getAuthSession(req);
        const data = parsed.data;

        if (data.action === 'reload_env') {
          const envFile = resolveExistingEnvFile(deps.envFilePath);
          if (!envFile) {
            throw new AppError(
              'ENV_FILE_NOT_FOUND',
              'Không tìm thấy file .env trên máy chủ để đọc lại.',
              404,
            );
          }

          const rawEnv = fs.readFileSync(envFile, 'utf8');
          const parsedEnv = dotenv.parse(rawEnv);

          const nextBaseUrl = parsedEnv.GKSK_BASE_URL?.trim();
          const nextUsername = parsedEnv.GKSK_USERNAME?.trim();
          const nextPassword = parsedEnv.GKSK_PASSWORD;
          const nextFacilityId =
            parsedEnv.GKSK_FACILITY_ID?.trim() || facilityId;
          const nextSenderId =
            parsedEnv.GKSK_SENDER_ID?.trim() || nextFacilityId;

          gkskClient.updateCredentials({
            ...(nextBaseUrl ? { baseUrl: nextBaseUrl } : {}),
            ...(nextUsername ? { username: nextUsername } : {}),
            ...(typeof nextPassword === 'string' && nextPassword.length > 0
              ? { password: nextPassword }
              : {}),
          });
          sendService?.updateSenderConfig({
            facilityId: nextFacilityId,
            senderId: nextSenderId,
          });

          const summary = buildConfigSummary();
          log.info(
            {
              event: 'gksk_config_reloaded_from_env',
              actorUsername: session?.username ?? 'unknown',
              gkskUsername: summary.username,
              senderId: summary.senderId,
              baseUrlHost: summary.baseUrlHost,
            },
            'Đã đọc lại cấu hình tài khoản CSYT từ file .env trên máy chủ',
          );

          res.status(200).json({
            ok: true,
            reloadedFromEnv: true,
            envPersisted: false,
            config: summary,
            message: `Đã đọc lại file .env thành công (Tài khoản CSYT: ${summary.username}, sender_id: ${summary.senderId}, độ dài mật khẩu: ${summary.passwordLength} ký tự) và xóa cache token cũ.`,
          });
          return;
        }

        // action === 'update'
        if (data.baseUrl !== undefined && data.baseUrl.length > 0) {
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(data.baseUrl);
          } catch {
            throw new AppError(
              'INVALID_GKSK_BASE_URL',
              'GKSK_BASE_URL phải là URL hợp lệ bắt đầu bằng http:// hoặc https://',
              400,
            );
          }
          if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new AppError(
              'INVALID_GKSK_BASE_URL',
              'GKSK_BASE_URL chỉ hỗ trợ http:// hoặc https://',
              400,
            );
          }
        }

        if (data.username !== undefined && data.username.length === 0) {
          throw new AppError(
            'INVALID_GKSK_USERNAME',
            'Tài khoản CSYT (GKSK_USERNAME) không được để trống.',
            400,
          );
        }

        gkskClient.updateCredentials({
          ...(data.baseUrl && data.baseUrl.length > 0
            ? { baseUrl: data.baseUrl }
            : {}),
          ...(data.username && data.username.length > 0
            ? { username: data.username }
            : {}),
          ...(typeof data.password === 'string' && data.password.length > 0
            ? { password: data.password }
            : {}),
        });

        if (data.senderId !== undefined) {
          sendService?.updateSenderConfig({
            senderId: data.senderId,
          });
        }

        const summary = buildConfigSummary();
        let envPersisted = false;

        if (data.persistToEnv) {
          const envFile = resolveExistingEnvFile(deps.envFilePath);
          if (envFile) {
            try {
              const currentEnvContent = fs.readFileSync(envFile, 'utf8');
              const envUpdates: Record<string, string> = {
                GKSK_BASE_URL: summary.baseUrl,
                GKSK_USERNAME: summary.username,
                GKSK_SENDER_ID:
                  summary.senderId === summary.facilityId ? '' : summary.senderId,
              };
              if (typeof data.password === 'string' && data.password.length > 0) {
                envUpdates.GKSK_PASSWORD = data.password;
              }
              const patchedContent = patchDotenvContent(
                currentEnvContent,
                envUpdates,
              );
              fs.writeFileSync(envFile, patchedContent, 'utf8');
              envPersisted = true;
            } catch {
              envPersisted = false;
            }
          }
        }

        log.info(
          {
            event: 'gksk_config_updated_runtime',
            actorUsername: session?.username ?? 'unknown',
            gkskUsername: summary.username,
            senderId: summary.senderId,
            baseUrlHost: summary.baseUrlHost,
            passwordChanged:
              typeof data.password === 'string' && data.password.length > 0,
            envPersisted,
          },
          'Đã cập nhật nóng cấu hình kết nối CSYT trên máy chủ',
        );

        res.status(200).json({
          ok: true,
          reloadedFromEnv: false,
          envPersisted,
          config: summary,
          message: `Đã cập nhật nóng cấu hình CSYT (Tài khoản: ${summary.username}, sender_id: ${summary.senderId}${
            typeof data.password === 'string' && data.password.length > 0
              ? `, mật khẩu mới: ${summary.passwordLength} ký tự`
              : ''
          })${envPersisted ? ' và lưu an toàn vào file .env' : ''}.`,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/system/check-connection',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const checkedAt = new Date().toISOString();
        const summary = buildConfigSummary();

        // 1. Kiểm tra kết nối Database (5 bảng gksk_*)
        let dbInfo: SystemConnectionCheckResponse['database'];
        try {
          const [users, batches, counts] = await Promise.all([
            repos.users.list(),
            repos.batches.list(),
            repos.certificates.countByStatus(),
          ]);

          dbInfo = {
            ok: true,
            kind: repos.kind,
            tables: GKSK_TABLE_NAMES,
            userCount: users.length,
            batchCount: batches.length,
            certificateCount: counts.all,
            message:
              repos.kind === 'mssql'
                ? `Kết nối MSSQL thành công (${GKSK_TABLE_NAMES.length} bảng gksk_* sẵn sàng).`
                : `Kho dữ liệu bộ nhớ (InMemory) đang hoạt động (${GKSK_TABLE_NAMES.length} bảng gksk_*).`,
          };
        } catch (dbErr) {
          const errMsg =
            dbErr instanceof Error ? dbErr.message : 'Lỗi truy vấn cơ sở dữ liệu.';
          dbInfo = {
            ok: false,
            kind: repos.kind,
            tables: GKSK_TABLE_NAMES,
            userCount: 0,
            batchCount: 0,
            certificateCount: 0,
            message: `Lỗi kết nối CSDL: ${errMsg}`,
          };
        }

        // 2. Chẩn đoán 2 bước trên Cổng Sở Y tế Đồng Nai (MasterFlow)
        // Bước 2.1: Kiểm tra Đăng nhập lấy Bearer Token (POST /api/auth/login)
        const loginOutcome = await gkskClient.login({ forceRefresh: true });
        const loginStep: SytDiagnosticStep = loginOutcome.ok
          ? {
              ok: true,
              endpoint: 'POST /api/auth/login',
              httpStatus: loginOutcome.httpStatus,
              resCode: loginOutcome.resCode,
              resMsg: loginOutcome.resMsg,
              message: `Bước 1 (Đăng nhập CSYT "${summary.username}"): Thành công HTTP ${loginOutcome.httpStatus} (${loginOutcome.resCode}), cấp Bearer Token hiệu lực ${loginOutcome.durationMinutes} phút.`,
            }
          : {
              ok: false,
              endpoint: 'POST /api/auth/login',
              httpStatus: loginOutcome.httpStatus,
              resCode: loginOutcome.resCode,
              resMsg: loginOutcome.resMsg,
              message: `Bước 1 (Đăng nhập CSYT "${summary.username}") thất bại tại POST /api/auth/login: ${loginOutcome.message}`,
            };

        // Bước 2.2: Nếu Bước 1 lấy được Token, kiểm tra quyền gọi API GKSK Lái xe qua GET /api/platform/gksk-lai-xe/status
        let apiPermissionStep: SytDiagnosticStep | null = null;
        if (loginOutcome.ok) {
          const probeMsgId = newMsgId(summary.senderId, gkskClient.getNow());
          const statusOutcome = await gkskClient.status(probeMsgId, {
            skipReloginOn403: true,
          });

          if (statusOutcome.kind === 'not_found' || statusOutcome.found) {
            apiPermissionStep = {
              ok: true,
              endpoint: 'GET /api/platform/gksk-lai-xe/status',
              httpStatus: statusOutcome.httpStatus,
              resCode: statusOutcome.resCode,
              resMsg: statusOutcome.resMsg,
              message: `Bước 2 (Quyền API GKSK Lái xe & sender_id="${summary.senderId}"): Hợp lệ (HTTP ${statusOutcome.httpStatus} ${statusOutcome.resCode ?? 'CM_INVALID_REQUEST'}${statusOutcome.resMsg ? ` — "${statusOutcome.resMsg}"` : ''}). Sẵn sàng đẩy giấy GKSK lái xe!`,
            };
          } else {
            const is403 = statusOutcome.httpStatus === 403;
            apiPermissionStep = {
              ok: false,
              endpoint: 'GET /api/platform/gksk-lai-xe/status',
              httpStatus: statusOutcome.httpStatus,
              resCode: statusOutcome.resCode,
              resMsg: statusOutcome.resMsg,
              message: is403
                ? `Bước 1 đăng nhập ĐÚNG mật khẩu, nhưng Bước 2 gọi API GKSK Lái xe bị từ chối quyền (HTTP 403 ${statusOutcome.resCode ?? 'CM_PERMISSION_DENY'}${statusOutcome.resMsg ? ` — "${statusOutcome.resMsg}"` : ''}). Nguyên nhân: tài khoản CSYT "${summary.username}" chưa được MasterHive bật quyền dịch vụ GKSK lái xe (sync_gksk_lai_xe) hoặc mã sender_id ("${summary.senderId}") không khớp.`
                : `Bước 2 kiểm tra endpoint GKSK Lái xe gặp lỗi: ${statusOutcome.message}`,
            };
          }
        }

        const overallSytOk =
          loginStep.ok && (apiPermissionStep ? apiPermissionStep.ok : true);
        const sytInfo: SystemConnectionCheckResponse['sytGateway'] = {
          ok: overallSytOk,
          facilityId: summary.facilityId,
          facilityName: summary.facilityName,
          username: summary.username,
          senderId: summary.senderId,
          baseUrlHost: summary.baseUrlHost,
          httpStatus:
            apiPermissionStep && !apiPermissionStep.ok
              ? apiPermissionStep.httpStatus
              : loginStep.httpStatus,
          resCode:
            apiPermissionStep && !apiPermissionStep.ok
              ? apiPermissionStep.resCode
              : loginStep.resCode,
          resMsg:
            apiPermissionStep && !apiPermissionStep.ok
              ? apiPermissionStep.resMsg
              : loginStep.resMsg,
          durationMinutes: loginOutcome.ok ? loginOutcome.durationMinutes : null,
          expiresAt: loginOutcome.ok
            ? new Date(loginOutcome.expiresAtMs).toISOString()
            : null,
          message:
            apiPermissionStep && !apiPermissionStep.ok
              ? apiPermissionStep.message
              : loginOutcome.ok
                ? `Đăng nhập tài khoản CSYT ${summary.username} (sender_id=${summary.senderId}) lên Cổng Sở Y tế (${summary.baseUrlHost}) thành công và xác nhận có quyền gọi API GKSK lái xe (hiệu lực token ${loginOutcome.durationMinutes} phút).`
                : loginOutcome.message,
          loginStep,
          apiPermissionStep,
        };

        const session = getAuthSession(req);
        log.info(
          {
            event: 'system_connection_checked',
            actorUsername: session?.username ?? 'unknown',
            dbOk: dbInfo.ok,
            dbKind: dbInfo.kind,
            sytOk: sytInfo.ok,
            sytLoginOk: loginStep.ok,
            sytApiPermOk: apiPermissionStep?.ok ?? null,
            sytHttpStatus: sytInfo.httpStatus,
            sytResCode: sytInfo.resCode,
            sytResMsg: sytInfo.resMsg,
          },
          'Thực hiện kiểm tra chẩn đoán kết nối Cổng Sở Y tế & Database',
        );

        const responsePayload: SystemConnectionCheckResponse = {
          ok: dbInfo.ok && sytInfo.ok,
          checkedAt,
          database: dbInfo,
          sytGateway: sytInfo,
        };

        res.status(200).json(responsePayload);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
