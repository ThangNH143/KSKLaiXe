# STEP-PROMPTS.md — Bộ Prompt Copy-Paste & Khuyến nghị Model cho từng bước (S0 – S19)

> Tài liệu này chứa trọn bộ **20 prompt chuẩn** (từ `S0` đến `S19`) để bạn copy-paste vào từng phiên chat mới.
> Mỗi bước đã được gán sẵn **Model Gemini 4 khuyên dùng** (chỉ dùng dòng **Argon** và **Neon**, không dùng Carbon) tối ưu giữa độ chính xác nghiệp vụ và tốc độ/chi phí.

---

## Bảng tổng hợp Model Gemini 4 khuyên dùng theo bước

| Bước | Tên bước | Model khuyên dùng | Lý do chọn Model |
|---|---|---|---|
| **S0** | Khởi tạo monorepo | **Gemini 4 Neon (Medium)** | Dựng khung workspace, cấu hình TS/ESLint/Vitest và trang khung cơ bản theo cấu trúc có sẵn |
| **S1** | Cấu hình và logger | **Gemini 4 Neon (Medium)** | Đọc `.env` bằng `zod` (MSSQL + CSYT) và cấu hình `pino` redact theo danh sách trường đã chốt |
| **S2** | `shared`: đặc tả trường và kiểu | **Gemini 4 Neon (Medium)** | Khai báo bảng 25 trường BHXH và bảng mã thông điệp tiếng Việt theo đặc tả `DATA-SPEC.md §1–2` |
| **S3** | `shared`: chuẩn hóa & kiểm tra dữ liệu | **Gemini 4 Argon (Medium)** | Xử lý > 60 ca biên (ngày nhuận, serial Excel UTC, số 0 đầu CCCD, độ dài BHXH, 2 múi giờ `TZ`) |
| **S4** | Server: dựng XML | **Gemini 4 Neon (High)** | Hàm thuần dựng XML 25 thẻ đúng thứ tự BHXH, escape chặt, đối chiếu với `gksk_mau_ky_so_root.xml` |
| **S5** | Server: `msg_id`, envelope, chữ ký | **Gemini 4 Argon (Medium)** | Thuật toán ký gói tin SHA-256 viết hoa, RSA, `msg_id` giờ VN (UTC+7), bắt buộc khớp từng ký tự Golden Vector |
| **S6** | Mock API server | **Gemini 4 Argon (High)** | Dựng "Hệ thống Sở giả" độc lập, tái hiện đầy đủ kịch bản Postman `1.1 → 4.6`, idempotent `msg_id`, chế độ giả lập lỗi |
| **S7** | GKSK client (login, push, status, retry) | **Gemini 4 Argon (High)** | Logic bất đồng bộ phức tạp: cache token, status-trước-khi-retry, giữ nguyên `msg_id`, xử lý 429 `Retry-After` & 403 relogin |
| **S8** | DB (MSSQL `gksk_*` & Repository Interface) | **Gemini 4 Argon (Medium)** | Thiết kế `DbRepositories` interface, `InMemoryRepositories` cho test và `MssqlRepositories` tham số hóa an toàn |
| **S9** | Dịch vụ gửi (máy trạng thái) & gửi hàng loạt | **Gemini 4 Argon (High)** | Máy trạng thái gửi giấy, hàng đợi batch ≤ 2 song song / nghỉ 250ms (< 300 gói/phút), khôi phục khi khởi động |
| **S10** | API Đối soát, Chi tiết, Xuất XML/ZIP & Excel | **Gemini 4 Argon (Medium)** | Truy vấn 4 tab đối soát, ẩn trường nhạy cảm, đóng gói `.zip` nhiều XML và xuất Excel đối soát 29 cột |
| **S11** | Excel: mẫu và import ghi đè thông minh | **Gemini 4 Argon (High)** | Đọc Excel đa định dạng, nhận diện 5 chế độ xung đột `SO`, lưu 100% quân số có `SO`, round-trip với file đối soát 29 cột |
| **S12** | Xác thực ứng dụng (server) | **Gemini 4 Neon (High)** | Cookie session `HttpOnly`, middleware `requireAuth`, CSRF header `X-Requested-With`, rate-limit đăng nhập |
| **S13** | Client: khung, đăng nhập, API layer | **Gemini 4 Neon (High)** | Dựng khung React Router 2 trang (`Danh sách & Đối soát`, `Import Excel`), `LoginPage`, `EnvBanner` và chụp ảnh UI |
| **S14** | Client: trang Import Excel (ghi đè thông minh) | **Gemini 4 Argon (Medium)** | Bảng xem trước Import nhiều trạng thái đối chiếu DB, bộ lọc nhanh, mặc định chọn thông minh và chụp 4 ảnh UI |
| **S15** | Client: trang Danh sách & Đối soát + Xuất file | **Gemini 4 Argon (Medium)** | 4 tab đối soát, thẻ đếm trực tiếp, lọc theo đợt Excel/ngày/từ khóa, tải XML lẻ/ZIP, xuất Excel đối soát, chụp 4 ảnh UI |
| **S16** | Client: Đẩy cổng hàng loạt & Drawer Chi tiết | **Gemini 4 Argon (High)** | Polling tiến độ batch, hộp xác nhận production, Drawer 3 tab (25 trường chỉ đọc + XML preview + lịch sử gửi), chụp 5 ảnh UI |
| **S17** | Hardening và E2E trên mock | **Gemini 4 Argon (High)** | Viết Playwright E2E 3 luồng toàn trình, kiểm hiệu năng 1000 dòng, quét rò rỉ PII trong log, hoàn tất `SECURITY-CHECKLIST.md` |
| **S18** | Kiểm thử trên máy chủ kiểm thử thật & MSSQL | **Gemini 4 Argon (Medium)** | Phối hợp chạy 14 bước nghiệm thu trên MSSQL thật & cổng kiểm thử Sở, tổng hợp biên bản `S18-report.md` |
| **S19** | Đóng gói và hướng dẫn vận hành | **Gemini 4 Neon (Medium)** | Cấu hình Express phục vụ `client/dist` một cổng, viết `DEPLOY.md` (MSSQL + PM2/NSSM) và `USER-GUIDE.md` kèm ảnh |

---

## Chi tiết Prompt từng bước (Copy & Paste)

### Bước S0 — Khởi tạo monorepo
- **Model chọn trên UI**: `Gemini 4 Neon (Medium)`

```text
Hãy kích hoạt skill `gksk-step-runner` và đọc `AGENTS.md`, `project_context.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S0) và `docs/ARCHITECTURE.md` (§2).

