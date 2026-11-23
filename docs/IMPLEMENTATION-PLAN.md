# IMPLEMENTATION-PLAN.md — Kế hoạch thực thi theo bước

> **Luật vàng:** mỗi lần chỉ làm **một bước**. Chưa tick đủ "Điều kiện qua cổng" và chưa có đủ **Bằng chứng bàn giao (`docs/evidence/`)** thì **không** sang bước sau.
> **Cấm báo cáo suông:** Khi hoàn thành bất kỳ bước nào, Agent **TUYỆT ĐỐI KHÔNG** chỉ nhắn "Đã hoàn thành bước S<n>". Agent bắt buộc phải chạy script kiểm chứng, chụp ảnh màn hình (với các bước có UI/web) hoặc xuất file mẫu thực tế (`.xml`, `.json`, `.xlsx`, `.zip`, `.txt`) lưu vào `docs/evidence/S<n>/` và gửi báo cáo chi tiết theo đúng mẫu bên dưới.
> Tham chiếu: `DATA-SPEC.md` (trường/luật/import), `API-CONTRACT.md` (API), `ARCHITECTURE.md` (cấu trúc/MSSQL), `TEST-PLAN.md` (ca kiểm thử chi tiết).

---

## Quy chuẩn Bằng chứng & Báo cáo bàn giao bắt buộc (Áp dụng cho MỌI bước S0–S19)

### 1. Cổng chung bắt buộc trước khi báo cáo
```bash
npm run lint && npm run typecheck && npm test      # tất cả xanh, 0 test bị skip/only
node/tsx scripts/verify-S<n>.ts                    # script kiểm chứng thực tế của riêng bước S<n>
git status                                         # không có file rác, không có .env
```

### 2. Thư mục lưu bằng chứng (`docs/evidence/`)
Mỗi bước `S<n>` phải tạo và lưu bằng chứng thực tế vào `docs/evidence/S<n>/`:
- **Script kiểm chứng (`scripts/verify-S<n>.ts` hoặc `.mjs`)**: script chạy độc lập để chứng minh tính năng của bước đó hoạt động thật (không chỉ dựa vào unit test), ghi kết quả đầu ra vào `docs/evidence/S<n>/verify-output.txt`.
- **File đầu ra thực tế** (cho các bước xử lý dữ liệu/file như S4, S5, S10, S11): file `.xml`, `.json`, `.xlsx`, `.zip` thật được sinh ra để người dùng bấm mở kiểm tra trực tiếp.
- **Ảnh chụp màn hình thực tế (`docs/evidence/S<n>/*.png`)**: với mọi bước có giao diện hoặc server chạy web (`S0`, `S13`, `S14`, `S15`, `S16`, `S17`, `S18`, `S19`), Agent phải khởi chạy server/client thật, mở trình duyệt kiểm tra và chụp ảnh màn hình từng trạng thái giao diện lưu vào `docs/evidence/S<n>/`.

### 3. Mẫu Báo cáo bàn giao bắt buộc gửi người dùng sau mỗi bước
Khi kết thúc bước `S<n>`, tin nhắn báo cáo của Agent cho người dùng **bắt buộc** phải có đủ 5 mục sau:
1. **📦 Đầu ra mã nguồn & file đã tạo/sửa**: Danh sách link clickable (`file:///...`) tới từng file code và test vừa làm.
2. **🛠️ Script kiểm chứng & Kết quả chạy thực tế**: Lệnh chạy `scripts/verify-S<n>.ts` + kết quả trích xuất thực tế + link tới `docs/evidence/S<n>/verify-output.txt`.
3. **📸 Bằng chứng trực quan (Ảnh chụp màn hình / File mẫu xuất ra)**:
   - Hiển thị hoặc gắn link trực tiếp tới các ảnh chụp màn hình `docs/evidence/S<n>/*.png` (đối với bước có giao diện).
   - Gắn link trực tiếp tới các file `.xml`, `.xlsx`, `.zip`, `.json` mẫu đã sinh ra trong `docs/evidence/S<n>/` (đối với bước backend/nghiệp vụ).
4. **🧪 Kết quả bộ Test tự động (`lint`, `typecheck`, `test`)**: Số lượng test pass, độ phủ (nếu có).
5. **🚦 Bảng đối chiếu Điều kiện qua cổng**: Tick từng ô `☑` kèm bằng chứng cụ thể cho từng điều kiện.

**Chú thích ký hiệu trong từng bước:**
- 📦 Đầu ra mã nguồn
- 🧪 Kiểm thử tự động (Vitest / Supertest / Playwright)
- 📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S<n>/`)**
- 🚦 Cổng qua bước

---

## Tổng quan

| Giai đoạn | Bước | Nội dung | Bằng chứng bàn giao chính (`docs/evidence/S<n>/`) |
|---|---|---|---|
| A. Nền | S0, S1 | Khung dự án, cấu hình (MSSQL + CSYT), log | S0: Ảnh chụp trang chủ Vite + JSON `/api/health` + log script verify. S1: Log kiểm chứng fail-fast & redact mật khẩu |
| B. Lõi nghiệp vụ | S2, S3, S4, S5 | Trường, kiểm tra, XML, envelope + chữ ký | S2: Bảng 25 trường & mã lỗi JSON. S3: Báo cáo 60+ ca validate. S4: File `sample.xml` thật. S5: File `golden-envelope.json` + đối chiếu script gốc |
| C. Giao tiếp API | S6, S7 | Mock API, client gọi API | S6: Log chạy kịch bản Postman 1.1→4.6 trên Mock. S7: Log mô phỏng retry/timeout/429/403 |
| D. Backend | S8, S9, S10, S11, S12 | DB (`gksk_*`), gửi hàng loạt, xuất XML/ZIP/Excel đối soát, import Excel ghi đè, auth | S8: Log contract test DB & kiểm tra SQL `gksk_*`. S9: Log tiến độ batch 25 giấy. S10: File `.xml`, `.zip`, `.xlsx` đối soát thật. S11: File Excel mẫu `.xlsx` + JSON xem trước ghi đè. S12: Báo cáo quét bảo mật 401/429/CSRF |
| E. Frontend | S13, S14, S15, S16 | Khung & đăng nhập, Import Excel, Danh sách & Đối soát + Xuất file, Đẩy cổng & Drawer Chi tiết | **Ảnh chụp màn hình thực tế từng trang & trạng thái** (`S13`→`S16`) + video/ảnh luồng thao tác trên trình duyệt với Mock API |
| F. Hoàn thiện | S17 | Hardening + E2E trên mock | Báo cáo Playwright E2E + bộ ảnh chụp 3 luồng E2E + `SECURITY-CHECKLIST.md` + log quét rò rỉ PII |
| G. Thật | S18, S19 | Thử trên máy chủ kiểm thử & MSSQL thật, đóng gói | S18: `S18-report.md` + ảnh chụp đối chiếu trên cổng Sở & MSSQL. S19: Bản build `dist`, `DEPLOY.md`, `USER-GUIDE.md` kèm ảnh minh họa |

---

## S0 — Khởi tạo monorepo

**Mục tiêu:** khung dự án chạy được, công cụ chất lượng sẵn sàng.

**Việc làm**
1. `git init`; kiểm tra bộ tài liệu trong repo (`docs/`, `project_context.md`, `CHANGELOG.md`).
2. `package.json` gốc với `workspaces: ["packages/*","server","client","tools/*"]`; `engines.node >= 20`.
3. `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` tùy chọn), mỗi workspace có `tsconfig.json` kế thừa.
4. ESLint + Prettier + `.editorconfig`; `.gitignore` (node_modules, dist, `.env`, `coverage`).
5. Vitest cấu hình ở từng workspace; script gốc `lint`, `typecheck`, `test`, `build`.
6. `packages/shared` có 1 hàm `ping()` + 1 test; `server` có `/api/health` + 1 test Supertest; `client` Vite hiển thị khung tiêu đề "GKSKLaiXe — Hệ thống Import Excel, Xuất XML & Đối soát GKSK Lái xe".

📦 Cây thư mục khớp `ARCHITECTURE.md §2` (phần khung), `package.json` gốc và các workspace, `npm install` sạch.
🧪 `npm run lint && npm run typecheck && npm test` xanh; `npm run build` thành công; `npm run dev` mở được client và `GET /api/health` → `{"ok":true}`.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S0/`):**
1. **Script kiểm chứng `scripts/verify-S0.mjs`**: tự động chạy `lint`, `typecheck`, `test`, `build`, bật thử server để gọi `GET /api/health` và ghi toàn bộ kết quả ra `docs/evidence/S0/verify-output.txt`.
2. **Ảnh chụp màn hình `docs/evidence/S0/client-home.png`**: khởi chạy `npm run dev`, mở trình duyệt chụp màn hình giao diện Vite client đang chạy và hiển thị trạng thái kết nối `/api/health` thành công.
3. **Báo cáo gửi người dùng**: đính kèm ảnh `client-home.png`, trích xuất `verify-output.txt` và cây thư mục đã khởi tạo.
🚦 ☐ Build sạch từ máy mới (`npm ci` / `npm run build`) ☐ `.gitignore` chặn `.env` ☐ Có đủ ảnh `docs/evidence/S0/client-home.png` và `verify-output.txt` ☐ CHANGELOG ghi S0.

