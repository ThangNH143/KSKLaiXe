# Báo cáo Kiểm chứng Bước S6 — Mock GKSK API Server (`1.1 → 4.6` & `429 Retry-After`)

- **Thời điểm kiểm chứng**: `2026-11-23T11:57:26.655Z`
- **Module kiểm chứng**: `tools/mock-gksk-api` (`@gksk/mock-gksk-api`)
- **Kiểm tra cô lập kiến trúc**: `PASS` — `tools/mock-gksk-api` hoàn toàn không import từ `server/` (chỉ dùng `@gksk/shared`).
- **Tổng số kịch bản thực thi**: **15/15 PASS (100%)**

## 1. Bảng Tổng hợp Kết quả Kịch bản Postman (`1.1 → 4.6` & `MOCK-429`)

| Kịch bản | Mô tả | Endpoint | HTTP | Kết quả Tóm tắt | Trạng thái |
|---|---|---|---:|---|---|
| **1.1** | Đăng nhập CSYT hợp lệ (`75001`) | `POST /api/auth/login` | `200` | res_code=CM_SUCCESS, duration=720, token=<issued> | ✅ PASS |
| **1.2** | Đăng nhập sai mật khẩu (từ chối, không trả token) | `POST /api/auth/login` | `401` | res_code=CM_PERMISSION_DENY, success=false, data=null | ✅ PASS |
| **2.1** | Push XML hợp lệ chưa ký số (`accepted` + `GKSK_UNSIGNED`) | `POST /api/platform/gksk-lai-xe/push` | `200` | status=accepted, submission_id=85377fcf-55ca-49b1-a8cc-5add7ccb8502, certificate_id=a851c026-15bf-4af8-90b6-0acedf4b733e, warnings=[GKSK_UNSIGNED] | ✅ PASS |
| **2.2** | Gửi lại cùng `msg_id` (Idempotent) -> trả cùng `submission_id` | `POST /api/platform/gksk-lai-xe/push` | `200` | status=accepted, cùng submission_id=85377fcf-55ca-49b1-a8cc-5add7ccb8502 | ✅ PASS |
| **2.3** | Cùng `SO`, `msg_id` mới -> ghi đè giữ cùng `certificate_id` + `GKSK_STATE_ADD_EXISTS` | `POST /api/platform/gksk-lai-xe/push` | `200` | status=accepted, giữ cùng certificate_id=a851c026-15bf-4af8-90b6-0acedf4b733e, warnings=[GKSK_UNSIGNED, GKSK_STATE_ADD_EXISTS] | ✅ PASS |
| **2.4** | Push giấy có các cảnh báo §10 (vẫn `accepted`, trả đủ mã `warnings`) | `POST /api/platform/gksk-lai-xe/push` | `200` | status=accepted, warnings=[GKSK_UNKNOWN_TAG, GKSK_UNSIGNED, GKSK_ID_INVALID, GKSK_KETLUAN_UNKNOWN, GKSK_GIOITINH_UNKNOWN, GKSK_NONGDOCON_INVALID, GKSK_DVINONGDOCON_INVALID, GKSK_MATUY_INVALID, GKSK_DATE_INVALID, GKSK_FIELD_TOO_LONG] | ✅ PASS |
| **3.1** | Tra cứu `status` theo `msg_id` đã gửi -> HTTP 200 `data` y hệt lúc push (không có `header`) | `GET /api/platform/gksk-lai-xe/status` | `200` | code=CM_SUCCESS, không có header, data khớp 100% lúc push | ✅ PASS |
| **3.2** | Tra cứu `status` với `msg_id` chưa từng gửi -> HTTP 404 | `GET /api/platform/gksk-lai-xe/status` | `404` | HTTP 404, code=CM_INVALID_REQUEST, data=null | ✅ PASS |
| **4.1** | Từ chối giấy: `IDBENHVIEN` khác mã CSYT tài khoản (`GKSK_FACILITY_MISMATCH`) | `POST /api/platform/gksk-lai-xe/push` | `200` | HTTP 200 (res_code=PS_SYNC_SUCCESS), data.status=rejected, errors=[GKSK_FACILITY_MISMATCH] | ✅ PASS |
| **4.2** | Từ chối giấy: Thiếu `SO` / `HOTEN` / `SOCMND_PASSPORT` (`GKSK_SO_MISSING`, `GKSK_HOTEN_INVALID`, `GKSK_ID_MISSING`) | `POST /api/platform/gksk-lai-xe/push` | `200` | HTTP 200 (res_code=PS_SYNC_SUCCESS), data.status=rejected, errors=[GKSK_SO_MISSING, GKSK_HOTEN_INVALID, GKSK_ID_MISSING] | ✅ PASS |
| **4.3** | Từ chối giấy: `NGAYSINH` không hợp lệ (`31/02/1990` -> `GKSK_NGAYSINH_INVALID`) | `POST /api/platform/gksk-lai-xe/push` | `200` | HTTP 200 (res_code=PS_SYNC_SUCCESS), data.status=rejected, errors=[GKSK_NGAYSINH_INVALID] | ✅ PASS |
| **4.4** | Từ chối giấy: `NGAYKETLUAN` sai & thiếu `KETLUAN` (`GKSK_NGAYKETLUAN_INVALID`, `GKSK_KETLUAN_MISSING`) | `POST /api/platform/gksk-lai-xe/push` | `200` | HTTP 200 (res_code=PS_SYNC_SUCCESS), data.status=rejected, errors=[GKSK_NGAYKETLUAN_INVALID, GKSK_KETLUAN_MISSING] | ✅ PASS |
| **4.5** | Từ chối giấy: XML chứa `DOCTYPE` bị cấm (`GKSK_XML_INVALID`) | `POST /api/platform/gksk-lai-xe/push` | `200` | HTTP 200 (res_code=PS_SYNC_SUCCESS), data.status=rejected, errors=[GKSK_XML_INVALID] | ✅ PASS |
| **4.6** | Lỗi Envelope: `header.txn_type` sai -> HTTP 400 `CM_INVALID_REQUEST` | `POST /api/platform/gksk-lai-xe/push` | `400` | HTTP 400, res_code=CM_INVALID_REQUEST, res_msg="Trường header.txn_type không hợp lệ: nhận 'invalid_txn_type', yêu cầu 'sync_gksk_lai_xe'" | ✅ PASS |
| **MOCK-429** | Điều khiển lỗi `POST /__mock/fail {mode:"429", count:1, retryAfterSec:5}` -> HTTP 429 + `Retry-After: 5` | `POST /api/platform/gksk-lai-xe/push` | `429` | HTTP 429, Header Retry-After=5, res_code=CM_TOO_MANY_REQUESTS | ✅ PASS |

