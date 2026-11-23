# OPEN-QUESTIONS.md — Điểm chưa rõ

> Agent: gặp điều tài liệu chưa nói rõ hoặc mâu thuẫn → **thêm dòng ở đây** rồi hỏi người dùng. Không tự đoán rồi code.
> Khi được trả lời: điền "Quyết định", sửa tài liệu liên quan, ghi CHANGELOG, đổi trạng thái thành ✅.

| # | Câu hỏi | Mặc định tạm dùng (v1) | Ảnh hưởng | Chốt ở | Trạng thái | Quyết định |
|---|---|---|---|---|---|---|
| Q1 | Độ dài tối đa từng thẻ theo PL2 CV 3829? | — | Validate | — | ✅ 23/11/2026 | Lấy từ bảng BHXH (`docs/reference/ksk_laixe_{01,02,03}.webp`): ghi ở `DATA-SPEC §1` cột Max; vượt chỉ cảnh báo `LOCAL_FIELD_OVER_SPEC` |
| Q2 | Thẻ tùy chọn để trống nên xuất `<TAG></TAG>` hay bỏ hẳn thẻ? | Xuất đủ 25 thẻ, thẻ rỗng ghi `<TAG></TAG>` | `buildGkskXml` | S18 (mục 10) | ✅ 23/11/2026 (một phần) | File mẫu `docs/reference/gksk_mau_ky_so_root.xml` xác nhận **xuất đủ thẻ** (các thẻ rỗng `NGAYKHAMLAI`, `LYDO`, `TINHTRANGBENH` đều có mặt trong XML). Kiểm chứng thêm ở S18 |
| Q3 | Danh mục `HANGBANGLAI` (≤ 10 ký tự); mã tỉnh/huyện/xã (BHXH: "theo mã Tổng cục Thống kê") dùng bảng nào? | Nhập tự do trong Excel, chỉ kiểm độ dài Max ≤ 10 | Validate | v2 | ✅ 23/11/2026 (cho v1) | v1 không làm màn hình nhập liệu nên không cần danh mục dropdown trên web; chỉ kiểm độ dài ≤ 10 khi import Excel |
| Q4 | Có cần tải nhiều XML cùng lúc (ZIP)? | Có | Danh sách & Đối soát | — | ✅ 23/11/2026 | Hỗ trợ cả hai: xem trước/tải lẻ từng file `<SO>.xml` và chọn nhiều giấy (hoặc theo bộ lọc) tải về 1 file `.zip` |
| Q5 | Có cần gửi giấy đã ký số (XML có `<Signature>`) hoặc `json/base64` có `SIGNDATA` (BHXH: CLOB, mô tả ở mục III của PL2, chưa có trong tay)? | Không (v1 gửi chưa ký) | Phạm vi | v2 | ⏳ | |
| Q6 | Khóa RSA gói tin: Sở đã bật kiểm chữ ký ở môi trường nào? Có đăng ký khóa công khai chưa? | Không ký thật (`CHUA-KY-…`); hỗ trợ sẵn `GKSK_PRIVATE_KEY_PATH` | `signature.ts` | S18 / trước production | ⏳ | |
| Q7 | Hệ điều hành/cách chạy dịch vụ ở nơi triển khai (Windows Server + PM2/NSSM hay Docker) và CSDL? | Windows Server, PM2/NSSM, **MSSQL** trên server hiện tại | `DEPLOY.md`, `db/` | — | ✅ 23/11/2026 | Chuyển DB sang **MSSQL** đang dùng ở server hiện tại, dùng tiền tố bảng `gksk_` và tự chạy migration tạo bảng nếu chưa có |
| Q8 | Mã CSYT dùng làm `sender_id`: mã CSYT hay "mã người gửi đã đăng ký" khác? | `sender_id = GKSK_FACILITY_ID` | Cấu hình | S18 | ⏳ | |
| Q9 | Đặc tả BHXH tự mâu thuẫn (gốc XML `root` vs `DATA/BODY`; `SO` ≤ 20 hay 30) | Gốc `root`; `SO` ≤ 30 (Sở) | `buildGkskXml` | — | ✅ 23/11/2026 | File mẫu `docs/reference/gksk_mau_ky_so_root.xml` xác nhận gốc XML là `<root>`. Bảng BHXH ghi `SO` VARCHAR2(20) nhưng ví dụ chính BHXH `00001/GKSKLX/34001/20` dài 21 → app: > 30 lỗi chặn, 21–30 chỉ info |
| Q10 | Bảng BHXH đặt tên thẻ giới tính là `GIOITINH`; API Sở nhận cả `GIOITINHVAL` và `GIOITINH`. Xuất thẻ nào? | `GIOITINHVAL` (ví dụ của Sở dùng thẻ này); Excel chấp nhận cả hai tên cột | `buildGkskXml`, template | — | ✅ 23/11/2026 | File mẫu `docs/reference/gksk_mau_ky_so_root.xml` xác nhận dùng thẻ `<GIOITINHVAL>0</GIOITINHVAL>`. App xuất `GIOITINHVAL`, Excel import nhận cả `GIOITINHVAL` và `GIOITINH` |
| Q11 | Bảng BHXH ghi chú `NGAYKETLUAN` là "Ngày khám (dd/MM/yyyy)" — có thể chỉ là chép nhầm (tài liệu Sở: ngày kết luận, dùng để thống kê). | Theo tài liệu Sở: ngày kết luận (ngày cấp giấy) | Nhãn Drawer chi tiết & sheet `HuongDan` | S18 | ⏳ | |
| Q12 | Có cần app tự gợi ý/sinh `SO` theo quy tắc BHXH `NNNNN/GKSKLX/<mã CSKCB>/<YY>` ("5 số thứ tự khám tự tăng")? | Không tự sinh | Import | — | ✅ 23/11/2026 | v1 chỉ import từ Excel nên `SO` lấy nguyên từ cột `SO` trong file Excel; chỉ báo thông tin `LOCAL_SO_FORMAT` nếu không theo mẫu |
| Q13 | Độ dài tối đa tính theo ký tự hay byte (tiếng Việt có dấu)? | Đếm ký tự Unicode (NFC) | validate | S18 (mục 11) | ⏳ | |
