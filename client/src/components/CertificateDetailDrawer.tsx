import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  FIELDS,
  type CertificateStatus,
  type FieldSpec,
  type IssueSeverity,
} from '@gksk/shared';
import {
  ApiError,
  getCertificateDetail,
  listCertificateSubmissions,
  refreshSubmissionStatus,
  type CertificateDetailResponse,
  type SubmissionSummary,
} from '../api';
import { IssueList, type IssueListItem } from './IssueList';
import { StatusBadge } from './StatusBadge';
import { XmlPreview } from './XmlPreview';

export type DrawerTabKey = 'fields' | 'xml' | 'history';

export interface CertificateDetailDrawerProps {
  readonly certificateId: number | null;
  readonly initialTab?: DrawerTabKey;
  readonly refreshCounter?: number;
  readonly onClose: () => void;
  readonly onRequestSend?: (
    certId: number,
    so: string,
    status: CertificateStatus,
  ) => void;
  readonly onCertificateUpdated?: () => void;
}

const GENERAL_FIELDS: readonly FieldSpec[] = FIELDS.filter((f) => !f.sensitive);
const SENSITIVE_FIELDS: readonly FieldSpec[] = FIELDS.filter((f) => f.sensitive);

function formatVnDateTime(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function buildSubmissionIssues(sub: SubmissionSummary): IssueListItem[] {
  const list: IssueListItem[] = [];
  for (const err of sub.errors) {
    list.push({
      code: err.code,
      field: err.field,
      severity: 'error',
    });
  }
  for (const warn of sub.warnings) {
    const severity: IssueSeverity =
      warn.code === 'GKSK_UNSIGNED' ? 'info' : 'warning';
    list.push({
      code: warn.code,
      field: warn.field,
      severity,
    });
  }
  if (sub.resultStatus === null && sub.lastError) {
    list.push({
      code: sub.resCode ?? 'NETWORK_OR_CONFIG_ERROR',
      field: null,
      severity: 'error',
    });
  }
  return list;
}

function buildDetailCombinedIssues(
  detail: CertificateDetailResponse,
): IssueListItem[] {
  const combined: IssueListItem[] = [];
  const seen = new Set<string>();

  if (detail.latestSubmission) {
    for (const item of buildSubmissionIssues(detail.latestSubmission)) {
      const key = `${item.severity ?? 'info'}:${item.code}:${item.field ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(item);
      }
    }
  }

  for (const issue of detail.issues) {
    const key = `${issue.severity}:${issue.code}:${issue.field ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      combined.push(issue);
    }
  }

  return combined;
}

function formatFieldValue(
  spec: FieldSpec,
  rawValue: string | undefined,
): {
  displayValue: string;
  enumNote: string | null;
  isEmpty: boolean;
} {
  const val = (rawValue ?? '').trim();
  if (!val) {
    return {
      displayValue: '— (Trống)',
      enumNote: null,
      isEmpty: true,
    };
  }
  const enumLabel = spec.enumLabels?.[val] ?? null;
  return {
    displayValue: val,
    enumNote: enumLabel,
    isEmpty: false,
  };
}

/**
 * S16 — Ngăn trượt (Drawer) Chi tiết chỉ đọc mở bên phải trang Danh sách & Đối soát:
 * - Giữ nguyên bộ lọc và vị trí cuộn của bảng đối soát.
 * - Tab 1: Thông tin giấy (đủ 25 trường chỉ đọc, tách nhóm riêng 4 trường nhạy cảm `NONGDOCON`, `MATUY`, `LYDO`, `TINHTRANGBENH`) + Lỗi/Cảnh báo & hướng dẫn sửa trên Excel.
 * - Tab 2: Xem trước XML (`XmlPreview`) kèm nút Sao chép XML và Tải `<SO>.xml`.
 * - Tab 3: Lịch sử đẩy cổng (`msg_id`, thời gian, HTTP status, kết quả, `server_submission_id`, `server_certificate_id`, lỗi/cảnh báo, nút **Tra lại trạng thái**).
 */
export function CertificateDetailDrawer({
  certificateId,
  initialTab = 'fields',
  refreshCounter = 0,
  onClose,
  onRequestSend,
  onCertificateUpdated,
}: CertificateDetailDrawerProps) {
  const drawerTitleId = useId();
  const [activeTab, setActiveTab] = useState<DrawerTabKey>(initialTab);
  const [detail, setDetail] = useState<CertificateDetailResponse | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [refreshingSubId, setRefreshingSubId] = useState<number | null>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [certificateId, initialTab]);

  const loadDrawerData = useCallback(async (id: number) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [detailRes, subRes] = await Promise.all([
        getCertificateDetail(id),
        listCertificateSubmissions(id),
      ]);
      setDetail(detailRes);
      setSubmissions(Array.isArray(subRes?.items) ? subRes.items : []);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Không thể tải chi tiết giấy khám sức khỏe.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (certificateId === null) {
      setDetail(null);
      setSubmissions([]);
      setErrorMessage(null);
      setActionNotice(null);
      return;
    }
    void loadDrawerData(certificateId);
  }, [certificateId, refreshCounter, loadDrawerData]);

  // Đóng ngăn trượt bằng phím Escape khi không có modal dialog nào đang mở đè lên
  useEffect(() => {
    if (certificateId === null) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }
      const openModal = document.querySelector('dialog[open]');
      if (openModal) {
        return;
      }
      onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [certificateId, onClose]);

  const combinedIssues = useMemo(
    () => (detail ? buildDetailCombinedIssues(detail) : []),
    [detail],
  );

  const issueFieldSet = useMemo(() => {
    const tags = new Set<string>();
    for (const issue of combinedIssues) {
      if (issue.field) {
        tags.add(issue.field);
      }
      if (issue.fields) {
        for (const f of issue.fields) {
          tags.add(f);
        }
      }
    }
    return tags;
  }, [combinedIssues]);

  async function handleRefreshSubmission(sub: SubmissionSummary) {
    if (!detail) {
      return;
    }
    setRefreshingSubId(sub.id);
    setErrorMessage(null);
    setActionNotice(null);
    try {
      const res = await refreshSubmissionStatus(sub.id);
      if (res.found) {
        setActionNotice(
          `Đã tra lại trạng thái gói tin msg_id=${res.submission.msgId}: Hệ thống Sở ghi nhận kết quả "${res.status ?? 'đã xử lý'}" (HTTP ${res.httpStatus ?? 200}).`,
        );
      } else {
        setActionNotice(
          `Đã tra lại trạng thái gói tin msg_id=${res.submission.msgId}: Hệ thống Sở chưa ghi nhận gói tin này (HTTP ${res.httpStatus ?? 404}).`,
        );
      }
      await loadDrawerData(detail.id);
      onCertificateUpdated?.();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Không thể tra lại trạng thái gói tin trên Hệ thống Sở.');
      }
    } finally {
      setRefreshingSubId(null);
    }
  }

  if (certificateId === null) {
    return null;
  }

  const tabs: ReadonlyArray<{
    key: DrawerTabKey;
    id: string;
    label: string;
    badge?: number;
  }> = [
    {
      key: 'fields',
      id: 'drawer-tab-btn-fields',
      label: '📋 Thông tin giấy (25 trường)',
      badge: 25,
    },
    {
      key: 'xml',
      id: 'drawer-tab-btn-xml',
      label: '📄 Xem trước XML',
    },
    {
      key: 'history',
      id: 'drawer-tab-btn-history',
      label: '🕒 Lịch sử đẩy cổng',
      badge: submissions.length,
    },
  ];

  function renderFieldCard(spec: FieldSpec) {
    const rawValue = detail?.fields?.[spec.tag];
    const formatted = formatFieldValue(spec, rawValue);
    const hasIssue = issueFieldSet.has(spec.tag);

    return (
      <div
        key={spec.tag}
        className={`drawer-field-card ${
          spec.sensitive ? 'drawer-field-card-sensitive' : ''
        } ${hasIssue ? 'drawer-field-card-has-issue' : ''}`}
        data-testid={`drawer-field-${spec.tag}`}
      >
        <div className="drawer-field-header">
          <span className="drawer-field-order">#{spec.order}</span>
          <span className="drawer-field-label">{spec.label}</span>
          <code className="drawer-field-tag">{spec.tag}</code>
          {spec.soRequired && (
            <span
              className="drawer-field-req-badge req-so"
              title="Trường bắt buộc của Hệ thống Sở Y tế Đồng Nai"
            >
              Sở bắt buộc
            </span>
          )}
          {spec.readOnly && (
            <span
              className="drawer-field-req-badge req-readonly"
              title="Tự điền từ cấu hình CSYT trên máy chủ"
            >
              Tự điền
            </span>
          )}
          {spec.sensitive && (
            <span
              className="drawer-field-req-badge req-sensitive"
              title="Trường nhạy cảm — ẩn trên bảng Danh sách đối soát"
            >
              🔒 Nhạy cảm
            </span>
          )}
        </div>

        <div
          className={`drawer-field-value ${
            formatted.isEmpty ? 'drawer-field-value-empty' : ''
          }`}
          data-testid={`drawer-field-value-${spec.tag}`}
        >
          <span>{formatted.displayValue}</span>
          {formatted.enumNote && (
            <span className="drawer-field-enum-note">
              ({formatted.enumNote})
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="drawer-overlay-root"
      data-testid="certificate-detail-drawer"
    >
      {/* Lớp nền mờ bên trái — bấm ra ngoài để đóng Drawer mà không mất vị trí cuộn của bảng */}
      <div
        className="drawer-backdrop"
        data-testid="drawer-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className="drawer-sheet"
        aria-labelledby={drawerTitleId}
        data-testid="drawer-sheet"
      >
        {/* Đầu ngăn trượt */}
        <header className="drawer-header">
          <div className="drawer-header-top">
            <div className="drawer-title-group">
              <span className="drawer-eyebrow">
                Chi tiết Giấy khám sức khỏe (Chỉ đọc)
              </span>
              <div className="drawer-title-row">
                <h2 id={drawerTitleId} className="drawer-title">
                  Số giấy:{' '}
                  <code data-testid="drawer-cert-so">
                    {detail?.so ?? `#${certificateId}`}
                  </code>
                </h2>
                {detail && <StatusBadge status={detail.status} />}
              </div>
            </div>

            <div className="drawer-header-actions">
              {detail && detail.status !== 'invalid' && onRequestSend && (
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={detail.status === 'sending'}
                  data-testid="drawer-send-btn"
                  onClick={() => {
                    onRequestSend(detail.id, detail.so, detail.status);
                  }}
                >
                  {detail.status === 'error' ? '🔄 Gửi lại' : '🚀 Đẩy cổng'}
                </button>
              )}

              <button
                type="button"
                className="btn-secondary btn-sm"
                data-testid="drawer-close-btn"
                onClick={onClose}
                aria-label="Đóng ngăn trượt chi tiết"
              >
                ✕ Đóng
              </button>
            </div>
          </div>

          {detail && (
            <div className="drawer-meta-bar" data-testid="drawer-meta-bar">
              <span>
                Họ tên: <strong>{detail.fields.HOTEN || '—'}</strong>
              </span>
              <span>
                Ngày sinh: <strong>{detail.fields.NGAYSINH || '—'}</strong>
              </span>
              <span>
                Kết luận: <code>{detail.fields.KETLUAN || '—'}</code>
              </span>
              {detail.batchFilename && (
                <span>
                  Đợt import:{' '}
                  <strong>
                    #{detail.batchId} — {detail.batchFilename}
                  </strong>
                  {detail.excelRowNumber !== null
                    ? ` (Dòng Excel #${detail.excelRowNumber})`
                    : ''}
                </span>
              )}
              <span>
                ID giấy trên Sở (<code>server_certificate_id</code>):{' '}
                <code data-testid="drawer-server-cert-id">
                  {detail.serverCertificateId ?? 'Chưa cấp'}
                </code>
              </span>
            </div>
          )}

          {/* Thanh 3 Tab trong Drawer (tabs guide — modern-web-guidance) */}
          <div
            role="tablist"
            aria-label="Các tab thông tin chi tiết giấy khám sức khỏe"
            className="reconcile-tablist drawer-tablist"
            {...({ focusgroup: 'tablist nomemory' } as Record<string, string>)}
          >
            {tabs.map((tab) => {
              const isSelected = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  id={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  className="reconcile-tab-btn"
                  data-testid={tab.id}
                  onClick={() => {
                    setActiveTab(tab.key);
                  }}
                  {...(isSelected
                    ? ({ focusgroupstart: '' } as Record<string, string>)
                    : {})}
                >
                  <span>{tab.label}</span>
                  {tab.badge !== undefined && (
                    <span className="reconcile-tab-badge">{tab.badge}</span>
                  )}
                </button>
              );
            })}
          </div>
        </header>

        {/* Nội dung cuộn độc lập bên trong Drawer */}
        <div className="drawer-body">
          {actionNotice && (
            <div
              className="alert-banner alert-info"
              role="status"
              data-testid="drawer-action-notice"
            >
              {actionNotice}
            </div>
          )}

          {errorMessage && (
            <div
              className="alert-banner alert-error"
              role="alert"
              data-testid="drawer-error-banner"
            >
              {errorMessage}
            </div>
          )}

          {loading && !detail ? (
            <div
              className="empty-preview-box"
              role="status"
              data-testid="drawer-loading"
            >
              Đang tải dữ liệu chi tiết 25 trường và lịch sử đẩy cổng...
            </div>
          ) : detail ? (
            <>
              {/* TAB 1: Thông tin giấy (25 trường chỉ đọc) & Lỗi/Cảnh báo */}
              <div
                role="tabpanel"
                aria-labelledby="drawer-tab-btn-fields"
                hidden={activeTab !== 'fields'}
                data-testid="drawer-panel-fields"
              >
                <div className="drawer-tabpanel-inner">
                  {/* Khối Lỗi & Cảnh báo + Hướng dẫn sửa trên file Excel */}
                  <section
                    className="drawer-section drawer-issues-section"
                    aria-label="Chi tiết lỗi, cảnh báo và hướng dẫn chỉnh sửa"
                    data-testid="drawer-issues-section"
                  >
                    <h3 className="drawer-section-title">
                      1. Kiểm tra dữ liệu &amp; Phản hồi từ Hệ thống Sở
                    </h3>

                    <IssueList
                      issues={combinedIssues}
                      emptyText="✅ Dữ liệu giấy hợp lệ 100%, không có lỗi hoặc cảnh báo."
                    />

                    <div
                      className={`drawer-excel-guide ${
                        detail.status === 'invalid' ||
                        detail.status === 'rejected'
                          ? 'drawer-excel-guide-urgent'
                          : ''
                      }`}
                      data-testid="drawer-excel-edit-guide"
                    >
                      <strong>💡 Hướng dẫn sửa dữ liệu (Quy trình chuẩn):</strong>{' '}
                      Để sửa dữ liệu, vui lòng chỉnh trên{' '}
                      <strong>file Excel gốc</strong> (hoặc bấm{' '}
                      <strong>Xuất Excel đối soát (29 cột)</strong> để sửa trực tiếp
                      trên file đối soát) rồi <strong>Import lại</strong> — hệ thống
                      sẽ tự động ghi đè thông minh theo Số giấy (<code>SO</code>).
                    </div>
                  </section>

                  {/* Nhóm riêng 4 trường nhạy cảm (NONGDOCON, MATUY, LYDO, TINHTRANGBENH) */}
                  <section
                    className="drawer-section drawer-sensitive-section"
                    aria-label="Nhóm 4 trường thông tin y tế nhạy cảm"
                    data-testid="drawer-sensitive-fields-group"
                  >
                    <div className="drawer-sensitive-header">
                      <h3 className="drawer-section-title">
                        2. 🔒 Nhóm 4 trường thông tin y tế nhạy cảm (Chỉ hiển thị trong Drawer)
                      </h3>
                      <p className="drawer-section-desc">
                        Các trường <code>NONGDOCON</code>, <code>MATUY</code>,{' '}
                        <code>LYDO</code>, <code>TINHTRANGBENH</code> được bảo vệ
                        theo quy tắc bảo mật PII: không hiển thị ở bảng Danh sách
                        đối soát bên ngoài và không bao giờ ghi vào log hệ thống.
                      </p>
                    </div>

                    <div className="drawer-fields-grid drawer-sensitive-grid">
                      {SENSITIVE_FIELDS.map((spec) => renderFieldCard(spec))}
                    </div>
                  </section>

                  {/* Nhóm 21 trường thông tin hành chính, khám & kết luận */}
                  <section
                    className="drawer-section"
                    aria-label="21 trường thông tin hành chính, khám và kết luận"
                    data-testid="drawer-general-fields-group"
                  >
                    <h3 className="drawer-section-title">
                      3. Thông tin hành chính, khám &amp; kết luận (21 trường)
                    </h3>
                    <div className="drawer-fields-grid">
                      {GENERAL_FIELDS.map((spec) => renderFieldCard(spec))}
                    </div>
                  </section>
                </div>
              </div>

              {/* TAB 2: Xem trước XML (XmlPreview) */}
              <div
                role="tabpanel"
                aria-labelledby="drawer-tab-btn-xml"
                hidden={activeTab !== 'xml'}
                data-testid="drawer-panel-xml"
              >
                <div className="drawer-tabpanel-inner">
                  <XmlPreview
                    certificateId={detail.id}
                    so={detail.so}
                    status={detail.status}
                    xml={detail.xml}
                    dataSha256={detail.dataSha256}
                  />
                </div>
              </div>

              {/* TAB 3: Lịch sử đẩy cổng */}
              <div
                role="tabpanel"
                aria-labelledby="drawer-tab-btn-history"
                hidden={activeTab !== 'history'}
                data-testid="drawer-panel-history"
              >
                <div className="drawer-tabpanel-inner">
                  <div className="drawer-history-summary">
                    <div>
                      Số giấy: <code>{detail.so}</code> · Tổng số bản ghi gói tin (
                      <code>msg_id</code>): <strong>{submissions.length}</strong>
                    </div>
                    <div>
                      <code>server_certificate_id</code>:{' '}
                      <code data-testid="history-server-cert-id">
                        {detail.serverCertificateId ?? 'Chưa có'}
                      </code>
                    </div>
                  </div>

                  {submissions.length === 0 ? (
                    <div
                      className="empty-preview-box"
                      data-testid="drawer-history-empty"
                    >
                      Giấy khám sức khỏe này chưa có lịch sử đẩy cổng nào.
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table
                        className="preview-table drawer-submissions-table"
                        data-testid="drawer-submissions-table"
                      >
                        <thead>
                          <tr>
                            <th scope="col">Mã gói tin (msg_id) &amp; Số lần gửi</th>
                            <th scope="col">Thời gian gửi (UTC+7)</th>
                            <th scope="col">HTTP &amp; Kết quả</th>
                            <th scope="col">
                              server_submission_id &amp; server_certificate_id
                            </th>
                            <th scope="col">Chi tiết lỗi / cảnh báo</th>
                            <th scope="col">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {submissions.map((sub) => {
                            const subIssues = buildSubmissionIssues(sub);
                            return (
                              <tr
                                key={sub.id}
                                data-testid={`drawer-submission-row-${sub.id}`}
                              >
                                <td>
                                  <div className="sub-msgid-cell">
                                    <code
                                      className="sub-msgid-code"
                                      data-testid={`sub-msgid-${sub.id}`}
                                    >
                                      {sub.msgId}
                                    </code>
                                    <div className="sub-attempt-badges">
                                      <span
                                        className="status-pill conflict-badge-new"
                                        data-testid={`sub-attempts-${sub.id}`}
                                      >
                                        Số lần thử: {sub.attempts}
                                      </span>
                                      {sub.attempts > 1 && (
                                        <span
                                          className="status-pill data-badge-valid"
                                          data-testid={`sub-same-msgid-badge-${sub.id}`}
                                        >
                                          🔄 Giữ nguyên msg_id khi gửi lại
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </td>

                                <td>
                                  <div className="sub-time-cell">
                                    <div>
                                      Gửi: <strong>{formatVnDateTime(sub.sendDatetime)}</strong>
                                    </div>
                                    {sub.finishedAt && (
                                      <span className="cert-sub-meta">
                                        Xong: {formatVnDateTime(sub.finishedAt)}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                <td>
                                  <div className="sub-result-cell">
                                    <div>
                                      HTTP{' '}
                                      <code data-testid={`sub-http-${sub.id}`}>
                                        {sub.httpStatus ?? '—'}
                                      </code>
                                      {sub.resCode ? (
                                        <>
                                          {' '}
                                          · <code>{sub.resCode}</code>
                                        </>
                                      ) : null}
                                    </div>
                                    <div>
                                      {sub.resultStatus === 'accepted' ? (
                                        <span
                                          className="status-pill cert-badge-accepted"
                                          data-testid={`sub-result-${sub.id}`}
                                        >
                                          ✅ accepted
                                        </span>
                                      ) : sub.resultStatus === 'rejected' ? (
                                        <span
                                          className="status-pill cert-badge-rejected"
                                          data-testid={`sub-result-${sub.id}`}
                                        >
                                          ⛔ rejected
                                        </span>
                                      ) : (
                                        <span
                                          className="status-pill cert-badge-error"
                                          data-testid={`sub-result-${sub.id}`}
                                        >
                                          ⚠️ Chưa hoàn tất / Lỗi mạng
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </td>

                                <td>
                                  <div className="sub-ids-cell">
                                    <div>
                                      Sub ID:{' '}
                                      <code data-testid={`sub-server-sub-id-${sub.id}`}>
                                        {sub.serverSubmissionId ?? '—'}
                                      </code>
                                    </div>
                                    <div>
                                      Cert ID:{' '}
                                      <code data-testid={`sub-server-cert-id-${sub.id}`}>
                                        {detail.serverCertificateId ?? '—'}
                                      </code>
                                    </div>
                                  </div>
                                </td>

                                <td>
                                  {sub.lastError && sub.resultStatus === null && (
                                    <div
                                      className="sub-last-error-text"
                                      data-testid={`sub-last-error-${sub.id}`}
                                    >
                                      {sub.lastError}
                                    </div>
                                  )}
                                  <IssueList
                                    issues={subIssues}
                                    compact
                                    emptyText="✅ Không có lỗi/cảnh báo"
                                  />
                                </td>

                                <td>
                                  <button
                                    type="button"
                                    className="btn-secondary btn-sm"
                                    disabled={refreshingSubId === sub.id}
                                    data-testid={`drawer-refresh-sub-btn-${sub.id}`}
                                    onClick={() => {
                                      void handleRefreshSubmission(sub);
                                    }}
                                  >
                                    {refreshingSubId === sub.id
                                      ? 'Đang tra...'
                                      : '🔍 Tra lại trạng thái'}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