## 2. Chi tiết Request & Response từng Kịch bản

### Kịch bản 1.1: Đăng nhập CSYT hợp lệ (`75001`)
- **Request**: `POST /api/auth/login` — `{"username":"75001","password":"***"}`
- **HTTP Status**: `200`
- **Tóm tắt**: res_code=CM_SUCCESS, duration=720, token=<issued>
- **Response Body (JSON)**:
```json
{
  "header": {
    "version": "1.0.6",
    "success": true,
    "res_code": "CM_SUCCESS",
    "res_msg": "Đăng nhập thành công"
  },
  "data": {
    "token": "<REDACTED_MOCK_TOKEN>",
    "refresh_token": "<REDACTED>",
    "duration": 720,
    "refresh_duration": 1440
  }
}
```

### Kịch bản 1.2: Đăng nhập sai mật khẩu (từ chối, không trả token)
- **Request**: `POST /api/auth/login` — `{"username":"75001","password":"wrong_password"}`
- **HTTP Status**: `401`
- **Tóm tắt**: res_code=CM_PERMISSION_DENY, success=false, data=null
- **Response Body (JSON)**:
```json
{
  "header": {
    "version": "1.0.6",
    "success": false,
    "res_code": "CM_PERMISSION_DENY",
    "res_msg": "Sai tên đăng nhập hoặc mật khẩu"
  },
  "data": null
}
```

