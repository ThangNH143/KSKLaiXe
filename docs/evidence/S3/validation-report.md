# Báo cáo Kiểm chứng Bước S3 — Chuẩn hóa (`normalize.ts`) & Kiểm tra dữ liệu (`validate.ts`)

- **Thời điểm kiểm chứng**: `2026-11-23T10:25:32.429Z`
- **Bối cảnh kiểm thử cố định**: `facilityId = "75001"`, `today = "2026-11-23"`
- **Tổng số test trong `@gksk/shared`**: **145 tests PASS** (5 test files, gồm **72 ca ma trận data-driven** trong `validate.test.ts` và **47 ca** trong `normalize.test.ts`)
- **Độ phủ mã nguồn `packages/shared` (v8 coverage)**:
  - Lines: **100%** (1044/1044) — Yêu cầu ≥ 95%
  - Statements: **100%** (1044/1044)
  - Branches: **100%** (187/187)
  - Functions: **100%** (21/21)
- **Kiểm chứng đa múi giờ (`TZ`)**:
  - `TZ=Asia/Ho_Chi_Minh`: **PASS (exit code 0, 145/145 tests)**
  - `TZ=America/Los_Angeles`: **PASS (exit code 0, 145/145 tests)**

---

## 1. Kết quả kiểm chứng Chuẩn hóa dữ liệu (`normalizeRecord` — DATA-SPEC.md §3)

| # | Kịch bản chuẩn hóa | Trường | Giá trị đầu vào (Raw) | Giá trị sau chuẩn hóa | Kết quả |
|---|---|---|---|---|---|
| 1 | Chuẩn hóa Unicode NFD -> NFC, trim & xóa ký tự điều khiển XML 1.0 (\x00, \x07, \uFFFE) | `HOTEN` | `"  Nguye\u0302\u0303n Va\u0306n A\x00\x07\uFFFE  "` | `"Nguyễn Văn A"` | ✔ PASS |
| 2 | Serial ngày Excel 33014 (gốc 1899-12-30 UTC) | `NGAYSINH` | `33014 (number)` | `"21/05/1990"` | ✔ PASS |
| 3 | Serial ngày Excel 46332 (gốc 1899-12-30 UTC) | `NGAYKETLUAN` | `46332 (number)` | `"06/11/2026"` | ✔ PASS |
| 4 | Serial ngày Excel năm nhuận 45351 (gốc 1899-12-30 UTC) | `NGAYSINH` | `45351 (number)` | `"29/02/2024"` | ✔ PASS |
| 5 | Chuỗi ngày d/M/yyyy ("21/5/1990") -> dd/MM/yyyy zero-padded | `NGAYSINH` | `"21/5/1990"` | `"21/05/1990"` | ✔ PASS |
| 6 | Chuỗi ngày ISO yyyy-MM-dd ("1990-05-21") -> dd/MM/yyyy | `NGAYSINH` | `"1990-05-21"` | `"21/05/1990"` | ✔ PASS |
| 7 | Ngày không tồn tại ("29/02/2025") -> giữ nguyên chuỗi gốc để validator bắt lỗi | `NGAYSINH` | `"29/02/2025"` | `"29/02/2025"` | ✔ PASS |
| 8 | CCCD có số 0 đầu và dấu nháy đơn Excel ("'079 000 012 345") | `SOCMND_PASSPORT` | `"'079 000 012 345"` | `"079000012345"` | ✔ PASS |
| 9 | Giới tính qua bí danh cột GIOITINH ("Nữ") -> GIOITINHVAL="1" | `GIOITINHVAL` | `{ GIOITINH: "Nữ" }` | `"1"` | ✔ PASS |
| 10 | Kết luận chữ thường + gạch dài en-dash ("a0 – 2") -> "A0-2" | `KETLUAN` | `"a0 – 2"` | `"A0-2"` | ✔ PASS |
| 11 | STATE để trống -> mặc định "ADD" | `STATE` | `""` | `"ADD"` | ✔ PASS |

---

## 2. Kết quả kiểm tra 4 Hồ sơ tổng hợp điển hình (`validateRecord`)

