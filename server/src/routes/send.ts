import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { JobService } from '../services/jobService.js';
import {
  SendServiceError,
  toSafeCertificateSummary,
  type SafeCertificateSummary,
  type SendService,
} from '../services/sendService.js';

export { toSafeCertificateSummary, type SafeCertificateSummary };

const batchSendBodySchema = z.object({
  ids: z
    .array(z.number().int().positive())
    .min(1, 'Danh sách ids không được rỗng.')
    .max(1000, 'Mỗi lượt gửi hàng loạt tối đa 1000 giấy.'),
});

function parsePositiveId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) {
    return null;
  }
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function sendErrorResponse(
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

export interface SendRouterDeps {
  sendService: SendService;
  jobService: JobService;
}

/**
 * Tạo router cho các endpoint đẩy cổng và tra cứu trạng thái (ARCHITECTURE.md §4 & IMPLEMENTATION-PLAN.md S9):
 * - `POST /api/certificates/:id/send`: Gửi 1 giấy, trả kết quả cuối.
 * - `POST /api/send`: Body `{ ids: number[] }` -> `{ jobId }`; gửi hàng loạt qua hàng đợi trong bộ nhớ.
 * - `GET /api/jobs/:jobId`: Tiến độ gửi hàng loạt `{ total, done, accepted, rejected, error, items[] }`.
 * - `POST /api/submissions/:id/refresh`: Tra lại status theo `msg_id` trên Hệ thống Sở.
 */
export function createSendRouter(deps: SendRouterDeps): Router {
  const router = Router();
  const { sendService, jobService } = deps;

  router.post('/certificates/:id/send', async (req: Request, res: Response) => {
    const certificateId = parsePositiveId(req.params.id);
    if (certificateId === null) {
      sendErrorResponse(
        res,
        400,
        'INVALID_CERTIFICATE_ID',
        'ID giấy khám sức khỏe phải là số nguyên dương.',
      );
      return;
    }

    try {
      const outcome = await sendService.sendCertificate(certificateId);
      res.status(200).json({
        certificateId: outcome.certificateId,
        so: outcome.so,
        status: outcome.status,
        certificate: toSafeCertificateSummary(outcome.certificate),
        submission: outcome.submission,
        issues: outcome.issues,
        reusedPendingSubmission: outcome.reusedPendingSubmission,
        recoveredViaStatus: outcome.recoveredViaStatus,
      });
    } catch (err) {
      if (err instanceof SendServiceError) {
        sendErrorResponse(res, err.httpStatus, err.code, err.message);
        return;
      }
      sendErrorResponse(
        res,
        500,
        'INTERNAL_SEND_ERROR',
        'Lỗi nội bộ khi thực hiện gửi giấy khám sức khỏe.',
      );
    }
  });

  router.post('/send', (req: Request, res: Response) => {
    const parsed = batchSendBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendErrorResponse(
        res,
        400,
        'INVALID_BATCH_IDS',
        'Trường ids phải là mảng số nguyên dương không rỗng (tối đa 1000 giấy).',
      );
      return;
    }

    try {
      const job = jobService.startBatch(parsed.data.ids);
      res.status(200).json({
        jobId: job.jobId,
        status: job.status,
        total: job.total,
      });
    } catch (err) {
      if (err instanceof SendServiceError) {
        sendErrorResponse(res, err.httpStatus, err.code, err.message);
        return;
      }
      sendErrorResponse(
        res,
        500,
        'INTERNAL_JOB_ERROR',
        'Lỗi nội bộ khi khởi tạo tiến trình gửi hàng loạt.',
      );
    }
  });

  router.get('/jobs/:jobId', (req: Request, res: Response) => {
    const jobId = typeof req.params.jobId === 'string' ? req.params.jobId.trim() : '';
    if (jobId.length === 0) {
      sendErrorResponse(
        res,
        400,
        'INVALID_JOB_ID',
        'Mã tiến trình jobId không hợp lệ.',
      );
      return;
    }

    const job = jobService.getJob(jobId);
    if (!job) {
      sendErrorResponse(
        res,
        404,
        'JOB_NOT_FOUND',
        `Không tìm thấy tiến trình gửi hàng loạt (jobId=${jobId}).`,
      );
      return;
    }

    res.status(200).json(job);
  });

  router.post('/submissions/:id/refresh', async (req: Request, res: Response) => {
    const submissionId = parsePositiveId(req.params.id);
    if (submissionId === null) {
      sendErrorResponse(
        res,
        400,
        'INVALID_SUBMISSION_ID',
        'ID lịch sử gửi phải là số nguyên dương.',
      );
      return;
    }

    try {
      const outcome = await sendService.refreshSubmission(submissionId);
      res.status(200).json({
        submission: outcome.submission,
        certificate: toSafeCertificateSummary(outcome.certificate),
        found: outcome.statusResult.found,
        status: outcome.submission.resultStatus,
        httpStatus: outcome.statusResult.httpStatus,
        resCode: outcome.statusResult.resCode,
      });
    } catch (err) {
      if (err instanceof SendServiceError) {
        sendErrorResponse(res, err.httpStatus, err.code, err.message);
        return;
      }
      sendErrorResponse(
        res,
        500,
        'INTERNAL_REFRESH_ERROR',
        'Lỗi nội bộ khi tra cứu trạng thái gói tin trên Hệ thống Sở.',
      );
    }
  });

  return router;
}
