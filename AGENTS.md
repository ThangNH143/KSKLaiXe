# AGENTS.md — Quy tắc bắt buộc cho dự án GKSKLaiXe

> File này được Antigravity tự động nạp vào mọi phiên làm việc trong `g:\KSKLaiXe`.
> Trước khi viết bất kỳ dòng code nào, Agent **bắt buộc** đọc `project_context.md`, `CHANGELOG.md` (để biết bước hiện tại) và `docs/IMPLEMENTATION-PLAN.md`.

## 1. Phạm vi & Kiến trúc cốt lõi (v1.1)

- **Chỉ làm**: Webapp **Import Excel → Kiểm tra & Đối soát → Xuất XML (`.xml` lẻ & `.zip` hàng loạt) → Đẩy cổng Sở Y tế Đồng Nai (`POST /api/platform/gksk-lai-xe/push`) → Xuất Excel đối soát**.
- **TUYỆT ĐỐI KHÔNG LÀM** màn hình nhập liệu hoặc form chỉnh sửa giấy trực tiếp trên web ở giai đoạn hiện tại (`EntryPage`, `CertificateForm`, `react-hook-form`). Mọi chỉnh sửa dữ liệu lỗi đều thực hiện trên file Excel (hoặc file Excel đối soát 29 cột) rồi Import đè lại theo mã `SO`.
- **Lưu 100% quân số có mã `SO` để đối soát**: Khi commit Import Excel, lưu cả dòng hợp lệ (`status = 'ready'`) lẫn dòng có lỗi dữ liệu chặn (`status = 'invalid'`, miễn là có `SO` ≤ 30 ký tự) vào DB. Khi Import lại file Excel trùng `SO`, tự động xử lý theo 4 chế độ đối chiếu (`new`, `overwrite_pending`, `accepted_unchanged`, `accepted_modified` — xem `docs/DATA-SPEC.md §5.2`).

## 2. Quy trình thực thi 1 Bước / 1 Lần & Cấm báo cáo suông

Kích hoạt skill `gksk-step-runner` mỗi khi thực hiện một bước `S<n>` trong `docs/IMPLEMENTATION-PLAN.md`:
1. **Một bước một lần**: Chỉ làm đúng bước kế tiếp được ghi trong `CHANGELOG.md`. Không gộp bước, không làm nhảy cóc.
2. **Cổng kiểm thử bắt buộc**:
   - `npm run lint && npm run typecheck && npm test` phải xanh 100% (0 test bị `skip` hoặc `only`).
   - Viết và chạy script kiểm chứng độc lập `scripts/verify-S<n>.ts` (hoặc `.mjs`) để sinh bằng chứng thực tế vào `docs/evidence/S<n>/`.
3. **Bằng chứng bàn giao bắt buộc (`docs/evidence/S<n>/`)**:
   - **Bước Backend / Nghiệp vụ (`S1`–`S12`)**: Sinh file mẫu thực tế (`.xml`, `.json`, `.xlsx`, `.zip`, biên bản `.md`/`.txt`) lưu vào `docs/evidence/S<n>/` để người dùng bấm mở kiểm tra trực tiếp.
   - **Bước có Giao diện / Web (`S0`, `S13`–`S19`)**: Khởi chạy ứng dụng thật (`npm run dev` / `npm run dev:mock`), dùng trình duyệt (Browser Subagent / Playwright) thao tác và **chụp ảnh màn hình thực tế (`docs/evidence/S<n>/*.png`)** cho từng màn hình/trạng thái theo yêu cầu của bước đó.