### 1. Hồ sơ thử nghiệm chuẩn (DATA-SPEC §6 — Hợp lệ, sẵn sàng đẩy cổng)
- **Có lỗi chặn (`hasBlockingErrors`)**: `false` (✅ Cho phép đẩy cổng (`status = ready`))
- **Giá trị sau chuẩn hóa tiêu biểu**: `SO="TEST.75001.1700000000.1"`, `NGAYSINH="21/05/1990"`, `GIOITINHVAL="0"`, `SOCMND_PASSPORT="TESTGKSK01"`, `KETLUAN="A0-1"`, `STATE="ADD"`
- **Danh sách `Issue[]` (2)**:
  - `[INFO | local]` **`LOCAL_SO_OVER_20`** (field=SO): [Số giấy (SO)] Số giấy (SO) dài 21–30 ký tự (vượt giới hạn 20 của bảng BHXH nhưng hệ thống Sở vẫn chấp nhận tối đa 30 ký tự).
  - `[INFO | local]` **`LOCAL_SO_FORMAT`** (field=SO): [Số giấy (SO)] Số giấy (SO) không theo mẫu chuẩn BHXH (NNNNN/GKSKLX/<mã CSYT>/<YY>); bình thường nếu là giấy thử nghiệm.

### 2. Hồ sơ số giấy chuẩn BHXH + CCCD 12 số có số 0 đầu (Cảnh báo tạo người mới)
- **Có lỗi chặn (`hasBlockingErrors`)**: `false` (✅ Cho phép đẩy cổng (`status = ready`))
- **Giá trị sau chuẩn hóa tiêu biểu**: `SO="00001/GKSKLX/75001/26"`, `NGAYSINH="21/05/1990"`, `GIOITINHVAL="0"`, `SOCMND_PASSPORT="079000012345"`, `KETLUAN="A0-1"`, `STATE="ADD"`
- **Danh sách `Issue[]` (2)**:
  - `[INFO | local]` **`LOCAL_SO_OVER_20`** (field=SO): [Số giấy (SO)] Số giấy (SO) dài 21–30 ký tự (vượt giới hạn 20 của bảng BHXH nhưng hệ thống Sở vẫn chấp nhận tối đa 30 ký tự).
  - `[WARNING | local]` **`LOCAL_ID_CREATES_PERSON`** (field=SOCMND_PASSPORT): [Số CMND/CCCD/hộ chiếu (SOCMND_PASSPORT)] Số giấy tờ có 9 hoặc 12 chữ số (CMND/CCCD) — khi đẩy lên Sở sẽ tạo hồ sơ người mới nếu chưa tồn tại.

### 3. Hồ sơ có lỗi chặn (SO > 30 ký tự, ngày sinh 29/02/2025 không nhuận, thiếu KETLUAN)
- **Có lỗi chặn (`hasBlockingErrors`)**: `true` (⛔ Chặn đẩy cổng (`status = invalid`))
- **Giá trị sau chuẩn hóa tiêu biểu**: `SO="TEST.75001.SO.QUA.DAI.TREN.30.KY.TU"`, `NGAYSINH="29/02/2025"`, `GIOITINHVAL="0"`, `SOCMND_PASSPORT="TESTGKSK01"`, `KETLUAN=""`, `STATE="ADD"`
- **Danh sách `Issue[]` (4)**:
  - `[ERROR | server-mirror]` **`GKSK_SO_TOO_LONG`** (field=SO): [Số giấy (SO)] Số giấy khám sức khỏe (SO) vượt quá 30 ký tự.
  - `[ERROR | server-mirror]` **`GKSK_NGAYSINH_INVALID`** (field=NGAYSINH): [Ngày sinh (NGAYSINH)] Ngày sinh (NGAYSINH) không đúng định dạng dd/MM/yyyy hoặc năm sinh nằm ngoài khoảng 1900 đến năm hiện tại.
  - `[ERROR | server-mirror]` **`GKSK_KETLUAN_MISSING`** (field=KETLUAN): [Kết luận (KETLUAN)] Thiếu kết luận khám sức khỏe (KETLUAN).
  - `[INFO | local]` **`LOCAL_SO_FORMAT`** (field=SO): [Số giấy (SO)] Số giấy (SO) không theo mẫu chuẩn BHXH (NNNNN/GKSKLX/<mã CSYT>/<YY>); bình thường nếu là giấy thử nghiệm.

