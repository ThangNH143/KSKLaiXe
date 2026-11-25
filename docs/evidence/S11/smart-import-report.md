# Báo cáo Kiểm chứng Bước S11 — Mẫu Excel & Import Ghi đè Thông minh (`smart-import-report.md`)

- **Thời gian thực thi**: `2026-11-25T01:49:20.335Z`
- **Kho dữ liệu**: `InMemoryRepositories` (tuân thủ quy tắc bảo vệ MSSQL đang vận hành).
- **File mẫu thực tế đã sinh**: `docs/evidence/S11/GKSK_mau_nhap_lieu.xlsx` (95696 bytes)
- **Bộ fixtures kiểm thử đã sinh**: **19 file** tại `tests/fixtures/*.xlsx` theo đúng `docs/TEST-PLAN.md §2.1`.
- **Kiểm toán Log Pino (4 dòng)**: **0 rò rỉ PII** (không chứa họ tên, CCCD, dữ liệu ô Excel).

---

## 1. Kiểm định File Mẫu `docs/evidence/S11/GKSK_mau_nhap_lieu.xlsx`

- **Sheet 1 — `GKSK`**:
  - Số cột: **23 cột** theo đúng thứ tự bảng BHXH (trừ `IDBENHVIEN`, `BENHVIEN` do server tự điền): `SO, NGAYKHAM, HOTEN, GIOITINHVAL, NGAYSINH, DIACHITHUONGTRU, MATINH_THUONGTRU, MAHUYEN_THUONGTRU, MAXA_THUONGTRU, SOCMND_PASSPORT, NGAYTHANGNAMCAP, NOICAP, HANGBANGLAI, NGAYKETLUAN, NONGDOCON, DVINONGDOCON, MATUY, BACSYKETLUAN, KETLUAN, NGAYKHAMLAI, LYDO, TINHTRANGBENH, STATE`.
  - Định dạng ô: `numFmt = "@"` (Text) áp dụng cho toàn bộ **23 cột × 2000 dòng dữ liệu đầu** (dòng `2..2001`) để giữ số `0` đầu của CCCD và không tự đổi ngày.
  - Đóng băng tiêu đề: Freeze dòng 1 (`state = "frozen", ySplit = 1`), để trống dữ liệu từ dòng 2.
  - Dropdown Data Validation: `GIOITINHVAL` (`0,1`), `DVINONGDOCON` (`0,1`), `MATUY` (`0,1`), `KETLUAN` (`A0-1,A0-2,A0-3`), `STATE` (`ADD,EDIT`).
- **Sheet 2 — `HuongDan`**:
  - Sinh tự động từ hằng số `FIELDS` (**25 trường**), gồm 5 cột: `Thẻ`, `Ý nghĩa`, `Bắt buộc (Sở / BHXH)`, `Định dạng & độ dài tối đa`, `Ví dụ giả (chỉ dùng thử nghiệm)`.

---

## 2. Mô phỏng Luồng Nghiệp vụ Khép kín: Import Lần 1 → Đẩy cổng → Xuất Excel Đối soát (29 cột) → Sửa lỗi trên File Đối soát → Import Ghi đè Thông minh Lần 2

### 2.1. Kết quả Import Lần 1 (`DS_KSK_Dot1.xlsx` — 5 dòng mới)

| Dòng Excel | Mã `SO` | Trạng thái dữ liệu (`status`) | `conflictMode` | `defaultSelected` | Trạng thái sau khi Đẩy cổng (trước Lần 2) |
|---:|---|---|:---:|:---:|---|
| 2 | `TEST.75001.S11.01` | `ready` (✅ Hợp lệ) | `new` | `true` | `accepted` (Đã đẩy thành công — `CERT-S11-0001`) |
| 3 | `TEST.75001.S11.02` | `ready` (✅ Hợp lệ) | `new` | `true` | `accepted` (Đã đẩy thành công — `CERT-S11-0002`) |
| 4 | `TEST.75001.S11.03` | `ready` (✅ Hợp lệ) | `new` | `true` | `ready` (Chờ đẩy cổng) |
| 5 | `TEST.75001.S11.04` | `invalid` (⛔ Sai ngày sinh `31/02/1990`) | `new` | `true` *(lưu để đối soát 100% quân số)* | `invalid` (Lỗi dữ liệu Excel) |
| 6 | `TEST.75001.S11.05` | `ready` (✅ Hợp lệ) | `new` | `true` | `rejected` (Cổng Sở từ chối) |

