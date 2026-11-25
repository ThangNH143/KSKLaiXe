import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { IssueSeverity, ReconcileTab } from '@gksk/shared';
import {
  ApiError,
  downloadCertificateXml,
  downloadCertificatesXmlZip,
  downloadReconcileExcel,
  listBatches,
  listCertificates,
  type CertificateListItem,
  type CertificateListQueryParams,
  type ImportBatchItem,
  type PublicConfig,
  type ReconcileCounts,
} from '../api';
import { IssueList, type IssueListItem } from '../components/IssueList';
import {
  ReconcileSummary,
  type AttentionSubStatus,
} from '../components/ReconcileSummary';
import { StatusBadge } from '../components/StatusBadge';

const EMPTY_COUNTS: ReconcileCounts = {
  all: 0,
  unsent: 0,
  accepted: 0,
  attention: 0,
  ready: 0,
  invalid: 0,
  rejected: 0,
  error: 0,
  sending: 0,
};

function parseValidTab(raw: string | null): ReconcileTab {
  if (
    raw === 'all' ||
    raw === 'unsent' ||
    raw === 'accepted' ||
    raw === 'attention'
  ) {
    return raw;
  }
  return 'all';
}

function parseValidAttentionStatus(
  raw: string | null,
): AttentionSubStatus | undefined {
  if (raw === 'invalid' || raw === 'rejected' || raw === 'error') {
    return raw;
  }
  return undefined;
}

function parsePositiveInt(raw: string | null): number | undefined {
  if (!raw || !/^\d+$/.test(raw.trim())) {
    return undefined;
  }
  const num = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(num) && num > 0 ? num : undefined;
}

function triggerBrowserFileDownload(blob: Blob, fileName: string): void {
  if (
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return;
  }
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 500);
}

/**
 * Gộp danh sách lỗi/cảnh báo từ Hệ thống Sở (`latestSubmission.errors`, `latestSubmission.warnings`, `lastError`)
 * với danh sách lỗi/cảnh báo kiểm tra dữ liệu (`item.issues`).
 * Lưu ý: `GKSK_UNSIGNED` ở v1 là cảnh báo thông tin bình thường (`severity: 'info'`).
 */
