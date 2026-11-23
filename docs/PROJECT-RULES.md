# PROJECT-RULES.md — Luật làm việc cho Agent

## 1. Nguyên tắc

1. **Một bước một lần.** Làm đúng bước trong `IMPLEMENTATION-PLAN.md`. Không làm trước, không "tiện tay" thêm tính năng.
2. **Tài liệu là hợp đồng.** `DATA-SPEC.md`, `API-CONTRACT.md`, `ARCHITECTURE.md` quyết định hành vi. Muốn khác → hỏi người dùng, sửa tài liệu **trước**, ghi CHANGELOG, rồi mới code.
3. **Không đoán.** Thiếu/mâu thuẫn → `docs/OPEN-QUESTIONS.md` + dừng hỏi. Có thể làm tiếp phần không bị ảnh hưởng.
4. **Bằng chứng trước lời khẳng định.** "Xong" nghĩa là test đã chạy và xanh, kèm lệnh + kết quả tóm tắt trong CHANGELOG. Không viết "đã hoạt động" nếu chưa chạy.
5. **Trung thực về giới hạn.** Chưa thử trên máy chủ thật thì nói rõ "mới thử trên mock".

## 2. Định nghĩa "Xong" của một bước & Mẫu báo cáo bắt buộc

Một bước `S<n>` chỉ được coi là **Xong** khi thỏa mãn toàn bộ các mục sau:
- [ ] Mọi mục "Việc làm" đã thực hiện, mọi "Đầu ra" (`📦`) tồn tại.
- [ ] Test của bước viết đủ và **xanh**; cổng chung (`npm run lint && npm run typecheck && npm test`) xanh.
- [ ] Đã viết và chạy **Script kiểm chứng độc lập** (`scripts/verify-S<n>.ts` hoặc `.mjs`), lưu kết quả thực tế cùng các file mẫu sinh ra (`.xml`, `.json`, `.xlsx`, `.zip`) và **ảnh chụp màn hình trình duyệt** (với mọi bước có web/UI: `S0`, `S13`–`S19`) vào `docs/evidence/S<n>/` theo đúng mục `📸` trong `IMPLEMENTATION-PLAN.md`.
- [ ] Mọi ô "Cổng qua bước" (`🚦`) đã tick (ghi từng ô vào CHANGELOG).
- [ ] Không có `console.log`, `debugger`, `TODO` mồ côi, mã chết, file tạm.
- [ ] Không có dữ liệu cá nhân thật, bí mật, `.env` trong git.
- [ ] CHANGELOG đã cập nhật (§5).
- [ ] **Báo cáo gửi người dùng theo đúng 5 mục bắt buộc** (tuyệt đối **CẤM** chỉ báo cáo "Đã hoàn thành bước S<n>" suông):
  1. **📦 Đầu ra mã nguồn & file đã tạo/sửa** (kèm link `file:///...`).
  2. **🛠️ Script kiểm chứng & Kết quả chạy thực tế** (lệnh chạy `scripts/verify-S<n>` + kết quả trích xuất + link `docs/evidence/S<n>/...`).
  3. **📸 Bằng chứng trực quan** (hiển thị/dẫn link ảnh chụp màn hình `docs/evidence/S<n>/*.png` đối với bước có giao diện, hoặc link file mẫu `.xml`/`.xlsx`/`.zip`/`.json` thực tế đối với bước backend).
  4. **🧪 Kết quả bộ Test tự động** (`lint`, `typecheck`, `test` + số lượng ca test pass / độ phủ).
  5. **🚦 Bảng đối chiếu Điều kiện qua cổng** (`☑` từng mục kèm bằng chứng).

## 3. Điều CẤM

| # | Cấm | Vì sao |
|---|---|---|
| 1 | Sửa/xóa/đổi tên file trong `docs/reference/` | Là nguồn gốc để đối chiếu |
| 2 | Gửi bất cứ thứ gì lên máy chủ **production**; dùng dữ liệu người thật làm fixtures/test | Tài liệu yêu cầu chỉ dùng dữ liệu giả ở môi trường kiểm thử; số CCCD thật tạo người mới trên Hệ thống Sở |
| 3 | Đưa token/mật khẩu/khóa riêng/mật khẩu MSSQL vào mã, log, test snapshot, response của app, URL, `localStorage` | Bảo mật |
| 4 | Log giá trị dữ liệu cá nhân hoặc nội dung `data` Base64 | Dữ liệu y tế nhạy cảm |
| 5 | Coi HTTP 200 là "đã nhận" mà không đọc `data.status` | Giấy `rejected` vẫn là HTTP 200 |
| 6 | Tạo `msg_id` mới khi **gửi lại do lỗi mạng** | Mất tính idempotent → có thể ghi trùng |
| 7 | Đổi thứ tự key `header`, thêm khoảng trắng khi `JSON.stringify(header)` để ký | Sai chữ ký |
| 8 | Dùng `Date`/múi giờ máy để tính `YYMMDD` của `msg_id` | Phải là UTC+7 cố định |
| 9 | Dùng gói `xlsx` (SheetJS) từ npm; dùng `eval`, `new Function`, `child_process` với dữ liệu người dùng | Lỗ hổng/an toàn |
| 10 | Ghép chuỗi vào SQL; dùng `innerHTML`/`dangerouslySetInnerHTML` với dữ liệu giấy | SQL injection / XSS |
| 11 | Tạo bảng MSSQL không có tiền tố `gksk_`; chạy `DROP TABLE`/`TRUNCATE` hoặc cho `npm test` kết nối vào MSSQL đang vận hành | Bảo vệ tuyệt đối CSDL MSSQL hiện tại của đơn vị |
| 12 | Thêm thẻ XML ngoài 25 thẻ; thêm `DOCTYPE`/entity vào XML | `GKSK_UNKNOWN_TAG` / bị từ chối |
| 13 | Tự ý làm màn hình nhập liệu/sửa trực tiếp trên web ở v1, hoặc thêm thư viện lớn, framework UI nặng, ORM | Phạm vi v1 chỉ làm Import Excel → Xuất XML → Đẩy cổng & Đối soát; mỗi thư viện mới phải ghi lý do trong CHANGELOG |
| 14 | `skip`/`only`/xóa test/hạ ngưỡng để "xanh" | Che lỗi |
| 15 | Sửa nhiều bước trong một commit; commit file build, `node_modules` | |
| 16 | Tự "sửa" dữ liệu người dùng một cách âm thầm (đổi ngày, bù số 0, đổi họ tên) | Chỉ chuẩn hóa theo DATA-SPEC §3 và **hiển thị** thay đổi; còn lại để người dùng sửa trên Excel rồi import lại |
| 17 | Giả sử hành vi server thật từ mock | Mock chỉ là bản đọc tài liệu; S18 mới là bằng chứng |