Thực hiện DUY NHẤT bước **S0 — Khởi tạo monorepo**:
1. Khởi tạo git (nếu chưa có), tạo `package.json` gốc với npm workspaces (`["packages/*","server","client","tools/*"]`, `engines.node >= 20`) và các script gốc: `dev`, `lint`, `typecheck`, `test`, `build`.
2. Tạo `tsconfig.base.json` (strict) và `tsconfig.json` cho từng workspace (`packages/shared`, `server`, `client`); cấu hình ESLint, Prettier, `.editorconfig`, `.gitignore` (chặn `node_modules`, `dist`, `.env`, `coverage`).
3. Cài đặt Vitest ở các workspace; tạo `packages/shared` có hàm `ping()` + unit test; `server` (Express) có `GET /api/health` trả `{"ok":true}` + test Supertest; `client` (React 18 + Vite) hiển thị tiêu đề "GKSKLaiXe — Hệ thống Import Excel, Xuất XML & Đối soát GKSK Lái xe".
4. Viết và chạy script kiểm chứng `scripts/verify-S0.mjs` (chạy `lint`, `typecheck`, `test`, `build` và gọi thử `GET /api/health`), lưu kết quả vào `docs/evidence/S0/verify-output.txt`.
5. Khởi chạy `npm run dev`, dùng Browser Subagent mở trình duyệt truy cập client và chụp ảnh màn hình lưu tại `docs/evidence/S0/client-home.png`.
6. Cập nhật `CHANGELOG.md` và báo cáo kết quả theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc** (kèm ảnh `client-home.png` và kết quả `verify-output.txt`). Không làm sang bước S1.
```

---

### Bước S1 — Cấu hình và logger
- **Model chọn trên UI**: `Gemini 4 Neon (Medium)`

```text
Hãy kích hoạt skill `gksk-step-runner` và đọc `AGENTS.md`, `project_context.md` (§7), `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S1) và `docs/ARCHITECTURE.md` (§7).

Thực hiện DUY NHẤT bước **S1 — Cấu hình và logger**:
1. Tạo `.env.example` đầy đủ các biến theo `project_context.md §7` (gồm cấu hình MSSQL `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_ENCRYPT`, `DB_TRUST_SERVER_CERT`, cấu hình CSYT `GKSK_*`, và đăng nhập nội bộ `APP_LOGIN_*`, `SESSION_SECRET`).
2. Viết `server/src/config.ts` đọc và kiểm tra cấu hình bằng `zod` theo cơ chế fail-fast (báo rõ tên biến thiếu/sai, không in giá trị bí mật; chuẩn hóa `GKSK_BASE_URL` bỏ dấu `/` cuối; bắt buộc `https://` khi `APP_ENV=production`; `GKSK_SENDER_ID` mặc định bằng `GKSK_FACILITY_ID`).
3. Viết `server/src/logger.ts` bằng `pino` với cấu hình `redact` che toàn bộ `authorization`, `password`, `dbPassword`, `token`, `fields`, `data` ở mọi cấp.
4. Viết đầy đủ unit test cho `config.ts` và `logger.ts`, chạy cổng `npm run lint && npm run typecheck && npm test` xanh 100%.
5. Viết và chạy script kiểm chứng `scripts/verify-S1.ts` (thử cấu hình thiếu biến để chứng minh fail-fast và thử ghi log chứa mật khẩu/PII để chứng minh đầu ra bị che thành `[Redacted]`), lưu vào `docs/evidence/S1/verify-output.txt`.
6. Cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc**. Không làm sang bước S2.
```

---

### Bước S2 — `shared`: đặc tả trường và kiểu
- **Model chọn trên UI**: `Gemini 4 Neon (Medium)`

```text
Hãy kích hoạt skill `gksk-step-runner` và `gksk-protocol-guard`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S2), `docs/DATA-SPEC.md` (§1, §2) và `docs/API-CONTRACT.md` (§9, §10).

Thực hiện DUY NHẤT bước **S2 — `shared`: đặc tả trường và kiểu**:
1. Tạo `packages/shared/src/fields.ts` mô tả chính xác 25 trường theo đúng thứ tự bảng BHXH ở `DATA-SPEC.md §1` (bắt đầu `SO`, `NGAYKHAM`, `HOTEN`, `GIOITINHVAL`... kết thúc `STATE`), gồm đầy đủ thuộc tính: `tag`, `label`, `type`, `maxLength`, `bhxhRequired`, `soRequired`, `enumValues`, `sensitive`, `inTemplate`, `readOnly`.
2. Tạo `packages/shared/src/types.ts` (`GkskRecord`, `Issue`, `ConflictMode`, v.v.) và `packages/shared/src/messages.ts` ánh xạ toàn bộ mã lỗi/cảnh báo ở `API-CONTRACT.md §9–10` và `LOCAL_*` ở `DATA-SPEC.md §2` (gồm cả `LOCAL_SO_EXISTS`, `LOCAL_SO_ACCEPTED_UNCHANGED`, `LOCAL_SO_ACCEPTED_MODIFIED`) sang thông điệp tiếng Việt có dấu.
3. Viết unit test kiểm tra chặt chẽ thứ tự 25 trường, `maxLength`, 3 trường `bhxhRequired=false`, 7 trường Sở bắt buộc, 4 trường nhạy cảm (`SENSITIVE_TAGS`), và đảm bảo 100% mã lỗi/cảnh báo có thông điệp tiếng Việt.
4. Viết và chạy script `scripts/verify-S2.ts` để xuất bảng Markdown đối chiếu toàn bộ 25 trường và bảng mã thông điệp tiếng Việt ra file `docs/evidence/S2/fields-and-messages-report.md`.
5. Chạy cổng `npm run lint && npm run typecheck && npm test` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc**. Không làm sang bước S3.
```

---

### Bước S3 — `shared`: chuẩn hóa và kiểm tra dữ liệu
- **Model chọn trên UI**: `Gemini 4 Argon (Medium)`

```text
Hãy kích hoạt skill `gksk-step-runner` và `gksk-protocol-guard`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S3), `docs/DATA-SPEC.md` (§1–§3) và `docs/TEST-PLAN.md` (§3.1).

