# Báo cáo Kiểm chứng Bước S9 — Dịch vụ gửi (Máy trạng thái) & Gửi hàng loạt

- **Thời gian thực thi**: `2026-11-23T13:32:38.781Z`
- **Cấu hình hàng đợi (`JobService`)**: `maxConcurrency = 2`, `minIntervalMs = 250ms` (tối đa `240 gói/phút < 300 gói/phút`), tự động tạm dừng khi gặp HTTP 429.
- **Kho dữ liệu**: `InMemoryRepositories` (tuân thủ quy tắc bảo vệ MSSQL đang vận hành).
- **Kết quả kiểm tra rò rỉ PII / Token trong log (`85` dòng JSON Pino)**: **0 rò rỉ** (PASS).

---

## 1. Kiểm chứng Kịch bản Postman 2.1 – 2.4 & Máy trạng thái gửi đơn lẻ (`POST /api/certificates/:id/send`)

| Kịch bản | Mô tả | Mã `SO` | Trạng thái giấy | `msg_id` | Số lần gọi (`attempts`) | `server_submission_id` | `server_certificate_id` | Ghi chú đối soát |
|---|---|---|---|---|---:|---|---|---|
| **S9-INVALID** | Chặn giấy có lỗi dữ liệu chặn (`NGAYSINH=31/02/1990`) trước khi gọi API | `TEST.75001.S9.INVALID.01` | `invalid` | `(không sinh)` | 0 | `-` | `-` | Issues: GKSK_NGAYSINH_INVALID, LOCAL_SO_OVER_20, LOCAL_SO_FORMAT (0 request tới Mock) |
| **Postman 2.1** | Gửi giấy XML hợp lệ chưa ký số (`accepted` + `GKSK_UNSIGNED`) | `TEST.75001.S9.POSTMAN.201` | `accepted` | `7500126112310b7abe3a3894636b18ad98162bd728d` | 1 | `ffc8d952-b1b7-41b1-9e2e-2caf7687bc29` | `35e61907-edc6-4ffe-af66-3d1f5859f8b2` | warnings=[{"code":"GKSK_UNSIGNED","field":null}] |
| **Postman 2.2** | Retry sau lỗi mạng tái sử dụng đúng `msg_id` & `send_datetime` cũ | `TEST.75001.S9.POSTMAN.202` | `error -> accepted` | `750012611235f761bdefee448bf8039ec9401e069aa` | 5 | `560765d1-4838-4ac2-9aa5-1ba80fe986c7` | `258f058e-cccf-4dfd-80a3-3e5d33bc5471` | reusedPendingSubmission=true, giữ nguyên msg_id=750012611235f761bdefee448bf8039ec9401e069aa |
| **Postman 2.3** | Cập nhật dữ liệu cùng `SO` -> sinh `msg_id` mới, giữ cùng `certificate_id` | `TEST.75001.S9.POSTMAN.201` | `accepted` | `75001261123bca3e54b3bbf4b90a9ee23dc6418b1b1` | 1 | `1a5c9b60-eb07-43d4-a64b-e2b39fd63e24` | `35e61907-edc6-4ffe-af66-3d1f5859f8b2` | Cùng certificate_id=35e61907-edc6-4ffe-af66-3d1f5859f8b2, warnings có GKSK_STATE_ADD_EXISTS |
| **Postman 2.4** | Gửi giấy có cảnh báo không chặn (`KETLUAN=A0-9`, `NOICAP` 31 ký tự) | `TEST.75001.S9.POSTMAN.204` | `accepted` | `75001261123fa452698ddb04b9a8f9b1455ae1aa012` | 1 | `c1e25c29-6d40-40ac-8d58-2d3f5f0ec485` | `0c400727-f67c-4414-93fe-69cd60e2953f` | warnings=GKSK_UNSIGNED, GKSK_KETLUAN_UNKNOWN, GKSK_NONGDOCON_INVALID, GKSK_FIELD_TOO_LONG |

---

## 2. Nhật ký Polling Tiến độ Gửi hàng loạt 25 Giấy (`POST /api/send` → `GET /api/jobs/:jobId`)

