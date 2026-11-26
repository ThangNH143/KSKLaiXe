# DATA-SPEC.md — Đặc tả dữ liệu giấy GKSK lái xe

> Nguồn: tài liệu API mục 4.3, 7.2, 7.3 (PL2 CV 3829). Đây là **nguồn duy nhất** cho `packages/shared/src/fields.ts` (S2).
> Tên thẻ viết HOA. Ngày dạng `dd/MM/yyyy`.

## 1. Danh sách 25 trường (đúng thứ tự cột của BHXH — cũng là thứ tự xuất XML)

> **Cập nhật 23/11/2026:** đối chiếu với bảng "Cấu trúc dữ liệu" của PL2 CV 3829 (ảnh chụp lưu ở `docs/reference/ksk_laixe_{01,02,03}.webp`) và file XML mẫu `docs/reference/gksk_mau_ky_so_root.xml`. Bảng BHXH có 26 cột = 25 thẻ dưới đây + `SIGNDATA` (CLOB, ký số, ngoài phạm vi v1).
> - **Thứ tự** đổi theo bảng BHXH (trước đây theo bảng của Sở). Thứ tự phần tử XML không ảnh hưởng việc đọc, nhưng theo BHXH để giống file Cổng BHXH sinh ra.
> - **Max** = độ dài `VARCHAR2` của BHXH. Server Sở chỉ **cảnh báo** `GKSK_FIELD_TOO_LONG` khi vượt (vẫn lưu nguyên), trừ `SO` và `HOTEN` (từ chối, xem cột Server).
> - **BHXH** = bảng BHXH để cột ALLOW_NULL trống (không cho null) → **✔**; `NGAYKHAMLAI`, `LYDO`, `TINHTRANGBENH` được phép null. **Sở** = Sở Y tế chỉ bắt buộc các thẻ in đậm.
> - Tên thẻ giới tính trong bảng BHXH là `GIOITINH`; API Sở nhận cả `GIOITINHVAL` (ví dụ của Sở dùng thẻ này) và `GIOITINH`. App xuất `GIOITINHVAL` (xem OPEN-QUESTIONS Q10).

Cột "Server" = hành vi của máy chủ khi vi phạm: **R** = từ chối giấy (`rejected`), **W** = cảnh báo (vẫn lưu), **—** = không kiểm.

