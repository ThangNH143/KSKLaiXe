# TEST-PLAN.md — Kế hoạch kiểm thử

## 1. Chiến lược

| Tầng | Công cụ | Phạm vi | Chạy khi |
|---|---|---|---|
| Đơn vị | Vitest | `shared` (normalize/validate), `gksk/xml\|envelope\|signature\|retry` | Mọi bước (`npm test`) |
| Tích hợp API | Vitest + Supertest + **mock API** + **`InMemoryRepositories`** | routes, services (`importService`, `exportService`, `sendService`), `gkskClient` | Mọi bước từ S6 (`npm test` — **không chạm MSSQL thật**) |
| Tích hợp MSSQL | Vitest (`npm run test:mssql`) | `MssqlRepositories` & migration `gksk_*` trên DB test | Khi cấu hình `TEST_MSSQL_*` / trước S18 |
| Component | Vitest + Testing Library | đăng nhập, import Excel ghi đè thông minh, danh sách đối soát, Drawer chi tiết chỉ đọc | S13–S16 |
| E2E | Playwright (chạy với `dev:mock`) | 3 luồng chính (Import → Đối soát/Xuất XML/ZIP/Excel → Đẩy cổng & Import đè sửa lỗi) | S17 |
| Thủ công trên máy chủ thật | Postman collection + webapp + MSSQL thật | đối chiếu hành vi thật | S18 |

Nguyên tắc: (1) test đơn vị **không** phụ thuộc múi giờ/đồng hồ/ngẫu nhiên; (2) `npm test` dùng mock API và `InMemoryRepositories`, **không** mạng thật và **không** đụng vào MSSQL đang vận hành; (3) mọi lỗi từng gặp thêm một test hồi quy; (4) không snapshot dữ liệu cá nhân thật.

## 2. Fixtures (sinh bằng `tests/fixtures/make-fixtures.ts`)

Cơ sở dùng cho test: `facilityId=75001`, `today=2026-11-23`.

### 2.1 Excel

| File | Nội dung | Kết quả kỳ vọng khi import |
|---|---|---|
| `ok_5rows.xlsx` | 5 dòng hợp lệ, `SO` khác nhau, `SOCMND_PASSPORT=TESTGKSK01…05` | 5 ✅ (`ready`), `conflictMode='new'`, `defaultSelected=true` |
| `mixed_valid_invalid.xlsx` | 3 dòng hợp lệ + 2 dòng sai ngày sinh (nhưng có `SO`) + 1 dòng trống `SO` | 5 dòng có `SO` đều `defaultSelected=true` để lưu đủ quân số đối soát (3 `ready`, 2 `invalid`); 1 dòng thiếu `SO` có `canCommit=false` |
| `reimport_overwrite.xlsx` | Chứa 4 dòng trùng `SO` với DB: (1) giấy cũ đang `invalid` đã sửa đúng, (2) giấy cũ đang `rejected` đã sửa đúng, (3) giấy cũ đã `accepted` giữ nguyên dữ liệu, (4) giấy cũ đã `accepted` nhưng sửa `HOTEN` | (1)&(2) `overwrite_pending`, `defaultSelected=true`; (3) `accepted_unchanged`, `defaultSelected=false`; (4) `accepted_modified`, cảnh báo `LOCAL_SO_ACCEPTED_MODIFIED`, `defaultSelected=false` |
| `leading_zero.xlsx` | CCCD `079000012345`: dòng 2 ô **số**, dòng 3 ô **chuỗi** | Dòng 3 giữ `079000012345`. Dòng 2 mất số 0 → `11 chữ số` → `GKSK_ID_INVALID` (cảnh báo) — ghi rõ trong báo cáo |
| `dates_mixed.xlsx` | `NGAYSINH` là `Date`, serial `33014`, chuỗi `21/5/1990`, chuỗi `1990-05-21` | Cả 4 → `21/05/1990` |
| `dates_bad.xlsx` | `31/02/1990`, `1899-12-31`, `abc`, năm 2027 | 4 dòng ⛔ `GKSK_NGAYSINH_INVALID` (lưu vào DB ở trạng thái `invalid` để đối soát) |
| `missing_required_col.xlsx` | Không có cột `KETLUAN` | Từ chối cả file, nêu `KETLUAN` |
| `extra_cols_reordered.xlsx` | Thứ tự cột đảo, thêm cột `GHICHU` (hoặc 6 cột đối soát của file Xuất Excel đối soát) | Import đủ; báo cáo liệt kê cột thêm là cột bị bỏ qua, không báo lỗi |
| `blank_rows.xlsx` | Dòng trống xen kẽ | Bỏ dòng trống; `rowNumber` vẫn là số dòng Excel thật |
| `formulas.xlsx` | `HOTEN` = công thức `="TEST "&"A"` | `HOTEN = "TEST A"` |
| `dup_so.xlsx` | 2 dòng cùng `SO` trong 1 file | Dòng sau có `LOCAL_SO_DUPLICATE_IN_BATCH`, chỉ cho chọn lưu dòng cuối của `SO` đó |
| `facility_mismatch.xlsx` | Cột `IDBENHVIEN=75999` | Dòng đó ⛔ `LOCAL_FACILITY_MISMATCH` |
| `alias_gioitinh.xlsx` | Cột tiêu đề `GIOITINH` (không có `GIOITINHVAL`) | Nhận như `GIOITINHVAL`; có cả hai cột → `GIOITINHVAL` thắng, báo `GIOITINH` bị bỏ qua |
| `over_length.xlsx` | `NOICAP` 31 ký tự, `SOCMND_PASSPORT` 13 ký tự | ⚠️ `LOCAL_FIELD_OVER_SPEC` (không chặn), XML vẫn dựng đủ |
| `enum_variants.xlsx` | `GIOITINHVAL`=`Nam`,`nữ`,`M`; `KETLUAN`=`a0-1`,`A0–2` (gạch dài) | `0`,`1`,`0`; `A0-1`,`A0-2` |
| `too_many_rows.xlsx` | 1001 dòng | Từ chối cả file |
| `big_1000.xlsx` | 1000 dòng hợp lệ | Thành công < 10 s |
| `not_xlsx.xlsx` | file `.csv`/ảnh/`.xls` đổi đuôi | `415`/`400`, không crash |
| `empty.xlsx` | Chỉ có dòng tiêu đề | 0 dòng, thông báo "không có dữ liệu" |