- **Mã tiến trình (`jobId`)**: `33517727-d5a9-4dd9-9fb9-af17b1bb3230`
- **Cơ cấu 25 giấy nạp vào hàng đợi**:
  - **21 giấy hợp lệ** (`#01..#04`, `#06..#11`, `#13..#18`, `#20..#24`) → Kỳ vọng: `accepted` + cảnh báo thông tin `GKSK_UNSIGNED`.
  - **03 giấy bị Cổng Sở từ chối** (`#05`: `GKSK_FACILITY_MISMATCH`, `#12`: `GKSK_HOTEN_INVALID`, `#19`: `GKSK_KETLUAN_MISSING`) → Kỳ vọng: HTTP 200 `PS_SYNC_SUCCESS` nhưng `status = rejected`, lưu đầy đủ `errors_json`.
  - **01 giấy gặp lỗi mạng tạm thời** (`#25`: HTTP 500 `PS_DS_SAVE_FAIL` qua 1 lần gửi + 3 lần retry) → Kỳ vọng: `status = error`, `attempts = 4`, `result_status = null` (giữ `msg_id` để gửi lại).

### Bảng nhật ký Polling `GET /api/jobs/:jobId`

| Lần Poll | Trạng thái Job | `done / total` | `accepted` | `rejected` | `error` | `pending` |
|---:|---|---:|---:|---:|---:|---:|
| #1 | `running` | **0 / 25** | 0 | 0 | 0 | 25 |
| #2 | `running` | **2 / 25** | 2 | 0 | 0 | 23 |
| #3 | `running` | **3 / 25** | 3 | 0 | 0 | 22 |
| #4 | `running` | **5 / 25** | 4 | 1 | 0 | 20 |
| #5 | `running` | **7 / 25** | 6 | 1 | 0 | 18 |
| #6 | `running` | **9 / 25** | 8 | 1 | 0 | 16 |
| #7 | `running` | **11 / 25** | 10 | 1 | 0 | 14 |
| #8 | `running` | **13 / 25** | 11 | 2 | 0 | 12 |
| #9 | `running` | **15 / 25** | 13 | 2 | 0 | 10 |
| #10 | `running` | **17 / 25** | 15 | 2 | 0 | 8 |
| #11 | `running` | **19 / 25** | 16 | 3 | 0 | 6 |
| #12 | `running` | **21 / 25** | 18 | 3 | 0 | 4 |
| #13 | `running` | **22 / 25** | 19 | 3 | 0 | 3 |
| #14 | `running` | **24 / 25** | 21 | 3 | 0 | 1 |
| #15 | `completed` | **25 / 25** | 21 | 3 | 1 | 0 |

### Bảng kết quả toàn bộ 25 giấy trong Batch (`finalJob.items`)

