# Báo cáo Kiểm chứng S7 — GKSK Client (`login`, `push`, `status`, `retry`) & Nhật ký Dòng thời gian (`timeline`)

- **Thời gian chạy kiểm chứng**: `2026-11-23T12:39:31.000Z`
- **Môi trường kiểm thử**: `GkskClient` (`server/src/gksk/{client,errors,retry}.ts`) kết nối trực tiếp vào `Mock Server` (`tools/mock-gksk-api/src/app.ts`)
- **Tổng số tình huống thực thi**: **6/6 PASS (100%)**
- **Kiểm tra bảo mật Log (`pino`)**: **PASS** (18 dòng log JSON, `0` lần xuất hiện token / `Authorization` / mật khẩu / PII)
- **Quét tĩnh `console.log` trong `server/src`**: **PASS** (`0` kết quả)

## 1. Bảng tổng hợp 6 tình huống kiểm chứng thực tế

| Mã | Tình huống | Chế độ Mock | `msg_id` (lần 1 vs lần cuối) | Số lần gọi `push` | Thu hồi qua `status`? | Khoảng chờ (`sleep`) | Kết quả cuối (`kind`) | Đánh giá |
|---|---|---|---|---:|---|---|---|
| `S7-01` | Gửi giấy hợp lệ (chưa ký số) → Accepted + cảnh báo GKSK_UNSIGNED | `Bình thường (HTTP 200 PS_SYNC_SUCCESS)` | `75001261123572cea84f4e545daa1818cff1ff5928e` (Giữ nguyên 100%) | 1 | `false` | `0ms` | **`accepted`** | PASS |
| `S7-02` | Giấy bị từ chối (HTTP 200 data.status=rejected) → Không retry | `IDBENHVIEN=75999 !== 75001 (GKSK_FACILITY_MISMATCH)` | `7500126112309777f02cb5642079c706fe1ee724b5f` (Giữ nguyên 100%) | 1 | `false` | `0ms` | **`rejected`** | PASS |
| `S7-03` | Timeout lần 1 → Chờ 5s → Gọi status (404) → Push lại cùng msg_id thành công | `POST /__mock/fail { mode: "timeout", count: 1 }` | `75001261123e218871eac394577b509574657b77f9e` (Giữ nguyên 100%) | 2 | `false` | `5000ms` | **`accepted`** | PASS |
| `S7-04` | Mất kết nối sau khi Server đã lưu → Gọi status (200) thu hồi kết quả, KHÔNG push lần 2 | `POST /__mock/fail { mode: "disconnect-after-save", count: 1 }` | `75001261123105c8d0ddb9443fc978ba10d5055206f` (Giữ nguyên 100%) | 1 | `true` | `5000ms` | **`accepted`** | PASS |
| `S7-05` | Gặp HTTP 429 (Retry-After: 2) → Chờ đúng 2000ms → Push lại cùng msg_id | `POST /__mock/fail { mode: "429", count: 1, retryAfterSec: 2 }` | `75001261123686568209c1f4cbe8fa4f6376ac455fd` (Giữ nguyên 100%) | 2 | `false` | `2000ms` | **`accepted`** | PASS |
| `S7-06` | Gặp HTTP 403 (token hết hạn) → Tự đăng nhập lại 1 lần → Push lại cùng msg_id | `POST /__mock/fail { mode: "403-once", count: 1 }` | `750012611237b2035c9f01c417fa1a3b0ff99a8983c` (Giữ nguyên 100%) | 2 | `false` | `0ms` | **`accepted`** | PASS |

---

## 2. Nhật ký dòng thời gian (`timeline`) chi tiết từng tình huống

### S7-01: Gửi giấy hợp lệ (chưa ký số) → Accepted + cảnh báo GKSK_UNSIGNED

- **Chế độ Mock**: `Bình thường (HTTP 200 PS_SYNC_SUCCESS)`
- **`msg_id` ban đầu**: `75001261123572cea84f4e545daa1818cff1ff5928e`
- **`msg_id` kết thúc**: `75001261123572cea84f4e545daa1818cff1ff5928e` (Khớp 100% — không tạo mới msg_id khi retry)
- **`send_datetime`**: `1795420800000`
- **Kết quả phân loại**: `kind = "accepted"`, `attempts = 1`, `recoveredViaStatus = false`
- **Tóm tắt kiểm chứng**: kind=accepted, attempts=1, warnings=[GKSK_UNSIGNED], token được cache tới now + 720p - 5p.