### 4. Hồ sơ vượt độ dài BHXH (NOICAP 31 ký tự), A0-3 thiếu ngày khám lại & gộp trường BHXH trống
- **Có lỗi chặn (`hasBlockingErrors`)**: `false` (✅ Cho phép đẩy cổng (`status = ready`))
- **Giá trị sau chuẩn hóa tiêu biểu**: `SO="00001/GKSKLX/75001/26"`, `NGAYSINH="21/05/1990"`, `GIOITINHVAL="0"`, `SOCMND_PASSPORT="TESTGKSK01"`, `KETLUAN="A0-3"`, `STATE="ADD"`
- **Danh sách `Issue[]` (4)**:
  - `[WARNING | local]` **`LOCAL_FIELD_OVER_SPEC`** (field=NOICAP): [Nơi cấp (NOICAP)] Giá trị vượt quá độ dài tối đa theo bảng BHXH (hệ thống Sở sẽ trả cảnh báo nhưng vẫn lưu).
  - `[INFO | local]` **`LOCAL_SO_OVER_20`** (field=SO): [Số giấy (SO)] Số giấy (SO) dài 21–30 ký tự (vượt giới hạn 20 của bảng BHXH nhưng hệ thống Sở vẫn chấp nhận tối đa 30 ký tự).
  - `[INFO | local]` **`LOCAL_BHXH_REQUIRED_EMPTY`** (fields=[DIACHITHUONGTRU, BACSYKETLUAN]): Một số trường bắt buộc theo bảng BHXH đang để trống (hệ thống Sở không chặn nhưng nên bổ sung đầy đủ). Các thẻ trống: DIACHITHUONGTRU, BACSYKETLUAN.
  - `[WARNING | local]` **`LOCAL_KETLUAN_A03_NO_RECHECK`** (field=NGAYKHAMLAI): [Ngày khám lại (NGAYKHAMLAI)] Kết luận là A0-3 (đạt tiêu chuẩn, yêu cầu khám lại) nhưng đang để trống ngày khám lại (NGAYKHAMLAI).

---

## 3. Bảng đối chiếu Ma trận Kích hoạt & Sát biên (`TEST-PLAN.md §3.1` — 23 mã quy tắc)

| STT | Mã quy tắc | Ca kích hoạt (Trigger) | Ca sát biên (Không kích hoạt) | Lỗi chặn khi kích hoạt | Kết quả |
|---|---|---|---|---|---|
| 1 | `GKSK_SO_MISSING` | SO="" | SO="A" (1 ký tự) | `true` | ✔ PASS |
| 2 | `GKSK_SO_TOO_LONG` | SO dài 31 ký tự | SO dài 30 ký tự (chỉ báo LOCAL_SO_OVER_20 info) | `true` | ✔ PASS |
| 3 | `GKSK_HOTEN_INVALID` | HOTEN="" hoặc 256 ký tự | HOTEN đúng 255 ký tự | `true` | ✔ PASS |
| 4 | `GKSK_ID_MISSING` | SOCMND_PASSPORT="" | SOCMND_PASSPORT="TESTGKSK01" | `true` | ✔ PASS |
| 5 | `GKSK_NGAYSINH_INVALID` | NGAYSINH="31/02/1990" (hoặc "01/01/1899", "29/02/2025", năm 2027) | NGAYSINH="01/01/1900" (hoặc "29/02/2024", hôm nay "23/11/2026") | `true` | ✔ PASS |
| 6 | `GKSK_NGAYKETLUAN_INVALID` | NGAYKETLUAN="32/01/2026" | NGAYKETLUAN="06/11/2026" | `true` | ✔ PASS |
| 7 | `GKSK_KETLUAN_MISSING` | KETLUAN="" | KETLUAN="A0-1" | `true` | ✔ PASS |
| 8 | `GKSK_FACILITY_MISMATCH` | IDBENHVIEN="75999" (khác 75001) | IDBENHVIEN="75001" | `true` | ✔ PASS |
| 9 | `GKSK_KETLUAN_UNKNOWN` | KETLUAN="A0-4" | KETLUAN="A0-1" | `false` | ✔ PASS |
| 10 | `GKSK_GIOITINH_UNKNOWN` | GIOITINHVAL="2" | GIOITINHVAL="0" (hoặc "1", "") | `false` | ✔ PASS |
| 11 | `GKSK_NONGDOCON_INVALID` | NONGDOCON="abc" | NONGDOCON="0,25" (hoặc "0.25", "0", "") | `false` | ✔ PASS |
| 12 | `GKSK_DVINONGDOCON_INVALID` | DVINONGDOCON="2" | DVINONGDOCON="1" | `false` | ✔ PASS |
| 13 | `GKSK_MATUY_INVALID` | MATUY="2" | MATUY="0" | `false` | ✔ PASS |
| 14 | `GKSK_DATE_INVALID` | NGAYKHAM="abc" (hoặc "31/04/2026") | NGAYKHAM="" (trống không cảnh báo GKSK_DATE_INVALID) | `false` | ✔ PASS |
| 15 | `GKSK_ID_INVALID` | SOCMND_PASSPORT="000000000000" (hoặc 10/11 chữ số) | SOCMND_PASSPORT="079000012345" (12 số) hoặc "012345678" (9 số) | `false` | ✔ PASS |
| 16 | `LOCAL_FIELD_OVER_SPEC` | NOICAP dài 31 ký tự (Max=30) | NOICAP đúng 30 ký tự | `false` | ✔ PASS |
| 17 | `LOCAL_SO_OVER_20` | SO dài 21 ký tự ("00001/GKSKLX/75001/26") | SO dài 20 ký tự | `false` | ✔ PASS |
| 18 | `LOCAL_SO_FORMAT` | SO="TEST.75001.1" | SO="00001/GKSKLX/75001/26" | `false` | ✔ PASS |
| 19 | `LOCAL_BHXH_REQUIRED_EMPTY` | DIACHITHUONGTRU="" & NGAYKHAM="" (gộp đúng 1 dòng) | NGAYKHAMLAI="", LYDO="", TINHTRANGBENH="" (3 thẻ cho phép null) | `false` | ✔ PASS |
| 20 | `LOCAL_NGAYSINH_FUTURE` | NGAYSINH="24/11/2026" (sau today 2026-11-23 trong cùng năm) | NGAYSINH="23/11/2026" (đúng bằng today) | `false` | ✔ PASS |
| 21 | `LOCAL_ID_CREATES_PERSON` | SOCMND_PASSPORT="079000012345" (12 số) hoặc "012345678" (9 số) | SOCMND_PASSPORT="TESTGKSK01" (hoặc 10 số) | `false` | ✔ PASS |
| 22 | `LOCAL_KETLUAN_A03_NO_RECHECK` | KETLUAN="A0-3" & NGAYKHAMLAI="" | KETLUAN="A0-3" & NGAYKHAMLAI="06/05/2027" | `false` | ✔ PASS |
| 23 | `LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM` | NGAYKETLUAN="04/11/2026" < NGAYKHAM="05/11/2026" | NGAYKETLUAN="05/11/2026" == NGAYKHAM="05/11/2026" | `false` | ✔ PASS |