### Kịch bản 2.1: Push XML hợp lệ chưa ký số (`accepted` + `GKSK_UNSIGNED`)
- **Request**: `POST /api/platform/gksk-lai-xe/push` — msg_id=`750012611232a3892ec8a8847929d9b06f2ade9fb97`, SO=`TEST.75001.S6.001`
- **HTTP Status**: `200`
- **Tóm tắt**: status=accepted, submission_id=85377fcf-55ca-49b1-a8cc-5add7ccb8502, certificate_id=a851c026-15bf-4af8-90b6-0acedf4b733e, warnings=[GKSK_UNSIGNED]
- **Response Body (JSON)**:
```json
{
  "header": {
    "version": "1.0.6",
    "sender_id": "TTYQG",
    "receiver_id": "75001",
    "txn_type": "sync_gksk_lai_xe",
    "res_code": "PS_SYNC_SUCCESS",
    "res_msg": "Tiếp nhận giấy khám sức khỏe lái xe thành công",
    "msg_id": "TTYQG2611239d937f26f8d0468284f7e10f1dbbd47d",
    "msg_type": "102",
    "ref_msg_id": "750012611232a3892ec8a8847929d9b06f2ade9fb97",
    "send_datetime": 1795435046592,
    "res_datetime": 1795435046592
  },
  "data": {
    "status": "accepted",
    "submission_id": "85377fcf-55ca-49b1-a8cc-5add7ccb8502",
    "certificate_id": "a851c026-15bf-4af8-90b6-0acedf4b733e",
    "so": "TEST.75001.S6.001",
    "errors": [],
    "warnings": [
      {
        "code": "GKSK_UNSIGNED",
        "field": null
      }
    ]
  },
  "signature": "MOCK-TTYQG-SIGNATURE"
}
```

### Kịch bản 2.2: Gửi lại cùng `msg_id` (Idempotent) -> trả cùng `submission_id`
- **Request**: `POST /api/platform/gksk-lai-xe/push` — Cùng msg_id=`750012611232a3892ec8a8847929d9b06f2ade9fb97`
- **HTTP Status**: `200`
- **Tóm tắt**: status=accepted, cùng submission_id=85377fcf-55ca-49b1-a8cc-5add7ccb8502
- **Response Body (JSON)**:
```json
{
  "header": {
    "version": "1.0.6",
    "sender_id": "TTYQG",
    "receiver_id": "75001",
    "txn_type": "sync_gksk_lai_xe",
    "res_code": "PS_SYNC_SUCCESS",
    "res_msg": "Xử lý đồng bộ GKSK lái xe hoàn tất (idempotent)",
    "msg_id": "TTYQG261123794d860b127f446a8be9f37adfb4cd82",
    "msg_type": "102",
    "ref_msg_id": "750012611232a3892ec8a8847929d9b06f2ade9fb97",
    "send_datetime": 1795435046597,
    "res_datetime": 1795435046597
  },
  "data": {
    "status": "accepted",
    "submission_id": "85377fcf-55ca-49b1-a8cc-5add7ccb8502",
    "certificate_id": "a851c026-15bf-4af8-90b6-0acedf4b733e",
    "so": "TEST.75001.S6.001",
    "errors": [],
    "warnings": [
      {
        "code": "GKSK_UNSIGNED",
        "field": null
      }
    ]
  },
  "signature": "MOCK-TTYQG-SIGNATURE"
}
```

### Kịch bản 2.3: Cùng `SO`, `msg_id` mới -> ghi đè giữ cùng `certificate_id` + `GKSK_STATE_ADD_EXISTS`
- **Request**: `POST /api/platform/gksk-lai-xe/push` — msg_id mới=`750012611231be57a27606d40e6b04d522bcab37b28`, cùng SO=`TEST.75001.S6.001`
- **HTTP Status**: `200`
- **Tóm tắt**: status=accepted, giữ cùng certificate_id=a851c026-15bf-4af8-90b6-0acedf4b733e, warnings=[GKSK_UNSIGNED, GKSK_STATE_ADD_EXISTS]
- **Response Body (JSON)**:
```json
{
  "header": {
    "version": "1.0.6",
    "sender_id": "TTYQG",
    "receiver_id": "75001",
    "txn_type": "sync_gksk_lai_xe",
    "res_code": "PS_SYNC_SUCCESS",
    "res_msg": "Tiếp nhận giấy khám sức khỏe lái xe thành công",
    "msg_id": "TTYQG2611230483ce88dcec477eb7a4ce57e20cc8de",
    "msg_type": "102",
    "ref_msg_id": "750012611231be57a27606d40e6b04d522bcab37b28",
    "send_datetime": 1795435046604,
    "res_datetime": 1795435046604
  },
  "data": {
    "status": "accepted",
    "submission_id": "41f07bfd-89f1-456a-ba46-d7c6df1e5099",
    "certificate_id": "a851c026-15bf-4af8-90b6-0acedf4b733e",
    "so": "TEST.75001.S6.001",
    "errors": [],
    "warnings": [
      {
        "code": "GKSK_UNSIGNED",
        "field": null
      },
      {
        "code": "GKSK_STATE_ADD_EXISTS",
        "field": "STATE"
      }
    ]
  },
  "signature": "MOCK-TTYQG-SIGNATURE"
}
```