function buildCombinedDisplayIssues(
  item: CertificateListItem,
): IssueListItem[] {
  const combined: IssueListItem[] = [];
  const seenKeys = new Set<string>();

  const latestSub = item.latestSubmission;
  if (latestSub) {
    for (const err of latestSub.errors) {
      const key = `error:${err.code}:${err.field ?? ''}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        combined.push({
          code: err.code,
          field: err.field,
          severity: 'error',
        });
      }
    }

    for (const warn of latestSub.warnings) {
      const severity: IssueSeverity =
        warn.code === 'GKSK_UNSIGNED' ? 'info' : 'warning';
      const key = `${severity}:${warn.code}:${warn.field ?? ''}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        combined.push({
          code: warn.code,
          field: warn.field,
          severity,
        });
      }
    }

    if (item.status === 'error' && latestSub.lastError) {
      combined.push({
        code: latestSub.resCode ?? 'NETWORK_OR_CONFIG_ERROR',
        field: null,
        severity: 'error',
      });
    }
  }

  // Với giấy chưa đẩy hoặc bị lỗi dữ liệu Excel, hiển thị các lỗi/cảnh báo kiểm tra dữ liệu
  for (const issue of item.issues) {
    // Ẩn các thông tin kỹ thuật phụ (LOCAL_SO_FORMAT, LOCAL_BHXH_REQUIRED_EMPTY) trên giấy đã đẩy thành công để bảng gọn rõ
    if (
      item.status === 'accepted' &&
      (issue.code === 'LOCAL_SO_FORMAT' ||
        issue.code === 'LOCAL_BHXH_REQUIRED_EMPTY')
    ) {
      continue;
    }
    const key = `${issue.severity}:${issue.code}:${issue.field ?? ''}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      combined.push(issue);
    }
  }

  return combined;
}

export interface ListPageProps {
  readonly config?: PublicConfig | null;
}

/**
 * S15 — Trang Danh sách & Đối soát, Xuất XML (`.xml` / `.zip`) và Xuất Excel đối soát 29 cột.
 * Tuyệt đối không hiển thị 4 trường nhạy cảm (`NONGDOCON`, `MATUY`, `LYDO`, `TINHTRANGBENH`).
 */
export function ListPage({ config }: ListPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tableCaptionId = useId();
  const batchSelectId = useId();
  const fromDateId = useId();
  const toDateId = useId();
  const searchInputId = useId();

  // Khởi tạo trạng thái lọc từ URL query params (ví dụ khi chuyển từ trang Import Excel sang `/?batchId=2`)
  const [activeTab, setActiveTab] = useState<ReconcileTab>(() =>
    parseValidTab(searchParams.get('tab')),
  );
  const [attentionStatus, setAttentionStatus] = useState<
    AttentionSubStatus | undefined
  >(() => parseValidAttentionStatus(searchParams.get('status')));
  const [selectedBatchId, setSelectedBatchId] = useState<number | undefined>(
    () => parsePositiveInt(searchParams.get('batchId')),
  );
  const [fromDate, setFromDate] = useState<string>(
    () => searchParams.get('fromDate') ?? '',
  );
  const [toDate, setToDate] = useState<string>(
    () => searchParams.get('toDate') ?? '',
  );
  const [searchInput, setSearchInput] = useState<string>(
    () => searchParams.get('q') ?? '',
  );
  const [appliedQuery, setAppliedQuery] = useState<string>(
    () => searchParams.get('q') ?? '',
  );
  const [page, setPage] = useState<number>(
    () => parsePositiveInt(searchParams.get('page')) ?? 1,
  );
  const pageSize = 20;

  const [batches, setBatches] = useState<ImportBatchItem[]>([]);
  const [items, setItems] = useState<CertificateListItem[]>([]);
  const [counts, setCounts] = useState<ReconcileCounts>(EMPTY_COUNTS);
  const [total, setTotal] = useState<number>(0);

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const [exportingExcel, setExportingExcel] = useState<boolean>(false);
  const [downloadingZip, setDownloadingZip] = useState<boolean>(false);
  const [downloadingXmlId, setDownloadingXmlId] = useState<number | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

  // Đồng bộ các bộ lọc lên URL searchParams
  const syncUrlParams = useCallback(
    (next: {
      tab: ReconcileTab;
      status?: AttentionSubStatus;
      batchId?: number;
      fromDate: string;
      toDate: string;
      q: string;
      page: number;
    }) => {
      const sp = new URLSearchParams();
      if (next.tab !== 'all') sp.set('tab', next.tab);
      if (next.tab === 'attention' && next.status) {
        sp.set('status', next.status);
      }
      if (next.batchId !== undefined) {
        sp.set('batchId', String(next.batchId));
      }
      if (next.fromDate.trim()) sp.set('fromDate', next.fromDate.trim());
      if (next.toDate.trim()) sp.set('toDate', next.toDate.trim());
      if (next.q.trim()) sp.set('q', next.q.trim());
      if (next.page > 1) sp.set('page', String(next.page));
      setSearchParams(sp, { replace: true });
    },
    [setSearchParams],
  );

  // Tải danh sách các đợt import Excel (`GET /api/batches`)
  useEffect(() => {
    let cancelled = false;
    async function loadBatches() {
      try {
        const res = await listBatches();
        if (!cancelled) {
          setBatches(Array.isArray(res?.items) ? res.items : []);
        }
      } catch {
        // Không chặn hiển thị danh sách giấy nếu lỗi tải danh sách đợt
      }
    }
    void loadBatches();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentQueryParams = useMemo<CertificateListQueryParams>(() => {
    const params: CertificateListQueryParams = {
      tab: activeTab,
      page,
      pageSize,
    };
    if (activeTab === 'attention' && attentionStatus) {
      params.status = attentionStatus;
    }
    if (selectedBatchId !== undefined) {
      params.batchId = selectedBatchId;
    }
    if (fromDate.trim()) {
      params.fromDate = fromDate.trim();
    }
    if (toDate.trim()) {
      params.toDate = toDate.trim();
    }
    if (appliedQuery.trim()) {
      params.q = appliedQuery.trim();
    }
    return params;
  }, [
    activeTab,
    attentionStatus,
    selectedBatchId,
    fromDate,
    toDate,
    appliedQuery,
    page,
    pageSize,
  ]);

  // Tải danh sách giấy & số đếm đối soát (`GET /api/certificates`)
  useEffect(() => {
    let cancelled = false;
    async function loadCertificates() {
      setLoading(true);
      setErrorMessage(null);
      try {
        const res = await listCertificates(currentQueryParams);
        if (cancelled) {
          return;
        }
        const safeItems = Array.isArray(res?.items) ? res.items : [];
        setItems(safeItems);
        setCounts(res?.counts ? { ...EMPTY_COUNTS, ...res.counts } : EMPTY_COUNTS);
        setTotal(typeof res?.total === 'number' ? res.total : safeItems.length);

        // Mặc định tick sẵn các dòng hợp lệ (status !== 'invalid') trên trang hiện tại để tiện tải ZIP
        const validIdsOnPage = new Set<number>();
        for (const item of safeItems) {
          if (item.status !== 'invalid') {
            validIdsOnPage.add(item.id);
          }
        }
        setSelectedIds(validIdsOnPage);
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (err instanceof ApiError) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage(
            'Không thể tải danh sách giấy khám sức khỏe đối soát.',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCertificates();
    return () => {
      cancelled = true;
    };
  }, [currentQueryParams]);

  function handleSelectTab(nextTab: ReconcileTab) {
    const nextStatus = nextTab === 'attention' ? attentionStatus : undefined;
    setActiveTab(nextTab);
    if (nextTab !== 'attention') {
      setAttentionStatus(undefined);
    }
    setPage(1);
    syncUrlParams({
      tab: nextTab,
      status: nextStatus,
      batchId: selectedBatchId,
      fromDate,
      toDate,
      q: appliedQuery,
      page: 1,
    });
  }

  function handleSelectAttentionStatus(nextStatus?: AttentionSubStatus) {
    setAttentionStatus(nextStatus);
    setPage(1);
    syncUrlParams({
      tab: 'attention',
      status: nextStatus,
      batchId: selectedBatchId,
      fromDate,
      toDate,
      q: appliedQuery,
      page: 1,
    });
  }

  function handleBatchChange(rawValue: string) {
    const nextBatchId = rawValue ? Number.parseInt(rawValue, 10) : undefined;
    const validBatchId =
      nextBatchId !== undefined && Number.isFinite(nextBatchId) && nextBatchId > 0
        ? nextBatchId
        : undefined;
    setSelectedBatchId(validBatchId);
    setPage(1);
    syncUrlParams({
      tab: activeTab,
      status: attentionStatus,
      batchId: validBatchId,
      fromDate,
      toDate,
      q: appliedQuery,
      page: 1,
    });
  }

  function handleFromDateChange(value: string) {
    setFromDate(value);
    setPage(1);
    syncUrlParams({
      tab: activeTab,
      status: attentionStatus,
      batchId: selectedBatchId,
      fromDate: value,
      toDate,
      q: appliedQuery,
      page: 1,
    });
  }

  function handleToDateChange(value: string) {
    setToDate(value);
    setPage(1);
    syncUrlParams({
      tab: activeTab,
      status: attentionStatus,
      batchId: selectedBatchId,
      fromDate,
      toDate: value,
      q: appliedQuery,
      page: 1,
    });
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = searchInput.trim();
    setAppliedQuery(trimmed);
    setPage(1);
    syncUrlParams({
      tab: activeTab,
      status: attentionStatus,
      batchId: selectedBatchId,
      fromDate,
      toDate,
      q: trimmed,
      page: 1,
    });
  }

  function handleClearFilters() {
    setSelectedBatchId(undefined);
    setFromDate('');
    setToDate('');
    setSearchInput('');
    setAppliedQuery('');
    setAttentionStatus(undefined);
    setPage(1);
    syncUrlParams({
      tab: activeTab,
      status: undefined,
      batchId: undefined,
      fromDate: '',
      toDate: '',
      q: '',
      page: 1,
    });
  }

  // Các giấy hợp lệ (status !== 'invalid') trên trang hiện tại
  const validItemsOnPage = useMemo(
    () => items.filter((item) => item.status !== 'invalid'),
    [items],
  );

  const selectedValidIds = useMemo(
    () =>
      validItemsOnPage
        .filter((item) => selectedIds.has(item.id))
        .map((item) => item.id),
    [validItemsOnPage, selectedIds],
  );

  const allValidOnPageSelected =
    validItemsOnPage.length > 0 &&
    selectedValidIds.length === validItemsOnPage.length;

  function handleToggleSelectAllValid() {
    if (allValidOnPageSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(validItemsOnPage.map((item) => item.id)));
    }
  }

  function handleToggleRowSelection(item: CertificateListItem) {
    if (item.status === 'invalid') {
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
  }

  async function handleExportReconcileExcel() {
    setExportingExcel(true);
    setErrorMessage(null);
    setActionNotice(null);
    try {
      const exportFilter: CertificateListQueryParams = {
        tab: activeTab,
      };
      if (activeTab === 'attention' && attentionStatus) {
        exportFilter.status = attentionStatus;
      }
      if (selectedBatchId !== undefined) {
        exportFilter.batchId = selectedBatchId;
      }
      if (fromDate.trim()) {
        exportFilter.fromDate = fromDate.trim();
      }
      if (toDate.trim()) {
        exportFilter.toDate = toDate.trim();
      }
      if (appliedQuery.trim()) {
        exportFilter.q = appliedQuery.trim();
      }

      const result = await downloadReconcileExcel(exportFilter);
      triggerBrowserFileDownload(result.blob, result.fileName);
      setActionNotice(
        `Đã xuất file Excel đối soát 29 cột "${result.fileName}". Bạn có thể sửa trực tiếp các dòng lỗi trên file này rồi Import ngược lại.`,
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Không thể xuất file Excel đối soát.');
      }
    } finally {
      setExportingExcel(false);
    }
  }

  async function handleDownloadXmlZip() {
    if (selectedValidIds.length === 0) {
      return;
    }
    setDownloadingZip(true);
    setErrorMessage(null);
    setActionNotice(null);
    try {
      const result = await downloadCertificatesXmlZip(selectedValidIds);
      triggerBrowserFileDownload(result.blob, result.fileName);
      setActionNotice(
        `Đã tải gói "${result.fileName}" chứa ${selectedValidIds.length} file XML hợp lệ.`,
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Không thể tải gói file XML (.zip).');
      }
    } finally {
      setDownloadingZip(false);
    }
  }

  async function handleDownloadSingleXml(item: CertificateListItem) {
    if (item.status === 'invalid') {
      return;
    }
    setDownloadingXmlId(item.id);
    setErrorMessage(null);
    setActionNotice(null);
    try {
      const result = await downloadCertificateXml(item.id);
      triggerBrowserFileDownload(result.blob, result.fileName);
      setActionNotice(`Đã tải file XML "${result.fileName}" cho số giấy ${item.so}.`);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage(`Không thể tải file XML cho số giấy ${item.so}.`);
      }
    } finally {
      setDownloadingXmlId(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasActiveFilters =
    selectedBatchId !== undefined ||
    fromDate.trim() !== '' ||
    toDate.trim() !== '' ||
    appliedQuery.trim() !== '' ||
    attentionStatus !== undefined;

  return (
    <section className="workspace-panel list-page">
      <div className="panel-heading-row">
        <div>
          <h1 id="page-heading" tabIndex={-1}>
            Danh sách &amp; Đối soát GKSK Lái xe
          </h1>
          <p className="panel-subtitle">
            Theo dõi 100% quân số đã nạp từ Excel theo 4 nhóm trạng thái đối soát,
            xuất file XML lẻ / gói ZIP và xuất file Excel đối soát 29 cột.
            {config && (
              <span>
                {' '}
                · CSYT <strong>{config.facilityId}</strong> ({config.facilityName})
              </span>
            )}
          </p>
        </div>

        {/* Các nút công cụ Xuất dữ liệu & Đối soát */}
        <div className="heading-actions" data-testid="export-toolbar">
          <button
            type="button"
            className="btn-secondary"
            data-testid="export-reconcile-excel-btn"
            onClick={() => {
              void handleExportReconcileExcel();
            }}
            disabled={exportingExcel}
          >
            {exportingExcel
              ? 'Đang xuất Excel đối soát...'
              : '📊 Xuất Excel đối soát (29 cột)'}
          </button>

          <button
            type="button"
            className="btn-secondary"
            data-testid="download-xml-zip-btn"
            onClick={() => {
              void handleDownloadXmlZip();
            }}
            disabled={downloadingZip || selectedValidIds.length === 0}
          >
            {downloadingZip
              ? 'Đang đóng gói ZIP...'
              : `📦 Tải XML (.zip) (${selectedValidIds.length})`}
          </button>

          <Link to="/import" className="btn-primary">
            📥 Import Excel
          </Link>
        </div>
      </div>

      {/* Thanh thẻ đối soát & 4 Tab lọc nhanh */}
      <ReconcileSummary
        counts={counts}
        activeTab={activeTab}
        attentionStatus={attentionStatus}
        onSelectTab={handleSelectTab}
        onSelectAttentionStatus={handleSelectAttentionStatus}
      />

      {/* Bộ lọc đối soát: Đợt import Excel, khoảng ngày, từ khóa tìm kiếm */}
      <form
        className="reconcile-filter-bar"
        onSubmit={handleSearchSubmit}
        aria-label="Bộ lọc đối soát giấy khám sức khỏe"
        data-testid="reconcile-filter-form"
      >
        <div className="filter-control">
          <label htmlFor={batchSelectId}>Đợt import (file Excel)</label>
          <select
            id={batchSelectId}
            value={selectedBatchId !== undefined ? String(selectedBatchId) : ''}
            onChange={(e) => {
              handleBatchChange(e.target.value);
            }}
            data-testid="batch-filter-select"
          >
            <option value="">Tất cả đợt import</option>
            {batches.map((batch) => (
              <option key={batch.id} value={String(batch.id)}>
                Đợt #{batch.id} — {batch.filename} ({batch.rowCount} dòng)
              </option>
            ))}
          </select>
        </div>

        <div className="filter-control">
          <label htmlFor={fromDateId}>Từ ngày nạp</label>
          <input
            id={fromDateId}
            type="date"
            value={fromDate}
            onChange={(e) => {
              handleFromDateChange(e.target.value);
            }}
            data-testid="from-date-input"
          />
        </div>

        <div className="filter-control">
          <label htmlFor={toDateId}>Đến ngày nạp</label>
          <input
            id={toDateId}
            type="date"
            value={toDate}
            onChange={(e) => {
              handleToDateChange(e.target.value);
            }}
            data-testid="to-date-input"
          />
        </div>

        <div className="filter-control filter-control-search">
          <label htmlFor={searchInputId}>
            Tìm kiếm (SO / Họ tên / Số CMND-CCCD)
          </label>
          <div className="search-input-row">
            <input
              id={searchInputId}
              type="search"
              placeholder="Nhập số giấy SO, họ tên hoặc số giấy tờ..."
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
              }}
              data-testid="search-query-input"
            />
            <button
              type="submit"
              className="btn-primary"
              data-testid="search-submit-btn"
            >
              Tìm kiếm
            </button>
            {hasActiveFilters && (
              <button
                type="button"
                className="btn-ghost"
                onClick={handleClearFilters}
                data-testid="clear-filters-btn"
              >
                Xóa lọc
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Thông báo kết quả tải file / lỗi */}
      {actionNotice && (
        <div
          className="alert-banner alert-info"
          role="status"
          data-testid="list-action-notice"
        >
          {actionNotice}
        </div>
      )}

      {errorMessage && (
        <div
          className="alert-banner alert-error"
          role="alert"
          data-testid="list-error-banner"
        >
          {errorMessage}
        </div>
      )}

      {/* Bảng danh sách đối soát (ẩn tuyệt đối 4 trường nhạy cảm) */}
      <div
        role="tabpanel"
        aria-labelledby={`reconcile-tab-${activeTab}`}
        data-testid="reconcile-tabpanel"
      >
        {loading ? (
          <div className="empty-preview-box" role="status" data-testid="list-loading">
            Đang tải danh sách đối soát...
          </div>
        ) : items.length === 0 ? (
          <div className="empty-preview-box" data-testid="list-empty-state">
            Không có giấy khám sức khỏe nào khớp với bộ lọc hiện tại. Bạn có thể{' '}
            <Link to="/import">Import file Excel</Link> để nạp dữ liệu đối soát.
          </div>
        ) : (
          <>
            <div
              tabIndex={0}
              role="region"
              aria-labelledby={tableCaptionId}
              className="table-wrapper"
              data-testid="reconcile-table-region"
            >
              <table className="preview-table reconcile-table" data-testid="reconcile-table">
                <caption id={tableCaptionId} className="visually-hidden">
                  Bảng danh sách đối soát GKSK Lái xe ({items.length} trên tổng số {total} giấy)
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="col-select">
                      <label htmlFor="select-all-valid" className="checkbox-label">
                        <input
                          id="select-all-valid"
                          type="checkbox"
                          className="brand-checkbox"
                          checked={allValidOnPageSelected}
                          disabled={validItemsOnPage.length === 0}
                          onChange={handleToggleSelectAllValid}
                          aria-label="Chọn tất cả giấy hợp lệ trên trang"
                          data-testid="select-all-valid-checkbox"
                        />
                        <span>Chọn</span>
                      </label>
                    </th>
                    <th scope="col" className="col-so">
                      Số giấy (SO) &amp; Đợt Import
                    </th>
                    <th scope="col" className="col-hoten">
                      Họ tên &amp; Ngày sinh
                    </th>
                    <th scope="col" className="col-id-card">
                      Số CMND/CCCD
                    </th>
                    <th scope="col" className="col-exam">
                      Khám &amp; Kết luận
                    </th>
                    <th scope="col" className="col-status">
                      Trạng thái đối soát
                    </th>
                    <th scope="col" className="col-issues">
                      Chi tiết lỗi / cảnh báo tiếng Việt
                    </th>
                    <th scope="col" className="col-actions">
                      Thao tác
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const isInvalid = item.status === 'invalid';
                    const isChecked = !isInvalid && selectedIds.has(item.id);
                    const combinedIssues = buildCombinedDisplayIssues(item);
                    const checkboxId = `select-cert-${item.id}`;

                    return (
                      <tr
                        key={item.id}
                        data-testid={`cert-row-${item.id}`}
                        className={`preview-row ${
                          isInvalid ? 'preview-row-invalid' : ''
                        }`}
                      >
                        <th scope="row" className="col-select">
                          <label
                            htmlFor={checkboxId}
                            className={`checkbox-label ${
                              isInvalid ? 'checkbox-label-disabled' : ''
                            }`}
                          >
                            <input
                              id={checkboxId}
                              type="checkbox"
                              className="brand-checkbox"
                              checked={isChecked}
                              disabled={isInvalid}
                              onChange={() => {
                                handleToggleRowSelection(item);
                              }}
                              aria-label={`Chọn giấy ${item.so}`}
                              data-testid={`cert-checkbox-${item.id}`}
                            />
                          </label>
                        </th>

                        <td className="col-so">
                          <div className="cert-so-cell">
                            <code className="so-code" data-testid={`cert-so-${item.id}`}>
                              {item.so}
                            </code>
                            {item.batchFilename && (
                              <span
                                className="cert-batch-meta"
                                data-testid={`cert-batch-${item.id}`}
                              >
                                📄 {item.batchFilename}
                                {item.excelRowNumber !== null
                                  ? ` (Dòng #${item.excelRowNumber})`
                                  : ''}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="col-hoten">
                          <div className="cert-person-cell">
                            <strong data-testid={`cert-hoten-${item.id}`}>
                              {item.fields.HOTEN || '—'}
                            </strong>
                            <span className="cert-sub-meta">
                              NS: {item.fields.NGAYSINH || '—'} · GT:{' '}
                              {item.fields.GIOITINHVAL === '0'
                                ? 'Nam (0)'
                                : item.fields.GIOITINHVAL === '1'
                                  ? 'Nữ (1)'
                                  : item.fields.GIOITINHVAL || '—'}
                            </span>
                          </div>
                        </td>

                        <td className="col-id-card">
                          <code>{item.fields.SOCMND_PASSPORT || '—'}</code>
                        </td>

                        <td className="col-exam">
                          <div className="cert-exam-cell">
                            <div>
                              KL:{' '}
                              <code className="ketluan-code">
                                {item.fields.KETLUAN || '—'}
                              </code>
                              {item.fields.HANGBANGLAI
                                ? ` · Hạng ${item.fields.HANGBANGLAI}`
                                : ''}
                            </div>
                            <span className="cert-sub-meta">
                              Ngày KL: {item.fields.NGAYKETLUAN || '—'}
                            </span>
                          </div>
                        </td>

                        <td className="col-status">
                          <div className="cert-status-cell">
                            <StatusBadge status={item.status} />
                            {item.latestSubmission?.msgId && (
                              <span
                                className="cert-msgid-meta"
                                title={`msg_id: ${item.latestSubmission.msgId}`}
                              >
                                msg_id: <code>{item.latestSubmission.msgId.slice(0, 15)}…</code>
                              </span>
                            )}
                            {item.serverCertificateId && (
                              <span className="cert-msgid-meta">
                                ID Sở: <code>{item.serverCertificateId.slice(0, 12)}…</code>
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="col-issues">
                          <IssueList
                            issues={combinedIssues}
                            compact
                            emptyText="✅ Dữ liệu hợp lệ, sẵn sàng xuất XML & đẩy cổng"
                          />
                        </td>

                        <td className="col-actions">
                          <div className="row-actions-group">
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              disabled={
                                isInvalid || downloadingXmlId === item.id
                              }
                              onClick={() => {
                                void handleDownloadSingleXml(item);
                              }}
                              title={
                                isInvalid
                                  ? 'Giấy đang có lỗi dữ liệu Excel, không thể xuất XML'
                                  : `Tải file ${item.so}.xml`
                              }
                              data-testid={`download-xml-btn-${item.id}`}
                            >
                              {downloadingXmlId === item.id
                                ? 'Đang tải...'
                                : 'Tải <SO>.xml'}
                            </button>

                            <button
                              type="button"
                              className="btn-primary btn-sm"
                              disabled={
                                isInvalid || item.status === 'sending'
                              }
                              title={
                                isInvalid
                                  ? 'Giấy đang có lỗi dữ liệu Excel, không thể đẩy cổng'
                                  : 'Đẩy cổng Sở Y tế'
                              }
                              data-testid={`send-cert-btn-${item.id}`}
                            >
                              Đẩy cổng
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Thanh phân trang */}
            <div className="pagination-bar" data-testid="pagination-bar">
              <div className="pagination-summary">
                Hiển thị <strong>{items.length}</strong> / tổng số{' '}
                <strong data-testid="pagination-total">{total}</strong> giấy · Trang{' '}
                <strong>{page}</strong> / <strong>{totalPages}</strong>
              </div>
              <div className="pagination-actions">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={page <= 1}
                  data-testid="prev-page-btn"
                  onClick={() => {
                    const nextPage = Math.max(1, page - 1);
                    setPage(nextPage);
                    syncUrlParams({
                      tab: activeTab,
                      status: attentionStatus,
                      batchId: selectedBatchId,
                      fromDate,
                      toDate,
                      q: appliedQuery,
                      page: nextPage,
                    });
                  }}
                >
                  ← Trang trước
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={page >= totalPages}
                  data-testid="next-page-btn"
                  onClick={() => {
                    const nextPage = Math.min(totalPages, page + 1);
                    setPage(nextPage);
                    syncUrlParams({
                      tab: activeTab,
                      status: attentionStatus,
                      batchId: selectedBatchId,
                      fromDate,
                      toDate,
                      q: appliedQuery,
                      page: nextPage,
                    });
                  }}
                >
                  Trang sau →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
