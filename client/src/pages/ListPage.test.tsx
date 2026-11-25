import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyRecord, SENSITIVE_TAGS, type GkskListFields } from '@gksk/shared';
import type {
  CertificateListItem,
  CertificateListResponse,
  ImportBatchItem,
  ReconcileCounts,
} from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { ListPage } from './ListPage';

function makeSafeFields(overrides: Partial<GkskListFields> = {}): GkskListFields {
  const full = createEmptyRecord();
  const safe: Record<string, string> = {};
  for (const [key, val] of Object.entries(full)) {
    if (!(SENSITIVE_TAGS as readonly string[]).includes(key)) {
      safe[key] = val;
    }
  }
  return {
    ...(safe as GkskListFields),
    SO: 'TEST.75001.0001',
    NGAYKHAM: '05/11/2026',
    HOTEN: 'TEST NGUYEN VAN A',
    GIOITINHVAL: '0',
    NGAYSINH: '21/05/1990',
    SOCMND_PASSPORT: 'TESTGKSK01',
    HANGBANGLAI: 'B2',
    IDBENHVIEN: '75001',
    BENHVIEN: 'Benh vien Da khoa Dong Nai',
    NGAYKETLUAN: '06/11/2026',
    KETLUAN: 'A0-1',
    STATE: 'ADD',
    ...overrides,
  };
}

const SAMPLE_COUNTS: ReconcileCounts = {
  all: 6,
  unsent: 1,
  accepted: 2,
  attention: 3,
  ready: 1,
  invalid: 1,
  rejected: 1,
  error: 1,
  sending: 0,
};

const SAMPLE_BATCHES: ImportBatchItem[] = [
  {
    id: 1,
    filename: 'dot_1_s15.xlsx',
    rowCount: 4,
    createdAt: '2026-11-25T08:00:00.000Z',
  },
  {
    id: 2,
    filename: 'dot_2_bo_sung.xlsx',
    rowCount: 2,
    createdAt: '2026-11-25T09:00:00.000Z',
  },
];

