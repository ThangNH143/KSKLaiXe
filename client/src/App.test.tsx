import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CSRF_HEADER_NAME,
  CSRF_HEADER_VALUE,
  listCertificates,
  setUnauthorizedHandler,
  type PublicConfig,
} from './api';
import { App } from './App';
import { EnvBanner } from './components/EnvBanner';

const TEST_CONFIG: PublicConfig = {
  appEnv: 'test',
  facilityId: '75001',
  facilityName: 'Benh vien Da khoa Dong Nai',
  baseUrlHost: '127.0.0.1:4010',
};

const PROD_CONFIG: PublicConfig = {
  appEnv: 'production',
  facilityId: '75001',
  facilityName: 'Benh vien Da khoa Dong Nai',
  baseUrlHost: 'gksk.dongnai.gov.vn',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('S13 — EnvBanner, LoginPage và khung ứng dụng (App Shell)', () => {
  afterEach(() => {
    setUnauthorizedHandler(null);
    vi.restoreAllMocks();
  });

  it('1. EnvBanner hiển thị banner đỏ khi appEnv=production và KHÔNG hiển thị khi appEnv=test', () => {
    const { rerender } = render(<EnvBanner config={TEST_CONFIG} />);
    expect(screen.queryByTestId('prod-env-banner')).not.toBeInTheDocument();

    rerender(<EnvBanner config={PROD_CONFIG} />);
    const banner = screen.getByTestId('prod-env-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('role', 'alert');
    expect(banner).toHaveTextContent('MÔI TRƯỜNG SẢN XUẤT (PRODUCTION)');
    expect(banner).toHaveTextContent('75001');
    expect(banner).toHaveTextContent('Benh vien Da khoa Dong Nai');
  });

  it('2. Luồng đăng nhập sai báo lỗi rõ ràng, đăng nhập đúng vào trang Danh sách & Đối soát với đúng 2 mục menu (không có Nhập liệu)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/config') {
          return jsonResponse(TEST_CONFIG, 200);
        }
        if (url === '/api/auth/me') {
          return jsonResponse(
            { error: { code: 'UNAUTHORIZED', message: 'Chưa đăng nhập.' } },
            401,
          );
        }
        if (url === '/api/auth/login') {
          const headers = new Headers(init?.headers);
          expect(headers.get(CSRF_HEADER_NAME)).toBe(CSRF_HEADER_VALUE);
          const body = JSON.parse(String(init?.body ?? '{}')) as {
            username?: string;
            password?: string;
          };
          if (body.username === 'admin' && body.password === 'correct-pass') {
            return jsonResponse(
              {
                authenticated: true,
                user: { username: 'admin' },
                expiresAt: '2026-11-25T17:00:00.000Z',
              },
              200,
            );
          }
          return jsonResponse(
            {
              error: {
                code: 'INVALID_CREDENTIALS',
                message: 'Tên đăng nhập hoặc mật khẩu không đúng.',
              },
            },
            401,
          );
        }
        return jsonResponse({ ok: true }, 200);
      });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    // Chưa đăng nhập -> tự chuyển về trang Đăng nhập và hiển thị mã CSYT
    const loginHeading = await screen.findByRole('heading', {
      name: /Đăng nhập GKSKLaiXe/i,
    });
    expect(loginHeading).toBeInTheDocument();
    expect(screen.getByTestId('login-facility-info')).toHaveTextContent('75001');
    expect(screen.queryByTestId('prod-env-banner')).not.toBeInTheDocument();

    // Thử sai mật khẩu -> hiển thị thông báo lỗi
    fireEvent.change(screen.getByLabelText('Tên đăng nhập'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText('Mật khẩu'), {
      target: { value: 'wrong-pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    const errBox = await screen.findByTestId('login-error');
    expect(errBox).toHaveTextContent('Tên đăng nhập hoặc mật khẩu không đúng.');

    // Nhập đúng mật khẩu -> vào trang Danh sách & Đối soát
    fireEvent.change(screen.getByLabelText('Mật khẩu'), {
      target: { value: 'correct-pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    const mainHeading = await screen.findByRole('heading', {
      name: /Danh sách & Đối soát GKSK Lái xe/i,
    });
    expect(mainHeading).toBeInTheDocument();
    expect(screen.getByTestId('header-facility-info')).toHaveTextContent('75001');
    expect(screen.getByTestId('current-username')).toHaveTextContent('admin');
    expect(screen.queryByTestId('prod-env-banner')).not.toBeInTheDocument();

    // Kiểm tra thanh điều hướng chỉ có đúng 2 mục: Danh sách & Đối soát (/) và Import Excel (/import)
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    const navLinks = Array.from(nav.querySelectorAll('a'));
    expect(navLinks).toHaveLength(2);
    expect(navLinks[0]).toHaveTextContent('Danh sách & Đối soát');
    expect(navLinks[0]).toHaveAttribute('aria-current', 'page');
    expect(navLinks[1]).toHaveTextContent('Import Excel');
    expect(nav.textContent).not.toMatch(/Nhập liệu/i);

    // Chuyển sang trang Import Excel
    fireEvent.click(navLinks[1]!);
    expect(
      await screen.findByRole('heading', { name: /Import Excel GKSK Lái xe/i }),
    ).toBeInTheDocument();
    expect(navLinks[1]).toHaveAttribute('aria-current', 'page');

    expect(fetchSpy).toHaveBeenCalled();
  });

  it('3. Khi phiên hết hạn (HTTP 401 từ API nghiệp vụ) tự động chuyển về trang đăng nhập và hiển thị thông báo', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/config') {
        return jsonResponse(PROD_CONFIG, 200);
      }
      if (url === '/api/auth/me') {
        return jsonResponse(
          {
            authenticated: true,
            user: { username: 'admin' },
            expiresAt: '2026-11-25T17:00:00.000Z',
          },
          200,
        );
      }
      if (url.startsWith('/api/certificates')) {
        return jsonResponse(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Phiên đăng nhập đã hết hạn.',
            },
          },
          401,
        );
      }
      return jsonResponse({ ok: true }, 200);
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    // Đang ở trang chính và ở chế độ production -> banner đỏ phải hiển thị
    expect(
      await screen.findByRole('heading', {
        name: /Danh sách & Đối soát GKSK Lái xe/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('prod-env-banner')).toBeInTheDocument();

    // Một lời gọi API nghiệp vụ trả HTTP 401 -> tự động quay về trang đăng nhập
    await act(async () => {
      await expect(listCertificates()).rejects.toMatchObject({ status: 401 });
    });

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /Đăng nhập GKSKLaiXe/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId('session-notice')).toHaveTextContent(
      'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    );
    expect(screen.getByTestId('prod-env-banner')).toBeInTheDocument();
  });
});
