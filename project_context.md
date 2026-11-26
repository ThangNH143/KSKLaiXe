# project_context.md — Webapp GKSK Lái xe (GKSKLaiXe)

> **Đây là file Agent phải đọc ĐẦU TIÊN, mỗi phiên làm việc.** Sau đó đọc `docs/IMPLEMENTATION-PLAN.md` để biết đang ở bước nào.
> Cập nhật lần cuối: 23/11/2026 · Phiên bản tài liệu: 1.1

---

## 1. Mục tiêu

Xây dựng webapp (NodeJS + ReactJS) giúp cơ sở y tế (CSYT) xử lý và gửi **Giấy khám sức khỏe lái xe (GKSK lái xe)** lên Hệ thống CSDL Sức khỏe Thành Phố Đồng Nai theo API `POST /api/platform/gksk-lai-xe/push`:

1. **Import file Excel** (theo mẫu do app cung cấp) → kiểm tra dữ liệu từng dòng → **lưu vào CSDL cả dòng hợp lệ (`ready`) lẫn dòng lỗi dữ liệu (`invalid`, có mã `SO`)** để khớp 100% quân số file Excel. Khi người dùng sửa lỗi trên file Excel gốc rồi Import lại, app **ghi đè thông minh theo mã `SO`** (tự động chọn cập nhật các dòng chưa đẩy/bị lỗi/bị từ chối; bỏ chọn mặc định các dòng đã đẩy thành công `accepted` nếu dữ liệu không đổi, hoặc cảnh báo nếu dữ liệu đã sửa khác bản đã đẩy).
2. **Xuất XML**: xem trước mã nguồn XML, tải lẻ từng file `<SO>.xml`, hoặc chọn nhiều giấy để tải gộp thành 1 file `.zip` chứa các file `<SO>.xml`.
3. **Đẩy cổng**: dựng envelope + chữ ký gói tin, gọi API, hiển thị kết quả (`accepted`/`rejected`, lỗi, cảnh báo), tra lại trạng thái theo `msg_id`, gửi lại khi lỗi mạng.
4. **Kiểm tra và Đối soát**: màn hình danh sách chia tab rõ ràng (**Tất cả** / **Chưa đẩy** / **Đã đẩy thành công** / **Cần xử lý**: Lỗi Excel, Sở từ chối, Lỗi mạng), lọc theo **Đợt import (file Excel)** và ngày, xem chi tiết chỉ đọc (Drawer 25 trường + XML + lịch sử gửi), và **Xuất file Excel đối soát** (kèm trạng thái đẩy, `msg_id`, `certificate_id`, mã lỗi/cảnh báo tiếng Việt).

> **Lưu ý phạm vi giai đoạn hiện tại:** **KHÔNG làm màn hình nhập liệu / chỉnh sửa trực tiếp trên web.** Mọi thao tác thêm mới hoặc sửa dữ liệu lỗi đều thực hiện trên file Excel rồi Import lại vào hệ thống.

Nguồn sự thật nghiệp vụ: `docs/reference/tai_lieu_api_gksk_lai_xe_v1_0_1_md.md` (v1.0.1 – **Dự thảo**). Các tài liệu trong `docs/` là bản chắt lọc để Agent làm việc nhanh; nếu có mâu thuẫn thì **bản gốc trong `docs/reference/` thắng**, và Agent phải ghi lại vào `docs/OPEN-QUESTIONS.md`.

## 2. Phạm vi

**Trong phạm vi (v1)**
- Một CSYT / một triển khai (cấu hình tài khoản CSYT trong `.env` phía server).
- Gửi `xml/base64`, giấy **chưa ký số** (API chấp nhận, trả cảnh báo `GKSK_UNSIGNED` — đây là kết quả bình thường, không phải lỗi).
- Import Excel (kèm ghi đè thông minh theo `SO`), danh sách kiểm tra & đối soát (đã đẩy / chưa đẩy / cần xử lý), xuất XML (lẻ `<SO>.xml` và gói `.zip`), xuất Excel đối soát, Drawer xem chi tiết chỉ đọc (đủ 25 trường + xem trước XML + lịch sử gửi), tra trạng thái, gửi lại.
- Cơ sở dữ liệu **MSSQL** trên server hiện tại (dùng tiền tố bảng `gksk_`).
- Mock server của API để kiểm thử không cần mạng.

