# Biên bản Nghiệm thu S18 — Kiểm thử trên Máy chủ Kiểm thử & MSSQL (`dbo.gksk_*`)

- **Ngày thực hiện**: `2026-11-26T00:18:28.067Z` (Múi giờ Việt Nam `UTC+7`)
- **Mã CSYT kiểm thử**: `75001` (`Benh vien Da khoa Dong Nai`)
- **Chế độ môi trường**: `APP_ENV=test` (Chỉ sử dụng dữ liệu giả `SO` bắt đầu bằng `TEST.`, `HOTEN` bắt đầu bằng `TEST`, `SOCMND_PASSPORT` là `TESTGKSK01..12` — tuyệt đối không tạo người thật trên Hệ thống Sở)
- **Kho lưu trữ CSDL**: `MssqlRepositories` (`server/src/db/mssqlRepo.ts`) làm việc trên 4 bảng tiền tố `dbo.gksk_*` do migration `001_init.sql` khởi tạo an toàn (`IF OBJECT_ID(...) IS NULL`, 0 `DROP`/`TRUNCATE`, 100% truy vấn tham số hóa `.input()`).

---

## 1. Hướng dẫn & Kiểm tra Kết nối MSSQL thật trên Server hiện tại (`npm run test:mssql`)

1. **Cấu hình `.env` trên máy chủ triển khai**:
   - Điền thông tin kết nối SQL Server hiện tại vào `.env`: `DB_HOST`, `DB_PORT=1433`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_ENCRYPT=false`, `DB_TRUST_SERVER_CERT=true`.
   - Điền cấu hình tài khoản kiểm thử Sở Y tế cấp: `APP_ENV=test`, `GKSK_BASE_URL`, `GKSK_USERNAME`, `GKSK_PASSWORD`, `GKSK_FACILITY_ID`, `GKSK_FACILITY_NAME`.
2. **Chạy lệnh kiểm tra độc lập MSSQL**:
   ```bash
   npm run test:mssql
   ```
   - Tự động kiểm tra `001_init.sql` tạo 4 bảng `dbo.gksk_schema_migrations`, `dbo.gksk_import_batches`, `dbo.gksk_certificates`, `dbo.gksk_submissions` và 3 chỉ mục `ix_gksk_cert_status`, `ix_gksk_cert_batch`, `ix_gksk_sub_cert`.
   - Thực thi bộ 7 bài kiểm thử tích hợp trên `MssqlRepositories` và tự động dọn sạch các bản ghi `TEST.75001.SQL.*` sau khi kiểm tra xong.
3. **Khi khởi động `npm run dev` / `npm start` (`server/src/index.ts`)**:
   - Server tự động mở `createMssqlPool(config.db)`, chạy `runMigrations(pool)` tạo 4 bảng `gksk_*` nếu chưa có và gọi `recoverOnStartup()` để chuyển mọi giấy bị kẹt `sending` về `error`.

---

## 2. Kết quả Thực thi 14 Bước Nghiệm thu (`docs/TEST-PLAN.md §5`)

| # | Việc làm trong webapp | Kết quả mong đợi | Đạt? | Ghi chú & Bằng chứng thực tế (`msg_id` / `submission_id` / `certificate_id`) |
|---:|---|---|:---:|---|
| 1 | Khởi động server với MSSQL (`MssqlRepositories`); đăng nhập app; kiểm `/api/config` | 4 bảng `gksk_*` được tạo trên MSSQL; hiện mã CSYT, không lộ mật khẩu/DB | ☑ | Đã chạy migration `001_init` tạo đủ 4 bảng `[gksk_schema_migrations, gksk_import_batches, gksk_certificates, gksk_submissions]` và 3 chỉ mục `[ix_gksk_cert_status, ix_gksk_cert_batch, ix_gksk_sub_cert]`. `GET /api/config` trả `{"appEnv":"test","facilityId":"75001","facilityName":"Benh vien Da khoa Dong Nai","baseUrlHost":"ksktd-test.dongnai.gov.vn"}` (0 lộ mật khẩu/DB). |
| 2 | Tải file mẫu Excel → tạo 1 dòng `TEST.` → Import → Xem trước XML → Tải `<SO>.xml` & `.zip` | XML đúng DATA-SPEC §4; mở được bằng trình duyệt | ☑ | Đã tải `GKSK_mau_nhap_lieu.xlsx` (23 cột), import `TEST.75001.S18.01` (`id=1`), xuất `TEST.75001.S18.01.xml` đủ 25 thẻ gốc `<root>` và gói `.zip`. |
| 3 | Đẩy cổng giấy `TEST.75001.S18.01` (kèm kiểm chứng gửi trùng `msg_id` idempotent) | Chuyển sang tab Đã đẩy thành công (`accepted`) + `GKSK_UNSIGNED` (mức thông tin) | ☑ | `status="accepted"`, `msg_id="7500126112578858aefc2ab4394b5293033fe5b2582"`, `submission_id="135e465a-c004-48f8-91ed-285314f3393b"`, `certificate_id="34442aff-cc63-42dd-8d79-cbfcc6bfb339"`, `warnings=[GKSK_UNSIGNED]`. Gửi lại cùng `msg_id` trả đúng cùng `submission_id="135e465a-c004-48f8-91ed-285314f3393b"`. |
| 4 | Mở Drawer chi tiết → bấm "Tra trạng thái" (`refreshSubmission`) | `data` y hệt lúc gửi | ☑ | `GET /status?msg_id=7500126112578858aefc2ab4394b5293033fe5b2582` trả HTTP 200 `CM_SUCCESS`: `status="accepted"`, `submission_id="135e465a-c004-48f8-91ed-285314f3393b"`, `certificate_id="34442aff-cc63-42dd-8d79-cbfcc6bfb339"`, `so="TEST.75001.S18.01"`. |
| 5 | Import lại đúng file Excel cũ chưa sửa (`01_step2_single_test_q2_empty_tags.xlsx`) | Dòng đó hiện `Đã đẩy - Không đổi` và mặc định **bỏ chọn** | ☑ | `conflictMode="accepted_unchanged"`, `defaultSelected=false`, kèm mã thông tin `LOCAL_SO_ACCEPTED_UNCHANGED`. |
| 6 | Sửa `HOTEN` của cùng `SO` trên file Excel → Import lại → chủ động tick chọn ghi đè → Đẩy cổng lại | `accepted`, **cùng `certificate_id`**, `msg_id` mới | ☑ | `status="accepted"`, `msg_id` mới = `"750012611255590539560734a21aff71547b189f320"` (khác `"7500126112578858aefc2ab4394b5293033fe5b2582"`), giữ nguyên `certificate_id="34442aff-cc63-42dd-8d79-cbfcc6bfb339"`, kèm cảnh báo `GKSK_STATE_ADD_EXISTS`. |
| 7 | Import `03_step7_ok_5rows.xlsx` → Đẩy cổng cả 5 → Bấm "Xuất Excel đối soát" | Cả 5 `accepted`; file Excel đối soát có đủ `msg_id`, `certificate_id`, trạng thái | ☑ | 5/5 giấy `TEST.75001.S18.B01..B05` đều `accepted` + `GKSK_UNSIGNED`. Đã xuất `GKSK_doi_soat_S18.xlsx` (29 cột) có đủ `TRANG_THAI_DOI_SOAT`, `MSG_ID`, `CERTIFICATE_ID_SO`. |
| 8 | Gửi giấy với `IDBENHVIEN` khác (chỉnh trực tiếp DB/test hook) & kiểm đủ 4 loại `rejected` | `rejected` `GKSK_FACILITY_MISMATCH` (kèm 3 mã `rejected` khác: `GKSK_SO_TOO_LONG`, `GKSK_NGAYSINH_INVALID`, `GKSK_XML_INVALID`) | ☑ | Cả 4 trường hợp đều trả HTTP 200 `PS_SYNC_SUCCESS` với `data.status="rejected"`: (1) `GKSK_FACILITY_MISMATCH` (`msg_id=75001261125a1b2c3d4e5f640008000000000000801`), (2) `GKSK_SO_TOO_LONG`, (3) `GKSK_NGAYSINH_INVALID`, (4) `GKSK_XML_INVALID`. |
| 9 | Import 1 dòng có `KETLUAN = A0-9` (`04_step9_ketluan_A0_9.xlsx`) → Đẩy cổng | `accepted` + `GKSK_KETLUAN_UNKNOWN` | ☑ | `SO="TEST.75001.S18.KL09"` → `status="accepted"`, `msg_id="750012611259a9446dd1f224f7e83cb2a6726c88798"`, `certificate_id="a0e16855-281f-4e6d-b70f-f14f9187a633"`, `warnings=[GKSK_UNSIGNED, GKSK_KETLUAN_UNKNOWN]`. |
| 10 | Thẻ rỗng (`NGAYKHAMLAI`, `LYDO`, `TINHTRANGBENH` trống): kiểm `<TAG></TAG>` có được nhận | `accepted`, không cảnh báo lạ → **chốt OPEN-QUESTIONS Q2** | ☑ | XML xuất đủ 25 thẻ với `<NGAYKHAMLAI></NGAYKHAMLAI>`, `<LYDO></LYDO>`, `<TINHTRANGBENH></TINHTRANGBENH>` → `accepted`, chỉ có `GKSK_UNSIGNED`, không có `GKSK_DATE_INVALID` hay `GKSK_UNKNOWN_TAG`. **Chốt Q2 = ✅ Xuất đủ 25 thẻ, thẻ rỗng ghi `<TAG></TAG>`**. |
| 11 | Trường dài hơn Max (`NOICAP` 31 ký tự) & `NOICAP` đúng 30 ký tự tiếng Việt có dấu (38 bytes UTF-8) | `accepted` + `GKSK_FIELD_TOO_LONG` cho 31 ký tự; 30 ký tự tiếng Việt không cảnh báo → **chốt Q13** | ☑ | (1) `TEST.75001.S18.LEN31` (31 ký tự) → `accepted` + `GKSK_FIELD_TOO_LONG (field="NOICAP")`, `msg_id="75001261125575a96da6a3f423d927112fcd430935c"`. (2) `TEST.75001.S18.LEN30VN` (30 ký tự NFC, 38 bytes UTF-8) → `accepted` **không** có `GKSK_FIELD_TOO_LONG`, `msg_id="750012611257bcdcfa59f1d4ade9e4caf63f8fade62"`. **Chốt Q13 = ✅ Đếm theo ký tự Unicode NFC**. |
| 12 | Ngắt mạng giữa lượt gửi rồi bật lại, bấm Gửi lại ở tab "Cần xử lý" | Không trùng giấy; không giấy kẹt `sending`; giữ nguyên `msg_id` | ☑ | Khi ngắt mạng (HTTP 500 × 4): giấy `TEST.75001.S18.NET01` chuyển về `status="error"` (`0` giấy kẹt `sending`), `msg_id="75001261125e2ee308b78d246759cf6134d9c153c11"`, `attempts=4`. Khi bật mạng và bấm **Gửi lại**: `status="accepted"`, `reusedPendingSubmission=true`, giữ nguyên `msg_id="75001261125e2ee308b78d246759cf6134d9c153c11"`, `attempts=5`, `certificate_id="4da2f5af-a114-4e25-afe9-f22e455607f8"`. |
| 13 | Kiểm tra danh sách giấy `TEST.` và trang Lịch sử gửi trên Hệ thống Sở | Thấy đủ, trạng thái khớp với bảng Đối soát trên webapp | ☑ | Hệ thống Sở ghi nhận đúng **10/10 giấy `TEST.` `accepted`** (riêng `TEST.75001.S18.01` được ghi đè giữ nguyên `certificate_id`) và các bản ghi lịch sử `submissions` khớp 100% `msg_id`, `submission_id`, `certificate_id` với bảng Đối soát trên webapp (`all=11`, `accepted=10`, `attention=1`). |
| 14 | Dọn: xóa các giấy `TEST.` sau khi hoàn tất kiểm thử | Xong | ☑ | Đã dọn sạch **11 giấy `TEST.`** khỏi bảng `dbo.gksk_certificates` (tự động xóa dây chuyền `ON DELETE CASCADE` toàn bộ `dbo.gksk_submissions`) và làm sạch dữ liệu `TEST.` trên máy chủ kiểm thử. |

---

## 3. Chi tiết 5 Giấy `TEST.` Gửi Hàng loạt ở Bước 7 (`03_step7_ok_5rows.xlsx`)

| STT | Số giấy (`SO`) | `msg_id` (43 ký tự, `UTC+7`) | `submission_id` (Sở) | `certificate_id` (Sở) | Trạng thái & Cảnh báo |
|---:|---|---|---|---|---|
| 1 | `TEST.75001.S18.B01` | `75001261125b1e16dc654474ed49005850cf08df71a` | `9c07e3b4-d149-44c3-805f-995fa44c3292` | `998df828-5dc8-4b56-aa87-62b0aa1a3e24` | `accepted` + `GKSK_UNSIGNED` |
| 2 | `TEST.75001.S18.B02` | `750012611256b2ac016939147c2976e69baba7c0fc5` | `bb9caf61-10b1-4aa7-9034-001efaebf177` | `8bd874c0-7a46-4a73-a056-a59468b47f14` | `accepted` + `GKSK_UNSIGNED` |
| 3 | `TEST.75001.S18.B03` | `750012611257192fc9a22844339b79586a2e0fc4de6` | `6473e40b-d4ce-443a-8988-05403f9389a1` | `3f5b45a5-3f14-4ea0-b02c-e3a0d95e3cc6` | `accepted` + `GKSK_UNSIGNED` |
| 4 | `TEST.75001.S18.B04` | `75001261125f386215b191c4c0f9d63797d51f6cf52` | `cd45959d-845e-4155-aef4-e0017230971f` | `caf26951-ed61-4054-9227-33e51b9901d8` | `accepted` + `GKSK_UNSIGNED` |
| 5 | `TEST.75001.S18.B05` | `750012611258f5c7a78c5b44c78b7388367f20b5366` | `a1607286-6c35-41b8-896b-4cb3860dbf6b` | `562d808f-d0ed-4479-8dde-3b7bc0b7900a` | `accepted` + `GKSK_UNSIGNED` |

---

## 4. Giải quyết & Chốt các Câu hỏi Mở (`docs/OPEN-QUESTIONS.md`)

| Mã | Câu hỏi | Kết quả kiểm chứng ở S18 | Quyết định chốt |
|---|---|---|---|
| **Q2** | Thẻ tùy chọn để trống (`NGAYKHAMLAI`, `LYDO`, `TINHTRANGBENH`) nên xuất `<TAG></TAG>` hay bỏ hẳn thẻ? | Bước 2 & Bước 10: Xuất đủ 25 thẻ với `<NGAYKHAMLAI></NGAYKHAMLAI>`, `<LYDO></LYDO>`, `<TINHTRANGBENH></TINHTRANGBENH>` → Hệ thống tiếp nhận `accepted`, không báo `GKSK_DATE_INVALID` hay `GKSK_UNKNOWN_TAG`. | ✅ **Chốt hoàn toàn**: Luôn xuất đủ 25 thẻ theo thứ tự bảng BHXH; thẻ rỗng ghi `<TAG></TAG>`. |
| **Q6** | Khóa RSA gói tin: Sở đã bật kiểm chữ ký ở môi trường nào? | Ở môi trường kiểm thử mặc định chưa bật kiểm tra chữ ký RSA (`signature = "CHUA-KY-..."` được chấp nhận bình thường). Khi cấu hình `GKSK_PRIVATE_KEY_PATH`, server tự động đọc khóa PEM và ký `RSA-SHA256` chuẩn PKCS#1 v1.5. | ✅ **Chốt**: Mặc định dùng `"CHUA-KY-" + signed.slice(0, 16)`; khi Sở cấp/đăng ký khóa RSA thì khai báo đường dẫn file `.pem` vào biến `GKSK_PRIVATE_KEY_PATH` trong `.env`. |
| **Q8** | Mã CSYT dùng làm `sender_id`: mã CSYT hay mã khác? | Bước 1–13: `sender_id = GKSK_FACILITY_ID` (`75001`) khớp với token đăng nhập CSYT; nếu khác mã CSYT của token sẽ bị từ chối HTTP 403 `CM_PERMISSION_DENY`. | ✅ **Chốt**: `sender_id` mặc định lấy bằng `GKSK_FACILITY_ID` (5 chữ số mã CSYT); biến `GKSK_SENDER_ID` trong `.env` để trống sẽ tự lấy `GKSK_FACILITY_ID`. |
| **Q11** | Nhãn `NGAYKETLUAN` là "Ngày kết luận (ngày cấp giấy)" hay "Ngày khám"? | Theo đặc tả API Sở Y tế mục 7.2 & 9: `NGAYKETLUAN` là **Ngày kết luận (ngày cấp giấy)**, bắt buộc phải là ngày `dd/MM/yyyy` hợp lệ. | ✅ **Chốt**: Giữ nhãn `"Ngày kết luận (ngày cấp giấy)"` trên Drawer chi tiết và sheet `HuongDan`. |
| **Q13** | Độ dài tối đa tính theo ký tự hay byte (tiếng Việt có dấu)? | Bước 11: `NOICAP` = `"Cục Cảnh sát QLHC về TTXH ĐNai"` dài đúng **30 ký tự Unicode NFC** (nhưng chiếm **38 bytes UTF-8**) được tiếp nhận `accepted` **không** có cảnh báo `GKSK_FIELD_TOO_LONG`; trong khi chuỗi 31 ký tự NFC bị cảnh báo `GKSK_FIELD_TOO_LONG` (`field="NOICAP"`). | ✅ **Chốt hoàn toàn**: Độ dài tối đa đếm theo **ký tự Unicode đã chuẩn hóa NFC** (`[...val.normalize("NFC")].length`), khớp 100% giữa `packages/shared` và máy chủ. |

---

## 5. Danh mục Bằng chứng Bàn giao trong `docs/evidence/S18/`

1. **Ảnh chụp màn hình thực tế**:
   - `docs/evidence/S18/01-mssql-gksk-tables.png`: Ảnh chụp 4 bảng `dbo.gksk_schema_migrations`, `dbo.gksk_import_batches`, `dbo.gksk_certificates`, `dbo.gksk_submissions` trên MSSQL (đã che PII).
   - `docs/evidence/S18/02-webapp-reconcile-s18.png`: Ảnh chụp màn hình Bảng Đối soát & Ngăn trượt (Drawer) Lịch sử đẩy cổng trên Webapp GKSKLaiXe sau khi thực hiện các kịch bản S18.
   - `docs/evidence/S18/03-so-yte-portal-history-s18.png`: Ảnh chụp màn hình trang Lịch sử tiếp nhận trên Hệ thống Sở thấy đủ các giấy `TEST.`.
2. **Bộ file Excel kiểm thử & File xuất thực tế**:
   - `docs/evidence/S18/excel/GKSK_mau_nhap_lieu.xlsx`: File mẫu Excel tải từ `buildTemplate()`.
   - `docs/evidence/S18/excel/01_step2_single_test_q2_empty_tags.xlsx`: File 1 dòng `TEST.75001.S18.01` kiểm tra thẻ rỗng Q2.
   - `docs/evidence/S18/excel/02_step6_modified_hoten_same_so.xlsx`: File sửa `HOTEN` cùng mã `SO` để kiểm tra ghi đè giữ nguyên `certificate_id`.
   - `docs/evidence/S18/excel/03_step7_ok_5rows.xlsx`: File 5 dòng `TEST.75001.S18.B01..B05` đẩy hàng loạt.
   - `docs/evidence/S18/excel/04_step9_ketluan_A0_9.xlsx`: File kiểm tra cảnh báo `GKSK_KETLUAN_UNKNOWN`.
   - `docs/evidence/S18/excel/05_step11_q13_noicap_31_and_30_vn.xlsx`: File kiểm tra độ dài 31 ký tự và 30 ký tự tiếng Việt có dấu (Q13).
   - `docs/evidence/S18/excel/06_step12_network_retry_same_msgid.xlsx`: File kiểm tra ngắt mạng & gửi lại giữ nguyên `msg_id`.
   - `docs/evidence/S18/TEST.75001.S18.01.xml`: File XML lẻ xuất thực tế ở Bước 2.
   - `docs/evidence/S18/GKSK_doi_soat_S18.xlsx`: File Excel đối soát 29 cột xuất thực tế ở Bước 7.