Thực hiện DUY NHẤT bước **S3 — `shared`: chuẩn hóa và kiểm tra dữ liệu**:
1. Viết `packages/shared/src/normalize.ts` cài đặt hàm thuần `normalizeRecord(raw)` theo `DATA-SPEC.md §3` (trim, chuẩn hóa Unicode NFC, xóa ký tự điều khiển XML 1.0, chuyển đổi ngày `d/M/yyyy` / `yyyy-MM-dd` / `Date` / số serial Excel tính theo UTC từ gốc `1899-12-30` sang `dd/MM/yyyy`, giữ nguyên chuỗi ngày sai để validator bắt lỗi, giữ số 0 đầu của `SOCMND_PASSPORT`, chuẩn hóa enum `GIOITINHVAL` và `KETLUAN`, mặc định `STATE=ADD`).
2. Viết `packages/shared/src/validate.ts` cài đặt hàm thuần `validateRecord(record, ctx: { facilityId, today })` trả về `Issue[]` (gồm đủ các mã server-mirror R/W ở `DATA-SPEC.md §1` và `LOCAL_*` ở `§2`; gộp `LOCAL_BHXH_REQUIRED_EMPTY` thành đúng 1 dòng) cùng hàm `hasBlockingErrors(issues)`.
3. Viết bộ test data-driven ≥ 60 ca bao phủ toàn bộ ma trận ở `TEST-PLAN.md §3.1`, đạt độ phủ dòng `packages/shared` ≥ 95%, và kiểm chứng chạy test ở cả 2 múi giờ `TZ=Asia/Ho_Chi_Minh` và `TZ=America/Los_Angeles` đều xanh.
4. Viết và chạy script `scripts/verify-S3.ts` xuất báo cáo kết quả chuẩn hóa + kiểm tra các ca điển hình và thông số coverage ra `docs/evidence/S3/validation-report.md`.
5. Cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc**. Không làm sang bước S4.
```

---

### Bước S4 — Server: dựng XML
- **Model chọn trên UI**: `Gemini 4 Neon (High)`

```text
Hãy kích hoạt skill `gksk-step-runner` và `gksk-protocol-guard`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S4), `docs/DATA-SPEC.md` (§4, §6) và `docs/reference/gksk_mau_ky_so_root.xml`.

Thực hiện DUY NHẤT bước **S4 — Server: dựng XML**:
1. Viết `server/src/gksk/xml.ts` gồm hàm thuần `buildGkskXml(record): string` và `toBase64Utf8(xml): string` theo đúng `DATA-SPEC.md §4`: khai báo `<?xml version="1.0" encoding="UTF-8"?>`, gốc `<root>`, xuất đủ 25 thẻ theo đúng thứ tự BHXH ở `DATA-SPEC.md §1`, thẻ rỗng ghi `<TAG></TAG>`, escape `& < > " '`, xóa ký tự điều khiển cấm của XML 1.0, tuyệt đối không có BOM (`0xFEFF`), không `DOCTYPE`, không comment, không `Signature`.
2. Viết unit test kiểm tra: snapshot XML bản ghi mẫu, round-trip bằng `fast-xml-parser` (kể cả ký tự `& < > " '`, tiếng Việt có dấu, xuống dòng), tính xác định (2 lần gọi ra chuỗi y hệt), và giải mã Base64 khớp byte UTF-8.
3. Viết và chạy script `scripts/verify-S4.ts` sinh ra 2 file XML thật `docs/evidence/S4/sample-gksk.xml` và `docs/evidence/S4/special-chars-gksk.xml`, đồng thời đối chiếu danh sách 25 thẻ với `docs/reference/gksk_mau_ky_so_root.xml` ghi vào `docs/evidence/S4/verify-output.txt`.
4. Chạy cổng `npm run lint && npm run typecheck && npm test` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc** (nhúng nội dung `sample-gksk.xml` và dẫn link file). Không làm sang bước S5.
```

---

### Bước S5 — Server: `msg_id`, envelope, chữ ký
- **Model chọn trên UI**: `Gemini 4 Argon (Medium)`

```text
Hãy kích hoạt skill `gksk-step-runner` và `gksk-protocol-guard`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S5) và `docs/API-CONTRACT.md` (§3, §4, §5).

Thực hiện DUY NHẤT bước **S5 — Server: `msg_id`, envelope, chữ ký**:
1. Viết `server/src/gksk/envelope.ts`:
   - `newMsgId(senderId, nowMs)`: tính `YYMMDD` theo giờ Việt Nam (`UTC+7` cố định, không phụ thuộc múi giờ máy) + UUID v4 viết liền không gạch.
   - `buildEnvelope({ senderId, xml, msgId, sendDatetime, privateKeyPem? })`: dựng `header` giữ chính xác thứ tự 8 khóa (`version, sender_id, receiver_id, txn_type, msg_id, msg_type, data_type, send_datetime`), `data` (Base64 UTF-8 của XML) và `signature`.
2. Viết `server/src/gksk/signature.ts`: tính `H = SHA256_UPPER(JSON.stringify(header))`, `D = SHA256_UPPER(data.trim())`, `signed = H + "." + D`; nếu có `privateKeyPem` thì ký RSA-PKCS1v1.5-SHA256 ra Base64, nếu không có khóa thì trả `"CHUA-KY-" + signed.slice(0, 16)`.
3. Viết unit test kiểm tra khớp từng ký tự với **Golden Vector** ở `API-CONTRACT.md §5`, test `newMsgId` ở mốc giao thừa giờ VN (`16:59:59Z` vs `17:30:00Z`) trên nhiều `TZ`, test 10.000 `msg_id` không trùng, và test ký/verify RSA 2048-bit.
4. Viết và chạy script `scripts/verify-S5.ts` xuất gói tin mẫu `docs/evidence/S5/sample-envelope.json` và bảng đối chiếu từng dòng Golden Vector (`Expected` vs `Actual`) ra `docs/evidence/S5/verify-output.txt`.
5. Chạy cổng `npm run lint && npm run typecheck && npm test` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc**. Không làm sang bước S6.
```

---

### Bước S6 — Mock API server
- **Model chọn trên UI**: `Gemini 4 Argon (High)`

```text
Hãy kích hoạt skill `gksk-step-runner` và `gksk-protocol-guard`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S6), `docs/API-CONTRACT.md` (§1–§12) và `docs/TEST-PLAN.md` (§4).

Thực hiện DUY NHẤT bước **S6 — Mock API server**:
1. Xây dựng `tools/mock-gksk-api` (Express) độc lập (chỉ import danh sách thẻ từ `@gksk/shared`, không dùng chung code với `server/`), cài đặt:
   - `POST /api/auth/login`
   - `POST /api/platform/gksk-lai-xe/push` (kiểm tra `service-type: 100`, Bearer token, envelope, chữ ký, giải mã Base64, kiểm tra XML/DOCTYPE/>1MB/thiếu `SO`, áp dụng đầy đủ mã từ chối `API-CONTRACT.md §9` và mã cảnh báo `§10`, xử lý idempotent theo `msg_id` trả cùng `submission_id`, ghi đè theo `(facility, SO)` giữ nguyên `certificate_id`, trả 409 nếu `msg_id` của CSYT khác).
   - `GET /api/platform/gksk-lai-xe/status?msg_id=...` (trả `{ code, message, data }` không có `header`, hoặc 404).
   - Endpoint quản trị lỗi `POST /__mock/fail { mode: 'timeout'|'500'|'429'|'403-once', count: n }` để phục vụ test retry.