**Ngoài phạm vi (v1) — KHÔNG làm**
- **Màn hình nhập liệu / form chỉnh sửa giấy trực tiếp trên web** (sửa trên Excel rồi import đè theo `SO`).
- Ký số XMLDSig cho giấy (`<Signature>` / `SIGNDATA`). Chưa bắt buộc.
- Gửi dạng `json/base64`; gửi file XML đã ký có sẵn (có thể làm ở v2).
- Nhiều CSYT, phân quyền theo vai trò, đa ngôn ngữ.
- Gửi lên Cổng BHXH (app này chỉ gửi Hệ thống Sở Y tế Đồng Nai).
- Báo cáo thống kê phức tạp ngoài bảng & file Excel đối soát.

## 3. Quyết định đã chốt (đổi được, nhưng phải cập nhật tài liệu + CHANGELOG)

| # | Quyết định | Lý do |
|---|---|---|
| D1 | Monorepo `npm workspaces`: `packages/shared`, `server`, `client` | Dùng chung một bộ luật kiểm tra dữ liệu cho cả server và client, tránh lệch |
| D2 | **TypeScript** toàn bộ; Node ≥ 20 LTS | Giảm sai sót kiểu dữ liệu |
| D3 | Backend: Express 4.x; Frontend: React 18 + Vite + React Router | Phổ biến, đơn giản |
| D4 | Kiểm tra dữ liệu & cấu hình: hàm thuần `validateRecord` ở `shared` + `zod` cho cấu hình/API (bỏ `react-hook-form` vì không làm màn hình nhập liệu) | Một nguồn luật, gọn nhẹ |
| D5 | DB: **MSSQL** (`mssql` package) trên SQL Server hiện tại, dùng tiền tố bảng **`gksk_`** (`gksk_certificates`, `gksk_submissions`, `gksk_import_batches`, `gksk_schema_migrations`) và tự chạy migration tạo bảng nếu chưa có. Tách **Repository Interface**: khi chạy `npm test` mặc định dùng bộ lưu trữ trong bộ nhớ (`InMemoryRepository`) để test nhanh và tuyệt đối không đụng vào MSSQL đang vận hành; có `npm run test:mssql` riêng cho DB test | Tận dụng hạ tầng MSSQL sẵn có của đơn vị, an toàn cho cả DB dùng chung lẫn DB riêng |
| D6 | Excel: **`exceljs`** (không dùng gói `xlsx`/SheetJS trên npm) cho cả đọc file import, tạo file mẫu và xuất file Excel đối soát | `xlsx` trên npm bản cũ, có lỗ hổng đã biết |
| D7 | Thông tin đăng nhập CSYT chỉ nằm ở **server `.env`**, trình duyệt **không bao giờ** thấy token/mật khẩu | Bảo mật |
| D8 | App có đăng nhập riêng (một tài khoản nội bộ cấu hình trong `.env`) | Tránh người lạ trong mạng nội bộ gửi giấy bằng tài khoản CSYT |
| D9 | XML: tự dựng bằng code với escape chặt, **không** có DOCTYPE/comment/`Signature`; hỗ trợ tải lẻ `.xml` và đóng gói `.zip` | API từ chối DOCTYPE; tiện xuất hàng loạt |
| D10 | Test: Vitest (+ Supertest cho API, Playwright cho E2E ở S17) | |
| D11 | Biến `APP_ENV=test\|production`; production hiện banner đỏ và bắt xác nhận trước khi gửi | Tài liệu: chỉ gửi dữ liệu giả lên môi trường kiểm thử |

> Nếu người dùng muốn đổi, **dừng và hỏi trước khi code**.