function makeCertificateItem(
  id: number,
  overrides: Partial<CertificateListItem> = {},
): CertificateListItem {
  const so = overrides.so ?? `TEST.75001.000${id}`;
  return {
    id,
    so,
    fields: makeSafeFields({
      SO: so,
      HOTEN: `TEST NGUYEN VAN ${id}`,
      SOCMND_PASSPORT: `TESTGKSK0${id}`,
      ...(overrides.fields ?? {}),
    }),
    dataSha256: `SHA_${id}`,
    status: 'ready',
    batchId: 1,
    batchFilename: 'dot_1_s15.xlsx',
    excelRowNumber: id + 1,
    serverCertificateId: null,
    createdAt: '2026-11-25T08:00:00.000Z',
    updatedAt: '2026-11-25T08:00:00.000Z',
    issues: [],
    latestSubmission: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('S15 — StatusBadge, ReconcileSummary & ListPage (Danh sách & Đối soát, Xuất XML/ZIP/Excel)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. StatusBadge hiển thị đúng huy hiệu tiếng Việt cho cả 6 trạng thái theo ARCHITECTURE.md §8', () => {
    const { rerender } = render(<StatusBadge status="ready" />);
    expect(screen.getByTestId('status-badge-ready')).toHaveTextContent(
      'Chờ đẩy cổng',
    );

    rerender(<StatusBadge status="accepted" />);
    expect(screen.getByTestId('status-badge-accepted')).toHaveTextContent(
      'Đã đẩy thành công',
    );

    rerender(<StatusBadge status="invalid" />);
    expect(screen.getByTestId('status-badge-invalid')).toHaveTextContent(
      'Lỗi dữ liệu Excel',
    );

    rerender(<StatusBadge status="rejected" />);
    expect(screen.getByTestId('status-badge-rejected')).toHaveTextContent(
      'Cổng Sở từ chối',
    );

    rerender(<StatusBadge status="error" />);
    expect(screen.getByTestId('status-badge-error')).toHaveTextContent(
      'Lỗi mạng / Cấu hình',
    );

    rerender(<StatusBadge status="sending" />);
    expect(screen.getByTestId('status-badge-sending')).toHaveTextContent(
      'Đang đẩy...',
    );
  });

  it('2. 4 tab đối soát hiển thị đúng số đếm từ API, dòng invalid bị khóa nút Tải XML & Đẩy cổng, và bảng không hiển thị 4 trường nhạy cảm', async () => {
    const items: CertificateListItem[] = [
      makeCertificateItem(1, {
        so: 'TEST.75001.READY.01',
        status: 'ready',
      }),
      makeCertificateItem(2, {
        so: 'TEST.75001.ACC.02',
        status: 'accepted',
        serverCertificateId: 'cert-uuid-0002',
        latestSubmission: {
          id: 10,
          msgId: '75001261125aaaa111122223333444455556666',
          sendDatetime: 1764050000000,
          attempts: 1,
          httpStatus: 200,
          resCode: 'PS_SYNC_SUCCESS',
          resultStatus: 'accepted',
          serverSubmissionId: 'sub-uuid-0002',
          errors: [],
          warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
          lastError: null,
          createdAt: '2026-11-25T08:10:00.000Z',
          finishedAt: '2026-11-25T08:10:01.000Z',
        },
      }),
      makeCertificateItem(3, {
        so: 'TEST.75001.INV.03',
        status: 'invalid',
        issues: [
          {
            code: 'GKSK_NGAYSINH_INVALID',
            field: 'NGAYSINH',
            severity: 'error',
            source: 'server-mirror',
          },
        ],
      }),
      makeCertificateItem(4, {
        so: 'TEST.75001.REJ.04',
        status: 'rejected',
        latestSubmission: {
          id: 11,
          msgId: '75001261125bbbb111122223333444455556666',
          sendDatetime: 1764050100000,
          attempts: 1,
          httpStatus: 200,
          resCode: 'PS_SYNC_SUCCESS',
          resultStatus: 'rejected',
          serverSubmissionId: 'sub-uuid-0004',
          errors: [{ code: 'GKSK_FACILITY_MISMATCH', field: 'IDBENHVIEN' }],
          warnings: [],
          lastError: null,
          createdAt: '2026-11-25T08:12:00.000Z',
          finishedAt: '2026-11-25T08:12:01.000Z',
        },
      }),
    ];

    const listResponse: CertificateListResponse = {
      items,
      total: 4,
      page: 1,
      pageSize: 20,
      counts: SAMPLE_COUNTS,
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/batches') {
        return jsonResponse({ items: SAMPLE_BATCHES }, 200);
      }
      if (url.startsWith('/api/certificates')) {
        return jsonResponse(listResponse, 200);
      }
      return jsonResponse({ ok: true }, 200);
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId('reconcile-table');

    // Kiểm tra 4 thẻ thống kê số đếm đối soát
    expect(screen.getByTestId('reconcile-count-all')).toHaveTextContent('6');
    expect(screen.getByTestId('reconcile-count-unsent')).toHaveTextContent('1');
    expect(screen.getByTestId('reconcile-count-accepted')).toHaveTextContent('2');
    expect(screen.getByTestId('reconcile-count-attention')).toHaveTextContent('3');

    // Dòng hợp lệ (id=1, id=2, id=4) được bật nút Tải <SO>.xml, còn dòng invalid (id=3) bị khóa
    expect(screen.getByTestId('download-xml-btn-1')).not.toBeDisabled();
    expect(screen.getByTestId('send-cert-btn-1')).not.toBeDisabled();
    expect(screen.getByTestId('cert-checkbox-1')).toBeChecked();

    expect(screen.getByTestId('download-xml-btn-3')).toBeDisabled();
    expect(screen.getByTestId('send-cert-btn-3')).toBeDisabled();
    expect(screen.getByTestId('cert-checkbox-3')).toBeDisabled();
    expect(screen.getByTestId('cert-checkbox-3')).not.toBeChecked();

    // Nút Tải XML (.zip) đếm đúng 3 dòng hợp lệ đang được chọn (id 1, 2, 4)
    expect(screen.getByTestId('download-xml-zip-btn')).toHaveTextContent(
      '📦 Tải XML (.zip) (3)',
    );

    // Kiểm tra cảnh báo GKSK_UNSIGNED trên dòng accepted và lỗi GKSK_FACILITY_MISMATCH trên dòng rejected
    expect(screen.getByTestId('issue-item-GKSK_UNSIGNED')).toBeInTheDocument();
    expect(
      screen.getByTestId('issue-item-GKSK_FACILITY_MISMATCH'),
    ).toBeInTheDocument();

    // Đảm bảo bảng không hiển thị 4 trường nhạy cảm (NONGDOCON, MATUY, LYDO, TINHTRANGBENH)
    const tableText = screen.getByTestId('reconcile-table').textContent ?? '';
    expect(tableText).not.toContain('NONGDOCON');
    expect(tableText).not.toContain('MATUY');
    expect(tableText).not.toContain('TINHTRANGBENH');
  });

  it('3. Chuyển tab đối soát, lọc con trong tab Cần xử lý, lọc theo Đợt import Excel và tìm kiếm gọi đúng query GET /api/certificates', async () => {
    const requestedUrls: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      requestedUrls.push(url);
      if (url === '/api/batches') {
        return jsonResponse({ items: SAMPLE_BATCHES }, 200);
      }
      return jsonResponse(
        {
          items: [makeCertificateItem(1)],
          total: 1,
          page: 1,
          pageSize: 20,
          counts: SAMPLE_COUNTS,
        } satisfies CertificateListResponse,
        200,
      );
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId('reconcile-table');
    expect(requestedUrls).toContain('/api/certificates?tab=all&page=1&pageSize=20');

    // Chuyển sang tab Đã đẩy thành công (accepted)
    fireEvent.click(screen.getByTestId('tab-btn-accepted'));
    await waitFor(() => {
      expect(requestedUrls).toContain(
        '/api/certificates?tab=accepted&page=1&pageSize=20',
      );
    });

    // Chuyển sang tab Cần xử lý (attention) -> hiện thanh lọc con và chọn Lỗi dữ liệu Excel (status=invalid)
    fireEvent.click(screen.getByTestId('tab-btn-attention'));
    await screen.findByTestId('attention-subfilter-bar');
    fireEvent.click(screen.getByTestId('attention-subfilter-invalid'));
    await waitFor(() => {
      expect(requestedUrls).toContain(
        '/api/certificates?tab=attention&status=invalid&page=1&pageSize=20',
      );
    });

    // Chọn lọc theo Đợt import #2 và nhập từ khóa tìm kiếm "NGUYEN"
    await waitFor(() => {
      expect(
        screen.getByTestId('batch-filter-select').querySelectorAll('option').length,
      ).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByTestId('batch-filter-select'), {
      target: { value: '2' },
    });
    await waitFor(() => {
      expect(requestedUrls).toContain(
        '/api/certificates?tab=attention&status=invalid&batchId=2&page=1&pageSize=20',
      );
    });

    fireEvent.change(screen.getByTestId('search-query-input'), {
      target: { value: 'NGUYEN' },
    });
    fireEvent.submit(screen.getByTestId('reconcile-filter-form'));
    await waitFor(() => {
      expect(requestedUrls).toContain(
        '/api/certificates?tab=attention&status=invalid&batchId=2&q=NGUYEN&page=1&pageSize=20',
      );
    });
  });

  it('4. Bấm Tải <SO>.xml lẻ, Tải XML (.zip) và Xuất Excel đối soát gọi đúng các endpoint tải file', async () => {
    const requestedCalls: Array<{ url: string; method: string; body?: string }> = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? init.body : undefined;
      requestedCalls.push({ url, method, ...(body ? { body } : {}) });

      if (url === '/api/batches') {
        return jsonResponse({ items: SAMPLE_BATCHES }, 200);
      }
      if (url.startsWith('/api/certificates?')) {
        return jsonResponse(
          {
            items: [
              makeCertificateItem(10, {
                so: 'TEST.75001.XML.10',
                status: 'ready',
              }),
              makeCertificateItem(11, {
                so: 'TEST.75001.XML.11',
                status: 'accepted',
              }),
            ],
            total: 2,
            page: 1,
            pageSize: 20,
            counts: SAMPLE_COUNTS,
          } satisfies CertificateListResponse,
          200,
        );
      }
      if (url === '/api/certificates/10/xml') {
        return new Response('<root><SO>TEST.75001.XML.10</SO></root>', {
          status: 200,
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Content-Disposition':
              'attachment; filename="TEST.75001.XML.10.xml"',
          },
        });
      }
      if (url === '/api/certificates/xml-zip') {
        return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition':
              'attachment; filename="GKSK_XML_20261125_100000.zip"',
          },
        });
      }
      if (url.startsWith('/api/certificates/export-excel')) {
        return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
          status: 200,
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition':
              'attachment; filename="GKSK_doi_soat_20261125_100000.xlsx"',
          },
        });
      }
      return jsonResponse({ ok: true }, 200);
    });

    render(
      <MemoryRouter initialEntries={['/?batchId=1']}>
        <Routes>
          <Route path="/" element={<ListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId('reconcile-table');

    // 1. Bấm Tải <SO>.xml lẻ trên dòng id=10
    fireEvent.click(screen.getByTestId('download-xml-btn-10'));
    await waitFor(() => {
      expect(
        requestedCalls.some(
          (c) => c.url === '/api/certificates/10/xml' && c.method === 'GET',
        ),
      ).toBe(true);
    });
    expect(await screen.findByTestId('list-action-notice')).toHaveTextContent(
      'TEST.75001.XML.10.xml',
    );

    // 2. Bấm Tải XML (.zip) cho 2 dòng hợp lệ (10, 11)
    fireEvent.click(screen.getByTestId('download-xml-zip-btn'));
    await waitFor(() => {
      const zipCall = requestedCalls.find(
        (c) => c.url === '/api/certificates/xml-zip' && c.method === 'POST',
      );
      expect(zipCall).toBeDefined();
      expect(JSON.parse(zipCall?.body ?? '{}')).toEqual({ ids: [10, 11] });
    });

    // 3. Bấm Xuất Excel đối soát (29 cột) -> truyền đúng bộ lọc hiện tại (tab=all&batchId=1)
    fireEvent.click(screen.getByTestId('export-reconcile-excel-btn'));
    await waitFor(() => {
      expect(
        requestedCalls.some(
          (c) =>
            c.url === '/api/certificates/export-excel?tab=all&batchId=1' &&
            c.method === 'GET',
        ),
      ).toBe(true);
    });
  });
});