## 4. Quy ước mã

- TypeScript `strict`; không `any` (dùng `unknown` + thu hẹp); hàm công khai có kiểu trả về rõ ràng.
- Hàm thuần cho logic nghiệp vụ; I/O ở rìa (routes, repo, client). Thời gian/ngẫu nhiên đưa qua tham số để test.
- Tên: file `camelCase.ts` (trừ component React `PascalCase.tsx`); thẻ XML/trường dữ liệu giữ nguyên **HOA** như đặc tả; hằng số `UPPER_SNAKE`.
- Chuỗi hiển thị cho người dùng bằng **tiếng Việt có dấu**, nằm ở `shared/messages.ts` hoặc component; mã lỗi/log bằng tiếng Anh/mã.
- Xử lý lỗi: ném lỗi có kiểu (class kế thừa `AppError{code,httpStatus}`); `errorHandler` là nơi duy nhất chuyển lỗi thành HTTP; không `catch` rồi nuốt lỗi.
- Phụ thuộc phiên bản: ghim bằng `package-lock.json`; `npm ci` trong CI/triển khai.
- React: component hàm + hooks; không state toàn cục nếu không cần; gọi API chỉ qua `client/src/api/*`.
- Định dạng ngày hiển thị/lưu: chuỗi `dd/MM/yyyy`; không dùng `Date` làm kiểu lưu trữ của trường ngày giấy.
- Ghi chú trong mã giải thích **vì sao** (đặc biệt chỗ có bẫy: chữ ký, `msg_id`, số 0 đầu); dẫn mục tài liệu (`// API-CONTRACT §5`).

## 5. CHANGELOG — cập nhật sau mỗi bước (để các Agent khác nắm thông tin)

Thêm một mục **ở đầu** danh sách (mới nhất lên trên) theo mẫu trong `CHANGELOG.md`:

```
## [S<n>] <tên bước> — <YYYY-MM-DD> — <Agent/người thực hiện>
### Đã làm
### Đầu ra (file/đường dẫn/lệnh)
### Kiểm thử (lệnh + kết quả tóm tắt)
### Cổng qua bước (từng ô ✔/✘)
### Quyết định & sai khác so với tài liệu (nếu có)
### Ghi chú cho Agent sau (bẫy, việc dở, thứ cần biết)
```

- **Mỗi khi sửa một file trong `docs/`** (hoặc `project_context.md`): thêm dòng vào mục "Thay đổi tài liệu" của CHANGELOG: file nào, đổi gì, vì sao.
- Không xóa mục cũ; sai thì thêm mục sửa.

## 6. Git

- Nhánh `main` luôn xanh. Mỗi bước: nhánh `step/S<n>-<slug>` → commit → hợp nhất khi cổng đạt.
- Thông điệp commit: `S<n>: <việc làm>` (tiếng Việt hoặc Anh, nhất quán). Ví dụ `S5: envelope, msg_id, chữ ký + golden vector`.
- Thẻ `S<n>-done` sau khi bước đạt cổng; `v1.0.0` khi S19 xong.
- Không commit: `.env`, `node_modules/`, `dist/`, `coverage/`, file Excel/XML chứa dữ liệu thật.

## 7. Xử lý dữ liệu & fixtures

- Fixtures chỉ chứa **dữ liệu giả**: họ tên bắt đầu `TEST`, `SO` bắt đầu `TEST.`, số giấy tờ `TESTGKSK01` hoặc dãy số rõ ràng giả (ví dụ `079000012345` chỉ dùng trong test **đơn vị/mock**, **không bao giờ** gửi lên máy chủ thật).
- Fixtures Excel được **sinh bằng script** (`tests/fixtures/make-fixtures.ts`) để tái lập; file sinh ra có thể commit nếu < 100 KB.
- Ảnh chụp màn hình trong `docs/evidence/` không được chứa dữ liệu thật.

## 8. Khi giao việc cho Agent khác (hoặc phiên mới)

Prompt khởi động chuẩn:

> Đọc `project_context.md`, rồi `CHANGELOG.md` (mục mới nhất), rồi `docs/IMPLEMENTATION-PLAN.md`. Làm **một** bước kế tiếp, tuân thủ `docs/PROJECT-RULES.md`. Kết thúc bằng cổng chung và cập nhật CHANGELOG. Không làm bước sau. Có điều gì tài liệu chưa rõ thì ghi `docs/OPEN-QUESTIONS.md` và hỏi lại.