## 4. Những điều dễ sai nhất (Agent phải thuộc)

1. **Mỗi lần gọi = một giấy.** Gửi hàng loạt = gọi tuần tự nhiều lần, không có API batch.
2. **Giấy bị từ chối vẫn trả HTTP 200** với `header.res_code = "PS_SYNC_SUCCESS"`. Kết quả thật nằm ở `data.status` (`accepted`/`rejected`). Không được coi HTTP 200 là thành công.
3. **Ba dạng phản hồi khác nhau:** login (`header.res_code=CM_SUCCESS` + `data.token`), push (`header` + `data` + `signature`), status (`{code, message, data}` — **không có `header`**). Lỗi envelope: HTTP 4xx/5xx với `header.res_code`.
4. **`msg_id`** = `sender_id` + `YYMMDD` (**giờ Việt Nam UTC+7**, không phụ thuộc múi giờ máy) + UUID v4 viết liền không gạch (32 hexa). Mỗi lần gửi mới → `msg_id` mới. **Gửi lại do lỗi mạng → giữ nguyên `msg_id`.**
5. **Thứ tự key của `header` phải giữ nguyên** khi ký và khi gửi: `version, sender_id, receiver_id, txn_type, msg_id, msg_type, data_type, send_datetime`.
6. **Chữ ký gói tin:** `SHA256(JSON.stringify(header))` + `"."` + `SHA256(data.trim())`, hexa **VIẾT HOA**; có khóa RSA thì ký PKCS#1 v1.5 SHA-256 rồi Base64; không có khóa thì `signature` = chuỗi giả khác rỗng (hiện server chưa kiểm). Có golden vector ở `docs/API-CONTRACT.md` §5.
7. **Header bắt buộc khi push:** `Authorization: Bearer <token>`, `service-type: 100`, `Content-Type: application/json`.
8. **`IDBENHVIEN` trong giấy phải bằng mã CSYT của tài khoản**, nếu không → `GKSK_FACILITY_MISMATCH`. App tự điền từ cấu hình; người dùng không sửa.
9. **Excel làm mất số 0 đầu** của CCCD/SĐT nếu ô là số. Mọi cột phải đọc dưới dạng **chuỗi**; ô ngày dạng serial/Date phải đổi về `dd/MM/yyyy`. Template phải đặt định dạng ô là Text.
10. **Số giấy tờ thật (CCCD 12 số / CMND 9 số) sẽ TẠO NGƯỜI MỚI** trên Hệ thống Sở nếu chưa có. Khi thử nghiệm dùng số giả dạng hộ chiếu `TESTGKSK01`, `SO` bắt đầu bằng `TEST.`, họ tên bắt đầu bằng `TEST`.
11. **Cùng `SO` gửi lại = ghi đè** (không tạo giấy thứ hai). Giấy được định danh bởi `(CSYT, SO)`.
12. **Không log dữ liệu cá nhân** (họ tên, CCCD, kết quả ma túy, nồng độ cồn…), không log token/mật khẩu. Log chỉ ghi mã lỗi, tên thẻ, `msg_id`, id nội bộ. (Chính API cũng thiết kế như vậy.)
13. **Giới hạn:** gói ≤ 1 MB sau khi giải Base64; 300 gói/phút/CSYT; HTTP 429 → chờ `Retry-After` rồi gửi lại **cùng `msg_id`**.
14. **Token hết hạn sau 12 giờ** → đăng nhập lại; gặp 403 thì đăng nhập lại **đúng một lần** rồi thử lại, vẫn 403 thì báo lỗi.
15. **Độ dài thẻ theo bảng BHXH** (DATA-SPEC §1): `SOCMND_PASSPORT` ≤ 12, `NOICAP` ≤ 30, `HANGBANGLAI` ≤ 10, mã tỉnh/huyện/xã ≤ 10… Vượt → server chỉ cảnh báo `GKSK_FIELD_TOO_LONG`. `SO`: BHXH quy định 20 nhưng ví dụ của BHXH dài 21 (`00001/GKSKLX/34001/20`); Sở từ chối khi > 30.
16. **Thứ tự thẻ XML theo bảng BHXH** (bắt đầu `SO`, `NGAYKHAM`, `HOTEN`… kết thúc `STATE`), không theo bảng của Sở. Thẻ giới tính: app xuất `GIOITINHVAL`; Excel chấp nhận cả `GIOITINH`.
17. **An toàn MSSQL:** mọi bảng phải có tiền tố `gksk_`; truy vấn bắt buộc dùng tham số (`request.input(...)`), tuyệt đối cấm ghép chuỗi SQL; `npm test` mặc định chỉ chạy trên `InMemoryRepository` để không bao giờ tác động lên MSSQL đang vận hành.

