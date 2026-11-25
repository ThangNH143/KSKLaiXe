import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyRecord, type GkskRecord } from '@gksk/shared';
import type {
  CommitImportResponse,
  ImportPreviewResponse,
  ImportPreviewRow,
} from '../api';
import { IssueList } from '../components/IssueList';
import { ImportPage } from './ImportPage';

function makeRecord(overrides: Partial<GkskRecord> = {}): GkskRecord {
  const base = createEmptyRecord();
  return {
    ...base,
    SO: 'TEST.75001.0001',
    NGAYKHAM: '05/11/2026',
    HOTEN: 'TEST NGUYEN VAN A',
    GIOITINHVAL: '0',
    NGAYSINH: '21/05/1990',
    SOCMND_PASSPORT: 'TESTGKSK01',
    IDBENHVIEN: '75001',
    BENHVIEN: 'Benh vien Da khoa Dong Nai',
    NGAYKETLUAN: '06/11/2026',
    KETLUAN: 'A0-1',
    STATE: 'ADD',
    ...overrides,
  };
}

function makePreviewRow(
  rowNumber: number,
  overrides: Partial<ImportPreviewRow> = {},
): ImportPreviewRow {
  const so = overrides.so ?? `TEST.75001.000${rowNumber}`;
  const fields = makeRecord({
    SO: so,
    HOTEN: `TEST NGUYEN VAN ${rowNumber}`,
    ...(overrides.fields ?? {}),
  });
  return {
    rowNumber,
    so,
    fields,
    dataSha256: `SHA256_ROW_${rowNumber}`,
    status: 'ready',
    conflictMode: 'new',
    canCommit: true,
    defaultSelected: true,
    existingCertificateId: null,
    existingStatus: null,
    issues: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ReconcileTargetProbe() {
  const location = useLocation();
  return (
    <div data-testid="reconcile-destination">
      <h1>Danh sách &amp; Đối soát GKSK Lái xe</h1>
      <span data-testid="reconcile-query">{location.search}</span>
    </div>
  );
}

describe('S14 — IssueList & ImportPage (Import Excel ghi đè thông minh)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. IssueList hiển thị đúng huy hiệu mức độ (⛔/⚠️/ℹ️), mã lỗi và thông điệp tiếng Việt có dấu', () => {
    render(
      <IssueList
        issues={[
          {
            code: 'GKSK_NGAYSINH_INVALID',
            field: 'NGAYSINH',
            severity: 'error',
            source: 'server-mirror',
          },
          {
            code: 'LOCAL_FIELD_OVER_SPEC',
            field: 'NOICAP',
            severity: 'warning',
            source: 'local',
          },
          {
            code: 'LOCAL_BHXH_REQUIRED_EMPTY',
            field: null,
            fields: ['DIACHITHUONGTRU', 'BACSYKETLUAN'],
            severity: 'info',
            source: 'local',
          },
        ]}
      />,
    );

    const errItem = screen.getByTestId('issue-item-GKSK_NGAYSINH_INVALID');
    expect(errItem).toHaveTextContent('GKSK_NGAYSINH_INVALID');
    expect(errItem).toHaveTextContent('[Ngày sinh (NGAYSINH)]');
    expect(errItem).toHaveTextContent('dd/MM/yyyy');

    const warnItem = screen.getByTestId('issue-item-LOCAL_FIELD_OVER_SPEC');
    expect(warnItem).toHaveTextContent('LOCAL_FIELD_OVER_SPEC');
    expect(warnItem).toHaveTextContent('[Nơi cấp (NOICAP)]');

    const infoItem = screen.getByTestId('issue-item-LOCAL_BHXH_REQUIRED_EMPTY');
    expect(infoItem).toHaveTextContent('DIACHITHUONGTRU, BACSYKETLUAN');
  });

  it('2. Nút Tải file Excel mẫu gọi GET /api/import/template và hiển thị thông báo đã tải', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
          status: 200,
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition':
              'attachment; filename="GKSK_mau_nhap_lieu.xlsx"',
          },
        }),
      );

    render(
      <MemoryRouter initialEntries={['/import']}>
        <ImportPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('download-template-btn'));

    const notice = await screen.findByTestId('import-status-notice');
    expect(notice).toHaveTextContent('GKSK_mau_nhap_lieu.xlsx');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/import/template',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('3. Hiển thị đúng số đếm ✅/⚠️/⛔, huy hiệu đối chiếu DB, dòng invalid có SO vẫn mặc định tick, dòng thiếu SO khóa checkbox và bộ lọc nhanh hoạt động đúng', async () => {
    const rows: ImportPreviewRow[] = [
      // Dòng 2: Hợp lệ hoàn toàn (✅), Mới
      makePreviewRow(2, {
        so: 'TEST.75001.0001',
        status: 'ready',
        conflictMode: 'new',
        canCommit: true,
        defaultSelected: true,
        issues: [],
      }),
      // Dòng 3: Hợp lệ nhưng có cảnh báo (⚠️), Mới
      makePreviewRow(3, {
        so: 'TEST.75001.0002',
        status: 'ready',
        conflictMode: 'new',
        canCommit: true,
        defaultSelected: true,
        issues: [
          {
            code: 'LOCAL_FIELD_OVER_SPEC',
            field: 'NOICAP',
            severity: 'warning',
            source: 'local',
          },
        ],
      }),
      // Dòng 4: Lỗi dữ liệu chặn (⛔) NHƯNG có mã SO hợp lệ -> vẫn defaultSelected=true để lưu 100% quân số đối soát
      makePreviewRow(4, {
        so: 'TEST.75001.0003',
        status: 'invalid',
        conflictMode: 'new',
        canCommit: true,
        defaultSelected: true,
        issues: [
          {
            code: 'GKSK_NGAYSINH_INVALID',
            field: 'NGAYSINH',
            severity: 'error',
            source: 'server-mirror',
          },
        ],
      }),
      // Dòng 5: Thiếu mã SO -> canCommit=false, defaultSelected=false, khóa checkbox
      makePreviewRow(5, {
        so: '',
        fields: makeRecord({ SO: '', HOTEN: 'TEST KHONG CO SO' }),
        status: 'invalid',
        conflictMode: 'missing_so',
        canCommit: false,
        defaultSelected: false,
        issues: [
          {
            code: 'GKSK_SO_MISSING',
            field: 'SO',
            severity: 'error',
            source: 'server-mirror',
          },
        ],
      }),
    ];

    const previewPayload: ImportPreviewResponse = {
      filename: 'mixed_valid_invalid.xlsx',
      sheetName: 'GKSK',
      matchedColumns: [
        'SO',
        'HOTEN',
        'NGAYSINH',
        'SOCMND_PASSPORT',
        'KETLUAN',
        'NGAYKETLUAN',
      ],
      ignoredColumns: ['TRANG_THAI_DOI_SOAT', 'MSG_ID'],
      summary: {
        totalRows: 4,
        readyCount: 2,
        invalidCount: 2,
        newCount: 3,
        overwritePendingCount: 0,
        acceptedUnchangedCount: 0,
        acceptedModifiedCount: 0,
        missingSoCount: 1,
        defaultSelectedCount: 3,
      },
      rows,
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(previewPayload, 200),
    );

    render(
      <MemoryRouter initialEntries={['/import']}>
        <ImportPage />
      </MemoryRouter>,
    );

    const fileInput = screen.getByTestId('excel-file-input');
    const mockFile = new File(['dummy'], 'mixed_valid_invalid.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await screen.findByTestId('import-preview-section');

    // Cảnh báo cột lạ bị bỏ qua
    expect(screen.getByTestId('ignored-columns-banner')).toHaveTextContent(
      'TRANG_THAI_DOI_SOAT, MSG_ID',
    );

    // Thẻ tóm tắt
    expect(screen.getByTestId('summary-card-total')).toHaveTextContent('4');
    expect(screen.getByTestId('summary-card-ready')).toHaveTextContent('2');
    expect(screen.getByTestId('summary-card-ready')).toHaveTextContent(
      '✅ 1 không cảnh báo · ⚠️ 1 có cảnh báo',
    );
    expect(screen.getByTestId('summary-card-invalid')).toHaveTextContent('2');

    // Huy hiệu trạng thái dữ liệu của 4 dòng
    expect(screen.getByTestId('row-data-badge-2')).toHaveTextContent('✅ Hợp lệ');
    expect(screen.getByTestId('row-data-badge-3')).toHaveTextContent('⚠️ Có cảnh báo');
    expect(screen.getByTestId('row-data-badge-4')).toHaveTextContent('⛔ Lỗi dữ liệu');
    expect(screen.getByTestId('row-data-badge-5')).toHaveTextContent('⛔ Lỗi dữ liệu');

    // Kiểm tra checkbox: dòng 2, 3, 4 (kể cả dòng 4 invalid có SO) đều được tick; dòng 5 thiếu SO bị khóa
    const cb2 = screen.getByTestId('row-checkbox-2') as HTMLInputElement;
    const cb3 = screen.getByTestId('row-checkbox-3') as HTMLInputElement;
    const cb4 = screen.getByTestId('row-checkbox-4') as HTMLInputElement;
    const cb5 = screen.getByTestId('row-checkbox-5') as HTMLInputElement;

    expect(cb2.checked).toBe(true);
    expect(cb3.checked).toBe(true);
    expect(cb4.checked).toBe(true);
    expect(cb4.disabled).toBe(false);
    expect(cb5.checked).toBe(false);
    expect(cb5.disabled).toBe(true);

    // Kiểm tra bộ lọc nhanh: bấm "Có lỗi dữ liệu" chỉ hiện dòng 4 và 5
    fireEvent.click(screen.getByTestId('preview-filter-invalid'));
    expect(screen.queryByTestId('preview-row-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('preview-row-3')).not.toBeInTheDocument();
    expect(screen.getByTestId('preview-row-4')).toBeInTheDocument();
    expect(screen.getByTestId('preview-row-5')).toBeInTheDocument();

    // Bấm "Được chọn lưu" -> hiện dòng 2, 3, 4
    fireEvent.click(screen.getByTestId('preview-filter-selected'));
    expect(screen.getByTestId('preview-row-2')).toBeInTheDocument();
    expect(screen.getByTestId('preview-row-3')).toBeInTheDocument();
    expect(screen.getByTestId('preview-row-4')).toBeInTheDocument();
    expect(screen.queryByTestId('preview-row-5')).not.toBeInTheDocument();
  });

  it('4. Ghi đè thông minh: overwrite_pending mặc định tick, accepted_unchanged và accepted_modified mặc định bỏ chọn, tick tay accepted_modified bật hộp xác nhận rồi Lưu chuyển về trang Danh sách & Đối soát', async () => {
    const rows: ImportPreviewRow[] = [
      // Dòng 2: Ghi đè bản chưa đẩy (overwrite_pending) -> mặc định chọn
      makePreviewRow(2, {
        so: 'TEST.75001.0101',
        status: 'ready',
        conflictMode: 'overwrite_pending',
        canCommit: true,
        defaultSelected: true,
        existingCertificateId: 101,
        existingStatus: 'invalid',
        issues: [
          {
            code: 'LOCAL_SO_EXISTS',
            field: 'SO',
            severity: 'info',
            source: 'local',
          },
        ],
      }),
      // Dòng 3: Đã đẩy thành công - Không đổi (accepted_unchanged) -> mặc định BỎ CHỌN
      makePreviewRow(3, {
        so: 'TEST.75001.0102',
        status: 'ready',
        conflictMode: 'accepted_unchanged',
        canCommit: true,
        defaultSelected: false,
        existingCertificateId: 102,
        existingStatus: 'accepted',
        issues: [
          {
            code: 'LOCAL_SO_ACCEPTED_UNCHANGED',
            field: 'SO',
            severity: 'info',
            source: 'local',
          },
        ],
      }),
      // Dòng 4: Đã đẩy thành công - Có sửa (accepted_modified) -> mặc định BỎ CHỌN, tick tay bật xác nhận
      makePreviewRow(4, {
        so: 'TEST.75001.0103',
        status: 'ready',
        conflictMode: 'accepted_modified',
        canCommit: true,
        defaultSelected: false,
        existingCertificateId: 103,
        existingStatus: 'accepted',
        issues: [
          {
            code: 'LOCAL_SO_ACCEPTED_MODIFIED',
            field: 'SO',
            severity: 'warning',
            source: 'local',
          },
        ],
      }),
    ];

    const previewPayload: ImportPreviewResponse = {
      filename: 'reimport_overwrite.xlsx',
      sheetName: 'GKSK',
      matchedColumns: [
        'SO',
        'HOTEN',
        'NGAYSINH',
        'SOCMND_PASSPORT',
        'KETLUAN',
        'NGAYKETLUAN',
      ],
      ignoredColumns: [],
      summary: {
        totalRows: 3,
        readyCount: 3,
        invalidCount: 0,
        newCount: 0,
        overwritePendingCount: 1,
        acceptedUnchangedCount: 1,
        acceptedModifiedCount: 1,
        missingSoCount: 0,
        defaultSelectedCount: 1,
      },
      rows,
    };

    const commitResponse: CommitImportResponse = {
      batch: {
        id: 42,
        filename: 'reimport_overwrite.xlsx',
        rowCount: 2,
        createdAt: '2026-11-25T09:00:00.000Z',
      },
      totalCommitted: 2,
      inserted: 0,
      updated: 2,
      readyCount: 2,
      invalidCount: 0,
      skippedCount: 1,
    };

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === '/api/import/excel') {
          return jsonResponse(previewPayload, 200);
        }
        if (url === '/api/import/commit') {
          return jsonResponse(commitResponse, 200);
        }
        return jsonResponse({ ok: true }, 200);
      });

    render(
      <MemoryRouter initialEntries={['/import']}>
        <Routes>
          <Route path="/import" element={<ImportPage />} />
          <Route path="/" element={<ReconcileTargetProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const fileInput = screen.getByTestId('excel-file-input');
    const mockFile = new File(['dummy'], 'reimport_overwrite.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(fileInput, { target: { files: [mockFile] } });

    await screen.findByTestId('import-preview-section');

    // Kiểm tra huy hiệu đối chiếu DB
    expect(screen.getByTestId('row-conflict-badge-2')).toHaveTextContent(
      'Ghi đè bản cũ',
    );
    expect(screen.getByTestId('row-conflict-badge-3')).toHaveTextContent(
      'Đã đẩy - Không đổi',
    );
    expect(screen.getByTestId('row-conflict-badge-4')).toHaveTextContent(
      'Đã đẩy - Có sửa',
    );

    const cb2 = screen.getByTestId('row-checkbox-2') as HTMLInputElement;
    const cb3 = screen.getByTestId('row-checkbox-3') as HTMLInputElement;
    const cb4 = screen.getByTestId('row-checkbox-4') as HTMLInputElement;

    expect(cb2.checked).toBe(true);
    expect(cb3.checked).toBe(false);
    expect(cb4.checked).toBe(false);

    // Chủ động tick dòng 4 (accepted_modified) -> chưa tick ngay mà bật hộp thoại xác nhận
    fireEvent.click(cb4);
    expect(cb4.checked).toBe(false);
    const dialog = screen.getByTestId('confirm-overwrite-accepted-dialog');
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveTextContent('TEST.75001.0103');

    // Bấm Hủy trước -> vẫn chưa được chọn
    fireEvent.click(screen.getByTestId('cancel-overwrite-accepted-btn'));
    expect(cb4.checked).toBe(false);

    // Tick lại dòng 4 rồi bấm Xác nhận chọn ghi đè -> dòng 4 được chọn
    fireEvent.click(cb4);
    fireEvent.click(screen.getByTestId('confirm-overwrite-accepted-btn'));
    expect(cb4.checked).toBe(true);
    expect(screen.getByTestId('commit-import-btn')).toHaveTextContent(
      'Lưu vào Danh sách đối soát (2 dòng)',
    );

    // Bấm Lưu vào Danh sách đối soát -> gọi POST /api/import/commit và chuyển về /?batchId=42
    fireEvent.click(screen.getByTestId('commit-import-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('reconcile-destination')).toBeInTheDocument();
    });
    expect(screen.getByTestId('reconcile-query')).toHaveTextContent('?batchId=42');

    const commitCall = fetchSpy.mock.calls.find(
      ([url]) => url === '/api/import/commit',
    );
    expect(commitCall).toBeDefined();
    const sentBody = JSON.parse(String(commitCall?.[1]?.body ?? '{}')) as {
      filename: string;
      rows: Array<{ rowNumber: number; selected: boolean }>;
    };
    expect(sentBody.filename).toBe('reimport_overwrite.xlsx');
    expect(
      sentBody.rows.map((r) => ({ rowNumber: r.rowNumber, selected: r.selected })),
    ).toEqual([
      { rowNumber: 2, selected: true },
      { rowNumber: 3, selected: false },
      { rowNumber: 4, selected: true },
    ]);
  });

  it('5. File thiếu cột bắt buộc hiển thị thông báo lỗi liệt kê rõ tên cột thiếu và không có form nhập/sửa tay', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'EXCEL_MISSING_REQUIRED_COLUMNS',
            message: 'File Excel thiếu các cột bắt buộc: KETLUAN.',
          },
        },
        400,
      ),
    );

    render(
      <MemoryRouter initialEntries={['/import']}>
        <ImportPage />
      </MemoryRouter>,
    );

    const fileInput = screen.getByTestId('excel-file-input');
    const badFile = new File(['dummy'], 'missing_required_col.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(fileInput, { target: { files: [badFile] } });

    const errorBanner = await screen.findByTestId('import-error-banner');
    expect(errorBanner).toHaveAttribute('role', 'alert');
    expect(errorBanner).toHaveTextContent('EXCEL_MISSING_REQUIRED_COLUMNS');
    expect(errorBanner).toHaveTextContent(
      'File Excel thiếu các cột bắt buộc: KETLUAN.',
    );
    expect(
      screen.queryByTestId('import-preview-section'),
    ).not.toBeInTheDocument();
  });
});
