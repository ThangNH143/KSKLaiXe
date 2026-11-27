import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { Logger } from 'pino';
import { GKSK_TABLE_NAMES, type DbRepositories } from '../db/types.js';
import type { GkskClient } from '../gksk/client.js';
import { logger as defaultLogger } from '../logger.js';
import { getAuthSession } from '../middleware/requireAuth.js';

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
    baseUrlHost: string;
    httpStatus: number | null;
    resCode: string | null;
    durationMinutes: number | null;
    expiresAt: string | null;
    message: string;
  };
}

export interface SystemRouterDeps {
  repos: DbRepositories;
  gkskClient: GkskClient;
  facilityId: string;
  facilityName: string;
  baseUrlHost: string;
  logger?: Logger;
}

/**
 * Router kiểm tra kết nối hệ thống (`POST /api/system/check-connection` — ARCHITECTURE.md §4):
 * - Kiểm tra trực tiếp truy vấn tới Database (`dbo.gksk_*`) để xác nhận 5 bảng hoạt động bình thường.
 * - Gọi trực tiếp `gkskClient.login({ forceRefresh: true })` lên Cổng Sở Y tế Đồng Nai để xác nhận tài khoản CSYT hợp lệ.
 * - Tuyệt đối không bao giờ trả về chuỗi Bearer token hay mật khẩu.
 */
export function createSystemRouter(deps: SystemRouterDeps): Router {
  const router = Router();
  const { repos, gkskClient, facilityId, facilityName, baseUrlHost } = deps;
  const log = deps.logger ?? defaultLogger;

  router.post(
    '/system/check-connection',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const checkedAt = new Date().toISOString();

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

        // 2. Kiểm tra kết nối & đăng nhập tài khoản CSYT trên Cổng Sở Y tế Đồng Nai
        const loginOutcome = await gkskClient.login({ forceRefresh: true });
        const sytInfo: SystemConnectionCheckResponse['sytGateway'] =
          loginOutcome.ok
            ? {
                ok: true,
                facilityId,
                facilityName,
                baseUrlHost,
                httpStatus: loginOutcome.httpStatus,
                resCode: loginOutcome.resCode,
                durationMinutes: loginOutcome.durationMinutes,
                expiresAt: new Date(loginOutcome.expiresAtMs).toISOString(),
                message: `Đăng nhập tài khoản CSYT ${facilityId} lên Cổng Sở Y tế (${baseUrlHost}) thành công (hiệu lực token ${loginOutcome.durationMinutes} phút).`,
              }
            : {
                ok: false,
                facilityId,
                facilityName,
                baseUrlHost,
                httpStatus: loginOutcome.httpStatus,
                resCode: loginOutcome.resCode,
                durationMinutes: null,
                expiresAt: null,
                message: loginOutcome.message,
              };

        const session = getAuthSession(req);
        log.info(
          {
            event: 'system_connection_checked',
            actorUsername: session?.username ?? 'unknown',
            dbOk: dbInfo.ok,
            dbKind: dbInfo.kind,
            sytOk: sytInfo.ok,
            sytHttpStatus: sytInfo.httpStatus,
            sytResCode: sytInfo.resCode,
          },
          'Thực hiện kiểm tra kết nối Cổng Sở Y tế & Database',
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
