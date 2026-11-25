import { formatIssueMessage, type Issue, type IssueSeverity } from '@gksk/shared';

export interface IssueListItem {
  readonly code: string;
  readonly field?: string | null;
  readonly fields?: readonly string[];
  readonly severity?: IssueSeverity;
}

export interface IssueListProps {
  readonly issues: readonly (Issue | IssueListItem)[];
  readonly emptyText?: string;
  readonly compact?: boolean;
}

function getSeverityMeta(severity: IssueSeverity = 'info'): {
  icon: string;
  label: string;
  className: string;
} {
  switch (severity) {
    case 'error':
      return {
        icon: '⛔',
        label: 'Lỗi chặn',
        className: 'issue-item-error',
      };
    case 'warning':
      return {
        icon: '⚠️',
        label: 'Cảnh báo',
        className: 'issue-item-warning',
      };
    case 'info':
    default:
      return {
        icon: 'ℹ️',
        label: 'Thông tin',
        className: 'issue-item-info',
      };
  }
}

/**
 * Hiển thị danh sách lỗi chặn (⛔), cảnh báo (⚠️) và thông tin (ℹ️) bằng tiếng Việt có dấu.
 * Dùng cho bảng xem trước Import Excel (S14), bảng Danh sách & Đối soát (S15) và Drawer chi tiết (S16).
 */
export function IssueList({
  issues,
  emptyText = 'Không có lỗi hoặc cảnh báo',
  compact = false,
}: IssueListProps) {
  if (!issues || issues.length === 0) {
    return <span className="issue-empty-text">{emptyText}</span>;
  }

  return (
    <ul
      className={`issue-list ${compact ? 'issue-list-compact' : ''}`}
      role="list"
    >
      {issues.map((issue, idx) => {
        const severity = issue.severity ?? 'info';
        const meta = getSeverityMeta(severity);
        const message = formatIssueMessage(issue);
        const key = `${issue.code}-${issue.field ?? 'all'}-${idx}`;

        return (
          <li
            key={key}
            className={`issue-item ${meta.className}`}
            data-testid={`issue-item-${issue.code}`}
          >
            <span className="issue-icon" aria-hidden="true">
              {meta.icon}
            </span>
            <span className="visually-hidden">{meta.label}: </span>
            <div className="issue-body">
              <code className="issue-code">{issue.code}</code>
              <span className="issue-text">{message}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