### Kịch bản 2.4: Push giấy có các cảnh báo §10 (vẫn `accepted`, trả đủ mã `warnings`)
- **Request**: `POST /api/platform/gksk-lai-xe/push` — SO=`TEST.75001.S6.002`, kèm 9 trường kích hoạt cảnh báo §10
- **HTTP Status**: `200`
- **Tóm tắt**: status=accepted, warnings=[GKSK_UNKNOWN_TAG, GKSK_UNSIGNED, GKSK_ID_INVALID, GKSK_KETLUAN_UNKNOWN, GKSK_GIOITINH_UNKNOWN, GKSK_NONGDOCON_INVALID, GKSK_DVINONGDOCON_INVALID, GKSK_MATUY_INVALID, GKSK_DATE_INVALID, GKSK_FIELD_TOO_LONG]
- **Response Body (JSON)**:
```json
{
  "header": {
    "version": "1.0.6",
    "sender_id": "TTYQG",
    "receiver_id": "75001",
    "txn_type": "sync_gksk_lai_xe",
    "res_code": "PS_SYNC_SUCCESS",
    "res_msg": "Tiếp nhận giấy khám sức khỏe lái xe thành công",
    "msg_id": "TTYQG261123edf85c712ec04f43be6580b8e1cf45dd",
    "msg_type": "102",
    "ref_msg_id": "75001261123156cdbf7e93f4400a80a3056cff41933",
    "send_datetime": 1795435046609,
    "res_datetime": 1795435046609
  },
  "data": {
    "status": "accepted",
    "submission_id": "569d22b5-ec6d-4196-b655-e03f06a4f723",
    "certificate_id": "7cb86f92-efa2-46a2-95ed-7d1a9c736a70",
    "so": "TEST.75001.S6.002",
    "errors": [],
    "warnings": [
      {
        "code": "GKSK_UNKNOWN_TAG",
        "field": "EXTRA_TAG"
      },
      {
        "code": "GKSK_UNSIGNED",
        "field": null
      },
      {
        "code": "GKSK_ID_INVALID",
        "field": "SOCMND_PASSPORT"
      },
      {
        "code": "GKSK_KETLUAN_UNKNOWN",
        "field": "KETLUAN"
      },
      {
        "code": "GKSK_GIOITINH_UNKNOWN",
        "field": "GIOITINHVAL"
      },
      {
        "code": "GKSK_NONGDOCON_INVALID",
        "field": "NONGDOCON"
      },
      {
        "code": "GKSK_DVINONGDOCON_INVALID",
        "field": "DVINONGDOCON"
      },
      {
        "code": "GKSK_MATUY_INVALID",
        "field": "MATUY"
      },
      {
        "code": "GKSK_DATE_INVALID",
        "field": "NGAYKHAM"
      },
      {
        "code": "GKSK_FIELD_TOO_LONG",
        "field": "NOICAP"
      }
    ]
  },
  "signature": "MOCK-TTYQG-SIGNATURE"
}
```

### Kịch bản 3.1: Tra cứu `status` theo `msg_id` đã gửi -> HTTP 200 `data` y hệt lúc push (không có `header`)
- **Request**: `GET /api/platform/gksk-lai-xe/status?msg_id=750012611232a3892ec8a8847929d9b06f2ade9fb97` — query `msg_id=750012611232a3892ec8a8847929d9b06f2ade9fb97`
- **HTTP Status**: `200`
- **Tóm tắt**: code=CM_SUCCESS, không có header, data khớp 100% lúc push
- **Response Body (JSON)**:
```json
{
  "code": "CM_SUCCESS",
  "message": "Tra cứu kết quả xử lý gói tin thành công",
  "data": {
    "status": "accepted",
    "submission_id": "85377fcf-55ca-49b1-a8cc-5add7ccb8502",
    "certificate_id": "a851c026-15bf-4af8-90b6-0acedf4b733e",
    "so": "TEST.75001.S6.001",
    "errors": [],
    "warnings": [
      {
        "code": "GKSK_UNSIGNED",
        "field": null
      }
    ]
  }
}
```

