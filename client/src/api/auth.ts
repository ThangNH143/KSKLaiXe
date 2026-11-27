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
  expiresAt: string;
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
