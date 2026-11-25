import type { CertificateStatus, Issue, ServerIssue } from '@gksk/shared';
import type { SubmissionSummary } from './certificates';
import { apiRequest } from './http';

export interface SafeCertificateSummary {
  id: number;
  so: string;
  status: CertificateStatus;
  serverCertificateId: string | null;
  updatedAt: string;
}

export interface SendSingleResponse {
  certificateId: number;
  so: string;
  status: CertificateStatus;
  certificate: SafeCertificateSummary;
  submission: SubmissionSummary | null;
  issues: Issue[];
  reusedPendingSubmission: boolean;
  recoveredViaStatus: boolean;
}

export interface BatchSendStartResponse {
  jobId: string;
  status: 'running' | 'completed';
  total: number;
}

export interface BatchJobItem {
  certificateId: number;
  so: string | null;
  status: 'queued' | 'sending' | 'accepted' | 'rejected' | 'invalid' | 'error';
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

export interface BatchJobProgress {
  jobId: string;
  status: 'running' | 'completed';
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

export interface RefreshSubmissionResponse {
  submission: SubmissionSummary;
  certificate: SafeCertificateSummary;
  found: boolean;
  status: 'accepted' | 'rejected' | null;
  httpStatus: number | null;
  resCode: string | null;
}

export function sendSingleCertificate(id: number): Promise<SendSingleResponse> {
  return apiRequest<SendSingleResponse>(`/api/certificates/${id}/send`, {
    method: 'POST',
  });
}

export function startBatchSend(ids: number[]): Promise<BatchSendStartResponse> {
  return apiRequest<BatchSendStartResponse>('/api/send', {
    method: 'POST',
    body: { ids },
  });
}

export function getBatchJob(jobId: string): Promise<BatchJobProgress> {
  return apiRequest<BatchJobProgress>(
    `/api/jobs/${encodeURIComponent(jobId)}`,
    { method: 'GET' },
  );
}

export function refreshSubmissionStatus(
  submissionId: number,
): Promise<RefreshSubmissionResponse> {
  return apiRequest<RefreshSubmissionResponse>(
    `/api/submissions/${submissionId}/refresh`,
    { method: 'POST' },
  );
}