#### A. Dòng thời gian phía `GkskClient` (`result.timeline`)

| Bước (`step`) | Mốc đồng hồ (`timestampMs`) | Hành động (`action`) | HTTP Status | `res_code` | Chờ (`delayMs`) | Chi tiết (`detail`) |
|---:|---:|---|---:|---|---:|---|
| 1 | `1795420800000` | `login_request` | — | `—` | — | POST /api/auth/login (username=75001) |
| 2 | `1795420800000` | `login_success` | 200 | `CM_SUCCESS` | — | Đăng nhập thành công (duration=720 phút, cache tới now + 720p - 5p) |
| 3 | `1795420800000` | `push_request` | — | `—` | — | POST /api/platform/gksk-lai-xe/push (msg_id=75001261123572cea84f4e545daa1818cff1ff5928e, send_datetime=1795420800000) |
| 4 | `1795420800000` | `push_response` | 200 | `PS_SYNC_SUCCESS` | — | HTTP 200 (PS_SYNC_SUCCESS) -> data.status=accepted (errors=0, warnings=1) |

#### B. Đối chiếu các gói tin `POST /push` đã gửi lên Mock Server

| Lần gửi `push` | `header.msg_id` | `header.send_datetime` | `data` (24 ký tự đầu Base64) | `signature` |
|---:|---|---:|---|---|
| #1 | `75001261123572cea84f4e545daa1818cff1ff5928e` | `1795420800000` | `PD94bWwgdmVyc2lvbj0iMS4w...` | `CHUA-KY-6B9CB42F3B8B7430` |

#### C. Nhật ký Request ghi nhận tại Mock Server (`GET /__mock/state`)

| # | Method & Path | `msg_id` | HTTP Status | Ghi chú tại Mock (`note`) |
|---:|---|---|---:|---|
| 1 | `POST /api/auth/login` | `—` | 200 | `login_success` |
| 2 | `POST /api/platform/gksk-lai-xe/push` | `75001261123572cea84f4e545daa1818cff1ff5928e` | 200 | `push_accepted` |

### S7-02: Giấy bị từ chối (HTTP 200 data.status=rejected) → Không retry

- **Chế độ Mock**: `IDBENHVIEN=75999 !== 75001 (GKSK_FACILITY_MISMATCH)`
- **`msg_id` ban đầu**: `7500126112309777f02cb5642079c706fe1ee724b5f`
- **`msg_id` kết thúc**: `7500126112309777f02cb5642079c706fe1ee724b5f` (Khớp 100% — không tạo mới msg_id khi retry)
- **`send_datetime`**: `1795421700000`
- **Kết quả phân loại**: `kind = "rejected"`, `attempts = 1`, `recoveredViaStatus = false`
- **Tóm tắt kiểm chứng**: kind=rejected (dù HTTP 200 PS_SYNC_SUCCESS), errors=[GKSK_FACILITY_MISMATCH], attempts=1, không retry.

#### A. Dòng thời gian phía `GkskClient` (`result.timeline`)

| Bước (`step`) | Mốc đồng hồ (`timestampMs`) | Hành động (`action`) | HTTP Status | `res_code` | Chờ (`delayMs`) | Chi tiết (`detail`) |
|---:|---:|---|---:|---|---:|---|
| 1 | `1795421700000` | `login_request` | — | `—` | — | POST /api/auth/login (username=75001) |
| 2 | `1795421700000` | `login_success` | 200 | `CM_SUCCESS` | — | Đăng nhập thành công (duration=720 phút, cache tới now + 720p - 5p) |
| 3 | `1795421700000` | `push_request` | — | `—` | — | POST /api/platform/gksk-lai-xe/push (msg_id=7500126112309777f02cb5642079c706fe1ee724b5f, send_datetime=1795421700000) |
| 4 | `1795421700000` | `push_response` | 200 | `PS_SYNC_SUCCESS` | — | HTTP 200 (PS_SYNC_SUCCESS) -> data.status=rejected (errors=1, warnings=1) |

