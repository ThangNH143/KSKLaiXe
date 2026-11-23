import { useEffect, useState } from 'react';
import { ping } from '@gksk/shared';

type HealthState =
  | { status: 'loading' }
  | { status: 'ok'; ok: boolean }
  | { status: 'error'; message: string };

export function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });
  const sharedStatus = ping();

  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { ok?: boolean };
        if (!cancelled) {
          setHealth({ status: 'ok', ok: Boolean(data.ok) });
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Không thể kết nối máy chủ';
          setHealth({ status: 'error', message });
        }
      }
    }

    void checkHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="badge-row">
          <span className="env-pill">S0 · Khung Monorepo</span>
          <span
            className={`status-pill status-${health.status}`}
            data-testid="health-status"
          >
            {health.status === 'loading' && 'Đang kiểm tra /api/health...'}
            {health.status === 'ok' &&
              `Kết nối /api/health: Thành công ({"ok": ${String(health.ok)}}) · shared: ${sharedStatus}`}
            {health.status === 'error' && `Lỗi kết nối /api/health: ${health.message}`}
          </span>
        </div>
        <h1>GKSKLaiXe — Hệ thống Import Excel, Xuất XML &amp; Đối soát GKSK Lái xe</h1>
        <p className="subtitle">
          Nền tảng xử lý Giấy khám sức khỏe lái xe cho Cơ sở Y tế — chuẩn hóa dữ liệu từ Excel,
          xuất XML/ZIP và đẩy cổng Sở Y tế Đồng Nai.
        </p>
      </header>

      <main className="grid">
        <section className="card">
          <h2>1. Import Excel thông minh</h2>
          <p>
            Đọc file Excel theo mẫu, kiểm tra 25 thẻ BHXH, lưu đủ 100% quân số có mã{' '}
            <code>SO</code> và tự động đối chiếu ghi đè khi nạp lại.
          </p>
        </section>

        <section className="card">
          <h2>2. Kiểm tra &amp; Đối soát</h2>
          <p>
            Phân nhóm rõ ràng Chưa đẩy / Đã đẩy thành công / Cần xử lý, lọc theo đợt import và xuất
            file Excel đối soát 29 cột.
          </p>
        </section>

        <section className="card">
          <h2>3. Xuất XML lẻ &amp; Gói ZIP</h2>
          <p>
            Xem trước mã nguồn XML chuẩn <code>&lt;root&gt;</code> đủ 25 thẻ, tải lẻ{' '}
            <code>&lt;SO&gt;.xml</code> hoặc đóng gói hàng loạt thành file <code>.zip</code>.
          </p>
        </section>

        <section className="card">
          <h2>4. Đẩy cổng Sở Y tế</h2>
          <p>
            Dựng envelope theo giờ Việt Nam (UTC+7), ký gói tin SHA-256/RSA, retry an toàn giữ
            nguyên <code>msg_id</code> và tra cứu trạng thái.
          </p>
        </section>
      </main>
    </div>
  );
}