### Kịch bản 3.2: Tra cứu `status` với `msg_id` chưa từng gửi -> HTTP 404
- **Request**: `GET /api/platform/gksk-lai-xe/status?msg_id=7500126112300000000000040008000000000000999` — query `msg_id=7500126112300000000000040008000000000000999`
- **HTTP Status**: `404`
- **Tóm tắt**: HTTP 404, code=CM_INVALID_REQUEST, data=null
- **Response Body (JSON)**:
```json
{
  "code": "CM_INVALID_REQUEST",
  "message": "Không tìm thấy gói tin 7500126112300000000000040008000000000000999",
  "data": null
}
```

### Kịch bản 4.1: Từ chối giấy: `IDBENHVIEN` khác mã CSYT tài khoản (`GKSK_FACILITY_MISMATCH`)
- **Request**: `POST /api/platform/gksk-lai-xe/push` — msg_id=`75001261123e929986fd9df4b7eb3bd750f1d31f21e` (kỳ vọng rejected: `GKSK_FACILITY_MISMATCH`)
- **HTTP Status**: `200`
- **Tóm tắt**: HTTP 200 (res_code=PS_SYNC_SUCCESS), data.status=rejected, errors=[GKSK_FACILITY_MISMATCH]
- **Response Body (JSON)**:
```json
{
  "header": {
    "version": "1.0.6",
    "sender_id": "TTYQG",
    "receiver_id": "75001",
    "txn_type": "sync_gksk_lai_xe",
    "res_code": "PS_SYNC_SUCCESS",
    "res_msg": "Giấy khám sức khỏe lái xe bị từ chối do lỗi dữ liệu",
    "msg_id": "TTYQG2611231b53f5eaaf7344d387f435563d2dde93",
    "msg_type": "102",
    "ref_msg_id": "75001261123e929986fd9df4b7eb3bd750f1d31f21e",
    "send_datetime": 1795435046625,
    "res_datetime": 1795435046625
  },
  "data": {
    "status": "rejected",
    "submission_id": "a0d0ddfd-6e3f-4a3b-86fa-27394f8d8dc1",
    "certificate_id": null,
    "so": "TEST.75001.REJ.401",
    "errors": [
      {
        "code": "GKSK_FACILITY_MISMATCH",
        "field": "IDBENHVIEN"
      }
    ],
    "warnings": [
      {
        "code": "GKSK_UNSIGNED",
        "field": null
      }
    ]
  },
  "signature": "MOCK-TTYQG-SIGNATURE"
}
```

### Kịch bản 4.2: Từ chối giấy: Thiếu `SO` / `HOTEN` / `SOCMND_PASSPORT` (`GKSK_SO_MISSING`, `GKSK_HOTEN_INVALID`, `GKSK_ID_MISSING`)
- **Request**: `POST /api/platform/gksk-lai-xe/push` — msg_id=`75001261123d9dedc88fb6e4115980bf8d3eec6159a` (kỳ vọng rejected: `GKSK_SO_MISSING`)
- **HTTP Status**: `200`
- **Tóm tắt**: HTTP 200 (res_code=PS_SYNC_SUCCESS), data.status=rejected, errors=[GKSK_SO_MISSING, GKSK_HOTEN_INVALID, GKSK_ID_MISSING]
- **Response Body (JSON)**:
```json
{
  "header": {
    "version": "1.0.6",
    "sender_id": "TTYQG",
    "receiver_id": "75001",
    "txn_type": "sync_gksk_lai_xe",
    "res_code": "PS_SYNC_SUCCESS",
    "res_msg": "Giấy khám sức khỏe lái xe bị từ chối do lỗi dữ liệu",
    "msg_id": "TTYQG261123131ef301137c432fb49129cd4d3135fe",
    "msg_type": "102",
    "ref_msg_id": "75001261123d9dedc88fb6e4115980bf8d3eec6159a",
    "send_datetime": 1795435046629,
    "res_datetime": 1795435046629
  },
  "data": {
    "status": "rejected",
    "submission_id": "9363fe1d-b4c3-463f-8d76-53910e48feb4",
    "certificate_id": null,
    "so": null,
    "errors": [
      {
        "code": "GKSK_SO_MISSING",
        "field": "SO"
      },
      {
        "code": "GKSK_HOTEN_INVALID",
        "field": "HOTEN"
      },
      {
        "code": "GKSK_ID_MISSING",
        "field": "SOCMND_PASSPORT"
      }
    ],
    "warnings": [
      {
        "code": "GKSK_UNSIGNED",
        "field": null
      }
    ]
  },
  "signature": "MOCK-TTYQG-SIGNATURE"
}
```

