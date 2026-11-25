import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { z } from 'zod';
import type { CertificateStatus, ReconcileTab } from '@gksk/shared';
import type { CertificateListQuery } from '../db/types.js';
import { AppError } from '../middleware/errorHandler.js';
import type { CertificateService } from '../services/certificateService.js';

const VALID_TABS = new Set<ReconcileTab>(['all', 'unsent', 'accepted', 'attention']);
const VALID_STATUSES = new Set<CertificateStatus>([
  'invalid',
  'ready',
  'sending',
  'accepted',
  'rejected',
  'error',
]);

const xmlZipBodySchema = z.object({
  ids: z
    .array(z.number().int().positive())
    .min(1, 'Danh sách ids không được rỗng.')
    .max(1000, 'Mỗi lượt tải ZIP tối đa 1000 giấy.'),
});

function parsePositiveId(raw: unknown, errorCode: string, label: string): number {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
    throw new AppError(errorCode, `${label} phải là số nguyên dương.`, 400);
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(errorCode, `${label} phải là số nguyên dương.`, 400);
  }
  return parsed;
}

function getQueryString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function parseCertificateListQuery(req: Request): CertificateListQuery {
  const query: CertificateListQuery = {};

  const rawTab = getQueryString(req.query.tab);
  if (rawTab !== undefined) {
    if (!VALID_TABS.has(rawTab as ReconcileTab)) {
      throw new AppError(
        'INVALID_TAB_FILTER',
        'Tham số tab chỉ chấp nhận một trong: all, unsent, accepted, attention.',
        400,
      );
    }
    query.tab = rawTab as ReconcileTab;
  }

  const rawStatus = getQueryString(req.query.status);
  if (rawStatus !== undefined) {
    if (!VALID_STATUSES.has(rawStatus as CertificateStatus)) {
      throw new AppError(
        'INVALID_STATUS_FILTER',
        'Tham số status chỉ chấp nhận một trong: invalid, ready, sending, accepted, rejected, error.',
        400,
      );
    }
    query.status = rawStatus as CertificateStatus;
  }

  const rawBatchId = getQueryString(req.query.batchId);
  if (rawBatchId !== undefined) {
    query.batchId = parsePositiveId(rawBatchId, 'INVALID_BATCH_ID', 'Tham số batchId');
  }

  const rawFromDate = getQueryString(req.query.fromDate);
  if (rawFromDate !== undefined) {
    query.fromDate = rawFromDate;
  }

  const rawToDate = getQueryString(req.query.toDate);
  if (rawToDate !== undefined) {
    query.toDate = rawToDate;
  }

  const rawQ = getQueryString(req.query.q);
  if (rawQ !== undefined) {
    query.q = rawQ;
  }

  const rawPage = getQueryString(req.query.page);
  if (rawPage !== undefined) {
    query.page = parsePositiveId(rawPage, 'INVALID_PAGE', 'Tham số page');
  }

  const rawPageSize = getQueryString(req.query.pageSize);
  if (rawPageSize !== undefined) {
    const pageSize = parsePositiveId(
      rawPageSize,
      'INVALID_PAGE_SIZE',
      'Tham số pageSize',
    );
    if (pageSize > 1000) {
      throw new AppError(
        'INVALID_PAGE_SIZE',
        'Tham số pageSize tối đa là 1000.',
        400,
      );
    }
    query.pageSize = pageSize;
  }

  return query;
}

function buildContentDispositionAttachment(fileName: string): string {
  const safeFileName = fileName.replace(/["\\\r\n]/g, '_');
  const encoded = encodeURIComponent(safeFileName);
  return `attachment; filename="${safeFileName}"; filename*=UTF-8''${encoded}`;
}

export interface CertificatesRouterDeps {
  certificateService: CertificateService;
}

/**
 * Tạo router cho các endpoint Danh sách đối soát, Chi tiết chỉ đọc, Xuất XML (`.xml` & `.zip`)
 * và Xuất Excel đối soát (ARCHITECTURE.md §4 & IMPLEMENTATION-PLAN.md S10):
 * - `GET /api/batches`
 * - `GET /api/certificates`
 * - `GET /api/certificates/export-excel`
 * - `POST /api/certificates/xml-zip`
 * - `GET /api/certificates/:id`
 * - `DELETE /api/certificates/:id`
 * - `GET /api/certificates/:id/xml`
 * - `GET /api/certificates/:id/submissions`
 *
 * Lưu ý: Tuyệt đối KHÔNG tạo `POST /api/certificates` hay `PUT /api/certificates/:id`.
 */
export function createCertificatesRouter(deps: CertificatesRouterDeps): Router {
  const router = Router();
  const { certificateService } = deps;

  router.get(
    '/batches',
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const items = await certificateService.listBatches();
        res.status(200).json({ items });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/certificates',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const query = parseCertificateListQuery(req);
        const result = await certificateService.listCertificates(query);
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/certificates/export-excel',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const query = parseCertificateListQuery(req);
        const download = await certificateService.exportReconcileExcel(query);
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader(
          'Content-Disposition',
          buildContentDispositionAttachment(download.fileName),
        );
        res.status(200).send(download.buffer);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/certificates/xml-zip',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = xmlZipBodySchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(
            'INVALID_ZIP_IDS',
            'Trường ids phải là mảng số nguyên dương không rỗng (tối đa 1000 giấy).',
            400,
          );
        }

        const download = await certificateService.buildCertificatesXmlZip(
          parsed.data.ids,
        );
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader(
          'Content-Disposition',
          buildContentDispositionAttachment(download.fileName),
        );
        res.status(200).send(download.buffer);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/certificates/:id',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = parsePositiveId(
          req.params.id,
          'INVALID_CERTIFICATE_ID',
          'ID giấy khám sức khỏe',
        );
        const detail = await certificateService.getCertificateDetail(id);
        res.status(200).json(detail);
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/certificates/:id',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = parsePositiveId(
          req.params.id,
          'INVALID_CERTIFICATE_ID',
          'ID giấy khám sức khỏe',
        );
        await certificateService.deleteCertificate(id);
        res.status(200).json({ ok: true, id });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/certificates/:id/xml',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = parsePositiveId(
          req.params.id,
          'INVALID_CERTIFICATE_ID',
          'ID giấy khám sức khỏe',
        );
        const download = await certificateService.getCertificateXmlDownload(id);
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          buildContentDispositionAttachment(download.fileName),
        );
        res.status(200).send(Buffer.from(download.xml, 'utf8'));
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/certificates/:id/submissions',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const id = parsePositiveId(
          req.params.id,
          'INVALID_CERTIFICATE_ID',
          'ID giấy khám sức khỏe',
        );
        const items = await certificateService.listCertificateSubmissions(id);
        res.status(200).json({ items });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
