import type {
  CertificateStatus,
  ConflictMode,
  FieldTag,
  GkskRecord,
  Issue,
} from '@gksk/shared';
import type { ImportBatchItem } from './certificates';
import { apiDownload, apiRequest, type FileDownloadResult } from './http';

export interface ImportPreviewRow {
  rowNumber: number;
  so: string;
  fields: GkskRecord;
  dataSha256: string;
  status: 'ready' | 'invalid';
  conflictMode: ConflictMode;
  canCommit: boolean;
  defaultSelected: boolean;
  existingCertificateId: number | null;
  existingStatus: CertificateStatus | null;
  issues: Issue[];
}

export interface ImportPreviewSummary {
  totalRows: number;
  readyCount: number;
  invalidCount: number;
  newCount: number;
  overwritePendingCount: number;
  acceptedUnchangedCount: number;
  acceptedModifiedCount: number;
  missingSoCount: number;
  defaultSelectedCount: number;
}

export interface ImportPreviewResponse {
  filename: string;
  sheetName: string;
  matchedColumns: FieldTag[];
  ignoredColumns: string[];
  summary: ImportPreviewSummary;
  rows: ImportPreviewRow[];
}

export interface CommitImportRowInput {
  rowNumber?: number | null;
  fields: GkskRecord;
  selected: boolean;
}

export interface CommitImportPayload {
  filename: string;
  rows: CommitImportRowInput[];
}

export interface CommitImportResponse {
  batch: ImportBatchItem;
  totalCommitted: number;
  inserted: number;
  updated: number;
  readyCount: number;
  invalidCount: number;
  skippedCount: number;
}

export function downloadImportTemplate(): Promise<FileDownloadResult> {
  return apiDownload('/api/import/template', 'GKSK_mau_nhap_lieu.xlsx', {
    method: 'GET',
  });
}

export function previewExcelImport(file: File): Promise<ImportPreviewResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return apiRequest<ImportPreviewResponse>('/api/import/excel', {
    method: 'POST',
    body: formData,
  });
}

export function commitExcelImport(
  payload: CommitImportPayload,
): Promise<CommitImportResponse> {
  return apiRequest<CommitImportResponse>('/api/import/commit', {
    method: 'POST',
    body: payload,
  });
}
