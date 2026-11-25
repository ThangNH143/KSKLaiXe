import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import multer, { MulterError } from 'multer';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler.js';
import {
  hasXlsxMagicBytes,
  MAX_EXCEL_DATA_ROWS,
  MAX_EXCEL_FILE_BYTES,
  type ImportService,
} from '../services/importService.js';

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_EXCEL_FILE_BYTES,
    files: 1,
  },
});

const commitImportBodySchema = z.object({
  filename: z.string().trim().min(1, 'Tên file Excel không được để trống.'),
  rows: z
    .array(
      z.object({
        rowNumber: z.number().int().positive().nullable().optional(),
        fields: z.record(z.string(), z.unknown()),
        selected: z.boolean().optional(),
      }),
    )
    .min(1, 'Danh sách rows không được rỗng.')
    .max(
      MAX_EXCEL_DATA_ROWS,
      `Mỗi lượt lưu tối đa ${MAX_EXCEL_DATA_ROWS} dòng.`,
    ),
});

export interface ImportRouterDeps {
  importService: ImportService;
}

/**
 * Tạo router cho các endpoint Mẫu Excel và Import ghi đè thông minh (ARCHITECTURE.md §4 & IMPLEMENTATION-PLAN.md S11):
 * - `GET /api/import/template`: Tải `GKSK_mau_nhap_lieu.xlsx` (2 sheet `GKSK` & `HuongDan`).
 * - `POST /api/import/excel`: `multipart/form-data` (`file`) -> xem trước từng dòng + `conflictMode` & `defaultSelected`.
 * - `POST /api/import/commit`: Body `{ filename, rows[] }` -> lưu/ghi đè cả dòng `ready` lẫn dòng `invalid` có `SO` vào CSDL.
 */
export function createImportRouter(deps: ImportRouterDeps): Router {
  const router = Router();
  const { importService } = deps;

  router.get(
    '/import/template',
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const buffer = await importService.buildTemplate();
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="GKSK_mau_nhap_lieu.xlsx"; filename*=UTF-8\'\'GKSK_mau_nhap_lieu.xlsx',
        );
        res.status(200).send(buffer);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/import/excel',
    (req: Request, res: Response, next: NextFunction) => {
      const middleware = uploadMemory.single('file');
      middleware(req, res, (err: unknown) => {
        if (!err) {
          next();
          return;
        }
        if (err instanceof MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            next(
              new AppError(
                'EXCEL_FILE_TOO_LARGE',
                'Kích thước file Excel vượt quá giới hạn tối đa 5 MB.',
                413,
              ),
            );
            return;
          }
          next(
            new AppError(
              'UPLOAD_ERROR',
              `Lỗi tải file lên: ${err.message}`,
              400,
            ),
          );
          return;
        }
        next(err);
      });
    },
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const uploaded = req.file;
        if (!uploaded) {
          throw new AppError(
            'MISSING_UPLOAD_FILE',
            'Vui lòng đính kèm file Excel (.xlsx) ở trường "file".',
            400,
          );
        }

        const originalName = uploaded.originalname.trim();
        if (!originalName.toLowerCase().endsWith('.xlsx')) {
          throw new AppError(
            'INVALID_FILE_EXTENSION',
            'Hệ thống chỉ nhận file Excel định dạng .xlsx.',
            415,
          );
        }

        if (!hasXlsxMagicBytes(uploaded.buffer)) {
          throw new AppError(
            'INVALID_EXCEL_FORMAT',
            'File tải lên không đúng định dạng .xlsx hợp lệ (sai magic bytes PK).',
            415,
          );
        }

        const preview = await importService.previewImport(uploaded.buffer);
        res.status(200).json({
          filename: originalName,
          ...preview,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/import/commit',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = commitImportBodySchema.safeParse(req.body);
        if (!parsed.success) {
          throw new AppError(
            'INVALID_COMMIT_PAYLOAD',
            parsed.error.issues[0]?.message ??
              'Dữ liệu gửi lên không đúng cấu trúc { filename, rows[] }.',
            400,
          );
        }

        const commitPayload = {
          filename: parsed.data.filename,
          rows: parsed.data.rows.map((r) => ({
            ...(r.rowNumber !== undefined ? { rowNumber: r.rowNumber } : {}),
            fields: r.fields,
            ...(r.selected !== undefined ? { selected: r.selected } : {}),
          })),
        };
        const result = await importService.commitImport(commitPayload);
        res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