2. Cấu hình script `npm run dev:mock` ở `package.json` gốc.
3. Viết bộ test tự động tái hiện toàn bộ các kịch bản Postman `1.1 → 4.6` theo `API-CONTRACT.md §12`.
4. Viết và chạy script `scripts/verify-S6.ts` bật Mock Server thật, bắn tuần tự các request kịch bản `1.1 → 4.6` + kịch bản ép lỗi `429 Retry-After`, xuất biên bản chi tiết Request/Response ra `docs/evidence/S6/postman-scenarios-report.md`.
5. Chạy cổng `npm run lint && npm run typecheck && npm test` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc**. Không làm sang bước S7.
```

---

### Bước S7 — GKSK client (login, push, status, retry)
- **Model chọn trên UI**: `Gemini 4 Argon (High)`

```text
Hãy kích hoạt skill `gksk-step-runner` và `gksk-protocol-guard`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S7), `docs/API-CONTRACT.md` (§2, §6, §7, §8) và `docs/TEST-PLAN.md` (§3.3).

Thực hiện DUY NHẤT bước **S7 — GKSK client (login, push, status, retry)**:
1. Viết `server/src/gksk/client.ts`, `errors.ts` và `retry.ts`:
   - `login()` cache token tới `now + duration - 5 phút`.
   - `push(envelope)` và `status(msgId)` có timeout bằng `AbortController`, parse khoan dung 3 dạng phản hồi khác nhau (`login`, `push`, `status`), kiểm tra `header.ref_msg_id === msg_id`.
   - Phân loại kết quả thành `{ kind: 'accepted' | 'rejected' | 'transient' | 'config', ... }`.
   - Chính sách retry đúng `API-CONTRACT.md §8`: tối đa 3 lần thử lại (5s → 15s → 45s; gặp 429 chờ theo `Retry-After`), **trước mỗi lần gửi lại sau timeout/5xx bắt buộc gọi `status(msgId)` trước** (nếu status 200 thì lấy kết quả luôn, không push lại; nếu 404 mới push lại với **cùng `msg_id`, `send_datetime`, `data`, `signature`**). Gặp 403 thì login lại đúng 1 lần.
2. Viết đầy đủ bộ test tích hợp với Mock Server cho toàn bộ 13 kịch bản ở `TEST-PLAN.md §3.3` (dùng đồng hồ/`sleep` giả để test chạy nhanh) + spy logger khẳng định không bao giờ log token/`Authorization`.
3. Viết và chạy script `scripts/verify-S7.ts` chạy thực tế qua 6 tình huống retry/timeout/status-recovery/429/403 trên Mock Server và xuất nhật ký dòng thời gian (`timeline`) ra `docs/evidence/S7/retry-timeline-report.md`.
4. Chạy cổng `npm run lint && npm run typecheck && npm test` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc**. Không làm sang bước S8.
```

---

### Bước S8 — DB (MSSQL `gksk_*` & Repository Interface)
- **Model chọn trên UI**: `Gemini 4 Argon (Medium)`

```text
Hãy kích hoạt skill `gksk-step-runner`, đọc `AGENTS.md` (§3), `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S8) và `docs/ARCHITECTURE.md` (§5).

Thực hiện DUY NHẤT bước **S8 — DB (MSSQL `gksk_*` & Repository Interface)**:
1. Định nghĩa `DbRepositories` interface tại `server/src/db/types.ts` cho 3 kho `batches`, `certificates`, `submissions` (hỗ trợ upsert theo `so` cho cả bản ghi `ready` và `invalid`, tra cứu hàng loạt `findBySoList(soList)`, truy vấn phân trang theo 4 tab đối soát `all | unsent | accepted | attention`, lọc `batchId`, khoảng ngày, từ khóa `q`, đếm thống kê `counts`, và `recoverOnStartup` chuyển `sending` → `error`).
2. Cài đặt `InMemoryRepositories` tại `server/src/db/inMemoryRepo.ts` làm mặc định cho `npm test` để kiểm thử nhanh và tuyệt đối không chạm vào MSSQL đang vận hành.
3. Tạo file migration `server/src/db/migrations/001_init.sql` và cài đặt `MssqlRepositories` (`server/src/db/mssqlRepo.ts` + `connection.ts`) dùng gói `mssql`:
   - 100% tên bảng có tiền tố `gksk_` (`gksk_schema_migrations`, `gksk_import_batches`, `gksk_certificates`, `gksk_submissions`).
   - Tự động kiểm tra và tạo bảng `gksk_*` nếu chưa tồn tại (`IF OBJECT_ID(...) IS NULL`). Tuyệt đối không có lệnh `DROP` hay `TRUNCATE`.
   - 100% câu truy vấn SQL dùng tham số qua `request.input('param', sql.Type, value)`, cấm ghép chuỗi SQL.
4. Viết bộ contract test cho repository (kể cả ký tự đặc biệt `%`, `_`, `'` trong tìm kiếm `q`) và test kiểm tra tĩnh file SQL / `mssqlRepo.ts`.
5. Viết và chạy script `scripts/verify-S8.ts` xuất biên bản kiểm chứng toàn bộ thao tác Repository và kết quả quét an toàn SQL `gksk_*` ra `docs/evidence/S8/db-verification-report.md`.
6. Chạy cổng `npm run lint && npm run typecheck && npm test` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc**. Không làm sang bước S9.
```

---

### Bước S9 — Dịch vụ gửi (máy trạng thái) và gửi hàng loạt
- **Model chọn trên UI**: `Gemini 4 Argon (High)`

```text
Hãy kích hoạt skill `gksk-step-runner` và `gksk-protocol-guard`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S9) và `docs/ARCHITECTURE.md` (§4, §6).

Thực hiện DUY NHẤT bước **S9 — Dịch vụ gửi (máy trạng thái) và gửi hàng loạt**:
1. Viết `server/src/services/sendService.ts` cài đặt máy trạng thái gửi 1 giấy `sendCertificate(id)` và tra lại trạng thái `refreshSubmission(submissionId)` theo đúng `ARCHITECTURE.md §6`:
   - Kiểm tra lại bằng `validateRecord`; nếu có lỗi chặn thì cập nhật trạng thái `invalid` và không gọi API.
   - Dựng XML → Base64 → tính `data_sha256`; tái sử dụng submission chưa có kết quả có cùng `data_sha256` (giữ nguyên `msg_id`, `send_datetime`) hoặc tạo mới khi dữ liệu đã thay đổi.
   - Lưu đầy đủ `attempts`, `http_status`, `res_code`, `result_status`, `server_submission_id`, `server_certificate_id`, `errors_json`, `warnings_json`, `last_error` (không chứa PII).
