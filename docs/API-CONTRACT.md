# API-CONTRACT.md — Hợp đồng API GKSK lái xe (bản chắt lọc)

> Nguồn: `docs/reference/tai_lieu_api_gksk_lai_xe_v1_0_1_md.md` (v1.0.1 Dự thảo, 18/11/2026). Mâu thuẫn → bản gốc thắng.
> Mọi dữ liệu mẫu trong tài liệu này là dữ liệu giả.

## 1. Endpoint

| Việc | Method | URI |
|---|---|---|
| Đăng nhập lấy token | `POST` | `{baseUrl}/api/auth/login` |
| Gửi một giấy | `POST` | `{baseUrl}/api/platform/gksk-lai-xe/push` |
| Tra kết quả theo `msg_id` | `GET` | `{baseUrl}/api/platform/gksk-lai-xe/status?msg_id=<msg_id>` |

Base URL production: `https://ksktd.dongnai.gov.vn`. Môi trường kiểm thử do Sở Y tế / MasterHive cấp riêng. **Chỉ gửi dữ liệu giả lên môi trường kiểm thử.**

## 2. Đăng nhập

Request:
```
POST /api/auth/login
Content-Type: application/json
{ "username": "<mã CSYT 5 số>", "password": "<mật khẩu>" }
```
Thành công (HTTP 200):
```json
{ "header": { "version": "1.0.6", "success": true, "res_code": "CM_SUCCESS", "res_msg": "..." },
  "data": { "token": "...", "refresh_token": "...", "duration": 720, "refresh_duration": 1440 } }
```
- `duration` tính bằng **phút** (720 = 12 giờ). Cache token tới `now + duration − 5 phút`.
- Sai tài khoản/mật khẩu: lỗi xác thực, **không có `data.token`** → báo lỗi cấu hình, không retry.
- Tài khoản Sở/phường-xã/trường học không dùng được.

## 3. Push — request

Header HTTP:

| Header | Giá trị |
|---|---|
| `Authorization` | `Bearer <token>` |
| `service-type` | `100` (thiếu → HTTP 400) |
| `Content-Type` | `application/json` |

Body (envelope):
```json
{
  "header": {
    "version": "1.0.6",
    "sender_id": "75001",
    "receiver_id": "TTYQG",
    "txn_type": "sync_gksk_lai_xe",
    "msg_id": "75001261118a3f1c2e4b5d64e7f8a9b0c1d2e3f4a5b",
    "msg_type": "101",
    "data_type": "xml/base64",
    "send_datetime": 1781084650736
  },
  "data": "<Base64 của file XML UTF-8>",
  "signature": "<xem §5>"
}
```

| Trường | Quy tắc |
|---|---|
| `version` | `1.0` hoặc `1.0.6` — app dùng `1.0.6` |
| `sender_id` | mã CSYT (hoặc mã người gửi đã đăng ký); chỉ chữ, số, `.` `_` `-`; khác CSYT của token → 403 |
| `receiver_id` | luôn `TTYQG` (khác → 400) |
| `txn_type` | luôn `sync_gksk_lai_xe` |
| `msg_type` | `101` |
| `data_type` | app dùng `xml/base64` (API còn nhận `json/base64`) |
| `send_datetime` | `Date.now()` — 13 chữ số, mili giây |
| `msg_id` | xem §4 |
| `data` | Base64 chuẩn (có padding `=`), của **byte UTF-8 nguyên file XML**, không sửa sau khi mã hóa. Tối đa 1 MB sau giải mã |

## 4. `msg_id`

`msg_id = sender_id + YYMMDD + uuidV4SansDash`

- `YYMMDD`: ngày hiện tại **theo giờ Việt Nam (UTC+7)**, tính bằng `new Date(Date.now()+7*3600*1000).toISOString()` (không dùng múi giờ máy).
- `uuidV4SansDash`: `crypto.randomUUID().replace(/-/g,'')` → 32 hexa, ký tự thứ 13 là `4`, ký tự thứ 17 ∈ {`8`,`9`,`a`,`b`}.
- Regex kiểm: `^<sender_id>\d{6}[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$`
- Ví dụ sender `75001`: độ dài = 5 + 6 + 32 = **43** ký tự.
- Mỗi lần gửi mới → `msg_id` mới. **Gửi lại do timeout/5xx/429 → giữ nguyên `msg_id`** (server trả lại đúng kết quả lần đầu, không ghi thêm).
- `msg_id` đã bị CSYT khác dùng → HTTP 409; sinh `msg_id` mới (xác suất gần bằng 0).

