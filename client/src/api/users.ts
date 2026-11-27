import { apiRequest } from './http';

export interface SafeUserItem {
  id: number;
  username: string;
  fullName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertUserPayload {
  username: string;
  password: string;
  fullName?: string;
  isActive?: boolean;
}

export function listUsers(): Promise<{ items: SafeUserItem[] }> {
  return apiRequest<{ items: SafeUserItem[] }>('/api/users', {
    method: 'GET',
  });
}

export function upsertUser(
  payload: UpsertUserPayload,
): Promise<{ user: SafeUserItem; created: boolean }> {
  return apiRequest<{ user: SafeUserItem; created: boolean }>('/api/users', {
    method: 'POST',
    body: payload,
  });
}

export function resetUserPassword(
  id: number,
  newPassword: string,
): Promise<{ ok: boolean; user: SafeUserItem }> {
  return apiRequest<{ ok: boolean; user: SafeUserItem }>(
    `/api/users/${id}/password`,
    {
      method: 'PATCH',
      body: { newPassword },
    },
  );
}

export function updateUserStatus(
  id: number,
  isActive: boolean,
): Promise<{ ok: boolean; user: SafeUserItem }> {
  return apiRequest<{ ok: boolean; user: SafeUserItem }>(
    `/api/users/${id}/status`,
    {
      method: 'PATCH',
      body: { isActive },
    },
  );
}