### 2.2 Bản ghi mẫu & XML
- `record_ok.json` (DATA-SPEC §6), `record_special_chars.json` (có `& < > " '`, tiếng Việt, xuống dòng).
- `expected_ok.xml` — XML đúng cho `record_ok.json`.

## 3. Ma trận ca kiểm thử

### 3.1 `validate` (S3) — mỗi hàng ≥ 1 ca kích hoạt + 1 ca sát biên không kích hoạt

| Mã | Ca kích hoạt | Ca sát biên (không kích hoạt) |
|---|---|---|
| `GKSK_SO_MISSING` | `SO=""`, `"   "` | `SO="A"` |
| `GKSK_SO_TOO_LONG` | 31 ký tự | 30 ký tự (kèm `LOCAL_SO_OVER_20` info), 21 ký tự `00001/GKSKLX/34001/20` (info) |
| `GKSK_HOTEN_INVALID` | `""`, 256 ký tự | 255 ký tự |
| `GKSK_ID_MISSING` | `""` | `TESTGKSK01` |
| `GKSK_NGAYSINH_INVALID` | `31/02/1990`, `01/01/1899`, `abc`, `""`, năm 2027 | `01/01/1900`, `29/02/2024`, hôm nay |
| `GKSK_NGAYKETLUAN_INVALID` | `""`, `32/01/2026` | `06/11/2026` |
| `GKSK_KETLUAN_MISSING` | `""` | `A0-1` |
| `GKSK_FACILITY_MISMATCH` | `IDBENHVIEN=75999` | `75001` |
| `GKSK_KETLUAN_UNKNOWN` (W) | `A0-4`, `OK` | `A0-1`,`A0-2`,`A0-3` |
| `GKSK_GIOITINH_UNKNOWN` (W) | `2`, `X` | `0`, `1`, rỗng |
| `GKSK_NONGDOCON_INVALID` (W) | `abc`, `1.2.3`, `-1` | `0`, `0,25`, `0.25`, rỗng |
| `GKSK_DVINONGDOCON_INVALID` (W) | `2` | `0`, `1`, rỗng |
| `GKSK_MATUY_INVALID` (W) | `2` | `0`, `1` |
| `GKSK_DATE_INVALID` (W) | `NGAYKHAM=abc` | `NGAYKHAM=""` (trống không cảnh báo) |
| `GKSK_ID_INVALID` (W) | `000000000000`, 10 số, 11 số | `079000012345`, 9 số `012345678` |
| `LOCAL_FIELD_OVER_SPEC` | `SOCMND_PASSPORT` 13 ký tự, `NOICAP` 31, `HANGBANGLAI` 11, `MATINH_THUONGTRU` 11, `DVINONGDOCON` 2 ký tự | cùng thẻ ở đúng độ dài Max |
| `LOCAL_SO_FORMAT` (info) | `TEST.75001.1`, `1/GKSKLX/75001/26` | `00001/GKSKLX/75001/26` |
| `LOCAL_BHXH_REQUIRED_EMPTY` (info) | `DIACHITHUONGTRU=""`, `NGAYKHAM=""` (gộp 1 dòng) | `NGAYKHAMLAI`,`LYDO`,`TINHTRANGBENH` trống → **không** báo |
| `LOCAL_ID_CREATES_PERSON` | 12 số, 9 số | `TESTGKSK01`, 10 số |
| `LOCAL_KETLUAN_A03_NO_RECHECK` | `A0-3` + `NGAYKHAMLAI=""` | `A0-3` + có ngày |
| `LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM` | kết luận < khám | bằng nhau |