---

## S1 — Cấu hình và logger

**Việc làm:** `server/src/config.ts` đọc `.env` bằng `zod` (biến ở `project_context.md §7`, gồm cấu hình MSSQL `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_ENCRYPT`, `DB_TRUST_SERVER_CERT` và cấu hình CSYT), **fail-fast** với thông báo rõ biến nào thiếu/sai (không in giá trị bí mật). `.env.example` đầy đủ. `logger.ts` bằng `pino` với `redact` cho `authorization`, `password`, `dbPassword`, `token`, `fields`, `data`. `GKSK_BASE_URL` chuẩn hóa: bỏ `/` cuối; bắt buộc `https://` khi `APP_ENV=production` (cho phép `http://localhost` khi test).

📦 `server/src/config.ts`, `server/src/logger.ts`, `.env.example`.
🧪 Test cấu hình: thiếu biến → ném lỗi nêu tên biến; `GKSK_BASE_URL="https://x/"` → `https://x`; `production` + `http://` → lỗi; `GKSK_SENDER_ID` trống → bằng `GKSK_FACILITY_ID`; test logger: log đối tượng có `password`/`dbPassword` → đầu ra không chứa giá trị.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S1/`):**
1. **Script kiểm chứng `scripts/verify-S1.ts`**:
   - Chạy thử `loadConfig` với bộ biến thiếu → in ra đúng thông báo lỗi fail-fast rõ ràng.
   - Chạy thử `logger.info` với object chứa `{ password: "SECRET_123", dbPassword: "DB_SECRET_456", authorization: "Bearer TOKEN_789", fields: { HOTEN: "NGUYEN VAN A" } }` → chứng minh dòng JSON log đầu ra đã bị che thành `[Redacted]`.
   - Ghi toàn bộ kết quả ra `docs/evidence/S1/verify-output.txt`.
2. **Báo cáo gửi người dùng**: dẫn link `.env.example`, `config.ts`, `logger.ts` và dán kết quả chạy `verify-output.txt` chứng minh không rò rỉ mật khẩu/PII.
🚦 ☐ Test xanh ☐ Chạy server thiếu `.env` → thoát mã ≠ 0 với thông báo rõ ☐ Có `docs/evidence/S1/verify-output.txt` chứng minh redact hoạt động ☐ Không có bí mật nào trong repo.

---

## S2 — `shared`: đặc tả trường và kiểu

**Việc làm:** `fields.ts` mô tả đúng 25 trường theo `DATA-SPEC.md §1` (tag, nhãn VN, kiểu, **`maxLength`**, **`bhxhRequired`**, `soRequired`, enum, nhạy cảm, `inTemplate`, `readOnly`; thứ tự = **thứ tự BHXH** ở DATA-SPEC §1). `types.ts`: `GkskRecord` (25 khóa, giá trị `string`), `Issue {code, field, severity:'error'|'warning'|'info', source:'server-mirror'|'local'}`. `messages.ts`: bảng mã → tiếng Việt (mọi mã ở API-CONTRACT §9–10 và `LOCAL_*` ở DATA-SPEC §2, gồm cả `LOCAL_SO_ACCEPTED_UNCHANGED`, `LOCAL_SO_ACCEPTED_MODIFIED`).

📦 `packages/shared/src/{fields,types,messages,index}.ts`.
🧪 Test: đúng 25 trường, đúng thứ tự, không trùng tag; `FIELD_ORDER[0]='SO'`, `[1]='NGAYKHAM'`, `[24]='STATE'`; `maxLength` đúng bảng §1 (vd `SOCMND_PASSPORT`=12, `NOICAP`=30, `NONGDOCON` không có); `bhxhRequired=false` đúng 3 thẻ (`NGAYKHAMLAI`,`LYDO`,`TINHTRANGBENH`); trường Sở bắt buộc đúng 7 (`SO,HOTEN,NGAYSINH,SOCMND_PASSPORT,KETLUAN,NGAYKETLUAN,IDBENHVIEN`); `SENSITIVE_TAGS` = `NONGDOCON, MATUY, LYDO, TINHTRANGBENH`; mọi mã ở bảng lỗi/cảnh báo đều có thông điệp VN.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S2/`):**
1. **Script kiểm chứng `scripts/verify-S2.ts`**: xuất bảng đối chiếu 25 trường (STT, Tag, Nhãn tiếng Việt, MaxLength, BHXH bắt buộc, Sở bắt buộc, Có trong mẫu Excel, Nhạy cảm) và bảng toàn bộ mã lỗi/cảnh báo tiếng Việt ra file Markdown `docs/evidence/S2/fields-and-messages-report.md`.
2. **Báo cáo gửi người dùng**: đính kèm link `docs/evidence/S2/fields-and-messages-report.md` để người dùng kiểm tra trực quan 25 thẻ đã khớp 100% với 3 ảnh BHXH (`ksk_laixe_{01,02,03}.webp`) và file mẫu `gksk_mau_ky_so_root.xml`.
🚦 ☐ Test xanh ☐ Có file `docs/evidence/S2/fields-and-messages-report.md` đối chiếu khớp 25 thẻ với tài liệu gốc.

---

## S3 — `shared`: chuẩn hóa và kiểm tra dữ liệu

**Việc làm:** `normalize.ts` (DATA-SPEC §3) và `validate.ts`: `validateRecord(record, ctx{facilityId, today})` trả `Issue[]` gồm cả mã **server-mirror** (R/W ở DATA-SPEC §1) và `LOCAL_*` (§2). Hàm thuần, không I/O, `today` truyền vào để test ổn định. Cung cấp `hasBlockingErrors(issues)` (= có `severity:'error'`).