#### B. Đối chiếu các gói tin `POST /push` đã gửi lên Mock Server

| Lần gửi `push` | `header.msg_id` | `header.send_datetime` | `data` (24 ký tự đầu Base64) | `signature` |
|---:|---|---:|---|---|
| #1 | `7500126112309777f02cb5642079c706fe1ee724b5f` | `1795421700000` | `PD94bWwgdmVyc2lvbj0iMS4w...` | `CHUA-KY-0179CA1FDEBF3505` |

#### C. Nhật ký Request ghi nhận tại Mock Server (`GET /__mock/state`)

| # | Method & Path | `msg_id` | HTTP Status | Ghi chú tại Mock (`note`) |
|---:|---|---|---:|---|
| 1 | `POST /api/auth/login` | `—` | 200 | `login_success` |
| 2 | `POST /api/platform/gksk-lai-xe/push` | `7500126112309777f02cb5642079c706fe1ee724b5f` | 200 | `push_rejected` |

### S7-03: Timeout lần 1 → Chờ 5s → Gọi status (404) → Push lại cùng msg_id thành công

- **Chế độ Mock**: `POST /__mock/fail { mode: "timeout", count: 1 }`
- **`msg_id` ban đầu**: `75001261123e218871eac394577b509574657b77f9e`
- **`msg_id` kết thúc**: `75001261123e218871eac394577b509574657b77f9e` (Khớp 100% — không tạo mới msg_id khi retry)
- **`send_datetime`**: `1795422600000`
- **Kết quả phân loại**: `kind = "accepted"`, `attempts = 2`, `recoveredViaStatus = false`
- **Tóm tắt kiểm chứng**: Attempt 1 timeout (AbortController 60ms) -> sleep 5000ms -> GET /status trả 404 -> Attempt 2 push giữ nguyên 100% msg_id, send_datetime, data, signature -> HTTP 200 accepted.

#### A. Dòng thời gian phía `GkskClient` (`result.timeline`)

| Bước (`step`) | Mốc đồng hồ (`timestampMs`) | Hành động (`action`) | HTTP Status | `res_code` | Chờ (`delayMs`) | Chi tiết (`detail`) |
|---:|---:|---|---:|---|---:|---|
| 1 | `1795422600000` | `login_request` | — | `—` | — | POST /api/auth/login (username=75001) |
| 2 | `1795422600000` | `login_success` | 200 | `CM_SUCCESS` | — | Đăng nhập thành công (duration=720 phút, cache tới now + 720p - 5p) |
| 3 | `1795422600000` | `push_request` | — | `—` | — | POST /api/platform/gksk-lai-xe/push (msg_id=75001261123e218871eac394577b509574657b77f9e, send_datetime=1795422600000) |
| 4 | `1795422600000` | `push_error` | — | `—` | — | Lỗi mạng khi push (timeout): Quá thời gian chờ phản hồi (60ms) |
| 5 | `1795422600000` | `retry_sleep` | — | `—` | 5000ms | Chờ 5000ms trước lần thử lại #1/3 (lý do: timeout) |
| 6 | `1795422605000` | `status_request` | — | `—` | — | GET /api/platform/gksk-lai-xe/status?msg_id=75001261123e218871eac394577b509574657b77f9e |
| 7 | `1795422605000` | `status_response` | 404 | `CM_INVALID_REQUEST` | — | HTTP 404 (CM_INVALID_REQUEST): không tìm thấy gói tin -> cần push lại cùng msg_id |
| 8 | `1795422605000` | `push_request` | — | `—` | — | POST /api/platform/gksk-lai-xe/push (msg_id=75001261123e218871eac394577b509574657b77f9e, send_datetime=1795422600000) |
| 9 | `1795422605000` | `push_response` | 200 | `PS_SYNC_SUCCESS` | — | HTTP 200 (PS_SYNC_SUCCESS) -> data.status=accepted (errors=0, warnings=1) |

#### B. Đối chiếu các gói tin `POST /push` đã gửi lên Mock Server