### 3.2 `xml/envelope/signature` (S4–S5): xem bước trong IMPLEMENTATION-PLAN.

### 3.3 `gkskClient` + retry (S7) — dùng mock có chế độ lỗi

| Kịch bản | Mock | Kỳ vọng |
|---|---|---|
| Thành công + `GKSK_UNSIGNED` | bình thường | `kind=accepted`, warnings có `GKSK_UNSIGNED` |
| Bị từ chối | `IDBENHVIEN` khác | `kind=rejected`, errors `GKSK_FACILITY_MISMATCH`, **không retry** |
| Timeout lần 1 | `fail timeout ×1` | thành công lần 2; 2 request push có **cùng `msg_id`, `send_datetime`, `data`, `signature`**; có 1 request status 404 ở giữa |
| Mất phản hồi nhưng server đã xử lý | mock xử lý rồi hủy kết nối | status 200 → trả kết quả, **không push lần 2** |
| 429 | `Retry-After: 2` ×1 | chờ 2 s (đồng hồ giả), push lại cùng `msg_id` |
| 500 liên tục | `500 ×4` | `kind=transient` sau 3 lần thử, đúng khoảng chờ 5/15/45 s |
| 403 hết hạn | `403-once` | login lại 1 lần, push lại thành công |
| 403 kéo dài | `403 ×2` | `kind=config` |
| Login sai | — | `kind=config`, không retry, không có token trong thông điệp |
| 400 envelope | mock ép `CM_INVALID_REQUEST` | `kind=config` (lỗi lập trình), không retry |
| 409 trùng `msg_id` | mock ép | sinh `msg_id` mới, thử đúng 1 lần |
| `ref_msg_id` lệch | mock ép | báo lỗi bất thường, không ghi đè kết quả |
| Phản hồi lạ (thiếu `warnings`, thêm trường mới) | mock ép | parse khoan dung, không ném lỗi |

### 3.4 Dịch vụ gửi & Xuất đối soát (S9–S11)
Theo bước S9–S11. Thêm:
- Giữa lúc gửi batch, dừng tiến trình giả lập (gọi hàm `recoverOnStartup`) → giấy `sending` về `error`.
- Xuất Excel đối soát sau khi gửi batch (gồm cả giấy `accepted`, `rejected`, `invalid`, `ready`) → file `.xlsx` chứa đúng trạng thái tiếng Việt, `msg_id`, `server_certificate_id`, chi tiết lỗi; sửa dòng `invalid`/`rejected` ngay trên file Excel đối soát đó rồi Import ngược lại → dòng đã sửa cập nhật thành `ready`, các dòng `accepted` không đổi tự động có `defaultSelected=false`.

### 3.5 Bảo mật (S12, S17)
Xem §6.

## 4. Chạy kịch bản Postman trên mock (S6)

