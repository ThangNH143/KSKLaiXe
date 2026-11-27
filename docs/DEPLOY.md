# Hướng dẫn Triển khai & Vận hành — GKSKLaiXe v1.0.0 (Windows Server + MSSQL)

> Tài liệu dành cho quản trị hệ thống (IT) tại Cơ sở y tế (CSYT) triển khai ứng dụng **GKSKLaiXe** (Import Excel → Kiểm tra & Đối soát → Xuất XML/ZIP → Đẩy cổng Sở Y tế Đồng Nai) trên **Windows Server** với **Microsoft SQL Server (MSSQL)**.

---

## 1. Yêu cầu Hạ tầng & Phần mềm

| Thành phần | Yêu cầu tối thiểu | Ghi chú |
|---|---|---|
| Hệ điều hành | Windows Server 2016 / 2019 / 2022 (64-bit) | Có quyền Administrator để cài dịch vụ nền |
| Node.js | **Node.js ≥ 20 LTS** (khuyến nghị `20.x` hoặc `22.x` LTS) | Kiểm tra bằng `node -v` và `npm -v` |
| Cơ sở dữ liệu | **Microsoft SQL Server 2016 trở lên** (Express / Standard / Enterprise) | Hỗ trợ `OPENJSON` và `JSON_VALUE` (có sẵn từ SQL Server 2016+, compatibility level ≥ 130) |
| Kết nối mạng | Ra ngoài HTTPS (cổng `443`) tới địa chỉ API Sở Y tế Đồng Nai (`https://ksktd.dongnai.gov.vn`) | Nội bộ chỉ mở cổng HTTPS (Reverse Proxy) cho nhân viên y tế |
| RAM / Ổ đĩa | Tối thiểu 2 GB RAM, 5 GB trống | Ứng dụng chạy 1 tiến trình Node/Express duy nhất, tiêu thụ ~80–150 MB RAM |

---

## 2. Chuẩn bị Cơ sở dữ liệu MSSQL & Phân quyền Tài khoản SQL (`gksk_*`)

Ứng dụng thiết kế **an toàn tuyệt đối** để chạy trên cả **Database riêng** (`GKSKLaiXe`) lẫn **Database dùng chung** trên máy chủ SQL Server hiện tại:
- 100% bảng đều có tiền tố **`gksk_`**:
  1. `dbo.gksk_schema_migrations`
  2. `dbo.gksk_import_batches`
  3. `dbo.gksk_certificates`
  4. `dbo.gksk_submissions`
  5. `dbo.gksk_users`
- Khi khởi động, server tự động chạy các migration `server/src/db/migrations/001_init.sql` và `002_users.sql` với chốt chặn `IF OBJECT_ID(...) IS NULL` — **không bao giờ** chạy `DROP TABLE`, `TRUNCATE`, hay ảnh hưởng đến các bảng khác.
- Tài khoản khai báo trong `.env` (`APP_LOGIN_USER` + `APP_LOGIN_PASSWORD_HASH` hoặc `APP_LOGIN_PASSWORD`) sẽ được **tự động khởi tạo (seed)** vào bảng `dbo.gksk_users` ngay khi server khởi động nếu chưa tồn tại.

### 2.1 Tạo Database (khuyến nghị tạo DB riêng) và tài khoản SQL riêng

Mở **SQL Server Management Studio (SSMS)** hoặc `sqlcmd`, chạy kịch bản sau (thay mật khẩu mạnh của đơn vị):

