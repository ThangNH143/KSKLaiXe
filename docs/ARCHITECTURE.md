# ARCHITECTURE.md — Kiến trúc GKSKLaiXe

## 1. Sơ đồ tổng thể

```
 Trình duyệt (React/Vite)                 Server (Node/Express)                       Hệ thống Sở
 ┌──────────────────────┐   cookie phiên  ┌───────────────────────────────┐   HTTPS   ┌──────────────┐
 │ Import Excel         │ ──────────────► │ routes → services → repo(DB)  │ ────────► │ /api/auth    │
 │ Danh sách & Đối soát │ ◄────────────── │        └► gkskClient (token,    │ ◄──────── │ /api/platform│
 │ Xuất XML/ZIP & Đẩy   │   JSON / File   │           envelope, ký, retry) │           │  /gksk-lai-xe│
 └──────────────────────┘                 └───────────────────────────────┘           └──────────────┘
        (không giữ token/mật khẩu CSYT)     MSSQL (bảng tiền tố gksk_*)
```
Khi chạy `dev:mock`: `gkskClient` trỏ vào **mock API** (`tools/mock-gksk-api`) thay vì Hệ thống Sở.
Khi chạy `npm test`: lớp `repo(DB)` dùng `InMemoryRepository` (tách qua Repository Interface) để kiểm thử nhanh và tuyệt đối không tác động lên MSSQL đang vận hành.

## 2. Cấu trúc thư mục

```
GKSK_LaiXe/
├─ project_context.md
├─ CHANGELOG.md
├─ package.json                 # workspaces + script gốc
├─ tsconfig.base.json
├─ .env.example   .gitignore   .editorconfig   eslint.config.js   .prettierrc
├─ docs/                        # tài liệu (file này, DATA-SPEC, API-CONTRACT, ...)
│  └─ reference/                # tài liệu gốc — CHỈ ĐỌC
├─ packages/
│  └─ shared/                   # dùng chung server + client (thuần TS, không phụ thuộc Node/DOM)
│     └─ src/ fields.ts normalize.ts validate.ts messages.ts types.ts index.ts
├─ server/
│  └─ src/
│     ├─ index.ts  app.ts  config.ts  logger.ts
│     ├─ gksk/      xml.ts  envelope.ts  signature.ts  client.ts  errors.ts  retry.ts
│     ├─ db/        connection.ts  migrations/*.sql  types.ts  mssqlRepo.ts  inMemoryRepo.ts
│     ├─ services/  certificateService.ts  sendService.ts  importService.ts  exportService.ts  jobService.ts
│     ├─ routes/    auth.ts  users.ts  system.ts  certificates.ts  import.ts  send.ts  health.ts
│     └─ middleware/ requireAuth.ts  errorHandler.ts  rateLimit.ts
├─ client/
│  └─ src/
│     ├─ main.tsx  App.tsx  api/  (http.ts, auth.ts, users.ts, system.ts, certificates.ts, import.ts, send.ts)
│     ├─ pages/    LoginPage.tsx  ImportPage.tsx  ListPage.tsx
│     └─ components/  CertificateDetailDrawer.tsx  ReconcileSummary.tsx  IssueList.tsx  StatusBadge.tsx  XmlPreview.tsx  EnvBanner.tsx  SystemAdminModal.tsx
├─ tools/
│  └─ mock-gksk-api/            # Express mock theo API-CONTRACT (S6)
└─ tests/
   ├─ fixtures/                 # excel, xml, json mẫu (xem TEST-PLAN)
   └─ e2e/
```

Quy tắc phụ thuộc (kiểm bằng lint, `eslint-plugin-boundaries` hoặc `no-restricted-imports`):
- `shared` **không import** từ `server`/`client`.
- `client` chỉ import `shared` (không import `server`).
- `routes` chỉ gọi `services`; `services` gọi `repo` (qua interface `DbRepositories`) + `gksk/*`; `gksk/*` không biết DB.

## 3. Module & trách nhiệm

