# Báo cáo kiểm chứng Bước S2 — Đặc tả 25 trường BHXH & Bảng mã thông điệp tiếng Việt

- **Thời điểm sinh báo cáo:** `2026-11-23T10:07:37.589Z`
- **Nguồn đối chiếu:** `docs/DATA-SPEC.md` (§1, §2), `docs/API-CONTRACT.md` (§9, §10), `docs/reference/gksk_mau_ky_so_root.xml`

## 1. Tóm tắt kiểm chứng tự động

| Hạng mục | Kỳ vọng | Thực tế | Trạng thái |
|---|---|---|---|
| Tổng số thẻ dữ liệu | 25 thẻ (thứ tự BHXH) | 25 thẻ (`SO` → `STATE`) | ✅ PASS |
| Đối chiếu tập thẻ với `gksk_mau_ky_so_root.xml` | Khớp 25/25 thẻ dữ liệu (trừ `UUID`, `STATUS`, `Signature`) | Khớp 25/25 (0 thiếu, 0 thừa) | ✅ PASS |
| Thẻ BHXH cho phép null (`bhxhRequired=false`) | 3 thẻ (`NGAYKHAMLAI`, `LYDO`, `TINHTRANGBENH`) | 3 thẻ (`NGAYKHAMLAI`, `LYDO`, `TINHTRANGBENH`) | ✅ PASS |
| Thẻ Sở bắt buộc (`soRequired=true`) | 7 thẻ | 7 thẻ (`SO`, `HOTEN`, `NGAYSINH`, `SOCMND_PASSPORT`, `IDBENHVIEN`, `NGAYKETLUAN`, `KETLUAN`) | ✅ PASS |
| Thẻ nhạy cảm (`SENSITIVE_TAGS`) | 4 thẻ (`NONGDOCON`, `MATUY`, `LYDO`, `TINHTRANGBENH`) | 4 thẻ (`NONGDOCON`, `MATUY`, `LYDO`, `TINHTRANGBENH`) | ✅ PASS |
| Số cột trong mẫu Excel (`inTemplate=true`) | 23 cột (trừ `IDBENHVIEN`, `BENHVIEN`) | 23 cột (6 cột bắt buộc) | ✅ PASS |
| Tổng số mã lỗi/cảnh báo/thông tin | 36 mã (9 §9 + 14 §10 + 13 `LOCAL_*`) | 36 mã (100% có tiếng Việt có dấu) | ✅ PASS |

## 2. Bảng đối chiếu 25 trường theo thứ tự BHXH (`packages/shared/src/fields.ts`)

| STT | Tag | Nhãn tiếng Việt | Kiểu | MaxLength | BHXH bắt buộc | Sở bắt buộc | Có trong mẫu Excel | Chỉ đọc | Nhạy cảm | Enum / Bí danh Excel |
|---:|---|---|---|---:|:---:|:---:|:---:|:---:|:---:|---|
| 1 | `SO` | Số giấy | `text` | 20 (Sở ≤ 30) | ✔ | **Có** | ✔ | — | — | — |
| 2 | `NGAYKHAM` | Ngày khám | `date` | 10 | ✔ | Không | ✔ | — | — | — |
| 3 | `HOTEN` | Họ tên | `text` | 255 | ✔ | **Có** | ✔ | — | — | — |
| 4 | `GIOITINHVAL` | Giới tính | `enum` | 20 | ✔ | Không | ✔ | — | — | Enum: `0`, `1` · Alias: `GIOITINH` |
| 5 | `NGAYSINH` | Ngày sinh | `date` | 10 | ✔ | **Có** | ✔ | — | — | — |
| 6 | `DIACHITHUONGTRU` | Địa chỉ thường trú | `text` | 255 | ✔ | Không | ✔ | — | — | — |
| 7 | `MATINH_THUONGTRU` | Mã tỉnh thường trú | `text` | 10 | ✔ | Không | ✔ | — | — | — |
| 8 | `MAHUYEN_THUONGTRU` | Mã huyện thường trú | `text` | 10 | ✔ | Không | ✔ | — | — | — |
| 9 | `MAXA_THUONGTRU` | Mã xã thường trú | `text` | 10 | ✔ | Không | ✔ | — | — | — |
| 10 | `SOCMND_PASSPORT` | Số CMND/CCCD/hộ chiếu | `text` | 12 | ✔ | **Có** | ✔ | — | — | — |
| 11 | `NGAYTHANGNAMCAP` | Ngày cấp giấy tờ | `date` | 10 | ✔ | Không | ✔ | — | — | — |
| 12 | `NOICAP` | Nơi cấp | `text` | 30 | ✔ | Không | ✔ | — | — | — |
| 13 | `HANGBANGLAI` | Hạng bằng lái | `text` | 10 | ✔ | Không | ✔ | — | — | — |
| 14 | `IDBENHVIEN` | Mã CSYT | `text` | 255 | ✔ | **Có** | — | ✔ | — | — |
| 15 | `BENHVIEN` | Tên CSYT | `text` | 255 | ✔ | Không | — | ✔ | — | — |
| 16 | `NGAYKETLUAN` | Ngày kết luận | `date` | 10 | ✔ | **Có** | ✔ | — | — | — |
| 17 | `NONGDOCON` | Nồng độ cồn | `number` | — | ✔ | Không | ✔ | — | **Có** | — |
| 18 | `DVINONGDOCON` | Đơn vị nồng độ cồn | `enum` | 1 | ✔ | Không | ✔ | — | — | Enum: `0`, `1` |
| 19 | `MATUY` | Kết quả xét nghiệm ma túy | `enum` | 1 | ✔ | Không | ✔ | — | **Có** | Enum: `0`, `1` |
| 20 | `BACSYKETLUAN` | Bác sĩ kết luận | `text` | 255 | ✔ | Không | ✔ | — | — | — |
| 21 | `KETLUAN` | Kết luận | `enum` | 10 | ✔ | **Có** | ✔ | — | — | Enum: `A0-1`, `A0-2`, `A0-3` |
| 22 | `NGAYKHAMLAI` | Ngày khám lại | `date` | 10 | — | Không | ✔ | — | — | — |
| 23 | `LYDO` | Lý do sức khỏe không đạt | `text` | 255 | — | Không | ✔ | — | **Có** | — |
| 24 | `TINHTRANGBENH` | Tình trạng bệnh tật hiện tại | `text` | 255 | — | Không | ✔ | — | **Có** | — |
| 25 | `STATE` | Trạng thái giấy | `enum` | 5 | ✔ | Không | ✔ | — | — | Enum: `ADD`, `EDIT` |