Mock phải làm cho các assertion của collection `docs/reference/GKSK_LAI_XE_API_postman_collection.json` **đạt** khi chạy bằng Postman CLI trỏ `baseUrl` vào mock (hoặc bộ test Vitest tương đương tái hiện đầy đủ các kịch bản 1.1 → 4.6):

```
postman collection run docs/reference/GKSK_LAI_XE_API_postman_collection.json \
  -e docs/reference/GKSK_LAI_XE_API_postman_environment_example.json \
  --env-var "baseUrl=http://localhost:4010" --env-var "username=75001" \
  --env-var "password=mock" --env-var "senderId=75001"
```
Ghi chú: request 2.5 bị bỏ qua khi `dataBase64` trống; 4.6 trả HTTP 400 là **đúng**.

## 5. Kiểm thử thủ công trên máy chủ kiểm thử thật & MSSQL thật (S18)

Điều kiện: kết nối MSSQL trên server hiện tại + tài khoản & `baseUrl` **kiểm thử**; `APP_ENV=test`; `GKSK_FACILITY_ID` = mã CSYT của tài khoản. Chỉ dữ liệu `TEST.`, số giấy tờ `TESTGKSK01…`.

| # | Việc làm trong webapp | Kết quả mong đợi | Đạt? | Ghi chú |
|---|---|---|---|---|
| 1 | Khởi động server với MSSQL; đăng nhập app; kiểm `/api/config` | 4 bảng `gksk_*` được tạo trên MSSQL; hiện mã CSYT, không lộ mật khẩu/DB | ☑ | `001_init` tạo đủ 4 bảng `dbo.gksk_*` & 3 chỉ mục `ix_gksk_*` |
| 2 | Tải file mẫu Excel → tạo 1 dòng `TEST.` → Import vào app → Mở Drawer xem trước XML → Tải `<SO>.xml` & tải `.zip` | XML đúng DATA-SPEC §4; mở được bằng trình duyệt | ☑ | `TEST.75001.S18.01.xml` đủ 25 thẻ gốc `<root>` |
| 3 | Đẩy cổng giấy đó | Chuyển sang tab **Đã đẩy thành công** (`accepted`) + `GKSK_UNSIGNED` (mức thông tin) | ☑ | `accepted` + `GKSK_UNSIGNED`; gửi trùng `msg_id` trả cùng `submission_id` |
| 4 | Mở Drawer chi tiết → bấm "Tra trạng thái" của lần gửi | `data` y hệt lúc gửi | ☑ | `GET /status` trả HTTP 200 `CM_SUCCESS` khớp 100% `data` |
| 5 | Import lại đúng file Excel cũ chưa sửa | Dòng đó hiện `Đã đẩy - Không đổi` và mặc định **bỏ chọn** | ☑ | `conflictMode='accepted_unchanged'`, `defaultSelected=false` |
| 6 | Sửa `HOTEN` của cùng `SO` trên file Excel → Import lại → chủ động tick chọn ghi đè → Đẩy cổng lại | `accepted`, **cùng `certificate_id`**, `msg_id` mới | ☑ | Giữ nguyên `certificate_id`, `msg_id` mới + `GKSK_STATE_ADD_EXISTS` |
| 7 | Import `ok_5rows.xlsx` → Đẩy cổng cả 5 → Bấm "Xuất Excel đối soát" | Cả 5 `accepted`; file Excel đối soát có đủ `msg_id`, `certificate_id`, trạng thái | ☑ | 5/5 `accepted`; xuất `GKSK_doi_soat_S18.xlsx` (29 cột) |
| 8 | Gửi giấy với `IDBENHVIEN` khác (chỉnh trực tiếp DB/test hook, **không** qua UI) | `rejected` `GKSK_FACILITY_MISMATCH` | ☑ | Đạt đủ 4 loại `rejected`: `GKSK_FACILITY_MISMATCH`, `GKSK_SO_TOO_LONG`, `GKSK_NGAYSINH_INVALID`, `GKSK_XML_INVALID` |
| 9 | Import 1 dòng có `KETLUAN` = `A0-9` → Đẩy cổng | `accepted` + `GKSK_KETLUAN_UNKNOWN` | ☑ | `TEST.75001.S18.KL09` `accepted` + `GKSK_KETLUAN_UNKNOWN` |
| 10 | Thẻ rỗng (`NGAYKHAMLAI` trống): kiểm `<TAG></TAG>` có được nhận | `accepted`, không cảnh báo lạ → **chốt OPEN-QUESTIONS Q2** | ☑ | **Chốt Q2**: xuất đủ 25 thẻ, thẻ rỗng `<TAG></TAG>` |
| 11 | Trường dài hơn Max (import `NOICAP` 31 ký tự) → Đẩy cổng | `accepted` + `GKSK_FIELD_TOO_LONG` field `NOICAP`; giấy lưu nguyên. Thử thêm 1 giá trị đúng 30 ký tự **có dấu tiếng Việt** để xác nhận đếm theo ký tự hay byte → **chốt Q13** | ☑ | 31 ký tự → `GKSK_FIELD_TOO_LONG`; 30 ký tự tiếng Việt (38 bytes UTF-8) → không cảnh báo (**Chốt Q13**: đếm theo ký tự Unicode NFC) |
| 12 | Ngắt mạng giữa lượt gửi 5 giấy rồi bật lại, bấm Gửi lại ở tab "Cần xử lý" | Không trùng giấy; không giấy kẹt `sending`; giữ nguyên `msg_id` | ☑ | `TEST.75001.S18.NET01` giữ nguyên `msg_id` (`attempts=5`, 0 kẹt `sending`) |
| 13 | Đăng nhập Hệ thống Sở bằng tài khoản CSYT: xem giấy `TEST.` và trang Lịch sử gửi | Thấy đủ, trạng thái khớp với bảng Đối soát trên webapp | ☑ | 10/10 giấy `TEST.` `accepted` khớp 100% bảng Đối soát |
| 14 | Dọn: xóa giấy `TEST.` trên Hệ thống Sở (do người dùng) | Xong | ☑ | Đã dọn sạch dữ liệu kiểm thử `TEST.` sau nghiệm thu |

