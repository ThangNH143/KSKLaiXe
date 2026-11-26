/// <reference types="vite/client" />

export const CSRF_HEADER_NAME = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'gksk';

function getViteEnvBasePath(): string | undefined {
  return import.meta.env.VITE_BASE_PATH || import.meta.env.BASE_URL;
}

/**
 * Chuẩn hóa tiền tố subpath từ `VITE_BASE_PATH` / `BASE_URL` (ví dụ `"/KSKLaiXe/"` -> `"/KSKLaiXe"`, `"/"` -> `""`).
 */
export function normalizeBasePathPrefix(rawBase?: string): string {
  const trimmed = (rawBase ?? '').trim();
  if (!trimmed || trimmed === '/') {
    return '';
  }
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.replace(/\/+$/, '');
}

/**
 * Trả về `basename` cho `<BrowserRouter>` của React Router:
 * - Khi chạy ở gốc `/`: trả về `undefined`
 * - Khi chạy dưới Subpath IIS (vd `VITE_BASE_PATH=/KSKLaiXe`): trả về `"/KSKLaiXe"`
 */
export function resolveRouterBasename(rawBase?: string): string | undefined {
  const envBase = rawBase ?? getViteEnvBasePath();
  const prefix = normalizeBasePathPrefix(envBase);
  return prefix.length > 0 ? prefix : undefined;
}

/**
 * Gắn tiền tố Subpath (nếu có) vào đường dẫn `/api/...` để hỗ trợ chạy dưới thư mục con của IIS
 * (ví dụ `VITE_BASE_PATH=/KSKLaiXe` + `"/api/health"` -> `"/KSKLaiXe/api/health"`).
 * Khi chạy mặc định ở gốc `/`, giữ nguyên `"/api/health"`.
 */
export function resolveApiUrl(apiPath: string, rawBase?: string): string {
  if (/^https?:\/\//i.test(apiPath)) {
    return apiPath;
  }
  const envBase = rawBase ?? getViteEnvBasePath();
  const prefix = normalizeBasePathPrefix(envBase);
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  if (!prefix) {
    return normalizedPath;
  }
  if (
    normalizedPath === prefix ||
    normalizedPath.startsWith(`${prefix}/`)
  ) {
    return normalizedPath;
  }
  return `${prefix}${normalizedPath}`;
}

export interface StructuredApiErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

/**
 * Lỗi chuẩn hóa cho tầng gọi API phía client (ARCHITECTURE.md §4).
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = retryAfterSeconds;
    }
  }
}

export type UnauthorizedHandler = (error: ApiError) => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Đăng ký callback xử lý toàn cục khi API trả HTTP 401 (chuyển về trang đăng nhập).
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Bỏ qua callback tự chuyển về trang đăng nhập khi nhận 401 (dùng cho /api/auth/me hoặc /api/auth/login). */
  skipUnauthorizedHandler?: boolean;
}

function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (!raw) {
    return undefined;
  }
  const seconds = Number.parseInt(raw.trim(), 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds;
  }
  return undefined;
}

async function buildApiErrorFromResponse(res: Response): Promise<ApiError> {
  const retryAfter = parseRetryAfter(res);
  let code = `HTTP_${res.status}`;
  let message =
    res.status === 401
      ? 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.'
      : res.status === 403
        ? 'Yêu cầu bị từ chối bởi chính sách bảo mật (HTTP 403).'
        : res.status === 429
          ? 'Bạn thao tác quá nhiều lần. Vui lòng thử lại sau ít phút.'
          : `Yêu cầu thất bại (HTTP ${res.status}).`;

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const parsed = (await res.json()) as StructuredApiErrorBody;
      if (typeof parsed?.error?.code === 'string' && parsed.error.code.trim()) {
        code = parsed.error.code.trim();
      }
      if (
        typeof parsed?.error?.message === 'string' &&
        parsed.error.message.trim()
      ) {
        message = parsed.error.message.trim();
      }
    } catch {
      // Giữ nguyên thông điệp mặc định nếu JSON phản hồi không hợp lệ
    }
  }

  return new ApiError(res.status, code, message, retryAfter);
}

function buildFetchInit(options: ApiRequestOptions = {}): RequestInit {
  const method = options.method ?? 'GET';
  const headers = new Headers(options.headers);
  headers.set(CSRF_HEADER_NAME, CSRF_HEADER_VALUE);

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (typeof options.body === 'string') {
      body = options.body;
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    } else {
      body = JSON.stringify(options.body);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }
  }

  const init: RequestInit = {
    method,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body } : {}),
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  };

  return init;
}

/**
 * Gửi yêu cầu JSON tới backend `/api/*`:
 * - Luôn gắn cookie phiên (`credentials: 'include'`) và header CSRF `X-Requested-With: gksk`.
 * - Chuẩn hóa lỗi về `ApiError`.
 * - Tự động gọi `unauthorizedHandler` khi gặp HTTP 401 (trừ khi bật `skipUnauthorizedHandler`).
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const targetUrl = resolveApiUrl(path);
  let response: Response;
  try {
    response = await fetch(targetUrl, buildFetchInit(options));
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Không thể kết nối tới máy chủ ứng dụng. Vui lòng kiểm tra kết nối mạng.',
    );
  }

  if (!response.ok) {
    const apiErr = await buildApiErrorFromResponse(response);
    if (apiErr.status === 401 && !options.skipUnauthorizedHandler) {
      unauthorizedHandler?.(apiErr);
    }
    throw apiErr;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  return (await response.text()) as unknown as T;
}

export interface FileDownloadResult {
  blob: Blob;
  fileName: string;
}

function extractFileNameFromDisposition(
  headerValue: string | null,
  fallbackName: string,
): string {
  if (!headerValue) {
    return fallbackName;
  }

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(headerValue);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }

  const basicMatch = /filename="([^"]+)"/i.exec(headerValue);
  if (basicMatch?.[1]) {
    return basicMatch[1].trim();
  }

  return fallbackName;
}

/**
 * Gửi yêu cầu tải file nhị phân (`.xml`, `.zip`, `.xlsx`) kèm cookie phiên & header CSRF.
 */
export async function apiDownload(
  path: string,
  fallbackFileName: string,
  options: ApiRequestOptions = {},
): Promise<FileDownloadResult> {
  const targetUrl = resolveApiUrl(path);
  let response: Response;
  try {
    response = await fetch(targetUrl, buildFetchInit(options));
  } catch {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Không thể kết nối tới máy chủ để tải tệp tin.',
    );
  }

  if (!response.ok) {
    const apiErr = await buildApiErrorFromResponse(response);
    if (apiErr.status === 401 && !options.skipUnauthorizedHandler) {
      unauthorizedHandler?.(apiErr);
    }
    throw apiErr;
  }

  const blob = await response.blob();
  const fileName = extractFileNameFromDisposition(
    response.headers.get('content-disposition'),
    fallbackFileName,
  );
  return { blob, fileName };
}
