# Báo cáo Kiểm chứng S8 — DB (MSSQL `gksk_*` & Repository Interface)

- **Thời gian chạy kiểm chứng**: `2026-11-23T13:05:01.277Z`
- **Các file kiểm chứng**:
  - `server/src/db/types.ts` (`DbRepositories` interface)
  - `server/src/db/inMemoryRepo.ts` (`InMemoryRepositories` — mặc định cho `npm test`)
  - `server/src/db/migrations/001_init.sql` (Migration MSSQL bảng tiền tố `gksk_*`)
  - `server/src/db/mssqlRepo.ts` (`MssqlRepositories` — 100% tham số hóa `.input()`)
  - `server/src/db/connection.ts` (`createMssqlPool`, `runMigrations`, `createRepositories`)

## 1. Kết quả Kiểm chứng Hợp đồng Repository (`DbRepositories`)

| # | Hạng mục kiểm chứng | Kết quả thực tế | Trạng thái |
|---:|---|---|:---:|
| 1 | Mặc định `createRepositories()` không truyền pool | `repo.kind = "in-memory"` (tuyệt đối không mở kết nối MSSQL khi chạy `npm test`) | PASS |
| 2 | Tạo đợt import (`batches.create` / `list`) | Đã tạo 2 đợt (`dot_1_nhap_moi.xlsx`, `dot_2_sua_loi_doi_soat.xlsx`), sắp xếp mới nhất trước | PASS |
| 3 | Upsert theo `SO` (`ready` & `invalid`) | Lưu đủ 6/6 giấy có `SO` (gồm cả dòng `ready` lẫn `invalid` để khớp 100% quân số đối soát) | PASS |
| 4 | Tra cứu hàng loạt `findBySoList(soList)` | Tra cứu 3 mã `SO` → khớp chính xác 2 bản ghi đang có trong DB | PASS |
| 5 | Ghi đè thông minh trùng `SO` (`upsertBySo`) | Ghi đè `TEST.75001.S8.02` (`invalid` → `ready`), giữ nguyên `id = 2`, `created = false` | PASS |
| 6 | Khôi phục khi khởi động (`recoverOnStartup`) | Chuyển `1` giấy đang kẹt `sending` → `error` (`counts.sending = 0`) | PASS |
| 7 | Lọc phân trang theo 4 tab đối soát & đếm `counts` | `all=6`, `unsent=2`, `accepted=1`, `attention=3` | PASS |
| 8 | Tìm kiếm `q` an toàn với `%`, `_`, `'` | Tìm `"100%"` → 1 dòng; `"CONNOR_"` → 1 dòng; `"O'CONNOR"` → 1 dòng; escape T-SQL: `100\%\_test'a` | PASS |
| 9 | Lịch sử `submissions` & xóa dây chuyền (`CASCADE`) | Tìm đúng submission chờ (`msg_id=7500126112300000000000004000800000000000666`); xóa giấy `id=6` tự động xóa sạch submissions kèm theo | PASS |

---

## 2. Biên bản Quét tĩnh An toàn SQL (`001_init.sql`, `mssqlRepo.ts`, `connection.ts`)

### 2.1 Kiểm tra Lược đồ Migration `001_init.sql`

- **Tổng số bảng khởi tạo**: **4/4 bảng** đều bắt đầu bằng tiền tố `gksk_` và có chốt chặn `IF OBJECT_ID(N'dbo.gksk_...', N'U') IS NULL`:
  - `dbo.gksk_schema_migrations` (tiền tố `gksk_`: **✔**)
  - `dbo.gksk_import_batches` (tiền tố `gksk_`: **✔**)
  - `dbo.gksk_certificates` (tiền tố `gksk_`: **✔**)
  - `dbo.gksk_submissions` (tiền tố `gksk_`: **✔**)
- **Tổng số chỉ mục (`CREATE INDEX`)**: **3/3 chỉ mục** có kiểm tra `IF NOT EXISTS`:
  - `ix_gksk_cert_status` trên bảng `dbo.gksk_certificates` (**✔**)
  - `ix_gksk_cert_batch` trên bảng `dbo.gksk_certificates` (**✔**)
  - `ix_gksk_sub_cert` trên bảng `dbo.gksk_submissions` (**✔**)
- **Quét từ khóa cấm `DROP` / `TRUNCATE` trong `001_init.sql`, `mssqlRepo.ts`, `connection.ts`**: **`0` kết quả (PASS)**.

### 2.2 Bảng Kiểm toán 100% Câu truy vấn SQL trong `mssqlRepo.ts` & `connection.ts`

- **Tổng số khối truy vấn `.query(`...`)` đã quét**: **24 câu truy vấn**.
- **Số câu truy vấn có ghép chuỗi / nội suy `${...}`**: **`0` câu (100% chuỗi SQL tĩnh)**.
- **Số tham số `@param` được truyền qua `request.input('param', sql.Type, value)`**: **100%**.