## 3. Bảng toàn bộ mã lỗi / cảnh báo / thông tin tiếng Việt (`packages/shared/src/messages.ts`)

### 3.1. Mã từ chối giấy từ Hệ thống Sở — `API-CONTRACT.md §9` (9 mã)

| STT | Mã | Thông điệp tiếng Việt |
|---:|---|---|
| 1 | `GKSK_XML_INVALID` | Nội dung XML/JSON không hợp lệ (sai cú pháp, chứa DOCTYPE, vượt quá 1 MB hoặc thiếu thẻ SO). |
| 2 | `GKSK_SO_MISSING` | Thiếu số giấy khám sức khỏe (SO). |
| 3 | `GKSK_SO_TOO_LONG` | Số giấy khám sức khỏe (SO) vượt quá 30 ký tự. |
| 4 | `GKSK_FACILITY_MISMATCH` | Mã cơ sở y tế (IDBENHVIEN) trống hoặc không khớp với tài khoản CSYT. |
| 5 | `GKSK_HOTEN_INVALID` | Họ tên (HOTEN) bị trống hoặc vượt quá 255 ký tự. |
| 6 | `GKSK_ID_MISSING` | Thiếu số CMND/CCCD/hộ chiếu (SOCMND_PASSPORT). |
| 7 | `GKSK_NGAYSINH_INVALID` | Ngày sinh (NGAYSINH) không đúng định dạng dd/MM/yyyy hoặc năm sinh nằm ngoài khoảng 1900 đến năm hiện tại. |
| 8 | `GKSK_NGAYKETLUAN_INVALID` | Ngày kết luận (NGAYKETLUAN) không đúng định dạng ngày dd/MM/yyyy hợp lệ. |
| 9 | `GKSK_KETLUAN_MISSING` | Thiếu kết luận khám sức khỏe (KETLUAN). |

### 3.2. Mã cảnh báo từ Hệ thống Sở — `API-CONTRACT.md §10` (14 mã)