📦 `packages/shared/src/{normalize,validate}.ts`, bảng test dạng data-driven.
🧪 Table-driven ≥ 60 ca (xem `TEST-PLAN.md §3.1`), gồm: mỗi mã lỗi R có ít nhất 1 ca kích hoạt + 1 ca ngay sát biên không kích hoạt (năm 1900/1899, `SO` 30/31 ký tự, `HOTEN` 255/256); **độ dài theo bảng Max**: `SOCMND_PASSPORT` 12/13, `NOICAP` 30/31, `HANGBANGLAI` 10/11, `MAXA_THUONGTRU` 10/11 → `LOCAL_FIELD_OVER_SPEC`; `SO` 20/21 → `LOCAL_SO_OVER_20` (info), 30/31 → lỗi `GKSK_SO_TOO_LONG`; `00001/GKSKLX/75001/26` không có `LOCAL_SO_FORMAT`, còn `TEST.75001.1` thì có (info); `LOCAL_BHXH_REQUIRED_EMPTY` gộp **một** dòng; ngày `29/02/2024` hợp lệ, `29/02/2025` lỗi, `31/04/2026` lỗi; serial Excel `33014` → `21/05/1990`, `46332` → `06/11/2026`, `45351` → `29/02/2024`; CCCD `079000012345` giữ số 0 đầu; `TESTGKSK01` không có `LOCAL_ID_CREATES_PERSON`; `NONGDOCON` `0,25` và `0.25` hợp lệ, `abc` → cảnh báo.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S3/`):**
1. **Script kiểm chứng `scripts/verify-S3.ts`**: chạy qua bộ dữ liệu mẫu (hợp lệ, lỗi chặn, cảnh báo độ dài BHXH, serial ngày Excel, số CCCD có số 0 đầu) và xuất bảng kết quả chuẩn hóa + kiểm tra kèm báo cáo độ phủ (coverage) ra `docs/evidence/S3/validation-report.md`.
2. **Báo cáo gửi người dùng**: đính kèm kết quả độ phủ dòng `shared` (≥ 95%), kết quả chạy ở 2 múi giờ `TZ=Asia/Ho_Chi_Minh` & `TZ=America/Los_Angeles`, và link tới `docs/evidence/S3/validation-report.md`.
🚦 ☐ Độ phủ dòng `shared` ≥ 95% ☐ Chạy với 2 múi giờ `TZ` khác nhau đều xanh ☐ Có `docs/evidence/S3/validation-report.md`.

---

## S4 — Server: dựng XML

**Việc làm:** `gksk/xml.ts` → `buildGkskXml(record): string` theo DATA-SPEC §4 (đủ 25 thẻ, **thứ tự BHXH** ở DATA-SPEC §1, escape, xóa ký tự cấm). Hàm trả `string`; có `toBase64Utf8(xml)`.

📦 `server/src/gksk/xml.ts` + test.
🧪 (1) Snapshot XML cho bản ghi mẫu (DATA-SPEC §6). (2) Round-trip bằng `fast-xml-parser`: 25 giá trị khớp, kể cả `A & B <C> "D" 'E'`, tiếng Việt có dấu, xuống dòng trong `LYDO`. (3) Kết quả **không** chứa `DOCTYPE`, `<!--`, `Signature`, BOM (`xml.charCodeAt(0) !== 0xFEFF`). (4) Hai lần gọi với cùng bản ghi → chuỗi y hệt (xác định). (5) Ký tự điều khiển `\x00` bị loại.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S4/`):**
1. **Script kiểm chứng `scripts/verify-S4.ts`**:
   - Sinh trực tiếp file XML mẫu hoàn chỉnh `docs/evidence/S4/sample-gksk.xml` và file có ký tự đặc biệt `docs/evidence/S4/special-chars-gksk.xml`.
   - Đối chiếu danh sách 25 thẻ của `sample-gksk.xml` với 25 thẻ dữ liệu trong `docs/reference/gksk_mau_ky_so_root.xml`, ghi kết quả kiểm chứng vào `docs/evidence/S4/verify-output.txt`.
2. **Báo cáo gửi người dùng**: nhúng toàn bộ nội dung `docs/evidence/S4/sample-gksk.xml` vào báo cáo và dẫn link file để người dùng mở xem bằng mắt.
🚦 ☐ Test xanh ☐ Có file `docs/evidence/S4/sample-gksk.xml` và `verify-output.txt` ☐ Người dùng xem được ngay XML mẫu trong báo cáo.

---

## S5 — Server: `msg_id`, envelope, chữ ký

**Việc làm:** `envelope.ts`: `newMsgId(senderId, now=Date.now())` (UTC+7 cố định), `buildEnvelope({senderId, xml, msgId, sendDatetime, privateKeyPem?})`. `signature.ts` theo API-CONTRACT §5. Key `header` đúng thứ tự.

