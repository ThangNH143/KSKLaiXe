---
name: gksk-protocol-guard
description: >-
  Reference rules and golden vectors for GKSK Lái Xe XML generation (25 BHXH tags),
  msg_id UTC+7 formatting, SHA256/RSA envelope signature, API response handling,
  and smart Excel import/reconciliation. Activate when implementing or reviewing
  S2-S11 or debugging API/XML/Excel issues.
---

# GKSK Protocol & Data Specification Guard

Use this skill when implementing or verifying domain logic in `packages/shared` and `server/src/` (`S2` through `S11`) to avoid the 17 known protocol and data pitfalls.

## 1. 25 XML Tags — Strict BHXH Order (`DATA-SPEC.md §1`)

The XML root is `<root>`. Always output all 25 tags in this exact order (empty optional tags must be output as `<TAG></TAG>`, never omitted):

1. `SO` (Sở required, max 20 BHXH / ≤ 30 Sở; >30 is blocking error `GKSK_SO_TOO_LONG`, 21–30 is info `LOCAL_SO_OVER_20`)
2. `NGAYKHAM` (`dd/MM/yyyy`, max 10)
3. `HOTEN` (Sở required, 1–255 chars)
4. `GIOITINHVAL` (`0` Nam, `1` Nữ, max 20; Excel import accepts both `GIOITINHVAL` and alias `GIOITINH`, XML always outputs `<GIOITINHVAL>`)
5. `NGAYSINH` (Sở required, `dd/MM/yyyy`, valid calendar date, year `1900..currentYear`)
6. `DIACHITHUONGTRU` (max 255)
7. `MATINH_THUONGTRU` (max 10)
8. `MAHUYEN_THUONGTRU` (max 10)
9. `MAXA_THUONGTRU` (max 10)
10. `SOCMND_PASSPORT` (Sở required, max 12; preserve leading zeros; 9 or 12 digits triggers `LOCAL_ID_CREATES_PERSON`)
11. `NGAYTHANGNAMCAP` (`dd/MM/yyyy`, max 10)
12. `NOICAP` (max 30)
13. `HANGBANGLAI` (max 10)
14. `IDBENHVIEN` (Sở required, max 255; always populated from server config `GKSK_FACILITY_ID`)
15. `BENHVIEN` (max 255; always populated from server config `GKSK_FACILITY_NAME`)
16. `NGAYKETLUAN` (Sở required, `dd/MM/yyyy`, max 10)
17. `NONGDOCON` (number with `.` or `,` — **SENSITIVE**)
18. `DVINONGDOCON` (`0` or `1`, max 1)
19. `MATUY` (`0` or `1`, max 1 — **SENSITIVE**)
20. `BACSYKETLUAN` (max 255)
21. `KETLUAN` (Sở required, `A0-1`, `A0-2`, `A0-3`, max 10)
22. `NGAYKHAMLAI` (`dd/MM/yyyy`, max 10, BHXH nullable)
23. `LYDO` (max 255, BHXH nullable — **SENSITIVE**)
24. `TINHTRANGBENH` (max 255, BHXH nullable — **SENSITIVE**)
25. `STATE` (`ADD` or `EDIT`, defaults to `ADD`, max 5)

- **XML rules**: Start with `<?xml version="1.0" encoding="UTF-8"?>\n<root>\n`. No UTF-8 BOM (`0xFEFF`), no `DOCTYPE`, no XML comments, no `<Signature>`, no extra tags (`UUID`, `STATUS`, `SIGNDATA`). Escape `& < > " '` and strip invalid XML 1.0 control chars (`\x00-\x08`, `\x0B`, `\x0C`, `\x0E-\x1F`, `\uFFFE`, `\uFFFF`).

## 2. Envelope Header Order, `msg_id` (UTC+7), and Golden Vector (`API-CONTRACT.md §3–5`)

### Exact `header` Key Order
```json
{
  "version": "1.0.6",
  "sender_id": "75001",
  "receiver_id": "TTYQG",
  "txn_type": "sync_gksk_lai_xe",
  "msg_id": "75001261123a3f1c2e4b5d44e7f8a9b0c1d2e3f4a5b",
  "msg_type": "101",
  "data_type": "xml/base64",
  "send_datetime": 1781084650736
}
```

### `msg_id` Formula
- `msg_id = sender_id + YYMMDD_VN + uuidV4SansDash`
- Always compute `YYMMDD_VN` in **UTC+7**:
  ```ts
  const vnIso = new Date(nowMs + 7 * 3600 * 1000).toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
  const yymmdd = vnIso.slice(2, 4) + vnIso.slice(5, 7) + vnIso.slice(8, 10);
  ```

### Signature Formula & Golden Vector
1. `headerJson = JSON.stringify(header)` (compact, exact 8-key order above).
2. `H = sha256HexUpper(headerJson)`
3. `D = sha256HexUpper(data.trim())` (hash the UTF-8 Base64 string, NOT the decoded bytes).
4. `signed = `${H}.${D}``
5. With RSA private key: `signature = crypto.sign('sha256', Buffer.from(signed, 'utf8'), privateKeyPem).toString('base64')`
6. Without RSA private key: `signature = "CHUA-KY-" + signed.slice(0, 16)`
7. **Golden Vector Check**:
   - `xml = '<root><SO>TEST.75001.1</SO></root>'`
   - `data = 'PHJvb3Q+PFNPPlRFU1QuNzUwMDEuMTwvU08+PC9yb290Pg=='`
   - `H = '6A618CAF5E36F31A4A779636EB2C34E9C4FCE1FFF20BE0A29D39CC9C0F04EC8F'`
   - `D = '2D626275B6434A748DCF1A2A4A535C556C1C52EDDA981FE16967F937D599C11E'`
   - `signature (no key) = 'CHUA-KY-6A618CAF5E36F31A'`

## 3. Smart Excel Import Overwrite & 29-Column Reconciliation Excel (`DATA-SPEC.md §5`)

- **Template (`GKSK_mau_nhap_lieu.xlsx`)**: 23 columns (25 tags minus `IDBENHVIEN` and `BENHVIEN`), formatted as Text (`numFmt = '@'`).
- **Conflict Modes against DB by `SO`**:
  - `new`: `SO` not in DB → `defaultSelected = true` (saves both `ready` and `invalid` rows so reconciliation count matches 100% of rows with a valid `SO`).
  - `overwrite_pending`: `SO` exists in DB with status `invalid | ready | rejected | error` → `defaultSelected = true` + info `LOCAL_SO_EXISTS`.
  - `accepted_unchanged`: `SO` exists in DB with status `accepted` and same `data_sha256` → `defaultSelected = false` + info `LOCAL_SO_ACCEPTED_UNCHANGED`.
  - `accepted_modified`: `SO` exists in DB with status `accepted` and different `data_sha256` → `defaultSelected = false` + warning `LOCAL_SO_ACCEPTED_MODIFIED` (user may manually check to overwrite and reset to `ready`/`invalid`).
  - `missing_so`: `SO` is empty or > 30 chars → `canCommit = false`, `defaultSelected = false`.
- **Reconciliation Excel (`GKSK_doi_soat_*.xlsx`)**: 23 original columns (Text format) + 6 reconciliation columns (`TRANG_THAI_DOI_SOAT`, `DOT_IMPORT`, `THOI_GIAN_DAY`, `MSG_ID`, `CERTIFICATE_ID_SO`, `CHI_TIET_LOI_CANH_BAO`). When re-imported, those 6 trailing columns are treated as ignored extra columns so the user can fix errors directly inside the reconciliation file and re-import it.
