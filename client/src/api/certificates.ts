import type {
  CertificateStatus,
  GkskListFields,
  GkskRecord,
  Issue,
  ReconcileTab,
  ServerIssue,
} from '@gksk/shared';
import { apiDownload, apiRequest, type FileDownloadResult } from './http';

export interface ImportBatchItem {
  id: number;
  filename: string;
  rowCount: number;
  createdAt: string;
}

export interface ReconcileCounts {
  all: number;
  unsent: number;
  accepted: number;
  attention: number;
  ready: number;
  invalid: number;
  rejected: number;
  error: number;
  sending: number;
}

export interface SubmissionSummary {
  id: number;
  msgId: string;
  sendDatetime: number;
  attempts: number;
  httpStatus: number | null;
  resCode: string | null;
  resultStatus: 'accepted' | 'rejected' | null;
  serverSubmissionId: string | null;
  errors: ServerIssue[];
  warnings: ServerIssue[];
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface CertificateListItem {
  id: number;
  so: string;
  fields: GkskListFields;
  dataSha256: string;
  status: CertificateStatus;
  batchId: number | null;
  batchFilename: string | null;
  excelRowNumber: number | null;
  serverCertificateId: string | null;
  createdAt: string;
  updatedAt: string;
  issues: Issue[];
  latestSubmission: SubmissionSummary | null;
}

export interface CertificateListQueryParams {
  tab?: ReconcileTab;
  status?: CertificateStatus;
  batchId?: number;
  fromDate?: string;
  toDate?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface CertificateListResponse {
  items: CertificateListItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: ReconcileCounts;
}

export interface CertificateDetailResponse {
  id: number;
  so: string;
  fields: GkskRecord;
  dataSha256: string;
  status: CertificateStatus;
  batchId: number | null;
  batchFilename: string | null;
  excelRowNumber: number | null;
  batch: ImportBatchItem | null;
  serverCertificateId: string | null;
  createdAt: string;
  updatedAt: string;
  issues: Issue[];
  xml: string | null;
  latestSubmission: SubmissionSummary | null;
}

function buildQueryString(params: CertificateListQueryParams = {}): string {
  const sp = new URLSearchParams();
  if (params.tab) sp.set('tab', params.tab);
  if (params.status) sp.set('status', params.status);
  if (params.batchId !== undefined) sp.set('batchId', String(params.batchId));
  if (params.fromDate) sp.set('fromDate', params.fromDate);
  if (params.toDate) sp.set('toDate', params.toDate);
  if (params.q) sp.set('q', params.q);
  if (params.page !== undefined) sp.set('page', String(params.page));
  if (params.pageSize !== undefined) sp.set('pageSize', String(params.pageSize));
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export function listBatches(): Promise<{ items: ImportBatchItem[] }> {
  return apiRequest<{ items: ImportBatchItem[] }>('/api/batches', {
    method: 'GET',
  });
}

export function listCertificates(
  params: CertificateListQueryParams = {},
): Promise<CertificateListResponse> {
  return apiRequest<CertificateListResponse>(
    `/api/certificates${buildQueryString(params)}`,
    { method: 'GET' },
  );
}

export function getCertificateDetail(
  id: number,
): Promise<CertificateDetailResponse> {
  return apiRequest<CertificateDetailResponse>(`/api/certificates/${id}`, {
    method: 'GET',
  });
}

export function deleteCertificate(
  id: number,
): Promise<{ ok: boolean; id: number }> {
  return apiRequest<{ ok: boolean; id: number }>(`/api/certificates/${id}`, {
    method: 'DELETE',
  });
}

export function listCertificateSubmissions(
  id: number,
): Promise<{ items: SubmissionSummary[] }> {
  return apiRequest<{ items: SubmissionSummary[] }>(
    `/api/certificates/${id}/submissions`,
    { method: 'GET' },
  );
}

export function downloadCertificateXml(id: number): Promise<FileDownloadResult> {
  return apiDownload(`/api/certificates/${id}/xml`, `GKSK_${id}.xml`, {
    method: 'GET',
  });
}

export function downloadCertificatesXmlZip(
  ids: number[],
): Promise<FileDownloadResult> {
  return apiDownload('/api/certificates/xml-zip', 'GKSK_XML.zip', {
    method: 'POST',
    body: { ids },
  });
}

export function downloadReconcileExcel(
  params: CertificateListQueryParams = {},
): Promise<FileDownloadResult> {
  return apiDownload(
    `/api/certificates/export-excel${buildQueryString(params)}`,
    'GKSK_doi_soat.xlsx',
    { method: 'GET' },
  );
}