### Kịch bản 4.3: Từ chối giấy: `NGAYSINH` không hợp lệ (`31/02/1990` -> `GKSK_NGAYSINH_INVALID`)
- **Request**: `POST /api/platform/gksk-lai-xe/push` — msg_id=`75001261123d6d2c28831ad41108fd6492d251c69f5` (kỳ vọng rejected: `GKSK_NGAYSINH_INVALID`)
- **HTTP Status**: `200`
- **Tóm tắt**: HTTP 200 (res_code=PS_SYNC_SUCCESS), data.status=rejected, errors=[GKSK_NGAYSINH_INVALID]
- **Response Body (JSON)**:
```json
{
  "header": {
    "version": "1.0.6",
    "sender_id": "TTYQG",
    "receiver_id": "75001",
    "txn_type": "sync_gksk_lai_xe",
    "res_code": "PS_SYNC_SUCCESS",
    "res_msg": "Giấy khám sức khỏe lái xe bị từ chối do lỗi dữ liệu",
    "msg_id": "TTYQG2611239a7a6a28a8e24cc6843c2099f94d100e",
    "msg_type": "102",
    "ref_msg_id": "75001261123d6d2c28831ad41108fd6492d251c69f5",
    "send_datetime": 1795435046634,
    "res_datetime": 1795435046634
  },
  "data": {
    "status": "rejected",
    "submission_id": "137ecec9-7b65-4fc5-aa08-9eae71d0467d",
    "certificate_id": null,
    "so": "TEST.75001.REJ.403",
    "errors": [
      {
        "code": "GKSK_NGAYSINH_INVALID",
        "field": "NGAYSINH"
      }
    ],
    "warnings": [
      {
        "code": "GKSK_UNSIGNED",
        "field": null
      }
    ]
  },
  "signature": "MOCK-TTYQG-SIGNATURE"
}
```

### Kịch bản 4.4: Từ chối giấy: `NGAYKETLUAN` sai & thiếu `KETLUAN` (`GKSK_NGAYKETLUAN_INVALID`, `GKSK_KETLUAN_MISSING`)
- **Request**: `POST /api/platform/gksk-lai-xe/push` — msg_id=`75001261123170edc971399420f81abf78e447032ae` (kỳ vọng rejected: `GKSK_NGAYKETLUAN_INVALID`)
- **HTTP Status**: `200`
- **Tóm tắt**: HTTP 200 (res_code=PS_SYNC_SUCCESS), data.status=rejected, errors=[GKSK_NGAYKETLUAN_INVALID, GKSK_KETLUAN_MISSING]
- **Response Body (JSON)**:
```json
{
  "header": {
    "version": "1.0.6",
    "sender_id": "TTYQG",
    "receiver_id": "75001",
    "txn_type": "sync_gksk_lai_xe",
    "res_code": "PS_SYNC_SUCCESS",
    "res_msg": "Giấy khám sức khỏe lái xe bị từ chối do lỗi dữ liệu",
    "msg_id": "TTYQG26112362a4a07030aa4e8ba4321f022081651e",
    "msg_type": "102",
    "ref_msg_id": "75001261123170edc971399420f81abf78e447032ae",
    "send_datetime": 1795435046639,
    "res_datetime": 1795435046639
  },
  "data": {
    "status": "rejected",
    "submission_id": "8af4b49f-32ca-4a09-8c77-2422e536f241",
    "certificate_id": null,
    "so": "TEST.75001.REJ.404",
    "errors": [
      {
        "code": "GKSK_NGAYKETLUAN_INVALID",
        "field": "NGAYKETLUAN"
      },
      {
        "code": "GKSK_KETLUAN_MISSING",
        "field": "KETLUAN"
      }
    ],
    "warnings": [
      {
        "code": "GKSK_UNSIGNED",
        "field": null
      }
    ]
  },
  "signature": "MOCK-TTYQG-SIGNATURE"
}
```