```sql
-- 1. Tạo Database riêng (bỏ qua nếu dùng chung DB sẵn có)
IF DB_ID(N'GKSKLaiXe') IS NULL
BEGIN
  CREATE DATABASE [GKSKLaiXe];
END;
GO

ALTER DATABASE [GKSKLaiXe] SET COMPATIBILITY_LEVEL = 130; -- Tối thiểu 130 (SQL Server 2016+)
GO

-- 2. Tạo SQL Login riêng cho ứng dụng (KHÔNG dùng tài khoản sa trong production)
USE [master];
GO
IF SUSER_ID(N'gksk_app_user') IS NULL
BEGIN
  CREATE LOGIN [gksk_app_user]
    WITH PASSWORD = N'THAY_BANG_MAT_KHAU_MANH_TAI_DAY!2026',
         CHECK_POLICY = ON,
         CHECK_EXPIRATION = OFF;
END;
GO

-- 3. Cấp quyền tối thiểu trong Database GKSKLaiXe
USE [GKSKLaiXe];
GO
IF USER_ID(N'gksk_app_user') IS NULL
BEGIN
  CREATE USER [gksk_app_user] FOR LOGIN [gksk_app_user];
END;
GO

-- Quyền khởi tạo 4 bảng gksk_* lần đầu (migration 001_init.sql, gồm cả FOREIGN KEY) và đọc/ghi dữ liệu:
ALTER ROLE [db_datareader] ADD MEMBER [gksk_app_user];
ALTER ROLE [db_datawriter] ADD MEMBER [gksk_app_user];
ALTER ROLE [db_ddladmin] ADD MEMBER [gksk_app_user];
GO
```

> **Mẹo bảo mật tăng cường**: Sau khi chạy server lần đầu để migration tạo xong 4 bảng `dbo.gksk_*` và 3 chỉ mục `ix_gksk_*`, quản trị viên có thể thu hồi quyền `CREATE TABLE` / `ALTER ON SCHEMA::[dbo]` của `gksk_app_user` (chỉ giữ `db_datareader` và `db_datawriter`). Khi nâng cấp phiên bản mới có migration mới thì tạm cấp lại.

### 2.2 Bật TCP/IP cho SQL Server
1. Mở **SQL Server Configuration Manager** → **SQL Server Network Configuration** → **Protocols for MSSQLSERVER** (hoặc tên instance của bạn).
2. Bật **TCP/IP = Enabled** → nhấp đúp chọn tab **IP Addresses** → kéo xuống mục **IPAll**, đặt **TCP Port = 1433**.
3. Khởi động lại dịch vụ **SQL Server**.

---

## 3. Cài đặt Mã nguồn & Build bản Production

Giả sử thư mục triển khai là `C:\Apps\GKSKLaiXe`:

```powershell
cd C:\Apps\GKSKLaiXe

# 1. Cài đặt dependencies
npm ci

# 2. Biên dịch toàn bộ bản production (packages/shared + server/dist + client/dist)
npm run build
```

Sau khi `npm run build` hoàn tất:
- Backend đã biên dịch nằm tại `server\dist\index.js`.
- Frontend tĩnh (React + Vite) đã đóng gói nằm tại `client\dist\index.html` và `client\dist\assets\*`.
- Khi chạy với `NODE_ENV=production`, **một tiến trình duy nhất** `node server/dist/index.js` sẽ phục vụ **cả giao diện web lẫn `/api/*` trên cùng một cổng** (`PORT`, mặc định `3001`).

---

## 4. Cấu hình File Môi trường (`.env`)

Sao chép `.env.example` thành `.env` tại thư mục gốc `C:\Apps\GKSKLaiXe\.env`:

```powershell
Copy-Item .env.example .env
```

### 4.1 Tạo chuỗi `APP_LOGIN_PASSWORD_HASH` (bcrypt) và `SESSION_SECRET`

Chạy 2 lệnh sau trong PowerShell tại thư mục dự án (thay `MatKhauDangNhapWeb` bằng mật khẩu nội bộ của đơn vị):

```powershell
# Tạo hash bcrypt cho mật khẩu đăng nhập web (cost = 10)
node -e "import('bcryptjs').then(m => console.log(m.default.hashSync('MatKhauDangNhapWeb', 10)))"

# Tạo chuỗi SESSION_SECRET ngẫu nhiên 64 ký tự hex
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### 4.2 Mẫu file `.env` hoàn chỉnh cho Production

```env
NODE_ENV=production
APP_ENV=production
PORT=3001
LOG_LEVEL=info

