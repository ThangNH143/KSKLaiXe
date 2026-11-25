import type { PublicConfig } from '../api/auth';

export interface EnvBannerProps {
  config: PublicConfig | null;
}

/**
 * Banner cảnh báo môi trường SẢN XUẤT (PRODUCTION) theo ARCHITECTURE.md §7 & S13:
 * - Chỉ hiển thị banner đỏ nổi bật khi `config.appEnv === 'production'`.
 * - Ở chế độ `test` (hoặc khi chưa nạp xong cấu hình), không hiển thị banner cảnh báo đỏ.
 */
export function EnvBanner({ config }: EnvBannerProps) {
  if (!config || config.appEnv !== 'production') {
    return null;
  }

  return (
    <div
      className="prod-env-banner"
      role="alert"
      data-testid="prod-env-banner"
    >
      <div className="prod-env-banner-inner">
        <span className="prod-env-icon" aria-hidden="true">
          ⚠️
        </span>
        <div className="prod-env-copy">
          <strong>MÔI TRƯỜNG SẢN XUẤT (PRODUCTION):</strong> Mọi thao tác đẩy
          cổng sẽ ghi dữ liệu chính thức lên Hệ thống CSDL Sức khỏe Sở Y tế Đồng
          Nai. Vui lòng kiểm tra kỹ trước khi gửi.
        </div>
        <div className="prod-env-meta">
          <span className="prod-env-chip">CSYT: {config.facilityId}</span>
          <span className="prod-env-chip">{config.facilityName}</span>
          <span className="prod-env-chip">{config.baseUrlHost}</span>
        </div>
      </div>
    </div>
  );
}