---

## 4. Log chạy Vitest thực tế ở 2 múi giờ (`TZ=Asia/Ho_Chi_Minh` + Coverage & `TZ=America/Los_Angeles`)

### 4.1. `TZ=Asia/Ho_Chi_Minh` (kèm báo cáo Coverage v8)
```text
RUN  v3.2.7 G:/KSKLaiXe/packages/shared
      Coverage enabled with v8

 ✓ src/messages.test.ts (5 tests) 14ms
 ✓ src/fields.test.ts (8 tests) 14ms
 ✓ src/normalize.test.ts (47 tests) 11ms
 ✓ src/index.test.ts (1 test) 4ms
 ✓ src/validate.test.ts (84 tests) 40ms

 Test Files  5 passed (5)
      Tests  145 passed (145)
   Start at  17:25:27
   Duration  1.65s (transform 635ms, setup 0ms, collect 1.17s, tests 83ms, environment 1ms, prepare 1.89s)

 % Coverage report from v8
--------------|---------|----------|---------|---------|-------------------
File          | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
--------------|---------|----------|---------|---------|-------------------
All files     |     100 |      100 |     100 |     100 |                   
 fields.ts    |     100 |      100 |     100 |     100 |                   
 index.ts     |     100 |      100 |     100 |     100 |                   
 messages.ts  |     100 |      100 |     100 |     100 |                   
 normalize.ts |     100 |      100 |     100 |     100 |                   
 types.ts     |     100 |      100 |     100 |     100 |                   
 validate.ts  |     100 |      100 |     100 |     100 |                   
--------------|---------|----------|---------|---------|-------------------
```

### 4.2. `TZ=America/Los_Angeles`
```text
RUN  v3.2.7 G:/KSKLaiXe/packages/shared

 ✓ src/messages.test.ts (5 tests) 12ms
 ✓ src/fields.test.ts (8 tests) 19ms
 ✓ src/validate.test.ts (84 tests) 35ms
 ✓ src/normalize.test.ts (47 tests) 16ms
 ✓ src/index.test.ts (1 test) 3ms

 Test Files  5 passed (5)
      Tests  145 passed (145)
   Start at  02:25:30
   Duration  1.32s (transform 544ms, setup 0ms, collect 927ms, tests 85ms, environment 1ms, prepare 1.63s)
```