| Lần gửi `push` | `header.msg_id` | `header.send_datetime` | `data` (24 ký tự đầu Base64) | `signature` |
|---:|---|---:|---|---|
| #1 | `75001261123e218871eac394577b509574657b77f9e` | `1795422600000` | `PD94bWwgdmVyc2lvbj0iMS4w...` | `CHUA-KY-B6B9D4235756073E` |
| #2 | `75001261123e218871eac394577b509574657b77f9e` | `1795422600000` | `PD94bWwgdmVyc2lvbj0iMS4w...` | `CHUA-KY-B6B9D4235756073E` |

#### C. Nhật ký Request ghi nhận tại Mock Server (`GET /__mock/state`)

| # | Method & Path | `msg_id` | HTTP Status | Ghi chú tại Mock (`note`) |
|---:|---|---|---:|---|
| 1 | `POST /api/auth/login` | `—` | 200 | `login_success` |
| 2 | `POST /api/platform/gksk-lai-xe/push` | `75001261123e218871eac394577b509574657b77f9e` | *(timeout/disconnect)* | `mock_fail_timeout_300ms` |
| 3 | `GET /api/platform/gksk-lai-xe/status` | `75001261123e218871eac394577b509574657b77f9e` | 404 | `status_not_found` |
| 4 | `POST /api/platform/gksk-lai-xe/push` | `75001261123e218871eac394577b509574657b77f9e` | 200 | `push_accepted` |

### S7-04: Mất kết nối sau khi Server đã lưu → Gọi status (200) thu hồi kết quả, KHÔNG push lần 2

- **Chế độ Mock**: `POST /__mock/fail { mode: "disconnect-after-save", count: 1 }`
- **`msg_id` ban đầu**: `75001261123105c8d0ddb9443fc978ba10d5055206f`
- **`msg_id` kết thúc**: `75001261123105c8d0ddb9443fc978ba10d5055206f` (Khớp 100% — không tạo mới msg_id khi retry)
- **`send_datetime`**: `1795423500000`
- **Kết quả phân loại**: `kind = "accepted"`, `attempts = 1`, `recoveredViaStatus = true`
- **Tóm tắt kiểm chứng**: Attempt 1 bị ngắt socket sau khi Mock đã lưu -> sleep 5000ms -> GET /status trả HTTP 200 (accepted) -> thu hồi kết quả luôn (recoveredViaStatus=true), tuyệt đối không push lần 2.

#### A. Dòng thời gian phía `GkskClient` (`result.timeline`)

| Bước (`step`) | Mốc đồng hồ (`timestampMs`) | Hành động (`action`) | HTTP Status | `res_code` | Chờ (`delayMs`) | Chi tiết (`detail`) |
|---:|---:|---|---:|---|---:|---|
| 1 | `1795423500000` | `login_request` | — | `—` | — | POST /api/auth/login (username=75001) |
| 2 | `1795423500000` | `login_success` | 200 | `CM_SUCCESS` | — | Đăng nhập thành công (duration=720 phút, cache tới now + 720p - 5p) |
| 3 | `1795423500000` | `push_request` | — | `—` | — | POST /api/platform/gksk-lai-xe/push (msg_id=75001261123105c8d0ddb9443fc978ba10d5055206f, send_datetime=1795423500000) |
| 4 | `1795423500000` | `push_error` | — | `—` | — | Lỗi mạng khi push (network_error): Lỗi kết nối mạng tới Hệ thống Sở |
| 5 | `1795423500000` | `retry_sleep` | — | `—` | 5000ms | Chờ 5000ms trước lần thử lại #1/3 (lý do: network_error) |
| 6 | `1795423505000` | `status_request` | — | `—` | — | GET /api/platform/gksk-lai-xe/status?msg_id=75001261123105c8d0ddb9443fc978ba10d5055206f |
| 7 | `1795423505000` | `status_response` | 200 | `CM_SUCCESS` | — | HTTP 200 (CM_SUCCESS) -> tìm thấy kết quả đã xử lý (data.status=accepted) |

#### B. Đối chiếu các gói tin `POST /push` đã gửi lên Mock Server