## 5. Chữ ký gói tin (`signature`) + GOLDEN VECTOR

Quy tắc (giống `docs/reference/tao_goi_tin_gksk.js`):

1. `headerJson = JSON.stringify(header)` — gọn, đúng thứ tự key ở §3, không escape `/` và Unicode thêm.
2. `H = SHA256_hex_UPPER(headerJson)`; `D = SHA256_hex_UPPER(data.trim())` (hash chuỗi **Base64**, UTF-8).
3. `signed = H + "." + D`
4. Có khóa bí mật: `signature = Base64( RSA-PKCS1v1.5-SHA256( signed ) )`.
   Không có khóa: `signature = "CHUA-KY-" + signed.slice(0,16)` (server hiện chỉ cần khác rỗng).
5. `signature` rỗng → HTTP 400 `PS_DS_RSA_SIGNATURE_MISSING`. Server bật kiểm chữ ký → sai → `PS_DS_RSA_SIGNATURE_INVALID`.

**Golden vector (bắt buộc có test khớp từng ký tự):**

```
header (thứ tự key này):
  version "1.0.6", sender_id "75001", receiver_id "TTYQG",
  txn_type "sync_gksk_lai_xe",
  msg_id "75001261123a3f1c2e4b5d44e7f8a9b0c1d2e3f4a5b",
  msg_type "101", data_type "xml/base64", send_datetime 1781084650736

headerJson =
{"version":"1.0.6","sender_id":"75001","receiver_id":"TTYQG","txn_type":"sync_gksk_lai_xe","msg_id":"75001261123a3f1c2e4b5d44e7f8a9b0c1d2e3f4a5b","msg_type":"101","data_type":"xml/base64","send_datetime":1781084650736}

xml     = <root><SO>TEST.75001.1</SO></root>
data    = PHJvb3Q+PFNPPlRFU1QuNzUwMDEuMTwvU08+PC9yb290Pg==

H       = 6A618CAF5E36F31A4A779636EB2C34E9C4FCE1FFF20BE0A29D39CC9C0F04EC8F
D       = 2D626275B6434A748DCF1A2A4A535C556C1C52EDDA981FE16967F937D599C11E
signed  = H + "." + D
signature (không khóa) = CHUA-KY-6A618CAF5E36F31A
```

Test RSA: sinh cặp khóa RSA 2048 trong test (`crypto.generateKeyPairSync`), ký `signed`, rồi `crypto.verify('sha256', Buffer.from(signed), publicKey, Buffer.from(signature,'base64'))` phải `true`.

## 6. Push — phản hồi (HTTP 200)

Khi envelope hợp lệ: `header.res_code` **luôn** `PS_SYNC_SUCCESS`, kể cả giấy bị từ chối.

```json
{
  "header": { "version":"1.0.6","sender_id":"TTYQG","receiver_id":"75001","txn_type":"sync_gksk_lai_xe",
              "res_code":"PS_SYNC_SUCCESS","res_msg":"...","msg_id":"TTYQG...","msg_type":"102",
              "ref_msg_id":"<msg_id đã gửi>","send_datetime":0,"res_datetime":0 },
  "data": { "status":"accepted|rejected", "submission_id":"uuid", "certificate_id":"uuid|null",
            "so":"string|null",
            "errors":[{"code":"GKSK_...","field":"TAG|null"}],
            "warnings":[{"code":"GKSK_...","field":"TAG|null"}] },
  "signature": "..."
}
```
- `accepted`: giấy đã lưu (có thể kèm `warnings`). `rejected`: không lưu, lý do ở `errors`.
- Kiểm `header.ref_msg_id === msg_id đã gửi`; lệch → coi là lỗi bất thường, không ghi đè kết quả.
- `errors`/`warnings` chỉ có mã + tên thẻ, **không có giá trị dữ liệu**.
- Parse **khoan dung**: trường lạ bỏ qua; thiếu `warnings`/`errors` → mảng rỗng.