## 5. Bản đồ tài liệu — thứ tự đọc

| Thứ tự | File | Nội dung |
|---|---|---|
| 1 | `project_context.md` | (file này) mục tiêu, quyết định, bẫy |
| 2 | `docs/IMPLEMENTATION-PLAN.md` | **Các bước thực thi nhỏ, mỗi bước có đầu ra + kiểm thử + cổng qua bước** |
| 3 | `docs/PROJECT-RULES.md` | Luật làm việc cho Agent, định nghĩa "xong", danh sách điều cấm |
| 4 | `docs/ARCHITECTURE.md` | Cấu trúc thư mục, module, endpoint nội bộ, schema DB MSSQL (`gksk_*`), máy trạng thái gửi |
| 5 | `docs/DATA-SPEC.md` | 25 trường, luật kiểm tra, mẫu Excel, luật import ghi đè & đối soát, ánh xạ XML |
| 6 | `docs/API-CONTRACT.md` | Hợp đồng API đã chắt lọc: envelope, chữ ký, phản hồi, mã lỗi/cảnh báo, retry |
| 7 | `docs/TEST-PLAN.md` | Chiến lược test, fixtures, ma trận ca kiểm thử, kiểm thử thủ công trên máy chủ thật |
| 8 | `docs/OPEN-QUESTIONS.md` | Điểm chưa rõ — Agent ghi thêm vào đây thay vì tự đoán |
| — | `CHANGELOG.md` | Nhật ký thay đổi — **cập nhật sau mỗi bước** |
| — | `docs/reference/*` | Tài liệu gốc, Postman, script mẫu. **Chỉ đọc, không sửa** |

## 6. Vòng lặp làm việc của Agent (bắt buộc)

```
1. Đọc project_context.md → CHANGELOG.md (xem bước cuối đã xong) → IMPLEMENTATION-PLAN.md (bước kế tiếp).
2. Chỉ làm ĐÚNG MỘT bước. Không làm trước, không gộp bước.
3. Viết test trước hoặc cùng lúc (xem "Kiểm thử" của bước đó).
4. Chạy cổng chung:  npm run lint && npm run typecheck && npm test
   + viết và chạy script kiểm chứng thực tế `scripts/verify-S<n>` để sinh bằng chứng vào `docs/evidence/S<n>/` (file mẫu `.xml`/`.xlsx`/`.zip`/`.json`/log và ảnh chụp màn hình trình duyệt `*.png` với mọi bước có UI/web).
5. Tick các ô "Điều kiện qua cổng" của bước. Thiếu một ô hoặc thiếu bằng chứng trong `docs/evidence/S<n>/` = chưa xong = KHÔNG sang bước sau.
6. Cập nhật CHANGELOG.md (mục "Đã làm / Đầu ra / Bằng chứng / Kiểm thử / Ghi chú cho Agent sau").
7. Dừng và báo người dùng theo đúng 5 mục bắt buộc trong IMPLEMENTATION-PLAN.md (đính kèm ảnh chụp màn hình, link file mẫu đã sinh, kết quả chạy script verify, kết quả test và bảng tick cổng). CẤM báo cáo "đã hoàn tất" suông.
```

Gặp điểm tài liệu thiếu/mâu thuẫn → **dừng**, ghi `docs/OPEN-QUESTIONS.md`, hỏi người dùng. Không tự đoán rồi code.

