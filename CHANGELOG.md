# CHANGELOG — GKSKLaiXe

> Nhật ký cho **mọi Agent và người** cùng nắm tình trạng dự án. Mới nhất ở trên cùng.
> Quy tắc: sau mỗi bước thêm một mục theo mẫu; mỗi lần sửa file trong `docs/` hoặc `project_context.md` ghi vào "Thay đổi tài liệu".

## Trạng thái hiện tại
- Bước đã xong: **S12 — Xác thực ứng dụng (server)**
- Bước kế tiếp: **S13 — Client: khung, đăng nhập, API layer**
- Môi trường đã thử: mock: ☑ · máy chủ kiểm thử thật: ☐

## Thay đổi tài liệu
| Ngày | File | Thay đổi | Lý do |
|---|---|---|---|
| 2026-11-23 | `docs/STEP-PROMPTS.md` | Tạo bộ 20 prompt copy-paste cho từng bước từ `S0` đến `S19` kèm khuyến nghị Model Gemini 4 (`Neon Medium`, `Neon High`, `Argon Medium`, `Argon High` — không dùng Carbon) | Để người dùng copy-paste trực tiếp vào từng phiên chat theo đúng chuẩn quy trình |
| 2026-11-23 | `AGENTS.md`, `.agents/skills/{gksk-step-runner,gksk-protocol-guard}/SKILL.md` | Tạo Workspace Rule tự động nạp `AGENTS.md` ở thư mục gốc và 2 Workspace Skills (`gksk-step-runner`, `gksk-protocol-guard`) để mọi phiên làm việc của Agent/Subagent đều tự động tuân thủ quy trình 1 bước/1 lần, sinh bằng chứng `docs/evidence/S<n>/`, báo cáo 5 mục, an toàn MSSQL `gksk_*` và chuẩn giao thức XML/chữ ký gói tin | Đảm bảo chất lượng thực thi cao nhất qua nhiều phiên làm việc |
| 2026-11-23 | `docs/IMPLEMENTATION-PLAN.md`, `docs/PROJECT-RULES.md`, `project_context.md` | Bổ sung mục **📸 Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S<n>/`)** cho toàn bộ 20 bước (`S0`–`S19`) và **Mẫu Báo cáo bàn giao 5 mục bắt buộc**: yêu cầu mỗi bước phải có script kiểm chứng `scripts/verify-S<n>`, sinh file mẫu thực tế (`.xml`, `.json`, `.xlsx`, `.zip`, `.md`) và chụp ảnh màn hình trình duyệt (`*.png`) lưu vào `docs/evidence/S<n>/`; cấm báo cáo hoàn tất suông | Theo yêu cầu của người dùng để nghiệm thu trực quan từng bước bằng ảnh chụp màn hình, file mẫu và script thực tế |
| 2026-11-23 | `docs/reference/`, `docs/DATA-SPEC.md`, `docs/OPEN-QUESTIONS.md` | Cập nhật tên 3 file ảnh `ksk_laixe_{01,02,03}.webp` và lưu thêm `docs/reference/gksk_mau_ky_so_root.xml`. Chốt thêm Q2 (xuất đủ thẻ, không bỏ thẻ rỗng), Q9 (gốc XML là `<root>`), Q10 (thẻ giới tính trong XML mẫu là `<GIOITINHVAL>`) | Đối chiếu trực tiếp với 3 ảnh BHXH và file XML mẫu người dùng cung cấp |
| 2026-11-23 | `project_context.md`, `docs/{ARCHITECTURE,DATA-SPEC,IMPLEMENTATION-PLAN,TEST-PLAN,OPEN-QUESTIONS,PROJECT-RULES}.md` | **Tinh chỉnh kiến trúc v1.1 (qua `/grill-me`):** (1) Bỏ hoàn toàn màn hình nhập liệu / form sửa trên web ở giai đoạn hiện tại (`EntryPage`, `CertificateForm`, `react-hook-form`). (2) Quy trình sửa lỗi: sửa trên file Excel (hoặc file Excel đối soát) rồi Import lại — tự động ghi đè thông minh theo `SO` (`overwrite_pending` mặc định chọn, `accepted_unchanged` mặc định bỏ chọn, `accepted_modified` cảnh báo và mặc định bỏ chọn). (3) Lưu cả dòng hợp lệ (`ready`) lẫn dòng lỗi dữ liệu (`invalid`, có `SO`) vào DB để Danh sách đối soát khớp 100% quân số file Excel. (4) Xuất XML: hỗ trợ cả xem trước/tải lẻ `<SO>.xml` và tải gộp `.zip`. (5) Màn hình Danh sách & Đối soát: 4 tab (`Tất cả`, `Chưa đẩy`, `Đã đẩy thành công`, `Cần xử lý`), lọc theo đợt import Excel & ngày, mở ngăn trượt (Drawer) chi tiết chỉ đọc 25 trường + XML + lịch sử gửi, và nút **Xuất Excel đối soát** (23 cột gốc + 6 cột đối soát, có thể sửa dòng lỗi rồi import ngược lại). (6) Đổi CSDL từ SQLite sang **MSSQL** trên server hiện tại với tiền tố bảng `gksk_*` và tách `DbRepositories` interface (`npm test` chạy `InMemoryRepositories` để bảo vệ tuyệt đối MSSQL đang vận hành). (7) Xóa 2 bản sao trùng trong `docs/project_context.md` và `docs/CHANGELOG.md` | Theo yêu cầu người dùng tập trung vào Import Excel, Xuất XML, Đẩy cổng và Kiểm tra/Đối soát trên hạ tầng MSSQL hiện tại |
| 2026-11-23 | `docs/reference/` | Thêm 3 ảnh `bhxh_pl2_3829_cau_truc_du_lieu_{1,2,3}.png` (bảng "Cấu trúc dữ liệu" của PL2 CV 3829) | Nguồn đối chiếu trường/độ dài từ BHXH |
| 2026-11-23 | `docs/DATA-SPEC.md` | §1: đổi thứ tự 25 thẻ theo bảng BHXH; thêm cột Max (độ dài) và cột BHXH (không cho null); ghi chú `GIOITINH` vs `GIOITINHVAL`. §2: thêm `LOCAL_FIELD_OVER_SPEC`, `LOCAL_SO_OVER_20`, `LOCAL_SO_FORMAT`, `LOCAL_BHXH_REQUIRED_EMPTY`, `LOCAL_FACILITY_MISMATCH`. §4: ví dụ XML theo thứ tự mới. §5: thứ tự cột template theo §1, bí danh cột `GIOITINH` | Đối chiếu với bảng BHXH |
| 2026-11-23 | `docs/API-CONTRACT.md` | §9–10: ghi chú độ dài `SO` (BHXH 20 / Sở 30 / ví dụ BHXH 21) và tham chiếu độ dài thẻ cho `GKSK_FIELD_TOO_LONG` | Như trên |
| 2026-11-23 | `docs/IMPLEMENTATION-PLAN.md` | S2/S3/S4: `maxLength`, `bhxhRequired`, thứ tự BHXH, ca kiểm độ dài sát biên, mã `LOCAL_*` mới | Như trên |
| 2026-11-23 | `docs/TEST-PLAN.md` | Thêm ca test độ dài/`SO` format/BHXH rỗng; fixtures `alias_gioitinh.xlsx`, `over_length.xlsx`; sửa ca S18 #11 | Như trên |
| 2026-11-23 | `docs/OPEN-QUESTIONS.md` | Q1 ✅; Q3, Q9 cập nhật; thêm Q10–Q13 | Như trên |
| 2026-11-23 | `project_context.md` | §4 thêm mục 15–16; §10 cập nhật câu hỏi mở | Như trên |
| 2026-11-23 | toàn bộ `docs/`, `project_context.md` | Tạo bộ tài liệu khởi đầu v1.0 | Chuẩn bị cho Agent xây dựng webapp |

## Nhật ký bước

### Mẫu mục (sao chép khi làm xong một bước)
```
## [S<n>] <tên bước> — <YYYY-MM-DD> — <Agent/người thực hiện>
### Đã làm
### Đầu ra (file/đường dẫn/lệnh)
### Kiểm thử (lệnh + kết quả tóm tắt)
### Cổng qua bước (từng ô ✔/✘)
### Quyết định & sai khác so với tài liệu (nếu có)
### Ghi chú cho Agent sau
```

## [S12] Xác thực ứng dụng (server) — 2026-11-25 — Antigravity
### Đã làm
- Cài đặt `bcryptjs` (v3.0.3, ESM + TypeScript types tích hợp) và `helmet` (v8.3.0) vào workspace `@gksk/server`.
- Tạo `server/src/middleware/rateLimit.ts` (`createLoginRateLimiter`, `extractClientIp`):
  - Giới hạn tối đa **10 lần đăng nhập sai / cửa sổ trượt 15 phút / IP**; lần thứ 11 trở đi chặn trước khi kiểm mật khẩu và trả HTTP `429` (`TOO_MANY_LOGIN_ATTEMPTS`) kèm header `Retry-After`.
  - Xóa bộ đếm sai khi đăng nhập thành công; hỗ trợ truyền đồng hồ giả `now` để kiểm thử xác định.
- Tạo `server/src/middleware/requireAuth.ts`:
  - `createSessionStore`: cấp phiên trong bộ nhớ kết hợp chữ ký HMAC-SHA256 (`timingSafeEqual`) qua cookie `gksk_session` (`HttpOnly`, `SameSite=Lax`, `Secure` khi `APP_ENV=production` hoặc HTTPS, `Path=/`, `Max-Age=28800` — 8 giờ), hỗ trợ thu hồi tức thì khi đăng xuất và kiểm soát đồng hồ `now`.
  - `createRequireAuthMiddleware`: yêu cầu phiên hợp lệ cho 100% route nghiệp vụ (trả HTTP `401` `UNAUTHORIZED` nếu chưa đăng nhập hoặc phiên hết hạn/bị thu hồi).
  - `createCsrfMiddleware`: với mọi method ghi (`POST`, `PUT`, `DELETE`, `PATCH`), bắt buộc header `X-Requested-With: gksk` (thiếu/sai trả HTTP `403` `CSRF_HEADER_REQUIRED`) và chặn `Content-Type` không thuộc `application/json` hoặc `multipart/form-data` (HTTP `403` `CSRF_INVALID_CONTENT_TYPE`).
  - `listExpressRoutes`: hàm quét tự động toàn bộ router của ứng dụng Express phục vụ kiểm toán bảo mật.
- Tạo `server/src/routes/auth.ts`:
  - `createAuthRouter`: cài đặt `POST /api/auth/login` (kiểm CSRF + rate limit + so username hằng thời gian + `bcrypt.compare` + xoay phiên chống session fixation + log an toàn không lộ mật khẩu/cookie), `POST /api/auth/logout` (kiểm CSRF + thu hồi phiên + `clearCookie`), `GET /api/auth/me` (trả `200` nếu có phiên, `401` nếu chưa đăng nhập).
  - `createConfigRouter`: cài đặt `GET /api/config` chỉ trả đúng 4 khóa công khai `{ appEnv, facilityId, facilityName, baseUrlHost }`, tuyệt đối không chứa mật khẩu, token, đường dẫn khóa hay thông tin DB.
- Cập nhật `server/src/app.ts` và `server/src/index.ts`:
  - Bật `helmet()` và ẩn `X-Powered-By`.
  - Gắn các route công khai/xác thực (`/api/health`, `/api/config`, `/api/auth/*`), và bọc toàn bộ các router nghiệp vụ (`import`, `certificates`, `send`) sau `requireAuth` + `csrfMiddleware`.
  - Truyền `config` và `logger` từ `loadConfigFromEnvFile()` vào `createApp({ config, logger })` tại `server/src/index.ts`.
- Viết bộ kiểm thử bảo mật tự động `server/src/routes/auth.test.ts` (5 nhóm ca kiểm thử): quét tự động toàn bộ Express router khẳng định 100% endpoint nghiệp vụ trả `401` khi chưa đăng nhập; kiểm tra `403` khi thiếu/sai `X-Requested-With` trên mọi route ghi & chặn form `urlencoded`; kiểm tra vòng đời login/me/logout, thu hồi phiên, hết hạn 8 giờ, cờ cookie `HttpOnly`/`SameSite=Lax`/`Secure`; kiểm tra giới hạn 10 lần sai/15 phút/IP trả `429` + mở khóa sau 15 phút; kiểm tra `/api/config` + `helmet` + spy logger 0 rò rỉ bí mật.
- Cập nhật các bộ test tích hợp S9–S11 (`server/src/services/send.test.ts`, `server/src/routes/certificates.test.ts`, `server/src/routes/import.test.ts`) sử dụng phiên đăng nhập thực qua `POST /api/auth/login` kèm header `X-Requested-With: gksk`.
- Viết và chạy script kiểm chứng `scripts/verify-S12.ts` xuất bảng quét bảo mật toàn bộ 20 route ra `docs/evidence/S12/auth-security-report.md` và `docs/evidence/S12/verify-output.txt`.

### Đầu ra (file/đường dẫn/lệnh)
- Server Auth & Middleware: `server/src/routes/auth.ts`, `server/src/middleware/requireAuth.ts`, `server/src/middleware/rateLimit.ts`, `server/src/app.ts`, `server/src/index.ts`.
- Kiểm thử: `server/src/routes/auth.test.ts`, `server/src/services/send.test.ts`, `server/src/routes/certificates.test.ts`, `server/src/routes/import.test.ts`.
- Cấu hình gói & Kiểm chứng: `server/package.json`, `package-lock.json`, `scripts/verify-S12.ts`.

### Bằng chứng bàn giao (`docs/evidence/S12/`)
- `docs/evidence/S12/auth-security-report.md`: bảng quét tự động 20 route Express (15/15 route nghiệp vụ trả `401` khi chưa đăng nhập; 9/9 route ghi trả `403` khi thiếu `X-Requested-With: gksk`; kết quả kiểm tra cờ cookie `HttpOnly`/`SameSite=Lax`/`Secure`, `/api/config`, `helmet`, và 11 lần thử đăng nhập sai với lần thứ 11 trả `429` + `Retry-After: 900`).
- `docs/evidence/S12/verify-output.txt`: bản sao báo cáo kiểm chứng S12.

### Kiểm thử (lệnh + kết quả tóm tắt)
- `npm.cmd run lint`: PASS (0 errors, 0 warnings).
- `npm.cmd run typecheck`: PASS (`@gksk/shared`, `@gksk/server`, `@gksk/client`, `@gksk/mock-gksk-api`).
- `npm.cmd run build -w @gksk/server`: PASS.
- `npm.cmd test`: PASS — 19/19 test files, 245/245 tests (`shared`: 145, `server`: 89 [5 auth + 6 import + 7 certificates/export + 9 send/job + 10 db repo + 17 client + 5 signature + 6 envelope + 9 xml + 11 config + 3 logger + 1 app], `client`: 1, `mock-gksk-api`: 10).
- `node node_modules/tsx/dist/cli.mjs scripts/verify-S12.ts`: PASS 100%.

### Cổng qua bước
- ✔ Test xanh (`lint`, `typecheck`, `test` 245/245 PASS, 0 skip/only).
- ✔ Có `docs/evidence/S12/auth-security-report.md` (và `docs/evidence/S12/verify-output.txt`).
- ✔ Các test S9–S11 được cập nhật dùng phiên đăng nhập thực + CSRF header, vẫn xanh 100%.

### Quyết định & sai khác so với tài liệu (nếu có)
- Dùng `bcryptjs` v3 (thuần JS, tương thích chuẩn hash `$2a$`/`$2b$` của `bcrypt`, không cần native addon C++ trên Windows) và kho phiên trong bộ nhớ kết hợp chữ ký HMAC-SHA256 để thu hồi phiên tức thì khi đăng xuất.

### Ghi chú cho Agent sau
- Đã sẵn sàng sang bước **S13 — Client: khung, đăng nhập, API layer** (`client/src/{main,App}.tsx`, `client/src/api/*`, `client/src/pages/LoginPage.tsx`, `client/src/components/EnvBanner.tsx`). Client gắn sẵn header `X-Requested-With: gksk` và `credentials: 'include'` trên mọi request trong `api/http.ts`, xử lý `401` → chuyển về trang đăng nhập.

## [S11] Excel: mẫu và import ghi đè thông minh — 2026-11-25 — Antigravity
### Đã làm
- Cài đặt `multer` và `@types/multer` vào workspace `@gksk/server`.
- Tạo `tests/fixtures/make-fixtures.ts` (`buildAllExcelFixtures`, `writeFixturesToDisk`) sinh đủ **19 bộ dữ liệu Excel kiểm thử** theo bảng `docs/TEST-PLAN.md §2.1`: `ok_5rows.xlsx`, `mixed_valid_invalid.xlsx`, `reimport_overwrite.xlsx`, `leading_zero.xlsx`, `dates_mixed.xlsx`, `dates_bad.xlsx`, `missing_required_col.xlsx`, `extra_cols_reordered.xlsx`, `blank_rows.xlsx`, `formulas.xlsx`, `dup_so.xlsx`, `facility_mismatch.xlsx`, `alias_gioitinh.xlsx`, `over_length.xlsx`, `enum_variants.xlsx`, `too_many_rows.xlsx`, `big_1000.xlsx`, `not_xlsx.xlsx`, `empty.xlsx`.
- Tạo `server/src/services/importService.ts` (`ImportService`, `createImportService`) theo đúng `docs/DATA-SPEC.md §5.1–§5.3`:
  - `buildTemplate()`: tạo `GKSK_mau_nhap_lieu.xlsx` bằng `exceljs` gồm 2 sheet:
    1. Sheet `GKSK`: 23 cột theo đúng thứ tự bảng BHXH (trừ `IDBENHVIEN`, `BENHVIEN`), định dạng Text (`numFmt = '@'`) cho toàn bộ 23 cột trong ít nhất 2000 dòng đầu (dòng `2..2001`), đóng băng dòng 1 (`ySplit: 1`), để trống dữ liệu và gắn Data Validation dạng danh sách (dropdown) cho `GIOITINHVAL` (`0,1`), `DVINONGDOCON` (`0,1`), `MATUY` (`0,1`), `KETLUAN` (`A0-1,A0-2,A0-3`), `STATE` (`ADD,EDIT`).
    2. Sheet `HuongDan`: bảng 5 cột (`Thẻ`, `Ý nghĩa`, `Bắt buộc (Sở / BHXH)`, `Định dạng & độ dài tối đa`, `Ví dụ giả`) sinh tự động từ `FIELDS`.
  - `previewImport(buffer)`:
    - Kiểm tra kích thước `≤ 5 MB`, magic bytes `PK\x03\x04` (`.xlsx`), tìm sheet `GKSK` (hoặc sheet đầu tiên).
    - Khớp tên cột không phân biệt hoa thường/khoảng trắng, chấp nhận bí danh `GIOITINH` → `GIOITINHVAL` (nếu có cả hai thì `GIOITINHVAL` thắng và báo `GIOITINH` bị bỏ qua), liệt kê cột lạ vào `ignoredColumns` (bao gồm 6 cột đối soát khi người dùng import ngược lại file Excel đối soát 29 cột), từ chối nếu thiếu bất kỳ cột nào trong 6 cột bắt buộc (`SO`, `HOTEN`, `NGAYSINH`, `SOCMND_PASSPORT`, `KETLUAN`, `NGAYKETLUAN`) hoặc vượt quá 1000 dòng dữ liệu.
    - Giải mã ô công thức (`result`), ô RichText, ô lỗi công thức (`#N/A`…), ngày `Date`/serial Excel/chuỗi, giữ số `0` đầu của `SOCMND_PASSPORT`, bắt lỗi `LOCAL_FACILITY_MISMATCH` nếu file Excel có cột `IDBENHVIEN` khác cấu hình server.
    - Tra cứu hàng loạt trong DB theo danh sách mã `SO` hợp lệ (`findBySoList`) để phân loại chính xác 5 chế độ `conflictMode` (`new`, `overwrite_pending`, `accepted_unchanged`, `accepted_modified`, `missing_so`) và gán `defaultSelected` theo `DATA-SPEC.md §5.2`.
  - `commitImport(payload)`: lưu/ghi đè cả các dòng hợp lệ (`status = 'ready'`) lẫn dòng có lỗi dữ liệu chặn (`status = 'invalid'`, miễn là có `SO` ≤ 30 ký tự) được chọn vào bảng `gksk_certificates`, gắn với đợt import `gksk_import_batches` để khớp 100% quân số file Excel.
- Tạo `server/src/routes/import.ts` (`createImportRouter`) và gắn vào `server/src/app.ts`:
  - `GET /api/import/template`
  - `POST /api/import/excel` (`multer` bộ nhớ `≤ 5 MB`, kiểm đuôi `.xlsx` và magic bytes `PK`)
  - `POST /api/import/commit`
- Viết bộ kiểm thử tích hợp Supertest & đơn vị `server/src/routes/import.test.ts` (6 nhóm ca kiểm thử lớn bao phủ toàn bộ 19 fixtures, ghi đè thông minh và round-trip file đối soát 29 cột của S10).
- Viết và chạy script kiểm chứng `scripts/verify-S11.ts` sinh file mẫu thật `docs/evidence/S11/GKSK_mau_nhap_lieu.xlsx` và biên bản kiểm chứng luồng ghi đè thông minh + round-trip file đối soát 29 cột ra `docs/evidence/S11/smart-import-report.md`.

### Đầu ra (file/đường dẫn/lệnh)
- Server Services & Routes: `server/src/services/importService.ts`, `server/src/routes/import.ts`, `server/src/app.ts`, `server/src/routes/import.test.ts`.
- Fixtures & Kiểm chứng: `tests/fixtures/make-fixtures.ts` (`tests/fixtures/*.xlsx`), `scripts/verify-S11.ts`.
- Cấu hình: `server/package.json`, `package-lock.json`, `server/tsconfig.json`, `server/tsconfig.build.json`, `eslint.config.js`.

### Bằng chứng bàn giao (`docs/evidence/S11/`)
- `docs/evidence/S11/GKSK_mau_nhap_lieu.xlsx`: file Excel mẫu thực tế (2 sheet `GKSK` 23 cột định dạng Text `@` 2000 dòng đầu + dropdown validation và sheet `HuongDan` 25 trường sinh từ `FIELDS`).
- `docs/evidence/S11/smart-import-report.md`: biên bản kiểm chứng cấu trúc file mẫu và mô phỏng khép kín luồng Import lần 1 (5 dòng) → Đẩy cổng → Xuất file Excel đối soát 29 cột → Sửa dòng lỗi/từ chối trực tiếp trên file đối soát 29 cột → Import lại lần 2 (6 cột đối soát tự động bỏ qua, phân loại đúng `accepted_unchanged`, `accepted_modified`, `overwrite_pending`, `new`) → Commit lần 2 thành công (0 rò rỉ PII trong log).
- `docs/evidence/S11/verify-output.txt`: bản sao log báo cáo kiểm chứng S11.

### Kiểm thử (lệnh + kết quả tóm tắt)
- `npm.cmd run lint`: PASS (0 errors, 0 warnings).
- `npm.cmd run typecheck`: PASS (`@gksk/shared`, `@gksk/server`, `@gksk/client`, `@gksk/mock-gksk-api`).
- `npm.cmd test`: PASS — 18/18 test files, 240/240 tests (`shared`: 145, `server`: 84 [6 import + 7 certificates/export + 9 send/job + 10 db repo + 17 client + 5 signature + 6 envelope + 9 xml + 11 config + 3 logger + 1 app], `client`: 1, `mock-gksk-api`: 10).
- `node node_modules/tsx/dist/cli.mjs scripts/verify-S11.ts`: PASS 100%.

### Cổng qua bước
- ✔ Toàn bộ 19 fixtures ở `TEST-PLAN.md §2.1` cho kết quả đúng (kể cả round-trip file Excel đối soát 29 cột và `big_1000.xlsx` < 10 s).
- ✔ Có file mẫu thật `docs/evidence/S11/GKSK_mau_nhap_lieu.xlsx` và `docs/evidence/S11/smart-import-report.md`.
- ✔ Báo cáo lỗi nêu **số dòng Excel** đúng (`rowNumber` giữ đúng số dòng Excel thật kể cả khi có dòng trống xen kẽ).
- ✔ Không có dữ liệu cá nhân trong log (`pino` chỉ ghi số lượng thống kê an toàn).

### Quyết định & sai khác so với tài liệu (nếu có)
- Không có sai khác.

### Ghi chú cho Agent sau
- Đã sẵn sàng sang bước **S12 — Xác thực ứng dụng (server)** (`server/src/routes/auth.ts`, `server/src/middleware/{requireAuth,rateLimit}.ts`, phiên cookie `httpOnly`, `sameSite=lax`, kiểm tra `X-Requested-With: gksk` cho method ghi, `helmet`, cập nhật các test S9–S11 dùng phiên đăng nhập).

## [S10] API Danh sách đối soát, Chi tiết chỉ đọc, Xuất XML (`.xml` & `.zip`) và Xuất Excel đối soát — 2026-11-25 — Antigravity
### Đã làm
- Cài đặt `exceljs` vào workspace `@gksk/server` (tuân thủ quyết định D6: không dùng gói `xlsx`/SheetJS trên npm).
- Tạo `server/src/services/exportService.ts`:
  - `sanitizeXmlFileName(so)` (và bí danh `buildXmlFileName(so)`): làm sạch ký tự cấm `/ \ : * ? " < > |`, ký tự điều khiển và chuỗi thoát thư mục `..` thành `_` an toàn.
  - `buildXmlZip(records, options)` (kèm `createZipArchiveBuffer` & `extractZipArchiveBuffer` chuẩn PKZIP DEFLATE / UTF-8 flag): đóng gói nhiều file `<SO>.xml` của các giấy hợp lệ (tự động loại bỏ giấy đang `invalid` hoặc có lỗi dữ liệu chặn `hasBlockingErrors`) vào một file `.zip`; tự đánh hậu tố `_2.xml`, `_3.xml` nếu hai mã `SO` khác nhau sau khi làm sạch bị trùng tên file.
  - `buildReconcileExcel(items)`: dùng `exceljs` xuất workbook `.xlsx` có sheet `GKSK` đóng băng dòng tiêu đề (freeze row 1), gồm **23 cột dữ liệu gốc** (đúng thứ tự bảng BHXH trừ `IDBENHVIEN`, `BENHVIEN`, định dạng Text `numFmt = '@'`) cộng thêm **6 cột đối soát ở cuối** (`TRANG_THAI_DOI_SOAT`, `DOT_IMPORT`, `THOI_GIAN_DAY`, `MSG_ID`, `CERTIFICATE_ID_SO`, `CHI_TIET_LOI_CANH_BAO`) theo đúng `docs/DATA-SPEC.md §5.4`.
- Tạo `server/src/middleware/errorHandler.ts` (`AppError`, `createErrorHandler`, `sendErrorResponse`) chuẩn hóa toàn bộ phản hồi lỗi dưới dạng `{ "error": { "code": "...", "message": "..." } }` và tuyệt đối không làm lộ PII.
- Tạo `server/src/services/certificateService.ts` (`CertificateService`, `createCertificateService`, `stripSensitiveFields`) và `server/src/routes/certificates.ts` (`createCertificatesRouter`), gắn vào `server/src/app.ts` cho 8 endpoint:
  - `GET /api/batches`: danh sách các đợt import Excel (`id`, `filename`, `rowCount`, `createdAt`).
  - `GET /api/certificates`: hỗ trợ `tab=all|unsent|accepted|attention`, `status`, `batchId`, `fromDate`, `toDate`, `q`, `page`, `pageSize`; trả kèm thống kê `counts` và thông tin lần gửi gần nhất; **tuyệt đối không trả 4 trường nhạy cảm (`NONGDOCON`, `MATUY`, `LYDO`, `TINHTRANGBENH`) ở danh sách**.
  - `GET /api/certificates/export-excel`: tải file `GKSK_doi_soat_<YYYYMMDD_HHmmss>.xlsx` (29 cột) theo bộ lọc hiện tại.
  - `POST /api/certificates/xml-zip`: tải file `GKSK_XML_<YYYYMMDD_HHmmss>.zip` chứa các file `<SO>.xml` hợp lệ.
  - `GET /api/certificates/:id`: chi tiết chỉ đọc đủ 25 trường + `issues[]` + `xml` (nếu không có lỗi chặn) + thông tin đợt import + lần gửi gần nhất.
  - `DELETE /api/certificates/:id`: xóa cục bộ giấy khỏi DB (kéo theo xóa `submissions`).
  - `GET /api/certificates/:id/xml`: tải file lẻ `<SO>.xml` (`Content-Disposition: attachment`; trả HTTP `422` nếu giấy đang `invalid`).
  - `GET /api/certificates/:id/submissions`: lịch sử các lần gửi của giấy.
  - Không tạo endpoint tạo/sửa tay (`POST /api/certificates`, `PUT /api/certificates/:id`).
- Viết bộ kiểm thử tích hợp Supertest & đơn vị `server/src/routes/certificates.test.ts` (7 ca kiểm thử) kiểm tra toàn diện tất cả endpoint và hàm xuất file.
- Viết và chạy script kiểm chứng `scripts/verify-S10.ts` gọi trực tiếp các endpoint để sinh và lưu 3 file mẫu thật (`TEST_75001_0001.xml`, `GKSK_XML_batch.zip`, `GKSK_doi_soat_sample.xlsx`) kèm biên bản `verify-output.txt` vào `docs/evidence/S10/`.

### Đầu ra (file/đường dẫn/lệnh)
- Server Services, Routes & Middleware: `server/src/services/exportService.ts`, `server/src/services/certificateService.ts`, `server/src/routes/certificates.ts`, `server/src/middleware/errorHandler.ts`, `server/src/app.ts`, `server/src/routes/certificates.test.ts`.
- Cấu hình gói: `server/package.json`, `package-lock.json`.
- Kiểm chứng: `scripts/verify-S10.ts`.

### Bằng chứng bàn giao (`docs/evidence/S10/`)
- `docs/evidence/S10/TEST_75001_0001.xml`: file XML tải lẻ từ `GET /api/certificates/:id/xml` (975 bytes UTF-8, đủ 25 thẻ đúng thứ tự BHXH).
- `docs/evidence/S10/GKSK_XML_batch.zip`: file ZIP tải từ `POST /api/certificates/xml-zip` đóng gói 3 file XML hợp lệ (`TEST_75001_0001.xml`, `00002_GKSKLX_75001_26.xml`, `TEST.75001.0003.xml`, tự động bỏ qua giấy `invalid`).
- `docs/evidence/S10/GKSK_doi_soat_sample.xlsx`: file Excel đối soát 29 cột (23 cột gốc định dạng Text `@` + 6 cột đối soát) tải từ `GET /api/certificates/export-excel`, có đủ 6 dòng đại diện cho các trạng thái `Đã đẩy thành công`, `Chờ đẩy cổng`, `Lỗi dữ liệu Excel`, `Cổng Sở từ chối`, `Lỗi mạng - Chờ gửi lại`.
- `docs/evidence/S10/verify-output.txt`: biên bản kiểm chứng chi tiết JSON danh sách đối soát (`counts`, ẩn 4 trường nhạy cảm), nội dung XML, bảng giải nén ZIP và bảng đọc lại 29 cột Excel bằng `exceljs`.

### Kiểm thử (lệnh + kết quả tóm tắt)
- `npm.cmd run lint`: PASS (0 errors, 0 warnings).
- `npm.cmd run typecheck`: PASS (`@gksk/shared`, `@gksk/server`, `@gksk/client`, `@gksk/mock-gksk-api`).
- `npm.cmd test`: PASS — 17/17 test files, 234/234 tests (`shared`: 145, `server`: 78 [7 certificates/export + 9 send/job + 10 db repo + 17 client + 5 signature + 6 envelope + 9 xml + 11 config + 3 logger + 1 app], `client`: 1, `mock-gksk-api`: 10).
- `node node_modules/tsx/dist/cli.mjs scripts/verify-S10.ts`: PASS 100%.

### Cổng qua bước
- ✔ Test xanh (`lint`, `typecheck`, `test` 234/234 PASS, 0 skip/only).
- ✔ Có đủ 3 file mẫu thật `.xml`, `.zip`, `.xlsx` (cùng `verify-output.txt`) trong `docs/evidence/S10/`.
- ✔ Không có endpoint tạo/sửa tay (`POST /api/certificates`, `PUT /api/certificates/:id` đều trả HTTP 404).

### Quyết định & sai khác so với tài liệu (nếu có)
- Không có sai khác. Trong `exportService.ts`, xuất cả hai tên hàm `sanitizeXmlFileName` và `buildXmlFileName` (bí danh) để khớp cả mô tả trong prompt lẫn `docs/IMPLEMENTATION-PLAN.md`. Tự cài đặt bộ đóng gói/giải nén PKZIP chuẩn (`DEFLATE` + cờ UTF-8 bit 11 bằng `node:zlib`) không cần thêm dependency bên thứ ba cho ZIP.

### Ghi chú cho Agent sau
- Đã sẵn sàng sang bước **S11 — Excel: mẫu và import ghi đè thông minh** (`server/src/services/importService.ts`, `server/src/routes/import.ts`, script sinh fixtures `tests/fixtures/make-fixtures.ts`, kiểm thử round-trip lấy chính file Excel đối soát 29 cột của S10 sửa dòng lỗi rồi đưa vào `previewImport`).

## [S9] Dịch vụ gửi (máy trạng thái) và gửi hàng loạt — 2026-11-23 — Antigravity
### Đã làm
- Tạo `server/src/services/sendService.ts` (`SendService`, `createSendService`, `computeCertificatePayload`, `toSafeCertificateSummary`, `SendServiceError`) theo đúng `docs/ARCHITECTURE.md §6`:
  - `sendCertificate(id)`:
    1. Kiểm tra lại dữ liệu bằng `validateRecord(cert.fields, { facilityId, today })` (tính `today` theo giờ Việt Nam `UTC+7` hoặc ghi đè khi test); nếu có lỗi chặn (`hasBlockingErrors(issues)`) thì cập nhật trạng thái giấy sang `invalid` và **không** gọi API.
    2. Dựng XML (`buildGkskXml`) → Base64 (`toBase64Utf8`) → tính `data_sha256 = SHA256_UPPER(base64Data.trim())`; tra cứu submission chưa có kết quả (`result_status === null`) có cùng `data_sha256` qua `findPendingByCertificateAndSha` để tái sử dụng `msg_id` & `send_datetime` cũ, hoặc tạo submission mới với `newMsgId` khi dữ liệu đã thay đổi.
    3. Chuyển trạng thái giấy sang `sending`; nếu là lần gửi lại từ submission dở dang (`attempts > 0`), tự động bật `checkStatusFirst: true` để gọi `GET /status` trước khi `POST /push`.
    4. Đẩy gói tin qua `gkskClient.push(envelope)` (`withRetry`), ghi nhận đầy đủ `attempts`, `http_status`, `res_code`, `result_status` (`accepted` | `rejected` | `null`), `server_submission_id`, `server_certificate_id`, `errors_json`, `warnings_json`, `last_error` (không chứa dữ liệu cá nhân/PII) và `finished_at`.
    5. Cập nhật `gksk_certificates.status` (`accepted | rejected | error`), bọc `try / catch` để đảm bảo không bao giờ để giấy bị kẹt ở trạng thái `sending`.
  - `refreshSubmission(submissionId)`: gọi `gkskClient.status(submission.msgId)` để đồng bộ kết quả (`accepted`/`rejected` hoặc `404`/`error`) vào cả `gksk_submissions` và `gksk_certificates`.
- Tạo `server/src/services/jobService.ts` (`JobService`, `createJobService`) quản lý hàng đợi gửi hàng loạt trong bộ nhớ:
  - Chạy tối đa 2 worker song song (`MAX_BATCH_CONCURRENCY = 2`).
  - Điều tốc tuần tự qua cổng `pacerChain` với khoảng nghỉ tối thiểu `BATCH_SEND_INTERVAL_MS = 250` ms giữa hai lần phát lệnh gửi liên tiếp (tối đa `240 gói/phút < 300 gói/phút` ở mọi cửa sổ 60 giây).
  - Tự động tạm dừng toàn bộ hàng đợi (`pauseQueue`) theo thời gian `Retry-After` ngay khi bất kỳ worker nào gặp phản hồi HTTP 429.
- Tạo `server/src/routes/send.ts` (`createSendRouter`) và gắn vào `server/src/app.ts` (đảm bảo `routes` chỉ gọi `services`):
  - `POST /api/certificates/:id/send`
  - `POST /api/send`
  - `GET /api/jobs/:jobId`
  - `POST /api/submissions/:id/refresh`
- Viết bộ kiểm thử tích hợp `server/src/services/send.test.ts` (9 ca kiểm thử) với Mock Server: gửi đơn hợp lệ (`2.1`), chặn giấy `invalid` (0 request tới Mock), retry lỗi mạng giữ nguyên `msg_id` & idempotent (`2.2`), cập nhật dữ liệu cùng `SO` sinh `msg_id` mới ghi đè giữ cùng `certificate_id` (`2.3`), cảnh báo không chặn (`2.4`) & lưu `errors_json` khi `rejected` + tra lại `refresh`, gửi batch 25 giấy (21 `accepted` + 3 `rejected` + 1 `error`, 0 giấy kẹt `sending`, spy logger 0 lộ PII, `recoverOnStartup`), tạm dừng hàng đợi khi gặp HTTP 429, kiểm chứng giới hạn tốc độ batch 400 giấy với đồng hồ giả (`≤ 240 gói/phút < 300 gói/phút`), và kiểm tra mã lỗi HTTP `400`/`404`.
- Viết và chạy script kiểm chứng `scripts/verify-S9.ts` thực thi thật kịch bản Postman `2.1–2.4` và batch 25 giấy qua Mock Server + App Server, ghi nhật ký tiến độ polling và lịch sử submissions ra `docs/evidence/S9/batch-send-report.md`.

### Đầu ra (file/đường dẫn/lệnh)
- Server Services & Routes: `server/src/services/sendService.ts`, `server/src/services/jobService.ts`, `server/src/routes/send.ts`, `server/src/app.ts`, `server/src/services/send.test.ts`.
- Kiểm chứng: `scripts/verify-S9.ts`.

### Bằng chứng bàn giao (`docs/evidence/S9/`)
- `docs/evidence/S9/batch-send-report.md`: biên bản kiểm chứng kịch bản Postman `2.1–2.4` qua API của app, bảng nhật ký 15 lần polling `GET /api/jobs/:jobId` cho batch 25 giấy (21 `accepted`, 3 `rejected` có `errors_json`, 1 `error`), kết quả `POST /api/submissions/:id/refresh`, gửi lại giấy `#25` giữ nguyên 100% `msg_id`, và kiểm toán 85 dòng log JSON `pino` (0 rò rỉ PII/token).
- `docs/evidence/S9/verify-output.txt`: bản sao log báo cáo kiểm chứng S9.

### Kiểm thử (lệnh + kết quả tóm tắt)
- `npm.cmd run lint`: PASS (0 errors, 0 warnings).
- `npm.cmd run typecheck`: PASS (`@gksk/shared`, `@gksk/server`, `@gksk/client`, `@gksk/mock-gksk-api`).
- `npm.cmd test`: PASS — 16/16 test files, 227/227 tests (`shared`: 145, `server`: 71 [9 send/job + 10 db repo + 17 client + 5 signature + 6 envelope + 9 xml + 11 config + 3 logger + 1 app], `client`: 1, `mock-gksk-api`: 10).
- `node node_modules/tsx/dist/cli.mjs scripts/verify-S9.ts`: PASS 100%.

### Cổng qua bước
- ✔ Kịch bản Postman 2.1–2.4 tái hiện qua API của app.
- ✔ Có `docs/evidence/S9/batch-send-report.md` (và `docs/evidence/S9/verify-output.txt`).
- ✔ Không log dữ liệu cá nhân (test spy logger xác nhận 0 lộ PII/token).
- ✔ Kết quả `rejected` được lưu đầy đủ trong `errors_json`.

### Quyết định & sai khác so với tài liệu (nếu có)
- Không có sai khác. Bổ sung `toSafeCertificateSummary()` trong `sendService.ts` để phản hồi của các endpoint gửi/refresh không trả thừa `fields`/`fieldsJson` chứa 4 trường nhạy cảm.

### Ghi chú cho Agent sau
- Đã sẵn sàng sang bước **S10 — API Danh sách đối soát, Chi tiết chỉ đọc, Xuất XML (`.xml` & `.zip`) và Xuất Excel đối soát** (`server/src/services/{certificateService,exportService}.ts`, `server/src/routes/certificates.ts`, `server/src/middleware/errorHandler.ts`).

## [S8] DB (MSSQL `gksk_*` & Repository Interface) — 2026-11-23 — Antigravity
### Đã làm
- Cài đặt `mssql` và `@types/mssql` vào workspace `@gksk/server`.
- Tạo `server/src/db/types.ts` định nghĩa giao diện `DbRepositories` cho 3 kho `batches`, `certificates`, `submissions`:
  - `batches`: `create`, `findById`, `list`.
  - `certificates`: `upsertBySo` & `upsertManyBySo` (lưu cả bản ghi `ready` lẫn `invalid` có `SO`), `findById`, `findByIds`, `findBySo`, `findBySoList(soList)` (tra cứu hàng loạt cho xem trước Import Excel), `list` (truy vấn phân trang theo 4 tab đối soát `all | unsent | accepted | attention`, lọc `batchId`, khoảng ngày `fromDate`/`toDate`, tìm kiếm `q`, trả kèm `counts`), `countByStatus`, `updateStatus`, `deleteById` (`ON DELETE CASCADE` sang `submissions`), và `recoverOnStartup` (chuyển giấy đang kẹt ở `sending` → `error`).
  - `submissions`: `create`, `update`, `findById`, `findByMsgId`, `listByCertificateId`, `findLatestByCertificateId`, `findLatestByCertificateIds`, `findPendingByCertificateAndSha` (phục vụ khôi phục `msg_id` chưa có kết quả cùng `data_sha256` ở S9).
- Tạo `server/src/db/inMemoryRepo.ts` (`InMemoryRepositories` & `createInMemoryRepositories`) làm mặc định cho toàn bộ `npm test` để chạy nhanh và tuyệt đối không chạm vào MSSQL đang vận hành.
- Tạo `server/src/db/migrations/001_init.sql`:
  - 100% tên bảng có tiền tố `gksk_` (`gksk_schema_migrations`, `gksk_import_batches`, `gksk_certificates`, `gksk_submissions`) và 3 chỉ mục `ix_gksk_*` (`ix_gksk_cert_status`, `ix_gksk_cert_batch`, `ix_gksk_sub_cert`).
  - Tự động kiểm tra `IF OBJECT_ID(N'dbo.gksk_...', N'U') IS NULL` trước khi tạo bảng và `IF NOT EXISTS` trước khi tạo chỉ mục; tuyệt đối không có lệnh `DROP` hay `TRUNCATE`.
- Tạo `server/src/db/mssqlRepo.ts` (`MssqlRepositories`) và `server/src/db/connection.ts` (`buildMssqlPoolConfig`, `createMssqlPool`, `runMigrations`, `createRepositories`):
  - 100% câu truy vấn SQL (24/24 câu) là chuỗi SQL tĩnh hoàn toàn (`0` nội suy `${...}`) và ràng buộc toàn bộ tham số `@param` qua `request.input('param', sql.Type, value)`.
  - Escape ký tự đại diện T-SQL `LIKE` (`%`, `_`, `[`, `\`) qua `escapeSqlLikePattern()` kết hợp `LIKE @qPattern ESCAPE N'\'` để tìm kiếm `q` an toàn tuyệt đối với `%`, `_`, `'`.
- Viết bộ contract test & quét tĩnh an toàn SQL `server/src/db/repo.test.ts` (10 ca kiểm thử).
- Viết và chạy script kiểm chứng `scripts/verify-S8.ts` xuất biên bản kiểm chứng toàn bộ thao tác Repository và bảng kiểm toán 24 câu truy vấn SQL ra `docs/evidence/S8/db-verification-report.md`.

### Đầu ra (file/đường dẫn/lệnh)
- Server DB: `server/src/db/types.ts`, `server/src/db/inMemoryRepo.ts`, `server/src/db/mssqlRepo.ts`, `server/src/db/connection.ts`, `server/src/db/migrations/001_init.sql`, `server/src/db/repo.test.ts`.
- Cấu hình gói: `server/package.json`, `package-lock.json`.
- Kiểm chứng: `scripts/verify-S8.ts`.

### Bằng chứng bàn giao (`docs/evidence/S8/`)
- `docs/evidence/S8/db-verification-report.md`: biên bản kiểm chứng 9 hạng mục hợp đồng `DbRepositories` và bảng kiểm toán tĩnh 4 bảng `gksk_*`, 3 chỉ mục `ix_gksk_*`, 0 lệnh `DROP`/`TRUNCATE`, và 24/24 câu truy vấn SQL tham số hóa 100% qua `.input()`.
- `docs/evidence/S8/verify-output.txt`: bản sao log báo cáo kiểm chứng S8.

### Kiểm thử (lệnh + kết quả tóm tắt)
- `npm.cmd run lint`: PASS (0 errors, 0 warnings).
- `npm.cmd run typecheck`: PASS (`@gksk/shared`, `@gksk/server`, `@gksk/client`, `@gksk/mock-gksk-api`).
- `npm.cmd test`: PASS — 15/15 test files, 218/218 tests (`shared`: 145, `server`: 62 [10 db repo + 17 client + 5 signature + 6 envelope + 9 xml + 11 config + 3 logger + 1 app], `client`: 1, `mock-gksk-api`: 10).
- `node node_modules/tsx/dist/cli.mjs scripts/verify-S8.ts`: PASS 100% (24 SQL queries audited, 0 DROP/TRUNCATE, 100% gksk_* prefix).

### Cổng qua bước
- ✔ Test xanh (`lint`, `typecheck`, `test` 218/218 PASS, 0 skip/only).
- ✔ Có `docs/evidence/S8/db-verification-report.md`.
- ✔ Grep/quét tĩnh xác nhận mọi câu SQL trong `mssqlRepo.ts` và `connection.ts` đều dùng `@param` qua `.input()`, 0 câu lệnh `DROP`/`TRUNCATE`, và 100% tên bảng bắt đầu bằng `gksk_`.

### Quyết định & sai khác so với tài liệu (nếu có)
- Không có sai khác. Bổ sung thêm `findLatestByCertificateIds()` và `findPendingByCertificateAndSha()` trong `SubmissionsRepository` để bước S9 (`sendService`) và S10 (`exportService`) truy vấn nhanh mà không phải lặp N+1 truy vấn.

### Ghi chú cho Agent sau
- Đã sẵn sàng sang bước **S9 — Dịch vụ gửi (máy trạng thái) và gửi hàng loạt** (`server/src/services/{sendService,jobService}.ts`, `server/src/routes/send.ts`).

## [S7] GKSK client (login, push, status, retry) — 2026-11-23 — Antigravity
### Đã làm
- Tạo `server/src/gksk/errors.ts`:
  - Định nghĩa phân loại kết quả `{ kind: 'accepted' | 'rejected' | 'transient' | 'config', ... }` (`GkskSendResult`, `GkskLoginResult`, `GkskStatusResult`, `GkskTimelineEvent`).
  - Cài đặt `normalizeServerIssues()`, `parseLenientPushData()` (bỏ qua trường lạ, chuẩn hóa thiếu `errors`/`warnings` thành `[]`), `parseRetryAfterSeconds()` (kẹp `1..120` giây) và `classifyHttpFailure()` theo đúng bảng `docs/API-CONTRACT.md §8`.
- Tạo `server/src/gksk/retry.ts`:
  - Cài đặt `withRetry(target, initialEnvelope, options)` theo đúng chính sách `docs/API-CONTRACT.md §8`:
    - Tối đa 3 lần thử lại với khoảng chờ `5s → 15s → 45s` (`RETRY_DELAYS_MS = [5000, 15000, 45000]`); gặp HTTP 429 chờ theo `Retry-After` (tối đa 120s).
    - **Trước mỗi lần gửi lại sau timeout / lỗi mạng / 5xx bắt buộc gọi `status(msg_id)` trước**: nếu `status` trả HTTP 200 (`accepted` hoặc `rejected`) thì thu hồi kết quả luôn (`recoveredViaStatus = true`), tuyệt đối không gọi `push` lần 2; nếu `status` trả HTTP 404 mới gọi `push` lại với **cùng `msg_id`, `send_datetime`, `data`, `signature`**.
    - Gặp HTTP 403 (`CM_PERMISSION_DENY`): xóa cache token, tự động gọi `login()` lại đúng 1 lần rồi thử lại; nếu vẫn 403 thì dừng và trả `kind: 'config'`.
    - Gặp HTTP 409 (trùng `msg_id` với CSYT khác): tự sinh `msg_id` mới + ký lại gói tin rồi thử lại đúng 1 lần.
    - Không retry khi giấy bị `rejected` (HTTP 200), lỗi envelope HTTP 400, login sai, hoặc `header.ref_msg_id` lệch.
- Tạo `server/src/gksk/client.ts` (`GkskClient` & `createGkskClient`):
  - `login()`: gọi `POST /api/auth/login`, cache token tới `now + duration - 5 phút` (`TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000`); từ chối không retry khi sai tài khoản/mật khẩu hoặc thiếu `data.token`.
  - `pushOnce(envelope)` & `push(envelope)`: timeout bằng `AbortController`, giữ đúng thứ tự 8 khóa `header`, kiểm tra chặt `header.ref_msg_id === envelope.header.msg_id` (lệch → lỗi bất thường `isAbnormal = true`, không ghi đè kết quả), parse khoan dung `data`.
  - `status(msgId)`: gọi `GET /api/platform/gksk-lai-xe/status?msg_id=...`, parse khoan dung cấu trúc `{ code, message, data }` (không có `header`), hỗ trợ tự đăng nhập lại 1 lần nếu gặp HTTP 403.
  - Ghi log qua `pino` chỉ chứa siêu dữ liệu an toàn (`msgId`, `senderId`, `httpStatus`, `resCode`, `durationMinutes`), tuyệt đối không log token, `Authorization`, mật khẩu hay dữ liệu cá nhân (PII).
- Viết bộ kiểm thử tích hợp & đơn vị `server/src/gksk/client.test.ts` (17 ca kiểm thử) bao phủ toàn bộ 13 kịch bản ở `docs/TEST-PLAN.md §3.3` với Mock Server (dùng đồng hồ/`sleep` giả để chạy nhanh) + spy logger khẳng định không bao giờ log token/`Authorization`/PII.
- Viết và chạy script kiểm chứng `scripts/verify-S7.ts` thực thi 6 tình huống retry/timeout/status-recovery/429/403 trên Mock Server và xuất nhật ký dòng thời gian (`timeline`) ra `docs/evidence/S7/retry-timeline-report.md`.

### Đầu ra (file/đường dẫn/lệnh)
- Server: `server/src/gksk/errors.ts`, `server/src/gksk/retry.ts`, `server/src/gksk/client.ts`, `server/src/gksk/client.test.ts`.
- Cấu hình build kiểu cho Mock API phục vụ test: `tools/mock-gksk-api/package.json`, `tools/mock-gksk-api/tsconfig.json`, `package.json`.
- Kiểm chứng: `scripts/verify-S7.ts`.

### Bằng chứng bàn giao (`docs/evidence/S7/`)
- `docs/evidence/S7/retry-timeline-report.md`: biên bản kiểm chứng 6 tình huống (`S7-01` → `S7-06`) kèm bảng `result.timeline` từng bước, bảng đối chiếu gói tin `POST /push` (chứng minh giữ nguyên 100% `msg_id`, `send_datetime`, `data`, `signature` khi retry), nhật ký request tại Mock Server, kiểm tra 18 dòng log JSON `pino` (0 lộ token/`Authorization`/PII) và quét tĩnh 0 lệnh `console.log` trong `server/src`.
- `docs/evidence/S7/verify-output.txt`: bản sao log báo cáo kiểm chứng S7.

### Kiểm thử (lệnh + kết quả tóm tắt)
- `npm.cmd run lint`: PASS (0 errors, 0 warnings).
- `npm.cmd run typecheck`: PASS (`@gksk/shared`, `@gksk/server`, `@gksk/client`, `@gksk/mock-gksk-api`).
- `npm.cmd test`: PASS — 14/14 test files, 208/208 tests (`shared`: 145, `server`: 52 [17 client + 5 signature + 6 envelope + 9 xml + 11 config + 3 logger + 1 app], `client`: 1, `mock-gksk-api`: 10).
- Độ phủ `server/src/gksk/` (`v8`): **94.81% Lines** (`client.ts`: 91.94%, `retry.ts`: 97.04%, `errors.ts`: 100%, `envelope.ts`: 100%, `signature.ts`: 100%, `xml.ts`: 100%), **100% Functions** — vượt ngưỡng ≥ 90% của `TEST-PLAN.md §7`.
- `node node_modules/tsx/dist/cli.mjs scripts/verify-S7.ts`: PASS 100% (6/6 scenarios).

### Cổng qua bước
- ✔ Mọi kịch bản ở `TEST-PLAN.md §3.3` (13/13 kịch bản) đều xanh.
- ✔ Có `docs/evidence/S7/retry-timeline-report.md`.
- ✔ Test spy logger khẳng định **không** log token / `Authorization` / mật khẩu / PII.
- ✔ Quét `console.log` trong `server/src` rỗng (0 kết quả).

### Quyết định & sai khác so với tài liệu (nếu có)
- Không có sai khác. Bổ sung trường `timeline: GkskTimelineEvent[]` và `recoveredViaStatus: boolean` trong `GkskSendResult` cùng tùy chọn `checkStatusFirst?: boolean` trong `WithRetryOptions` để hỗ trợ trực tiếp cho dịch vụ gửi (`sendService`) ở bước S9 và xuất báo cáo dòng thời gian ở S7.

### Ghi chú cho Agent sau
- Đã sẵn sàng sang bước **S8 — DB (MSSQL `gksk_*` & Repository Interface)** (`server/src/db/{types,inMemoryRepo,mssqlRepo,connection}.ts`, `server/src/db/migrations/001_init.sql`, 100% bảng có tiền tố `gksk_`, 100% truy vấn dùng `.input()` tham số hóa, `npm test` mặc định chỉ chạy trên `InMemoryRepositories`).

## [S6] Mock API server — 2026-11-23 — Antigravity
### Đã làm
- Khởi tạo workspace độc lập `tools/mock-gksk-api` (`@gksk/mock-gksk-api`), chỉ import danh sách đặc tả thẻ từ `@gksk/shared` và hoàn toàn không dùng chung code với `server/` (cấu hình thêm luật `no-restricted-imports` trong `eslint.config.js` để khóa ranh giới kiến trúc).
- Cấu hình script `npm run dev:mock` tại `package.json` gốc chạy đồng thời `mock`, `server`, `client`.
- Cài đặt `tools/mock-gksk-api/src/app.ts` (`createMockGkskApp`) và `tools/mock-gksk-api/src/index.ts` theo đúng `docs/API-CONTRACT.md §1–§12`:
  - `POST /api/auth/login`: kiểm tra tài khoản CSYT giả lập (`75001`, `75002`, hoặc từ biến môi trường `MOCK_USERNAME`/`MOCK_PASSWORD`), trả `header.res_code = "CM_SUCCESS"` + `data.token` (`duration = 720`, `refresh_duration = 1440`); từ chối HTTP 401 (`data: null`) khi sai mật khẩu.
  - `POST /api/platform/gksk-lai-xe/push`:
    - Kiểm tra HTTP header `service-type: 100` (thiếu/sai → HTTP 400 `CM_INVALID_REQUEST`), `Authorization: Bearer <token>` và vai trò CSYT (sai/thiếu → HTTP 403 `CM_PERMISSION_DENY`).
    - Kiểm tra đầy đủ cấu trúc envelope (`version`, `sender_id`, `receiver_id = "TTYQG"`, `txn_type = "sync_gksk_lai_xe"`, `msg_type = "101"`, `data_type`, `send_datetime`, `msg_id` khớp regex `<sender_id> + YYMMDD + UUIDv4`, `signature` khác rỗng → thiếu trả HTTP 400 `PS_DS_RSA_SIGNATURE_MISSING`).
    - Hỗ trợ cờ `MOCK_VERIFY_SIGNATURE=1` kiểm tra chữ ký RSA 2048-bit thật bằng public key (sai → HTTP 400 `PS_DS_RSA_SIGNATURE_INVALID`).
    - Trả HTTP 409 `CM_INVALID_REQUEST` nếu `msg_id` đã được CSYT khác sử dụng.
    - Xử lý Idempotent theo `msg_id` của cùng CSYT (kịch bản 2.2): trả lại đúng `submission_id` và `certificate_id` của lần gửi đầu.
    - Giải mã Base64, kiểm tra giới hạn 1 MB, chặn `DOCTYPE`/`ENTITY`, kiểm tra cú pháp XML & gốc `<root>` có thẻ `<SO>`, áp dụng đầy đủ 9 mã từ chối ở `API-CONTRACT.md §9` (trả HTTP 200 `PS_SYNC_SUCCESS` với `data.status = "rejected"`) và các mã cảnh báo ở `§10` (`GKSK_UNSIGNED`, `GKSK_UNKNOWN_TAG`, `GKSK_ID_INVALID`, `GKSK_KETLUAN_UNKNOWN`, `GKSK_GIOITINH_UNKNOWN`, `GKSK_NONGDOCON_INVALID`, `GKSK_DVINONGDOCON_INVALID`, `GKSK_MATUY_INVALID`, `GKSK_DATE_INVALID`, `GKSK_FIELD_TOO_LONG`, `GKSK_STATE_ADD_EXISTS`).
    - Ghi đè theo `(facilityId, SO)` khi gửi `msg_id` mới cho cùng `SO` (kịch bản 2.3): tạo `submission_id` mới nhưng giữ nguyên `certificate_id` cũ.
  - `GET /api/platform/gksk-lai-xe/status?msg_id=...`: trả `{ code: "CM_SUCCESS", message, data }` (**không có `header`**) khớp 100% với `data` lúc push (kịch bản 3.1), hoặc HTTP 404 `{ code: "CM_INVALID_REQUEST", message, data: null }` khi không tìm thấy (kịch bản 3.2).
  - Endpoint quản trị lỗi `POST /__mock/fail { mode: 'timeout'|'500'|'429'|'403-once'|..., count, retryAfterSec, timeoutMs }`, `POST /__mock/reset`, `GET /__mock/state` để phục vụ kiểm thử retry ở S6 & S7.
- Viết bộ test tự động `tools/mock-gksk-api/src/app.test.ts` (10 ca kiểm thử) tái hiện toàn bộ kịch bản Postman `1.1 → 4.6`, điều khiển lỗi `/__mock/fail` và verify chữ ký RSA.
- Viết và chạy script kiểm chứng `scripts/verify-S6.ts` xuất biên bản chi tiết Request/Response của 15 kịch bản ra `docs/evidence/S6/postman-scenarios-report.md`.

### Đầu ra (file/đường dẫn/lệnh)
- Mock API: `tools/mock-gksk-api/package.json`, `tools/mock-gksk-api/tsconfig.json`, `tools/mock-gksk-api/tsconfig.build.json`, `tools/mock-gksk-api/vitest.config.ts`, `tools/mock-gksk-api/src/app.ts`, `tools/mock-gksk-api/src/index.ts`, `tools/mock-gksk-api/src/app.test.ts`.
- Gốc: `package.json` (`dev:mock`), `eslint.config.js` (luật cấm import chéo `server/` vào `tools/mock-gksk-api`).
- Kiểm chứng: `scripts/verify-S6.ts`.

### Bằng chứng bàn giao (`docs/evidence/S6/`)
- `docs/evidence/S6/postman-scenarios-report.md`: biên bản kiểm chứng 15/15 kịch bản (`1.1`, `1.2`, `2.1`, `2.2`, `2.3`, `2.4`, `3.1`, `3.2`, `4.1`–`4.5`, `4.6`, `MOCK-429`) kèm bảng tổng hợp và JSON Request/Response thực tế.
- `docs/evidence/S6/verify-output.txt`: bản sao log báo cáo kiểm chứng S6.

### Kiểm thử (lệnh + kết quả tóm tắt)
- `npm.cmd run lint`: PASS (0 errors, 0 warnings).
- `npm.cmd run typecheck`: PASS (`@gksk/shared`, `@gksk/server`, `@gksk/client`, `@gksk/mock-gksk-api`).
- `npm.cmd test`: PASS — 13/13 test files, 191/191 tests (`shared`: 145, `server`: 35, `client`: 1, `mock-gksk-api`: 10).
- `node node_modules/tsx/dist/cli.mjs scripts/verify-S6.ts`: PASS 100% (15/15 scenarios).

### Cổng qua bước
- ✔ 2.2 trả cùng `submission_id`.
- ✔ 2.3 trả cùng `certificate_id` (và kèm cảnh báo `GKSK_STATE_ADD_EXISTS` khi `STATE=ADD`).
- ✔ 3.2 → HTTP 404 (không có `header`, `data: null`).
- ✔ 4.1–4.5 `rejected` trả HTTP 200 (`header.res_code = "PS_SYNC_SUCCESS"`, `data.status = "rejected"`).
- ✔ 4.6 trả HTTP 400 (`CM_INVALID_REQUEST`).
- ✔ 429 có header `Retry-After`.
- ✔ Có `docs/evidence/S6/postman-scenarios-report.md`.
- ✔ Mock **không** dùng chung code với `server/` (chỉ dùng `@gksk/shared`).

### Quyết định & sai khác so với tài liệu (nếu có)
- Mở rộng thêm các chế độ giả lập lỗi trong `POST /__mock/fail` (`disconnect-after-save`, `mismatched-ref-msg-id`, `sparse-response`, `400`, `409`) cùng `POST /__mock/reset` và `GET /__mock/state` để phục vụ trực tiếp cho toàn bộ 13 kịch bản kiểm thử retry của bước S7 (`TEST-PLAN.md §3.3`).

### Ghi chú cho Agent sau
- Đã sẵn sàng sang bước **S7 — GKSK client (login, push, status, retry)** (`server/src/gksk/{client,errors,retry}.ts`, kiểm thử đủ 13 kịch bản ở `TEST-PLAN.md §3.3` với Mock Server và xuất `docs/evidence/S7/retry-timeline-report.md`).

## [S5] Server: `msg_id`, envelope, chữ ký — 2026-11-23 — Antigravity
### Đã làm
- Tạo `server/src/gksk/signature.ts` theo đúng `docs/API-CONTRACT.md §5`:
  - Định nghĩa `ENVELOPE_HEADER_KEYS` (8 khóa đúng thứ tự: `version, sender_id, receiver_id, txn_type, msg_id, msg_type, data_type, send_datetime`), `EnvelopeHeader`, `EnvelopeSignatureParts`.
  - `serializeEnvelopeHeader(header)`: ép đối tượng `header` về đúng thứ tự 8 khóa trước khi `JSON.stringify(header)` (gọn, không khoảng trắng thừa).
  - `sha256HexUpper(input)`: tính SHA-256 chuỗi UTF-8 ra 64 ký tự hexa viết hoa.
  - `computeEnvelopeSignatureParts(header, data, privateKeyPem?)` & `signEnvelope(header, data, privateKeyPem?)`: tính `H = SHA256_UPPER(JSON.stringify(header))`, `D = SHA256_UPPER(data.trim())`, `signed = H + "." + D`; nếu có `privateKeyPem` thì ký `RSA-PKCS1v1.5-SHA256` ra Base64, nếu không có khóa thì trả `"CHUA-KY-" + signed.slice(0, 16)`.
  - `verifyEnvelopeSignature(header, data, signature, publicKeyPem)`: hàm phụ trợ xác thực chữ ký RSA phục vụ kiểm thử và Mock Server (khi bật `MOCK_VERIFY_SIGNATURE=1`).
- Tạo `server/src/gksk/envelope.ts` theo đúng `docs/API-CONTRACT.md §3–§4`:
  - `formatVnYyMmDd(nowMs)`: tính `YYMMDD` theo giờ Việt Nam (`UTC+7` cố định qua `new Date(nowMs + 7 * 3600 * 1000).toISOString()`), không phụ thuộc múi giờ máy và không gọi trực tiếp `Date.now()` trong logic.
  - `newMsgId(senderId, nowMs)`: kiểm tra `senderId` hợp lệ (`^[A-Za-z0-9._-]+$`), ghép `sender_id + YYMMDD (UTC+7) + uuidV4SansDash` (32 ký tự hexa viết thường từ `crypto.randomUUID()`).
  - `buildEnvelopeHeader({ senderId, msgId, sendDatetime })` & `buildEnvelope({ senderId, xml, msgId, sendDatetime, privateKeyPem? })`: dựng gói tin `{ header, data, signature }` với `header` giữ chính xác thứ tự 8 khóa, `data = toBase64Utf8(xml)` và `signature = signEnvelope(header, data, privateKeyPem)`.
- Viết bộ unit test `server/src/gksk/signature.test.ts` (5 ca) và `server/src/gksk/envelope.test.ts` (6 ca): kiểm tra khớp từng ký tự với Golden Vector ở `API-CONTRACT.md §5`, ép thứ tự 8 khóa `header` kể cả khi input bị đảo key, `newMsgId` ở mốc giao thừa giờ VN (`16:59:59Z` → `261123`, `17:00:00Z` & `17:30:00Z` → `261124`) trên 5 múi giờ `TZ` khác nhau, sinh 10.000 `msg_id` liên tiếp không trùng, và ký/verify RSA 2048-bit.
- Viết và chạy script kiểm chứng độc lập `scripts/verify-S5.ts` xuất gói tin mẫu `docs/evidence/S5/sample-envelope.json` và bảng đối chiếu từng dòng Golden Vector (`Expected` vs `Actual`) ra `docs/evidence/S5/verify-output.txt`.

### Đầu ra (file/đường dẫn/lệnh)
- Server: `server/src/gksk/signature.ts`, `server/src/gksk/envelope.ts`, `server/src/gksk/signature.test.ts`, `server/src/gksk/envelope.test.ts`.
- Kiểm chứng: `scripts/verify-S5.ts`.

### Bằng chứng bàn giao (`docs/evidence/S5/`)
- `docs/evidence/S5/sample-envelope.json`: gói tin JSON mẫu hoàn chỉnh ứng với Golden Vector (`API-CONTRACT.md §5`), giữ nguyên thứ tự 8 khóa `header`.
- `docs/evidence/S5/verify-output.txt`: biên bản đối chiếu từng dòng Golden Vector (`Expected` vs `Actual` khớp 100% cho `Object.keys(header)`, `headerJson`, `data`, `H`, `D`, `signed`, `signature`), kiểm chứng ký/verify RSA 2048-bit, kiểm chứng `newMsgId` tại mốc giao thừa giờ VN trên 4 múi giờ `TZ`, 10.000 `msg_id` không trùng, và quét tĩnh 0 lệnh gọi `Date.now()`.

### Kiểm thử (lệnh + kết quả tóm tắt)
- `npm.cmd run lint`: PASS (0 errors, 0 warnings).
- `npm.cmd run typecheck`: PASS (`@gksk/shared`, `@gksk/server`, `@gksk/client`).
- `npm.cmd test`: PASS — 12/12 test files, 181/181 tests (`shared`: 145, `server`: 35 [5 signature + 6 envelope + 9 xml + 11 config + 3 logger + 1 app], `client`: 1).
- Độ phủ `server/src/gksk/{envelope,signature}.ts` (`v8`): **100% Lines**, **100% Statements**, **100% Branches**, **100% Functions**.
- `node node_modules/tsx/dist/cli.mjs scripts/verify-S5.ts`: PASS 100%.

### Cổng qua bước
- ✔ Golden vector xanh (`headerJson`, `data`, `H`, `D`, `signed`, `signature` khớp 100% từng ký tự).
- ✔ Có đủ `docs/evidence/S5/sample-envelope.json` và `docs/evidence/S5/verify-output.txt`.
- ✔ Không có `Date.now()` gọi trực tiếp trong logic (`envelope.ts` và `signature.ts` đều nhận `nowMs` / `sendDatetime` qua tham số).

### Quyết định & sai khác so với tài liệu (nếu có)
- Không có sai khác. Bổ sung thêm `computeEnvelopeSignatureParts()`, `serializeEnvelopeHeader()` và `verifyEnvelopeSignature()` trong `signature.ts` để hỗ trợ trích xuất từng thành phần băm (`headerJson`, `H`, `D`, `signedPayload`) khi đối soát Golden Vector và xác thực chữ ký RSA.

### Ghi chú cho Agent sau
- Đã sẵn sàng sang bước **S6 — Mock API server** (`tools/mock-gksk-api/src/*`, script `npm run dev:mock`, tái hiện toàn bộ kịch bản Postman `1.1 → 4.6`, nhớ quy tắc Mock **không** dùng chung code với `server/`, chỉ dùng `@gksk/shared`).

## [S4] Server: dựng XML — 2026-11-23 — Antigravity
### Đã làm
- Cài đặt devDependency `fast-xml-parser` cho workspace `@gksk/server` để kiểm thử round-trip và kiểm định cú pháp XML.
- Tạo `server/src/gksk/xml.ts`:
  - `buildGkskXml(record)`: hàm thuần dựng chuỗi XML chuẩn UTF-8 theo đúng `docs/DATA-SPEC.md §4`:
    - Khai báo `<?xml version="1.0" encoding="UTF-8"?>`, thẻ gốc `<root>`, không BOM (`0xFEFF` / `0xEF 0xBB 0xBF`), không `DOCTYPE`, không comment (`<!--`), không `<Signature>`, không thẻ ngoài chuẩn (`UUID`, `STATUS`, `SIGNDATA`).
    - Xuất đủ **25 thẻ** theo đúng thứ tự bảng BHXH (`FIELD_ORDER` từ `@gksk/shared`: `SO`, `NGAYKHAM`, `HOTEN`, `GIOITINHVAL`… kết thúc `STATE`).
    - Thẻ rỗng xuất tường minh dạng `<TAG></TAG>`, thụt lề 2 khoảng trắng, kết thúc dòng `\n`.
    - Escape đầy đủ 5 ký tự đặc biệt XML (`& < > " '`) qua `escapeXmlText()` và xóa ký tự điều khiển cấm của XML 1.0 (`\x00-\x08`, `\x0B`, `\x0C`, `\x0E-\x1F`, `\uFFFE`, `\uFFFF`) qua `stripInvalidXmlChars()` (giữ `\t`, `\n`, `\r`).
    - Chặn quá kích thước 1 MB (`MAX_XML_BYTES = 1024 * 1024`) bằng `XmlSizeLimitError` (không đưa dữ liệu hồ sơ/PII vào thông điệp lỗi).
  - `toBase64Utf8(xml)`: mã hóa chuỗi XML sang Base64 chuẩn (UTF-8, có padding `=`, không xuống dòng).
- Viết bộ unit test `server/src/gksk/xml.test.ts` (9 ca kiểm thử): snapshot XML bản ghi mẫu (`DATA-SPEC.md §6`), 25 thẻ đúng thứ tự BHXH và `<TAG></TAG>`, round-trip bằng `fast-xml-parser` (kể cả `& < > " '`, tiếng Việt có dấu, xuống dòng `\n` trong `LYDO`), không chứa BOM/`DOCTYPE`/comment/`Signature`/thẻ lạ, chống XML injection, tính xác định tuyệt đối, lọc ký tự điều khiển XML 1.0, chặn > 1 MB không lộ PII, và giải mã Base64 khớp từng byte UTF-8 (kèm Golden Vector `<root><SO>TEST.75001.1</SO></root>`).
- Viết và chạy script kiểm chứng độc lập `scripts/verify-S4.ts` sinh 2 file XML thật (`sample-gksk.xml`, `special-chars-gksk.xml`) và đối chiếu 25/25 thẻ với `docs/reference/gksk_mau_ky_so_root.xml`.

### Đầu ra (file/đường dẫn/lệnh)
- Server: `server/src/gksk/xml.ts`, `server/src/gksk/xml.test.ts`, `server/package.json`.
- Gốc: `package-lock.json`.
- Kiểm chứng: `scripts/verify-S4.ts`.

### Bằng chứng bàn giao (`docs/evidence/S4/`)
- `docs/evidence/S4/sample-gksk.xml`: file XML mẫu hoàn chỉnh (947 byte UTF-8, không BOM, 25 thẻ đúng thứ tự BHXH, 3 thẻ rỗng `<NGAYKHAMLAI></NGAYKHAMLAI>`, `<LYDO></LYDO>`, `<TINHTRANGBENH></TINHTRANGBENH>`).
- `docs/evidence/S4/special-chars-gksk.xml`: file XML chứa tiếng Việt có dấu, `& < > " '`, xuống dòng trong `LYDO`, và đã lọc ký tự điều khiển cấm `\x00`, `\x07`, `\x1F` (1328 byte UTF-8).
- `docs/evidence/S4/verify-output.txt`: biên bản kiểm chứng tự động các quy tắc XML 1.0, round-trip `fast-xml-parser`, Base64 UTF-8 + Golden Vector, và bảng đối chiếu 25/25 thẻ dữ liệu với `docs/reference/gksk_mau_ky_so_root.xml`.

### Kiểm thử (lệnh + kết quả tóm tắt)
- `npm.cmd run lint`: PASS (0 errors, 0 warnings).
- `npm.cmd run typecheck`: PASS (`@gksk/shared`, `@gksk/server`, `@gksk/client`).
- `npm.cmd test`: PASS — 10/10 test files, 170/170 tests (`shared`: 145, `server`: 24 [9 xml + 11 config + 3 logger + 1 app], `client`: 1).
- Độ phủ `server/src/gksk/xml.ts` (`v8`): **100% Lines**, **100% Statements**, **100% Functions**, 83.33% Branches (vượt ngưỡng ≥ 90% dòng).
- `node node_modules/tsx/dist/cli.mjs scripts/verify-S4.ts`: PASS 100%.

### Cổng qua bước
- ✔ Test xanh (`lint`, `typecheck`, `test` 170/170 PASS, 0 skip/only).
- ✔ Có đủ `docs/evidence/S4/sample-gksk.xml`, `docs/evidence/S4/special-chars-gksk.xml` và `docs/evidence/S4/verify-output.txt`.
- ✔ Đã nhúng toàn bộ nội dung `sample-gksk.xml` trong báo cáo bàn giao để người dùng kiểm tra trực tiếp.

### Quyết định & sai khác so với tài liệu (nếu có)
- Cài `fast-xml-parser` vào `devDependencies` của `@gksk/server` vì `server/src/gksk/xml.ts` tự dựng XML thuần không phụ thuộc thư viện ngoài; `fast-xml-parser` chỉ dùng cho kiểm thử round-trip và script kiểm chứng.

### Ghi chú cho Agent sau
- Đã sẵn sàng sang bước **S5 — Server: `msg_id`, envelope, chữ ký** (`server/src/gksk/{envelope,signature}.ts`, đối chiếu Golden Vector ở `docs/API-CONTRACT.md §5`, không gọi `Date.now()` trực tiếp trong logic).

## [S3] `shared`: chuẩn hóa và kiểm tra dữ liệu — 2026-11-23 — Antigravity
### Đã làm
- Tạo `packages/shared/src/normalize.ts` cài đặt hàm thuần `normalizeRecord(raw)` và các hàm phụ trợ theo `docs/DATA-SPEC.md §3`:
  - `cleanText()`: xóa ký tự điều khiển XML 1.0 không hợp lệ (`\x00-\x08`, `\x0B`, `\x0C`, `\x0E-\x1F`, `\uFFFE`, `\uFFFF`), chuẩn hóa Unicode về NFC và `trim()`.
  - `normalizeDateValue()`: nhận chuỗi `d/M/yyyy`, `dd/MM/yyyy`, `yyyy-MM-dd`, đối tượng `Date` và số serial ngày Excel (tính theo UTC từ gốc `1899-12-30`) → xuất `dd/MM/yyyy` (zero-padded); giữ nguyên chuỗi ngày không tồn tại (`31/02/1990`, `29/02/2025`, `31/04/2026`…) để validator bắt lỗi.
  - `normalizeIdValue()`: giữ số 0 đầu của `SOCMND_PASSPORT`, bỏ dấu `'` đầu và khoảng trắng bên trong (không tự bù số 0 đầu).
  - Chuẩn hóa enum `GIOITINHVAL` (`Nam/Nữ/Nu/M/F` → `0/1`, hỗ trợ bí danh cột `GIOITINH`), `KETLUAN` (chữ hoa, thay `–`/`—`/`−` và khoảng trắng quanh `-` về `-`), và `STATE` (rỗng mặc định là `ADD`).
- Tạo `packages/shared/src/validate.ts` cài đặt hàm thuần `validateRecord(record, ctx: { facilityId, today })` và `hasBlockingErrors(issues)` theo `docs/DATA-SPEC.md §1–§2`:
  - Bao phủ đầy đủ các mã lỗi chặn **server-mirror (R)**: `GKSK_SO_MISSING`, `GKSK_SO_TOO_LONG` (> 30 ký tự), `GKSK_HOTEN_INVALID` (trống hoặc > 255 ký tự), `GKSK_NGAYSINH_INVALID` (không phải ngày thật `dd/MM/yyyy` hoặc năm ngoài `1900..today.year`), `GKSK_ID_MISSING`, `GKSK_FACILITY_MISMATCH`, `GKSK_NGAYKETLUAN_INVALID`, `GKSK_KETLUAN_MISSING`.
  - Bao phủ đầy đủ các mã cảnh báo **server-mirror (W)**: `GKSK_DATE_INVALID` (`NGAYKHAM`, `NGAYTHANGNAMCAP`, `NGAYKHAMLAI` khác rỗng và sai ngày), `GKSK_GIOITINH_UNKNOWN`, `GKSK_ID_INVALID` (toàn số 0 hoặc 10/11 chữ số), `GKSK_NONGDOCON_INVALID`, `GKSK_DVINONGDOCON_INVALID`, `GKSK_MATUY_INVALID`, `GKSK_KETLUAN_UNKNOWN`.
  - Bao phủ đầy đủ các mã cục bộ **`LOCAL_*`**: `LOCAL_FIELD_OVER_SPEC` (mọi thẻ có `maxLength` trừ `SO`), `LOCAL_SO_OVER_20` (21–30 ký tự), `LOCAL_SO_FORMAT` (`^\d{5}/GKSKLX/<IDBENHVIEN>/\d{2}$`), `LOCAL_BHXH_REQUIRED_EMPTY` (**gộp thành đúng 1 dòng** với `fields: FieldTag[]`), `LOCAL_NGAYSINH_FUTURE`, `LOCAL_KETLUAN_A03_NO_RECHECK`, `LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM`, `LOCAL_ID_CREATES_PERSON` (9 hoặc 12 chữ số, khác toàn số 0).
- Xuất `normalize.ts` và `validate.ts` qua `packages/shared/src/index.ts`; cấu hình `@vitest/coverage-v8` trong `packages/shared/vitest.config.ts`.
- Viết bộ unit test data-driven `packages/shared/src/normalize.test.ts` (47 tests) và `packages/shared/src/validate.test.ts` (84 tests, gồm 72 ca ma trận `VALIDATION_MATRIX_CASES` ≥ 60 ca theo `docs/TEST-PLAN.md §3.1`).
- Viết và chạy script kiểm chứng `scripts/verify-S3.ts` sinh báo cáo đầy đủ vào `docs/evidence/S3/validation-report.md`.

### Đầu ra (file/đường dẫn/lệnh)
- Shared: `packages/shared/src/normalize.ts`, `packages/shared/src/validate.ts`, `packages/shared/src/index.ts`, `packages/shared/vitest.config.ts`.
- Unit tests: `packages/shared/src/normalize.test.ts`, `packages/shared/src/validate.test.ts`, `packages/shared/src/messages.test.ts`.
- Kiểm chứng: `scripts/verify-S3.ts`.

### Bằng chứng bàn giao (`docs/evidence/S3/`)
- `docs/evidence/S3/validation-report.md`: báo cáo kết quả chuẩn hóa 11 kịch bản điển hình, kiểm tra 4 hồ sơ mẫu tổng hợp, bảng đối chiếu 23 mã quy tắc kích hoạt/sát biên, thông số độ phủ v8 (`100%` Lines/Statements/Branches/Functions) và log chạy Vitest thực tế ở cả 2 múi giờ `TZ=Asia/Ho_Chi_Minh` & `TZ=America/Los_Angeles`.

### Kiểm thử (lệnh + kết quả tóm tắt)
- `npm.cmd run lint`: PASS (0 errors, 0 warnings).
- `npm.cmd run typecheck`: PASS (`@gksk/shared`, `@gksk/server`, `@gksk/client`).
- `npm.cmd test`: PASS — 9/9 test files, 161/161 tests (`shared`: 145 [8 fields + 5 messages + 47 normalize + 84 validate + 1 ping], `server`: 15, `client`: 1).
- Độ phủ `packages/shared` (`v8`): **100% Lines** (445/445), **100% Statements**, **100% Branches** (98/98), **100% Functions** (22/22) — vượt ngưỡng ≥ 95%.
- Kiểm chứng 2 múi giờ (`TZ=Asia/Ho_Chi_Minh` và `TZ=America/Los_Angeles`): đều PASS 145/145 tests.
- `node node_modules/tsx/dist/cli.mjs scripts/verify-S3.ts`: PASS 100%.

### Cổng qua bước
- ✔ Độ phủ dòng `shared` ≥ 95% (đạt **100%**).
- ✔ Chạy với 2 múi giờ `TZ` khác nhau (`Asia/Ho_Chi_Minh`, `America/Los_Angeles`) đều xanh.
- ✔ Có `docs/evidence/S3/validation-report.md`.

### Quyết định & sai khác so với tài liệu (nếu có)
- Cài thêm devDependency `@vitest/coverage-v8@^3.2.7` để đo chính xác độ phủ dòng `packages/shared` bằng Vitest v8 provider.

### Ghi chú cho Agent sau
- Đã sẵn sàng sang bước **S4 — Server: dựng XML** (`server/src/gksk/xml.ts`: `buildGkskXml(record)` và `toBase64Utf8(xml)`).

## [S2] `shared`: đặc tả trường và kiểu — 2026-11-23 — Antigravity
### Đã làm
- Tạo `packages/shared/src/types.ts` định nghĩa `FIELD_ORDER` (25 thẻ theo thứ tự bảng BHXH), `FieldTag`, `FieldType`, `FieldSpec`, `SensitiveTag`, `GkskRecord` (25 khóa, giá trị `string`), `GkskListFields` (loại bỏ 4 trường nhạy cảm), `Issue`, `ServerIssue`, `ConflictMode`, `CertificateStatus`, `ReconcileTab`.
- Tạo `packages/shared/src/fields.ts` mô tả đầy đủ 25 trường theo đúng thứ tự bảng BHXH ở `docs/DATA-SPEC.md §1` (bắt đầu `SO`, `NGAYKHAM`, `HOTEN`, `GIOITINHVAL`… kết thúc `STATE`), với đầy đủ thuộc tính `order`, `tag`, `label`, `type`, `maxLength`, `serverMaxLength`, `bhxhRequired`, `soRequired`, `enumValues`, `enumLabels`, `sensitive`, `inTemplate`, `readOnly`, `excelAliases`, `note` cùng các tập hằng dẫn xuất (`FIELD_BY_TAG`, `SENSITIVE_TAGS`, `SO_REQUIRED_TAGS`, `BHXH_REQUIRED_TAGS`, `BHXH_OPTIONAL_TAGS`, `TEMPLATE_FIELDS`, `EXCEL_REQUIRED_COLUMNS`, `createEmptyRecord`).
- Tạo `packages/shared/src/messages.ts` ánh xạ toàn bộ **36 mã** sang thông điệp tiếng Việt có dấu (9 mã từ chối `API-CONTRACT.md §9`, 14 mã cảnh báo `API-CONTRACT.md §10`, 13 mã cục bộ `LOCAL_*` ở `DATA-SPEC.md §2` gồm cả `LOCAL_SO_EXISTS`, `LOCAL_SO_ACCEPTED_UNCHANGED`, `LOCAL_SO_ACCEPTED_MODIFIED`), kèm `getIssueMessage()` (trả nguyên mã nếu gặp mã lạ) và `formatIssueMessage()`.
- Xuất đầy đủ module qua `packages/shared/src/index.ts`.
- Viết unit test `packages/shared/src/fields.test.ts` (8 ca) và `packages/shared/src/messages.test.ts` (5 ca), cùng script kiểm chứng độc lập `scripts/verify-S2.ts` đối chiếu trực tiếp với `docs/reference/gksk_mau_ky_so_root.xml`.

### Đầu ra (file/đường dẫn/lệnh)
- Shared: `packages/shared/src/types.ts`, `packages/shared/src/fields.ts`, `packages/shared/src/messages.ts`, `packages/shared/src/index.ts`.
- Unit tests: `packages/shared/src/fields.test.ts`, `packages/shared/src/messages.test.ts`.
- Kiểm chứng: `scripts/verify-S2.ts`.

### Bằng chứng bàn giao (`docs/evidence/S2/`)
- `docs/evidence/S2/fields-and-messages-report.md`: bảng đối chiếu tự động 25 trường BHXH (khớp 25/25 thẻ dữ liệu của `docs/reference/gksk_mau_ky_so_root.xml`) và bảng toàn bộ 36 mã lỗi/cảnh báo/thông tin tiếng Việt.

### Kiểm thử (lệnh + kết quả tóm tắt)
- `npm.cmd run lint`: PASS (0 errors, 0 warnings).
- `npm.cmd run typecheck`: PASS (`@gksk/shared`, `@gksk/server`, `@gksk/client`).
- `npm.cmd test`: PASS — 7/7 test files, 30/30 tests (`shared`: 14 [8 fields + 5 messages + 1 ping], `server`: 15, `client`: 1).
- `node node_modules/tsx/dist/cli.mjs scripts/verify-S2.ts`: PASS 100%.

### Cổng qua bước
- ✔ Test xanh (`lint`, `typecheck`, `test` 30/30 PASS, 0 skip/only).
- ✔ Có file `docs/evidence/S2/fields-and-messages-report.md` đối chiếu khớp 25/25 thẻ với tài liệu gốc và file XML mẫu `gksk_mau_ky_so_root.xml`.

### Quyết định & sai khác so với tài liệu (nếu có)
- Bổ sung thêm `serverMaxLength: 30` (và hằng `SO_BHXH_MAX_LENGTH = 20`, `SO_SERVER_MAX_LENGTH = 30`) trên đặc tả thẻ `SO`, cùng `enumLabels` và `excelAliases` (`['GIOITINH']` cho `GIOITINHVAL`) để các bước S3 (`validate.ts`), S10/S11 (`exportService`/`importService`) và S16 (Drawer) dùng chung một nguồn sự thật.

### Ghi chú cho Agent sau
- Đã sẵn sàng sang bước **S3 — `shared`: chuẩn hóa và kiểm tra dữ liệu** (`packages/shared/src/{normalize,validate}.ts` + bộ test table-driven ≥ 60 ca, coverage `shared` ≥ 95%, kiểm chứng 2 múi giờ `TZ`).

## [S1] Cấu hình và logger — 2026-11-23 — Antigravity
### Đã làm
- Cài đặt `zod`, `pino`, `dotenv` cho workspace `@gksk/server`.
- Tạo `.env.example` đầy đủ 20 biến chuẩn theo `project_context.md §7` (bao gồm cấu hình MSSQL `DB_*`, cấu hình CSYT `GKSK_*`, và đăng nhập nội bộ `APP_LOGIN_*`, `SESSION_SECRET`).
- Viết `server/src/config.ts`:
  - `loadConfig(env)` kiểm tra cấu hình bằng `zod` theo cơ chế fail-fast (`ConfigError`), liệt kê rõ từng biến thiếu/sai và **tuyệt đối không in giá trị bí mật**.
  - Chuẩn hóa `GKSK_BASE_URL` (cắt bỏ dấu `/` ở cuối), cho phép `http://localhost` khi `APP_ENV=test`, bắt buộc `https://` khi `APP_ENV=production`.
  - `GKSK_SENDER_ID` trống mặc định bằng `GKSK_FACILITY_ID`.
  - Cung cấp `loadConfigFromEnvFile()` và `getPublicConfig(config)` (trả thông tin công khai cho `/api/config`, không lộ bí mật hay thông tin DB).
- Viết `server/src/logger.ts` bằng `pino` với `REDACT_PATHS` che toàn bộ `authorization`, `Authorization`, `password`, `dbPassword`, `token`, `fields`, `fields_json`, `data`, `cookie`, `set-cookie`, `sessionSecret`, `loginPasswordHash`, `privateKey`, `privateKeyPem` ở mọi cấp độ lồng nhau thành `"[Redacted]"`.
- Cập nhật `server/src/index.ts` nạp cấu hình fail-fast khi khởi động (thoát mã `1` với thông báo rõ nếu thiếu `.env`) và dùng `pino` logger thay cho ghi log thô.
- Viết bộ unit test `server/src/config.test.ts` (11 ca) và `server/src/logger.test.ts` (3 ca), và script kiểm chứng độc lập `scripts/verify-S1.ts`.

### Đầu ra (file/đường dẫn/lệnh)
- Gốc: `.env.example`.
- Server: `server/package.json`, `server/src/config.ts`, `server/src/logger.ts`, `server/src/index.ts`, `server/src/config.test.ts`, `server/src/logger.test.ts`.
- Kiểm chứng: `scripts/verify-S1.ts`.

### Bằng chứng bàn giao (`docs/evidence/S1/`)
- `docs/evidence/S1/verify-output.txt`: log chạy độc lập 5 mục kiểm chứng (đủ 20 biến `.env.example`, fail-fast khi thiếu biến không lộ bí mật, chuẩn hóa URL & ép HTTPS ở production & mặc định `GKSK_SENDER_ID`, chạy thật `server/src/index.ts` thiếu `.env` thoát mã `1`, và log `pino` che toàn bộ mật khẩu/token/PII thành `"[Redacted]"`).

### Kiểm thử (lệnh + kết quả tóm tắt)
- `npm.cmd run lint`: PASS (0 errors, 0 warnings).
- `npm.cmd run typecheck`: PASS (`@gksk/shared`, `@gksk/server`, `@gksk/client`).
- `npm.cmd test`: PASS — 5/5 test files, 17/17 tests (`shared`: 1, `server`: 15 [11 config + 3 logger + 1 app], `client`: 1).
- `node node_modules/tsx/dist/cli.mjs scripts/verify-S1.ts`: PASS toàn bộ 5 mục kiểm chứng.

### Cổng qua bước
- ✔ Test xanh (`lint`, `typecheck`, `test` 17/17 PASS).
- ✔ Chạy server thiếu `.env` → thoát mã `1` (`!= 0`) với thông báo nêu rõ từng biến thiếu.
- ✔ Có `docs/evidence/S1/verify-output.txt` chứng minh `pino` redact hoạt động ở cả cấp gốc lẫn lồng nhau.
- ✔ Không có bí mật nào trong repo (`.env` bị `.gitignore` chặn; `.env.example` chỉ chứa placeholder).

### Quyết định & sai khác so với tài liệu (nếu có)
- Sử dụng `zod@^4.6.7`, `pino@^10.4.0`, `dotenv@^18.0.10`. Bổ sung `LOG_LEVEL` (tùy chọn, mặc định `info`) và hàm `getPublicConfig()` sẵn sàng cho endpoint `GET /api/config`.

### Ghi chú cho Agent sau
- Khi chạy `npm test` cho `@gksk/server` trên Windows, Supertest (`app.test.ts`) bind port `127.0.0.1` cục bộ cần chạy ngoài sandbox (nếu bị `EACCES`).
- Đã sẵn sàng sang bước **S2 — `shared`: đặc tả trường và kiểu** (`packages/shared/src/{fields,types,messages,index}.ts`).

## [S0] Khởi tạo monorepo — 2026-11-23 — Antigravity
### Đã làm
- Khởi tạo git repository (`git init`) và kiểm tra đầy đủ bộ tài liệu gốc (`docs/`, `project_context.md`, `CHANGELOG.md`).
- Tạo `package.json` gốc với npm workspaces (`["packages/*", "server", "client", "tools/*"]`), `engines.node >= 20.0.0`, cùng các script gốc: `dev`, `lint`, `typecheck`, `test`, `build`, `format:check`.
- Cấu hình `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), ESLint 9 flat config (`eslint.config.js` kèm luật chặn phụ thuộc chéo giữa `shared`, `client`, `server`), Prettier (`.prettierrc`), `.editorconfig`, `.gitignore` (chặn `node_modules/`, `dist/`, `.env`, `coverage/`).
- Khởi tạo 3 workspace cùng Vitest:
  - `packages/shared` (`@gksk/shared`): hàm `ping()` + unit test.
  - `server` (`@gksk/server`): Express 4.x với `GET /api/health` trả `{"ok":true}` + test Supertest.
  - `client` (`@gksk/client`): React 18 + Vite 6 hiển thị tiêu đề `"GKSKLaiXe — Hệ thống Import Excel, Xuất XML & Đối soát GKSK Lái xe"`, gọi proxy `/api/health` và hiển thị kết quả + test Testing Library.
- Viết và chạy script kiểm chứng độc lập `scripts/verify-S0.mjs`; khởi chạy `npm run dev` và chụp ảnh màn hình giao diện thực tế.

### Đầu ra (file/đường dẫn/lệnh)
- Gốc: `package.json`, `package-lock.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.editorconfig`, `.gitignore`.
- Shared: `packages/shared/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}`, `packages/shared/src/{index.ts,index.test.ts}`.
- Server: `server/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}`, `server/src/{index.ts,app.ts,app.test.ts}`, `server/src/routes/health.ts`.
- Client: `client/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html}`, `client/src/{main.tsx,App.tsx,App.css,App.test.tsx,testSetup.ts}`.
- Kiểm chứng: `scripts/verify-S0.mjs`.

### Bằng chứng bàn giao (`docs/evidence/S0/`)
- `docs/evidence/S0/verify-output.txt`: toàn bộ log chạy `lint`, `typecheck`, `test`, `build`, `git check-ignore -v .env` và kiểm tra trực tiếp `GET http://127.0.0.1:3099/api/health` → HTTP 200 `{"ok":true}`.
- `docs/evidence/S0/client-home.png`: ảnh chụp màn hình trình duyệt tại `http://127.0.0.1:5173/` hiển thị tiêu đề hệ thống và trạng thái `Kết nối /api/health: Thành công ({"ok": true}) · shared: pong` (0 console errors).

### Kiểm thử (lệnh + kết quả tóm tắt)
- `npm run lint`: PASS (0 errors, 0 warnings).
- `npm run typecheck`: PASS (`@gksk/shared`, `@gksk/server`, `@gksk/client`).
- `npm test`: PASS — 3/3 test files, 3/3 tests (`shared`: 1, `server` Supertest: 1, `client` RTL: 1).
- `npm run build`: PASS (`shared` tsc, `server` tsc, `client` Vite bundle).
- `node scripts/verify-S0.mjs`: PASS toàn bộ 6 mục kiểm chứng.

### Cổng qua bước
- ✔ Build sạch từ máy mới (`npm install` & `npm run build` thành công).
- ✔ `.gitignore` chặn `.env` (xác nhận bằng `git check-ignore -v .env` → `.gitignore:9:.env`).
- ✔ Có đủ ảnh `docs/evidence/S0/client-home.png` và `docs/evidence/S0/verify-output.txt`.
- ✔ `CHANGELOG.md` đã ghi S0.

### Quyết định & sai khác so với tài liệu (nếu có)
- Nâng `vitest` lên `^3.0.5` và hoist `vite@^6.0.5` ở root `package.json` để tránh xung đột kiểu `PluginOption` giữa Vite 5 và Vite 6 trong monorepo.

### Ghi chú cho Agent sau
- Khi chạy lệnh npm trên PowerShell Windows có ExecutionPolicy Restricted, dùng `npm.cmd`.
- Đã sẵn sàng sang bước **S1 — Cấu hình và logger** (`server/src/config.ts`, `server/src/logger.ts`, `.env.example`).

### [Tinh chỉnh v1.1] Lược bỏ màn hình nhập liệu, tập trung Import Excel / Xuất XML / Đẩy cổng & Đối soát trên MSSQL — 2026-11-23
- Đã cập nhật đồng bộ: `project_context.md`, `CHANGELOG.md`, `docs/{ARCHITECTURE,DATA-SPEC,IMPLEMENTATION-PLAN,TEST-PLAN,OPEN-QUESTIONS,PROJECT-RULES}.md`.
- Đã đóng thêm các câu hỏi mở: Q3 (không cần dropdown trên form v1), Q4 (xuất ZIP nhiều XML), Q7 (dùng MSSQL với tiền tố bảng `gksk_`), Q12 (không tự sinh `SO`, lấy từ Excel).
- Đã xóa 2 file bản sao dư thừa `docs/project_context.md` và `docs/CHANGELOG.md`.
- Sẵn sàng bắt đầu từ **S0 — Khởi tạo monorepo**.

### [Khởi tạo] Bộ tài liệu — 2026-11-23
- Đã tạo: `project_context.md`, `docs/{IMPLEMENTATION-PLAN,PROJECT-RULES,ARCHITECTURE,DATA-SPEC,API-CONTRACT,TEST-PLAN,OPEN-QUESTIONS}.md`.
- Đã chép tài liệu gốc vào `docs/reference/` (đặc tả API v1.0.1, Postman collection + environment, hướng dẫn Postman, `tao_goi_tin_gksk.js`).
- Golden vector chữ ký gói tin đã tính bằng chính thuật toán của `tao_goi_tin_gksk.js` (Node 22) — xem `API-CONTRACT §5`.
- Chưa có mã nguồn. Bắt đầu từ **S0**.