### Kịch bản 4.5: Từ chối giấy: XML chứa `DOCTYPE` bị cấm (`GKSK_XML_INVALID`)
- **Request**: `POST /api/platform/gksk-lai-xe/push` — msg_id=`75001261123441e0b11311a4200bdc48ef8aa80e9c2` (kỳ vọng rejected: `GKSK_XML_INVALID`)
- **HTTP Status**: `200`
- **Tóm tắt**: HTTP 200 (res_code=PS_SYNC_SUCCESS), data.status=rejected, errors=[GKSK_XML_INVALID]
- **Response Body (JSON)**:
```json
{
  "header": {
    "version": "1.0.6",
    "sender_id": "TTYQG",
    "receiver_id": "75001",
    "txn_type": "sync_gksk_lai_xe",
    "res_code": "PS_SYNC_SUCCESS",
    "res_msg": "Giấy khám sức khỏe lái xe bị từ chối do lỗi dữ liệu",
    "msg_id": "TTYQG26112308a8ccd338b34db78ddd0027417bb673",
    "msg_type": "102",
    "ref_msg_id": "75001261123441e0b11311a4200bdc48ef8aa80e9c2",
    "send_datetime": 1795435046642,
    "res_datetime": 1795435046642
  },
  "data": {
    "status": "rejected",
    "submission_id": "7122af68-155e-4a0c-b2ed-6c96c5e676de",
    "certificate_id": null,
    "so": null,
    "errors": [
      {
        "code": "GKSK_XML_INVALID",
        "field": null
      }
    ],
    "warnings": []
  },
  "signature": "MOCK-TTYQG-SIGNATURE"
}
```

### Kịch bản 4.6: Lỗi Envelope: `header.txn_type` sai -> HTTP 400 `CM_INVALID_REQUEST`
- **Request**: `POST /api/platform/gksk-lai-xe/push` — header.txn_type=`invalid_txn_type`
- **HTTP Status**: `400`
- **Tóm tắt**: HTTP 400, res_code=CM_INVALID_REQUEST, res_msg="Trường header.txn_type không hợp lệ: nhận 'invalid_txn_type', yêu cầu 'sync_gksk_lai_xe'"
- **Response Body (JSON)**:
```json
{
  "header": {
    "version": "1.0.6",
    "sender_id": "TTYQG",
    "receiver_id": "75001",
    "txn_type": "sync_gksk_lai_xe",
    "res_code": "CM_INVALID_REQUEST",
    "res_msg": "Trường header.txn_type không hợp lệ: nhận 'invalid_txn_type', yêu cầu 'sync_gksk_lai_xe'",
    "msg_id": "TTYQG2611233c39d48513014d4bbc5b62b7d184498a",
    "msg_type": "102",
    "ref_msg_id": "75001261123b48258c9999b4256a3396df294c9e235",
    "send_datetime": 1795435046646,
    "res_datetime": 1795435046646
  },
  "data": null,
  "signature": ""
}
```

### Kịch bản MOCK-429: Điều khiển lỗi `POST /__mock/fail {mode:"429", count:1, retryAfterSec:5}` -> HTTP 429 + `Retry-After: 5`
- **Request**: `POST /api/platform/gksk-lai-xe/push` — Bật /__mock/fail mode=429 rồi gọi push msg_id=`75001261123f61419553af34b5881f107f70ab3acb1`
- **HTTP Status**: `429`
- **Tóm tắt**: HTTP 429, Header Retry-After=5, res_code=CM_TOO_MANY_REQUESTS
- **Response Body (JSON)**:
```json
{
  "header": {
    "version": "1.0.6",
    "sender_id": "TTYQG",
    "receiver_id": "75001",
    "txn_type": "sync_gksk_lai_xe",
    "res_code": "CM_TOO_MANY_REQUESTS",
    "res_msg": "Vượt quá giới hạn 300 gói/phút/CSYT (mock 429)",
    "msg_id": "TTYQG261123f9618fc45c5b434595e32940e09ef5d8",
    "msg_type": "102",
    "ref_msg_id": "75001261123f61419553af34b5881f107f70ab3acb1",
    "send_datetime": 1795435046653,
    "res_datetime": 1795435046653
  },
  "data": null,
  "signature": ""
}
```