| STT | Cert ID | Mã `SO` | Trạng thái sau Batch | `msg_id` | `attempts` | HTTP | `res_code` | `errors_json` / `warnings_json` / `last_error` |
|---:|---:|---|---|---|---:|---:|---|---|
| 1 | 1 | `TEST.75001.S9.BATCH.01` | `accepted` | `75001261123ddecffd5b1ba4c5699d3036b4cc300e7` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 2 | 2 | `TEST.75001.S9.BATCH.02` | `accepted` | `750012611237803461d3aab47f49a07d6a7a740b76e` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 3 | 3 | `TEST.75001.S9.BATCH.03` | `accepted` | `750012611231d0a9483d7404beb9193407c57486e74` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 4 | 4 | `TEST.75001.S9.BATCH.04` | `accepted` | `75001261123963c7e7155f943cda756c2b020f650c2` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 5 | 5 | `TEST.75001.S9.BATCH.05` | `rejected` | `75001261123931b31b820604fbdb6f5182b6eb6275d` | 1 | 200 | `PS_SYNC_SUCCESS` | `errors=[{"code":"GKSK_FACILITY_MISMATCH","field":"IDBENHVIEN"}]` |
| 6 | 6 | `TEST.75001.S9.BATCH.06` | `accepted` | `75001261123fe78634f2a94449e812866785599a877` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 7 | 7 | `TEST.75001.S9.BATCH.07` | `accepted` | `75001261123f6edc2c21b7441bbbf7d5a8baba8e9dd` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 8 | 8 | `TEST.75001.S9.BATCH.08` | `accepted` | `7500126112354a9b60949d840d79b3aa6741bd5b9ea` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 9 | 9 | `TEST.75001.S9.BATCH.09` | `accepted` | `750012611239af53072915b4efcba0e5cce2a3150b5` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 10 | 10 | `TEST.75001.S9.BATCH.10` | `accepted` | `75001261123c1edc64849d54e698a9ef59d97a40ac8` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 11 | 11 | `TEST.75001.S9.BATCH.11` | `accepted` | `75001261123eb87ceae5528412f865b851652f50b87` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 12 | 12 | `TEST.75001.S9.BATCH.12` | `rejected` | `7500126112359aa922f20da45008582a3da73482dc5` | 1 | 200 | `PS_SYNC_SUCCESS` | `errors=[{"code":"GKSK_HOTEN_INVALID","field":"HOTEN"}]` |
| 13 | 13 | `TEST.75001.S9.BATCH.13` | `accepted` | `75001261123df8d3eea794240a48c056b8c9a449277` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 14 | 14 | `TEST.75001.S9.BATCH.14` | `accepted` | `750012611234391b8bff118426e9e50fe994ff32a8f` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 15 | 15 | `TEST.75001.S9.BATCH.15` | `accepted` | `75001261123ae33683facd64b5a8a20b2cb482a2075` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 16 | 16 | `TEST.75001.S9.BATCH.16` | `accepted` | `750012611230b8a621f411c46b6abaee71c5a23df6f` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 17 | 17 | `TEST.75001.S9.BATCH.17` | `accepted` | `75001261123dd0363f60cba4812bf9e304656d67584` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 18 | 18 | `TEST.75001.S9.BATCH.18` | `accepted` | `75001261123ac26a0902e6a4cbeba2d147b6bc0faa4` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 19 | 19 | `TEST.75001.S9.BATCH.19` | `rejected` | `75001261123d9414666edf3454d94b58989d33d3034` | 1 | 200 | `PS_SYNC_SUCCESS` | `errors=[{"code":"GKSK_KETLUAN_MISSING","field":"KETLUAN"}]` |
| 20 | 20 | `TEST.75001.S9.BATCH.20` | `accepted` | `75001261123e2a9a1ccfcc5475fb430597fe61e0d86` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 21 | 21 | `TEST.75001.S9.BATCH.21` | `accepted` | `75001261123d95ff82b650843218f1f2f3f0252775e` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 22 | 22 | `TEST.75001.S9.BATCH.22` | `accepted` | `750012611232a6cfff4e69f437bbb197b7ff941ca85` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 23 | 23 | `TEST.75001.S9.BATCH.23` | `accepted` | `75001261123289ce3f91a054f4e889ae5cb70c7739b` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 24 | 24 | `TEST.75001.S9.BATCH.24` | `accepted` | `75001261123fab21a7283b1455caab2d4e990b16fc0` | 1 | 200 | `PS_SYNC_SUCCESS` | `warnings=[{"code":"GKSK_UNSIGNED","field":null}]` |
| 25 | 25 | `TEST.75001.S9.BATCH.25` | `error` | `75001261123ce7da6d1dc2d4fceae3ecf0728a7f2c3` | 4 | 500 | `PS_DS_SAVE_FAIL` | `lastError=[TRANSIENT:http_5xx HTTP 500 (PS_DS_SAVE_FAIL)] Lỗi máy chủ Hệ thống Sở (HTTP 500 PS_DS_SAVE_FAIL): Lỗi lưu dữ liệu tạm thời trên Hệ thống Sở` |

---

## 3. Kiểm chứng Tra lại trạng thái (`POST /api/submissions/:id/refresh`) & Gửi lại Giấy lỗi mạng (`#25`)

1. **Tra lại trạng thái giấy `#01` (`accepted`)**:
   - Endpoint: `POST /api/submissions/1/refresh`
   - Kết quả: `found = true`, `status = accepted`, `httpStatus = 200`, `resCode = CM_SUCCESS`, `server_submission_id = 8f5410ba-0577-4a01-b686-a6befaba3829`.