| STT | Mã | Thông điệp tiếng Việt |
|---:|---|---|
| 1 | `GKSK_UNSIGNED` | Giấy chưa có chữ ký số (bình thường ở phiên bản hiện tại, giấy vẫn được lưu). |
| 2 | `GKSK_SIGNATURE_INVALID` | Chữ ký số trên giấy không hợp lệ hoặc không khớp nội dung. |
| 3 | `GKSK_SIGNED_DATA_MISMATCH` | Dữ liệu JSON không khớp với nội dung đã ký (SIGNDATA). |
| 4 | `GKSK_UNKNOWN_TAG` | Gói tin chứa thẻ không thuộc đặc tả PL2 CV 3829 (hệ thống Sở đã bỏ qua thẻ này). |
| 5 | `GKSK_ID_INVALID` | Số giấy tờ (SOCMND_PASSPORT) không đúng chuẩn CMND/CCCD (toàn số 0 hoặc 10/11 chữ số) — giấy vẫn lưu nhưng không tự gắn người. |
| 6 | `GKSK_KETLUAN_UNKNOWN` | Mã kết luận (KETLUAN) nằm ngoài danh mục chuẩn (A0-1, A0-2, A0-3). |
| 7 | `GKSK_GIOITINH_UNKNOWN` | Mã giới tính (GIOITINHVAL) không hợp lệ (chỉ nhận 0 = Nam, 1 = Nữ). |
| 8 | `GKSK_NONGDOCON_INVALID` | Giá trị nồng độ cồn (NONGDOCON) không phải số hợp lệ. |
| 9 | `GKSK_DVINONGDOCON_INVALID` | Đơn vị nồng độ cồn (DVINONGDOCON) không hợp lệ (chỉ nhận 0 hoặc 1). |
| 10 | `GKSK_MATUY_INVALID` | Kết quả xét nghiệm ma túy (MATUY) không hợp lệ (chỉ nhận 0 hoặc 1). |
| 11 | `GKSK_DATE_INVALID` | Ngày khám, ngày cấp giấy tờ hoặc ngày khám lại không đúng định dạng dd/MM/yyyy (hệ thống Sở lưu trống). |
| 12 | `GKSK_FIELD_TOO_LONG` | Giá trị trường vượt quá độ dài tối đa theo bảng đặc tả BHXH (hệ thống Sở vẫn lưu nguyên giá trị). |
| 13 | `GKSK_STATE_ADD_EXISTS` | Trạng thái là ADD nhưng số giấy đã tồn tại trên hệ thống Sở — đã tự động ghi đè giấy cũ. |
| 14 | `GKSK_SKIPPED_STALE` | Hệ thống Sở đã có bản ghi mới hơn nên bản gửi này không ghi đè dữ liệu hiện có. |

### 3.3. Mã kiểm tra cục bộ (`LOCAL_*`) — `DATA-SPEC.md §2` (13 mã)

| STT | Mã | Thông điệp tiếng Việt |
|---:|---|---|
| 1 | `LOCAL_FIELD_OVER_SPEC` | Giá trị vượt quá độ dài tối đa theo bảng BHXH (hệ thống Sở sẽ trả cảnh báo nhưng vẫn lưu). |
| 2 | `LOCAL_SO_OVER_20` | Số giấy (SO) dài 21–30 ký tự (vượt giới hạn 20 của bảng BHXH nhưng hệ thống Sở vẫn chấp nhận tối đa 30 ký tự). |
| 3 | `LOCAL_SO_FORMAT` | Số giấy (SO) không theo mẫu chuẩn BHXH (NNNNN/GKSKLX/<mã CSYT>/<YY>); bình thường nếu là giấy thử nghiệm. |
| 4 | `LOCAL_BHXH_REQUIRED_EMPTY` | Một số trường bắt buộc theo bảng BHXH đang để trống (hệ thống Sở không chặn nhưng nên bổ sung đầy đủ). |
| 5 | `LOCAL_NGAYSINH_FUTURE` | Ngày sinh lớn hơn ngày hiện tại (hệ thống Sở vẫn có thể nhận nếu cùng năm nhưng sẽ không tạo hồ sơ người). |
| 6 | `LOCAL_KETLUAN_A03_NO_RECHECK` | Kết luận là A0-3 (đạt tiêu chuẩn, yêu cầu khám lại) nhưng đang để trống ngày khám lại (NGAYKHAMLAI). |
| 7 | `LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM` | Ngày kết luận (NGAYKETLUAN) sớm hơn ngày khám (NGAYKHAM). |
| 8 | `LOCAL_ID_CREATES_PERSON` | Số giấy tờ có 9 hoặc 12 chữ số (CMND/CCCD) — khi đẩy lên Sở sẽ tạo hồ sơ người mới nếu chưa tồn tại. |
| 9 | `LOCAL_SO_DUPLICATE_IN_BATCH` | Trùng số giấy (SO) trong cùng file Excel (khi lưu chỉ lấy dòng xuất hiện sau cùng). |
| 10 | `LOCAL_SO_EXISTS` | Số giấy (SO) đã có trong danh sách nội bộ ở trạng thái chưa đẩy/lỗi — mặc định chọn để ghi đè bản sửa mới. |
| 11 | `LOCAL_SO_ACCEPTED_UNCHANGED` | Số giấy (SO) đã đẩy thành công lên Sở và dữ liệu không thay đổi — mặc định bỏ chọn để tránh đẩy lại. |
| 12 | `LOCAL_SO_ACCEPTED_MODIFIED` | Số giấy (SO) đã đẩy thành công lên Sở nhưng dữ liệu trong file Excel đã thay đổi — mặc định bỏ chọn, hãy kiểm tra kỹ trước khi chọn ghi đè. |
| 13 | `LOCAL_FACILITY_MISMATCH` | Cột IDBENHVIEN trong file Excel không khớp với mã CSYT cấu hình trên máy chủ (lỗi chặn). |