# --- Kết nối MSSQL ---
DB_HOST=127.0.0.1
DB_PORT=1433
DB_USER=gksk_app_user
DB_PASSWORD=THAY_BANG_MAT_KHAU_MANH_TAI_DAY!2026
DB_NAME=GKSKLaiXe
DB_ENCRYPT=false
DB_TRUST_SERVER_CERT=true

# --- Tài khoản CSYT trên Cổng Sở Y tế Đồng Nai ---
# Khi APP_ENV=production, bắt buộc dùng https:// (không có dấu / ở cuối)
GKSK_BASE_URL=https://ksktd.dongnai.gov.vn
GKSK_USERNAME=75xxx
GKSK_PASSWORD=MAT_KHAU_TAI_KHOAN_CSYT
GKSK_FACILITY_ID=75xxx
GKSK_FACILITY_NAME=Ten Co So Y Te Cua Don Vi
# Để trống sẽ tự lấy bằng GKSK_FACILITY_ID
GKSK_SENDER_ID=
# Tùy chọn: trỏ tới file .pem nếu Sở Y tế đã cấp/đăng ký khóa RSA cho CSYT
GKSK_PRIVATE_KEY_PATH=
GKSK_HTTP_TIMEOUT_MS=30000

# --- Tài khoản đăng nhập nội bộ ứng dụng web ---
APP_LOGIN_USER=admin
APP_LOGIN_PASSWORD_HASH=$2b$10$...DAN_CHUOI_BCRYPT_VAO_DAY...
SESSION_SECRET=...DAN_CHUOI_64_KY_TU_NGU_NHIEN_VAO_DAY...
# Đặt true nếu chạy mạng LAN nội bộ qua HTTP (vd http://192.168.1.140/KSKLaiXe), đặt false nếu có HTTPS
ALLOW_INSECURE_COOKIE=false

# Đặt /KSKLaiXe trước khi chạy `npm run build` nếu chạy dưới Subpath IIS (http://<ip>/KSKLaiXe); để trống nếu chạy ở "/"
VITE_BASE_PATH=
```

> **Bảo vệ file `.env`**: Cấp quyền NTFS chỉ cho tài khoản chạy dịch vụ Windows (SYSTEM / Service Account) và Administrators được đọc file `.env`. Không bao giờ chia sẻ hoặc commit `.env` lên git.

### 4.3 Kiểm tra kết nối MSSQL trước khi bật dịch vụ

```powershell
npm run test:mssql
```
Nếu thấy thông báo `[test:mssql] PASS 100% trên MSSQL thật...`, kết nối SQL Server và 4 bảng `dbo.gksk_*` đã sẵn sàng.

### 4.4 Tạo / Đặt lại Mật khẩu Tài khoản Người dùng trong MSSQL (`dbo.gksk_users`)

Ứng dụng xác thực người dùng qua bảng `dbo.gksk_users` (kèm dự phòng tài khoản trong `.env`). Quản trị viên có thể tạo nhanh tài khoản mới (ví dụ `thangnh`) hoặc đặt lại mật khẩu trực tiếp trên Windows Server bằng lệnh:

```powershell
# Tạo mới hoặc đặt lại mật khẩu cho tài khoản thangnh trong bảng dbo.gksk_users
npm run user:set -- thangnh MatKhauMoi@2026 "Nguyễn Hoàng Thắng"
```

Sau khi đăng nhập vào giao diện web, người dùng có thể bấm nút **⚙️ Hệ thống & Tài khoản** trên thanh điều hướng để:
1. **Kiểm tra kết nối Cổng Sở Y tế & Database MSSQL** (xác nhận tài khoản CSYT đăng nhập thành công lên `ksktd.dongnai.gov.vn` và kiểm tra trạng thái 5 bảng `dbo.gksk_*` trước khi đẩy dữ liệu thật).
2. **Quản trị người dùng** (thêm tài khoản mới cho nhân viên, đặt lại mật khẩu, khóa/mở khóa tài khoản).
3. **Đổi mật khẩu cá nhân** ngay trên giao diện web.

---

## 5. Chạy Dịch vụ Nền trên Windows Server (PM2 hoặc NSSM)

Khuyến nghị chọn **một trong hai** phương án dưới đây để ứng dụng tự khởi động cùng Windows và tự phục hồi khi có sự cố:

### Phương án A — Dùng NSSM (Non-Sucking Service Manager — Khuyến nghị cho Windows Server)

1. Tải `nssm.exe` (64-bit) đặt tại `C:\Tools\nssm\nssm.exe`.
2. Tạo thư mục log: `New-Item -ItemType Directory -Force C:\Apps\GKSKLaiXe\logs`.
3. Mở PowerShell quyền Administrator và đăng ký Windows Service:

```powershell
$nssm = "C:\Tools\nssm\nssm.exe"
$node = (Get-Command node.exe).Source