2. Viết `server/src/services/jobService.ts` quản lý hàng đợi gửi hàng loạt trong bộ nhớ (tối đa 2 request song song, nghỉ 250ms giữa các lần gửi để luôn dưới 300 gói/phút, tạm dừng hàng đợi khi gặp 429).
3. Tạo routes `server/src/routes/send.ts`: `POST /api/certificates/:id/send`, `POST /api/send`, `GET /api/jobs/:jobId`, `POST /api/submissions/:id/refresh`.
4. Viết bộ test tích hợp với Mock Server (gửi đơn, chặn giấy `invalid`, retry giữ `msg_id`, cập nhật dữ liệu sinh `msg_id` mới ghi đè cùng `certificate_id`, gửi batch 25 giấy và test giới hạn tốc độ batch 400 giấy với đồng hồ giả, spy logger cấm log PII).
5. Viết và chạy script `scripts/verify-S9.ts` chạy thật batch 25 giấy (gồm giấy hợp lệ, giấy bị từ chối và giấy lỗi mạng tạm thời) qua Mock Server, ghi nhật ký tiến độ và lịch sử submissions ra `docs/evidence/S9/batch-send-report.md`.
6. Chạy cổng `npm run lint && npm run typecheck && npm test` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc**. Không làm sang bước S10.
```

---

### Bước S10 — API Danh sách đối soát, Chi tiết chỉ đọc, Xuất XML (`.xml` & `.zip`) và Xuất Excel đối soát
- **Model chọn trên UI**: `Gemini 4 Argon (Medium)`

```text
Hãy kích hoạt skill `gksk-step-runner` và `gksk-protocol-guard`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S10), `docs/ARCHITECTURE.md` (§4, §8) và `docs/DATA-SPEC.md` (§5.4).

Thực hiện DUY NHẤT bước **S10 — API Danh sách đối soát, Chi tiết chỉ đọc, Xuất XML (`.xml` & `.zip`) và Xuất Excel đối soát**:
1. Viết `server/src/services/exportService.ts`:
   - `sanitizeXmlFileName(so)`: thay ký tự `/ \ : * ? " < > |` và `..` thành `_` an toàn.
   - `buildXmlZip(records)`: đóng gói nhiều file `<SO>.xml` của các giấy hợp lệ vào file `.zip`.
   - `buildReconcileExcel(items)`: dùng `exceljs` xuất file `.xlsx` đối soát gồm **23 cột dữ liệu gốc** (đúng thứ tự BHXH và định dạng Text `@` như file mẫu) cộng thêm **6 cột đối soát ở cuối** (`TRANG_THAI_DOI_SOAT`, `DOT_IMPORT`, `THOI_GIAN_DAY`, `MSG_ID`, `CERTIFICATE_ID_SO`, `CHI_TIET_LOI_CANH_BAO`) theo đúng `DATA-SPEC.md §5.4`.
2. Viết `server/src/services/certificateService.ts`, `server/src/routes/certificates.ts` và `server/src/middleware/errorHandler.ts` cho các endpoint:
   - `GET /api/batches`
   - `GET /api/certificates` (hỗ trợ `tab=all|unsent|accepted|attention`, `status`, `batchId`, `fromDate`, `toDate`, `q`, `page`, `pageSize`; trả kèm `counts`; **tuyệt đối không trả 4 trường nhạy cảm ở danh sách**)
   - `GET /api/certificates/export-excel`
   - `POST /api/certificates/xml-zip`
   - `GET /api/certificates/:id` (chi tiết chỉ đọc đủ 25 trường + `issues` + `xml` nếu hợp lệ)
   - `DELETE /api/certificates/:id`
   - `GET /api/certificates/:id/xml`
   - `GET /api/certificates/:id/submissions`
   *(Lưu ý: Không tạo các endpoint tạo/sửa tay `POST /api/certificates` hay `PUT /api/certificates/:id`)*.
3. Viết đầy đủ test Supertest cho mọi endpoint trên.
4. Viết và chạy script `scripts/verify-S10.ts` để sinh và lưu **3 file thật** vào `docs/evidence/S10/`:
   - `docs/evidence/S10/TEST_75001_0001.xml`
   - `docs/evidence/S10/GKSK_XML_batch.zip`
   - `docs/evidence/S10/GKSK_doi_soat_sample.xlsx`
   kèm log kiểm tra vào `docs/evidence/S10/verify-output.txt`.
5. Chạy cổng `npm run lint && npm run typecheck && npm test` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc** (dẫn link trực tiếp tới 3 file `.xml`, `.zip`, `.xlsx` vừa sinh). Không làm sang bước S11.
```

---

### Bước S11 — Excel: mẫu và import ghi đè thông minh
- **Model chọn trên UI**: `Gemini 4 Argon (High)`

```text
Hãy kích hoạt skill `gksk-step-runner` và `gksk-protocol-guard`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S11), `docs/DATA-SPEC.md` (§5.1–§5.4) và `docs/TEST-PLAN.md` (§2.1).

Thực hiện DUY NHẤT bước **S11 — Excel: mẫu và import ghi đè thông minh**:
1. Viết `tests/fixtures/make-fixtures.ts` sinh bộ file Excel kiểm thử theo `TEST-PLAN.md §2.1`.
2. Viết `server/src/services/importService.ts` và `server/src/routes/import.ts` (`GET /api/import/template`, `POST /api/import/excel`, `POST /api/import/commit` dùng `multer` bộ nhớ ≤ 5 MB, kiểm tra magic bytes `PK`):
   - `buildTemplate()`: tạo `GKSK_mau_nhap_lieu.xlsx` có sheet `GKSK` (23 cột thứ tự BHXH, định dạng Text `@` 2000 dòng đầu, freeze dòng 1, dropdown validation) và sheet `HuongDan` sinh từ `FIELDS`.
   - `previewImport(buffer)`: đọc Excel (hỗ trợ bí danh `GIOITINH` → `GIOITINHVAL`, công thức, rich-text, serial date, giữ số 0 đầu; từ chối nếu thiếu cột bắt buộc hoặc > 1000 dòng), đối chiếu từng dòng với DB theo mã `SO` để phân loại đúng 5 chế độ `conflictMode` (`new`, `overwrite_pending`, `accepted_unchanged`, `accepted_modified`, `missing_so`) và gán `defaultSelected` theo `DATA-SPEC.md §5.2`.
   - `commitImport(payload)`: lưu/ghi đè cả các dòng hợp lệ (`ready`) lẫn dòng có lỗi dữ liệu (`invalid`, có `SO` ≤ 30 ký tự) được chọn vào DB gắn với đợt import `gksk_import_batches` để khớp 100% quân số đối soát.
