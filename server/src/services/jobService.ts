import crypto from 'node:crypto';
import type { Logger } from 'pino';
import type { ServerIssue } from '@gksk/shared';
import { defaultSleep } from '../gksk/retry.js';
import { logger as defaultLogger } from '../logger.js';
import { SendServiceError, type SendService } from './sendService.js';

/** Số lượng request gửi song song tối đa trong hàng đợi gửi hàng loạt (IMPLEMENTATION-PLAN.md S9: ≤ 2). */
export const MAX_BATCH_CONCURRENCY = 2;

/**
 * Khoảng nghỉ tối thiểu (ms) giữa 2 thời điểm phát lệnh gửi trong hàng đợi: 250 ms.
 * Với 250 ms/gói, tốc độ tối đa là 60.000 / 250 = 240 gói/phút (< 300 gói/phút theo API-CONTRACT.md §8).
 */
export const BATCH_SEND_INTERVAL_MS = 250;

/** Số lượng job đã hoàn tất tối đa giữ lại trong bộ nhớ để tránh rò rỉ RAM. */
const MAX_JOBS_IN_MEMORY = 200;

export type BatchJobStatus = 'running' | 'completed';

export type BatchJobItemStatus =
  | 'queued'
  | 'sending'
  | 'accepted'
  | 'rejected'
  | 'invalid'
  | 'error';

/** Trạng thái xử lý của từng giấy trong một tiến trình gửi hàng loạt. */
export interface BatchJobItem {
  certificateId: number;
  so: string | null;
  status: BatchJobItemStatus;
  msgId: string | null;
  serverSubmissionId: string | null;
  serverCertificateId: string | null;
  httpStatus: number | null;
  resCode: string | null;
  errors: ServerIssue[];
  warnings: ServerIssue[];
  lastError: string | null;
  attempts: number;
  reusedPendingSubmission: boolean;
  recoveredViaStatus: boolean;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Thông tin tiến độ gửi hàng loạt trả về cho `GET /api/jobs/:jobId` (ARCHITECTURE.md §4). */
export interface BatchJobProgress {
  jobId: string;
  status: BatchJobStatus;
  total: number;
  done: number;
  accepted: number;
  rejected: number;
  error: number;
  invalid: number;
  pending: number;
  pausedUntilMs: number | null;
  rateLimitCount: number;
  createdAt: string;
  finishedAt: string | null;
  items: BatchJobItem[];
}

interface InternalBatchJob extends BatchJobProgress {
  completionPromise: Promise<BatchJobProgress>;
}

/** Cấu hình khởi tạo `JobService`. */
export interface JobServiceOptions {
  sendService: SendService;
  /** Số lượng worker gửi song song tối đa (mặc định 2, kẹp trong khoảng `1..2`). */
  maxConcurrency?: number;
  /** Khoảng nghỉ tối thiểu (ms) giữa hai lần phát lệnh gửi (mặc định 250 ms). */
  minIntervalMs?: number;
  /** Hàm lấy thời gian hiện tại (epoch ms), cho phép dùng đồng hồ giả trong unit test. */
  now?: () => number;
  /** Hàm chờ bất đồng bộ (ms), cho phép dùng `sleep` giả trong unit test. */
  sleep?: (ms: number) => Promise<void>;
  /** Logger `pino` có redact (mặc định dùng `logger` của server). */
  logger?: Logger;
}

function cloneJobItem(item: BatchJobItem): BatchJobItem {
  return {
    ...item,
    errors: item.errors.map((e) => ({ ...e })),
    warnings: item.warnings.map((w) => ({ ...w })),
  };
}

function toPublicProgress(job: InternalBatchJob): BatchJobProgress {
  return {
    jobId: job.jobId,
    status: job.status,
    total: job.total,
    done: job.done,
    accepted: job.accepted,
    rejected: job.rejected,
    error: job.error,
    invalid: job.invalid,
    pending: Math.max(0, job.total - job.done),
    pausedUntilMs: job.pausedUntilMs,
    rateLimitCount: job.rateLimitCount,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    items: job.items.map(cloneJobItem),
  };
}

/**
 * Dịch vụ quản lý hàng đợi gửi hàng loạt trong bộ nhớ (IMPLEMENTATION-PLAN.md S9 & API-CONTRACT.md §8):
 * - Tối đa 2 request song song (`maxConcurrency <= 2`).
 * - Nghỉ tối thiểu 250 ms giữa các lần bắt đầu gửi (`minIntervalMs = 250` -> tối đa 240 gói/phút < 300 gói/phút).
 * - Khi bất kỳ request nào gặp HTTP 429 (`Retry-After`), tự động tạm dừng toàn bộ hàng đợi theo thời gian `Retry-After`.
 */
export class JobService {
  private readonly sendService: SendService;
  private readonly maxConcurrency: number;
  private readonly minIntervalMs: number;
  private readonly nowFn: () => number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly log: Logger;