| # | Thẻ | Nghĩa | Kiểu | Max | BHXH | Sở | Luật (server) | Server | Ghi chú Excel / Hiển thị |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `SO` | Số giấy | text | 20 (Sở nhận ≤ 30) | ✔ | **Có** | trống → `GKSK_SO_MISSING`; > 30 → `GKSK_SO_TOO_LONG`. Quy tắc BHXH: `NNNNN/GKSKLX/<mã CSKCB>/<YY>`, vd `00001/GKSKLX/34001/20` (**21 ký tự**, dài hơn Max 20 của chính BHXH) | R | Khóa định danh để lưu & ghi đè khi import |
| 2 | `NGAYKHAM` | Ngày khám | date | 10 | ✔ | Không | không đọc được → `GKSK_DATE_INVALID` (lưu trống) | W | `dd/MM/yyyy` |
| 3 | `HOTEN` | Họ tên | text | 255 | ✔ | **Có** | 1–255 ký tự → `GKSK_HOTEN_INVALID` | R | text |
| 4 | `GIOITINHVAL` | Giới tính | enum | 20 | ✔ | Không | `0` nam, `1` nữ; khác → `GKSK_GIOITINH_UNKNOWN` | W | Excel nhận cả tên cột `GIOITINH` |
| 5 | `NGAYSINH` | Ngày sinh | date | 10 | ✔ | **Có** | ngày thật `dd/MM/yyyy`, năm 1900…năm hiện tại → `GKSK_NGAYSINH_INVALID` | R | `dd/MM/yyyy` |
| 6 | `DIACHITHUONGTRU` | Địa chỉ thường trú | text | 255 | ✔ | Không | — | — | text |
| 7 | `MATINH_THUONGTRU` | Mã tỉnh thường trú (mã Tổng cục Thống kê) | text | 10 | ✔ | Không | — | — | text |
| 8 | `MAHUYEN_THUONGTRU` | Mã huyện thường trú (mã TCTK) | text | 10 | ✔ | Không | — | — | text |
| 9 | `MAXA_THUONGTRU` | Mã xã thường trú (mã TCTK) | text | 10 | ✔ | Không | — | — | text |
| 10 | `SOCMND_PASSPORT` | Số CMND/CCCD/hộ chiếu | text | **12** | ✔ | **Có** | trống → `GKSK_ID_MISSING` (R); toàn số 0 / 10 / 11 số → `GKSK_ID_INVALID` (W) | R / W | text (giữ số 0 đầu) |
| 11 | `NGAYTHANGNAMCAP` | Ngày cấp giấy tờ | date | 10 | ✔ | Không | không đọc được → `GKSK_DATE_INVALID` | W | `dd/MM/yyyy` |
| 12 | `NOICAP` | Nơi cấp | text | **30** | ✔ | Không | — | — | text |
| 13 | `HANGBANGLAI` | Hạng bằng lái | text | 10 | ✔ | Không | — | — | text |
| 14 | `IDBENHVIEN` | Mã CSYT (theo mã bảo hiểm) | text | 255 | ✔ | **Có** | phải = mã CSYT tài khoản → `GKSK_FACILITY_MISMATCH` | R | **Tự điền từ cấu hình** (không có trong mẫu Excel) |
| 15 | `BENHVIEN` | Tên CSYT | text | 255 | ✔ | Không | — | — | **Tự điền từ cấu hình** (không có trong mẫu Excel) |
| 16 | `NGAYKETLUAN` | Ngày kết luận (ngày cấp giấy) | date | 10 | ✔ | **Có** | ngày `dd/MM/yyyy` hợp lệ → `GKSK_NGAYKETLUAN_INVALID` | R | `dd/MM/yyyy` |
| 17 | `NONGDOCON` | Nồng độ cồn | số (`NUMBER`) | — | ✔ | Không | số; chấp nhận `,` hoặc `.`; sai → `GKSK_NONGDOCON_INVALID` | W | số — **nhạy cảm** (ẩn ở danh sách) |
| 18 | `DVINONGDOCON` | Đơn vị nồng độ cồn | enum | 1 | ✔ | Không | `0` = miligam/100 ml máu, `1` = miligam/1 lít khí thở; sai → `GKSK_DVINONGDOCON_INVALID` | W | `0` hoặc `1` |
| 19 | `MATUY` | Kết quả xét nghiệm ma túy | enum | 1 | ✔ | Không | `0` âm tính, `1` dương tính; sai → `GKSK_MATUY_INVALID` | W | `0` hoặc `1` — **nhạy cảm** (ẩn ở danh sách) |
| 20 | `BACSYKETLUAN` | Bác sĩ kết luận | text | 255 | ✔ | Không | — | — | text |
| 21 | `KETLUAN` | Kết luận | enum | 10 | ✔ | **Có** | trống → `GKSK_KETLUAN_MISSING` (R); ngoài `A0-1/A0-2/A0-3` → `GKSK_KETLUAN_UNKNOWN` (W) | R / W | `A0-1`, `A0-2`, `A0-3` |
| 22 | `NGAYKHAMLAI` | Ngày khám lại (nếu có yêu cầu) | date | 10 | — (cho null) | Không | — | — | `dd/MM/yyyy` |
| 23 | `LYDO` | Lý do sức khỏe không đạt | text | 255 | — (cho null) | Không | — | — | text — **nhạy cảm** (ẩn ở danh sách) |
| 24 | `TINHTRANGBENH` | Tình trạng bệnh tật hiện tại (nếu có bệnh, ghi cụ thể theo chuyên khoa) | text | 255 | — (cho null) | Không | — | — | text — **nhạy cảm** (ẩn ở danh sách) |
| 25 | `STATE` | Trạng thái giấy (`ADD`/`EDIT`) | enum | 5 | ✔ | Không | chỉ để cảnh báo `GKSK_STATE_ADD_EXISTS` | W | `ADD` hoặc `EDIT` (mặc định `ADD`) |

Enum:
- `KETLUAN` (theo BHXH): `A0-1` đủ điều kiện sức khỏe lái xe hạng … · `A0-2` không đủ điều kiện · `A0-3` đạt tiêu chuẩn nhưng **yêu cầu khám lại (ghi cụ thể thời gian khám lại)**.
- `GIOITINHVAL`: `0` Nam · `1` Nữ.