Kết quả điền vào `docs/evidence/S18/S18-report.md` (chỉ mã, `msg_id`, ảnh chụp đã che dữ liệu).

## 6. Checklist bảo mật (S17 → `docs/SECURITY-CHECKLIST.md`)

- [ ] Không endpoint nghiệp vụ nào truy cập được khi chưa đăng nhập (test quét router).
- [ ] Phản hồi/HTML/JS của client không chứa mật khẩu, token CSYT, đường dẫn khóa RSA, mật khẩu MSSQL.
- [ ] Cookie phiên `HttpOnly`, `SameSite=Lax`, `Secure` khi chạy HTTPS/production.
- [ ] Giới hạn đăng nhập sai hoạt động; header `X-Requested-With` được kiểm cho method ghi.
- [ ] Upload: >5 MB bị chặn; sai magic bytes bị chặn; không ghi đĩa.
- [ ] Log một lượt E2E: grep `TEST NGUYEN`, `TESTGKSK`, `Bearer`, `eyJ` → 0 kết quả.
- [ ] Danh sách giấy đối soát không chứa `MATUY`, `NONGDOCON`, `LYDO`, `TINHTRANGBENH` (chỉ có trong Drawer chi tiết 1 giấy).
- [ ] Tên file tải về (`.xml`, `.zip`, `.xlsx`) an toàn với `SO` chứa `../`, dấu cách, tiếng Việt, `"`.
- [ ] Mọi truy vấn MSSQL dùng tham số `.input()`, không có SQL ghép chuỗi; mọi bảng có tiền tố `gksk_`; không có `dangerouslySetInnerHTML`.
- [ ] `npm test` mặc định không mở kết nối tới MSSQL thật.
- [ ] `npm audit --omit=dev` không còn high/critical chưa xử lý.
- [ ] `.env` không nằm trong git (`git ls-files | grep -E "\.env$"` → rỗng).
- [ ] Production: banner + hộp xác nhận hiển thị.

## 7. Tiêu chí chất lượng tổng

- Độ phủ dòng: `shared` ≥ 95%, `server/src/gksk` ≥ 90%, phần còn lại ≥ 80%.
- Không test nào `skip`/`only`; E2E xanh 3 lần liên tiếp.
- Hồi quy: mỗi lỗi phát hiện sau này → thêm test tái hiện **trước** khi sửa.
