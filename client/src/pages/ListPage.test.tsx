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


describe('S16 — Đẩy cổng hàng loạt, Ngăn trượt (Drawer) Chi tiết 25 trường, Xem trước XML & Gửi lại giữ nguyên msg_id', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('5. Đẩy cổng hàng loạt 10 giấy (2 rejected, 1 lỗi tạm rồi OK -> 8 accepted, 2 rejected): hộp xác nhận, polling tiến độ jobId và cập nhật thẻ đếm đối soát', async () => {
    const initialItems: CertificateListItem[] = Array.from(
      { length: 10 },
      (_, idx) =>
        makeCertificateItem(idx + 1, {
          so: `TEST.75001.BATCH.${String(idx + 1).padStart(2, '0')}`,
          status: 'ready',
        }),
    );

    const initialCounts: ReconcileCounts = {
      all: 10,
      unsent: 10,
      accepted: 0,
      attention: 0,
      ready: 10,
      invalid: 0,
      rejected: 0,
      error: 0,
      sending: 0,
    };

    const finalCounts: ReconcileCounts = {
      all: 10,
      unsent: 0,
      accepted: 8,
      attention: 2,
      ready: 0,
      invalid: 0,
      rejected: 2,
      error: 0,
      sending: 0,
    };

    let jobPollCount = 0;
    let listFetchCount = 0;
    let sentBatchIds: number[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === '/api/batches') {
        return jsonResponse({ items: SAMPLE_BATCHES }, 200);
      }

      if (url.startsWith('/api/certificates?')) {
        listFetchCount += 1;
        const isAfterComplete = jobPollCount >= 2;
        return jsonResponse(
          {
            items: isAfterComplete
              ? initialItems.map((item, idx) => ({
                  ...item,
                  status: idx < 8 ? 'accepted' : 'rejected',
                }))
              : initialItems,
            total: 10,
            page: 1,
            pageSize: 20,
            counts: isAfterComplete ? finalCounts : initialCounts,
          } satisfies CertificateListResponse,
          200,
        );
      }

      if (url === '/api/send' && method === 'POST') {
        const parsed = JSON.parse(
          typeof init?.body === 'string' ? init.body : '{}',
        ) as { ids: number[] };
        sentBatchIds = parsed.ids;
        return jsonResponse(
          {
            jobId: 'job-s16-10-certs',
            status: 'running',
            total: 10,
          },
          200,
        );
      }

      if (url === '/api/jobs/job-s16-10-certs') {
        jobPollCount += 1;
        if (jobPollCount === 1) {
          // Đang chạy: 5/10 giấy (4 accepted, 1 rejected)
          return jsonResponse(
            {
              jobId: 'job-s16-10-certs',
              status: 'running',
              total: 10,
              done: 5,
              accepted: 4,
              rejected: 1,
              error: 0,
              invalid: 0,
              pending: 5,
              pausedUntilMs: null,
              rateLimitCount: 0,
              createdAt: '2026-11-25T10:00:00.000Z',
              finishedAt: null,
              items: initialItems.map((item, idx) => ({
                certificateId: item.id,
                so: item.so,
                status:
                  idx < 4
                    ? 'accepted'
                    : idx === 4
                      ? 'rejected'
                      : idx === 5
                        ? 'sending'
                        : 'queued',
                msgId: idx <= 5 ? `75001261125batch000${idx + 1}` : null,
                serverSubmissionId: null,
                serverCertificateId: null,
                httpStatus: idx < 5 ? 200 : null,
                resCode: idx < 5 ? 'PS_SYNC_SUCCESS' : null,
                errors: [],
                warnings: [],
                lastError: null,
                attempts: idx === 3 ? 2 : 1, // 1 giấy lỗi tạm rồi retry OK (attempts=2)
                reusedPendingSubmission: false,
                recoveredViaStatus: false,
                startedAt: '2026-11-25T10:00:00.000Z',
                finishedAt: idx < 5 ? '2026-11-25T10:00:00.500Z' : null,
              })),
            },
            200,
          );
        }

        // Lần poll thứ 2 (sau 1s): hoàn tất 10/10 giấy (8 accepted [kể cả 1 giấy lỗi tạm retry OK], 2 rejected)
        return jsonResponse(
          {
            jobId: 'job-s16-10-certs',
            status: 'completed',
            total: 10,
            done: 10,
            accepted: 8,
            rejected: 2,
            error: 0,
            invalid: 0,
            pending: 0,
            pausedUntilMs: null,
            rateLimitCount: 0,
            createdAt: '2026-11-25T10:00:00.000Z',
            finishedAt: '2026-11-25T10:00:01.500Z',
            items: initialItems.map((item, idx) => ({
              certificateId: item.id,
              so: item.so,
              status: idx < 8 ? 'accepted' : 'rejected',
              msgId: `75001261125batch000${idx + 1}`,
              serverSubmissionId: `sub-${idx + 1}`,
              serverCertificateId: idx < 8 ? `cert-${idx + 1}` : null,
              httpStatus: 200,
              resCode: 'PS_SYNC_SUCCESS',
              errors:
                idx >= 8
                  ? [{ code: 'GKSK_FACILITY_MISMATCH', field: 'IDBENHVIEN' }]
                  : [],
              warnings: idx < 8 ? [{ code: 'GKSK_UNSIGNED', field: null }] : [],
              lastError: null,
              attempts: idx === 3 ? 2 : 1,
              reusedPendingSubmission: false,
              recoveredViaStatus: false,
              startedAt: '2026-11-25T10:00:00.000Z',
              finishedAt: '2026-11-25T10:00:01.500Z',
            })),
          },
          200,
        );
      }

      return jsonResponse({ ok: true }, 200);
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <ListPage
                config={{
                  appEnv: 'test',
                  facilityId: '75001',
                  facilityName: 'Benh vien Da khoa Dong Nai',
                  baseUrlHost: '127.0.0.1:4010',
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId('reconcile-table');
    expect(screen.getByTestId('batch-send-btn')).toHaveTextContent(
      '🚀 Đẩy cổng các giấy đã chọn (10)',
    );

    // Mở hộp thoại xác nhận đẩy cổng hàng loạt
    fireEvent.click(screen.getByTestId('batch-send-btn'));
    expect(screen.getByTestId('batch-confirm-count')).toHaveTextContent('10');

    // Bấm xác nhận đẩy cổng 10 giấy
    fireEvent.click(screen.getByTestId('confirm-batch-send-btn'));

    // Kiểm tra POST /api/send nhận đủ 10 ID và thanh tiến độ hiển thị trạng thái đang chạy (5 / 10)
    await waitFor(() => {
      expect(sentBatchIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(screen.getByTestId('batch-progress-panel')).toBeInTheDocument();
    });

    // Chờ nhịp poll 1s hoàn tất (10 / 10, accepted=8, rejected=2) và bảng đối soát tự động làm mới
    await waitFor(
      () => {
        expect(screen.getByTestId('batch-progress-done')).toHaveTextContent(
          '10 / 10',
        );
        expect(screen.getByTestId('batch-progress-accepted')).toHaveTextContent(
          '8',
        );
        expect(screen.getByTestId('batch-progress-rejected')).toHaveTextContent(
          '2',
        );
        expect(screen.getByTestId('reconcile-count-accepted')).toHaveTextContent(
          '8',
        );
        expect(screen.getByTestId('reconcile-count-attention')).toHaveTextContent(
          '2',
        );
      },
      { timeout: 3500 },
    );
    expect(listFetchCount).toBeGreaterThanOrEqual(2);
  });

  it('6. Bấm vào 1 dòng mở Ngăn trượt (CertificateDetailDrawer): Tab 1 hiển thị đủ 25 trường (nhóm riêng 4 trường nhạy cảm) & hướng dẫn Excel; Tab 2 Xem trước XML & Sao chép; Tab 3 Lịch sử msg_id & Tra lại trạng thái', async () => {
    const sampleXml = [
      '<root>',
      '  <SO>TEST.75001.DRAWER.01</SO>',
      '  <NGAYKHAM>05/11/2026</NGAYKHAM>',
      '  <HOTEN>TEST NGUYEN VAN DRAWER</HOTEN>',
      '  <GIOITINHVAL>0</GIOITINHVAL>',
      '  <NGAYSINH>21/05/1990</NGAYSINH>',
      '  <STATE>ADD</STATE>',
      '</root>',
    ].join('\n');

    const fullRecord = {
      ...createEmptyRecord(),
      SO: 'TEST.75001.DRAWER.01',
      NGAYKHAM: '05/11/2026',
      HOTEN: 'TEST NGUYEN VAN DRAWER',
      GIOITINHVAL: '0',
      NGAYSINH: '21/05/1990',
      DIACHITHUONGTRU: '123 Duong Dong Khoi, Bien Hoa',
      MATINH_THUONGTRU: '75',
      MAHUYEN_THUONGTRU: '731',
      MAXA_THUONGTRU: '25993',
      SOCMND_PASSPORT: 'TESTGKSK01',
      NGAYTHANGNAMCAP: '10/10/2021',
      NOICAP: 'Cuc Canh sat QLHC',
      HANGBANGLAI: 'B2',
      IDBENHVIEN: '75001',
      BENHVIEN: 'Benh vien Da khoa Dong Nai',
      NGAYKETLUAN: '06/11/2026',
      NONGDOCON: '0',
      DVINONGDOCON: '0',
      MATUY: '0',
      BACSYKETLUAN: 'BS. TEST TRAN VAN B',
      KETLUAN: 'A0-1',
      NGAYKHAMLAI: '',
      LYDO: 'Khong co',
      TINHTRANGBENH: 'Binh thuong',
      STATE: 'ADD',
    };

    let refreshCalled = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === '/api/batches') {
        return jsonResponse({ items: SAMPLE_BATCHES }, 200);
      }
      if (url.startsWith('/api/certificates?')) {
        return jsonResponse(
          {
            items: [
              makeCertificateItem(1, {
                so: 'TEST.75001.DRAWER.01',
                status: 'accepted',
                serverCertificateId: 'cert-so-uuid-9999',
                latestSubmission: {
                  id: 50,
                  msgId: '75001261125drawer0000111122223333444455',
                  sendDatetime: 1764050000000,
                  attempts: 1,
                  httpStatus: 200,
                  resCode: 'PS_SYNC_SUCCESS',
                  resultStatus: 'accepted',
                  serverSubmissionId: 'sub-so-uuid-5050',
                  errors: [],
                  warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
                  lastError: null,
                  createdAt: '2026-11-25T08:00:00.000Z',
                  finishedAt: '2026-11-25T08:00:01.000Z',
                },
              }),
            ],
            total: 1,
            page: 1,
            pageSize: 20,
            counts: SAMPLE_COUNTS,
          } satisfies CertificateListResponse,
          200,
        );
      }
      if (url === '/api/certificates/1') {
        return jsonResponse(
          {
            id: 1,
            so: 'TEST.75001.DRAWER.01',
            fields: fullRecord,
            dataSha256:
              'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789',
            status: 'accepted',
            batchId: 1,
            batchFilename: 'dot_1_s15.xlsx',
            excelRowNumber: 2,
            batch: SAMPLE_BATCHES[0],
            serverCertificateId: 'cert-so-uuid-9999',
            createdAt: '2026-11-25T08:00:00.000Z',
            updatedAt: '2026-11-25T08:00:01.000Z',
            issues: [],
            xml: sampleXml,
            latestSubmission: {
              id: 50,
              msgId: '75001261125drawer0000111122223333444455',
              sendDatetime: 1764050000000,
              attempts: 1,
              httpStatus: 200,
              resCode: 'PS_SYNC_SUCCESS',
              resultStatus: 'accepted',
              serverSubmissionId: 'sub-so-uuid-5050',
              errors: [],
              warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
              lastError: null,
              createdAt: '2026-11-25T08:00:00.000Z',
              finishedAt: '2026-11-25T08:00:01.000Z',
            },
          },
          200,
        );
      }
      if (url === '/api/certificates/1/submissions') {
        return jsonResponse(
          {
            items: [
              {
                id: 50,
                msgId: '75001261125drawer0000111122223333444455',
                sendDatetime: 1764050000000,
                attempts: 1,
                httpStatus: 200,
                resCode: 'PS_SYNC_SUCCESS',
                resultStatus: 'accepted',
                serverSubmissionId: 'sub-so-uuid-5050',
                errors: [],
                warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
                lastError: null,
                createdAt: '2026-11-25T08:00:00.000Z',
                finishedAt: '2026-11-25T08:00:01.000Z',
              },
            ],
          },
          200,
        );
      }
      if (url === '/api/submissions/50/refresh' && method === 'POST') {
        refreshCalled = true;
        return jsonResponse(
          {
            submission: {
              id: 50,
              msgId: '75001261125drawer0000111122223333444455',
              sendDatetime: 1764050000000,
              attempts: 1,
              httpStatus: 200,
              resCode: 'PS_SYNC_SUCCESS',
              resultStatus: 'accepted',
              serverSubmissionId: 'sub-so-uuid-5050',
              errors: [],
              warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
              lastError: null,
              createdAt: '2026-11-25T08:00:00.000Z',
              finishedAt: '2026-11-25T08:00:01.000Z',
            },
            certificate: {
              id: 1,
              so: 'TEST.75001.DRAWER.01',
              status: 'accepted',
              serverCertificateId: 'cert-so-uuid-9999',
              updatedAt: '2026-11-25T08:05:00.000Z',
            },
            found: true,
            status: 'accepted',
            httpStatus: 200,
            resCode: 'PS_SYNC_SUCCESS',
          },
          200,
        );
      }
      return jsonResponse({ ok: true }, 200);
    });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId('reconcile-table');

    // Bấm vào dòng id=1 để mở Drawer bên phải
    fireEvent.click(screen.getByTestId('cert-row-1'));
    await screen.findByTestId('certificate-detail-drawer');
    await screen.findByTestId('drawer-sensitive-fields-group');

    // Kiểm tra Tab 1 hiển thị đủ 25 trường (gồm cả 4 trường nhạy cảm NONGDOCON, MATUY, LYDO, TINHTRANGBENH)
    for (const tag of Object.keys(fullRecord)) {
      expect(screen.getByTestId(`drawer-field-${tag}`)).toBeInTheDocument();
    }
    expect(
      screen.getByTestId('drawer-field-value-NONGDOCON'),
    ).toHaveTextContent('0');
    expect(screen.getByTestId('drawer-field-value-MATUY')).toHaveTextContent(
      '0(Âm tính)',
    );
    expect(
      screen.getByTestId('drawer-field-value-TINHTRANGBENH'),
    ).toHaveTextContent('Binh thuong');
    expect(screen.getByTestId('drawer-excel-edit-guide')).toHaveTextContent(
      'Để sửa dữ liệu, vui lòng chỉnh trên file Excel',
    );

    // Chuyển sang Tab 2 — Xem trước XML
    fireEvent.click(screen.getByTestId('drawer-tab-btn-xml'));
    expect(screen.getByTestId('xml-preview-code')).toHaveTextContent(
      '<SO>TEST.75001.DRAWER.01</SO>',
    );

    // Bấm Sao chép XML
    fireEvent.click(screen.getByTestId('copy-xml-btn'));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(sampleXml);
      expect(screen.getByTestId('copy-xml-status')).toHaveTextContent(
        'Đã sao chép XML',
      );
    });

    // Chuyển sang Tab 3 — Lịch sử đẩy cổng
    fireEvent.click(screen.getByTestId('drawer-tab-btn-history'));
    expect(screen.getByTestId('sub-msgid-50')).toHaveTextContent(
      '75001261125drawer0000111122223333444455',
    );
    expect(screen.getByTestId('sub-server-sub-id-50')).toHaveTextContent(
      'sub-so-uuid-5050',
    );
    expect(screen.getByTestId('sub-server-cert-id-50')).toHaveTextContent(
      'cert-so-uuid-9999',
    );

    // Bấm nút Tra lại trạng thái trong bảng lịch sử
    fireEvent.click(screen.getByTestId('drawer-refresh-sub-btn-50'));
    await waitFor(() => {
      expect(refreshCalled).toBe(true);
      expect(screen.getByTestId('drawer-action-notice')).toHaveTextContent(
        '75001261125drawer0000111122223333444455',
      );
    });
  });

  it('7. Kịch bản lỗi mạng (tắt mock) -> hiện ở nhóm Cần xử lý (Lỗi mạng) kèm nút "🔄 Gửi lại" -> bật mock, bấm Gửi lại -> accepted với CÙNG msg_id', async () => {
    const FIXED_MSG_ID = '75001261125retry999988887777666655554444';
    let mockOnline = false;
    let certStatus: 'ready' | 'error' | 'accepted' = 'error';
    let attempts = 1;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';

      if (url === '/api/batches') {
        return jsonResponse({ items: SAMPLE_BATCHES }, 200);
      }

      if (url.startsWith('/api/certificates?')) {
        return jsonResponse(
          {
            items: [
              makeCertificateItem(7, {
                so: 'TEST.75001.NETERR.07',
                status: certStatus,
                serverCertificateId:
                  certStatus === 'accepted' ? 'cert-recovered-07' : null,
                latestSubmission: {
                  id: 77,
                  msgId: FIXED_MSG_ID,
                  sendDatetime: 1764050000000,
                  attempts,
                  httpStatus: certStatus === 'accepted' ? 200 : null,
                  resCode:
                    certStatus === 'accepted' ? 'PS_SYNC_SUCCESS' : null,
                  resultStatus: certStatus === 'accepted' ? 'accepted' : null,
                  serverSubmissionId:
                    certStatus === 'accepted' ? 'sub-recovered-77' : null,
                  errors: [],
                  warnings:
                    certStatus === 'accepted'
                      ? [{ code: 'GKSK_UNSIGNED', field: null }]
                      : [],
                  lastError:
                    certStatus === 'error'
                      ? '[TRANSIENT:network_error] ECONNREFUSED 127.0.0.1:4010'
                      : null,
                  createdAt: '2026-11-25T09:00:00.000Z',
                  finishedAt: '2026-11-25T09:00:05.000Z',
                },
              }),
            ],
            total: 1,
            page: 1,
            pageSize: 20,
            counts: {
              ...SAMPLE_COUNTS,
              accepted: certStatus === 'accepted' ? 3 : 2,
              error: certStatus === 'error' ? 1 : 0,
              attention: certStatus === 'error' ? 3 : 2,
            },
          } satisfies CertificateListResponse,
          200,
        );
      }

      if (url === '/api/certificates/7/send' && method === 'POST') {
        attempts += 1;
        if (mockOnline) {
          certStatus = 'accepted';
        }
        return jsonResponse(
          {
            certificateId: 7,
            so: 'TEST.75001.NETERR.07',
            status: certStatus,
            certificate: {
              id: 7,
              so: 'TEST.75001.NETERR.07',
              status: certStatus,
              serverCertificateId:
                certStatus === 'accepted' ? 'cert-recovered-07' : null,
              updatedAt: '2026-11-25T09:01:00.000Z',
            },
            submission: {
              id: 77,
              msgId: FIXED_MSG_ID,
              sendDatetime: 1764050000000,
              attempts,
              httpStatus: certStatus === 'accepted' ? 200 : null,
              resCode: certStatus === 'accepted' ? 'PS_SYNC_SUCCESS' : null,
              resultStatus: certStatus === 'accepted' ? 'accepted' : null,
              serverSubmissionId:
                certStatus === 'accepted' ? 'sub-recovered-77' : null,
              errors: [],
              warnings:
                certStatus === 'accepted'
                  ? [{ code: 'GKSK_UNSIGNED', field: null }]
                  : [],
              lastError: null,
              createdAt: '2026-11-25T09:00:00.000Z',
              finishedAt: '2026-11-25T09:01:00.000Z',
            },
            issues: [],
            reusedPendingSubmission: true,
            recoveredViaStatus: false,
          },
          200,
        );
      }

      if (url === '/api/certificates/7') {
        return jsonResponse(
          {
            id: 7,
            so: 'TEST.75001.NETERR.07',
            fields: {
              ...createEmptyRecord(),
              SO: 'TEST.75001.NETERR.07',
              HOTEN: 'TEST RETRY SAME MSGID',
            },
            dataSha256: 'SHA_RETRY_07',
            status: certStatus,
            batchId: 1,
            batchFilename: 'dot_1_s15.xlsx',
            excelRowNumber: 8,
            batch: SAMPLE_BATCHES[0],
            serverCertificateId: 'cert-recovered-07',
            createdAt: '2026-11-25T09:00:00.000Z',
            updatedAt: '2026-11-25T09:01:00.000Z',
            issues: [],
            xml: '<root><SO>TEST.75001.NETERR.07</SO></root>',
            latestSubmission: null,
          },
          200,
        );
      }

      if (url === '/api/certificates/7/submissions') {
        return jsonResponse(
          {
            items: [
              {
                id: 77,
                msgId: FIXED_MSG_ID,
                sendDatetime: 1764050000000,
                attempts,
                httpStatus: 200,
                resCode: 'PS_SYNC_SUCCESS',
                resultStatus: 'accepted',
                serverSubmissionId: 'sub-recovered-77',
                errors: [],
                warnings: [{ code: 'GKSK_UNSIGNED', field: null }],
                lastError: null,
                createdAt: '2026-11-25T09:00:00.000Z',
                finishedAt: '2026-11-25T09:01:00.000Z',
              },
            ],
          },
          200,
        );
      }

      return jsonResponse({ ok: true }, 200);
    });

    render(
      <MemoryRouter initialEntries={['/?tab=attention&status=error']}>
        <Routes>
          <Route path="/" element={<ListPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId('reconcile-table');

    // Khi mock đang tắt (giấy ở trạng thái error): hiển thị huy hiệu "Lỗi mạng / Cấu hình" và nút "🔄 Gửi lại"
    expect(screen.getByTestId('status-badge-error')).toBeInTheDocument();
    const retryBtn = screen.getByTestId('send-cert-btn-7');
    expect(retryBtn).toHaveTextContent('🔄 Gửi lại');

    // Bật lại mock server và bấm "🔄 Gửi lại"
    mockOnline = true;
    fireEvent.click(retryBtn);

    // Kết quả: giấy chuyển sang accepted và thông báo nêu rõ giữ nguyên msg_id
    await waitFor(() => {
      expect(screen.getByTestId('list-action-notice')).toHaveTextContent(
        FIXED_MSG_ID,
      );
      expect(screen.getByTestId('list-action-notice')).toHaveTextContent(
        'giữ nguyên msg_id khi gửi lại',
      );
      expect(screen.getByTestId('status-badge-accepted')).toBeInTheDocument();
    });

    // Mở Drawer -> Tab Lịch sử đẩy cổng xác nhận chỉ có 1 bản ghi với cùng FIXED_MSG_ID và Số lần thử: 2
    fireEvent.click(screen.getByTestId('view-detail-btn-7'));
    await screen.findByTestId('certificate-detail-drawer');
    fireEvent.click(screen.getByTestId('drawer-tab-btn-history'));
    expect(await screen.findByTestId('sub-msgid-77')).toHaveTextContent(
      FIXED_MSG_ID,
    );
    expect(screen.getByTestId('sub-attempts-77')).toHaveTextContent(
      'Số lần thử: 2',
    );
    expect(
      screen.getByTestId('sub-same-msgid-badge-77'),
    ).toBeInTheDocument();
  });

  it('8. Chế độ APP_ENV=production hiển thị hộp cảnh báo đỏ và bắt buộc tick xác nhận trước khi cho phép đẩy cổng', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/batches') {
        return jsonResponse({ items: SAMPLE_BATCHES }, 200);
      }
      return jsonResponse(
        {
          items: [makeCertificateItem(1, { status: 'ready' })],
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
          <Route
            path="/"
            element={
              <ListPage
                config={{
                  appEnv: 'production',
                  facilityId: '75001',
                  facilityName: 'Benh vien Da khoa Dong Nai',
                  baseUrlHost: 'gksk.dongnai.gov.vn',
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId('reconcile-table');
    fireEvent.click(screen.getByTestId('batch-send-btn'));

    expect(screen.getByTestId('prod-send-warning')).toBeInTheDocument();
    const confirmBtn = screen.getByTestId('confirm-batch-send-btn');
    expect(confirmBtn).toBeDisabled();

    fireEvent.click(screen.getByTestId('prod-confirm-checkbox'));
    expect(confirmBtn).not.toBeDisabled();
  });
});