| Module | Trách nhiệm | Hàm/Public API chính |
|---|---|---|
| `shared/fields.ts` | Bảng 25 trường (tag, nhãn, kiểu, bắt buộc, enum, nhạy cảm) — nguồn duy nhất | `FIELDS`, `FIELD_ORDER`, `SENSITIVE_TAGS` |
| `shared/normalize.ts` | Chuẩn hóa ô/giá trị (ngày serial, NFC, enum…) | `normalizeRecord(raw): GkskRecord` |
| `shared/validate.ts` | Luật kiểm tra mirror server + cảnh báo `LOCAL_*` | `validateRecord(rec, ctx): Issue[]`, `hasBlockingErrors(issues)` |
| `server/gksk/xml.ts` | Dựng XML | `buildGkskXml(rec): string`, `toBase64Utf8(xml)` |
| `server/gksk/envelope.ts` | Dựng `msg_id`, header, envelope | `newMsgId(senderId, now)`, `buildEnvelope(...)` |
| `server/gksk/signature.ts` | Chữ ký gói tin | `signEnvelope(header, data, privateKeyPem?)` |
| `server/gksk/client.ts` | HTTP tới API, cache token, parse phản hồi | `login()`, `push(envelope)`, `status(msgId)` |
| `server/gksk/retry.ts` | Chính sách retry theo API-CONTRACT §8 | `withRetry(...)` |
| `server/db/*` | Kết nối MSSQL (`mssql`), chạy migration `gksk_*`, cài đặt `MssqlRepositories` & `InMemoryRepositories` | `runMigrations(pool)`, `createRepositories(pool?)` |
| `server/services/importService.ts` | Tạo mẫu Excel, đọc Excel, đối chiếu trùng `SO` trong DB (ghi đè thông minh), lưu cả dòng `ready` và `invalid` (có `SO`) | `buildTemplate()`, `previewImport(buffer)`, `commitImport(payload)` |
| `server/services/exportService.ts` | Xuất file `<SO>.xml`, đóng gói `.zip` nhiều XML, xuất file `.xlsx` đối soát | `buildXmlZip(records)`, `buildReconcileExcel(items)` |
| `server/services/sendService.ts` | Máy trạng thái gửi 1 giấy | `sendCertificate(id)` |
| `server/services/jobService.ts` | Hàng đợi gửi hàng loạt (trong bộ nhớ) | `startBatch(ids)`, `getJob(id)` |

## 4. Endpoint nội bộ (app ↔ trình duyệt)

Tất cả dưới `/api`, JSON, trừ các endpoint tải file (`.xml`, `.zip`, `.xlsx`). Mọi endpoint trừ `health`, `auth/*`, `config` yêu cầu phiên đăng nhập (S12). Lỗi trả dạng `{ "error": { "code": "...", "message": "..." } }`.

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/health` | `{ok:true}` |
| GET | `/api/config` | `{ appEnv, facilityId, facilityName, baseUrlHost }` — **không** có mật khẩu/token/chuỗi kết nối DB |
| POST | `/api/auth/login` · `/api/auth/logout` · GET `/api/auth/me` · POST `/api/auth/change-password` | Đăng nhập ứng dụng (xác thực kết hợp bảng `dbo.gksk_users` + tài khoản dự phòng `.env`, trả kèm cờ `user.isSystemAdmin` cho 3 tài khoản quản trị `admin`, `thangnh`, `kienvd`), đổi mật khẩu cá nhân (mọi user đã đăng nhập đều được dùng) |
| GET · POST | `/api/users` | *(Chỉ dành cho `admin`, `thangnh`, `kienvd` — user khác trả `403`)* Danh sách tài khoản nội bộ trong `dbo.gksk_users` (không trả `password_hash`) · Thêm mới hoặc cập nhật tài khoản |
| PATCH | `/api/users/:id/password` · `/api/users/:id/status` | *(Chỉ dành cho `admin`, `thangnh`, `kienvd` — user khác trả `403`)* Đặt lại mật khẩu cho nhân viên · Khóa / Mở khóa tài khoản (`isActive`, chống tự khóa chính mình) |
| POST | `/api/system/check-connection` | *(Chỉ dành cho `admin`, `thangnh`, `kienvd` — user khác trả `403`)* Chẩn đoán kết nối 2 bước: (1) Kiểm tra CSDL MSSQL (5 bảng `gksk_*`), (2) Kiểm tra xác thực tài khoản CSYT `POST /api/auth/login` (`forceRefresh: true`) và kiểm tra quyền truy cập API GKSK `GET /api/platform/gksk-lai-xe/status` (**không** trả về token/mật khẩu) |
| GET · PUT | `/api/system/gksk-config` | *(Chỉ dành cho `admin`, `thangnh`, `kienvd` — user khác trả `403`)* Xem thông tin cấu hình kết nối CSYT hiện tại (`baseUrl`, `username`, `facilityId`, `facilityName`, `senderId`, `hasPassword`, **không** trả mật khẩu) · Cập nhật nóng cấu hình tài khoản CSYT trên bộ nhớ server & đồng bộ file `.env` (bọc ngoặc kép an toàn cho mật khẩu có ký tự `#`, `$`), hoặc đọc lại từ `.env` |
| GET | `/api/import/template` | Tải `GKSK_mau_nhap_lieu.xlsx` |
| POST | `/api/import/excel` | `multipart/form-data` (`file`) → bản xem trước từng dòng + trạng thái đối chiếu `SO` với DB (`new`, `overwrite_pending`, `accepted_unchanged`, `accepted_modified`) |
| POST | `/api/import/commit` | Body `{filename, rows[]}` → lưu/ghi đè các dòng được chọn (cả dòng `ready` lẫn dòng `invalid` có `SO`) vào DB |
| GET | `/api/batches` | Danh sách các đợt import Excel (`id`, `filename`, `rowCount`, `createdAt`) để lọc đối soát |
| GET | `/api/certificates` | `?tab=all\|unsent\|accepted\|attention&status=&batchId=&fromDate=&toDate=&q=&page=&pageSize=` — trả `{ items[], total, counts: { all, ready, accepted, invalid, rejected, error, sending } }`. **Không** trả trường nhạy cảm ở danh sách |
| GET | `/api/certificates/export-excel` | Xuất file `.xlsx` đối soát theo bộ lọc hiện tại (thông tin giấy, đợt import, trạng thái đẩy, `msg_id`, `server_certificate_id`, lỗi/cảnh báo tiếng Việt) |
| POST | `/api/certificates/xml-zip` | Body `{ids: number[]}` → tải file `GKSK_XML_<YYYYMMDD_HHmmss>.zip` chứa các file `<SO>.xml` của các giấy hợp lệ (không có lỗi chặn) |
| GET | `/api/certificates/:id` | Chi tiết chỉ đọc (đủ 25 trường + `issues[]` + `xml` nếu không có lỗi chặn + thông tin đợt import) |
| DELETE | `/api/certificates/:id` | Xóa cục bộ khỏi DB (không xóa trên Hệ thống Sở) |
| GET | `/api/certificates/:id/xml` | Tải file `<SO>.xml` (`Content-Disposition: attachment`; tên file làm sạch ký tự; trả `422` nếu giấy đang `invalid`) |
| GET | `/api/certificates/:id/submissions` | Lịch sử các lần gửi của giấy |
| POST | `/api/certificates/:id/send` | Gửi một giấy, trả kết quả cuối |
| POST | `/api/send` | Body `{ids:number[]}` → `{jobId}`; gửi hàng loạt |
| GET | `/api/jobs/:jobId` | Tiến độ: `{total, done, accepted, rejected, error, items[]}` |
| POST | `/api/submissions/:id/refresh` | Tra lại status theo `msg_id` trên Hệ thống Sở |