## 7. Status

```
GET /api/platform/gksk-lai-xe/status?msg_id=<msg_id>
Authorization: Bearer <token>
```
- 200: `{ "code":"CM_SUCCESS", "message":"...", "data": { …giống hệt data của push… } }` — **không có `header`**.
- 404: `{ "code":"CM_INVALID_REQUEST", "message":"Không tìm thấy gói tin ...", "data": null }` → server chưa từng xử lý gói này.
- 403: `CM_PERMISSION_DENY`.
- Chỉ tìm trong các lần gửi của CSYT đang đăng nhập.
- Nếu giấy đã bị CSYT xóa trên Hệ thống Sở: `data.certificate_id` có thể là `null` dù `accepted`.

## 8. Lỗi envelope (giấy không được xử lý)

`header.res_code` + HTTP status; `header.res_msg` nêu trường sai/giá trị nhận được/giá trị đúng. Hiển thị `res_msg` cho người dùng (không chứa dữ liệu giấy).

| HTTP | `res_code` | Khi nào | Retry? |
|---|---|---|---|
| 400 | `CM_INVALID_REQUEST` | Envelope sai, `msg_id` sai quy tắc, `receiver_id` sai, Base64 hỏng, thiếu `service-type` | Không — lỗi lập trình, báo lỗi nội bộ |
| 400 | `PS_DS_RSA_SIGNATURE_MISSING` | `signature` rỗng | Không |
| 400 | `PS_DS_RSA_SIGNATURE_INVALID` | Sai chữ ký (khi server bật kiểm) | Không — kiểm tra khóa |
| 403 | `CM_PERMISSION_DENY` | Token sai/hết hạn/khóa; `sender_id` không thuộc CSYT; tài khoản trường học | Đăng nhập lại **1 lần** rồi thử lại |
| 409 | `CM_INVALID_REQUEST` | `msg_id` đã CSYT khác dùng | Sinh `msg_id` mới, thử 1 lần |
| 429 | `CM_TOO_MANY_REQUESTS` | Quá 300 gói/phút/CSYT hoặc 60 gói/giây toàn hệ thống | **Có**, chờ `Retry-After` giây, giữ `msg_id` |
| 500 | `PS_DS_SAVE_FAIL` | Lỗi phía hệ thống | **Có**, giữ `msg_id` |
| 5xx khác / timeout / mất mạng | — | Lỗi mạng | **Có**, giữ `msg_id` |

### Chính sách retry của app (chốt)

- Tối đa **3 lần thử lại**, chờ 5s → 15s → 45s (429 thì theo `Retry-After`, tối đa 120s).
- Trước mỗi lần gửi lại sau timeout/5xx: **gọi status với `msg_id` cũ**.
  - 200 → dùng kết quả đó, **không gửi lại**.
  - 404 → gửi lại cùng `msg_id` (cùng `send_datetime`, cùng `data`, cùng `signature`).
- Hết 3 lần mà vẫn lỗi → trạng thái giấy `error` (người dùng bấm "Gửi lại" sẽ lặp quy trình, **vẫn giữ `msg_id` nếu dữ liệu giấy chưa đổi**; dữ liệu đã đổi → `msg_id` mới).
- Gửi hàng loạt: **tuần tự**, tối đa 2 request song song, nghỉ ~250 ms giữa các lần (≈ dưới 300/phút). Gặp 429 → tạm dừng cả hàng đợi.

## 9. Mã từ chối giấy (`data.errors`, HTTP 200, `status=rejected`)

| Mã | Khi nào |
|---|---|
| `GKSK_XML_INVALID` | Không đọc được XML/JSON, có `DOCTYPE`, quá 1 MB, gốc `GIAMDINHHS`, XML không có thẻ `SO`, JSON không phẳng |
| `GKSK_SO_MISSING` | `SO` trống |
| `GKSK_SO_TOO_LONG` | `SO` > 30 ký tự (Sở nhận đến 30; BHXH quy định 20 nhưng ví dụ của chính BHXH dài 21 — xem DATA-SPEC §1) |
| `GKSK_FACILITY_MISMATCH` | `IDBENHVIEN` khác mã CSYT của tài khoản, hoặc trống |
| `GKSK_HOTEN_INVALID` | `HOTEN` trống hoặc > 255 ký tự |
| `GKSK_ID_MISSING` | `SOCMND_PASSPORT` trống |
| `GKSK_NGAYSINH_INVALID` | `NGAYSINH` không phải ngày `dd/MM/yyyy` hợp lệ, hoặc năm ngoài 1900…năm hiện tại |
| `GKSK_NGAYKETLUAN_INVALID` | `NGAYKETLUAN` không phải ngày `dd/MM/yyyy` |
| `GKSK_KETLUAN_MISSING` | `KETLUAN` trống |

