import { apiRequest } from './http';

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

export interface SystemConnectionCheckResult {
  ok: boolean;
  checkedAt: string;
  database: {
    ok: boolean;
    kind: 'in-memory' | 'mssql';
    tables: string[];
    userCount: number;
    batchCount: number;
    certificateCount: number;
    message: string;
  };
  sytGateway: {
    ok: boolean;
    facilityId: string;
    facilityName: string;
    username?: string;
    senderId?: string;
    baseUrlHost: string;
    httpStatus: number | null;
    resCode: string | null;
    resMsg?: string | null;
    durationMinutes: number | null;
    expiresAt: string | null;
    message: string;
    loginStep?: SytDiagnosticStep;
    apiPermissionStep?: SytDiagnosticStep | null;
  };
}

export interface UpdateGkskConfigPayload {
  action?: 'update' | 'reload_env';
  baseUrl?: string;
  username?: string;
  password?: string;
  senderId?: string;
  persistToEnv?: boolean;
}

export interface UpdateGkskConfigResponse {
  ok: boolean;
  reloadedFromEnv: boolean;
  envPersisted: boolean;
  config: GkskConfigSummary;
  message: string;
}

export function fetchGkskConfig(): Promise<{ config: GkskConfigSummary }> {
  return apiRequest<{ config: GkskConfigSummary }>('/api/system/gksk-config', {
    method: 'GET',
  });
}

export function updateGkskConfig(
  payload: UpdateGkskConfigPayload,
): Promise<UpdateGkskConfigResponse> {
  return apiRequest<UpdateGkskConfigResponse>('/api/system/gksk-config', {
    method: 'PUT',
    body: payload,
  });
}

export function checkSystemConnection(): Promise<SystemConnectionCheckResult> {
  return apiRequest<SystemConnectionCheckResult>(
    '/api/system/check-connection',
    {
      method: 'POST',
    },
  );
}