& $nssm install GKSKLaiXe $node "C:\Apps\GKSKLaiXe\server\dist\index.js"
& $nssm set GKSKLaiXe AppDirectory "C:\Apps\GKSKLaiXe"
& $nssm set GKSKLaiXe AppEnvironmentExtra "NODE_ENV=production"
& $nssm set GKSKLaiXe DisplayName "GKSKLaiXe - Cong dong bo GKSK Lai xe Dong Nai"
& $nssm set GKSKLaiXe Start SERVICE_AUTO_START

# Ghi log stdout/stderr & tự xoay vòng log khi file > 10 MB
& $nssm set GKSKLaiXe AppStdout "C:\Apps\GKSKLaiXe\logs\stdout.log"
& $nssm set GKSKLaiXe AppStderr "C:\Apps\GKSKLaiXe\logs\stderr.log"
& $nssm set GKSKLaiXe AppRotateFiles 1
& $nssm set GKSKLaiXe AppRotateOnline 1
& $nssm set GKSKLaiXe AppRotateBytes 10485760

& $nssm start GKSKLaiXe
```

### Phương án B — Dùng PM2

1. Cài PM2 toàn cục: `npm install -g pm2 pm2-windows-startup`
2. Tạo file `ecosystem.config.cjs` tại `C:\Apps\GKSKLaiXe\`:

```js
module.exports = {
  apps: [
    {
      name: 'gksk-laixe',
      script: 'server/dist/index.js',
      cwd: 'C:\\Apps\\GKSKLaiXe',
      instances: 1, // Giữ 1 tiến trình vì hàng đợi batch job & session lưu trong bộ nhớ
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      out_file: 'C:\\Apps\\GKSKLaiXe\\logs\\out.log',
      error_file: 'C:\\Apps\\GKSKLaiXe\\logs\\err.log',
      merge_logs: true,
      max_memory_restart: '512M',
    },
  ],
};
```

3. Khởi chạy và cài tự xoay vòng log (`pm2-logrotate`):

```powershell
pm2 start ecosystem.config.cjs
pm2 save
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
pm2-startup install
```

> **Lưu ý quan trọng**: Không chạy cluster nhiều worker (`instances > 1`) vì hàng đợi gửi hàng loạt (`JobService`) và phiên đăng nhập (`SessionStore`) lưu trên bộ nhớ tiến trình.

---

## 6. Cấu hình Reverse Proxy HTTPS (IIS hoặc Caddy / Nginx)

Ứng dụng lắng nghe nội bộ tại `http://127.0.0.1:3001`. Trong môi trường `APP_ENV=production`, cookie phiên có cờ `Secure`, do đó **bắt buộc** đặt ứng dụng sau Reverse Proxy HTTPS:

### Phương án 1 — Caddy (nhanh gọn, tự cấp hoặc dùng chứng chỉ nội bộ)

Tạo `C:\Tools\caddy\Caddyfile`:

```caddyfile
gksk.noibo.benhvien.local {
    tls C:\Certs\gksk.crt C:\Certs\gksk.key
    reverse_proxy 127.0.0.1:3001 {
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-For {remote_host}
    }
}
```

### Phương án 2 — IIS (Application Request Routing + URL Rewrite ở đường dẫn gốc `/`)

1. Cài **URL Rewrite 2.1** và **Application Request Routing (ARR) 3.0** trên IIS.
2. Tạo Website mới trên IIS gán binding **HTTPS (port 443)** với chứng chỉ SSL của đơn vị.
3. Bật Proxy trong ARR (`Server Proxy Settings` → tick **Enable proxy**).
4. Tạo rule **Reverse Proxy** chuyển toàn bộ request tới `http://127.0.0.1:3001/{R:1}` và giữ nguyên header `X-Forwarded-Proto: https`.

### Phương án 3 — Chạy dưới Subpath trên IIS có sẵn (`http://192.168.1.140/KSKLaiXe` — Mạng LAN nội bộ không cần DNS / không cần cài SSL)

Khi máy chủ Windows Server đang chạy sẵn IIS ở cổng 80 (`Default Web Site`) phục vụ nhiều dự án `.NET` và `Node.js` khác nhau theo dạng `http://<ip-server>/<TenDuAn>`:

1. **Cấu hình `.env` tại `C:\Apps\GKSKLaiXe\.env`**:
   ```env
   APP_ENV=production
   PORT=3001
   ALLOW_INSECURE_COOKIE=true
   VITE_BASE_PATH=/KSKLaiXe
   ```
   *(Lưu ý: Không đặt `NODE_ENV=production` bên trong file `.env` vì Vite sẽ cảnh báo khi chạy `npm run build`; biến `NODE_ENV=production` đã được NSSM/PM2 truyền sẵn cho tiến trình Node).*
2. **Build bản Frontend nhận Subpath `/KSKLaiXe`**:
   ```powershell
   cd C:\Apps\GKSKLaiXe
   npm run build
   nssm restart GKSKLaiXe
   ```
   *(Lưu ý: Server Express đã hỗ trợ phục vụ song song cả ở `/` lẫn `/KSKLaiXe` và cả `/api/*` lẫn `/KSKLaiXe/api/*`, nên dù IIS rewrite có cắt hay giữ tiền tố `/KSKLaiXe` đều hoạt động 100%.)*
3. **Cấu hình IIS dưới `Default Web Site`**:
   - Tạo một thư mục trống dành riêng làm điểm gắn IIS (tuyệt đối không trỏ vào `C:\Apps\GKSKLaiXe`):
     ```powershell
     New-Item -ItemType Directory -Force "C:\inetpub\proxies\KSKLaiXe"
     ```
   - Mở **IIS Manager** → chuột phải vào **Default Web Site** → **Add Application...** (hoặc **Add Virtual Directory...**):
     - **Alias**: `KSKLaiXe`
     - **Physical path**: `C:\inetpub\proxies\KSKLaiXe`
   - Tạo file `C:\inetpub\proxies\KSKLaiXe\web.config` với nội dung:
     ```xml
     <?xml version="1.0" encoding="UTF-8"?>
     <configuration>
       <system.webServer>
         <security>
           <requestFiltering>
             <requestLimits maxAllowedContentLength="10485760" />
           </requestFiltering>
         </security>
         <rewrite>
           <rules>
             <rule name="ReverseProxyGKSKLaiXeSubpath" stopProcessing="true">
               <match url="(.*)" />
               <action type="Rewrite" url="http://127.0.0.1:3001/{R:1}" />
             </rule>
           </rules>
         </rewrite>
       </system.webServer>
     </configuration>
     ```
   - Từ bất kỳ máy trạm nào trong mạng LAN, mở trình duyệt truy cập: **`http://192.168.1.140/KSKLaiXe`** là sử dụng được ngay!