| Lần gửi `push` | `header.msg_id` | `header.send_datetime` | `data` (24 ký tự đầu Base64) | `signature` |
|---:|---|---:|---|---|
| #1 | `75001261123105c8d0ddb9443fc978ba10d5055206f` | `1795423500000` | `PD94bWwgdmVyc2lvbj0iMS4w...` | `CHUA-KY-E4221E0686D61B74` |

#### C. Nhật ký Request ghi nhận tại Mock Server (`GET /__mock/state`)

| # | Method & Path | `msg_id` | HTTP Status | Ghi chú tại Mock (`note`) |
|---:|---|---|---:|---|
| 1 | `POST /api/auth/login` | `—` | 200 | `login_success` |
| 2 | `POST /api/platform/gksk-lai-xe/push` | `75001261123105c8d0ddb9443fc978ba10d5055206f` | *(timeout/disconnect)* | `mock_fail_disconnect_after_save` |
| 3 | `GET /api/platform/gksk-lai-xe/status` | `75001261123105c8d0ddb9443fc978ba10d5055206f` | 200 | `status_found` |

### S7-05: Gặp HTTP 429 (Retry-After: 2) → Chờ đúng 2000ms → Push lại cùng msg_id

- **Chế độ Mock**: `POST /__mock/fail { mode: "429", count: 1, retryAfterSec: 2 }`
- **`msg_id` ban đầu**: `75001261123686568209c1f4cbe8fa4f6376ac455fd`
- **`msg_id` kết thúc**: `75001261123686568209c1f4cbe8fa4f6376ac455fd` (Khớp 100% — không tạo mới msg_id khi retry)
- **`send_datetime`**: `1795424400000`
- **Kết quả phân loại**: `kind = "accepted"`, `attempts = 2`, `recoveredViaStatus = false`
- **Tóm tắt kiểm chứng**: Attempt 1 nhận HTTP 429 kèm header Retry-After: 2 -> sleep đúng 2000ms -> Attempt 2 push lại cùng msg_id -> HTTP 200 accepted.

#### A. Dòng thời gian phía `GkskClient` (`result.timeline`)

| Bước (`step`) | Mốc đồng hồ (`timestampMs`) | Hành động (`action`) | HTTP Status | `res_code` | Chờ (`delayMs`) | Chi tiết (`detail`) |
|---:|---:|---|---:|---|---:|---|
| 1 | `1795424400000` | `login_request` | — | `—` | — | POST /api/auth/login (username=75001) |
| 2 | `1795424400000` | `login_success` | 200 | `CM_SUCCESS` | — | Đăng nhập thành công (duration=720 phút, cache tới now + 720p - 5p) |
| 3 | `1795424400000` | `push_request` | — | `—` | — | POST /api/platform/gksk-lai-xe/push (msg_id=75001261123686568209c1f4cbe8fa4f6376ac455fd, send_datetime=1795424400000) |
| 4 | `1795424400000` | `push_response` | 429 | `CM_TOO_MANY_REQUESTS` | — | HTTP 429 (CM_TOO_MANY_REQUESTS) Retry-After=2s |
| 5 | `1795424400000` | `retry_sleep` | 429 | `CM_TOO_MANY_REQUESTS` | 2000ms | Chờ 2000ms trước lần thử lại #1/3 (lý do: http_429) |
| 6 | `1795424402000` | `push_request` | — | `—` | — | POST /api/platform/gksk-lai-xe/push (msg_id=75001261123686568209c1f4cbe8fa4f6376ac455fd, send_datetime=1795424400000) |
| 7 | `1795424402000` | `push_response` | 200 | `PS_SYNC_SUCCESS` | — | HTTP 200 (PS_SYNC_SUCCESS) -> data.status=accepted (errors=0, warnings=1) |

#### B. Đối chiếu các gói tin `POST /push` đã gửi lên Mock Server

| Lần gửi `push` | `header.msg_id` | `header.send_datetime` | `data` (24 ký tự đầu Base64) | `signature` |
|---:|---|---:|---|---|
| #1 | `75001261123686568209c1f4cbe8fa4f6376ac455fd` | `1795424400000` | `PD94bWwgdmVyc2lvbj0iMS4w...` | `CHUA-KY-72006EB5EBF22AF2` |
| #2 | `75001261123686568209c1f4cbe8fa4f6376ac455fd` | `1795424400000` | `PD94bWwgdmVyc2lvbj0iMS4w...` | `CHUA-KY-72006EB5EBF22AF2` |

