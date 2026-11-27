import { apiRequest } from './http';

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
    baseUrlHost: string;
    httpStatus: number | null;
    resCode: string | null;
    durationMinutes: number | null;
    expiresAt: string | null;
    message: string;
  };
}

export function checkSystemConnection(): Promise<SystemConnectionCheckResult> {
  return apiRequest<SystemConnectionCheckResult>(
    '/api/system/check-connection',
    {
      method: 'POST',
    },
  );
}