### 6.1 Nhật ký Sự cố Thường gặp & Cách Xử lý khi Deploy IIS Subpath / NSSM (Troubleshooting)

| # | Triệu chứng / Thông báo lỗi | Nguyên nhân gốc | Cách khắc phục dứt điểm |
|---|---|---|---|
| 1 | Khi bấm **Test Settings...** lúc tạo **Add Application** trong IIS Manager xuất hiện cảnh báo vàng: `Authorization — Cannot verify access to path (C:\inetpub\proxies\KSKLaiXe)` | IIS dùng `Pass-through authentication` với tài khoản ảo của Application Pool (`Default_Static_Pool` / `IUSR`), nên hộp thoại Test Settings không tự giả lập kiểm tra quyền trước được. | Bấm **Close → OK** để tiếp tục và cấp quyền đọc `web.config` cho nhóm `IIS_IUSRS` & `IUSR`:<br>`icacls "C:\inetpub\proxies\KSKLaiXe" /grant "IIS_IUSRS:(OI)(CI)RX" /grant "IUSR:(OI)(CI)RX"` |
| 2 | Truy cập `http://192.168.1.140/KSKLaiXe` báo `Cannot GET /` hoặc không thấy file `C:\Apps\GKSKLaiXe\logs\stdout.log` | 1. Cổng `PORT` trong `.env` (ví dụ `PORT=3002`) lệch với cổng trong `web.config` (`http://127.0.0.1:3001/{R:1}`).<br>2. File `.env` bị dính dòng ```` ```env ```` khi copy-paste.<br>3. Thư mục `C:\Apps\GKSKLaiXe\logs` chưa được tạo trước khi chạy `nssm start`. | 1. Đồng bộ đúng số cổng `PORT` giữa `.env` và `web.config`.<br>2. Xóa các ký tự markdown ```` ``` ```` trong `.env`.<br>3. Tạo thư mục log: `New-Item -ItemType Directory -Force "C:\Apps\GKSKLaiXe\logs"` rồi chạy `nssm restart GKSKLaiXe`. |
| 3 | Khi chạy `npm run build` xuất hiện cảnh báo: `NODE_ENV=production is not supported in the .env file. Only NODE_ENV=development is supported...` | Vite 6 không cho phép khai báo `NODE_ENV=production` trong file `.env` (Vite tự động dùng `production` khi chạy `vite build`). | Xóa dòng `NODE_ENV=production` khỏi file `.env`. Biến `NODE_ENV=production` chỉ cần đặt trong `AppEnvironmentExtra` của NSSM (hoặc `ecosystem.config.cjs` của PM2). |
| 4 | Truy cập `http://192.168.1.140/KSKLaiXe` tải được tiêu đề tab nhưng **màn hình trắng tinh**; mở F12 Console thấy lỗi: `Failed to load resource: net::ERR_CERT_AUTHORITY_INVALID` cho `/KSKLaiXe/assets/index-*.js`/`.css`, kèm cảnh báo `Cross-Origin-Opener-Policy` và `Origin-Agent-Cluster` | Khi chạy qua IP mạng LAN bằng HTTP thường (`http://192.168.1.140`), mặc định `helmet()` gửi header `Content-Security-Policy: ... upgrade-insecure-requests` và `Strict-Transport-Security`, khiến trình duyệt tự động ép đổi link tải `.js`/`.css` sang `https://192.168.1.140/...` (va vào chứng chỉ tự ký của IIS nên bị chặn). | Đặt **`ALLOW_INSECURE_COOKIE=true`** trong `.env` và `nssm restart GKSKLaiXe`. Khi biến này bật (`[Commit #22]`), server tự động tắt directive `upgrade-insecure-requests`, `hsts`, `crossOriginOpenerPolicy` và `originAgentCluster` trên HTTP LAN (giữ nguyên các rule CSP chống XSS khác). Nếu trình duyệt đã lỡ nhớ HSTS cho IP đó, xóa cache hoặc vào `chrome://net-internals/#hsts` (hoặc `edge://net-internals/#hsts`) → mục **Delete domain security policies** → nhập `192.168.1.140` → bấm **Delete**, sau đó nhấn `Ctrl + F5`. |
| 5 | Đăng nhập báo lỗi `401 (Unauthorized) — Tên đăng nhập hoặc mật khẩu không đúng` (ví dụ khi đăng nhập bằng `thangnh` mà `.env` đang để `APP_LOGIN_USER=admin` hoặc chuỗi `APP_LOGIN_PASSWORD_HASH` bị lỗi ký tự `$`) | Tài khoản `thangnh` chưa được tạo trong bảng `dbo.gksk_users` hoặc mật khẩu trong `.env` không khớp. | **Cách 1 (Khuyến nghị)**: Chạy lệnh tạo/đặt mật khẩu trực tiếp vào bảng `dbo.gksk_users` trên server (không cần restart NSSM):<br>`npm run user:set -- thangnh MatKhauCuaBan "Nguyễn Hoàng Thắng"`<br>**Cách 2**: Trong file `.env`, đặt `APP_LOGIN_USER=thangnh` và dùng trực tiếp `APP_LOGIN_PASSWORD=MatKhauCuaBan` (hoặc `APP_LOGIN_PASSWORD_HASH=...`), sau đó chạy `nssm restart GKSKLaiXe` — server sẽ tự động băm bcrypt và seed tài khoản `thangnh` vào `dbo.gksk_users`. |
| 6 | Khi bấm **Đẩy cổng** hoặc **Kiểm tra kết nối SYT** báo lỗi `HTTP 403` dù đăng nhập trực tiếp trên cổng web MasterFlow (`https://ksktd.dongnai.gov.vn`) vẫn bình thường | Có 3 nguyên nhân phổ biến:<br>1. Sửa `GKSK_PASSWORD` trong `.env` nhưng chưa chạy `nssm restart GKSKLaiXe`, hoặc mật khẩu có ký tự `#` không bọc trong dấu ngoặc kép `"..."` khiến `dotenv` cắt cụt phần sau dấu `#`.<br>2. Đổi mật khẩu ở tab *"Đổi mật khẩu của tôi"* trên web GKSKLaiXe (đây là mật khẩu nội bộ của app, không phải `GKSK_PASSWORD` của cổng Sở).<br>3. Đăng nhập `/api/auth/login` thành công (HTTP 200) nhưng khi gọi `/api/platform/gksk-lai-xe/push` bị `HTTP 403 (CM_PERMISSION_DENY)` do mã `GKSK_SENDER_ID` khác mã người gửi đã đăng ký trên MasterFlow, hoặc tài khoản CSYT chưa được MasterHive bật quyền dịch vụ `sync_gksk_lai_xe`. | Bấm nút **⚙️ Hệ thống & Tài khoản** → tab **🔌 Kiểm tra kết nối SYT & DB**:<br>1. Nhập lại **Tài khoản CSYT (`GKSK_USERNAME`)**, **Mật khẩu CSYT (`GKSK_PASSWORD`)**, **Mã người gửi (`GKSK_SENDER_ID`)** ngay trên giao diện và bấm **💾 Lưu cấu hình CSYT & Kiểm tra ngay** (hệ thống tự động cập nhật nóng trên RAM, ghi vào `.env` có bọc ngoặc kép `"..."` an toàn và xóa cache token cũ mà không cần restart NSSM), hoặc bấm **🔄 Đọc lại file `.env` trên máy chủ**.<br>2. Xem kết quả **Chẩn đoán 2 bước**: nếu Bước 1 (`POST /api/auth/login`) lỗi 403 thì kiểm tra lại tài khoản/mật khẩu tích hợp API; nếu Bước 1 báo `✅ HTTP 200 CM_SUCCESS` nhưng Bước 2 (`/api/platform/gksk-lai-xe/*`) báo `HTTP 403 CM_PERMISSION_DENY` thì mật khẩu đã đúng 100%, cần kiểm tra lại `GKSK_SENDER_ID` hoặc báo MasterHive cấp quyền API GKSK lái xe cho mã CSYT. |