### 2.2. Xuất File Excel Đối soát 29 cột & Sửa lỗi trực tiếp trên File Đối soát

- Gọi `GET /api/certificates/export-excel` → nhận file `.xlsx` 29 cột (23 cột gốc + 6 cột đối soát).
- Người dùng mở chính file Excel đối soát 29 cột này, thực hiện:
  1. Sửa `NGAYSINH` của hồ sơ lỗi `TEST.75001.S11.04` từ `31/02/1990` → `15/08/1992`.
  2. Sửa `KETLUAN` của hồ sơ bị từ chối `TEST.75001.S11.05` từ `A0-2` → `A0-1`.
  3. Thử sửa `HOTEN` của hồ sơ đã đẩy thành công `TEST.75001.S11.02` thành `TEST TRAN THI HAI (DA SUA)`.
  4. Thêm 1 dòng mới `TEST.75001.S11.06` ở cuối bảng.
- Đem nguyên file đối soát 29 cột vừa sửa nạp lại vào `POST /api/import/excel`:
  - **6 cột đối soát cuối tự động được bỏ qua (`ignoredColumns`)**: `TRANG_THAI_DOI_SOAT, DOT_IMPORT, THOI_GIAN_DAY, MSG_ID, CERTIFICATE_ID_SO, CHI_TIET_LOI_CANH_BAO`.

### 2.3. Bảng Đối chiếu `conflictMode` & `defaultSelected` của Từng Dòng ở Lần Import Thứ 2

| Dòng Excel | Mã `SO` | Trạng thái cũ trong DB | Trạng thái dữ liệu mới | `conflictMode` | `defaultSelected` | Mã thông báo đối chiếu (`issues`) |
|---:|---|---|---|---|---|---|
| 2 | `TEST.75001.S11.05` | `rejected` | `ready` | **`overwrite_pending`** | `true` | `LOCAL_SO_EXISTS` |
| 3 | `TEST.75001.S11.04` | `invalid` | `ready` | **`overwrite_pending`** | `true` | `LOCAL_SO_EXISTS` |
| 4 | `TEST.75001.S11.03` | `ready` | `ready` | **`overwrite_pending`** | `true` | `LOCAL_SO_EXISTS` |
| 5 | `TEST.75001.S11.02` | `accepted` | `ready` | **`accepted_modified`** | `false` | `LOCAL_SO_ACCEPTED_MODIFIED` |
| 6 | `TEST.75001.S11.01` | `accepted` | `ready` | **`accepted_unchanged`** | `false` | `LOCAL_SO_ACCEPTED_UNCHANGED` |
| 7 | `TEST.75001.S11.06` | `(chưa có)` | `ready` | **`new`** | `true` | `-` |

### 2.4. JSON `summary` của Bản Xem trước Lần 2 (`POST /api/import/excel`)

```json
{
  "totalRows": 6,
  "readyCount": 6,
  "invalidCount": 0,
  "newCount": 1,
  "overwritePendingCount": 3,
  "acceptedUnchangedCount": 1,
  "acceptedModifiedCount": 1,
  "missingSoCount": 0,
  "defaultSelectedCount": 4
}
```

### 2.5. Kết quả Lưu vào Danh sách Đối soát Lần 2 (`POST /api/import/commit`)

```json
{
  "batch": {
    "id": 2,
    "filename": "GKSK_doi_soat_da_sua.xlsx",
    "rowCount": 4,
    "createdAt": "2026-11-23T04:00:00.000Z"
  },
  "totalCommitted": 4,
  "inserted": 1,
  "updated": 3,
  "readyCount": 4,
  "invalidCount": 0,
  "skippedCount": 2,
  "finalDbCounts": {
    "all": 6,
    "unsent": 4,
    "accepted": 2,
    "attention": 0,
    "ready": 4,
    "invalid": 0,
    "rejected": 0,
    "error": 0,
    "sending": 0
  }
}
```
