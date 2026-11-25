import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { extractZipArchiveBuffer } from '../../server/src/services/exportService.js';
import { FIXTURES_DIR, writeFixturesToDisk } from '../fixtures/make-fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const EVIDENCE_S17_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'S17');

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('#login-username').fill('admin');
  await page.locator('#login-password').fill('gksk-test-password');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.describe.serial(
  'S17 — Playwright E2E 3 luồng chính trên dev:mock (Import Excel -> Đối soát/Drawer/XML/ZIP/Excel -> Import đè sửa lỗi & Gửi lại giữ nguyên msg_id)',
  () => {
    let exportedReconcileExcelBuffer: Buffer | null = null;

    test.beforeAll(async () => {
      await fs.mkdir(EVIDENCE_S17_DIR, { recursive: true });
      await writeFixturesToDisk(FIXTURES_DIR);

      // Làm sạch InMemoryRepositories và Mock GKSK API store trước khi bắt đầu bộ 3 luồng E2E
      const resetDbRes = await fetch('http://127.0.0.1:4010/__e2e/reset', {
        method: 'POST',
      });
      expect(resetDbRes.ok).toBe(true);

      const resetMockRes = await fetch('http://127.0.0.1:4010/__mock/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearStore: true }),
      });
      expect(resetMockRes.ok).toBe(true);
    });

    test('Luồng 1: Đăng nhập -> Tải mẫu Excel -> Import file có cả dòng hợp lệ và dòng lỗi -> Kiểm tra số đếm 4 tab đối soát', async ({
      page,
    }) => {
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          // Bỏ qua thông báo 401 ban đầu của trình duyệt khi kiểm tra phiên trước lúc đăng nhập
          if (!text.includes('401')) {
            consoleErrors.push(text);
          }
        }
      });

      // 1. Truy cập trang chủ -> tự động chuyển về /login khi chưa có phiên, sau đó đăng nhập
      await page.goto('/');
      await expect(page).toHaveURL(/\/login$/);

      await page.locator('#login-username').fill('admin');
      await page.locator('#login-password').fill('gksk-test-password');
      await page.getByRole('button', { name: 'Đăng nhập' }).click();

      await expect(page).toHaveURL(/\/$/);
      await expect(
        page.getByRole('link', { name: 'Danh sách & Đối soát' }),
      ).toHaveAttribute('aria-current', 'page');

      // 2. Chuyển sang trang Import Excel (/import) và tải file mẫu GKSK_mau_nhap_lieu.xlsx
      await page
        .getByRole('navigation', { name: 'Điều hướng chính' })
        .getByRole('link', { name: 'Import Excel' })
        .click();
      await expect(page).toHaveURL(/\/import$/);

      const templateDownloadPromise = page.waitForEvent('download');
      await page.getByTestId('download-template-btn').click();
      const templateDownload = await templateDownloadPromise;
      expect(templateDownload.suggestedFilename()).toBe(
        'GKSK_mau_nhap_lieu.xlsx',
      );

      const templatePath = await templateDownload.path();
      expect(templatePath).toBeTruthy();
      if (templatePath) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(templatePath);
        const gkskSheet = wb.getWorksheet('GKSK');
        const huongDanSheet = wb.getWorksheet('HuongDan');
        expect(gkskSheet).toBeDefined();
        expect(huongDanSheet).toBeDefined();
        expect(gkskSheet?.getRow(1).actualCellCount).toBe(23);
      }

      // 3. Nạp file mixed_valid_invalid.xlsx (3 dòng hợp lệ + 2 dòng lỗi ngày sinh có SO + 1 dòng thiếu SO)
      const mixedFilePath = path.join(FIXTURES_DIR, 'mixed_valid_invalid.xlsx');
      await page.getByTestId('excel-file-input').setInputFiles(mixedFilePath);

      await expect(page.getByTestId('import-preview-section')).toBeVisible();
      await expect(
        page.getByTestId('summary-card-total').locator('.summary-tile-value'),
      ).toHaveText('6');
      await expect(
        page.getByTestId('summary-card-ready').locator('.summary-tile-value'),
      ).toHaveText('3');
      await expect(
        page.getByTestId('summary-card-invalid').locator('.summary-tile-value'),
      ).toHaveText('3');

      // 5 dòng có mã SO (3 ready + 2 invalid) đều được tự động tick chọn lưu để khớp 100% quân số; dòng 7 thiếu SO bị khóa
      await expect(page.getByTestId('row-checkbox-2')).toBeChecked();
      await expect(page.getByTestId('row-checkbox-5')).toBeChecked();
      await expect(page.getByTestId('row-checkbox-6')).toBeChecked();
      await expect(page.getByTestId('row-checkbox-7')).toBeDisabled();
      await expect(page.getByTestId('commit-import-btn')).toContainText(
        'Lưu vào Danh sách đối soát (5 dòng)',
      );

      // 4. Lưu vào Danh sách đối soát -> tự động chuyển về /?batchId=1
      await page.getByTestId('commit-import-btn').click();
      await expect(page).toHaveURL(/\/\?batchId=1$/);
      await expect(page.getByTestId('reconcile-table')).toBeVisible();

      // 5. Kiểm tra số đếm 4 tab đối soát: Tất cả = 5, Chưa đẩy = 3, Đã đẩy = 0, Cần xử lý = 2
      await expect(page.getByTestId('reconcile-count-all')).toHaveText('5');
      await expect(page.getByTestId('reconcile-count-unsent')).toHaveText('3');
      await expect(page.getByTestId('reconcile-count-accepted')).toHaveText('0');
      await expect(page.getByTestId('reconcile-count-attention')).toHaveText('2');

      // Bấm qua cả 4 tab đối soát để xác nhận lọc nhanh hoạt động chính xác
      await page.getByTestId('tab-btn-unsent').click();
      await expect(page.locator('[data-testid^="cert-row-"]')).toHaveCount(3);

      await page.getByTestId('tab-btn-attention').click();
      await expect(page.getByTestId('attention-subfilter-bar')).toBeVisible();
      await expect(page.locator('[data-testid^="cert-row-"]')).toHaveCount(2);

      await page.getByTestId('tab-btn-all').click();
      await expect(page.locator('[data-testid^="cert-row-"]')).toHaveCount(5);

      await page.screenshot({
        path: path.join(EVIDENCE_S17_DIR, 'e2e-flow1-import-reconcile.png'),
        fullPage: false,
      });

      expect(consoleErrors).toEqual([]);
    });

    test('Luồng 2: Chọn giấy hợp lệ -> Xem Drawer chi tiết 25 trường & XML -> Tải XML lẻ / .zip -> Đẩy cổng hàng loạt -> Xuất file Excel đối soát 29 cột', async ({
      page,
    }) => {
      await loginAsAdmin(page);
      await expect(page.getByTestId('reconcile-table')).toBeVisible();

      // 1. Bấm vào dòng hợp lệ đầu tiên (TEST.75001.MIX.01, id=1) để mở Ngăn trượt (Drawer) chi tiết
      await page.getByTestId('cert-so-btn-1').click();
      await expect(
        page.getByTestId('certificate-detail-drawer'),
      ).toBeVisible();

      // Tab 1: Kiểm tra hiển thị đủ 25 trường (nhóm riêng 4 trường nhạy cảm NONGDOCON, MATUY, LYDO, TINHTRANGBENH)
      await expect(
        page.getByTestId('drawer-sensitive-fields-group'),
      ).toBeVisible();
      await expect(page.getByTestId('drawer-field-NONGDOCON')).toBeVisible();
      await expect(page.getByTestId('drawer-field-MATUY')).toBeVisible();
      await expect(page.getByTestId('drawer-field-LYDO')).toBeVisible();
      await expect(
        page.getByTestId('drawer-field-TINHTRANGBENH'),
      ).toBeVisible();
      await expect(page.getByTestId('drawer-excel-edit-guide')).toContainText(
        'Để sửa dữ liệu, vui lòng chỉnh trên',
      );

      // Tab 2: Xem trước XML + Sao chép XML + Tải <SO>.xml lẻ
      await page.getByTestId('drawer-tab-btn-xml').click();
      await expect(page.getByTestId('xml-preview-code')).toContainText(
        '<SO>TEST.75001.MIX.01</SO>',
      );
      await page.getByTestId('copy-xml-btn').click();
      await expect(page.getByTestId('copy-xml-status')).toContainText(
        'Đã sao chép XML',
      );

      const singleXmlDownloadPromise = page.waitForEvent('download');
      await page.getByTestId('drawer-download-xml-btn').click();
      const singleXmlDownload = await singleXmlDownloadPromise;
      expect(singleXmlDownload.suggestedFilename()).toBe(
        'TEST.75001.MIX.01.xml',
      );
      const singleXmlPath = await singleXmlDownload.path();
      if (singleXmlPath) {
        const xmlText = await fs.readFile(singleXmlPath, 'utf8');
        expect(xmlText).toContain('<root>');
        expect(xmlText).toContain('<SO>TEST.75001.MIX.01</SO>');
        expect(xmlText).toContain('<GIOITINHVAL>0</GIOITINHVAL>');
        expect(xmlText).toContain('<STATE>ADD</STATE>');
      }

      // Đóng Drawer
      await page.getByTestId('drawer-close-btn').click();
      await expect(page.getByTestId('certificate-detail-drawer')).toHaveCount(
        0,
      );

      // 2. Tải gói XML (.zip) cho 3 giấy hợp lệ đang được chọn
      await expect(page.getByTestId('download-xml-zip-btn')).toContainText(
        '📦 Tải XML (.zip) (3)',
      );
      const zipDownloadPromise = page.waitForEvent('download');
      await page.getByTestId('download-xml-zip-btn').click();
      const zipDownload = await zipDownloadPromise;
      expect(zipDownload.suggestedFilename()).toMatch(/^GKSK_XML_.*\.zip$/);
      const zipPath = await zipDownload.path();
      if (zipPath) {
        const zipBuf = await fs.readFile(zipPath);
        const extracted = extractZipArchiveBuffer(zipBuf);
        expect(extracted.map((e) => e.fileName).sort()).toEqual([
          'TEST.75001.MIX.01.xml',
          'TEST.75001.MIX.02.xml',
          'TEST.75001.MIX.03.xml',
        ]);
      }

      // 3. Đẩy cổng hàng loạt 3 giấy hợp lệ (ready)
      await expect(page.getByTestId('batch-send-btn')).toContainText(
        '🚀 Đẩy cổng các giấy đã chọn (3)',
      );
      await page.getByTestId('batch-send-btn').click();
      await expect(page.getByTestId('batch-send-confirm-dialog')).toBeVisible();
      await expect(page.getByTestId('batch-confirm-count')).toHaveText('3');

      await page.getByTestId('confirm-batch-send-btn').click();
      await expect(page.getByTestId('batch-progress-panel')).toBeVisible();
      await expect(page.getByTestId('batch-progress-done')).toHaveText(
        '3 / 3',
      );
      await expect(page.getByTestId('batch-progress-accepted')).toHaveText('3');

      // Đóng hộp thoại xác nhận và kiểm tra thẻ đếm đối soát đã tự động cập nhật: Đã đẩy = 3, Chưa đẩy = 0, Cần xử lý = 2
      await page.getByTestId('cancel-batch-send-btn').click();
      await expect(page.getByTestId('reconcile-count-accepted')).toHaveText(
        '3',
      );
      await expect(page.getByTestId('reconcile-count-unsent')).toHaveText('0');
      await expect(page.getByTestId('reconcile-count-attention')).toHaveText(
        '2',
      );

      // 4. Xuất file Excel đối soát 29 cột
      const excelDownloadPromise = page.waitForEvent('download');
      await page.getByTestId('export-reconcile-excel-btn').click();
      const excelDownload = await excelDownloadPromise;
      expect(excelDownload.suggestedFilename()).toMatch(
        /^GKSK_doi_soat_.*\.xlsx$/,
      );

      const excelPath = await excelDownload.path();
      expect(excelPath).toBeTruthy();
      if (excelPath) {
        const rawBuf = await fs.readFile(excelPath);
        exportedReconcileExcelBuffer = rawBuf;

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(rawBuf);
        const sheet = wb.getWorksheet('GKSK');
        expect(sheet).toBeDefined();
        expect(sheet?.getRow(1).actualCellCount).toBe(29);
        expect(sheet?.rowCount).toBe(6); // 1 header + 5 rows
      }

      await page.screenshot({
        path: path.join(
          EVIDENCE_S17_DIR,
          'e2e-flow2-drawer-xml-send-export.png',
        ),
        fullPage: false,
      });
    });

    test('Luồng 3: Sửa dòng lỗi ngay trên file Excel đối soát 29 cột -> Import đè lại (tự bỏ qua dòng accepted không đổi) -> Đẩy cổng dòng vừa sửa + kịch bản lỗi mạng -> Gửi lại giữ nguyên msg_id', async ({
      page,
    }) => {
      expect(exportedReconcileExcelBuffer).not.toBeNull();

      // 1. Mở trực tiếp file Excel đối soát 29 cột vừa xuất ở Luồng 2 và sửa NGAYSINH của 2 dòng lỗi
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(exportedReconcileExcelBuffer!);
      const sheet = wb.getWorksheet('GKSK')!;

      const headerRow = sheet.getRow(1);
      let soColIdx = 1;
      let ngaySinhColIdx = 5;
      headerRow.eachCell((cell, colNumber) => {
        const text = String(cell.value ?? '').trim().toUpperCase();
        if (text === 'SO') soColIdx = colNumber;
        if (text === 'NGAYSINH') ngaySinhColIdx = colNumber;
      });

      for (let r = 2; r <= sheet.rowCount; r += 1) {
        const row = sheet.getRow(r);
        const soVal = String(row.getCell(soColIdx).value ?? '').trim();
        if (soVal === 'TEST.75001.MIX.BAD1') {
          row.getCell(ngaySinhColIdx).value = '15/05/1991';
        } else if (soVal === 'TEST.75001.MIX.BAD2') {
          row.getCell(ngaySinhColIdx).value = '20/08/1992';
        }
      }

      const fixedExcelPath = path.join(
        EVIDENCE_S17_DIR,
        'GKSK_doi_soat_da_sua_loi.xlsx',
      );
      await wb.xlsx.writeFile(fixedExcelPath);

      // 2. Đăng nhập và vào trang Import Excel (/import) nạp lại file Excel đối soát 29 cột đã sửa
      await loginAsAdmin(page);
      await page
        .getByRole('navigation', { name: 'Điều hướng chính' })
        .getByRole('link', { name: 'Import Excel' })
        .click();
      await expect(page).toHaveURL(/\/import$/);

      await page.getByTestId('excel-file-input').setInputFiles(fixedExcelPath);
      await expect(page.getByTestId('import-preview-section')).toBeVisible();

      // Kiểm tra cảnh báo tự động bỏ qua 6 cột đối soát của file 29 cột
      await expect(page.getByTestId('ignored-columns-banner')).toContainText(
        'TRANG_THAI_DOI_SOAT',
      );

      // Kiểm tra ghi đè thông minh theo SO:
      // - 3 dòng đã đẩy thành công không đổi (accepted_unchanged) mặc định BỎ CHỌN
      // - 2 dòng vừa sửa lỗi (overwrite_pending) mặc định ĐƯỢC CHỌN -> nút Commit hiển thị đúng "(2 dòng)"
      await expect(
        page.getByTestId('summary-card-ready').locator('.summary-tile-value'),
      ).toHaveText('5');
      await expect(
        page.getByTestId('summary-card-invalid').locator('.summary-tile-value'),
      ).toHaveText('0');
      await expect(page.getByTestId('commit-import-btn')).toContainText(
        'Lưu vào Danh sách đối soát (2 dòng)',
      );

      // Bấm Lưu 2 dòng ghi đè vào Danh sách đối soát
      await page.getByTestId('commit-import-btn').click();
      await expect(page).toHaveURL(/\/\?batchId=2$/);

      // Xóa lọc theo đợt để xem toàn bộ 5 giấy: 3 accepted, 2 ready, 0 cần xử lý
      await page.getByTestId('clear-filters-btn').click();
      await expect(page.getByTestId('reconcile-count-all')).toHaveText('5');
      await expect(page.getByTestId('reconcile-count-accepted')).toHaveText(
        '3',
      );
      await expect(page.getByTestId('reconcile-count-unsent')).toHaveText('2');
      await expect(page.getByTestId('reconcile-count-attention')).toHaveText(
        '0',
      );

      // 3. Đẩy cổng dòng vừa sửa thứ nhất (TEST.75001.MIX.BAD1, id=4) -> thành công (accepted = 4)
      await page.getByTestId('send-cert-btn-4').click();
      await expect(page.getByTestId('list-action-notice')).toContainText(
        'Đã đẩy thành công giấy TEST.75001.MIX.BAD1',
      );
      await expect(page.getByTestId('reconcile-count-accepted')).toHaveText(
        '4',
      );

      // 4. Giả lập lỗi mạng tạm thời (HTTP 500 x 4) trên Mock GKSK API khi đẩy dòng TEST.75001.MIX.BAD2 (id=5)
      const failRes = await fetch('http://127.0.0.1:4010/__mock/fail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: '500', count: 4 }),
      });
      expect(failRes.ok).toBe(true);

      await page.getByTestId('send-cert-btn-5').click();
      await expect(page.getByTestId('list-error-banner')).toContainText(
        'TEST.75001.MIX.BAD2',
      );
      await expect(page.getByTestId('reconcile-count-attention')).toHaveText(
        '1',
      );
      await expect(page.getByTestId('send-cert-btn-5')).toContainText(
        '🔄 Gửi lại',
      );

      // Mở Drawer của TEST.75001.MIX.BAD2 (id=5) -> Tab 3 Lịch sử đẩy cổng để lấy msg_id lần 1
      await page.getByTestId('view-detail-btn-5').click();
      await expect(
        page.getByTestId('certificate-detail-drawer'),
      ).toBeVisible();
      await page.getByTestId('drawer-tab-btn-history').click();

      const msgIdCell = page.locator('[data-testid^="sub-msgid-"]').first();
      await expect(msgIdCell).toBeVisible();
      const firstMsgId = (await msgIdCell.textContent())?.trim() ?? '';
      expect(firstMsgId).toMatch(/^75001\d{6}[0-9a-f]{32}$/);

      await page.getByTestId('drawer-close-btn').click();

      // 5. Khôi phục Mock GKSK API và bấm "🔄 Gửi lại" trên dòng id=5 -> phải thành công với CÙNG msg_id!
      await fetch('http://127.0.0.1:4010/__mock/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearStore: false }),
      });

      await page.getByTestId('send-cert-btn-5').click();
      await expect(page.getByTestId('list-action-notice')).toContainText(
        firstMsgId,
      );
      await expect(page.getByTestId('list-action-notice')).toContainText(
        'giữ nguyên msg_id khi gửi lại',
      );

      // Toàn bộ 5/5 giấy đã đẩy thành công
      await expect(page.getByTestId('reconcile-count-accepted')).toHaveText(
        '5',
      );
      await expect(page.getByTestId('reconcile-count-attention')).toHaveText(
        '0',
      );

      // Mở Drawer Tab 3 Lịch sử đẩy cổng để chụp ảnh bằng chứng giữ nguyên msg_id
      await page.getByTestId('view-detail-btn-5').click();
      await expect(
        page.getByTestId('certificate-detail-drawer'),
      ).toBeVisible();
      await page.getByTestId('drawer-tab-btn-history').click();
      await expect(
        page.locator('[data-testid^="sub-msgid-"]').first(),
      ).toHaveText(firstMsgId);
      await expect(
        page.locator('[data-testid^="sub-same-msgid-badge-"]').first(),
      ).toBeVisible();

      await page.screenshot({
        path: path.join(
          EVIDENCE_S17_DIR,
          'e2e-flow3-reimport-retry-same-msgid.png',
        ),
        fullPage: false,
      });
    });
  },
);