Không đưa vào XML: `SIGNDATA` (v1 không ký), `MOBILE`, `EMAIL`, `UUID`, `STATUS`, `CREATEDDATE`, `USERCREATE`, `ACTION`, `ECITIZENCODE`, `TENBACSYKETLUAN` (cổng BHXH tự điền hoặc không lưu). Không thêm thẻ lạ (sẽ bị `GKSK_UNKNOWN_TAG`).

## 2. Cảnh báo cục bộ (chỉ ở app, mã bắt đầu `LOCAL_`, không chặn gửi trừ `LOCAL_FACILITY_MISMATCH`)

| Mã | Mức | Khi nào |
|---|---|---|
| `LOCAL_FIELD_OVER_SPEC` | warning | Giá trị dài hơn **Max** ở bảng §1 (mirror của `GKSK_FIELD_TOO_LONG`; server vẫn lưu nguyên). Áp cho mọi thẻ có Max, **trừ `SO`** (xem dòng dưới). `field` = tên thẻ, không kèm giá trị |
| `LOCAL_SO_OVER_20` | info | `SO` dài 21–30 ký tự (Sở nhận; BHXH quy định 20 nhưng ví dụ chính họ là 21). > 30 là lỗi chặn `GKSK_SO_TOO_LONG` |
| `LOCAL_SO_FORMAT` | info | `SO` không khớp `^\d{5}/GKSKLX/<IDBENHVIEN>/\d{2}$`. Giấy thử `TEST.…` sẽ gặp mã này — bình thường |
| `LOCAL_BHXH_REQUIRED_EMPTY` | info | Thẻ có dấu ✔ ở cột **BHXH** nhưng để trống (Sở không bắt buộc, BHXH không cho null). Gộp thành **một dòng** liệt kê tên thẻ, không báo từng thẻ |
| `LOCAL_NGAYSINH_FUTURE` | warning | `NGAYSINH` sau hôm nay (server chỉ từ chối khi **năm** > năm hiện tại; ngày sinh tương lai trong năm → server nhận nhưng không tạo người) |
| `LOCAL_KETLUAN_A03_NO_RECHECK` | warning | `KETLUAN = A0-3` mà `NGAYKHAMLAI` trống (BHXH: A0-3 phải ghi cụ thể thời gian khám lại) |
| `LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM` | warning | `NGAYKETLUAN` < `NGAYKHAM` |
| `LOCAL_ID_CREATES_PERSON` | warning | `SOCMND_PASSPORT` là 12 số hoặc 9 số → gửi sẽ **tạo người** nếu Hệ thống Sở chưa có |
| `LOCAL_SO_DUPLICATE_IN_BATCH` | warning | Trùng `SO` trong cùng file Excel (dòng sau ghi đè dòng trước) |
| `LOCAL_SO_EXISTS` | info | `SO` đã tồn tại trong DB nội bộ ở trạng thái chưa đẩy / lỗi (`invalid`, `ready`, `rejected`, `error`) — mặc định được chọn để **ghi đè bản sửa mới** |
| `LOCAL_SO_ACCEPTED_UNCHANGED` | info | `SO` đã đẩy thành công (`accepted`) và dữ liệu trong file Excel **y hệt** bản đã đẩy (`data_sha256` khớp) — mặc định **bỏ chọn** để không đẩy lại thừa |
| `LOCAL_SO_ACCEPTED_MODIFIED` | warning | `SO` đã đẩy thành công (`accepted`) nhưng dữ liệu trong file Excel **có thay đổi** so với bản đã đẩy — mặc định **bỏ chọn**, cảnh báo người dùng (cho phép tick chọn thủ công nếu thực sự muốn cập nhật và đẩy đè lên Sở) |
| `LOCAL_FACILITY_MISMATCH` | error | Excel có cột `IDBENHVIEN` khác cấu hình (chỉ ở import, lỗi chặn) |