> **Lưu ý:** Không có các endpoint `POST /api/certificates` (tạo tay) hay `PUT /api/certificates/:id` (sửa tay) trong giai đoạn v1 vì toàn bộ dữ liệu đi qua luồng Import Excel.

## 5. Schema DB (MSSQL) — migrations `001_init.sql` & `002_users.sql`

Tất cả bảng dùng tiền tố **`gksk_`** để an toàn khi dùng chung Database trên MSSQL Server hiện tại hoặc tạo Database riêng. Migration tự động kiểm tra và tạo bảng nếu chưa tồn tại (`IF OBJECT_ID(...) IS NULL`).

```sql
CREATE TABLE gksk_schema_migrations (
  version       NVARCHAR(64) NOT NULL PRIMARY KEY,
  applied_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE gksk_users (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  username      NVARCHAR(64) NOT NULL,
  password_hash NVARCHAR(255) NOT NULL,          -- Chuỗi băm bcrypt (cost=10)
  full_name     NVARCHAR(128) NOT NULL DEFAULT N'',
  is_active     BIT NOT NULL DEFAULT 1,
  created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT ux_gksk_users_username UNIQUE (username)
);

CREATE TABLE gksk_import_batches (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  filename      NVARCHAR(255) NOT NULL,
  row_count     INT NOT NULL,
  created_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE gksk_certificates (
  id                    INT IDENTITY(1,1) PRIMARY KEY,
  so                    NVARCHAR(64) NOT NULL,           -- Mã số giấy từ Excel (bắt buộc có để lưu & đối soát)
  fields_json           NVARCHAR(MAX) NOT NULL,          -- 25 trường đã chuẩn hóa (CHỨA DỮ LIỆU CÁ NHÂN)
  data_sha256           CHAR(64) NOT NULL,               -- SHA-256 của Base64 XML để nhận biết dữ liệu có đổi không
  status                VARCHAR(20) NOT NULL,            -- invalid|ready|sending|accepted|rejected|error
  batch_id              INT NULL REFERENCES gksk_import_batches(id),
  excel_row_number      INT NULL,                        -- Số dòng trong file Excel của lần import gần nhất
  server_certificate_id NVARCHAR(64) NULL,               -- certificate_id từ Hệ thống Sở
  created_at            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT ux_gksk_cert_so UNIQUE (so)
);

CREATE TABLE gksk_submissions (
  id                    INT IDENTITY(1,1) PRIMARY KEY,
  certificate_id        INT NOT NULL REFERENCES gksk_certificates(id) ON DELETE CASCADE,
  msg_id                VARCHAR(64) NOT NULL,
  send_datetime         BIGINT NOT NULL,                 -- ms epoch, đã dùng trong header
  data_sha256           CHAR(64) NOT NULL,               -- băm của `data` lúc gửi
  attempts              INT NOT NULL DEFAULT 0,
  http_status           INT NULL,
  res_code              VARCHAR(64) NULL,
  result_status         VARCHAR(20) NULL,                -- accepted|rejected|NULL (chưa có kết quả)
  server_submission_id  NVARCHAR(64) NULL,
  errors_json           NVARCHAR(MAX) NULL,              -- [{code,field}]
  warnings_json         NVARCHAR(MAX) NULL,              -- [{code,field}]
  last_error            NVARCHAR(500) NULL,              -- mã lỗi nội bộ/mạng, KHÔNG chứa dữ liệu giấy
  created_at            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  finished_at           DATETIME2 NULL,
  CONSTRAINT ux_gksk_sub_msg_id UNIQUE (msg_id)
);

CREATE INDEX ix_gksk_cert_status ON gksk_certificates(status);
CREATE INDEX ix_gksk_cert_batch ON gksk_certificates(batch_id);
CREATE INDEX ix_gksk_sub_cert ON gksk_submissions(certificate_id, id DESC);
```