  private readonly jobs = new Map<string, InternalBatchJob>();
  private pacerChain: Promise<void> = Promise.resolve();
  private lastDispatchMs: number | null = null;
  private pausedUntilMs: number | null = null;
  private readonly dispatchTimestampsMs: number[] = [];

  constructor(options: JobServiceOptions) {
    this.sendService = options.sendService;
    const requestedConcurrency = options.maxConcurrency ?? MAX_BATCH_CONCURRENCY;
    this.maxConcurrency = Math.min(
      MAX_BATCH_CONCURRENCY,
      Math.max(1, Math.floor(requestedConcurrency)),
    );
    this.minIntervalMs = Math.max(0, options.minIntervalMs ?? BATCH_SEND_INTERVAL_MS);
    this.nowFn = options.now ?? (() => Date.now());
    this.sleepFn = options.sleep ?? defaultSleep;
    this.log = options.logger ?? defaultLogger;
  }

  /**
   * Trả về danh sách các mốc thời gian (epoch ms) đã phát lệnh gửi từ hàng đợi
   * (phục vụ kiểm thử giới hạn tốc độ ≤ 300 gói/phút với đồng hồ giả).
   */
  public getDispatchTimestamps(): readonly number[] {
    return [...this.dispatchTimestampsMs];
  }

