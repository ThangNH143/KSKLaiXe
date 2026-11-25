import { useEffect, useId, useRef, useState } from 'react';
import type { CertificateStatus } from '@gksk/shared';
import { ApiError, downloadCertificateXml } from '../api';

export interface XmlPreviewProps {
  readonly certificateId: number;
  readonly so: string;
  readonly status: CertificateStatus;
  readonly xml: string | null;
  readonly dataSha256: string;
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
 * Fallback sao chép đồng bộ khi `navigator.clipboard.writeText` không khả dụng
 * hoặc bị từ chối quyền (copy-button guide — modern-web-guidance).
 */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const field = Object.assign(document.createElement('textarea'), {
    value: text,
  });
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
  document.body.append(field);
  field.select();
  try {
    return typeof document.execCommand === 'function'
      ? document.execCommand('copy')
      : false;
  } catch {
    return false;
  } finally {
    field.remove();
    previousFocus?.focus({ preventScroll: true });
  }
}

let lastCopyAnnouncement = '';

/**
 * S16 — Khung Xem trước XML (`XmlPreview.tsx`) trong Ngăn trượt Chi tiết chỉ đọc:
 * - Hiển thị mã nguồn XML chuẩn 25 thẻ theo thứ tự bảng BHXH (gốc `<root>`, không BOM, không DOCTYPE).
 * - Nút **Sao chép XML** áp dụng chuẩn `copy-button` (`command="--copy"`, `commandfor`, live region `role="status"` bên ngoài nút).
 * - Nút **Tải `<SO>.xml`** (ẩn nếu giấy đang ở trạng thái `invalid`).
 */
export function XmlPreview({
  certificateId,
  so,
  status,
  xml,
  dataSha256,
}: XmlPreviewProps) {
  const xmlCodeId = useId();
  const copyBtnRef = useRef<HTMLButtonElement | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [copyOutcome, setCopyOutcome] = useState<'idle' | 'copied' | 'failed'>(
    'idle',
  );
  const [copyTipText, setCopyTipText] = useState<string>('');
  const [downloading, setDownloading] = useState<boolean>(false);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  function reportCopyResult(ok: boolean) {
    const button = copyBtnRef.current;
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }

    if (button) {
      button.removeAttribute('data-copied');
      button.removeAttribute('data-failed');
    }

    let message = ok ? 'Đã sao chép XML' : 'Sao chép thất bại';
    if (message === lastCopyAnnouncement) {
      message += '\u00A0';
    }
    lastCopyAnnouncement = message;

    setCopyOutcome(ok ? 'copied' : 'failed');
    setCopyTipText(message);

    if (button) {
      button.setAttribute(ok ? 'data-copied' : 'data-failed', '');
    }

    copyTimerRef.current = setTimeout(() => {
      if (copyBtnRef.current) {
        copyBtnRef.current.removeAttribute('data-copied');
        copyBtnRef.current.removeAttribute('data-failed');
      }
      setCopyOutcome('idle');
      setCopyTipText('');
      copyTimerRef.current = null;
    }, 2000);
  }

  async function handleCopyXml() {
    const text = xml?.trim() ?? '';
    if (!text) {
      return;
    }
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(text);
      } else if (!legacyCopy(text)) {
        throw new Error('Copy failed');
      }
      reportCopyResult(true);
    } catch {
      if (legacyCopy(text)) {
        reportCopyResult(true);
      } else {
        reportCopyResult(false);
      }
    }
  }

  async function handleDownloadXml() {
    if (status === 'invalid') {
      return;
    }
    setDownloading(true);
    setDownloadError(null);
    setDownloadMessage(null);
    try {
      const result = await downloadCertificateXml(certificateId);
      triggerBrowserFileDownload(result.blob, result.fileName);
      setDownloadMessage(`Đã tải file "${result.fileName}".`);
    } catch (err) {
      if (err instanceof ApiError) {
        setDownloadError(err.message);
      } else {
        setDownloadError(`Không thể tải file XML cho số giấy ${so}.`);
      }
    } finally {
      setDownloading(false);
    }
  }

  const isInvalid = status === 'invalid' || !xml;

  if (isInvalid) {
    return (
      <div
        className="xml-preview-invalid-box"
        role="alert"
        data-testid="xml-preview-invalid"
      >
        <strong>⛔ Không thể dựng XML cho giấy đang có lỗi dữ liệu chặn</strong>
        <p>
          Giấy khám sức khỏe số <code>{so}</code> đang ở trạng thái{' '}
          <code>invalid</code> (thiếu trường bắt buộc của Sở hoặc sai định dạng ngày).
          Vui lòng sửa dữ liệu trên file Excel gốc (hoặc file Excel đối soát 29 cột)
          rồi Import lại để ghi đè theo mã <code>SO</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="xml-preview-container" data-testid="xml-preview-container">
      <div className="xml-preview-toolbar" data-testid="xml-preview-toolbar">
        <div className="xml-preview-meta">
          <span className="xml-meta-badge">
            Gốc <code>&lt;root&gt;</code> · 25 thẻ chuẩn BHXH · UTF-8
          </span>
          {dataSha256 && (
            <span
              className="xml-sha-meta"
              title={`SHA-256 (Base64 data): ${dataSha256}`}
              data-testid="xml-preview-sha256"
            >
              SHA-256: <code>{dataSha256.slice(0, 16)}…</code>
            </span>
          )}
        </div>

        <div className="xml-preview-actions">
          {/* Copy button pattern (copy-button guide — modern-web-guidance) */}
          <span className="copy-control-wrap">
            <button
              ref={copyBtnRef}
              type="button"
              className="btn-secondary btn-sm copy-button"
              data-testid="copy-xml-btn"
              onClick={() => {
                void handleCopyXml();
              }}
              {...({
                command: '--copy',
                commandfor: xmlCodeId,
              } as Record<string, string>)}
            >
              <span className="copy-icon" aria-hidden="true">
                {copyOutcome === 'copied'
                  ? '✓'
                  : copyOutcome === 'failed'
                    ? '✕'
                    : '📋'}
              </span>{' '}
              <span>
                {copyOutcome === 'copied' ? 'Đã sao chép XML' : 'Sao chép XML'}
              </span>
            </button>
            <span
              className={`copy-tip ${
                copyOutcome !== 'idle' ? 'copy-tip-visible' : ''
              }`}
              role="status"
              data-testid="copy-xml-status"
            >
              {copyTipText}
            </span>
          </span>

          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={downloading}
            onClick={() => {
              void handleDownloadXml();
            }}
            data-testid="drawer-download-xml-btn"
          >
            {downloading ? 'Đang tải...' : `📥 Tải ${so}.xml`}
          </button>
        </div>
      </div>

      {downloadMessage && (
        <div
          className="alert-banner alert-info"
          role="status"
          data-testid="xml-download-notice"
        >
          {downloadMessage}
        </div>
      )}

      {downloadError && (
        <div
          className="alert-banner alert-error"
          role="alert"
          data-testid="xml-download-error"
        >
          {downloadError}
        </div>
      )}

      <pre
        tabIndex={0}
        className="xml-code-block"
        aria-label={`Mã nguồn XML của số giấy ${so}`}
        data-testid="xml-preview-pre"
      >
        <code id={xmlCodeId} data-testid="xml-preview-code">
          {xml}
        </code>
      </pre>
    </div>
  );
}