#### C. Nhật ký Request ghi nhận tại Mock Server (`GET /__mock/state`)

| # | Method & Path | `msg_id` | HTTP Status | Ghi chú tại Mock (`note`) |
|---:|---|---|---:|---|
| 1 | `POST /api/auth/login` | `—` | 200 | `login_success` |
| 2 | `POST /api/platform/gksk-lai-xe/push` | `75001261123686568209c1f4cbe8fa4f6376ac455fd` | 429 | `mock_fail_429_retry_after_2` |
| 3 | `POST /api/platform/gksk-lai-xe/push` | `75001261123686568209c1f4cbe8fa4f6376ac455fd` | 200 | `push_accepted` |

### S7-06: Gặp HTTP 403 (token hết hạn) → Tự đăng nhập lại 1 lần → Push lại cùng msg_id

- **Chế độ Mock**: `POST /__mock/fail { mode: "403-once", count: 1 }`
- **`msg_id` ban đầu**: `750012611237b2035c9f01c417fa1a3b0ff99a8983c`
- **`msg_id` kết thúc**: `750012611237b2035c9f01c417fa1a3b0ff99a8983c` (Khớp 100% — không tạo mới msg_id khi retry)
- **`send_datetime`**: `1795425300000`
- **Kết quả phân loại**: `kind = "accepted"`, `attempts = 2`, `recoveredViaStatus = false`
- **Tóm tắt kiểm chứng**: Attempt 1 nhận HTTP 403 (CM_PERMISSION_DENY) -> xóa cache token, gọi POST /api/auth/login lại đúng 1 lần -> Attempt 2 push lại cùng msg_id -> HTTP 200 accepted.

#### A. Dòng thời gian phía `GkskClient` (`result.timeline`)

| Bước (`step`) | Mốc đồng hồ (`timestampMs`) | Hành động (`action`) | HTTP Status | `res_code` | Chờ (`delayMs`) | Chi tiết (`detail`) |
|---:|---:|---|---:|---|---:|---|
| 1 | `1795425300000` | `login_request` | — | `—` | — | POST /api/auth/login (username=75001) |
| 2 | `1795425300000` | `login_success` | 200 | `CM_SUCCESS` | — | Đăng nhập thành công (duration=720 phút, cache tới now + 720p - 5p) |
| 3 | `1795425300000` | `push_request` | — | `—` | — | POST /api/platform/gksk-lai-xe/push (msg_id=750012611237b2035c9f01c417fa1a3b0ff99a8983c, send_datetime=1795425300000) |
| 4 | `1795425300000` | `push_response` | 403 | `CM_PERMISSION_DENY` | — | HTTP 403 (CM_PERMISSION_DENY) |
| 5 | `1795425300000` | `relogin_on_403` | 403 | `CM_PERMISSION_DENY` | — | Gặp HTTP 403 khi push -> đăng nhập lại đúng 1 lần rồi gửi lại cùng msg_id |
| 6 | `1795425300000` | `login_request` | — | `—` | — | POST /api/auth/login (username=75001, forceRefresh=true) |
| 7 | `1795425300000` | `login_success` | 200 | `CM_SUCCESS` | — | Đăng nhập thành công (duration=720 phút, cache tới now + 720p - 5p) |
| 8 | `1795425300000` | `push_request` | — | `—` | — | POST /api/platform/gksk-lai-xe/push (msg_id=750012611237b2035c9f01c417fa1a3b0ff99a8983c, send_datetime=1795425300000) |
| 9 | `1795425300000` | `push_response` | 200 | `PS_SYNC_SUCCESS` | — | HTTP 200 (PS_SYNC_SUCCESS) -> data.status=accepted (errors=0, warnings=1) |

#### B. Đối chiếu các gói tin `POST /push` đã gửi lên Mock Server