  /**
   * Tạm dừng toàn bộ hàng đợi gửi hàng loạt trong `durationMs` mili-giây khi gặp HTTP 429.
   */
  public pauseQueue(durationMs: number, activeJob?: InternalBatchJob): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return;
    }
    const targetUntil = this.nowFn() + durationMs;
    if (this.pausedUntilMs === null || targetUntil > this.pausedUntilMs) {
      this.pausedUntilMs = targetUntil;
    }
    if (activeJob) {
      activeJob.rateLimitCount += 1;
      activeJob.pausedUntilMs = this.pausedUntilMs;
    }
    this.log.warn(
      {
        durationMs,
        pausedUntilMs: this.pausedUntilMs,
        ...(activeJob ? { jobId: activeJob.jobId } : {}),
      },
      'Gặp HTTP 429, tạm dừng hàng đợi gửi hàng loạt GKSK',
    );
  }

  /**
   * Khởi tạo và chạy ngầm một tiến trình gửi hàng loạt cho danh sách `ids` (ARCHITECTURE.md §3 & §4).
   */
  public startBatch(ids: readonly number[]): BatchJobProgress {
    const uniqueIds: number[] = [];
    const seen = new Set<number>();
    for (const rawId of ids) {
      const id = Math.floor(rawId);
      if (Number.isInteger(id) && id > 0 && !seen.has(id)) {
        seen.add(id);
        uniqueIds.push(id);
      }
    }

    if (uniqueIds.length === 0) {
      throw new SendServiceError(
        'INVALID_REQUEST',
        'Danh sách ids gửi hàng loạt phải có ít nhất 1 ID số nguyên dương.',
        400,
      );
    }

    this.pruneOldCompletedJobs();

    const nowMs = this.nowFn();
    const jobId = crypto.randomUUID();
    const items: BatchJobItem[] = uniqueIds.map((certificateId) => ({
      certificateId,
      so: null,
      status: 'queued',
      msgId: null,
      serverSubmissionId: null,
      serverCertificateId: null,
      httpStatus: null,
      resCode: null,
      errors: [],
      warnings: [],
      lastError: null,
      attempts: 0,
      reusedPendingSubmission: false,
      recoveredViaStatus: false,
      startedAt: null,
      finishedAt: null,
    }));

    const internalJob: InternalBatchJob = {
      jobId,
      status: 'running',
      total: items.length,
      done: 0,
      accepted: 0,
      rejected: 0,
      error: 0,
      invalid: 0,
      pending: items.length,
      pausedUntilMs: null,
      rateLimitCount: 0,
      createdAt: new Date(nowMs).toISOString(),
      finishedAt: null,
      items,
      completionPromise: Promise.resolve(null as unknown as BatchJobProgress),
    };

    internalJob.completionPromise = this.runJobWorkers(internalJob);
    this.jobs.set(jobId, internalJob);

    this.log.info(
      {
        jobId,
        total: internalJob.total,
        maxConcurrency: this.maxConcurrency,
        minIntervalMs: this.minIntervalMs,
      },
      'Khởi chạy tiến trình gửi hàng loạt GKSK',
    );

    return toPublicProgress(internalJob);
  }

  /**
   * Lấy trạng thái tiến độ hiện tại của một job theo `jobId`.
   */
  public getJob(jobId: string): BatchJobProgress | null {
    const found = this.jobs.get(jobId.trim());
    return found ? toPublicProgress(found) : null;
  }

  /**
   * Chờ một job gửi hàng loạt hoàn tất (phục vụ kiểm thử tích hợp và script verify).
   */
  public async waitForJob(jobId: string): Promise<BatchJobProgress | null> {
    const found = this.jobs.get(jobId.trim());
    if (!found) {
      return null;
    }
    return found.completionPromise;
  }

  /**
   * Xin cấp quyền phát lệnh gửi tiếp theo qua cổng điều tốc tuần tự (`pacerChain`):
   * - Đảm bảo khoảng cách giữa 2 lần phát lệnh liên tiếp ≥ `minIntervalMs` (250 ms).
   * - Tôn trọng thời gian tạm dừng toàn hàng đợi `pausedUntilMs` khi gặp HTTP 429.
   */
  private acquireDispatchSlot(job: InternalBatchJob): Promise<void> {
    const next = this.pacerChain.then(async () => {
      // 1. Chờ nếu hàng đợi đang tạm dừng vì HTTP 429
      while (this.pausedUntilMs !== null && this.nowFn() < this.pausedUntilMs) {
        const waitPauseMs = this.pausedUntilMs - this.nowFn();
        job.pausedUntilMs = this.pausedUntilMs;
        if (waitPauseMs > 0) {
          await this.sleepFn(waitPauseMs);
        }
      }
      job.pausedUntilMs = null;

      // 2. Đảm bảo khoảng nghỉ tối thiểu minIntervalMs (250ms) kể từ lần phát lệnh trước
      if (this.lastDispatchMs !== null && this.minIntervalMs > 0) {
        const elapsed = this.nowFn() - this.lastDispatchMs;
        const waitIntervalMs = this.minIntervalMs - elapsed;
        if (waitIntervalMs > 0) {
          await this.sleepFn(waitIntervalMs);
        }
      }

      // 3. Kiểm tra lại xem trong lúc chờ 250ms có worker nào vừa báo HTTP 429 hay không
      while (this.pausedUntilMs !== null && this.nowFn() < this.pausedUntilMs) {
        const waitPauseMs = this.pausedUntilMs - this.nowFn();
        job.pausedUntilMs = this.pausedUntilMs;
        if (waitPauseMs > 0) {
          await this.sleepFn(waitPauseMs);
        }
      }
      job.pausedUntilMs = null;

      const dispatchTimeMs = this.nowFn();
      this.lastDispatchMs = dispatchTimeMs;
      this.dispatchTimestampsMs.push(dispatchTimeMs);
    });

    this.pacerChain = next.catch(() => {});
    return next;
  }

  private async runJobWorkers(job: InternalBatchJob): Promise<BatchJobProgress> {
    let nextIndex = 0;
    const workerCount = Math.min(this.maxConcurrency, job.items.length);

    const runWorker = async (): Promise<void> => {
      for (;;) {
        const currentIndex = nextIndex;
        if (currentIndex >= job.items.length) {
          return;
        }
        nextIndex += 1;

        const item = job.items[currentIndex];
        if (!item) {
          return;
        }

        await this.acquireDispatchSlot(job);

        item.status = 'sending';
        item.startedAt = new Date(this.nowFn()).toISOString();

        try {
          const outcome = await this.sendService.sendCertificate(item.certificateId, {
            onRateLimit: (retryAfterMs) => {
              this.pauseQueue(retryAfterMs, job);
            },
          });

          item.so = outcome.so;
          item.status = outcome.status;
          item.msgId = outcome.submission?.msgId ?? null;
          item.serverSubmissionId = outcome.submission?.serverSubmissionId ?? null;
          item.serverCertificateId = outcome.certificate.serverCertificateId ?? null;
          item.httpStatus = outcome.submission?.httpStatus ?? null;
          item.resCode = outcome.submission?.resCode ?? null;
          item.errors = outcome.submission ? [...outcome.submission.errors] : [];
          item.warnings = outcome.submission ? [...outcome.submission.warnings] : [];
          item.attempts = outcome.submission?.attempts ?? 0;
          item.reusedPendingSubmission = outcome.reusedPendingSubmission;
          item.recoveredViaStatus = outcome.recoveredViaStatus;

          if (outcome.status === 'invalid') {
            const blockingCodes = outcome.issues
              .filter((issue) => issue.severity === 'error')
              .map((issue) => issue.code);
            item.lastError = `[INVALID] Giấy có lỗi dữ liệu chặn: ${blockingCodes.join(', ')}`;
          } else {
            item.lastError = outcome.submission?.lastError ?? null;
          }

          item.finishedAt = new Date(this.nowFn()).toISOString();

          job.done += 1;
          job.pending = Math.max(0, job.total - job.done);
          if (outcome.status === 'accepted') {
            job.accepted += 1;
          } else if (outcome.status === 'rejected') {
            job.rejected += 1;
          } else if (outcome.status === 'invalid') {
            job.invalid += 1;
            job.error += 1;
          } else {
            job.error += 1;
          }
        } catch (err) {
          item.status = 'error';
          item.lastError =
            err instanceof SendServiceError
              ? `[${err.code}] ${err.message}`
              : '[INTERNAL_ERROR] Lỗi nội bộ khi xử lý giấy trong hàng đợi';
          item.finishedAt = new Date(this.nowFn()).toISOString();

          job.done += 1;
          job.pending = Math.max(0, job.total - job.done);
          job.error += 1;
        }
      }
    };

    const workers = Array.from({ length: workerCount }, () => runWorker());
    await Promise.all(workers);

    job.status = 'completed';
    job.pausedUntilMs = null;
    job.finishedAt = new Date(this.nowFn()).toISOString();

    this.log.info(
      {
        jobId: job.jobId,
        total: job.total,
        done: job.done,
        accepted: job.accepted,
        rejected: job.rejected,
        error: job.error,
        invalid: job.invalid,
        rateLimitCount: job.rateLimitCount,
      },
      'Hoàn tất tiến trình gửi hàng loạt GKSK',
    );

    return toPublicProgress(job);
  }

  private pruneOldCompletedJobs(): void {
    if (this.jobs.size < MAX_JOBS_IN_MEMORY) {
      return;
    }
    for (const [id, job] of this.jobs.entries()) {
      if (job.status === 'completed') {
        this.jobs.delete(id);
        if (this.jobs.size < MAX_JOBS_IN_MEMORY) {
          break;
        }
      }
    }
  }
}

export function createJobService(options: JobServiceOptions): JobService {
  return new JobService(options);
}
