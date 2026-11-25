import type { CertificateStatus } from '@gksk/shared';

export interface StatusBadgeProps {
  readonly status: CertificateStatus;
}

function getStatusMeta(status: CertificateStatus): {
  icon: string;
  label: string;
  className: string;
} {
  switch (status) {
    case 'ready':
      return {
        icon: '🟦',
        label: 'Chờ đẩy cổng',
        className: 'cert-badge-ready',
      };
    case 'accepted':
      return {
        icon: '✅',
        label: 'Đã đẩy thành công',
        className: 'cert-badge-accepted',
      };
    case 'invalid':
      return {
        icon: '⛔',
        label: 'Lỗi dữ liệu Excel',
        className: 'cert-badge-invalid',
      };
    case 'rejected':
      return {
        icon: '⛔',
        label: 'Cổng Sở từ chối',
        className: 'cert-badge-rejected',
      };
    case 'error':
      return {
        icon: '⚠️',
        label: 'Lỗi mạng / Cấu hình',
        className: 'cert-badge-error',
      };
    case 'sending':
    default:
      return {
        icon: '⏳',
        label: 'Đang đẩy...',
        className: 'cert-badge-sending',
      };
  }
}

/**
 * S15 — Huy hiệu hiển thị trạng thái đối soát của 1 giấy GKSK trên bảng Danh sách & Đối soát
 * theo đúng bảng `docs/ARCHITECTURE.md §8`.
 */
export function StatusBadge({ status }: StatusBadgeProps) {
  const meta = getStatusMeta(status);
  return (
    <span
      className={`status-pill ${meta.className}`}
      data-testid={`status-badge-${status}`}
    >
      <span aria-hidden="true">{meta.icon}</span> {meta.label}
    </span>
  );
}