4. **Mẫu Báo cáo bàn giao 5 mục bắt buộc** (TUYỆT ĐỐI CẤM chỉ báo cáo "Đã hoàn thành bước S<n>"):
   - **1. 📦 Đầu ra mã nguồn & file đã tạo/sửa** (kèm link clickable `file:///...`).
   - **2. 🛠️ Script kiểm chứng & Kết quả chạy thực tế** (lệnh + đầu ra + link `docs/evidence/S<n>/...`).
   - **3. 📸 Bằng chứng trực quan** (hiển thị/dẫn link ảnh chụp màn hình `docs/evidence/S<n>/*.png` hoặc link file `.xml`, `.xlsx`, `.zip` mẫu đã sinh ra).
   - **4. 🧪 Kết quả bộ Test tự động** (`lint`, `typecheck`, `test`).
   - **5. 🚦 Bảng đối chiếu Điều kiện qua cổng** (`☑` từng mục kèm bằng chứng).

## 3. An toàn Cơ sở dữ liệu MSSQL (`gksk_*`)

- Ứng dụng kết nối **MSSQL** trên server hiện tại qua gói `mssql`.
- **100% tên bảng phải có tiền tố `gksk_`**: `gksk_schema_migrations`, `gksk_import_batches`, `gksk_certificates`, `gksk_submissions`.
- **CẤM** chạy `DROP TABLE`, `TRUNCATE`, hoặc `DELETE` không có `WHERE` trên MSSQL.
- **100% truy vấn SQL phải dùng tham số** qua `request.input('param', sql.Type, value)`. Tuyệt đối cấm ghép chuỗi SQL.
- **`npm test` mặc định chỉ chạy trên `InMemoryRepositories`** (qua `DbRepositories` interface) để tuyệt đối không đụng vào MSSQL đang vận hành.

## 4. Những bẫy nghiệp vụ & bảo mật không được phép sai

Kích hoạt skill `gksk-protocol-guard` khi làm việc với XML, `msg_id`, chữ ký gói tin, retry hoặc Excel (`S2`–`S7`, `S9`–`S11`):
- **HTTP 200 không đồng nghĩa thành công**: Giấy bị từ chối vẫn trả HTTP 200 với `header.res_code = "PS_SYNC_SUCCESS"`. Phải đọc `data.status` (`accepted` | `rejected`).
- **Retry lỗi mạng giữ nguyên `msg_id`**: Timeout / 5xx / 429 phải gọi `GET .../status?msg_id=<msg_id>` trước rồi mới gửi lại với **cùng `msg_id`, `send_datetime`, `data`, `signature`**.
- **`msg_id` theo giờ Việt Nam (`UTC+7`)**: `sender_id + YYMMDD (UTC+7) + uuidV4SansDash`.
- **Thứ tự 8 khóa `header`** khi `JSON.stringify(header)` và chữ ký `SHA256_UPPER(headerJson) + "." + SHA256_UPPER(data.trim())` phải khớp từng ký tự với Golden Vector ở `docs/API-CONTRACT.md §5`.
- **25 thẻ XML theo thứ tự bảng BHXH**: Gốc `<root>`, bắt đầu `SO`, `NGAYKHAM`, `HOTEN`, `GIOITINHVAL`... kết thúc `STATE`. Không BOM, không `DOCTYPE`, không comment, xuất đủ thẻ rỗng `<TAG></TAG>`.
- **Không log PII & Bí mật**: Không bao giờ log họ tên, CCCD, nồng độ cồn, ma túy, lý do, tình trạng bệnh, `data` Base64, token CSYT, mật khẩu app hay mật khẩu MSSQL. Bảng danh sách đối soát trên UI không được trả/hiển thị 4 trường nhạy cảm (`NONGDOCON`, `MATUY`, `LYDO`, `TINHTRANGBENH` — chỉ hiển thị trong Drawer chi tiết 1 giấy).
- **Chỉ dùng dữ liệu giả khi kiểm thử**: `SO` bắt đầu bằng `TEST.`, `HOTEN` bắt đầu bằng `TEST`, `SOCMND_PASSPORT` dùng `TESTGKSK01...` (vì số CCCD 12 số hoặc CMND 9 số thật sẽ tạo người mới trên Hệ thống Sở).