| Lần gửi `push` | `header.msg_id` | `header.send_datetime` | `data` (24 ký tự đầu Base64) | `signature` |
|---:|---|---:|---|---|
| #1 | `750012611237b2035c9f01c417fa1a3b0ff99a8983c` | `1795425300000` | `PD94bWwgdmVyc2lvbj0iMS4w...` | `CHUA-KY-49CC646E6CE0AB6B` |
| #2 | `750012611237b2035c9f01c417fa1a3b0ff99a8983c` | `1795425300000` | `PD94bWwgdmVyc2lvbj0iMS4w...` | `CHUA-KY-49CC646E6CE0AB6B` |

#### C. Nhật ký Request ghi nhận tại Mock Server (`GET /__mock/state`)

| # | Method & Path | `msg_id` | HTTP Status | Ghi chú tại Mock (`note`) |
|---:|---|---|---:|---|
| 1 | `POST /api/auth/login` | `—` | 200 | `login_success` |
| 2 | `POST /api/platform/gksk-lai-xe/push` | `750012611237b2035c9f01c417fa1a3b0ff99a8983c` | 403 | `mock_fail_403-once` |
| 3 | `POST /api/auth/login` | `—` | 200 | `login_success` |
| 4 | `POST /api/platform/gksk-lai-xe/push` | `750012611237b2035c9f01c417fa1a3b0ff99a8983c` | 200 | `push_accepted` |

---

## 3. Bằng chứng Kiểm tra Bảo mật Log & Quét tĩnh `console.log`

- **Số dòng log JSON thu thập từ `pino`**: `18` dòng.
- **Kiểm tra rò rỉ `mock-token-` / `Bearer ` / mật khẩu / họ tên / CCCD**: `0` lần xuất hiện (PASS).
- **Quét tĩnh `console.log` trong `server/src/**/*.ts`**: `0` file vi phạm (PASS).

### Trích xuất 6 dòng log JSON mẫu từ `pino` (chứng minh chỉ ghi `msgId`, `resCode`, `httpStatus`, không có token/PII)

```json
{"level":30,"time":"2026-11-23T12:39:30.789Z","service":"gksk-server","username":"75001","httpStatus":200,"resCode":"CM_SUCCESS","durationMinutes":720,"msg":"Đăng nhập cổng GKSK thành công"}
{"level":30,"time":"2026-11-23T12:39:30.802Z","service":"gksk-server","msgId":"75001261123572cea84f4e545daa1818cff1ff5928e","senderId":"75001","httpStatus":200,"resCode":"PS_SYNC_SUCCESS","resultStatus":"accepted","submissionId":"6a6f21a0-4c5d-4c4a-a864-05ccb7791e61","certificateId":"98b0251f-d559-437c-9c78-5c98168423da","errorCodes":[],"warningCodes":["GKSK_UNSIGNED"],"msg":"Nhận phản hồi xử lý gói tin GKSK từ Hệ thống Sở"}
{"level":30,"time":"2026-11-23T12:39:30.815Z","service":"gksk-server","username":"75001","httpStatus":200,"resCode":"CM_SUCCESS","durationMinutes":720,"msg":"Đăng nhập cổng GKSK thành công"}
{"level":30,"time":"2026-11-23T12:39:30.822Z","service":"gksk-server","msgId":"7500126112309777f02cb5642079c706fe1ee724b5f","senderId":"75001","httpStatus":200,"resCode":"PS_SYNC_SUCCESS","resultStatus":"rejected","submissionId":"924a80c6-a699-4eb0-be9c-edecac98c645","certificateId":null,"errorCodes":["GKSK_FACILITY_MISMATCH"],"warningCodes":["GKSK_UNSIGNED"],"msg":"Nhận phản hồi xử lý gói tin GKSK từ Hệ thống Sở"}
{"level":30,"time":"2026-11-23T12:39:30.834Z","service":"gksk-server","username":"75001","httpStatus":200,"resCode":"CM_SUCCESS","durationMinutes":720,"msg":"Đăng nhập cổng GKSK thành công"}
{"level":40,"time":"2026-11-23T12:39:30.911Z","service":"gksk-server","msgId":"75001261123e218871eac394577b509574657b77f9e","senderId":"75001","reason":"timeout","msg":"Lỗi kết nối khi đẩy gói tin GKSK"}
```