3. Viết đầy đủ test cho toàn bộ fixtures ở `TEST-PLAN.md §2.1` + test **round-trip với file Excel đối soát 29 cột của S10** (sửa dòng lỗi ngay trên file Excel đối soát 29 cột rồi đưa vào `previewImport` → 6 cột đối soát cuối tự động được bỏ qua và dòng lỗi sau khi sửa trở thành `ready`).
4. Viết và chạy script `scripts/verify-S11.ts` để sinh file mẫu thật `docs/evidence/S11/GKSK_mau_nhap_lieu.xlsx` và biên bản kiểm chứng luồng ghi đè thông minh + round-trip file đối soát ra `docs/evidence/S11/smart-import-report.md`.
5. Chạy cổng `npm run lint && npm run typecheck && npm test` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc**. Không làm sang bước S12.
```

---

### Bước S12 — Xác thực ứng dụng (server)
- **Model chọn trên UI**: `Gemini 4 Neon (High)`

```text
Hãy kích hoạt skill `gksk-step-runner`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S12) và `docs/ARCHITECTURE.md` (§4, §7).

Thực hiện DUY NHẤT bước **S12 — Xác thực ứng dụng (server)**:
1. Cài đặt `server/src/routes/auth.ts` (`POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`) và `GET /api/config` (chỉ trả `{ appEnv, facilityId, facilityName, baseUrlHost }`, tuyệt đối không chứa mật khẩu/token/DB).
2. Cài đặt `server/src/middleware/requireAuth.ts`, `rateLimit.ts` (giới hạn 10 lần đăng nhập sai / 15 phút / IP → trả 429), kiểm tra CSRF header `X-Requested-With: gksk` cho mọi method ghi (`POST`, `PUT`, `DELETE` → thiếu trả 403), cookie phiên `HttpOnly`, `SameSite=Lax`, `Secure` khi production, và `helmet`.
3. Viết test tự động quét toàn bộ router của Express app để khẳng định 100% endpoint nghiệp vụ đều trả `401` khi chưa đăng nhập, kiểm tra `403` khi thiếu `X-Requested-With`, kiểm tra `429` khi sai mật khẩu quá 10 lần, và cập nhật các test tích hợp S9–S11 dùng phiên đăng nhập hợp lệ.
4. Viết và chạy script `scripts/verify-S12.ts` xuất bảng quét bảo mật toàn bộ route ra `docs/evidence/S12/auth-security-report.md`.
5. Chạy cổng `npm run lint && npm run typecheck && npm test` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc**. Không làm sang bước S13.
```

---

### Bước S13 — Client: khung, đăng nhập, API layer
- **Model chọn trên UI**: `Gemini 4 Neon (High)`

```text
Hãy kích hoạt skill `gksk-step-runner` và `modern-web-guidance`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S13) và `docs/ARCHITECTURE.md` (§1, §2, §4).

Thực hiện DUY NHẤT bước **S13 — Client: khung, đăng nhập, API layer**:
1. Xây dựng tầng gọi API `client/src/api/{http,auth,certificates,import,send}.ts` (tự động gắn header `X-Requested-With: gksk`, chuẩn hóa lỗi, tự chuyển về trang đăng nhập khi gặp `401`).
2. Xây dựng `LoginPage.tsx`, `EnvBanner.tsx` (hiển thị banner đỏ nổi bật khi `appEnv === 'production'`, hiển thị mã & tên CSYT) và khung điều hướng chính trong `App.tsx` gồm đúng 2 trang: **Danh sách & Đối soát** (`/`) và **Import Excel** (`/import`) — tuyệt đối không có trang Nhập liệu.
3. Viết component test bằng Vitest + Testing Library cho luồng đăng nhập, xử lý 401 và hiển thị `EnvBanner`.
4. Khởi chạy ứng dụng thật (`npm run dev:mock`), dùng Browser Subagent mở trình duyệt thao tác và **chụp đủ 3 ảnh màn hình thực tế** theo yêu cầu:
   - `docs/evidence/S13/01-login-page.png`
   - `docs/evidence/S13/02-app-shell-test-env.png`
   - `docs/evidence/S13/03-app-shell-prod-banner.png`
   đồng thời xác nhận 0 lỗi console và không lộ token CSYT trong tab Network.
5. Chạy cổng `npm run lint && npm run typecheck && npm test` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc** (đính kèm cả 3 ảnh chụp màn hình). Không làm sang bước S14.
```

---

### Bước S14 — Client: trang Import Excel (ghi đè thông minh)
- **Model chọn trên UI**: `Gemini 4 Argon (Medium)`

```text
Hãy kích hoạt skill `gksk-step-runner` và `modern-web-guidance`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S14) và `docs/DATA-SPEC.md` (§5.1–§5.3).

Thực hiện DUY NHẤT bước **S14 — Client: trang Import Excel (ghi đè thông minh)**:
1. Xây dựng `client/src/pages/ImportPage.tsx` và `client/src/components/IssueList.tsx`:
   - Nút **Tải file Excel mẫu** (`GKSK_mau_nhap_lieu.xlsx`) và vùng chọn/kéo-thả file `.xlsx`.
   - Thẻ tóm tắt kết quả đọc file: Tổng số dòng, Hợp lệ (`ready`), Lỗi dữ liệu (`invalid`), Ghi đè bản chưa đẩy, Đã đẩy thành công (không đổi / có sửa), cùng cảnh báo cột lạ bị bỏ qua hoặc lỗi thiếu cột bắt buộc.
   - Bộ lọc nhanh trên bảng xem trước: `Tất cả`, `Được chọn lưu`, `Có lỗi dữ liệu`, `Ghi đè`, `Đã đẩy thành công`.
   - Bảng xem trước từng dòng hiển thị rõ: Số dòng Excel, `SO`, `HOTEN`, `NGAYSINH`, `KETLUAN`, huy hiệu dữ liệu (✅/⚠️/⛔), huy hiệu đối chiếu DB (`Mới` / `Ghi đè bản cũ` / `Đã đẩy - Không đổi` / `Đã đẩy - Có sửa`), danh sách lỗi/cảnh báo tiếng Việt.
   - Checkbox chọn dòng tuân thủ đúng mặc định thông minh (`new` và `overwrite_pending` mặc định chọn kể cả dòng `invalid` có `SO` để lưu đủ 100% quân số đối soát; `accepted_unchanged` và `accepted_modified` mặc định bỏ chọn; khi người dùng chủ động tick dòng `accepted_modified` thì hiển thị xác nhận ghi đè giấy đã đẩy; dòng thiếu/quá dài `SO` bị khóa checkbox).
   - Nút **Lưu vào Danh sách đối soát** → lưu xong tự chuyển sang trang Danh sách & Đối soát.