Độ dài đếm theo **ký tự Unicode** (đã chuẩn hóa NFC, `[...val.normalize('NFC')].length`), không theo byte — đã kiểm chứng và chốt ở S18 (xem `docs/OPEN-QUESTIONS.md` Q13: chuỗi `NOICAP` dài đúng 30 ký tự tiếng Việt có dấu / 38 bytes UTF-8 được nhận hợp lệ không cảnh báo `GKSK_FIELD_TOO_LONG`).

## 3. Chuẩn hóa trước khi kiểm tra (hàm thuần ở `shared/normalize.ts`)

| Việc | Quy tắc |
|---|---|
| Mọi giá trị | chuyển thành chuỗi; `trim()`; chuẩn hóa Unicode về **NFC**; xóa ký tự điều khiển không hợp lệ XML 1.0 (`\x00-\x08`, `\x0B`, `\x0C`, `\x0E-\x1F`, `\uFFFE`, `\uFFFF`) |
| Ngày | nhận: chuỗi `d/M/yyyy`, `dd/MM/yyyy`, `yyyy-MM-dd`, đối tượng `Date`, **số serial Excel** → xuất `dd/MM/yyyy` (zero-padded). Ngày không tồn tại (30/02) → giữ nguyên chuỗi gốc để validator báo lỗi, **không tự sửa** |
| Số serial Excel | gốc 1899-12-30 (xử lý đúng sai số 1900 leap-year); dùng UTC, **không** dùng giờ địa phương (tránh lệch 1 ngày) |
| `SOCMND_PASSPORT` | đọc là chuỗi; bỏ khoảng trắng bên trong và dấu `'` đầu. **Không tự bù số 0 đầu** (nếu ô Excel là số và đã mất số 0, người dùng phải sửa lại trên Excel; validator sẽ cảnh báo `GKSK_ID_INVALID`/`LOCAL_ID_CREATES_PERSON` tùy độ dài) |
| `NONGDOCON` | giữ nguyên chuỗi nhập; kiểm số bằng regex `^\d+([.,]\d+)?$` (rỗng là hợp lệ) |
| Enum | `GIOITINHVAL`: nhận thêm `Nam/Nữ/Nu/M/F` (không phân biệt hoa thường) → `0/1`. `KETLUAN`: nhận chữ hoa/thường, thay `–`/`—`/khoảng trắng quanh `-` về `-` |
| `STATE` | rỗng → `ADD` |
| `IDBENHVIEN`, `BENHVIEN` | luôn ghi đè bằng cấu hình server **sau khi** kiểm tra xung đột (Excel có `IDBENHVIEN` khác cấu hình → lỗi dòng `LOCAL_FACILITY_MISMATCH`, xem §5) |

