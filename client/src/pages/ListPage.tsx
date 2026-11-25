import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CertificateStatus, IssueSeverity, ReconcileTab } from '@gksk/shared';
import {
  ApiError,
  downloadCertificateXml,
  downloadCertificatesXmlZip,
  downloadReconcileExcel,
  getBatchJob,
  listBatches,
  listCertificates,
  refreshSubmissionStatus,
  sendSingleCertificate,
  startBatchSend,
  type BatchJobProgress,
  type CertificateListItem,
  type CertificateListQueryParams,
  type ImportBatchItem,
  type PublicConfig,
  type ReconcileCounts,
} from '../api';
import {
  CertificateDetailDrawer,
  type DrawerTabKey,
} from '../components/CertificateDetailDrawer';
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

  for (const issue of item.issues) {
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
 * S15 & S16 — Trang Danh sách & Đối soát, Xuất XML (`.xml` / `.zip`), Xuất Excel đối soát 29 cột,
 * Đẩy cổng đơn/hàng loạt (kèm hộp thoại xác nhận, polling tiến độ `jobId` 1s, Gửi lại giữ nguyên `msg_id`, Tra trạng thái)
 * và Ngăn trượt (`CertificateDetailDrawer`) Chi tiết chỉ đọc 25 trường + Xem trước XML + Lịch sử gửi.
 * Tuyệt đối không hiển thị 4 trường nhạy cảm (`NONGDOCON`, `MATUY`, `LYDO`, `TINHTRANGBENH`) trên bảng danh sách.
 */
export function ListPage({ config }: ListPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tableCaptionId = useId();
  const batchSelectId = useId();
  const fromDateId = useId();
  const toDateId = useId();
  const searchInputId = useId();
  const batchConfirmTitleId = useId();
  const prodConfirmCheckboxId = useId();

  const batchConfirmDialogRef = useRef<HTMLDialogElement | null>(null);

  // Khởi tạo trạng thái lọc từ URL query params
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

  // S16 — Trạng thái đẩy cổng đơn / hàng loạt / tra trạng thái
  const [sendingSingleId, setSendingSingleId] = useState<number | null>(null);
  const [refreshingRowId, setRefreshingRowId] = useState<number | null>(null);
  const [startingBatch, setStartingBatch] = useState<boolean>(false);
  const [activeJob, setActiveJob] = useState<BatchJobProgress | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState<boolean>(false);
  const [pendingSendTargets, setPendingSendTargets] = useState<
    Array<{ id: number; so: string; status: CertificateStatus }>
  >([]);
  const [prodConfirmed, setProdConfirmed] = useState<boolean>(false);

  // S16 — Trạng thái Ngăn trượt (Drawer) Chi tiết chỉ đọc
  const [drawerCertId, setDrawerCertId] = useState<number | null>(null);
  const [drawerInitialTab, setDrawerInitialTab] =
    useState<DrawerTabKey>('fields');
  const [drawerRefreshCounter, setDrawerRefreshCounter] = useState<number>(0);

  const isProduction = config?.appEnv === 'production';

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

  const fetchCertificatesData = useCallback(
    async (options?: { silent?: boolean; preserveSelection?: boolean }) => {
      const silent = options?.silent ?? false;
      const preserveSelection = options?.preserveSelection ?? false;
      if (!silent) {
        setLoading(true);
        setErrorMessage(null);
      }
      try {
        const res = await listCertificates(currentQueryParams);
        const safeItems = Array.isArray(res?.items) ? res.items : [];
        setItems(safeItems);
        setCounts(
          res?.counts ? { ...EMPTY_COUNTS, ...res.counts } : EMPTY_COUNTS,
        );
        setTotal(typeof res?.total === 'number' ? res.total : safeItems.length);

        if (!preserveSelection) {
          const validIdsOnPage = new Set<number>();
          for (const item of safeItems) {
            if (item.status !== 'invalid') {
              validIdsOnPage.add(item.id);
            }
          }
          setSelectedIds(validIdsOnPage);
        } else {
          setSelectedIds((prev) => {
            const validSet = new Set(
              safeItems
                .filter((item) => item.status !== 'invalid')
                .map((item) => item.id),
            );
            const kept = new Set<number>();
            for (const id of prev) {
              if (validSet.has(id)) {
                kept.add(id);
              }
            }
            return kept.size > 0 ? kept : validSet;
          });
        }
      } catch (err) {
        if (!silent) {
          if (err instanceof ApiError) {
            setErrorMessage(err.message);
          } else {
            setErrorMessage(
              'Không thể tải danh sách giấy khám sức khỏe đối soát.',
            );
          }
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [currentQueryParams],
  );

  // Tải danh sách giấy & số đếm đối soát (`GET /api/certificates`)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErrorMessage(null);
      try {
        const res = await listCertificates(currentQueryParams);
        if (cancelled) {
          return;
        }
        const safeItems = Array.isArray(res?.items) ? res.items : [];
        setItems(safeItems);
        setCounts(
          res?.counts ? { ...EMPTY_COUNTS, ...res.counts } : EMPTY_COUNTS,
        );
        setTotal(typeof res?.total === 'number' ? res.total : safeItems.length);

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

    void load();
    return () => {
      cancelled = true;
    };
  }, [currentQueryParams]);

  // S16 — Polling tiến độ đẩy cổng hàng loạt theo `jobId` mỗi 1 giây (`1000ms`)
  const activeJobId = activeJob?.jobId ?? null;
  const activeJobStatus = activeJob?.status ?? null;

  useEffect(() => {
    if (!activeJobId || activeJobStatus !== 'running') {
      return;
    }

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    async function pollOnce() {
      if (cancelled || !activeJobId) {
        return;
      }
      try {
        const latest = await getBatchJob(activeJobId);
        if (cancelled) {
          return;
        }
        setActiveJob(latest);

        if (latest.status === 'completed') {
          setActionNotice(
            `Đã hoàn tất tiến trình đẩy cổng hàng loạt (${latest.done}/${latest.total} giấy): ${latest.accepted} thành công, ${latest.rejected} bị Sở từ chối, ${latest.error} lỗi mạng/cấu hình.`,
          );
          await fetchCertificatesData({
            silent: true,
            preserveSelection: true,
          });
          setDrawerRefreshCounter((c) => c + 1);
          return;
        }
      } catch {
        // Bỏ qua lỗi mạng tạm thời khi polling tiến độ, thử lại ở nhịp 1s kế tiếp
      }

      if (!cancelled) {
        timerId = setTimeout(() => {
          void pollOnce();
        }, 1000);
      }
    }

    timerId = setTimeout(() => {
      void pollOnce();
    }, 1000);

    return () => {
      cancelled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, [activeJobId, activeJobStatus, fetchCertificatesData]);

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

  // Các giấy hợp lệ (status !== 'invalid') trên trang hiện tại (dùng cho Tải XML .zip)
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

  // Các giấy đang được chọn có thể Đẩy cổng / Gửi lại (`ready` hoặc `error`, hoặc nếu người dùng chỉ chọn dòng hợp lệ khác)
  const selectedSendableItems = useMemo(() => {
    const readyOrError = validItemsOnPage.filter(
      (item) =>
        selectedIds.has(item.id) &&
        (item.status === 'ready' || item.status === 'error'),
    );
    if (readyOrError.length > 0) {
      return readyOrError;
    }
    return validItemsOnPage.filter(
      (item) => selectedIds.has(item.id) && item.status !== 'sending',
    );
  }, [validItemsOnPage, selectedIds]);

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

  function openBatchConfirmModal(
    targets: Array<{ id: number; so: string; status: CertificateStatus }>,
  ) {
    if (targets.length === 0) {
      return;
    }
    setPendingSendTargets(targets);
    setProdConfirmed(false);
    setConfirmDialogOpen(true);
    const dialog = batchConfirmDialogRef.current;
    if (dialog && typeof dialog.showModal === 'function' && !dialog.open) {
      dialog.showModal();
    }
  }

  function closeBatchConfirmModal() {
    const dialog = batchConfirmDialogRef.current;
    if (dialog && dialog.open && typeof dialog.close === 'function') {
      dialog.close();
    }
    setConfirmDialogOpen(false);
  }

  async function handleConfirmBatchSend() {
    if (pendingSendTargets.length === 0) {
      return;
    }
    if (isProduction && !prodConfirmed) {
      return;
    }

    setStartingBatch(true);
    setErrorMessage(null);
    setActionNotice(null);

    try {
      const ids = pendingSendTargets.map((t) => t.id);
      const startRes = await startBatchSend(ids);

      // Khởi tạo trạng thái tiến độ ngay lập tức và gọi GET /api/jobs/:jobId lần đầu
      const initialProgress: BatchJobProgress = {
        jobId: startRes.jobId,
        status: startRes.status,
        total: startRes.total,
        done: 0,
        accepted: 0,
        rejected: 0,
        error: 0,
        invalid: 0,
        pending: startRes.total,
        pausedUntilMs: null,
        rateLimitCount: 0,
        createdAt: new Date().toISOString(),
        finishedAt: null,
        items: pendingSendTargets.map((t) => ({
          certificateId: t.id,
          so: t.so,
          status: 'queued',
          msgId: null,
          serverSubmissionId: null,
          serverCertificateId: null,
          httpStatus: null,
          resCode: null,
          errors: [],
          warnings: [],
          lastError: null,
          attempts: 0,
          reusedPendingSubmission: false,
          recoveredViaStatus: false,
          startedAt: null,
          finishedAt: null,
        })),
      };
      setActiveJob(initialProgress);

      try {
        const immediateJob = await getBatchJob(startRes.jobId);
        setActiveJob(immediateJob);
        if (immediateJob.status === 'completed') {
          setActionNotice(
            `Đã hoàn tất tiến trình đẩy cổng hàng loạt (${immediateJob.done}/${immediateJob.total} giấy): ${immediateJob.accepted} thành công, ${immediateJob.rejected} bị Sở từ chối, ${immediateJob.error} lỗi mạng/cấu hình.`,
          );
          await fetchCertificatesData({
            silent: true,
            preserveSelection: true,
          });
          setDrawerRefreshCounter((c) => c + 1);
        }
      } catch {
        // Polling 1s trong useEffect sẽ tiếp tục cập nhật
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage('Không thể khởi tạo tiến trình đẩy cổng hàng loạt.');
      }
    } finally {
      setStartingBatch(false);
    }
  }

  async function executeSingleSend(
    certId: number,
    so: string,
    currentStatus: CertificateStatus,
  ) {
    setSendingSingleId(certId);
    setErrorMessage(null);
    setActionNotice(null);
    try {
      const res = await sendSingleCertificate(certId);
      const msgIdText = res.submission?.msgId
        ? ` (msg_id: ${res.submission.msgId}${
            res.reusedPendingSubmission ? ' — giữ nguyên msg_id khi gửi lại' : ''
          })`
        : '';

      if (res.status === 'accepted') {
        setActionNotice(
          `✅ Đã đẩy thành công giấy ${res.so} lên Hệ thống Sở Y tế${msgIdText}.`,
        );
      } else if (res.status === 'rejected') {
        setActionNotice(
          `⛔ Giấy ${res.so} bị Hệ thống Sở từ chối${msgIdText}. Vui lòng xem chi tiết lỗi và sửa trên file Excel.`,
        );
      } else if (res.status === 'error') {
        setErrorMessage(
          `⚠️ Lỗi mạng hoặc cấu hình khi gửi giấy ${res.so}${msgIdText}. Bạn có thể bấm "Gửi lại" để thử lại trên cùng msg_id.`,
        );
      } else {
        setErrorMessage(
          `⛔ Giấy ${so} đang có lỗi dữ liệu chặn (${currentStatus}), không thể đẩy cổng.`,
        );
      }

      await fetchCertificatesData({ silent: true, preserveSelection: true });
      setDrawerRefreshCounter((c) => c + 1);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage(`Không thể gửi giấy khám sức khỏe ${so}.`);
      }
    } finally {
      setSendingSingleId(null);
    }
  }

  function handleRequestSingleSend(
    certId: number,
    so: string,
    currentStatus: CertificateStatus,
  ) {
    if (currentStatus === 'invalid') {
      return;
    }
    // Ở môi trường production bắt buộc bật hộp xác nhận đỏ trước mỗi lần gửi
    if (isProduction) {
      openBatchConfirmModal([{ id: certId, so, status: currentStatus }]);
      return;
    }
    void executeSingleSend(certId, so, currentStatus);
  }

  async function handleRefreshRowStatus(item: CertificateListItem) {
    if (!item.latestSubmission) {
      return;
    }
    setRefreshingRowId(item.id);
    setErrorMessage(null);
    setActionNotice(null);
    try {
      const res = await refreshSubmissionStatus(item.latestSubmission.id);
      if (res.found) {
        setActionNotice(
          `🔍 Đã tra trạng thái giấy ${item.so} (msg_id: ${res.submission.msgId}): Hệ thống Sở ghi nhận "${res.status ?? 'đã xử lý'}".`,
        );
      } else {
        setActionNotice(
          `🔍 Đã tra trạng thái giấy ${item.so} (msg_id: ${res.submission.msgId}): Hệ thống Sở chưa ghi nhận gói tin này (HTTP 404).`,
        );
      }
      await fetchCertificatesData({ silent: true, preserveSelection: true });
      setDrawerRefreshCounter((c) => c + 1);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage(`Không thể tra trạng thái cho số giấy ${item.so}.`);
      }
    } finally {
      setRefreshingRowId(null);
    }
  }

  function handleOpenDrawer(certId: number, tab: DrawerTabKey = 'fields') {
    setDrawerInitialTab(tab);
    setDrawerCertId(certId);
  }

  function handleRowClick(
    event: MouseEvent<HTMLTableRowElement>,
    item: CertificateListItem,
  ) {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      target.closest('button, input, label, a, select, textarea')
    ) {
      return;
    }
    handleOpenDrawer(item.id, 'fields');
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
      setActionNotice(
        `Đã tải file XML "${result.fileName}" cho số giấy ${item.so}.`,
      );
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

  const progressPercent =
    activeJob && activeJob.total > 0
      ? Math.min(100, Math.round((activeJob.done / activeJob.total) * 100))
      : 0;

  function renderBatchProgressPanel() {
    if (!activeJob) {
      return null;
    }
    const isRunning = activeJob.status === 'running';

    return (
      <div
        className={`batch-progress-panel ${
          isRunning ? 'batch-progress-running' : 'batch-progress-completed'
        }`}
        role="region"
        aria-label="Tiến độ đẩy cổng hàng loạt"
        data-testid="batch-progress-panel"
      >
        <div className="batch-progress-header">
          <div className="batch-progress-title-group">
            <strong className="batch-progress-title">
              {isRunning
                ? '⏳ Đang đẩy cổng hàng loạt lên Hệ thống Sở Y tế...'
                : '✅ Tiến trình đẩy cổng hàng loạt đã hoàn tất'}
            </strong>
            <span className="batch-progress-jobid">
              Mã tiến trình: <code data-testid="batch-progress-jobid">{activeJob.jobId}</code>
            </span>
          </div>

          <div className="batch-progress-pct-group">
            <span
              className="batch-progress-pct"
              data-testid="batch-progress-percent"
            >
              {progressPercent}% ({activeJob.done}/{activeJob.total} giấy)
            </span>
            {!isRunning && !confirmDialogOpen && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                data-testid="dismiss-batch-progress-btn"
                onClick={() => {
                  setActiveJob(null);
                }}
              >
                ✕ Ẩn thanh tiến độ
              </button>
            )}
          </div>
        </div>

        <div className="batch-progress-bar-track" aria-hidden="true">
          <div
            className="batch-progress-bar-fill"
            style={{ width: `${progressPercent}%` }}
            data-testid="batch-progress-bar-fill"
          />
        </div>
        <progress
          className="visually-hidden"
          max={activeJob.total || 1}
          value={activeJob.done}
          data-testid="batch-progress-native"
        >
          {progressPercent}%
        </progress>

        <div className="batch-progress-stats" data-testid="batch-progress-stats">
          <div className="batch-stat-chip stat-done">
            <span>Đã xử lý:</span>
            <strong data-testid="batch-progress-done">
              {activeJob.done} / {activeJob.total}
            </strong>
          </div>
          <div className="batch-stat-chip stat-accepted">
            <span>✅ Thành công:</span>
            <strong data-testid="batch-progress-accepted">
              {activeJob.accepted}
            </strong>
          </div>
          <div className="batch-stat-chip stat-rejected">
            <span>⛔ Sở từ chối:</span>
            <strong data-testid="batch-progress-rejected">
              {activeJob.rejected}
            </strong>
          </div>
          <div className="batch-stat-chip stat-error">
            <span>⚠️ Lỗi mạng / Cấu hình:</span>
            <strong data-testid="batch-progress-error">
              {activeJob.error}
            </strong>
          </div>
        </div>

        {activeJob.items && activeJob.items.length > 0 && (
          <div
            className="batch-progress-items-strip"
            data-testid="batch-progress-items"
          >
            {activeJob.items.slice(0, 12).map((jobItem) => (
              <span
                key={jobItem.certificateId}
                className={`batch-item-pill batch-item-${jobItem.status}`}
                data-testid={`batch-item-pill-${jobItem.certificateId}`}
              >
                <code>{jobItem.so ?? `#${jobItem.certificateId}`}</code>:{' '}
                {jobItem.status === 'accepted'
                  ? '✅ accepted'
                  : jobItem.status === 'rejected'
                    ? '⛔ rejected'
                    : jobItem.status === 'error'
                      ? '⚠️ error'
                      : jobItem.status === 'sending'
                        ? '⏳ đang gửi'
                        : '🕒 chờ gửi'}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  const readyTargetCount = pendingSendTargets.filter(
    (t) => t.status === 'ready',
  ).length;
  const retryTargetCount = pendingSendTargets.filter(
    (t) => t.status === 'error',
  ).length;

  return (
    <section className="workspace-panel list-page">
      <div className="panel-heading-row">
        <div>
          <h1 id="page-heading" tabIndex={-1}>
            Danh sách &amp; Đối soát GKSK Lái xe
          </h1>
          <p className="panel-subtitle">
            Theo dõi 100% quân số đã nạp từ Excel theo 4 nhóm trạng thái đối soát,
            xem chi tiết 25 trường / XML, đẩy cổng hàng loạt và xuất file Excel đối
            soát 29 cột.
            {config && (
              <span>
                {' '}
                · CSYT <strong>{config.facilityId}</strong> ({config.facilityName})
              </span>
            )}
          </p>
        </div>

        {/* Các nút công cụ Xuất dữ liệu, Đẩy cổng hàng loạt & Đối soát */}
        <div className="heading-actions" data-testid="export-toolbar">
          <button
            type="button"
            className="btn-primary"
            data-testid="batch-send-btn"
            disabled={
              selectedSendableItems.length === 0 ||
              startingBatch ||
              activeJob?.status === 'running'
            }
            onClick={() => {
              openBatchConfirmModal(
                selectedSendableItems.map((item) => ({
                  id: item.id,
                  so: item.so,
                  status: item.status,
                })),
              );
            }}
          >
            {activeJob?.status === 'running'
              ? `⏳ Đang đẩy cổng (${activeJob.done}/${activeJob.total})...`
              : `🚀 Đẩy cổng các giấy đã chọn (${selectedSendableItems.length})`}
          </button>

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

          <Link to="/import" className="btn-secondary">
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

      {/* Thanh tiến độ đẩy cổng hàng loạt trên trang chính khi hộp thoại xác nhận đã đóng */}
      {!confirmDialogOpen && renderBatchProgressPanel()}

      {/* Thông báo kết quả tải file / đẩy cổng / lỗi */}
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
          <div
            className="empty-preview-box"
            role="status"
            data-testid="list-loading"
          >
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
              <table
                className="preview-table reconcile-table"
                data-testid="reconcile-table"
              >
                <caption id={tableCaptionId} className="visually-hidden">
                  Bảng danh sách đối soát GKSK Lái xe ({items.length} trên tổng
                  số {total} giấy)
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
                    const isDrawerActive = drawerCertId === item.id;
                    const isSendingRow =
                      sendingSingleId === item.id || item.status === 'sending';

                    return (
                      <tr
                        key={item.id}
                        data-testid={`cert-row-${item.id}`}
                        onClick={(event) => {
                          handleRowClick(event, item);
                        }}
                        className={`preview-row reconcile-clickable-row ${
                          isInvalid ? 'preview-row-invalid' : ''
                        } ${isDrawerActive ? 'preview-row-active-drawer' : ''}`}
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
                            <button
                              type="button"
                              className="so-link-btn"
                              onClick={() => {
                                handleOpenDrawer(item.id, 'fields');
                              }}
                              title="Bấm để mở Ngăn trượt xem chi tiết 25 trường, XML và lịch sử đẩy cổng"
                              data-testid={`cert-so-btn-${item.id}`}
                            >
                              <code
                                className="so-code"
                                data-testid={`cert-so-${item.id}`}
                              >
                                {item.so}
                              </code>
                            </button>
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
                                data-testid={`cert-latest-msgid-${item.id}`}
                              >
                                msg_id:{' '}
                                <code>
                                  {item.latestSubmission.msgId.slice(0, 15)}…
                                </code>
                              </span>
                            )}
                            {item.serverCertificateId && (
                              <span className="cert-msgid-meta">
                                ID Sở:{' '}
                                <code>
                                  {item.serverCertificateId.slice(0, 12)}…
                                </code>
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
                              className="btn-ghost btn-sm"
                              onClick={() => {
                                handleOpenDrawer(item.id, 'fields');
                              }}
                              data-testid={`view-detail-btn-${item.id}`}
                            >
                              Chi tiết
                            </button>

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
                              className={`btn-sm ${
                                item.status === 'error'
                                  ? 'btn-retry-warning'
                                  : 'btn-primary'
                              }`}
                              disabled={isInvalid || isSendingRow}
                              onClick={() => {
                                handleRequestSingleSend(
                                  item.id,
                                  item.so,
                                  item.status,
                                );
                              }}
                              title={
                                isInvalid
                                  ? 'Giấy đang có lỗi dữ liệu Excel, không thể đẩy cổng'
                                  : item.status === 'error'
                                    ? 'Gửi lại gói tin lỗi mạng (giữ nguyên msg_id)'
                                    : 'Đẩy cổng Sở Y tế'
                              }
                              data-testid={`send-cert-btn-${item.id}`}
                            >
                              {isSendingRow
                                ? 'Đang gửi...'
                                : item.status === 'error'
                                  ? '🔄 Gửi lại'
                                  : 'Đẩy cổng'}
                            </button>

                            {item.latestSubmission && (
                              <button
                                type="button"
                                className="btn-secondary btn-sm"
                                disabled={refreshingRowId === item.id}
                                onClick={() => {
                                  void handleRefreshRowStatus(item);
                                }}
                                title={`Tra lại trạng thái trên Hệ thống Sở theo msg_id=${item.latestSubmission.msgId}`}
                                data-testid={`refresh-status-btn-${item.id}`}
                              >
                                {refreshingRowId === item.id
                                  ? 'Đang tra...'
                                  : 'Tra trạng thái'}
                              </button>
                            )}
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
                <strong data-testid="pagination-total">{total}</strong> giấy ·
                Trang <strong>{page}</strong> / <strong>{totalPages}</strong>
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

      {/* Hộp thoại native <dialog> xác nhận đẩy cổng hàng loạt & hiển thị thanh tiến độ trực tiếp (dialog guide) */}
      <dialog
        ref={batchConfirmDialogRef}
        className="confirm-dialog batch-send-dialog"
        aria-labelledby={batchConfirmTitleId}
        data-testid="batch-send-confirm-dialog"
        onClose={() => {
          if (batchConfirmDialogRef.current) {
            batchConfirmDialogRef.current.returnValue = '';
          }
          setConfirmDialogOpen(false);
        }}
      >
        <div className="confirm-dialog-inner">
          <h1 id={batchConfirmTitleId} className="confirm-dialog-title">
            🚀 Xác nhận đẩy cổng GKSK Lái xe lên Hệ thống Sở Y tế
          </h1>

          <div className="confirm-dialog-body">
            <p>
              Bạn đã chọn{' '}
              <strong data-testid="batch-confirm-count">
                {pendingSendTargets.length}
              </strong>{' '}
              giấy khám sức khỏe để đẩy tuần tự lên Hệ thống CSDL Sức khỏe Sở Y tế
              Đồng Nai
              {config
                ? ` (CSYT ${config.facilityId} — ${config.facilityName})`
                : ''}
              :
            </p>

            <div className="batch-confirm-summary-badges">
              <span className="status-pill cert-badge-ready">
                🟦 Chờ đẩy mới: {readyTargetCount} giấy
              </span>
              {retryTargetCount > 0 && (
                <span className="status-pill cert-badge-error">
                  🔄 Gửi lại lỗi mạng (giữ nguyên msg_id): {retryTargetCount}{' '}
                  giấy
                </span>
              )}
            </div>

            {pendingSendTargets.length > 0 && (
              <div
                className="batch-confirm-so-list"
                data-testid="batch-confirm-so-list"
              >
                {pendingSendTargets.slice(0, 10).map((t) => (
                  <code key={t.id} className="so-code">
                    {t.so}
                  </code>
                ))}
                {pendingSendTargets.length > 10 && (
                  <span className="cert-sub-meta">
                    +{pendingSendTargets.length - 10} giấy khác
                  </span>
                )}
              </div>
            )}

            {/* Cảnh báo đỏ bắt buộc xác nhận khi APP_ENV=production */}
            {isProduction && (
              <div
                className="prod-confirm-warning-box"
                role="alert"
                data-testid="prod-send-warning"
              >
                <strong>
                  🚨 CẢNH BÁO MÔI TRƯỜNG VẬN HÀNH THẬT (APP_ENV=production):
                </strong>
                <p>
                  Hệ thống đang kết nối tới máy chủ thật{' '}
                  <code>{config?.baseUrlHost}</code>. Tuyệt đối{' '}
                  <strong>KHÔNG</strong> đẩy các giấy thử nghiệm (<code>TEST.</code>
                  , <code>TESTGKSK01</code>) vì số CCCD 12 số hoặc CMND 9 số sẽ tạo
                  hồ sơ người thật trên Hệ thống Sở Y tế.
                </p>
                <label
                  htmlFor={prodConfirmCheckboxId}
                  className="checkbox-label prod-confirm-checkbox-label"
                >
                  <input
                    id={prodConfirmCheckboxId}
                    type="checkbox"
                    className="brand-checkbox"
                    checked={prodConfirmed}
                    onChange={(e) => {
                      setProdConfirmed(e.target.checked);
                    }}
                    data-testid="prod-confirm-checkbox"
                  />
                  <span>
                    Tôi xác nhận các giấy đã chọn là dữ liệu khám thật và đồng ý
                    đẩy lên Cổng Sở Y tế.
                  </span>
                </label>
              </div>
            )}

            {/* Hiển thị trực tiếp thanh tiến độ ngay trong hộp thoại khi đang chạy hoặc vừa chạy xong */}
            {confirmDialogOpen && renderBatchProgressPanel()}
          </div>

          <div className="confirm-dialog-actions">
            <button
              type="button"
              className="btn-secondary"
              autoFocus
              data-testid="cancel-batch-send-btn"
              onClick={closeBatchConfirmModal}
            >
              {activeJob ? 'Đóng hộp thoại (Xem trên bảng)' : 'Hủy bỏ'}
            </button>

            <button
              type="button"
              className={isProduction ? 'btn-danger' : 'btn-primary'}
              disabled={
                startingBatch ||
                activeJob?.status === 'running' ||
                (isProduction && !prodConfirmed)
              }
              data-testid="confirm-batch-send-btn"
              onClick={() => {
                void handleConfirmBatchSend();
              }}
            >
              {startingBatch
                ? 'Đang khởi tạo...'
                : activeJob?.status === 'running'
                  ? `⏳ Đang đẩy cổng (${activeJob.done}/${activeJob.total})...`
                  : `🚀 Xác nhận đẩy cổng (${pendingSendTargets.length} giấy)`}
            </button>
          </div>
        </div>
      </dialog>

      {/* S16 — Ngăn trượt (Drawer) Chi tiết chỉ đọc mở bên phải bảng đối soát */}
      <CertificateDetailDrawer
        certificateId={drawerCertId}
        initialTab={drawerInitialTab}
        refreshCounter={drawerRefreshCounter}
        onClose={() => {
          setDrawerCertId(null);
        }}
        onRequestSend={(id, so, status) => {
          handleRequestSingleSend(id, so, status);
        }}
        onCertificateUpdated={() => {
          void fetchCertificatesData({ silent: true, preserveSelection: true });
        }}
      />
    </section>
  );
}
