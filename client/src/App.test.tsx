import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hiển thị tiêu đề hệ thống và trạng thái /api/health thành công', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    render(<App />);

    expect(
      screen.getByRole('heading', {
        name: /GKSKLaiXe — Hệ thống Import Excel, Xuất XML & Đối soát GKSK Lái xe/i,
      }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('health-status')).toHaveTextContent(
        'Kết nối /api/health: Thành công ({"ok": true}) · shared: pong',
      );
    });
  });
});
