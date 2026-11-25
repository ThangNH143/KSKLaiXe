import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiRequest,
  CSRF_HEADER_NAME,
  CSRF_HEADER_VALUE,
  listCertificates,
  previewExcelImport,
  setUnauthorizedHandler,
} from './index';

describe('client/src/api/http.ts — tầng gọi API chuẩn hóa', () => {
  afterEach(() => {
    setUnauthorizedHandler(null);
    vi.restoreAllMocks();
  });

  it('luôn gắn header X-Requested-With: gksk và credentials: include cho mọi request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await listCertificates({ tab: 'unsent', q: 'TEST' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/certificates?tab=unsent&q=TEST');
    expect(init?.credentials).toBe('include');
    const headers = new Headers(init?.headers);
    expect(headers.get(CSRF_HEADER_NAME)).toBe(CSRF_HEADER_VALUE);
  });

  it('gửi FormData cho upload Excel mà không ghi đè Content-Type', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ filename: 'test.xlsx', rows: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const file = new File(['PK\x03\x04'], 'test.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await previewExcelImport(file);

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/import/excel');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
    const headers = new Headers(init?.headers);
    expect(headers.get(CSRF_HEADER_NAME)).toBe(CSRF_HEADER_VALUE);
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('chuẩn hóa lỗi server thành ApiError và gọi unauthorizedHandler khi gặp HTTP 401', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Phiên đăng nhập đã hết hạn.',
          },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    await expect(apiRequest('/api/batches')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Phiên đăng nhập đã hết hạn.',
    });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('trích xuất Retry-After cho lỗi HTTP 429', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'TOO_MANY_LOGIN_ATTEMPTS',
            message: 'Bạn đã đăng nhập sai quá 10 lần.',
          },
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '900',
          },
        },
      ),
    );

    try {
      await apiRequest('/api/auth/login', {
        method: 'POST',
        body: { username: 'admin', password: 'bad' },
        skipUnauthorizedHandler: true,
      });
      expect.unreachable('Phải ném ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(429);
      expect(apiErr.code).toBe('TOO_MANY_LOGIN_ATTEMPTS');
      expect(apiErr.retryAfterSeconds).toBe(900);
    }
  });
});
