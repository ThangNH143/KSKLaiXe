import {
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ConflictMode, Issue } from '@gksk/shared';
import {
  ApiError,
  commitExcelImport,
  downloadImportTemplate,
  previewExcelImport,
  type ImportPreviewResponse,
  type ImportPreviewRow,
} from '../api';
import { IssueList } from '../components/IssueList';

export type PreviewFilterKey =
  | 'all'
  | 'selected'
  | 'invalid'
  | 'overwrite'
  | 'accepted';

export type RowDataHealth = 'valid' | 'warning' | 'error';

function getRowDataHealth(
  status: 'ready' | 'invalid',
  issues: readonly Issue[],
): RowDataHealth {
  if (status === 'invalid' || issues.some((i) => i.severity === 'error')) {
    return 'error';
  }
  if (issues.some((i) => i.severity === 'warning')) {
    return 'warning';
  }
  return 'valid';
}

function getDataHealthBadge(
  status: 'ready' | 'invalid',
  issues: readonly Issue[],
): {
  health: RowDataHealth;
  icon: string;
  label: string;
  className: string;
} {
  const health = getRowDataHealth(status, issues);
  switch (health) {
    case 'error':
      return {
        health,
        icon: '⛔',
        label: 'Lỗi dữ liệu',
        className: 'data-badge-error',
      };
    case 'warning':
      return {
        health,
        icon: '⚠️',
        label: 'Có cảnh báo',
        className: 'data-badge-warning',
      };
    case 'valid':
    default:
      return {
        health,
        icon: '✅',
        label: 'Hợp lệ',
        className: 'data-badge-valid',
      };
  }
}

