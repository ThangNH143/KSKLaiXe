import { apiRequest } from './http';

export type AppEnv = 'test' | 'production';

export interface PublicConfig {
  appEnv: AppEnv;
  facilityId: string;
  facilityName: string;
  baseUrlHost: string;
}

export interface AuthUser {
  username: string;
}

export interface AuthSessionResponse {
  authenticated: true;
  user: AuthUser;
  isSystemAdmin?: boolean;
  expiresAt: string;
}

/**
 * Danh sách 3 tài khoản quản trị hệ thống được phép truy cập chức năng
 * Hệ thống & Tài khoản và Cấu hình nóng Tài khoản CSYT trên Cổng MasterFlow Sở Y tế.
 */
export const SYSTEM_ADMIN_USERNAMES = ['admin', 'thangnh', 'kienvd'] as const;

const SYSTEM_ADMIN_SET = new Set<string>(SYSTEM_ADMIN_USERNAMES);

export function isSystemAdminUsername(
  username: string | undefined | null,
): boolean {
  if (typeof username !== 'string') {
    return false;
  }
  return SYSTEM_ADMIN_SET.has(username.trim().toLowerCase());
}

export interface HealthResponse {
  ok: boolean;
}

export function fetchHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/api/health', {
    method: 'GET',
    skipUnauthorizedHandler: true,
  });
}

export function fetchPublicConfig(): Promise<PublicConfig> {
  return apiRequest<PublicConfig>('/api/config', {
    method: 'GET',
    skipUnauthorizedHandler: true,
  });
}

export function fetchCurrentUser(): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>('/api/auth/me', {
    method: 'GET',
    skipUnauthorizedHandler: true,
  });
}

export function login(
  username: string,
  password: string,
): Promise<AuthSessionResponse> {
  return apiRequest<AuthSessionResponse>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    skipUnauthorizedHandler: true,
  });
}

export function logout(): Promise<{ ok: boolean }> {
  return apiRequest<{ ok: boolean }>('/api/auth/logout', {
    method: 'POST',
    skipUnauthorizedHandler: true,
  });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; message: string }> {
  return apiRequest<{ ok: boolean; message: string }>(
    '/api/auth/change-password',
    {
      method: 'POST',
      body: { currentPassword, newPassword },
    },
  );
}