---

## 7. Sao lưu CSDL, Xoay vòng Log & Bảo trì Định kỳ

### 7.1 Sao lưu MSSQL hàng ngày
Tạo **SQL Server Agent Job** (hoặc **Windows Task Scheduler** chạy `sqlcmd` vào 02:00 sáng hàng ngày):

```powershell
$date = Get-Date -Format "yyyyMMdd"
sqlcmd -S 127.0.0.1 -E -Q "BACKUP DATABASE [GKSKLaiXe] TO DISK = N'D:\Backups\MSSQL\GKSKLaiXe_$date.bak' WITH COMPRESSION, INIT, STATS = 10;"
# Xóa bản sao lưu cũ hơn 30 ngày
Get-ChildItem "D:\Backups\MSSQL\GKSKLaiXe_*.bak" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
```

> **Bảo mật bản sao lưu**: Bảng `dbo.gksk_certificates` chứa dữ liệu khám sức khỏe cá nhân (`fields_json`). Thư mục `D:\Backups\MSSQL\` phải được phân quyền truy cập hạn chế và sao lưu ra ổ đĩa dự phòng an toàn.

### 7.2 Xoay vòng Log (`pino`)
- Log của ứng dụng đã được cấu hình `redact` tự động (tuyệt đối không ghi họ tên, CCCD, nồng độ cồn, ma túy, token CSYT hay mật khẩu).
- Dùng **NSSM `AppRotateBytes`** hoặc **`pm2-logrotate`** (mục 5) để tự cắt file mỗi 10 MB và giữ tối đa 30 ngày.

### 7.3 Quy trình Đổi Mật khẩu & Khóa RSA

| Việc cần đổi | Thao tác |
|---|---|
| **Đổi mật khẩu đăng nhập Webapp** | Tạo hash bcrypt mới (mục 4.1) → cập nhật `APP_LOGIN_PASSWORD_HASH` trong `.env` → khởi động lại dịch vụ (`nssm restart GKSKLaiXe` hoặc `pm2 restart gksk-laixe`). |
| **Đổi `SESSION_SECRET`** | Sinh chuỗi ngẫu nhiên mới → cập nhật `SESSION_SECRET` trong `.env` → khởi động lại dịch vụ (mọi phiên đăng nhập cũ sẽ tự hết hiệu lực và yêu cầu đăng nhập lại). |
| **Đổi mật khẩu tài khoản CSYT Sở Y tế** | Cập nhật `GKSK_PASSWORD` trong `.env` → khởi động lại dịch vụ. |
| **Cài / Đổi khóa riêng RSA gói tin** | Lưu file `.pem` vào thư mục bảo mật (vd `C:\Apps\GKSKLaiXe\certs\csyt-private.pem`, phân quyền chỉ đọc cho service account) → khai báo đường dẫn vào `GKSK_PRIVATE_KEY_PATH` trong `.env` → khởi động lại dịch vụ. |
| **Nâng cấp Node.js / Phiên bản app** | 1. Sao lưu DB MSSQL → 2. Dừng dịch vụ → 3. Cập nhật Node LTS hoặc mã nguồn mới → 4. Chạy `npm ci && npm run build` → 5. Chạy `npm run test:mssql` kiểm tra → 6. Khởi động lại dịch vụ và kiểm tra `GET /api/health`. |