function getConflictBadgeMeta(row: ImportPreviewRow): {
  label: string;
  className: string;
  description: string;
} {
  const mode: ConflictMode = row.conflictMode;
  switch (mode) {
    case 'new':
      return {
        label: 'Mới',
        className: 'conflict-badge-new',
        description: 'Mã SO chưa có trong danh sách đối soát',
      };
    case 'overwrite_pending':
      return {
        label: 'Ghi đè bản cũ',
        className: 'conflict-badge-overwrite',
        description:
          'Mã SO đang ở trạng thái chưa đẩy / lỗi trong DB — mặc định chọn để cập nhật',
      };
    case 'accepted_unchanged':
      return {
        label: 'Đã đẩy - Không đổi',
        className: 'conflict-badge-accepted-unchanged',
        description:
          'Giấy đã đẩy thành công lên Sở và dữ liệu không đổi — mặc định bỏ qua',
      };
    case 'accepted_modified':
      return {
        label: 'Đã đẩy - Có sửa',
        className: 'conflict-badge-accepted-modified',
        description:
          'Giấy đã đẩy thành công lên Sở nhưng dữ liệu Excel có thay đổi — cần xác nhận nếu muốn ghi đè',
      };
    case 'missing_so':
    default: {
      const isDuplicateEarlierRow =
        row.so.trim() !== '' &&
        row.issues.some((i) => i.code === 'LOCAL_SO_DUPLICATE_IN_BATCH');
      return {
        label: isDuplicateEarlierRow ? 'Trùng SO trong file' : 'Thiếu / Sai mã SO',
        className: 'conflict-badge-missing-so',
        description: isDuplicateEarlierRow
          ? 'Dòng này bị dòng trùng mã SO phía sau trong cùng file ghi đè'
          : 'Không thể lưu vì thiếu mã SO hoặc mã SO vượt quá 30 ký tự',
      };
    }
  }
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
 * S14 — Trang Import Excel (ghi đè thông minh theo mã SO).
 * Không có form nhập/sửa tay trên web: mọi chỉnh sửa thực hiện trên file Excel rồi Import lại.
 */
export function ImportPage() {
  const navigate = useNavigate();
  const fileInputId = useId();
  const tableCaptionId = useId();
  const confirmDialogTitleId = useId();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const confirmDialogRef = useRef<HTMLDialogElement | null>(null);

  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [uploadingPreview, setUploadingPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [selectedRowNumbers, setSelectedRowNumbers] = useState<Set<number>>(
    () => new Set(),
  );
  const [activeFilter, setActiveFilter] = useState<PreviewFilterKey>('all');

  // Dòng `accepted_modified` đang chờ người dùng xác nhận ghi đè trong hộp thoại <dialog>
  const [pendingModifiedRow, setPendingModifiedRow] =
    useState<ImportPreviewRow | null>(null);

  async function handleDownloadTemplate() {
    setDownloadingTemplate(true);
    setErrorMessage(null);
    setErrorCode(null);
    setStatusNotice(null);
    try {
      const result = await downloadImportTemplate();
      triggerBrowserFileDownload(result.blob, result.fileName);
      setStatusNotice(
        `Đã tải file Excel mẫu "${result.fileName}" (gồm sheet GKSK 23 cột định dạng Text và sheet HuongDan).`,
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorCode(err.code);
        setErrorMessage(err.message);
      } else {
        setErrorCode('DOWNLOAD_TEMPLATE_ERROR');
        setErrorMessage('Không thể tải file Excel mẫu. Vui lòng thử lại.');
      }
    } finally {
      setDownloadingTemplate(false);
    }
  }

  async function processSelectedFile(file: File) {
    setUploadingPreview(true);
    setErrorMessage(null);
    setErrorCode(null);
    setStatusNotice(null);

    try {
      const response = await previewExcelImport(file);
      setPreview(response);
      setActiveFilter('all');

      const initialSelected = new Set<number>();
      for (const row of response.rows) {
        if (row.canCommit && row.defaultSelected) {
          initialSelected.add(row.rowNumber);
        }
      }
      setSelectedRowNumbers(initialSelected);
    } catch (err) {
      setPreview(null);
      setSelectedRowNumbers(new Set());
      if (err instanceof ApiError) {
        setErrorCode(err.code);
        setErrorMessage(err.message);
      } else {
        setErrorCode('PREVIEW_IMPORT_ERROR');
        setErrorMessage(
          'Không thể đọc file Excel. Vui lòng kiểm tra lại định dạng file (.xlsx).',
        );
      }
    } finally {
      setUploadingPreview(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!uploadingPreview && !committing) {
      setDragActive(true);
    }
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (uploadingPreview || committing) {
      return;
    }
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void processSelectedFile(file);
    }
  }

  function openModifiedConfirmDialog(row: ImportPreviewRow) {
    setPendingModifiedRow(row);
    const dialogEl = confirmDialogRef.current;
    if (dialogEl) {
      if (typeof dialogEl.showModal === 'function') {
        if (!dialogEl.open) {
          dialogEl.showModal();
        }
      } else {
        dialogEl.setAttribute('open', '');
      }
    }
  }

  function closeModifiedConfirmDialog() {
    const dialogEl = confirmDialogRef.current;
    if (dialogEl) {
      if (typeof dialogEl.close === 'function' && dialogEl.open) {
        dialogEl.close();
      } else {
        dialogEl.removeAttribute('open');
      }
      dialogEl.returnValue = '';
    }
    setPendingModifiedRow(null);
  }

  function handleConfirmModifiedOverwrite() {
    if (pendingModifiedRow) {
      const targetRowNum = pendingModifiedRow.rowNumber;
      setSelectedRowNumbers((prev) => {
        const next = new Set(prev);
        next.add(targetRowNum);
        return next;
      });
    }
    closeModifiedConfirmDialog();
  }

  function handleRowCheckboxToggle(row: ImportPreviewRow) {
    if (!row.canCommit) {
      return;
    }

    const currentlySelected = selectedRowNumbers.has(row.rowNumber);
    if (currentlySelected) {
      setSelectedRowNumbers((prev) => {
        const next = new Set(prev);
        next.delete(row.rowNumber);
        return next;
      });
      return;
    }

    // Khi người dùng chủ động tick chọn dòng đã đẩy thành công nhưng dữ liệu có sửa -> hỏi xác nhận
    if (row.conflictMode === 'accepted_modified') {
      openModifiedConfirmDialog(row);
      return;
    }

    setSelectedRowNumbers((prev) => {
      const next = new Set(prev);
      next.add(row.rowNumber);
      return next;
    });
  }

  function handleResetDefaultSelection() {
    if (!preview) {
      return;
    }
    const defaults = new Set<number>();
    for (const row of preview.rows) {
      if (row.canCommit && row.defaultSelected) {
        defaults.add(row.rowNumber);
      }
    }
    setSelectedRowNumbers(defaults);
  }

  async function handleCommitImport() {
    if (!preview || selectedRowNumbers.size === 0) {
      return;
    }
    setCommitting(true);
    setErrorMessage(null);
    setErrorCode(null);
    setStatusNotice(null);

    try {
      const result = await commitExcelImport({
        filename: preview.filename,
        rows: preview.rows.map((row) => ({
          rowNumber: row.rowNumber,
          fields: row.fields,
          selected: row.canCommit && selectedRowNumbers.has(row.rowNumber),
        })),
      });

      navigate(`/?batchId=${result.batch.id}`, {
        state: {
          importedBatch: result.batch,
          commitSummary: result,
        },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorCode(err.code);
        setErrorMessage(err.message);
      } else {
        setErrorCode('COMMIT_IMPORT_ERROR');
        setErrorMessage(
          'Không thể lưu dữ liệu vào Danh sách đối soát. Vui lòng thử lại.',
        );
      }
    } finally {
      setCommitting(false);
    }
  }

  // Tính toán thống kê chi tiết cho thẻ tóm tắt và bộ lọc nhanh
  const stats = useMemo(() => {
    if (!preview) {
      return {
        validCleanCount: 0,
        warningReadyCount: 0,
        errorRowCount: 0,
        selectedReadyCount: 0,
        selectedInvalidCount: 0,
        filterCounts: {
          all: 0,
          selected: 0,
          invalid: 0,
          overwrite: 0,
          accepted: 0,
        },
      };
    }

    let validCleanCount = 0;
    let warningReadyCount = 0;
    let errorRowCount = 0;
    let selectedReadyCount = 0;
    let selectedInvalidCount = 0;
    let overwriteFilterCount = 0;
    let acceptedFilterCount = 0;

    for (const row of preview.rows) {
      const health = getRowDataHealth(row.status, row.issues);
      if (health === 'error') {
        errorRowCount += 1;
      } else if (health === 'warning') {
        warningReadyCount += 1;
      } else {
        validCleanCount += 1;
      }

      const isSelected = row.canCommit && selectedRowNumbers.has(row.rowNumber);
      if (isSelected) {
        if (row.status === 'ready') {
          selectedReadyCount += 1;
        } else {
          selectedInvalidCount += 1;
        }
      }

      if (
        row.conflictMode === 'overwrite_pending' ||
        row.conflictMode === 'accepted_modified'
      ) {
        overwriteFilterCount += 1;
      }

      if (
        row.conflictMode === 'accepted_unchanged' ||
        row.conflictMode === 'accepted_modified'
      ) {
        acceptedFilterCount += 1;
      }
    }

    return {
      validCleanCount,
      warningReadyCount,
      errorRowCount,
      selectedReadyCount,
      selectedInvalidCount,
      filterCounts: {
        all: preview.rows.length,
        selected: selectedRowNumbers.size,
        invalid: preview.summary.invalidCount,
        overwrite: overwriteFilterCount,
        accepted: acceptedFilterCount,
      },
    };
  }, [preview, selectedRowNumbers]);

  const filteredRows = useMemo(() => {
    if (!preview) {
      return [];
    }
    return preview.rows.filter((row) => {
      switch (activeFilter) {
        case 'selected':
          return row.canCommit && selectedRowNumbers.has(row.rowNumber);
        case 'invalid':
          return row.status === 'invalid';
        case 'overwrite':
          return (
            row.conflictMode === 'overwrite_pending' ||
            row.conflictMode === 'accepted_modified'
          );
        case 'accepted':
          return (
            row.conflictMode === 'accepted_unchanged' ||
            row.conflictMode === 'accepted_modified'
          );
        case 'all':
        default:
          return true;
      }
    });
  }, [preview, activeFilter, selectedRowNumbers]);

  return (
    <section className="workspace-panel import-page">
      <div className="panel-heading-row">
        <div>
          <h1 id="page-heading" tabIndex={-1}>
            Import Excel GKSK Lái xe (Ghi đè thông minh)
          </h1>
          <p className="panel-subtitle">
            Nạp file Excel chuẩn 23 cột BHXH (hoặc file Excel đối soát 29 cột đã sửa lỗi),
            tự động kiểm tra dữ liệu từng dòng và đối chiếu trùng mã <code>SO</code> với
            CSDL hiện tại.
          </p>
        </div>

        <div className="heading-actions">
          <button
            type="button"
            className="btn-secondary"
            data-testid="download-template-btn"
            onClick={() => {
              void handleDownloadTemplate();
            }}
            disabled={downloadingTemplate}
          >
            {downloadingTemplate
              ? 'Đang tạo file mẫu...'
              : '📥 Tải file Excel mẫu (GKSK_mau_nhap_lieu.xlsx)'}
          </button>
          <Link to="/" className="btn-ghost">
            Quay lại Danh sách &amp; Đối soát
          </Link>
        </div>
      </div>

      {/* Vùng kéo-thả / chọn file .xlsx */}
      <div
        className={`upload-dropzone ${dragActive ? 'upload-dropzone-active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-testid="excel-dropzone"
      >
        <div className="upload-dropzone-content">
          <div className="upload-icon" aria-hidden="true">
            📄
          </div>
          <div className="upload-text-block">
            <label htmlFor={fileInputId} className="upload-title">
              Chọn hoặc kéo-thả file Excel (<code>.xlsx</code>) vào đây để kiểm tra &amp; đối chiếu
            </label>
            <p className="upload-hint" id={`${fileInputId}-hint`}>
              Chấp nhận file <code>.xlsx</code> tối đa 5 MB / 1.000 dòng dữ liệu. Có thể nạp trực
              tiếp file <strong>Excel đối soát 29 cột</strong> sau khi đã sửa lỗi trên Excel — 6 cột
              đối soát cuối sẽ tự động được bỏ qua.
            </p>
          </div>
          <div className="upload-actions">
            <input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-describedby={`${fileInputId}-hint`}
              onChange={handleFileChange}
              className="visually-hidden"
              data-testid="excel-file-input"
              disabled={uploadingPreview || committing}
            />
            <button
              type="button"
              className="btn-primary"
              data-testid="select-excel-btn"
              onClick={() => {
                fileInputRef.current?.click();
              }}
              disabled={uploadingPreview || committing}
            >
              {uploadingPreview ? 'Đang phân tích file Excel...' : 'Chọn file Excel (.xlsx)'}
            </button>
          </div>
        </div>
      </div>

      {/* Thông báo trạng thái tải mẫu */}
      {statusNotice && (
        <div
          className="alert-banner alert-info"
          role="status"
          data-testid="import-status-notice"
        >
          {statusNotice}
        </div>
      )}

      {/* Thông báo lỗi đọc file (thiếu cột bắt buộc, sai định dạng, vượt quá 1000 dòng...) */}
      {errorMessage && (
        <div
          className="alert-banner alert-error"
          role="alert"
          data-testid="import-error-banner"
        >
          <div className="alert-error-header">
            <strong>Không thể nạp file Excel</strong>
            {errorCode && <code className="alert-error-code">{errorCode}</code>}
          </div>
          <p className="alert-error-detail">{errorMessage}</p>
        </div>
      )}

      {/* Khối kết quả xem trước khi đã đọc file Excel thành công */}
      {preview && (
        <div className="import-preview-container" data-testid="import-preview-section">
          <div className="preview-file-bar">
            <div className="preview-file-meta">
              <span className="preview-file-badge">File đang xem trước</span>
              <strong data-testid="preview-filename">{preview.filename}</strong>
              <span className="preview-sheet-name">
                (Sheet: <code>{preview.sheetName}</code> · Khớp {preview.matchedColumns.length}/23 cột)
              </span>
            </div>
            <div className="preview-commit-bar">
              <button
                type="button"
                className="btn-ghost"
                onClick={handleResetDefaultSelection}
                disabled={committing}
                data-testid="reset-default-selection-btn"
              >
                Khôi phục chọn mặc định ({preview.summary.defaultSelectedCount})
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  void handleCommitImport();
                }}
                disabled={committing || selectedRowNumbers.size === 0}
                data-testid="commit-import-btn"
              >
                {committing
                  ? 'Đang lưu vào Danh sách đối soát...'
                  : `Lưu vào Danh sách đối soát (${selectedRowNumbers.size} dòng)`}
              </button>
            </div>
          </div>

          {/* Cảnh báo cột lạ bị bỏ qua (ví dụ 6 cột đối soát khi import lại file đối soát 29 cột) */}
          {preview.ignoredColumns.length > 0 && (
            <div
              className="alert-banner alert-warning"
              role="status"
              data-testid="ignored-columns-banner"
            >
              <strong>
                ⚠️ Đã bỏ qua {preview.ignoredColumns.length} cột không thuộc 25 thẻ chuẩn BHXH:
              </strong>{' '}
              <code>{preview.ignoredColumns.join(', ')}</code>. Dữ liệu ở các cột chuẩn vẫn được đọc
              bình thường.
            </div>
          )}

          {/* Thẻ tóm tắt kết quả đọc file */}
          <div
            className="summary-grid import-summary-grid"
            aria-label="Tóm tắt kết quả đọc file Excel"
            data-testid="import-summary-cards"
          >
            <div className="summary-tile tile-all" data-testid="summary-card-total">
              <span className="summary-tile-label">Tổng số dòng đọc được</span>
              <strong className="summary-tile-value">{preview.summary.totalRows}</strong>
              <span className="summary-tile-note">
                Đang chọn lưu: <strong>{selectedRowNumbers.size}</strong> dòng (
                {stats.selectedReadyCount} hợp lệ · {stats.selectedInvalidCount} lỗi dữ liệu)
              </span>
            </div>

            <div className="summary-tile tile-ready" data-testid="summary-card-ready">
              <span className="summary-tile-label">Hợp lệ (Sẵn sàng đẩy)</span>
              <strong className="summary-tile-value">{preview.summary.readyCount}</strong>
              <span className="summary-tile-note">
                ✅ {stats.validCleanCount} không cảnh báo · ⚠️ {stats.warningReadyCount} có cảnh báo
              </span>
            </div>

            <div className="summary-tile tile-attention" data-testid="summary-card-invalid">
              <span className="summary-tile-label">Lỗi dữ liệu (invalid)</span>
              <strong className="summary-tile-value">{preview.summary.invalidCount}</strong>
              <span className="summary-tile-note">
                ⛔ {preview.summary.invalidCount - preview.summary.missingSoCount} dòng có SO (vẫn lưu
                đối soát) · {preview.summary.missingSoCount} thiếu/trùng SO
              </span>
            </div>

            <div className="summary-tile tile-overwrite" data-testid="summary-card-overwrite">
              <span className="summary-tile-label">Đối chiếu mới &amp; Ghi đè bản chưa đẩy</span>
              <strong className="summary-tile-value">
                {preview.summary.overwritePendingCount}
              </strong>
              <span className="summary-tile-note">
                🔄 {preview.summary.overwritePendingCount} ghi đè bản chưa đẩy · 🆕{' '}
                {preview.summary.newCount} bản ghi mới
              </span>
            </div>

            <div className="summary-tile tile-accepted" data-testid="summary-card-accepted">
              <span className="summary-tile-label">Đã đẩy thành công lên Sở</span>
              <strong className="summary-tile-value">
                {preview.summary.acceptedUnchangedCount +
                  preview.summary.acceptedModifiedCount}
              </strong>
              <span className="summary-tile-note">
                ⏭️ {preview.summary.acceptedUnchangedCount} không đổi (bỏ qua) · ⚠️{' '}
                {preview.summary.acceptedModifiedCount} có sửa dữ liệu
              </span>
            </div>
          </div>

          {/* Thanh bộ lọc nhanh trên bảng xem trước */}
          <div className="preview-toolbar">
            <div
              className="filter-pill-group"
              role="group"
              aria-label="Bộ lọc nhanh bảng xem trước"
            >
              {(
                [
                  {
                    key: 'all' as const,
                    label: 'Tất cả',
                    count: stats.filterCounts.all,
                  },
                  {
                    key: 'selected' as const,
                    label: 'Được chọn lưu',
                    count: stats.filterCounts.selected,
                  },
                  {
                    key: 'invalid' as const,
                    label: 'Có lỗi dữ liệu',
                    count: stats.filterCounts.invalid,
                  },
                  {
                    key: 'overwrite' as const,
                    label: 'Ghi đè',
                    count: stats.filterCounts.overwrite,
                  },
                  {
                    key: 'accepted' as const,
                    label: 'Đã đẩy thành công',
                    count: stats.filterCounts.accepted,
                  },
                ] as const
              ).map((tab) => {
                const isActive = activeFilter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    className={`filter-pill ${isActive ? 'filter-pill-active' : ''}`}
                    aria-pressed={isActive}
                    data-testid={`preview-filter-${tab.key}`}
                    onClick={() => {
                      setActiveFilter(tab.key);
                    }}
                  >
                    <span>{tab.label}</span>
                    <span className="filter-pill-count">{tab.count}</span>
                  </button>
                );
              })}
            </div>

            <div className="preview-rule-hint">
              💡 <strong>Quy tắc đối soát 100% quân số:</strong> Các dòng mới và dòng ghi đè bản chưa
              đẩy (kể cả dòng <code>invalid</code> có mã <code>SO</code>) đều mặc định được chọn lưu.
            </div>
          </div>

          {/* Bảng xem trước từng dòng (responsive-table guide) */}
          {preview.rows.length === 0 ? (
            <div className="empty-preview-box" data-testid="empty-preview-message">
              File Excel chỉ có dòng tiêu đề, không có dòng dữ liệu nào.
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="empty-preview-box" data-testid="empty-filter-message">
              Không có dòng nào khớp với bộ lọc hiện tại.
            </div>
          ) : (
            <div
              tabIndex={0}
              role="region"
              aria-labelledby={tableCaptionId}
              className="table-wrapper"
              data-testid="preview-table-region"
            >
              <table className="preview-table" data-testid="import-preview-table">
                <caption id={tableCaptionId} className="visually-hidden">
                  Bảng xem trước {filteredRows.length} dòng dữ liệu Import Excel GKSK Lái xe
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="col-select">
                      Chọn lưu
                    </th>
                    <th scope="col" className="col-row-num">
                      Dòng Excel
                    </th>
                    <th scope="col" className="col-so">
                      Số giấy (SO)
                    </th>
                    <th scope="col" className="col-hoten">
                      Họ tên (HOTEN)
                    </th>
                    <th scope="col" className="col-ngaysinh">
                      Ngày sinh
                    </th>
                    <th scope="col" className="col-ketluan">
                      Kết luận
                    </th>
                    <th scope="col" className="col-data-badge">
                      Trạng thái dữ liệu
                    </th>
                    <th scope="col" className="col-conflict-badge">
                      Đối chiếu DB
                    </th>
                    <th scope="col" className="col-issues">
                      Chi tiết lỗi / cảnh báo tiếng Việt
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const isChecked =
                      row.canCommit && selectedRowNumbers.has(row.rowNumber);
                    const dataBadge = getDataHealthBadge(row.status, row.issues);
                    const conflictBadge = getConflictBadgeMeta(row);
                    const checkboxId = `select-row-${row.rowNumber}`;

                    return (
                      <tr
                        key={row.rowNumber}
                        data-testid={`preview-row-${row.rowNumber}`}
                        className={`preview-row ${
                          row.status === 'invalid' ? 'preview-row-invalid' : ''
                        } ${
                          row.conflictMode === 'accepted_modified'
                            ? 'preview-row-accepted-modified'
                            : ''
                        } ${!isChecked ? 'preview-row-unselected' : ''}`}
                      >
                        <th scope="row" className="col-select">
                          <label
                            htmlFor={checkboxId}
                            className={`checkbox-label ${
                              !row.canCommit ? 'checkbox-label-disabled' : ''
                            }`}
                          >
                            <input
                              id={checkboxId}
                              type="checkbox"
                              className="brand-checkbox"
                              checked={isChecked}
                              disabled={!row.canCommit || committing}
                              onChange={() => {
                                handleRowCheckboxToggle(row);
                              }}
                              aria-label={`Chọn lưu dòng Excel ${row.rowNumber} (${
                                row.so || 'Thiếu mã SO'
                              })`}
                              data-testid={`row-checkbox-${row.rowNumber}`}
                            />
                            <span className="checkbox-text">
                              {isChecked ? 'Lưu' : 'Bỏ qua'}
                            </span>
                          </label>
                        </th>

                        <td className="col-row-num" data-testid={`row-num-${row.rowNumber}`}>
                          <span className="excel-row-pill">#{row.rowNumber}</span>
                        </td>

                        <td className="col-so" data-testid={`row-so-${row.rowNumber}`}>
                          {row.so ? (
                            <code className="so-code">{row.so}</code>
                          ) : (
                            <span className="missing-so-text">(Trống SO)</span>
                          )}
                        </td>

                        <td className="col-hoten">
                          <strong>{row.fields.HOTEN || '—'}</strong>
                        </td>

                        <td className="col-ngaysinh">{row.fields.NGAYSINH || '—'}</td>

                        <td className="col-ketluan">
                          {row.fields.KETLUAN ? (
                            <code className="ketluan-code">{row.fields.KETLUAN}</code>
                          ) : (
                            '—'
                          )}
                        </td>

                        <td className="col-data-badge">
                          <span
                            className={`status-pill ${dataBadge.className}`}
                            data-testid={`row-data-badge-${row.rowNumber}`}
                          >
                            <span aria-hidden="true">{dataBadge.icon}</span>{' '}
                            {dataBadge.label}
                          </span>
                        </td>

                        <td className="col-conflict-badge">
                          <span
                            className={`status-pill ${conflictBadge.className}`}
                            title={conflictBadge.description}
                            data-testid={`row-conflict-badge-${row.rowNumber}`}
                          >
                            {conflictBadge.label}
                          </span>
                        </td>

                        <td className="col-issues">
                          <IssueList
                            issues={row.issues}
                            compact
                            emptyText="✅ Dữ liệu hợp lệ, không có cảnh báo"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Hộp thoại native <dialog> xác nhận khi người dùng chủ động tick dòng accepted_modified (dialog guide) */}
      <dialog
        ref={confirmDialogRef}
        className="confirm-dialog"
        aria-labelledby={confirmDialogTitleId}
        data-testid="confirm-overwrite-accepted-dialog"
        onClose={() => {
          if (confirmDialogRef.current) {
            confirmDialogRef.current.returnValue = '';
          }
          setPendingModifiedRow(null);
        }}
      >
        <div className="confirm-dialog-inner">
          <h1 id={confirmDialogTitleId} className="confirm-dialog-title">
            ⚠️ Xác nhận ghi đè giấy đã đẩy thành công lên Sở?
          </h1>
          {pendingModifiedRow && (
            <div className="confirm-dialog-body">
              <p>
                Giấy khám sức khỏe có mã số{' '}
                <code>{pendingModifiedRow.so}</code> (Dòng Excel{' '}
                <strong>#{pendingModifiedRow.rowNumber}</strong> — Họ tên:{' '}
                <strong>{pendingModifiedRow.fields.HOTEN}</strong>) đã được đẩy{' '}
                <strong>thành công (accepted)</strong> lên Hệ thống Sở Y tế trước đó.
              </p>
              <p>
                Dữ liệu trong file Excel lần này <strong>có thay đổi</strong> so với bản đã đẩy.
                Nếu bạn chọn ghi đè và lưu, trạng thái nội bộ của giấy sẽ chuyển về{' '}
                <code>{pendingModifiedRow.status}</code> để chờ đẩy bản cập nhật đè lên Hệ thống Sở.
              </p>
            </div>
          )}
          <div className="confirm-dialog-actions">
            <button
              type="button"
              className="btn-secondary"
              autoFocus
              data-testid="cancel-overwrite-accepted-btn"
              onClick={closeModifiedConfirmDialog}
            >
              Hủy (Giữ nguyên bản đã đẩy)
            </button>
            <button
              type="button"
              className="btn-danger"
              data-testid="confirm-overwrite-accepted-btn"
              onClick={handleConfirmModifiedOverwrite}
            >
              Xác nhận chọn ghi đè
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}