| # | Loại lệnh | Bảng tham chiếu (`dbo.gksk_*`) | Tham số `@param` (qua `.input()`) | Nội suy `${...}`? | Dòng đầu câu SQL |
|---:|---|---|---|:---:|---|
| 1 | `INSERT` | `dbo.gksk_import_batches` | `@filename`, `@rowCount`, `@createdAt` | `false` | `INSERT INTO dbo.gksk_import_batches (filename, row_count, created_at)` |
| 2 | `SELECT` | `dbo.gksk_import_batches` | `@id` | `false` | `SELECT id, filename, row_count, created_at` |
| 3 | `SELECT` | `dbo.gksk_import_batches` | *(không có tham số)* | `false` | `SELECT id, filename, row_count, created_at` |
| 4 | `UPDATE` | `dbo.gksk_certificates` | `@fieldsJson`, `@dataSha256`, `@status`, `@batchId`, `@excelRowNumber`, `@serverCertificateId`, `@updatedAt`, `@id` | `false` | `UPDATE dbo.gksk_certificates` |
| 5 | `INSERT` | `dbo.gksk_certificates` | `@so`, `@fieldsJson`, `@dataSha256`, `@status`, `@batchId`, `@excelRowNumber`, `@serverCertificateId`, `@createdAt`, `@updatedAt` | `false` | `INSERT INTO dbo.gksk_certificates (` |
| 6 | `SELECT` | `dbo.gksk_certificates`, `dbo.gksk_import_batches` | `@id` | `false` | `SELECT` |
| 7 | `SELECT` | `dbo.gksk_certificates`, `dbo.gksk_import_batches` | `@idsJson` | `false` | `SELECT` |
| 8 | `SELECT` | `dbo.gksk_certificates`, `dbo.gksk_import_batches` | `@so` | `false` | `SELECT` |
| 9 | `SELECT` | `dbo.gksk_certificates`, `dbo.gksk_import_batches` | `@soListJson` | `false` | `SELECT` |
| 10 | `SELECT` | `dbo.gksk_certificates` | `@batchId`, `@fromDate`, `@toDate`, `@qPattern` | `false` | `SELECT c.status, COUNT(1) AS cnt` |
| 11 | `SELECT` | `dbo.gksk_certificates` | `@batchId`, `@fromDate`, `@toDate`, `@qPattern`, `@tab`, `@statusFilter` | `false` | `SELECT COUNT(1) AS total` |
| 12 | `SELECT` | `dbo.gksk_certificates`, `dbo.gksk_import_batches` | `@batchId`, `@fromDate`, `@toDate`, `@qPattern`, `@tab`, `@statusFilter`, `@offset`, `@pageSize` | `false` | `SELECT` |
| 13 | `UPDATE` | `dbo.gksk_certificates` | `@status`, `@serverCertificateId`, `@updatedAt`, `@id` | `false` | `UPDATE dbo.gksk_certificates` |
| 14 | `DELETE` | `dbo.gksk_certificates` | `@id` | `false` | `DELETE FROM dbo.gksk_certificates` |
| 15 | `UPDATE` | `dbo.gksk_certificates` | `@toStatus`, `@updatedAt`, `@fromStatus` | `false` | `UPDATE dbo.gksk_certificates` |
| 16 | `INSERT` | `dbo.gksk_submissions` | `@certificateId`, `@msgId`, `@sendDatetime`, `@dataSha256`, `@attempts`, `@httpStatus`, `@resCode`, `@resultStatus`, `@serverSubmissionId`, `@errorsJson`, `@warningsJson`, `@lastError`, `@createdAt`, `@finishedAt` | `false` | `INSERT INTO dbo.gksk_submissions (` |
| 17 | `UPDATE` | `dbo.gksk_submissions` | `@msgId`, `@sendDatetime`, `@attempts`, `@httpStatus`, `@resCode`, `@resultStatus`, `@serverSubmissionId`, `@errorsJson`, `@warningsJson`, `@lastError`, `@finishedAt`, `@id` | `false` | `UPDATE dbo.gksk_submissions` |
| 18 | `SELECT` | `dbo.gksk_submissions` | `@id` | `false` | `SELECT *` |
| 19 | `SELECT` | `dbo.gksk_submissions` | `@msgId` | `false` | `SELECT *` |
| 20 | `SELECT` | `dbo.gksk_submissions` | `@certificateId` | `false` | `SELECT *` |
| 21 | `SELECT` | `dbo.gksk_submissions` | `@certificateId` | `false` | `SELECT TOP (1) *` |
| 22 | `SELECT` | `dbo.gksk_submissions` | `@idsJson` | `false` | `SELECT s.*` |
| 23 | `SELECT` | `dbo.gksk_submissions` | `@certificateId`, `@dataSha256` | `false` | `SELECT TOP (1) *` |
| 24 | `IF` | `dbo.gksk_schema_migrations` | `@version` | `false` | `IF NOT EXISTS (` |