2. Viết đầy đủ component test bằng Vitest + Testing Library.
3. Khởi chạy `npm run dev:mock`, dùng Browser Subagent mở trình duyệt nạp các file Excel mẫu và **chụp đủ 4 ảnh màn hình thực tế**:
   - `docs/evidence/S14/01-import-upload.png`
   - `docs/evidence/S14/02-import-preview-mixed.png`
   - `docs/evidence/S14/03-import-preview-smart-overwrite.png`
   - `docs/evidence/S14/04-import-missing-col-error.png`
4. Chạy cổng `npm run lint && npm run typecheck && npm test` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc** (đính kèm cả 4 ảnh chụp màn hình). Không làm sang bước S15.
```

---

### Bước S15 — Client: trang Danh sách & Đối soát, Xuất XML (`.xml`/`.zip`) và Xuất Excel đối soát
- **Model chọn trên UI**: `Gemini 4 Argon (Medium)`

```text
Hãy kích hoạt skill `gksk-step-runner` và `modern-web-guidance`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S15) và `docs/ARCHITECTURE.md` (§4, §8).

Thực hiện DUY NHẤT bước **S15 — Client: trang Danh sách & Đối soát, Xuất XML (`.xml`/`.zip`) và Xuất Excel đối soát**:
1. Xây dựng `client/src/pages/ListPage.tsx`, `client/src/components/ReconcileSummary.tsx` và `client/src/components/StatusBadge.tsx`:
   - Thanh thẻ thống kê đối soát & 4 Tab lọc nhanh: **Tất cả**, **Chưa đẩy (Sẵn sàng)** (`ready`), **Đã đẩy thành công** (`accepted`), **Cần xử lý** (`invalid` = Lỗi dữ liệu Excel, `rejected` = Cổng Sở từ chối, `error` = Lỗi mạng/Cấu hình).
   - Bộ lọc đối soát theo **Đợt import (file Excel)**, khoảng ngày, ô tìm kiếm (`SO`, `HOTEN`, `SOCMND_PASSPORT`), phân trang. Đảm bảo bảng danh sách không hiển thị 4 trường nhạy cảm.
   - Thanh công cụ xuất dữ liệu: nút **Xuất Excel đối soát** (29 cột theo bộ lọc hiện tại), nút **Tải XML (.zip)** cho các giấy hợp lệ đã tick chọn, và nút **Tải `<SO>.xml`** lẻ trên từng dòng hợp lệ (khóa nút tải XML với dòng `invalid`).
2. Viết đầy đủ component test bằng Vitest + Testing Library.
3. Khởi chạy `npm run dev:mock`, dùng Browser Subagent mở trình duyệt thao tác và **chụp đủ 4 ảnh màn hình thực tế**:
   - `docs/evidence/S15/01-reconcile-tab-all.png`
   - `docs/evidence/S15/02-reconcile-tab-accepted.png`
   - `docs/evidence/S15/03-reconcile-tab-attention.png`
   - `docs/evidence/S15/04-batch-filter-and-search.png`
4. Chạy cổng `npm run lint && npm run typecheck && npm test` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc** (đính kèm cả 4 ảnh chụp màn hình). Không làm sang bước S16.
```

---

### Bước S16 — Client: Đẩy cổng hàng loạt & Ngăn trượt (Drawer) Chi tiết chỉ đọc
- **Model chọn trên UI**: `Gemini 4 Argon (High)`

```text
Hãy kích hoạt skill `gksk-step-runner` và `modern-web-guidance`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S16) và `docs/ARCHITECTURE.md` (§4, §6, §8).

Thực hiện DUY NHẤT bước **S16 — Client: Đẩy cổng hàng loạt & Ngăn trượt (Drawer) Chi tiết chỉ đọc**:
1. Tích hợp luồng **Đẩy cổng** trên `ListPage.tsx`:
   - Chọn nhiều giấy (`ready` / `error`) → nút **Đẩy cổng các giấy đã chọn** (hộp thoại xác nhận; khi `APP_ENV=production` hiển thị cảnh báo đỏ bắt xác nhận).
   - Thanh tiến độ theo `jobId` (polling 1s) hiển thị trực quan số giấy đã xử lý / thành công / bị từ chối / lỗi; tự động làm mới bảng và số đếm đối soát.
   - Nút thao tác nhanh trên dòng: **Đẩy cổng**, **Gửi lại** (khi lỗi mạng), **Tra trạng thái**.
2. Xây dựng `client/src/components/CertificateDetailDrawer.tsx` và `XmlPreview.tsx` (mở ngăn trượt bên phải ngay trên trang Danh sách, giữ nguyên bộ lọc và vị trí cuộn của bảng):
   - **Tab 1 — Thông tin giấy (25 trường chỉ đọc) & Lỗi/Cảnh báo**: hiển thị đủ 25 trường (tách nhóm riêng 4 trường nhạy cảm `NONGDOCON`, `MATUY`, `LYDO`, `TINHTRANGBENH`), danh sách lỗi/cảnh báo tiếng Việt và hướng dẫn sửa trên file Excel / file Excel đối soát rồi Import đè theo `SO`.
   - **Tab 2 — Xem trước XML (`XmlPreview`)**: mã nguồn XML, nút Sao chép XML, nút Tải `<SO>.xml`.
   - **Tab 3 — Lịch sử đẩy cổng**: bảng các lần gửi (`msg_id`, thời gian, HTTP status, kết quả, `server_submission_id`, `server_certificate_id`, lỗi/cảnh báo, nút **Tra lại trạng thái**).
3. Viết đầy đủ component test bằng Vitest + Testing Library.
4. Khởi chạy `npm run dev:mock`, dùng Browser Subagent thao tác thực tế toàn bộ luồng và **chụp đủ 5 ảnh màn hình thực tế**:
   - `docs/evidence/S16/01-batch-send-confirm-and-progress.png`
   - `docs/evidence/S16/02-drawer-tab-25-fields.png`
   - `docs/evidence/S16/03-drawer-tab-xml-preview.png`
   - `docs/evidence/S16/04-drawer-tab-submission-history.png`
   - `docs/evidence/S16/05-retry-same-msgid.png`