- Không lưu XML/`data`/token/mật khẩu. XML dựng lại từ `fields_json` khi cần; vì dựng **xác định (deterministic)**, `data_sha256` giống nhau ⇔ dữ liệu giống nhau.
- Mọi truy vấn MSSQL bắt buộc đi qua `pool.request().input('name', sql.NVarChar, value)` — **tuyệt đối cấm** ghép chuỗi SQL.

## 6. Máy trạng thái (Import ghi đè & Gửi cổng)

```
[Import Excel (dòng có SO)]
   ├──► invalid (có lỗi chặn dữ liệu) ──► khóa nút Đẩy cổng / Xuất XML
   └──► ready   (hợp lệ, chờ đẩy)
          │
          ▼ (send)
       sending ──► accepted  | rejected (HTTP 200, data.status)
             └──► error      (hết retry / lỗi cấu hình)

[Import lại file Excel có trùng SO]
   ├── Nếu bản ghi cũ đang invalid|ready|rejected|error:
   │     mặc định tick chọn → ghi đè fields_json, tính lại trạng thái (ready hoặc invalid) [msg_id cũ bỏ nếu dữ liệu đổi]
   └── Nếu bản ghi cũ đang accepted:
         ├── data_sha256 KHÔNG đổi → đánh dấu "Đã đẩy thành công (không đổi)", mặc định BỎ CHỌN (bỏ qua)
         └── data_sha256 CÓ đổi   → cảnh báo LOCAL_SO_ACCEPTED_MODIFIED, mặc định BỎ CHỌN;
                                     nếu người dùng chủ động tick chọn → ghi đè và chuyển về ready (hoặc invalid) để đẩy đè lên Sở

[Khi đang ở error]
   └── bấm "Gửi lại" ──► sending (giữ nguyên msg_id nếu data_sha256 không đổi)
```

Các bước trong `sendCertificate(id)`:
1. Kiểm tra lại bằng `validateRecord`; có **lỗi chặn** (mirror mục R ở DATA-SPEC §1) → không gọi API, cập nhật/trả `invalid`.
2. Dựng XML → Base64 → tìm submission **chưa có kết quả** cùng `data_sha256` (giữ `msg_id`, `send_datetime`) hoặc tạo mới (`newMsgId`).
3. `status` trước nếu đây là lần gửi lại (API-CONTRACT §8).
4. `push` qua `withRetry`; ghi `attempts`, `http_status`, `res_code`.
5. Phân loại: HTTP 200 + `PS_SYNC_SUCCESS` → ghi `result_status`, `errors/warnings`, `server_certificate_id`; ngược lại → map theo bảng §8 của API-CONTRACT.
6. Cập nhật `gksk_certificates.status`. Mọi bước ghi DB đảm bảo nhất quán; **không** để giấy kẹt ở `sending` khi tiến trình chết: khi server khởi động (`recoverOnStartup`), giấy `sending` → `error` (người dùng gửi lại sẽ tự `status` kiểm tra).