2. **Tra lại trạng thái giấy `#05` (`rejected`)**:
   - Endpoint: `POST /api/submissions/5/refresh`
   - Kết quả: `found = true`, `status = rejected`, `errors_json = [{"code":"GKSK_FACILITY_MISMATCH","field":"IDBENHVIEN"}]`.
3. **Gửi lại giấy `#25` sau khi mạng phục hồi (`POST /api/certificates/25/send`)**:
   - Trước khi gửi lại: `status = error`, `msg_id = 75001261123ce7da6d1dc2d4fceae3ecf0728a7f2c3`, `attempts = 4`, `result_status = null`.
   - Sau khi gửi lại: `status = accepted`, `reusedPendingSubmission = true`, **giữ nguyên 100% `msg_id = 75001261123ce7da6d1dc2d4fceae3ecf0728a7f2c3`**, tổng `attempts = 5`, `server_certificate_id = 25ff71d9-21ee-47b5-890a-45e36102fd3d`.

---

## 4. Kiểm toán Lịch sử Submissions trong DB (`gksk_submissions`) & Không lộ PII trong Log

- Tổng số giấy trong DB sau khi gửi lại giấy `#25`: **25 giấy** (`accepted = 22`, `rejected = 3`, `error = 0`, `sending = 0`).
- Tổng số dòng log JSON `pino` đã kiểm tra: **85 dòng** — tuyệt đối không chứa `HOTEN`, `SOCMND_PASSPORT`, `NONGDOCON`, `MATUY`, `LYDO`, `TINHTRANGBENH`, `data` Base64 hay `Bearer` token.

### Trích xuất 5 dòng log JSON Pino mẫu (chỉ chứa siêu dữ liệu an toàn)

```json
{"level":40,"time":"2026-11-23T13:32:37.781Z","service":"gksk-server","certificateId":1,"so":"TEST.75001.S9.INVALID.01","status":"invalid","blockingCodes":["GKSK_NGAYSINH_INVALID"],"msg":"Chặn gửi giấy GKSK do có lỗi dữ liệu chặn (invalid)"}
{"level":30,"time":"2026-11-23T13:32:37.819Z","service":"gksk-server","username":"75001","httpStatus":200,"resCode":"CM_SUCCESS","durationMinutes":720,"msg":"Đăng nhập cổng GKSK thành công"}
{"level":30,"time":"2026-11-23T13:32:37.834Z","service":"gksk-server","msgId":"7500126112310b7abe3a3894636b18ad98162bd728d","senderId":"75001","httpStatus":200,"resCode":"PS_SYNC_SUCCESS","resultStatus":"accepted","submissionId":"ffc8d952-b1b7-41b1-9e2e-2caf7687bc29","certificateId":"35e61907-edc6-4ffe-af66-3d1f5859f8b2","errorCodes":[],"warningCodes":["GKSK_UNSIGNED"],"msg":"Nhận phản hồi xử lý gói tin GKSK từ Hệ thống Sở"}
{"level":30,"time":"2026-11-23T13:32:37.835Z","service":"gksk-server","certificateId":2,"so":"TEST.75001.S9.POSTMAN.201","submissionId":1,"msgId":"7500126112310b7abe3a3894636b18ad98162bd728d","status":"accepted","attempts":1,"reusedPendingSubmission":false,"recoveredViaStatus":false,"serverSubmissionId":"ffc8d952-b1b7-41b1-9e2e-2caf7687bc29","serverCertificateId":"35e61907-edc6-4ffe-af66-3d1f5859f8b2","errorCodes":[],"warningCodes":["GKSK_UNSIGNED"],"msg":"Hoàn tất xử lý gửi giấy GKSK"}
{"level":40,"time":"2026-11-23T13:32:37.848Z","service":"gksk-server","msgId":"750012611235f761bdefee448bf8039ec9401e069aa","senderId":"75001","httpStatus":500,"resCode":"PS_DS_SAVE_FAIL","kind":"transient","reason":"http_5xx","msg":"Phản hồi lỗi HTTP khi đẩy gói tin GKSK"}
```