5. Chạy cổng `npm run lint && npm run typecheck && npm test` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc** (đính kèm cả 5 ảnh chụp màn hình). Không làm sang bước S17.
```

---

### Bước S17 — Hardening và E2E trên mock
- **Model chọn trên UI**: `Gemini 4 Argon (High)`

```text
Hãy kích hoạt skill `gksk-step-runner`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S17), `docs/TEST-PLAN.md` (§1, §6, §7) và `docs/ARCHITECTURE.md` (§7).

Thực hiện DUY NHẤT bước **S17 — Hardening và E2E trên mock**:
1. Cài đặt và viết bộ test Playwright E2E (`tests/e2e/*`, chạy qua `npm run test:e2e` với `dev:mock`) cho 3 luồng toàn trình:
   - Luồng 1: Đăng nhập → Tải mẫu Excel → Import file có cả dòng hợp lệ và dòng lỗi → Kiểm tra số đếm 4 tab đối soát.
   - Luồng 2: Xem Drawer chi tiết 25 trường & Xem trước XML → Tải XML lẻ & `.zip` → Đẩy cổng hàng loạt → Xuất file Excel đối soát 29 cột.
   - Luồng 3: Sửa dòng lỗi ngay trên file Excel đối soát 29 cột → Import đè lại (kiểm chứng tự bỏ chọn dòng `accepted` không đổi và tự tick dòng ghi đè) → Đẩy cổng dòng vừa sửa thành công + kịch bản lỗi mạng tạm thời → bấm Gửi lại giữ nguyên `msg_id`.
2. Kiểm tra hiệu năng: import `big_1000.xlsx` (1000 dòng) < 10 giây; gửi 1000 giấy tới mock không treo UI.
3. Rà soát toàn bộ mục bảo mật ở `TEST-PLAN.md §6`, quét log E2E đảm bảo 0 kết quả cho `TEST NGUYEN`, `TESTGKSK`, `Bearer`, `eyJ`, `DB_PASSWORD`, chạy `npm audit --omit=dev`, và tạo `docs/SECURITY-CHECKLIST.md` đã tick đủ kèm bằng chứng.
4. Viết và chạy script `scripts/verify-S17.ts` chạy E2E 3 lần liên tiếp để khẳng định không flaky, chụp ảnh kết quả các luồng E2E lưu vào `docs/evidence/S17/e2e-*.png` và xuất báo cáo tổng hợp vào `docs/evidence/S17/e2e-and-security-report.md`.
5. Chạy cổng `npm run lint && npm run typecheck && npm test && npm run test:e2e` xanh, cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc**. Không làm sang bước S18.
```

---

### Bước S18 — Kiểm thử trên máy chủ kiểm thử thật & MSSQL thật
- **Model chọn trên UI**: `Gemini 4 Argon (Medium)`

```text
Hãy kích hoạt skill `gksk-step-runner` và `gksk-protocol-guard`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S18), `docs/TEST-PLAN.md` (§5) và `docs/OPEN-QUESTIONS.md`.

Thực hiện bước **S18 — Kiểm thử trên máy chủ kiểm thử thật & MSSQL thật**:
1. Hướng dẫn và kiểm tra kết nối MSSQL thật trên server hiện tại (`npm run test:mssql` / khởi động server tạo 4 bảng `gksk_*` an toàn).
2. Chuẩn bị sẵn bộ file Excel dữ liệu giả kiểm thử (`SO` bắt đầu bằng `TEST.`, `HOTEN` bắt đầu bằng `TEST`, `SOCMND_PASSPORT` là `TESTGKSK01...`, kèm ca kiểm tra thẻ rỗng Q2 và ca kiểm tra độ dài 30 ký tự tiếng Việt có dấu Q13) để thực hiện tuần tự 14 bước nghiệm thu trong `TEST-PLAN.md §5` với môi trường kiểm thử của Sở Y tế.
3. Ghi nhận đầy đủ kết quả thực tế (`msg_id`, `submission_id`, `certificate_id`, mã phản hồi, ảnh chụp màn hình bảng `gksk_*` và giao diện đối soát) vào `docs/evidence/S18/S18-report.md`, chốt các câu hỏi còn lại trong `docs/OPEN-QUESTIONS.md` và cập nhật `DATA-SPEC.md` nếu server thật có điểm khác biệt.
4. Cập nhật `CHANGELOG.md` và báo cáo theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc**. Không làm sang bước S19 khi chưa chốt xong S18.
```

---

### Bước S19 — Đóng gói và hướng dẫn vận hành
- **Model chọn trên UI**: `Gemini 4 Neon (Medium)`

```text
Hãy kích hoạt skill `gksk-step-runner`, đọc `AGENTS.md`, `CHANGELOG.md`, `docs/IMPLEMENTATION-PLAN.md` (mục S19) và `docs/ARCHITECTURE.md`.

Thực hiện DUY NHẤT bước **S19 — Đóng gói và hướng dẫn vận hành**:
1. Cấu hình `server` khi chạy ở chế độ production phục vụ luôn thư mục tĩnh `client/dist` (một tiến trình Node/Express duy nhất, một cổng duy nhất cho cả giao diện React và `/api/*`).
2. Viết `docs/DEPLOY.md` chi tiết cho Windows Server: yêu cầu Node ≥ 20 LTS, cấu hình tài khoản & quyền MSSQL cho 4 bảng `gksk_*`, cấu hình `.env`, chạy dịch vụ nền bằng PM2 hoặc NSSM, cấu hình reverse proxy HTTPS, sao lưu DB, xoay vòng log, đổi mật khẩu/khóa RSA.
3. Viết `docs/USER-GUIDE.md` bằng tiếng Việt dễ hiểu cho nhân viên y tế, có nhúng ảnh chụp màn hình thực tế từ `docs/evidence/` cho toàn bộ quy trình: Đăng nhập → Tải mẫu Excel → Import Excel → Kiểm tra 4 tab Đối soát & Xem Drawer chi tiết → Xuất XML (`.xml` / `.zip`) → Đẩy cổng → Xuất Excel đối soát → Sửa lỗi trên file Excel đối soát & Import đè lại.
4. Viết và chạy script `scripts/verify-S19.mjs` chạy `npm run build`, khởi chạy tiến trình đơn `server/dist/index.js`, kiểm tra truy cập giao diện tĩnh + `/api/health` + `/api/config` trên cùng 1 cổng, lưu log vào `docs/evidence/S19/verify-output.txt` và chụp ảnh màn hình `docs/evidence/S19/production-single-port.png`.
5. Cập nhật `CHANGELOG.md` lên phiên bản `1.0.0`, đặt thẻ git `v1.0.0` và báo cáo nghiệm thu tổng kết theo đúng **Mẫu Báo cáo bàn giao 5 mục bắt buộc**.
```