## 4. Dựng XML (hàm `buildGkskXml` — S4)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<root>
  <SO>TEST.75001.1</SO>
  <NGAYKHAM>05/11/2026</NGAYKHAM>
  <HOTEN>TEST NGUYEN VAN A</HOTEN>
  <GIOITINHVAL>0</GIOITINHVAL>
  <NGAYSINH>21/05/1990</NGAYSINH>
  ... đủ 25 thẻ, đúng thứ tự §1 (# 1 → 25), kết thúc bằng ...
  <KETLUAN>A0-1</KETLUAN>
  <NGAYKHAMLAI></NGAYKHAMLAI>
  <LYDO></LYDO>
  <TINHTRANGBENH></TINHTRANGBENH>
  <STATE>ADD</STATE>
</root>
```
- Gốc `<root>`. Khai báo `<?xml version="1.0" encoding="UTF-8"?>`. **Không** BOM, **không** `DOCTYPE`, **không** comment, **không** `Signature`.
- Escape giá trị: `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, `"`→`&quot;`, `'`→`&apos;`.
- Thẻ rỗng ghi `<TAG></TAG>` (đã kiểm chứng và chốt ở S18; xem `docs/OPEN-QUESTIONS.md` Q2).
- Thụt 2 khoảng trắng, kết thúc dòng `\n`. Kích thước ≤ 1 MB (không bao giờ đạt với giấy thật, nhưng kiểm).
- Test round-trip: parse lại bằng `fast-xml-parser` ra đúng 25 giá trị đã chuẩn hóa, kể cả ký tự `& < > " '` và tiếng Việt có dấu.

## 5. Mẫu Excel, Import ghi đè thông minh & Xuất Excel đối soát (`S10`–`S11`)

### 5.1 Mẫu Excel (`GET /api/import/template`)
File `GKSK_mau_nhap_lieu.xlsx` do `exceljs` tạo, 2 sheet:

**Sheet `GKSK`** (dữ liệu)
- Dòng 1 = **tên thẻ** đúng như bảng §1 và **đúng thứ tự §1**, **trừ** `IDBENHVIEN`, `BENHVIEN` (app tự điền): 23 cột.
- Dòng 2 trở đi là dữ liệu. Toàn bộ cột định dạng **Text** (`numFmt '@'`) ít nhất 2000 dòng đầu, để Excel không đổi `079...` thành số và không đổi ngày.
- Sheet `GKSK` của file mẫu để **trống dữ liệu** (chỉ có dòng tiêu đề); ví dụ nằm ở sheet `HuongDan`. Import không có luật ngầm nào bỏ qua dòng theo nội dung `SO`.
- Freeze dòng 1; có Data Validation dạng danh sách cho `GIOITINHVAL` (0,1), `DVINONGDOCON` (0,1), `MATUY` (0,1), `KETLUAN` (A0-1,A0-2,A0-3), `STATE` (ADD,EDIT).

**Sheet `HuongDan`**: bảng 4 cột (Thẻ · Ý nghĩa · Bắt buộc (Sở / BHXH) · Định dạng & độ dài tối đa) lấy từ `FIELDS` (không gõ tay hai chỗ), kèm 1 dòng ví dụ giả cho mỗi cột.

### 5.2 Luật đọc và kiểm tra file Excel (`POST /api/import/excel`)
- Đọc sheet đầu tiên có tên `GKSK`; không có → sheet đầu tiên.
- Khớp cột theo **tên thẻ ở dòng 1**, không phân biệt hoa thường, bỏ khoảng trắng; thứ tự cột tùy ý. Chấp nhận **bí danh** `GIOITINH` → `GIOITINHVAL` (tên thẻ trong bảng BHXH); nếu có cả hai cột thì `GIOITINHVAL` thắng và báo cột `GIOITINH` bị bỏ qua. Thiếu cột bắt buộc (`SO`, `HOTEN`, `NGAYSINH`, `SOCMND_PASSPORT`, `KETLUAN`, `NGAYKETLUAN`) → từ chối cả file với thông báo liệt kê cột thiếu. Cột lạ → bỏ qua, liệt kê trong báo cáo (không phải lỗi).
- Dòng hoàn toàn trống → bỏ qua (không tính). Tối đa **1000 dòng dữ liệu** và **5 MB**; vượt → từ chối cả file.
- Ô công thức → lấy kết quả (`result`); ô rich-text → ghép văn bản; ô lỗi (`#N/A`…) → xem là rỗng và báo lỗi dòng.
- Cột `IDBENHVIEN` có mặt và khác cấu hình → dòng đó lỗi `LOCAL_FACILITY_MISMATCH` (không tự sửa). Trống hoặc bằng → bình thường.
- Đối chiếu từng dòng (có `SO` hợp lệ ≤ 30 ký tự) với DB hiện tại để gán `conflictMode` và trạng thái chọn mặc định (`defaultSelected`):
  1. **`new`** (`SO` chưa có trong DB): `defaultSelected = true` (kể cả dòng hợp lệ `ready` lẫn dòng có lỗi dữ liệu `invalid`, nhằm lưu đủ 100% dòng có `SO` vào danh sách đối soát).
  2. **`overwrite_pending`** (`SO` đã có trong DB ở trạng thái `invalid | ready | rejected | error`): kèm thông tin `LOCAL_SO_EXISTS`, `defaultSelected = true` (hỗ trợ người dùng sửa lỗi trên Excel rồi import đè lại).
  3. **`accepted_unchanged`** (`SO` đã `accepted` và `data_sha256` không đổi): kèm thông tin `LOCAL_SO_ACCEPTED_UNCHANGED`, `defaultSelected = false` (tự động bỏ qua các dòng đã đẩy thành công khi import lại cả file Excel).
  4. **`accepted_modified`** (`SO` đã `accepted` nhưng `data_sha256` thay đổi): kèm cảnh báo `LOCAL_SO_ACCEPTED_MODIFIED`, `defaultSelected = false` (người dùng có thể chủ động tick chọn nếu muốn ghi đè và chuyển về `ready`/`invalid` để đẩy bản cập nhật lên Sở).
  5. **`missing_so`** (`SO` trống hoặc > 30 ký tự, hoặc trùng `SO` ở dòng trước trong cùng file): dòng thiếu/quá dài `SO` thì `canCommit = false`, `defaultSelected = false` (bắt buộc sửa `SO` trên Excel); nếu trùng `SO` trong cùng file thì chỉ cho chọn dòng cuối cùng của `SO` đó.

### 5.3 Luật Lưu vào Danh sách đối soát (`POST /api/import/commit`)
- Lưu cả các dòng hợp lệ (`status = 'ready'`) và các dòng có lỗi dữ liệu chặn (`status = 'invalid'`, miễn là có `SO` hợp lệ ≤ 30 ký tự) đã được người dùng tick chọn vào bảng `gksk_certificates`, gắn với đợt import `gksk_import_batches`.
- Khi ghi đè một `SO` đã có trong DB: cập nhật `fields_json`, `data_sha256`, `status` (`ready` hoặc `invalid`), `batch_id`, `excel_row_number`, `updated_at`. Lịch sử `gksk_submissions` cũ của giấy đó vẫn được giữ lại để tra cứu.
- Không có hộp thoại sửa dòng lỗi trên web: mọi chỉnh sửa thực hiện trên file Excel rồi Import lại.

### 5.4 Xuất file Excel đối soát (`GET /api/certificates/export-excel`)
- File `GKSK_doi_soat_<YYYYMMDD_HHmmss>.xlsx` tạo bằng `exceljs` theo bộ lọc hiện tại trên màn hình Danh sách & Đối soát.
- Gồm **23 cột dữ liệu gốc** (đúng thứ tự và định dạng Text như file mẫu để người dùng có thể lọc dòng lỗi, sửa trực tiếp trên file này rồi đem Import lại ngay!) **cộng thêm 6 cột đối soát ở cuối**:
  1. `TRANG_THAI_DOI_SOAT` (`Đã đẩy thành công` / `Chờ đẩy cổng` / `Lỗi dữ liệu Excel` / `Cổng Sở từ chối` / `Lỗi mạng - Chờ gửi lại`)
  2. `DOT_IMPORT` (tên file Excel & số dòng)
  3. `THOI_GIAN_DAY` (thời gian gửi gần nhất, giờ VN)
  4. `MSG_ID` (`msg_id` lần gửi gần nhất)
  5. `CERTIFICATE_ID_SO` (`server_certificate_id` trên Hệ thống Sở)
  6. `CHI_TIET_LOI_CANH_BAO` (chuỗi tiếng Việt mô tả các lỗi/cảnh báo nếu có)
- Nhờ 6 cột đối soát được xem là "cột lạ" khi Import (theo §5.2: cột lạ bị bỏ qua, không báo lỗi), người dùng có thể dùng chính file Excel đối soát này để sửa các dòng bị lỗi/từ chối rồi Import ngược trở lại vào webapp mà không cần xóa 6 cột cuối!

## 6. Mẫu dữ liệu giả (dùng cho test — Agent không tự bịa dữ liệu thật)

| Trường | Giá trị mẫu |
|---|---|
| `SO` | `TEST.75001.1700000000.1` (dạng `TEST.<facility>.<mốc>.<stt>`) |
| `HOTEN` | `TEST NGUYEN VAN A` |
| `NGAYSINH` | `21/05/1990` |
| `GIOITINHVAL` | `0` |
| `SOCMND_PASSPORT` | `TESTGKSK01` (hộ chiếu giả → không tạo người) |
| `NGAYKHAM` / `NGAYKETLUAN` | `05/11/2026` / `06/11/2026` |
| `NONGDOCON` / `DVINONGDOCON` / `MATUY` | `0` / `0` / `0` |
| `KETLUAN` | `A0-1` |
| `HANGBANGLAI` | `B` |
| `BACSYKETLUAN` | `TEST BAC SI` |
| `IDBENHVIEN` / `BENHVIEN` | từ cấu hình (test: `75001` / `Benh vien Thu`) |
| `STATE` | `ADD` |
