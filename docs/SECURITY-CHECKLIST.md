# SECURITY-CHECKLIST.md — Biên bản Rà soát Bảo mật & An toàn Dữ liệu (S17)

> **Dự án**: Webapp GKSK Lái xe (`GKSKLaiXe`) · **Phiên bản**: v1.1  
> **Tham chiếu**: `docs/ARCHITECTURE.md §7` & `docs/TEST-PLAN.md §6`  
> **Trạng thái**: **ĐẠT 13/13 HẠNG MỤC (PASS 100%)**

---

## 1. Danh sách Kiểm tra Bảo mật (Checklist 13 mục bắt buộc)

- [x] **1. Không endpoint nghiệp vụ nào truy cập được khi chưa đăng nhập (test quét router).**
  - **Bằng chứng**:
    - Bộ kiểm thử tự động `server/src/routes/auth.test.ts` (Ca #1) dùng hàm `listExpressRoutes(app)` quét 100% route đăng ký trên Express router: **15/15 endpoint nghiệp vụ** (`/api/import/*`, `/api/batches`, `/api/certificates*`, `/api/send`, `/api/jobs/:jobId`, `/api/submissions/:id/refresh`) đều trả về **HTTP `401 UNAUTHORIZED`** khi gọi không có cookie phiên `gksk_session` hợp lệ.
    - Biên bản chi tiết: `docs/evidence/S12/auth-security-report.md` và `docs/evidence/S17/e2e-and-security-report.md`.

- [x] **2. Phản hồi/HTML/JS của client không chứa mật khẩu, token CSYT, đường dẫn khóa RSA, mật khẩu MSSQL.**
  - **Bằng chứng**:
    - Endpoint công khai `GET /api/config` (`server/src/routes/auth.ts` & `server/src/config.ts`) chỉ trích xuất đúng 4 trường công khai: `{ appEnv, facilityId, facilityName, baseUrlHost }`.
    - Quét toàn bộ mã nguồn `client/src/**` và bundle build `client/dist/**` trong `scripts/verify-S13.ts`, `scripts/verify-S16.ts`, `scripts/verify-S17.ts` cho các từ khóa bí mật (`GKSK_PASSWORD`, `DB_PASSWORD`, `SESSION_SECRET`, `APP_LOGIN_PASSWORD_HASH`, `PRIVATE_KEY`, `BEGIN RSA PRIVATE KEY`) → **0 kết quả**.

- [x] **3. Cookie phiên `HttpOnly`, `SameSite=Lax`, `Secure` khi chạy HTTPS/production.**
  - **Bằng chứng**:
    - `server/src/routes/auth.ts` & `server/src/middleware/requireAuth.ts`: cookie `gksk_session` luôn được gắn cờ `HttpOnly; Path=/; Max-Age=28800; SameSite=Lax`, và tự động bật cờ `Secure` khi `APP_ENV=production` hoặc `req.secure === true` / `X-Forwarded-Proto: https`.
    - Kiểm thử tự động tại `server/src/routes/auth.test.ts` (Ca #3) xác nhận đầy đủ các cờ cookie trên cả 2 chế độ `test` và `production`.

- [x] **4. Giới hạn đăng nhập sai hoạt động; header `X-Requested-With` được kiểm cho method ghi.**
  - **Bằng chứng**:
    - `server/src/middleware/rateLimit.ts`: giới hạn tối đa **10 lần đăng nhập sai / cửa sổ trượt 15 phút / IP**; lần thử thứ 11 bị chặn ngay với **HTTP `429 TOO_MANY_LOGIN_ATTEMPTS`** kèm header `Retry-After: 900`.
    - `server/src/middleware/requireAuth.ts` (`createCsrfMiddleware`): 100% method ghi (`POST`, `PUT`, `DELETE`, `PATCH`) bắt buộc có header `X-Requested-With: gksk` (thiếu hoặc sai trả **HTTP `403 CSRF_HEADER_REQUIRED`**) và chặn `Content-Type: application/x-www-form-urlencoded` (**HTTP `403 CSRF_INVALID_CONTENT_TYPE`**).

- [x] **5. Upload: >5 MB bị chặn; sai magic bytes bị chặn; không ghi đĩa.**
  - **Bằng chứng**:
    - `server/src/routes/import.ts`: dùng `multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })` — hoàn toàn xử lý trên Buffer RAM, **không bao giờ ghi file tạm ra đĩa**.
    - File vượt quá `5 MB` bị chặn với **HTTP `413 EXCEL_FILE_TOO_LARGE`**; file giả mạo đuôi `.xlsx` nhưng không có magic bytes ZIP `PK\x03\x04` (`not_xlsx.xlsx`) bị chặn với **HTTP `415 EXCEL_INVALID_FORMAT`** (đã kiểm chứng trong `server/src/routes/import.test.ts` Ca #6).

- [x] **6. Log một lượt E2E: grep `TEST NGUYEN`, `TESTGKSK`, `Bearer`, `eyJ` → 0 kết quả.**
  - **Bằng chứng**:
    - `server/src/logger.ts` cấu hình `pino` với danh sách `redact` chặt chẽ cho mọi trường nhạy cảm/PII (`HOTEN`, `SOCMND_PASSPORT`, `NONGDOCON`, `MATUY`, `LYDO`, `TINHTRANGBENH`, `fields`, `fields_json`, `data`, `xml`, `token`, `password`, `authorization`, `cookie`, `DB_PASSWORD`, v.v.).
    - `scripts/verify-S17.ts` quét trực tiếp toàn bộ file log thực tế `docs/evidence/S17/e2e-server.log` sinh ra từ 3 lượt chạy Playwright E2E liên tiếp với các mẫu cấm `TEST NGUYEN`, `TESTGKSK`, `Bearer`, `eyJ`, `DB_PASSWORD` → **0 kết quả (0 rò rỉ)**.

- [x] **7. Danh sách giấy đối soát không chứa `MATUY`, `NONGDOCON`, `LYDO`, `TINHTRANGBENH` (chỉ có trong Drawer chi tiết 1 giấy).**
  - **Bằng chứng**:
    - Ở tầng API: `GET /api/certificates` gọi `stripSensitiveFields(row.fields)` trong `server/src/services/certificateService.ts` để xóa 4 khóa `NONGDOCON`, `MATUY`, `LYDO`, `TINHTRANGBENH` khỏi JSON phản hồi danh sách; chỉ `GET /api/certificates/:id` mới trả đủ 25 trường cho Drawer.
    - Ở tầng UI: `client/src/pages/ListPage.tsx` hoàn toàn không truy cập 4 trường này; 4 trường nhạy cảm chỉ được hiển thị trong khối riêng `🔒 Nhóm 4 trường thông tin y tế nhạy cảm` tại `client/src/components/CertificateDetailDrawer.tsx`.

- [x] **8. Tên file tải về (`.xml`, `.zip`, `.xlsx`) an toàn với `SO` chứa `../`, dấu cách, tiếng Việt, `"`.**
  - **Bằng chứng**:
    - `server/src/services/exportService.ts` (`sanitizeXmlFileName`): thay thế toàn bộ ký tự cấm `/ \ : * ? " < > |`, ký tự điều khiển ASCII `0x00–0x1F` và chuỗi thoát thư mục `..` bằng `_`, đồng thời `buildContentDispositionAttachment` trong `server/src/routes/certificates.ts` mã hóa `filename*=UTF-8''...` an toàn chống Header Injection / Path Traversal (đã kiểm thử tại `server/src/routes/certificates.test.ts`).

- [x] **9. Mọi truy vấn MSSQL dùng tham số `.input()`, không có SQL ghép chuỗi; mọi bảng có tiền tố `gksk_`; không có `dangerouslySetInnerHTML`.**
  - **Bằng chứng**:
    - `server/src/db/migrations/001_init.sql` & `server/src/db/mssqlRepo.ts`: 100% bảng dùng tiền tố `gksk_` (`gksk_schema_migrations`, `gksk_import_batches`, `gksk_certificates`, `gksk_submissions`), 100% biến truyền qua `request.input('param', sql.Type, value)`, và không có bất kỳ lệnh `DROP TABLE`, `TRUNCATE` hay `DELETE` không có `WHERE`.
    - Quét toàn bộ `client/src/**` xác nhận **0 lần sử dụng `dangerouslySetInnerHTML`**.

- [x] **10. `npm test` mặc định không mở kết nối tới MSSQL thật.**
  - **Bằng chứng**:
    - `server/src/db/connection.ts` (`createRepositories(pool?)`): khi không truyền `pool` (mặc định trong toàn bộ `npm test` và `npm run test:e2e`), hệ thống luôn khởi tạo `InMemoryRepositories` trong RAM, tuyệt đối không mở kết nối TCP tới SQL Server đang vận hành.

- [x] **11. `npm audit --omit=dev` không còn high/critical chưa xử lý.**
  - **Bằng chứng**:
    - Đã tuân thủ quyết định `D6` (dùng `exceljs`, loại bỏ hoàn toàn gói `xlsx`/SheetJS có lỗ hổng high/critical).
    - Kết quả chạy `npm audit --omit=dev --json` trong `scripts/verify-S17.ts`: **`high: 0`, `critical: 0`** (chỉ còn 2 cảnh báo `moderate` ở phụ thuộc bắc cầu `uuid` trong `exceljs` khi truyền `buf` cho `uuid.v3/v5/v6` — tính năng ứng dụng không sử dụng; việc ép hạ cấp `exceljs@3.4.0` là breaking change không an toàn).

- [x] **12. `.env` không nằm trong git (`git ls-files | grep -E "\.env$"` → rỗng).**
  - **Bằng chứng**:
    - `.gitignore` chặn `.env`, `.env.*` (chỉ cho phép `.env.example`).
    - Kiểm chứng `git ls-files` trong `scripts/verify-S17.ts`: chỉ có `.env.example`, **0 file `.env`** nằm trong git index.

- [x] **13. Production: banner + hộp xác nhận hiển thị.**
  - **Bằng chứng**:
    - Khi `APP_ENV=production`, `client/src/components/EnvBanner.tsx` hiển thị banner cảnh báo đỏ nổi bật (`role="alert"`) trên đầu mọi trang (kèm ảnh bằng chứng `docs/evidence/S13/03-app-shell-prod-banner.png`).
    - Trên `client/src/pages/ListPage.tsx`, khi `APP_ENV=production`, mọi thao tác **Đẩy cổng** (cả đơn lẻ lẫn hàng loạt) đều bật hộp thoại `<dialog>` với khung cảnh báo đỏ (`data-testid="prod-send-warning"`) và khóa nút gửi cho tới khi người dùng chủ động tick ô xác nhận `data-testid="prod-confirm-checkbox"` (đã kiểm thử tại `client/src/pages/ListPage.test.tsx` Ca #8).