## 10. Cảnh báo (`data.warnings`, giấy vẫn được lưu)

| Mã | Khi nào | Ghi chú cho app |
|---|---|---|
| `GKSK_UNSIGNED` | Không có chữ ký số | **Mong đợi ở v1** — hiển thị mức "thông tin", không phải lỗi |
| `GKSK_SIGNATURE_INVALID` | Chữ ký sai/không khớp nội dung | v1 không ký nên không gặp |
| `GKSK_SIGNED_DATA_MISMATCH` | JSON lệch `SIGNDATA` | v1 không gặp |
| `GKSK_UNKNOWN_TAG` | Thẻ không thuộc PL2 CV 3829 (bỏ không lưu) | Lỗi lập trình nếu gặp → báo |
| `GKSK_ID_INVALID` | Số giấy tờ không hợp lệ (toàn 0, 10/11 số…) → không gắn người | Cảnh báo người dùng |
| `GKSK_KETLUAN_UNKNOWN` | `KETLUAN` ∉ {A0-1, A0-2, A0-3} | |
| `GKSK_GIOITINH_UNKNOWN` | Giới tính ∉ {0,1} | |
| `GKSK_NONGDOCON_INVALID` | Không phải số | |
| `GKSK_DVINONGDOCON_INVALID` | ∉ {0,1} | |
| `GKSK_MATUY_INVALID` | ∉ {0,1} | |
| `GKSK_DATE_INVALID` | `NGAYKHAM`/`NGAYKHAMLAI`/`NGAYTHANGNAMCAP` không đọc được (lưu trống) | |
| `GKSK_FIELD_TOO_LONG` | Thẻ dài hơn đặc tả (vẫn lưu). Độ dài từng thẻ: cột **Max** ở `DATA-SPEC §1` (vd `SOCMND_PASSPORT` 12, `NOICAP` 30, `HANGBANGLAI` 10, mã tỉnh/huyện/xã 10) | App báo trước bằng `LOCAL_FIELD_OVER_SPEC` |
| `GKSK_STATE_ADD_EXISTS` | `STATE=ADD` nhưng số giấy đã có → **ghi đè** | Hiển thị rõ "đã ghi đè giấy cũ" |
| `GKSK_SKIPPED_STALE` | Đã có bản mới hơn → bản này **không** ghi đè | |

App có bảng `mã → tiếng Việt` ở `packages/shared/src/messages.ts`; mã lạ hiển thị nguyên mã.

## 11. Gắn người & dữ liệu nhạy cảm (ảnh hưởng thiết kế UI)

- Số giấy tờ 12 số (CCCD) hoặc 9 số (CMND) mà Hệ thống Sở chưa có → **tạo người mới**. Hộ chiếu/ký tự khác → không tạo người, giấy chờ gắn.
- `MATUY`, `NONGDOCON`, `LYDO`, `TINHTRANGBENH` là dữ liệu nhạy cảm: **không log, không hiển thị ở màn hình danh sách** (chỉ trong form chi tiết).

## 12. Postman ↔ app (đối chiếu hành vi mong đợi)

| Postman | Hành vi app/mock phải tái hiện |
|---|---|
| 2.1 | Gửi XML/JSON chưa ký → `accepted` + `GKSK_UNSIGNED` |
| 2.2 | Gửi lại cùng `msg_id` → cùng `submission_id` |
| 2.3 | Cùng `SO`, `msg_id` mới → `accepted`, cùng `certificate_id` |
| 3.1 / 3.2 | Status = `data` y hệt lúc push / 404 khi lạ |
| 4.1–4.5 | 5 loại giấy bị `rejected` (HTTP 200) |
| 4.6 | `txn_type` sai → HTTP 400 |