## 7. Bảo mật

| Chủ đề | Quy định |
|---|---|
| Bí mật | `.env` chỉ ở server; `/api/config` không trả bí mật hay thông tin DB; client không có token CSYT |
| Phiên ứng dụng | cookie `httpOnly`, `sameSite=lax`, `secure` khi `APP_ENV=production` (trừ khi bật `ALLOW_INSECURE_COOKIE=true` cho mạng LAN HTTP nội bộ) hoặc sau HTTPS; hết hạn 8 giờ; xác thực kết hợp bảng `dbo.gksk_users` (băm `bcrypt`) và tài khoản dự phòng `.env` (`APP_LOGIN_USER` + `APP_LOGIN_PASSWORD_HASH` hoặc `APP_LOGIN_PASSWORD` tự băm lúc khởi động); tự động seed tài khoản `.env` vào `dbo.gksk_users` khi khởi động |
| Chống thử mật khẩu | giới hạn 10 lần đăng nhập sai / 15 phút / IP |
| CSRF | API chỉ nhận `application/json` hoặc `multipart` kèm header tùy biến `X-Requested-With: gksk` do client gắn; từ chối thiếu header với các method ghi |
| Upload | `multer` bộ nhớ, ≤ 5 MB, chỉ `.xlsx` (kiểm magic bytes `PK`), không ghi đĩa |
| Header | `helmet`: mặc định bật đầy đủ HSTS, COOP, Origin-Agent-Cluster và CSP `upgrade-insecure-requests`; khi bật `ALLOW_INSECURE_COOKIE=true` (mạng LAN HTTP nội bộ như `http://192.168.1.140/KSKLaiXe`), tự động tắt `upgrade-insecure-requests`, `hsts`, `crossOriginOpenerPolicy` và `originAgentCluster` để trình duyệt không ép nâng cấp tài nguyên `.js`/`.css` sang `https://` gây lỗi `ERR_CERT_AUTHORITY_INVALID` / màn hình trắng, trong khi vẫn giữ nguyên mọi rule CSP chống XSS khác |
| Log | `pino` có `redact`; không bao giờ log `fields_json`, giá trị từ Excel, `Authorization`, mật khẩu, `data` Base64, `DB_PASSWORD` |
| PII ở DB | Bảo mật kết nối MSSQL bằng tài khoản riêng; ghi chú phân quyền và sao lưu trong hướng dẫn vận hành (S19) |
| Hiển thị | Bảng danh sách đối soát không hiện `MATUY`, `NONGDOCON`, `LYDO`, `TINHTRANGBENH`; chỉ hiện trong Drawer xem chi tiết 1 giấy |
| Môi trường | `APP_ENV=production` → banner đỏ + hộp xác nhận mỗi lần gửi (kể cả hàng loạt) |

## 8. Phân nhóm trạng thái trên màn hình Danh sách & Đối soát

Màn hình Danh sách & Đối soát có 4 tab lọc nhanh kèm thẻ đếm số lượng trực tiếp, và mỗi dòng hiển thị huy hiệu (`StatusBadge`) rõ ràng:

| Tab đối soát | Trạng thái (`status`) | Huy hiệu hiển thị | Hành động cho phép |
|---|---|---|---|
| **Chưa đẩy (Sẵn sàng)** | `ready` | 🟦 Chờ đẩy cổng | Đẩy cổng, Xuất XML (`.xml` / `.zip`), Xem chi tiết |
| **Đã đẩy thành công** | `accepted` | ✅ Đã đẩy thành công | Xuất XML, Tra lại trạng thái, Xem chi tiết (liệt kê cảnh báo, `GKSK_UNSIGNED` là thông tin) |
| **Cần xử lý** (nhóm 1) | `invalid` | ⛔ Lỗi dữ liệu Excel | Không cho đẩy/xuất XML; sửa trên file Excel rồi Import đè lại theo `SO` |
| **Cần xử lý** (nhóm 2) | `rejected` | ⛔ Cổng Sở từ chối | Liệt kê mã lỗi từ chối tiếng Việt; sửa trên file Excel rồi Import đè lại theo `SO` |
| **Cần xử lý** (nhóm 3) | `error` | ⚠️ Lỗi mạng / 🔧 Lỗi cấu hình | Nút "Gửi lại" (giữ nguyên `msg_id`) hoặc kiểm tra cấu hình |
| *(Đang xử lý)* | `sending` | ⏳ Đang đẩy... | Spinner |