📦 `server/src/gksk/{envelope,signature}.ts` + test.
🧪 (1) **Golden vector** API-CONTRACT §5 khớp từng ký tự (`headerJson`, `data`, `H`, `D`, `signature`). (2) `newMsgId`: khớp regex §4, độ dài 43 với sender 5 ký tự, `YYMMDD` đúng khi `now` = 2026-11-23T17:30:00Z → `261124` (đã qua nửa đêm giờ VN), và `2026-11-23T16:59:59Z` → `261123`; test chạy với `TZ` khác nhau. (3) 10 000 `msg_id` không trùng. (4) Ký RSA: sinh khóa trong test, `crypto.verify` đúng. (5) `Object.keys(envelope.header)` đúng thứ tự §3.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S5/`):**
1. **Script kiểm chứng `scripts/verify-S5.ts`**:
   - Tính toán Golden Vector và xuất đối chiếu từng dòng (`Expected` vs `Actual`) cho `headerJson`, `data`, `H`, `D`, `signature` (cả chế độ chưa có khóa RSA và chế độ ký RSA 2048-bit thật).
   - Lưu gói tin JSON hoàn chỉnh ra `docs/evidence/S5/sample-envelope.json` và log đối chiếu ra `docs/evidence/S5/verify-output.txt`.
2. **Báo cáo gửi người dùng**: dẫn link `docs/evidence/S5/sample-envelope.json` và bảng đối chiếu Golden Vector khớp 100% từng ký tự.
🚦 ☐ Golden vector xanh ☐ Có `docs/evidence/S5/sample-envelope.json` và `verify-output.txt` ☐ Không có `Date.now()` gọi trực tiếp trong logic.

---

## S6 — Mock API server

**Mục tiêu:** có "Hệ thống Sở giả" để mọi bước sau test mà không cần mạng/tài khoản.

**Việc làm:** `tools/mock-gksk-api` (Express) cài đặt: `POST /api/auth/login`, `POST /api/platform/gksk-lai-xe/push`, `GET .../status`. Tuân theo API-CONTRACT: kiểm header (`service-type`, `Authorization`), envelope (§3–4, mọi lỗi §8), giải Base64, đọc XML (từ chối `DOCTYPE`, > 1 MB, thiếu `SO`), áp **mã từ chối §9** và **cảnh báo §10** (tối thiểu: `UNSIGNED`, `KETLUAN_UNKNOWN`, `GIOITINH_UNKNOWN`, `NONGDOCON_INVALID`, `DVINONGDOCON_INVALID`, `MATUY_INVALID`, `DATE_INVALID`, `ID_INVALID`, `UNKNOWN_TAG`, `STATE_ADD_EXISTS`, `FIELD_TOO_LONG`), idempotent theo `msg_id`, ghi đè theo `(facility, SO)` giữ `certificate_id`, `msg_id` của CSYT khác → 409. Tài khoản giả cấu hình qua biến môi trường. Có **chế độ lỗi** điều khiển được bằng header/endpoint quản trị: `POST /__mock/fail {mode:'timeout'|'500'|'429'|'403-once', count:n}` để test retry. Chữ ký gói: chỉ kiểm khác rỗng; có cờ `MOCK_VERIFY_SIGNATURE=1` để kiểm RSA thật bằng public key.

📦 `tools/mock-gksk-api/src/*`, script `npm run dev:mock`.
🧪 Chạy lại **toàn bộ kịch bản Postman 1.1 → 4.6** bằng test tự động (Vitest + `fetch`) và so với hành vi mong đợi ở API-CONTRACT §12.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S6/`):**
1. **Script kiểm chứng `scripts/verify-S6.ts`**: khởi động Mock Server thật trên cổng локал, bắn tuần tự các request HTTP tương ứng với toàn bộ kịch bản Postman `1.1 → 4.6` (Login, Push thành công + `GKSK_UNSIGNED`, Push trùng `msg_id` trả cùng `submission_id`, Push trùng `SO` trả cùng `certificate_id`, Status 200/404, 5 kịch bản `rejected` HTTP 200, 1 kịch bản lỗi envelope HTTP 400, và kịch bản ép lỗi `429 Retry-After`), ghi toàn bộ Request/Response tóm tắt ra `docs/evidence/S6/postman-scenarios-report.md`.
2. **Báo cáo gửi người dùng**: đính kèm bảng kết quả kịch bản 1.1 → 4.6 và link `docs/evidence/S6/postman-scenarios-report.md`.
🚦 ☐ 2.2 trả cùng `submission_id` ☐ 2.3 cùng `certificate_id` ☐ 3.2 → 404 ☐ 4.1–4.5 `rejected` HTTP 200 ☐ 4.6 HTTP 400 ☐ 429 có `Retry-After` ☐ Có `docs/evidence/S6/postman-scenarios-report.md` ☐ Mock **không** dùng chung code với `server/` (chỉ dùng `shared/fields`).

---

## S7 — GKSK client (login, push, status, retry)

**Việc làm:** `gksk/client.ts`: `login()` cache token đến `now + duration − 5 phút`; `push(envelope)`; `status(msgId)`; timeout bằng `AbortController`; parse khoan dung 3 dạng phản hồi (API-CONTRACT §2, §6, §7). `errors.ts`: phân loại kết quả thành `{kind: 'accepted'|'rejected'|'transient'|'config', ...}`. `retry.ts`: chính sách §8 (3 lần, 5s/15s/45s, `Retry-After`, status-trước-khi-gửi-lại), có đồng hồ/`sleep` giả để test nhanh. 403 → login lại đúng 1 lần.

📦 `server/src/gksk/{client,errors,retry}.ts` + test với mock.
🧪 Bảng kịch bản (`TEST-PLAN.md §3.3`): `accepted+UNSIGNED`; `rejected FACILITY_MISMATCH`; timeout lần 1 rồi thành công (xác nhận **cùng `msg_id`** cả hai lần gọi, và đã gọi status trước); mock xử lý xong nhưng client mất phản hồi → status 200 → **không gửi lại**; `429 Retry-After:2` → chờ đúng 2 s (đồng hồ giả); `500` ×4 → `transient` sau 3 lần thử; `403` rồi login lại OK; `403` hai lần → `config`; login sai → `config`, không retry; `ref_msg_id` lệch → lỗi bất thường.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S7/`):**
1. **Script kiểm chứng `scripts/verify-S7.ts`**: chạy thực tế `gkskClient` kết nối vào Mock Server qua 6 tình huống (thành công, từ chối, timeout lần 1 rồi tự gọi status + retry cùng `msg_id`, mất kết nối sau khi server đã lưu → gọi status thu hồi kết quả không push lần 2, gặp 429 chờ `Retry-After`, gặp 403 tự đăng nhập lại 1 lần) và xuất nhật ký từng bước gọi mạng (`timeline`) ra `docs/evidence/S7/retry-timeline-report.md`.
2. **Báo cáo gửi người dùng**: đính kèm `docs/evidence/S7/retry-timeline-report.md` chứng minh `msg_id` không bị tạo mới khi retry lỗi mạng và token không xuất hiện trong log.
🚦 ☐ Mọi kịch bản xanh ☐ Có `docs/evidence/S7/retry-timeline-report.md` ☐ Test khẳng định **không** log token/`Authorization` ☐ `grep -R "console.log" server/src` rỗng.

---

## S8 — DB (MSSQL `gksk_*` & Repository Interface)

**Việc làm:**
1. Định nghĩa `DbRepositories` interface (`server/src/db/types.ts`) cho 3 kho: `batches`, `certificates`, `submissions` (hỗ trợ upsert/ghi đè theo `so`, truy vấn phân trang theo 4 tab đối soát `all|unsent|accepted|attention`, lọc `batchId`, khoảng ngày, từ khóa `q`, và đếm thống kê `counts`).
2. Cài đặt `InMemoryRepositories` (`server/src/db/inMemoryRepo.ts`) dùng mặc định cho toàn bộ `npm test` — đảm bảo chạy kiểm thử nhanh và **tuyệt đối không chạm vào MSSQL đang vận hành**.
3. Cài đặt `MssqlRepositories` (`server/src/db/mssqlRepo.ts`) + `connection.ts` bằng gói `mssql`, dùng bảng có tiền tố **`gksk_`** (`gksk_schema_migrations`, `gksk_import_batches`, `gksk_certificates`, `gksk_submissions`) theo ARCHITECTURE §5. Tự động chạy migration tạo bảng `gksk_*` nếu chưa có khi server khởi động. Mọi truy vấn dùng tham số `request.input(...)` (**cấm** ghép chuỗi SQL).

📦 `server/src/db/{types,inMemoryRepo,mssqlRepo,connection}.ts`, `server/src/db/migrations/001_init.sql`.
🧪 Bộ contract test repository: upsert theo `so` (cả bản ghi `ready` và `invalid`); tra cứu theo `so` hàng loạt (`findBySoList`) để phục vụ xem trước Import; đếm `counts` theo từng trạng thái đối soát; tìm kiếm `q` theo `so`/`hoten`/`socmnd` an toàn với ký tự `%` `_` `'`; xóa giấy kéo theo xóa submissions; khởi động lại (`recoverOnStartup`): giấy `sending` → `error`. Thêm test kiểm tra SQL migration chỉ tạo bảng `gksk_*` và không có câu lệnh `DROP`/`TRUNCATE`.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S8/`):**
1. **Script kiểm chứng `scripts/verify-S8.ts`**:
   - Chạy kiểm thử toàn bộ thao tác Repository (tạo đợt import, upsert giấy mới/ghi đè giấy cũ, lọc theo 4 tab đối soát, đếm `counts`, khôi phục giấy `sending` → `error`).
   - Quét tĩnh toàn bộ file `001_init.sql` và `mssqlRepo.ts` để xuất biên bản xác nhận: 100% bảng có tiền tố `gksk_`, 0 câu lệnh `DROP`/`TRUNCATE`, 100% truy vấn dùng `.input()` tham số hóa.
   - Ghi kết quả ra `docs/evidence/S8/db-verification-report.md`.
2. **Báo cáo gửi người dùng**: dẫn link `001_init.sql`, `mssqlRepo.ts` và đính kèm `docs/evidence/S8/db-verification-report.md`.
🚦 ☐ Test xanh ☐ Có `docs/evidence/S8/db-verification-report.md` ☐ Grep xác nhận mọi câu SQL trong `mssqlRepo.ts` đều dùng `@param` qua `.input()` và mọi tên bảng đều bắt đầu bằng `gksk_`.

---

## S9 — Dịch vụ gửi (máy trạng thái) và gửi hàng loạt

**Việc làm:** `sendService.sendCertificate(id)` theo ARCHITECTURE §6; `jobService` hàng đợi trong bộ nhớ (≤ 2 song song, nghỉ 250 ms, 429 → tạm dừng cả hàng đợi); `POST /api/certificates/:id/send`, `POST /api/send`, `GET /api/jobs/:id`, `POST /api/submissions/:id/refresh`.

📦 `server/src/services/{sendService,jobService}.ts`, `server/src/routes/send.ts`.
🧪 Với mock: gửi 1 giấy hợp lệ (`ready`) → `accepted`, DB có submission đúng `msg_id`; giấy có lỗi chặn (`invalid`) → không có request nào tới mock; mock timeout → thành công lần 2 với cùng `msg_id`; cập nhật dữ liệu giấy (qua upsert import) rồi gửi lại → `msg_id` mới, mock thấy ghi đè cùng `certificate_id`; batch 25 giấy gồm 3 giấy `rejected` + 1 lỗi tạm → tiến độ đúng, tổng hợp đúng, không giấy nào kẹt `sending`; batch 400 giấy không vượt 300 gói/phút (đồng hồ giả).
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S9/`):**
1. **Script kiểm chứng `scripts/verify-S9.ts`**: khởi chạy Mock Server + App Server, nạp 25 giấy (21 hợp lệ, 3 giấy vi phạm để bị `rejected`, 1 giấy gặp lỗi mạng tạm thời), kích hoạt `POST /api/send` hàng loạt, theo dõi tiến độ `GET /api/jobs/:id` tới khi hoàn tất, rồi thử `POST /api/submissions/:id/refresh` và ghi toàn bộ nhật ký trạng thái + lịch sử `submissions` ra `docs/evidence/S9/batch-send-report.md`.
2. **Báo cáo gửi người dùng**: đính kèm `docs/evidence/S9/batch-send-report.md` thể hiện rõ máy trạng thái chuyển đổi chính xác và giữ đúng `msg_id` khi gửi lại.
🚦 ☐ Kịch bản Postman 2.1–2.4 tái hiện qua API của app ☐ Có `docs/evidence/S9/batch-send-report.md` ☐ Không log dữ liệu cá nhân (test spy) ☐ Kết quả `rejected` được lưu `errors_json`.

---

## S10 — API Danh sách đối soát, Chi tiết chỉ đọc, Xuất XML (`.xml` & `.zip`) và Xuất Excel đối soát

**Việc làm:**
1. `exportService.ts`:
   - `buildXmlFileName(so)`: làm sạch ký tự `/ \ : * ? " < > |` → `_`.
   - `buildXmlZip(records)`: đóng gói nhiều file `<SO>.xml` vào buffer `.zip` (chỉ gồm các giấy không có lỗi chặn).
   - `buildReconcileExcel(items)`: xuất workbook `.xlsx` gồm **23 cột dữ liệu gốc** (định dạng Text như file mẫu) + **6 cột đối soát ở cuối** (`TRANG_THAI_DOI_SOAT`, `DOT_IMPORT`, `THOI_GIAN_DAY`, `MSG_ID`, `CERTIFICATE_ID_SO`, `CHI_TIET_LOI_CANH_BAO`) theo DATA-SPEC §5.4.
2. Routes ở ARCHITECTURE §4: `GET /api/batches`, `GET /api/certificates` (lọc theo tab đối soát, đợt import, ngày, `q`, trả kèm `counts`, **không trả trường nhạy cảm ở danh sách**), `GET /api/certificates/export-excel`, `POST /api/certificates/xml-zip`, `GET /api/certificates/:id` (chi tiết chỉ đọc đủ 25 trường + `issues` + `xml`), `DELETE /api/certificates/:id`, `GET /api/certificates/:id/xml`, `GET /api/certificates/:id/submissions`. Chuẩn hóa lỗi (`errorHandler`).

📦 `server/src/services/{certificateService,exportService}.ts`, `server/src/routes/certificates.ts`, `server/src/middleware/errorHandler.ts`.
🧪 Supertest: danh sách trả đúng `counts` cho 4 nhóm đối soát và **không** chứa key `MATUY`/`NONGDOCON`/`LYDO`/`TINHTRANGBENH`; lọc theo `batchId` và `tab=unsent|accepted|attention` chính xác; chi tiết `GET /api/certificates/:id` trả đủ 25 trường + `xml`; tải XML lẻ tên `TEST.75001.1.xml` (`SO` chứa `../` không thoát tên file; giấy `invalid` trả `422`); `POST /api/certificates/xml-zip` trả file `.zip` giải nén ra đúng các file `.xml` khớp byte; `GET /api/certificates/export-excel` trả file `.xlsx` đọc lại bằng `exceljs` có đủ 29 cột (23 cột gốc + 6 cột đối soát).
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S10/`):**
1. **Script kiểm chứng `scripts/verify-S10.ts`**: gọi trực tiếp các endpoint của server để sinh và lưu **3 file thật** vào `docs/evidence/S10/`:
   - `docs/evidence/S10/TEST_75001_0001.xml` (file XML tải lẻ từ `GET /api/certificates/:id/xml`).
   - `docs/evidence/S10/GKSK_XML_batch.zip` (file ZIP chứa nhiều XML tải từ `POST /api/certificates/xml-zip`).
   - `docs/evidence/S10/GKSK_doi_soat_sample.xlsx` (file Excel đối soát 29 cột tải từ `GET /api/certificates/export-excel`, có đủ các dòng ở trạng thái `Đã đẩy thành công`, `Chờ đẩy cổng`, `Lỗi dữ liệu Excel`, `Cổng Sở từ chối`).
   - Ghi báo cáo kiểm tra JSON danh sách đối soát (`counts`, ẩn trường nhạy cảm) vào `docs/evidence/S10/verify-output.txt`.
2. **Báo cáo gửi người dùng**: dẫn link trực tiếp tới 3 file thật (`TEST_75001_0001.xml`, `GKSK_XML_batch.zip`, `GKSK_doi_soat_sample.xlsx`) để người dùng có thể bấm mở bằng Excel / trình giải nén ngay trên máy!
🚦 ☐ Test xanh ☐ Có đủ 3 file mẫu thật `.xml`, `.zip`, `.xlsx` trong `docs/evidence/S10/` ☐ Không có endpoint tạo/sửa tay (`POST /api/certificates`, `PUT /api/certificates/:id`).

---

## S11 — Excel: mẫu và import ghi đè thông minh

**Việc làm:** `importService.buildTemplate()`, `previewImport(buffer)` và `commitImport(payload)` theo DATA-SPEC §5; routes `GET /api/import/template`, `POST /api/import/excel`, `POST /api/import/commit`; `multer` (≤ 5 MB, kiểm magic bytes `PK`, chỉ `.xlsx`).

📦 `server/src/services/importService.ts`, `server/src/routes/import.ts`, script sinh fixtures `tests/fixtures/make-fixtures.ts`.
🧪 Dùng fixtures ở `TEST-PLAN.md §2`:
1. File hợp lệ 5 dòng → 5 `new`, `defaultSelected=true`.
2. Lưu cả dòng hợp lệ (`ready`) và dòng lỗi dữ liệu (`invalid`, có `SO` như sai ngày sinh) vào DB để tổng số giấy trong đợt import khớp 100% file Excel; dòng thiếu `SO` thì `canCommit=false`.
3. **Kịch bản ghi đè thông minh khi Import lại file Excel:**
   - Dòng trùng `SO` đang ở `invalid`/`ready`/`rejected`/`error` → `conflictMode='overwrite_pending'`, `defaultSelected=true`, khi commit cập nhật sang dữ liệu mới và tính lại trạng thái.
   - Dòng trùng `SO` đã `accepted` và dữ liệu không đổi → `conflictMode='accepted_unchanged'`, `defaultSelected=false`.
   - Dòng trùng `SO` đã `accepted` nhưng dữ liệu có sửa → `conflictMode='accepted_modified'`, cảnh báo `LOCAL_SO_ACCEPTED_MODIFIED`, `defaultSelected=false`; nếu người dùng chủ động gửi trong `commit` thì cập nhật và chuyển về `ready`.
4. **Round-trip với file Excel đối soát (S10):** xuất file Excel đối soát (29 cột) → sửa dòng lỗi trong buffer → đưa lại vào `previewImport` → đọc thành công, 6 cột đối soát cuối được báo là cột bỏ qua và dòng lỗi sau khi sửa trở thành hợp lệ (`ready`)!
5. Các ca biên khác: CCCD bắt đầu `0`, ngày `Date`/serial/chuỗi, thiếu cột bắt buộc, bí danh `GIOITINH`, `over_length.xlsx`, 1001 dòng, file giả `.xlsx`.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S11/`):**
1. **Script kiểm chứng `scripts/verify-S11.ts`**:
   - Xuất file mẫu thật `docs/evidence/S11/GKSK_mau_nhap_lieu.xlsx` (có 2 sheet `GKSK` 23 cột định dạng Text + dropdown validation và sheet `HuongDan`).
   - Chạy mô phỏng luồng: Import lần 1 (có dòng đúng, dòng lỗi, dòng đẩy thành công) → Xuất file Excel đối soát → Sửa dòng lỗi trên file đối soát → Import lại lần 2 → xuất báo cáo JSON đối chiếu `conflictMode` & `defaultSelected` của từng dòng ra `docs/evidence/S11/smart-import-report.md`.
2. **Báo cáo gửi người dùng**: dẫn link trực tiếp tới file mẫu `docs/evidence/S11/GKSK_mau_nhap_lieu.xlsx` (để người dùng mở bằng Microsoft Excel kiểm tra định dạng Text và dropdown) cùng báo cáo `smart-import-report.md`.
🚦 ☐ Toàn bộ fixtures cho kết quả đúng ☐ Có file mẫu thật `docs/evidence/S11/GKSK_mau_nhap_lieu.xlsx` và `smart-import-report.md` ☐ Báo cáo lỗi nêu **số dòng Excel** đúng ☐ Không có dữ liệu cá nhân trong log.

---

## S12 — Xác thực ứng dụng (server)

**Việc làm:** `/api/auth/login|logout|me`, phiên cookie (ARCHITECTURE §7), `requireAuth` áp cho mọi route trừ `health`, `config`, `auth/*`; giới hạn đăng nhập sai; kiểm `X-Requested-With` cho method ghi; `helmet`.

📦 `server/src/routes/auth.ts`, `server/src/middleware/{requireAuth,rateLimit}.ts`.
🧪 Chưa đăng nhập → `401` ở mọi endpoint nghiệp vụ (test **quét toàn bộ router**, không liệt kê tay); sai mật khẩu 10 lần → `429`; cookie có `HttpOnly`; thiếu `X-Requested-With` khi `POST` → `403`; `/api/config` không chứa `password`/`token`/đường dẫn khóa/thông tin DB.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S12/`):**
1. **Script kiểm chứng `scripts/verify-S12.ts`**: tự động quét danh sách toàn bộ route trên Express app, thử gọi từng route khi chưa đăng nhập (xác nhận 100% route nghiệp vụ trả `401`), thử gọi `POST` không có header `X-Requested-With` (xác nhận trả `403`), thử đăng nhập sai 10 lần liên tiếp (xác nhận lần thứ 11 trả `429`), và ghi bảng kiểm tra bảo mật ra `docs/evidence/S12/auth-security-report.md`.
2. **Báo cáo gửi người dùng**: đính kèm bảng quét route trong `docs/evidence/S12/auth-security-report.md`.
🚦 ☐ Test xanh ☐ Có `docs/evidence/S12/auth-security-report.md` ☐ Các test S9–S11 được cập nhật dùng phiên đăng nhập, vẫn xanh.

---

## S13 — Client: khung, đăng nhập, API layer

**Việc làm:** Vite + React Router; `api/http.ts` (gắn `X-Requested-With`, xử lý 401 → về trang đăng nhập, chuẩn hóa lỗi); `LoginPage`; layout có `EnvBanner` (đỏ khi `production`; hiển thị mã CSYT) và thanh điều hướng gồm 2 trang: **Danh sách & Đối soát** (`/`) và **Import Excel** (`/import`). Không có trang Nhập liệu.

📦 `client/src/{main,App}.tsx`, `client/src/api/*`, `client/src/pages/LoginPage.tsx`, `client/src/components/EnvBanner.tsx`.
🧪 Vitest + Testing Library: đăng nhập thành công → vào trang Danh sách & Đối soát; 401 → quay về đăng nhập; banner production hiển thị, test không hiển thị.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S13/`):**
1. Khởi chạy thật `npm run dev:mock`, dùng trình duyệt (Browser Subagent / Playwright) thực hiện đăng nhập và **chụp 3 ảnh màn hình thực tế**:
   - `docs/evidence/S13/01-login-page.png`: Màn hình đăng nhập (kèm thông báo khi nhập sai mật khẩu).
   - `docs/evidence/S13/02-app-shell-test-env.png`: Giao diện khung ứng dụng sau khi đăng nhập thành công ở chế độ `APP_ENV=test` (hiển thị rõ mã CSYT, 2 mục menu `Danh sách & Đối soát` và `Import Excel`, không có mục Nhập liệu).
   - `docs/evidence/S13/03-app-shell-prod-banner.png`: Giao diện khi bật `APP_ENV=production` hiển thị rõ Banner cảnh báo màu đỏ ở đầu trang.
2. **Báo cáo gửi người dùng**: hiển thị/dẫn link cả 3 ảnh chụp màn hình trên và log kiểm tra tab Network/Console (0 lỗi console, không lộ token CSYT).
🚦 ☐ Test xanh ☐ Có đủ 3 ảnh chụp màn hình trong `docs/evidence/S13/` ☐ Trình duyệt không có lỗi console, không lộ token CSYT.

---

## S14 — Client: trang Import Excel (ghi đè thông minh)

**Việc làm:** `ImportPage.tsx`:
1. Nút **Tải file Excel mẫu** (`GKSK_mau_nhap_lieu.xlsx`).
2. Kéo-thả / chọn file `.xlsx` → gọi `POST /api/import/excel` → hiển thị thẻ tóm tắt: Tổng số dòng, Hợp lệ (`ready`), Lỗi dữ liệu (`invalid`), Ghi đè bản chưa đẩy, Đã đẩy thành công (bỏ qua / có sửa).
3. Bảng xem trước từng dòng: Số dòng Excel, `SO`, `HOTEN`, `NGAYSINH`, `KETLUAN`, huy hiệu trạng thái dữ liệu (✅/⚠️/⛔), huy hiệu đối chiếu DB (`Mới` / `Ghi đè bản cũ` / `Đã đẩy - Không đổi` / `Đã đẩy - Có sửa`), danh sách lỗi/cảnh báo tiếng Việt.
4. Bộ lọc nhanh trên bảng xem trước: `Tất cả`, `Được chọn lưu`, `Có lỗi dữ liệu`, `Ghi đè`, `Đã đẩy thành công`.
5. Checkbox chọn dòng theo đúng mặc định thông minh của `DATA-SPEC §5.2` (cho phép tick tay dòng `accepted_modified` kèm hộp thoại nhắc xác nhận ghi đè giấy đã đẩy).
6. Nút **Lưu vào Danh sách đối soát** (`POST /api/import/commit`) → chuyển sang trang Danh sách & Đối soát (tự chọn lọc theo đợt import vừa lưu).

📦 `client/src/pages/ImportPage.tsx`, `client/src/components/IssueList.tsx`.
🧪 Testing Library: hiển thị đúng số đếm ✅/⚠️/⛔ và trạng thái đối chiếu DB; dòng `accepted_unchanged` mặc định không tick; dòng `invalid` có `SO` vẫn được tick để lưu đối soát, dòng thiếu `SO` bị khóa checkbox; file thiếu cột → thông báo liệt kê cột; sau khi bấm Lưu → chuyển về trang Danh sách & Đối soát.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S14/`):**
1. Khởi chạy thật `npm run dev:mock`, mở trình duyệt nạp file Excel mẫu và **chụp 4 ảnh màn hình thực tế**:
   - `docs/evidence/S14/01-import-upload.png`: Giao diện trang Import Excel với nút Tải file mẫu và vùng chọn file.
   - `docs/evidence/S14/02-import-preview-mixed.png`: Bảng xem trước khi nạp file có cả dòng Hợp lệ (✅), Cảnh báo (⚠️) và Lỗi dữ liệu (⛔) — thể hiện rõ các dòng có mã `SO` đều được tick chọn lưu để đối soát 100% quân số.
   - `docs/evidence/S14/03-import-preview-smart-overwrite.png`: Bảng xem trước khi Import lại file Excel đã sửa — thể hiện rõ dòng `Ghi đè bản cũ` được tự động tick chọn, dòng `Đã đẩy - Không đổi` tự động bỏ chọn, và dòng `Đã đẩy - Có sửa` hiện cảnh báo vàng.
   - `docs/evidence/S14/04-import-missing-col-error.png`: Thông báo lỗi rõ ràng khi nạp thử file thiếu cột bắt buộc.
2. **Báo cáo gửi người dùng**: hiển thị/dẫn link cả 4 ảnh chụp màn hình thực tế trong `docs/evidence/S14/`.
🚦 ☐ Test xanh ☐ Có đủ 4 ảnh chụp màn hình trong `docs/evidence/S14/` ☐ Không có form nhập/sửa tay trên trang Import.

---

## S15 — Client: trang Danh sách & Đối soát, Xuất XML (`.xml`/`.zip`) và Xuất Excel đối soát

**Việc làm:** `ListPage.tsx`, `ReconcileSummary.tsx`, `StatusBadge.tsx`:
1. **Thanh thẻ đối soát (`ReconcileSummary`) & 4 Tab lọc nhanh:**
   - **Tất cả** (`counts.all`)
   - **Chưa đẩy (Sẵn sàng)** (`counts.ready`)
   - **Đã đẩy thành công** (`counts.accepted`)
   - **Cần xử lý** (`counts.invalid + counts.rejected + counts.error`, có bộ lọc con: `Lỗi dữ liệu Excel`, `Cổng Sở từ chối`, `Lỗi mạng / Cấu hình`)
2. **Bộ lọc đối soát:** chọn **Đợt import (file Excel)**, khoảng ngày, ô tìm kiếm (`SO`, `HOTEN`, `SOCMND_PASSPORT`), phân trang. Bảng **không** hiển thị 4 trường nhạy cảm.
3. **Các nút công cụ Xuất dữ liệu & Đối soát:**
   - Nút **Xuất Excel đối soát** (`GET /api/certificates/export-excel` theo bộ lọc hiện tại — dùng để lưu trữ đối soát hoặc sửa dòng lỗi rồi import lại).
   - Nút **Tải XML (.zip)** cho các dòng hợp lệ được tick chọn (`POST /api/certificates/xml-zip`).
   - Nút **Tải `<SO>.xml`** lẻ trên từng dòng hợp lệ.

📦 `client/src/pages/ListPage.tsx`, `client/src/components/{ReconcileSummary,StatusBadge}.tsx`.
🧪 Testing Library: 4 tab đối soát hiển thị đúng số đếm từ API; lọc theo đợt import và trạng thái gọi đúng query; dòng `invalid` bị vô hiệu hóa nút Tải XML và nút Đẩy cổng; bấm Tải XML (`.zip`) và Xuất Excel đối soát gọi đúng endpoint.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S15/`):**
1. Khởi chạy thật `npm run dev:mock`, mở trình duyệt thao tác trên trang Danh sách & Đối soát và **chụp 4 ảnh màn hình thực tế**:
   - `docs/evidence/S15/01-reconcile-tab-all.png`: Toàn cảnh trang Danh sách & Đối soát với 4 thẻ thống kê số lượng (`Tất cả`, `Chưa đẩy`, `Đã đẩy thành công`, `Cần xử lý`), bộ lọc theo Đợt import Excel, và các nút `Xuất Excel đối soát` / `Tải XML (.zip)`.
   - `docs/evidence/S15/02-reconcile-tab-accepted.png`: Tab **Đã đẩy thành công** hiển thị các giấy đã đẩy kèm huy hiệu xanh và mã cảnh báo thông tin `GKSK_UNSIGNED`.
   - `docs/evidence/S15/03-reconcile-tab-attention.png`: Tab **Cần xử lý** hiển thị rõ các giấy bị `Lỗi dữ liệu Excel` (khóa nút tải XML/đẩy cổng) và `Cổng Sở từ chối` kèm thông điệp lỗi tiếng Việt.
   - `docs/evidence/S15/04-batch-filter-and-search.png`: Minh họa lọc đối soát theo một Đợt file Excel cụ thể và tìm kiếm theo `SO`/Họ tên.
2. **Báo cáo gửi người dùng**: hiển thị/dẫn link cả 4 ảnh chụp màn hình trong `docs/evidence/S15/`.
🚦 ☐ Test xanh ☐ Có đủ 4 ảnh chụp màn hình trong `docs/evidence/S15/` ☐ Bảng danh sách không hiển thị trường nhạy cảm (`NONGDOCON`, `MATUY`, `LYDO`, `TINHTRANGBENH`).

---

## S16 — Client: Đẩy cổng hàng loạt & Ngăn trượt (Drawer) Chi tiết chỉ đọc

**Việc làm:**
1. Tích hợp luồng **Đẩy cổng** trên `ListPage.tsx`:
   - Chọn nhiều dòng (`ready` / `error`) → nút **Đẩy cổng các giấy đã chọn** (hộp xác nhận; khi `APP_ENV=production` có cảnh báo đỏ bắt xác nhận).
   - Thanh tiến độ theo `jobId` (polling 1 s): hiển thị số giấy đã xử lý / thành công / từ chối / lỗi; tự động cập nhật bảng và số đếm đối soát khi hoàn tất.
   - Trên từng dòng: nút **Đẩy cổng** / **Gửi lại** (khi lỗi mạng) / **Tra trạng thái**.
2. **`CertificateDetailDrawer.tsx` (Ngăn trượt chi tiết chỉ đọc ngay trên trang Danh sách):**
   - Mở khi bấm vào một dòng mà không làm mất bộ lọc hay vị trí cuộn của bảng đối soát.
   - Tab 1 — **Thông tin giấy (25 trường chỉ đọc)** + **Lỗi & Cảnh báo**: hiển thị đủ 25 trường (nhóm riêng 4 trường nhạy cảm), danh sách lỗi/cảnh báo tiếng Việt, và hướng dẫn rõ nếu giấy bị lỗi/từ chối: *"Để sửa dữ liệu, vui lòng chỉnh trên file Excel (hoặc file Excel đối soát) rồi Import lại — hệ thống sẽ tự động ghi đè theo Số giấy (SO)"*.
   - Tab 2 — **Xem trước XML (`XmlPreview`)**: hiển thị mã nguồn XML chuẩn xác định, nút **Sao chép XML**, nút **Tải `<SO>.xml`** (ẩn nếu giấy đang `invalid`).
   - Tab 3 — **Lịch sử đẩy cổng**: danh sách các lần gửi (`msg_id`, thời gian gửi, HTTP status, kết quả `accepted`/`rejected`, `server_submission_id`, `server_certificate_id`, lỗi/cảnh báo tiếng Việt, nút **Tra lại trạng thái**).

📦 `client/src/components/{CertificateDetailDrawer,XmlPreview}.tsx`, hoàn thiện `client/src/pages/ListPage.tsx`.
🧪 Testing Library + mock: gửi 10 giấy (2 `rejected`, 1 lỗi tạm rồi OK) → tiến độ & thẻ đếm đối soát cập nhật đúng; bấm vào 1 dòng mở Drawer thấy đủ 25 trường, xem trước XML khớp và thấy lịch sử `msg_id`; tắt mock → nhóm "Cần xử lý (Lỗi mạng)" + nút Gửi lại → bật mock, gửi lại → `accepted` với **cùng `msg_id`**.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S16/`):**
1. Khởi chạy thật `npm run dev:mock`, mở trình duyệt thao tác thực tế và **chụp 5 ảnh màn hình thực tế**:
   - `docs/evidence/S16/01-batch-send-confirm-and-progress.png`: Hộp thoại xác nhận đẩy cổng hàng loạt và thanh tiến độ đang chạy.
   - `docs/evidence/S16/02-drawer-tab-25-fields.png`: Ngăn trượt (Drawer) mở bên phải bảng Đối soát — Tab 1 hiển thị đủ 25 trường chỉ đọc (có nhóm riêng 4 trường nhạy cảm) và thông báo lỗi/cảnh báo chi tiết.
   - `docs/evidence/S16/03-drawer-tab-xml-preview.png`: Drawer — Tab 2 hiển thị khung **Xem trước XML** (`XmlPreview`) kèm nút Sao chép và Tải `<SO>.xml`.
   - `docs/evidence/S16/04-drawer-tab-submission-history.png`: Drawer — Tab 3 hiển thị bảng **Lịch sử các lần đẩy cổng** (`msg_id`, `certificate_id`, thời gian, kết quả, nút Tra lại trạng thái).
   - `docs/evidence/S16/05-retry-same-msgid.png`: Minh họa một giấy gặp lỗi mạng tạm thời sau khi bấm "Gửi lại" thành công giữ nguyên `msg_id` trong bảng lịch sử.
2. **Báo cáo gửi người dùng**: hiển thị/dẫn link cả 5 ảnh chụp màn hình trong `docs/evidence/S16/`.
🚦 ☐ Test xanh ☐ Có đủ 5 ảnh chụp màn hình trong `docs/evidence/S16/` ☐ Toàn bộ luồng Import → Đối soát → Xem Drawer & XML → Đẩy cổng → Lịch sử chạy trơn tru trên trình duyệt.

---

## S17 — Hardening và E2E trên mock

**Việc làm:** Playwright E2E 3 luồng chính:
1. Đăng nhập → Tải mẫu Excel → Import file có cả dòng hợp lệ và dòng lỗi → Kiểm tra 4 tab đối soát.
2. Chọn giấy hợp lệ → Xem Drawer chi tiết & XML → Tải XML lẻ / `.zip` → Đẩy cổng hàng loạt → Xuất file Excel đối soát.
3. Sửa dòng lỗi/từ chối thông qua Import lại file Excel (ghi đè thông minh theo `SO`, tự bỏ qua dòng `accepted` không đổi) → Đẩy cổng dòng vừa sửa → Thành công; thử thêm kịch bản lỗi mạng → Gửi lại giữ nguyên `msg_id`.
Rà bảo mật theo ARCHITECTURE §7 (checklist ở `TEST-PLAN.md §6`). `npm audit --omit=dev` không có mức high/critical chưa xử lý. Kiểm hiệu năng: import 1000 dòng < 10 s; gửi 1000 giấy tới mock không treo UI.

📦 `tests/e2e/*`, `docs/SECURITY-CHECKLIST.md` (đã tick đủ kèm bằng chứng).
🧪 `npm run test:e2e` xanh 3 lần liên tiếp; quét log của một lượt chạy E2E bằng `grep` các giá trị dữ liệu mẫu (`TEST NGUYEN`, `TESTGKSK01`, token, `DB_PASSWORD`) → **0 kết quả**.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S17/`):**
1. **Script kiểm chứng `scripts/verify-S17.ts`**: chạy Playwright E2E 3 lần liên tiếp, đo thời gian import 1000 dòng (`big_1000.xlsx`), chạy quét `grep` chống rò rỉ dữ liệu nhạy cảm trên file log E2E, chạy `npm audit --omit=dev`, và ghi toàn bộ báo cáo tổng hợp vào `docs/evidence/S17/e2e-and-security-report.md`.
2. **Ảnh chụp màn hình tự động từ Playwright (`docs/evidence/S17/e2e-*.png`)**: lưu ảnh chụp màn hình kết thúc của cả 3 luồng E2E.
3. **Báo cáo gửi người dùng**: đính kèm `docs/SECURITY-CHECKLIST.md`, `docs/evidence/S17/e2e-and-security-report.md` và các ảnh chụp từ Playwright E2E.
🚦 ☐ E2E xanh 3 lần liên tiếp (không flaky) ☐ Có đủ ảnh E2E và `e2e-and-security-report.md` ☐ Checklist bảo mật tick đủ ☐ Không còn `TODO`/`FIXME` chưa được ghi vào OPEN-QUESTIONS.

---

## S18 — Kiểm thử trên máy chủ kiểm thử thật & MSSQL thật (thủ công, có người dùng tham gia)

> Bước này cần **cấu hình MSSQL trên server hiện tại** và **tài khoản + baseUrl môi trường kiểm thử** do Sở Y tế / MasterHive cấp. **Không** làm trên môi trường cổng Sở production. Agent chuẩn bị kịch bản và đọc kết quả; **người dùng** chạy/nhập thông tin nhạy cảm.

**Việc làm:**
1. Kết nối MSSQL thật với tiền tố bảng `gksk_*`, xác nhận migration tự tạo 4 bảng `gksk_*` an toàn.
2. Làm theo `TEST-PLAN.md §5` — lặp lại các kịch bản Postman 2.1→4.6 bằng chính webapp thông qua luồng Import Excel → Xuất XML → Đẩy cổng → Đối soát. Ghi kết quả thực tế vào `docs/evidence/S18/S18-report.md` (chỉ mã lỗi/`msg_id`, không dữ liệu cá nhân). Giải quyết các `OPEN-QUESTIONS` còn lại: Q2 (thẻ rỗng trên server thật), Q13 (đếm độ dài theo ký tự hay byte).

📦 `docs/evidence/S18/S18-report.md`; cập nhật `DATA-SPEC.md` nếu server thật khác đặc tả.
🧪 Mọi dòng ở bảng `TEST-PLAN.md §5` đạt hoặc có giải thích đã được người dùng chấp thuận.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S18/`):**
1. **Biên bản nghiệm thu máy chủ kiểm thử `docs/evidence/S18/S18-report.md`**: điền đầy đủ kết quả 14 bước trong `TEST-PLAN.md §5` (kèm `msg_id`, `submission_id`, `certificate_id`, mã phản hồi).
2. **Ảnh chụp màn hình thực tế (`docs/evidence/S18/*.png`, đã che thông tin nhạy cảm nếu có)**: ảnh chụp 4 bảng `gksk_*` trên MSSQL, ảnh chụp bảng Đối soát của webapp sau khi đẩy lên máy chủ kiểm thử Sở, và ảnh chụp màn hình trang Lịch sử trên Hệ thống Sở thấy các giấy `TEST.`.
🚦 ☐ 4 bảng `gksk_*` tạo thành công trên MSSQL ☐ 5 giấy `TEST.` import từ Excel gửi `accepted` + `GKSK_UNSIGNED` ☐ gửi lại cùng `msg_id` → cùng `submission_id` ☐ import đè cùng `SO` đã sửa rồi gửi → cùng `certificate_id` ☐ 4 loại `rejected` đúng mã ☐ Có đủ biên bản và ảnh chụp trong `docs/evidence/S18/`.

---

## S19 — Đóng gói và hướng dẫn vận hành

**Việc làm:** `npm run build` tạo `dist`; server phục vụ `client/dist` (một tiến trình, một cổng); `docs/DEPLOY.md` (Windows Server: cấu hình kết nối MSSQL và quyền tài khoản SQL cho các bảng `gksk_*`; chạy bằng PM2 hoặc NSSM; reverse proxy HTTPS; sao lưu DB; xoay vòng log; đổi mật khẩu/khóa; nâng cấp Node), `docs/USER-GUIDE.md` (hướng dẫn người dùng cuối bằng tiếng Việt cho quy trình: Tải mẫu Excel → Nhập/Xuất từ HIS → Import vào Webapp → Kiểm tra & Đẩy cổng → Xuất Excel đối soát → Sửa lỗi trên Excel & Import đè, **có nhúng các ảnh chụp màn hình từ `docs/evidence/`**).

📦 `docs/DEPLOY.md`, `docs/USER-GUIDE.md`, bản build `dist` chạy được từ một tiến trình Express duy nhất.
🧪 Khởi chạy bản build production (`NODE_ENV=production node server/dist/index.js`) phục vụ cả API lẫn giao diện tĩnh React trên cùng một cổng.
📸 **Đầu ra xác nhận & Bằng chứng bàn giao bắt buộc (`docs/evidence/S19/`):**
1. **Script kiểm chứng `scripts/verify-S19.mjs`**: chạy `npm run build`, khởi động tiến trình đơn `server/dist/index.js`, kiểm tra truy cập trang chủ HTML tĩnh + `/api/health` + `/api/config` trên cùng 1 cổng, ghi kết quả vào `docs/evidence/S19/verify-output.txt`.
2. **Ảnh chụp màn hình `docs/evidence/S19/production-single-port.png`**: chụp trình duyệt đang mở bản build production từ cổng của Express server.
3. **Báo cáo gửi người dùng**: dẫn link `docs/DEPLOY.md`, `docs/USER-GUIDE.md` (đã nhúng đầy đủ ảnh minh họa từng bước), ảnh `production-single-port.png` và `verify-output.txt`.
🚦 ☐ Người dùng làm theo `DEPLOY.md` thành công không cần hỏi thêm ☐ Có đủ `DEPLOY.md`, `USER-GUIDE.md`, `docs/evidence/S19/*` ☐ CHANGELOG ghi phiên bản `1.0.0` ☐ Đặt thẻ git `v1.0.0`.

---

## Phụ lục — Quy tắc khi một bước thất bại

1. Test đỏ hoặc script verify lỗi → sửa tới xanh; **không** `skip`, `.only`, hạ ngưỡng, hay sửa test cho vừa code mà không nêu lý do ở CHANGELOG.
2. Bước tốn hơn dự kiến → **chia nhỏ thêm** (S7a, S7b…) và ghi vào CHANGELOG; không dồn việc sang bước sau.
3. Phát hiện bước trước sai → quay lại sửa **ở bước đó**, chạy lại cổng và script verify của nó, cập nhật lại `docs/evidence/S<n>/`, ghi CHANGELOG "Sửa S<n>".
4. Tài liệu thiếu/mâu thuẫn → `OPEN-QUESTIONS.md` + hỏi người dùng.
