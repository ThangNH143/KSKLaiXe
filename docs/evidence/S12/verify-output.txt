# Báo cáo kiểm chứng bảo mật bước S12 — Xác thực ứng dụng (server)

- Thời điểm chạy: `2026-11-25`
- Tổng số route phát hiện tự động từ Express router: **20**
- Route công khai (`/api/health`, `/api/config`): **2**
- Route xác thực (`/api/auth/*`): **3**
- Route nghiệp vụ được bảo vệ bởi `requireAuth`: **15/15 (100% trả HTTP 401 khi chưa đăng nhập)**
- Route ghi được bảo vệ bởi CSRF `X-Requested-With: gksk`: **9/9 (100% trả HTTP 403 khi thiếu header)**

## 1. Bảng quét bảo mật toàn bộ Express Router

| # | Method | Route | Phân loại | Chưa đăng nhập (HTTP) | Thiếu `X-Requested-With` (HTTP) | Kết quả |
|---|---|---|---|---|---|---|
| 1 | `GET` | `/api/health` | Công khai (Public) | `200` | `N/A (GET)` | ✅ PASS |
| 2 | `GET` | `/api/config` | Công khai (Public) | `200` | `N/A (GET)` | ✅ PASS |
| 3 | `POST` | `/api/auth/login` | Xác thực (Auth) | `400` | `403 (CSRF_HEADER_REQUIRED)` | ✅ PASS |
| 4 | `POST` | `/api/auth/logout` | Xác thực (Auth) | `200` | `403 (CSRF_HEADER_REQUIRED)` | ✅ PASS |
| 5 | `GET` | `/api/auth/me` | Xác thực (Auth) | `401` | `N/A (GET)` | ✅ PASS |
| 6 | `GET` | `/api/import/template` | Nghiệp vụ (Protected) | `401` | `N/A (GET)` | ✅ PASS |
| 7 | `POST` | `/api/import/excel` | Nghiệp vụ (Protected) | `401` | `403 (CSRF_HEADER_REQUIRED)` | ✅ PASS |
| 8 | `POST` | `/api/import/commit` | Nghiệp vụ (Protected) | `401` | `403 (CSRF_HEADER_REQUIRED)` | ✅ PASS |
| 9 | `GET` | `/api/batches` | Nghiệp vụ (Protected) | `401` | `N/A (GET)` | ✅ PASS |
| 10 | `GET` | `/api/certificates` | Nghiệp vụ (Protected) | `401` | `N/A (GET)` | ✅ PASS |
| 11 | `GET` | `/api/certificates/export-excel` | Nghiệp vụ (Protected) | `401` | `N/A (GET)` | ✅ PASS |
| 12 | `POST` | `/api/certificates/xml-zip` | Nghiệp vụ (Protected) | `401` | `403 (CSRF_HEADER_REQUIRED)` | ✅ PASS |
| 13 | `GET` | `/api/certificates/:id` | Nghiệp vụ (Protected) | `401` | `N/A (GET)` | ✅ PASS |
| 14 | `DELETE` | `/api/certificates/:id` | Nghiệp vụ (Protected) | `401` | `403 (CSRF_HEADER_REQUIRED)` | ✅ PASS |
| 15 | `GET` | `/api/certificates/:id/xml` | Nghiệp vụ (Protected) | `401` | `N/A (GET)` | ✅ PASS |
| 16 | `GET` | `/api/certificates/:id/submissions` | Nghiệp vụ (Protected) | `401` | `N/A (GET)` | ✅ PASS |
| 17 | `POST` | `/api/certificates/:id/send` | Nghiệp vụ (Protected) | `401` | `403 (CSRF_HEADER_REQUIRED)` | ✅ PASS |
| 18 | `POST` | `/api/send` | Nghiệp vụ (Protected) | `401` | `403 (CSRF_HEADER_REQUIRED)` | ✅ PASS |
| 19 | `GET` | `/api/jobs/:jobId` | Nghiệp vụ (Protected) | `401` | `N/A (GET)` | ✅ PASS |
| 20 | `POST` | `/api/submissions/:id/refresh` | Nghiệp vụ (Protected) | `401` | `403 (CSRF_HEADER_REQUIRED)` | ✅ PASS |

## 2. Kiểm tra Cookie phiên, `/api/config` và `helmet`

- **Cookie ở chế độ `APP_ENV=test` (HTTP nội bộ):** `HttpOnly` ✅ · `SameSite=Lax` ✅ · `Path=/` ✅ · `Max-Age=28800` (8 giờ) ✅
- **Cookie ở chế độ `APP_ENV=production`:** `HttpOnly` ✅ · `SameSite=Lax` ✅ · `Secure` ✅
- **Phản hồi `GET /api/config`:** `{"appEnv":"test","facilityId":"75001","facilityName":"Benh vien Da khoa Dong Nai","baseUrlHost":"gksk-test.dongnai.gov.vn"}` (chỉ đúng 4 khóa công khai, 0 mật khẩu/token/đường dẫn khóa/DB) ✅
- **Header bảo mật `helmet`:** `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`, `x-powered-by: <ẩn>` ✅

## 3. Kiểm tra giới hạn đăng nhập sai (10 lần / 15 phút / IP → HTTP 429)

| Lần thử | HTTP Status | Mã lỗi | Header `Retry-After` (giây) |
|---|---|---|---|
| #1 | `401` | `INVALID_CREDENTIALS` | `—` |
| #2 | `401` | `INVALID_CREDENTIALS` | `—` |
| #3 | `401` | `INVALID_CREDENTIALS` | `—` |
| #4 | `401` | `INVALID_CREDENTIALS` | `—` |
| #5 | `401` | `INVALID_CREDENTIALS` | `—` |
| #6 | `401` | `INVALID_CREDENTIALS` | `—` |
| #7 | `401` | `INVALID_CREDENTIALS` | `—` |
| #8 | `401` | `INVALID_CREDENTIALS` | `—` |
| #9 | `401` | `INVALID_CREDENTIALS` | `—` |
| #10 | `401` | `INVALID_CREDENTIALS` | `—` |
| #11 | `429` | `TOO_MANY_LOGIN_ATTEMPTS` | `900` |

- Sau khi hết cửa sổ 15 phút (đồng hồ giả `+901s`): đăng nhập bằng mật khẩu đúng trả **HTTP 200** ✅

## 4. Kết luận

- **100% hạng mục kiểm chứng bảo mật bước S12 ĐẠT (PASS).**
