import type { CertificateStatus, ReconcileTab } from '@gksk/shared';
import type { ReconcileCounts } from '../api';

export type AttentionSubStatus = 'invalid' | 'rejected' | 'error';

export interface ReconcileSummaryProps {
  readonly counts: ReconcileCounts;
  readonly activeTab: ReconcileTab;
  readonly attentionStatus?: AttentionSubStatus | undefined;
  readonly onSelectTab: (tab: ReconcileTab) => void;
  readonly onSelectAttentionStatus: (status?: AttentionSubStatus) => void;
}

/**
 * S15 — Thanh thẻ thống kê đối soát & 4 Tab lọc nhanh (`Tất cả`, `Chưa đẩy (Sẵn sàng)`,
 * `Đã đẩy thành công`, `Cần xử lý`) kèm bộ lọc con cho tab Cần xử lý (`Lỗi dữ liệu Excel`,
 * `Cổng Sở từ chối`, `Lỗi mạng / Cấu hình`).
 */
export function ReconcileSummary({
  counts,
  activeTab,
  attentionStatus,
  onSelectTab,
  onSelectAttentionStatus,
}: ReconcileSummaryProps) {
  const attentionTotal =
    counts.attention ?? counts.invalid + counts.rejected + counts.error;
  const readyTotal = counts.ready ?? counts.unsent;

  const tabs: ReadonlyArray<{
    key: ReconcileTab;
    id: string;
    label: string;
    count: number;
    note: string;
    tileClass: string;
  }> = [
    {
      key: 'all',
      id: 'reconcile-tab-all',
      label: 'Tất cả',
      count: counts.all,
      note: 'Khớp 100% quân số có mã SO',
      tileClass: 'tile-all',
    },
    {
      key: 'unsent',
      id: 'reconcile-tab-unsent',
      label: 'Chưa đẩy (Sẵn sàng)',
      count: readyTotal,
      note: 'Đủ điều kiện xuất XML & đẩy cổng',
      tileClass: 'tile-ready',
    },
    {
      key: 'accepted',
      id: 'reconcile-tab-accepted',
      label: 'Đã đẩy thành công',
      count: counts.accepted,
      note: 'Đã ghi nhận trên Hệ thống Sở',
      tileClass: 'tile-accepted',
    },
    {
      key: 'attention',
      id: 'reconcile-tab-attention',
      label: 'Cần xử lý',
      count: attentionTotal,
      note: `Lỗi Excel (${counts.invalid}) · Sở từ chối (${counts.rejected}) · Lỗi mạng (${counts.error})`,
      tileClass: 'tile-attention',
    },
  ];

  const subFilters: ReadonlyArray<{
    status: AttentionSubStatus | undefined;
    key: string;
    label: string;
    count: number;
  }> = [
    {
      status: undefined,
      key: 'all',
      label: 'Tất cả cần xử lý',
      count: attentionTotal,
    },
    {
      status: 'invalid',
      key: 'invalid',
      label: '⛔ Lỗi dữ liệu Excel',
      count: counts.invalid,
    },
    {
      status: 'rejected',
      key: 'rejected',
      label: '⛔ Cổng Sở từ chối',
      count: counts.rejected,
    },
    {
      status: 'error',
      key: 'error',
      label: '⚠️ Lỗi mạng / Cấu hình',
      count: counts.error,
    },
  ];

  return (
    <div className="reconcile-summary-container">
      {/* 4 thẻ thống kê số lượng đối soát */}
      <div
        className="summary-grid reconcile-cards-grid"
        aria-label="Thống kê 4 nhóm đối soát"
        data-testid="reconcile-summary-cards"
      >
        {tabs.map((item) => {
          const isSelected = activeTab === item.key;
          return (
            <div
              key={item.key}
              className={`summary-tile ${item.tileClass} ${
                isSelected ? 'summary-tile-active' : ''
              }`}
              data-testid={`reconcile-card-${item.key}`}
            >
              <span className="summary-tile-label">{item.label}</span>
              <strong
                className="summary-tile-value"
                data-testid={`reconcile-count-${item.key}`}
              >
                {item.count}
              </strong>
              <span className="summary-tile-note">{item.note}</span>
            </div>
          );
        })}
      </div>

      {/* Thanh 4 Tab lọc nhanh (tabs guide — modern-web-guidance) */}
      <div
        role="tablist"
        aria-label="Tab lọc trạng thái đối soát"
        className="reconcile-tablist"
        {...({ focusgroup: 'tablist nomemory' } as Record<string, string>)}
      >
        {tabs.map((item) => {
          const isSelected = activeTab === item.key;
          return (
            <button
              key={item.key}
              id={item.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              className="reconcile-tab-btn"
              data-testid={`tab-btn-${item.key}`}
              onClick={() => {
                onSelectTab(item.key);
              }}
              {...(isSelected
                ? ({ focusgroupstart: '' } as Record<string, string>)
                : {})}
            >
              <span className="reconcile-tab-label">{item.label}</span>
              <span className="reconcile-tab-badge">{item.count}</span>
            </button>
          );
        })}
      </div>

      {/* Bộ lọc con khi đang ở Tab Cần xử lý (attention) */}
      {activeTab === 'attention' && (
        <div
          className="attention-subfilter-bar"
          role="group"
          aria-label="Bộ lọc chi tiết nhóm Cần xử lý"
          data-testid="attention-subfilter-bar"
        >
          <span className="attention-subfilter-title">Lọc nhóm Cần xử lý:</span>
          <div className="filter-pill-group">
            {subFilters.map((sub) => {
              const isPressed = attentionStatus === sub.status;
              return (
                <button
                  key={sub.key}
                  type="button"
                  className={`filter-pill ${
                    isPressed ? 'filter-pill-active' : ''
                  }`}
                  aria-pressed={isPressed}
                  data-testid={`attention-subfilter-${sub.key}`}
                  onClick={() => {
                    onSelectAttentionStatus(sub.status);
                  }}
                >
                  <span>{sub.label}</span>
                  <span className="filter-pill-count">{sub.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export type { CertificateStatus };