## 7. Cấu hình (`.env`, xem `.env.example` ở S1)

```
APP_ENV=test                         # test | production
PORT=3001

# Kết nối MSSQL trên server hiện tại (bảng dùng tiền tố gksk_)
DB_HOST=localhost
DB_PORT=1433
DB_USER=sa
DB_PASSWORD=...
DB_NAME=GKSKLaiXe
DB_ENCRYPT=false                     # true nếu dùng Azure SQL / TLS bắt buộc
DB_TRUST_SERVER_CERT=true            # true cho SQL Server nội bộ self-signed cert

GKSK_BASE_URL=https://<địa chỉ máy chủ>      # không có dấu / cuối
GKSK_USERNAME=75xxx                          # mã CSYT 5 chữ số
GKSK_PASSWORD=...
GKSK_FACILITY_ID=75xxx                       # = IDBENHVIEN, thường trùng username
GKSK_FACILITY_NAME=Tên cơ sở y tế            # điền vào thẻ BENHVIEN
GKSK_SENDER_ID=                              # mặc định = GKSK_FACILITY_ID
GKSK_PRIVATE_KEY_PATH=                       # tùy chọn, file .pem để ký RSA gói tin
GKSK_HTTP_TIMEOUT_MS=30000

APP_LOGIN_USER=admin
APP_LOGIN_PASSWORD_HASH=...                  # bcrypt
SESSION_SECRET=...                           # chuỗi ngẫu nhiên dài
```

`.env` **không commit**. Chỉ commit `.env.example`.

## 8. Lệnh chuẩn (đặt ở `package.json` gốc từ S0)

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy server + client chế độ phát triển |
| `npm run dev:mock` | Chạy mock API (S6) + server trỏ vào mock |
| `npm run lint` / `typecheck` / `test` | Cổng chung (`npm test` chạy với `InMemoryRepository`) |
| `npm run test:mssql` | Chạy bộ test tích hợp repository trực tiếp trên MSSQL test (khi cấu hình `TEST_MSSQL_*`) |
| `npm run build` | Build shared + server + client |
| `npm run test:e2e` | E2E (S17) |

## 9. Trạng thái hiện tại

Xem `CHANGELOG.md`. Bước bắt đầu: **S0**.

## 10. Câu hỏi mở (tóm tắt — chi tiết ở `docs/OPEN-QUESTIONS.md`)

- ✅ Độ dài từng thẻ: đã có từ bảng BHXH ([ksk_laixe_01.webp](file:///g:/KSKLaiXe/docs/reference/ksk_laixe_01.webp), [ksk_laixe_02.webp](file:///g:/KSKLaiXe/docs/reference/ksk_laixe_02.webp), [ksk_laixe_03.webp](file:///g:/KSKLaiXe/docs/reference/ksk_laixe_03.webp) → DATA-SPEC §1). Đã kiểm chứng và chốt ở S18: đếm theo **ký tự Unicode NFC** (Q13).
- ✅ Gốc XML `<root>`, thẻ giới tính `<GIOITINHVAL>`, và xuất đủ các thẻ rỗng (`NGAYKHAMLAI`, `LYDO`, `TINHTRANGBENH`): đã xác nhận từ file mẫu `docs/reference/gksk_mau_ky_so_root.xml` và kiểm chứng thực tế ở S18 (Q2, Q9, Q10).
- ✅ Tải nhiều XML cùng lúc (ZIP) (Q4): **Có** — hỗ trợ cả xem trước/tải lẻ `<SO>.xml` và tải gộp `.zip`.
- ✅ Tự sinh mã `SO` (Q12): **Không** — lấy trực tiếp từ file Excel import; chỉ cảnh báo thông tin `LOCAL_SO_FORMAT`.
- ✅ Các câu hỏi Q5, Q6, Q8, Q11 đã được chốt đầy đủ tại `docs/OPEN-QUESTIONS.md` ở bước S18.
