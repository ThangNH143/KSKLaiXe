import { describe, expect, it } from 'vitest';
import { normalizeRecord, type RawRecordInput } from './normalize.js';
import type { GkskRecord } from './types.js';
import {
  hasBlockingErrors,
  parseDdMmYyyy,
  parseTodayContext,
  validateRecord,
  type ValidateContext,
} from './validate.js';

const DEFAULT_CTX: ValidateContext = {
  facilityId: '75001',
  today: '2026-11-23',
};

/**
 * Bản ghi mẫu hợp lệ 100% (DATA-SPEC.md §6), điền đủ 22 trường BHXH bắt buộc
 * và dùng mã SO chuẩn BHXH `00001/GKSKLX/75001/26` (21 ký tự -> chỉ có info `LOCAL_SO_OVER_20`)
 * hoặc `SOCMND_PASSPORT = 'TESTGKSK01'` (không tạo người, không lỗi).
 */
export function makeValidSampleRecord(overrides: RawRecordInput = {}): GkskRecord {
  return normalizeRecord({
    SO: '00001/GKSKLX/75001/26',
    NGAYKHAM: '05/11/2026',
    HOTEN: 'TEST NGUYEN VAN A',
    GIOITINHVAL: '0',
    NGAYSINH: '21/05/1990',
    DIACHITHUONGTRU: 'Phuong Tan Phong, Bien Hoa, Dong Nai',
    MATINH_THUONGTRU: '75',
    MAHUYEN_THUONGTRU: '731',
    MAXA_THUONGTRU: '25993',
    SOCMND_PASSPORT: 'TESTGKSK01',
    NGAYTHANGNAMCAP: '10/10/2021',
    NOICAP: 'Cuc Canh sat QLHC ve TTXH',
    HANGBANGLAI: 'B2',
    IDBENHVIEN: '75001',
    BENHVIEN: 'Benh vien Thu',
    NGAYKETLUAN: '06/11/2026',
    NONGDOCON: '0',
    DVINONGDOCON: '0',
    MATUY: '0',
    BACSYKETLUAN: 'TEST BAC SI',
    KETLUAN: 'A0-1',
    NGAYKHAMLAI: '',
    LYDO: '',
    TINHTRANGBENH: '',
    STATE: 'ADD',
    ...overrides,
  });
}

interface ValidationMatrixCase {
  readonly id: string;
  readonly description: string;
  readonly overrides: RawRecordInput;
  readonly ctx?: ValidateContext;
  readonly mustIncludeCodes: readonly string[];
  readonly mustExcludeCodes?: readonly string[];
  readonly expectedBlocking: boolean;
  readonly expectedFieldForCode?: Readonly<Record<string, string | null>>;
}

/**
 * Bộ 72 ca kiểm thử data-driven bao phủ toàn bộ ma trận ở `docs/TEST-PLAN.md §3.1`
 * và các điều kiện trong `docs/IMPLEMENTATION-PLAN.md` (mục S3).
 */
export const VALIDATION_MATRIX_CASES: readonly ValidationMatrixCase[] = [
  // 1. GKSK_SO_MISSING & GKSK_SO_TOO_LONG & LOCAL_SO_OVER_20
  {
    id: 'SO-01',
    description: 'SO rỗng "" -> kích hoạt GKSK_SO_MISSING (error)',
    overrides: { SO: '' },
    mustIncludeCodes: ['GKSK_SO_MISSING'],
    mustExcludeCodes: ['GKSK_SO_TOO_LONG', 'LOCAL_SO_OVER_20', 'LOCAL_SO_FORMAT'],
    expectedBlocking: true,
    expectedFieldForCode: { GKSK_SO_MISSING: 'SO' },
  },
  {
    id: 'SO-02',
    description: 'SO chỉ gồm khoảng trắng "   " -> kích hoạt GKSK_SO_MISSING (error)',
    overrides: { SO: '   ' },
    mustIncludeCodes: ['GKSK_SO_MISSING'],
    expectedBlocking: true,
  },
  {
    id: 'SO-03',
    description: 'SO 1 ký tự "A" (sát biên không trống) -> không kích hoạt GKSK_SO_MISSING',
    overrides: { SO: 'A' },
    mustIncludeCodes: ['LOCAL_SO_FORMAT'],
    mustExcludeCodes: ['GKSK_SO_MISSING', 'GKSK_SO_TOO_LONG', 'LOCAL_SO_OVER_20'],
    expectedBlocking: false,
  },
  {
    id: 'SO-04',
    description: 'SO đúng 20 ký tự (sát biên BHXH Max 20) -> không có LOCAL_SO_OVER_20',
    overrides: { SO: 'S'.repeat(20) },
    mustIncludeCodes: ['LOCAL_SO_FORMAT'],
    mustExcludeCodes: ['LOCAL_SO_OVER_20', 'GKSK_SO_TOO_LONG', 'LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
  },
  {
    id: 'SO-05',
    description: 'SO 21 ký tự chuẩn BHXH "00001/GKSKLX/75001/26" -> có LOCAL_SO_OVER_20 (info), không có LOCAL_SO_FORMAT',
    overrides: { SO: '00001/GKSKLX/75001/26' },
    mustIncludeCodes: ['LOCAL_SO_OVER_20'],
    mustExcludeCodes: ['LOCAL_SO_FORMAT', 'GKSK_SO_TOO_LONG', 'LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
    expectedFieldForCode: { LOCAL_SO_OVER_20: 'SO' },
  },
  {
    id: 'SO-06',
    description: 'SO đúng 30 ký tự (sát biên Sở nhận ≤ 30) -> có LOCAL_SO_OVER_20 (info), không có GKSK_SO_TOO_LONG',
    overrides: { SO: 'S'.repeat(30) },
    mustIncludeCodes: ['LOCAL_SO_OVER_20'],
    mustExcludeCodes: ['GKSK_SO_TOO_LONG', 'LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
  },
  {
    id: 'SO-07',
    description: 'SO 31 ký tự (vượt biên Sở > 30) -> kích hoạt GKSK_SO_TOO_LONG (error)',
    overrides: { SO: 'S'.repeat(31) },
    mustIncludeCodes: ['GKSK_SO_TOO_LONG'],
    mustExcludeCodes: ['LOCAL_SO_OVER_20', 'LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: true,
    expectedFieldForCode: { GKSK_SO_TOO_LONG: 'SO' },
  },

  // 2. LOCAL_SO_FORMAT
  {
    id: 'SO-FMT-01',
    description: 'SO thử nghiệm "TEST.75001.1" -> kích hoạt LOCAL_SO_FORMAT (info, không chặn)',
    overrides: { SO: 'TEST.75001.1' },
    mustIncludeCodes: ['LOCAL_SO_FORMAT'],
    mustExcludeCodes: ['LOCAL_SO_OVER_20', 'GKSK_SO_MISSING'],
    expectedBlocking: false,
    expectedFieldForCode: { LOCAL_SO_FORMAT: 'SO' },
  },
  {
    id: 'SO-FMT-02',
    description: 'SO thiếu chữ số thứ tự "1/GKSKLX/75001/26" -> kích hoạt LOCAL_SO_FORMAT (info)',
    overrides: { SO: '1/GKSKLX/75001/26' },
    mustIncludeCodes: ['LOCAL_SO_FORMAT'],
    expectedBlocking: false,
  },
  {
    id: 'SO-FMT-03',
    description: 'SO khác mã CSYT trong chuỗi "00001/GKSKLX/34001/20" (CSYT=75001) -> kích hoạt LOCAL_SO_FORMAT + LOCAL_SO_OVER_20',
    overrides: { SO: '00001/GKSKLX/34001/20' },
    mustIncludeCodes: ['LOCAL_SO_FORMAT', 'LOCAL_SO_OVER_20'],
    expectedBlocking: false,
  },

  // 3. GKSK_HOTEN_INVALID & LOCAL_FIELD_OVER_SPEC trên HOTEN
  {
    id: 'HOTEN-01',
    description: 'HOTEN rỗng "" -> kích hoạt GKSK_HOTEN_INVALID (error)',
    overrides: { HOTEN: '' },
    mustIncludeCodes: ['GKSK_HOTEN_INVALID'],
    expectedBlocking: true,
    expectedFieldForCode: { GKSK_HOTEN_INVALID: 'HOTEN' },
  },
  {
    id: 'HOTEN-02',
    description: 'HOTEN đúng 255 ký tự (sát biên Max 255) -> hợp lệ, không kích hoạt GKSK_HOTEN_INVALID',
    overrides: { HOTEN: 'A'.repeat(255) },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_HOTEN_INVALID', 'LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
  },
  {
    id: 'HOTEN-03',
    description: 'HOTEN 256 ký tự (vượt biên 255) -> kích hoạt GKSK_HOTEN_INVALID (error)',
    overrides: { HOTEN: 'A'.repeat(256) },
    mustIncludeCodes: ['GKSK_HOTEN_INVALID', 'LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: true,
  },
  {
    id: 'HOTEN-04',
    description: 'HOTEN tiếng Việt có dấu đúng 255 ký tự Unicode NFC -> hợp lệ (đếm theo ký tự NFC)',
    overrides: { HOTEN: 'Nguyễn '.repeat(36) + 'Ngữ' }, // 36*7 + 3 = 255 ký tự
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_HOTEN_INVALID', 'LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
  },

  // 4. GKSK_ID_MISSING, GKSK_ID_INVALID, LOCAL_ID_CREATES_PERSON
  {
    id: 'ID-01',
    description: 'SOCMND_PASSPORT rỗng "" -> kích hoạt GKSK_ID_MISSING (error)',
    overrides: { SOCMND_PASSPORT: '' },
    mustIncludeCodes: ['GKSK_ID_MISSING'],
    mustExcludeCodes: ['GKSK_ID_INVALID', 'LOCAL_ID_CREATES_PERSON'],
    expectedBlocking: true,
    expectedFieldForCode: { GKSK_ID_MISSING: 'SOCMND_PASSPORT' },
  },
  {
    id: 'ID-02',
    description: 'SOCMND_PASSPORT hộ chiếu giả "TESTGKSK01" -> hợp lệ, không kích hoạt LOCAL_ID_CREATES_PERSON hay GKSK_ID_INVALID',
    overrides: { SOCMND_PASSPORT: 'TESTGKSK01' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_ID_MISSING', 'GKSK_ID_INVALID', 'LOCAL_ID_CREATES_PERSON'],
    expectedBlocking: false,
  },
  {
    id: 'ID-03',
    description: 'SOCMND_PASSPORT CCCD 12 số có số 0 đầu "079000012345" -> kích hoạt LOCAL_ID_CREATES_PERSON (warning), không kích hoạt GKSK_ID_INVALID',
    overrides: { SOCMND_PASSPORT: '079000012345' },
    mustIncludeCodes: ['LOCAL_ID_CREATES_PERSON'],
    mustExcludeCodes: ['GKSK_ID_INVALID', 'GKSK_ID_MISSING'],
    expectedBlocking: false,
    expectedFieldForCode: { LOCAL_ID_CREATES_PERSON: 'SOCMND_PASSPORT' },
  },
  {
    id: 'ID-04',
    description: 'SOCMND_PASSPORT CMND 9 số "012345678" -> kích hoạt LOCAL_ID_CREATES_PERSON (warning), không kích hoạt GKSK_ID_INVALID',
    overrides: { SOCMND_PASSPORT: '012345678' },
    mustIncludeCodes: ['LOCAL_ID_CREATES_PERSON'],
    mustExcludeCodes: ['GKSK_ID_INVALID'],
    expectedBlocking: false,
  },
  {
    id: 'ID-05',
    description: 'SOCMND_PASSPORT toàn chữ số 0 "000000000000" (12 số 0) -> kích hoạt GKSK_ID_INVALID (warning), không kích hoạt LOCAL_ID_CREATES_PERSON',
    overrides: { SOCMND_PASSPORT: '000000000000' },
    mustIncludeCodes: ['GKSK_ID_INVALID'],
    mustExcludeCodes: ['LOCAL_ID_CREATES_PERSON'],
    expectedBlocking: false,
    expectedFieldForCode: { GKSK_ID_INVALID: 'SOCMND_PASSPORT' },
  },
  {
    id: 'ID-06',
    description: 'SOCMND_PASSPORT 10 chữ số "1234567890" -> kích hoạt GKSK_ID_INVALID (warning), không kích hoạt LOCAL_ID_CREATES_PERSON',
    overrides: { SOCMND_PASSPORT: '1234567890' },
    mustIncludeCodes: ['GKSK_ID_INVALID'],
    mustExcludeCodes: ['LOCAL_ID_CREATES_PERSON'],
    expectedBlocking: false,
  },
  {
    id: 'ID-07',
    description: 'SOCMND_PASSPORT 11 chữ số "79000012345" (mất số 0 đầu trên Excel) -> kích hoạt GKSK_ID_INVALID (warning)',
    overrides: { SOCMND_PASSPORT: '79000012345' },
    mustIncludeCodes: ['GKSK_ID_INVALID'],
    mustExcludeCodes: ['LOCAL_ID_CREATES_PERSON'],
    expectedBlocking: false,
  },

  // 5. GKSK_NGAYSINH_INVALID & LOCAL_NGAYSINH_FUTURE
  {
    id: 'DOB-01',
    description: 'NGAYSINH rỗng "" -> kích hoạt GKSK_NGAYSINH_INVALID (error)',
    overrides: { NGAYSINH: '' },
    mustIncludeCodes: ['GKSK_NGAYSINH_INVALID'],
    expectedBlocking: true,
    expectedFieldForCode: { GKSK_NGAYSINH_INVALID: 'NGAYSINH' },
  },
  {
    id: 'DOB-02',
    description: 'NGAYSINH ngày không tồn tại "31/02/1990" -> kích hoạt GKSK_NGAYSINH_INVALID (error)',
    overrides: { NGAYSINH: '31/02/1990' },
    mustIncludeCodes: ['GKSK_NGAYSINH_INVALID'],
    expectedBlocking: true,
  },
  {
    id: 'DOB-03',
    description: 'NGAYSINH năm không nhuận "29/02/2025" -> kích hoạt GKSK_NGAYSINH_INVALID (error)',
    overrides: { NGAYSINH: '29/02/2025' },
    mustIncludeCodes: ['GKSK_NGAYSINH_INVALID'],
    expectedBlocking: true,
  },
  {
    id: 'DOB-04',
    description: 'NGAYSINH tháng 4 ngày 31 "31/04/2026" -> kích hoạt GKSK_NGAYSINH_INVALID (error)',
    overrides: { NGAYSINH: '31/04/2026' },
    mustIncludeCodes: ['GKSK_NGAYSINH_INVALID'],
    expectedBlocking: true,
  },
  {
    id: 'DOB-05',
    description: 'NGAYSINH năm 1899 "31/12/1899" (sát biên dưới < 1900) -> kích hoạt GKSK_NGAYSINH_INVALID (error)',
    overrides: { NGAYSINH: '31/12/1899' },
    mustIncludeCodes: ['GKSK_NGAYSINH_INVALID'],
    expectedBlocking: true,
  },
  {
    id: 'DOB-06',
    description: 'NGAYSINH năm 1899 "01/01/1899" -> kích hoạt GKSK_NGAYSINH_INVALID (error)',
    overrides: { NGAYSINH: '01/01/1899' },
    mustIncludeCodes: ['GKSK_NGAYSINH_INVALID'],
    expectedBlocking: true,
  },
  {
    id: 'DOB-07',
    description: 'NGAYSINH "01/01/1900" (sát biên dưới = 1900) -> hợp lệ',
    overrides: { NGAYSINH: '01/01/1900' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_NGAYSINH_INVALID'],
    expectedBlocking: false,
  },
  {
    id: 'DOB-08',
    description: 'NGAYSINH năm nhuận "29/02/2024" -> hợp lệ',
    overrides: { NGAYSINH: '29/02/2024' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_NGAYSINH_INVALID'],
    expectedBlocking: false,
  },
  {
    id: 'DOB-09',
    description: 'NGAYSINH chuỗi chữ "abc" -> kích hoạt GKSK_NGAYSINH_INVALID (error)',
    overrides: { NGAYSINH: 'abc' },
    mustIncludeCodes: ['GKSK_NGAYSINH_INVALID'],
    expectedBlocking: true,
  },
  {
    id: 'DOB-10',
    description: 'NGAYSINH năm 2027 "01/01/2027" (> năm hiện tại 2026) -> kích hoạt GKSK_NGAYSINH_INVALID (error)',
    overrides: { NGAYSINH: '01/01/2027' },
    mustIncludeCodes: ['GKSK_NGAYSINH_INVALID'],
    mustExcludeCodes: ['LOCAL_NGAYSINH_FUTURE'],
    expectedBlocking: true,
  },
  {
    id: 'DOB-11',
    description: 'NGAYSINH bằng hôm nay "23/11/2026" (sát biên hôm nay) -> hợp lệ, không có LOCAL_NGAYSINH_FUTURE',
    overrides: { NGAYSINH: '23/11/2026' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_NGAYSINH_INVALID', 'LOCAL_NGAYSINH_FUTURE'],
    expectedBlocking: false,
  },
  {
    id: 'DOB-12',
    description: 'NGAYSINH sau hôm nay nhưng cùng năm 2026 ("24/11/2026") -> kích hoạt LOCAL_NGAYSINH_FUTURE (warning, không chặn)',
    overrides: { NGAYSINH: '24/11/2026' },
    mustIncludeCodes: ['LOCAL_NGAYSINH_FUTURE'],
    mustExcludeCodes: ['GKSK_NGAYSINH_INVALID'],
    expectedBlocking: false,
    expectedFieldForCode: { LOCAL_NGAYSINH_FUTURE: 'NGAYSINH' },
  },

  // 6. GKSK_NGAYKETLUAN_INVALID
  {
    id: 'NKL-01',
    description: 'NGAYKETLUAN rỗng "" -> kích hoạt GKSK_NGAYKETLUAN_INVALID (error)',
    overrides: { NGAYKETLUAN: '' },
    mustIncludeCodes: ['GKSK_NGAYKETLUAN_INVALID'],
    expectedBlocking: true,
    expectedFieldForCode: { GKSK_NGAYKETLUAN_INVALID: 'NGAYKETLUAN' },
  },
  {
    id: 'NKL-02',
    description: 'NGAYKETLUAN sai ngày "32/01/2026" -> kích hoạt GKSK_NGAYKETLUAN_INVALID (error)',
    overrides: { NGAYKETLUAN: '32/01/2026' },
    mustIncludeCodes: ['GKSK_NGAYKETLUAN_INVALID'],
    expectedBlocking: true,
  },
  {
    id: 'NKL-03',
    description: 'NGAYKETLUAN hợp lệ "06/11/2026" -> không kích hoạt GKSK_NGAYKETLUAN_INVALID',
    overrides: { NGAYKETLUAN: '06/11/2026' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_NGAYKETLUAN_INVALID'],
    expectedBlocking: false,
  },

  // 7. GKSK_KETLUAN_MISSING & GKSK_KETLUAN_UNKNOWN
  {
    id: 'KL-01',
    description: 'KETLUAN rỗng "" -> kích hoạt GKSK_KETLUAN_MISSING (error)',
    overrides: { KETLUAN: '' },
    mustIncludeCodes: ['GKSK_KETLUAN_MISSING'],
    mustExcludeCodes: ['GKSK_KETLUAN_UNKNOWN'],
    expectedBlocking: true,
    expectedFieldForCode: { GKSK_KETLUAN_MISSING: 'KETLUAN' },
  },
  {
    id: 'KL-02',
    description: 'KETLUAN = "A0-1" -> hợp lệ',
    overrides: { KETLUAN: 'A0-1' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_KETLUAN_MISSING', 'GKSK_KETLUAN_UNKNOWN'],
    expectedBlocking: false,
  },
  {
    id: 'KL-03',
    description: 'KETLUAN = "A0-2" -> hợp lệ',
    overrides: { KETLUAN: 'A0-2' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_KETLUAN_MISSING', 'GKSK_KETLUAN_UNKNOWN'],
    expectedBlocking: false,
  },
  {
    id: 'KL-04',
    description: 'KETLUAN = "A0-3" kèm NGAYKHAMLAI -> hợp lệ',
    overrides: { KETLUAN: 'A0-3', NGAYKHAMLAI: '06/05/2027' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_KETLUAN_MISSING', 'GKSK_KETLUAN_UNKNOWN', 'LOCAL_KETLUAN_A03_NO_RECHECK'],
    expectedBlocking: false,
  },
  {
    id: 'KL-05',
    description: 'KETLUAN = "A0-4" -> kích hoạt GKSK_KETLUAN_UNKNOWN (warning)',
    overrides: { KETLUAN: 'A0-4' },
    mustIncludeCodes: ['GKSK_KETLUAN_UNKNOWN'],
    mustExcludeCodes: ['GKSK_KETLUAN_MISSING'],
    expectedBlocking: false,
    expectedFieldForCode: { GKSK_KETLUAN_UNKNOWN: 'KETLUAN' },
  },
  {
    id: 'KL-06',
    description: 'KETLUAN = "OK" -> kích hoạt GKSK_KETLUAN_UNKNOWN (warning)',
    overrides: { KETLUAN: 'OK' },
    mustIncludeCodes: ['GKSK_KETLUAN_UNKNOWN'],
    expectedBlocking: false,
  },

  // 8. GKSK_FACILITY_MISMATCH
  {
    id: 'FAC-01',
    description: 'IDBENHVIEN="75999" khác cấu hình "75001" -> kích hoạt GKSK_FACILITY_MISMATCH (error)',
    overrides: { IDBENHVIEN: '75999' },
    mustIncludeCodes: ['GKSK_FACILITY_MISMATCH'],
    expectedBlocking: true,
    expectedFieldForCode: { GKSK_FACILITY_MISMATCH: 'IDBENHVIEN' },
  },
  {
    id: 'FAC-02',
    description: 'IDBENHVIEN rỗng "" -> kích hoạt GKSK_FACILITY_MISMATCH (error)',
    overrides: { IDBENHVIEN: '' },
    mustIncludeCodes: ['GKSK_FACILITY_MISMATCH'],
    expectedBlocking: true,
  },
  {
    id: 'FAC-03',
    description: 'IDBENHVIEN="75001" khớp cấu hình -> không kích hoạt GKSK_FACILITY_MISMATCH',
    overrides: { IDBENHVIEN: '75001' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_FACILITY_MISMATCH'],
    expectedBlocking: false,
  },

  // 9. GKSK_GIOITINH_UNKNOWN (W)
  {
    id: 'GT-01',
    description: 'GIOITINHVAL="2" -> kích hoạt GKSK_GIOITINH_UNKNOWN (warning)',
    overrides: { GIOITINHVAL: '2' },
    mustIncludeCodes: ['GKSK_GIOITINH_UNKNOWN'],
    expectedBlocking: false,
    expectedFieldForCode: { GKSK_GIOITINH_UNKNOWN: 'GIOITINHVAL' },
  },
  {
    id: 'GT-02',
    description: 'GIOITINHVAL="X" -> kích hoạt GKSK_GIOITINH_UNKNOWN (warning)',
    overrides: { GIOITINHVAL: 'X' },
    mustIncludeCodes: ['GKSK_GIOITINH_UNKNOWN'],
    expectedBlocking: false,
  },
  {
    id: 'GT-03',
    description: 'GIOITINHVAL="1" (hoặc "Nữ") -> không kích hoạt GKSK_GIOITINH_UNKNOWN',
    overrides: { GIOITINHVAL: 'Nữ' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_GIOITINH_UNKNOWN'],
    expectedBlocking: false,
  },
  {
    id: 'GT-04',
    description: 'GIOITINHVAL="" (trống) -> không kích hoạt GKSK_GIOITINH_UNKNOWN (chỉ báo LOCAL_BHXH_REQUIRED_EMPTY)',
    overrides: { GIOITINHVAL: '' },
    mustIncludeCodes: ['LOCAL_BHXH_REQUIRED_EMPTY'],
    mustExcludeCodes: ['GKSK_GIOITINH_UNKNOWN'],
    expectedBlocking: false,
  },

  // 10. GKSK_NONGDOCON_INVALID (W)
  {
    id: 'NDC-01',
    description: 'NONGDOCON="0,25" (dấu phẩy thập phân) -> hợp lệ',
    overrides: { NONGDOCON: '0,25' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_NONGDOCON_INVALID'],
    expectedBlocking: false,
  },
  {
    id: 'NDC-02',
    description: 'NONGDOCON="0.25" (dấu chấm thập phân) -> hợp lệ',
    overrides: { NONGDOCON: '0.25' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_NONGDOCON_INVALID'],
    expectedBlocking: false,
  },
  {
    id: 'NDC-03',
    description: 'NONGDOCON="" (rỗng) -> không kích hoạt GKSK_NONGDOCON_INVALID',
    overrides: { NONGDOCON: '' },
    mustIncludeCodes: ['LOCAL_BHXH_REQUIRED_EMPTY'],
    mustExcludeCodes: ['GKSK_NONGDOCON_INVALID'],
    expectedBlocking: false,
  },
  {
    id: 'NDC-04',
    description: 'NONGDOCON="abc" -> kích hoạt GKSK_NONGDOCON_INVALID (warning)',
    overrides: { NONGDOCON: 'abc' },
    mustIncludeCodes: ['GKSK_NONGDOCON_INVALID'],
    expectedBlocking: false,
    expectedFieldForCode: { GKSK_NONGDOCON_INVALID: 'NONGDOCON' },
  },
  {
    id: 'NDC-05',
    description: 'NONGDOCON="1.2.3" -> kích hoạt GKSK_NONGDOCON_INVALID (warning)',
    overrides: { NONGDOCON: '1.2.3' },
    mustIncludeCodes: ['GKSK_NONGDOCON_INVALID'],
    expectedBlocking: false,
  },
  {
    id: 'NDC-06',
    description: 'NONGDOCON="-1" -> kích hoạt GKSK_NONGDOCON_INVALID (warning)',
    overrides: { NONGDOCON: '-1' },
    mustIncludeCodes: ['GKSK_NONGDOCON_INVALID'],
    expectedBlocking: false,
  },

  // 11. GKSK_DVINONGDOCON_INVALID (W) & GKSK_MATUY_INVALID (W)
  {
    id: 'DVI-01',
    description: 'DVINONGDOCON="2" -> kích hoạt GKSK_DVINONGDOCON_INVALID (warning)',
    overrides: { DVINONGDOCON: '2' },
    mustIncludeCodes: ['GKSK_DVINONGDOCON_INVALID'],
    expectedBlocking: false,
    expectedFieldForCode: { GKSK_DVINONGDOCON_INVALID: 'DVINONGDOCON' },
  },
  {
    id: 'DVI-02',
    description: 'DVINONGDOCON="1" -> hợp lệ',
    overrides: { DVINONGDOCON: '1' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_DVINONGDOCON_INVALID'],
    expectedBlocking: false,
  },
  {
    id: 'DVI-03',
    description: 'DVINONGDOCON="" (rỗng) -> không kích hoạt GKSK_DVINONGDOCON_INVALID',
    overrides: { DVINONGDOCON: '' },
    mustIncludeCodes: ['LOCAL_BHXH_REQUIRED_EMPTY'],
    mustExcludeCodes: ['GKSK_DVINONGDOCON_INVALID'],
    expectedBlocking: false,
  },
  {
    id: 'MT-01',
    description: 'MATUY="2" -> kích hoạt GKSK_MATUY_INVALID (warning)',
    overrides: { MATUY: '2' },
    mustIncludeCodes: ['GKSK_MATUY_INVALID'],
    expectedBlocking: false,
    expectedFieldForCode: { GKSK_MATUY_INVALID: 'MATUY' },
  },
  {
    id: 'MT-02',
    description: 'MATUY="1" -> hợp lệ',
    overrides: { MATUY: '1' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['GKSK_MATUY_INVALID'],
    expectedBlocking: false,
  },

  // 12. GKSK_DATE_INVALID (W) cho NGAYKHAM, NGAYTHANGNAMCAP, NGAYKHAMLAI
  {
    id: 'DATE-OPT-01',
    description: 'NGAYKHAM="abc" -> kích hoạt GKSK_DATE_INVALID (warning, field=NGAYKHAM)',
    overrides: { NGAYKHAM: 'abc' },
    mustIncludeCodes: ['GKSK_DATE_INVALID'],
    expectedBlocking: false,
    expectedFieldForCode: { GKSK_DATE_INVALID: 'NGAYKHAM' },
  },
  {
    id: 'DATE-OPT-02',
    description: 'NGAYKHAM="" (trống) -> không kích hoạt GKSK_DATE_INVALID',
    overrides: { NGAYKHAM: '' },
    mustIncludeCodes: ['LOCAL_BHXH_REQUIRED_EMPTY'],
    mustExcludeCodes: ['GKSK_DATE_INVALID'],
    expectedBlocking: false,
  },
  {
    id: 'DATE-OPT-03',
    description: 'NGAYTHANGNAMCAP="31/04/2021" -> kích hoạt GKSK_DATE_INVALID (warning, field=NGAYTHANGNAMCAP)',
    overrides: { NGAYTHANGNAMCAP: '31/04/2021' },
    mustIncludeCodes: ['GKSK_DATE_INVALID'],
    expectedBlocking: false,
    expectedFieldForCode: { GKSK_DATE_INVALID: 'NGAYTHANGNAMCAP' },
  },
  {
    id: 'DATE-OPT-04',
    description: 'NGAYKHAMLAI="29/02/2025" -> kích hoạt GKSK_DATE_INVALID (warning, field=NGAYKHAMLAI)',
    overrides: { NGAYKHAMLAI: '29/02/2025' },
    mustIncludeCodes: ['GKSK_DATE_INVALID'],
    expectedBlocking: false,
    expectedFieldForCode: { GKSK_DATE_INVALID: 'NGAYKHAMLAI' },
  },

  // 13. LOCAL_FIELD_OVER_SPEC (sát biên Max vs Max+1)
  {
    id: 'LEN-01',
    description: 'SOCMND_PASSPORT 12 ký tự (sát biên Max 12) -> không có LOCAL_FIELD_OVER_SPEC',
    overrides: { SOCMND_PASSPORT: 'PASSPORT1234' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
  },
  {
    id: 'LEN-02',
    description: 'SOCMND_PASSPORT 13 ký tự (Max 12 + 1) -> kích hoạt LOCAL_FIELD_OVER_SPEC (field=SOCMND_PASSPORT)',
    overrides: { SOCMND_PASSPORT: 'PASSPORT12345' },
    mustIncludeCodes: ['LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
    expectedFieldForCode: { LOCAL_FIELD_OVER_SPEC: 'SOCMND_PASSPORT' },
  },
  {
    id: 'LEN-03',
    description: 'NOICAP 30 ký tự (sát biên Max 30) -> không có LOCAL_FIELD_OVER_SPEC',
    overrides: { NOICAP: 'N'.repeat(30) },
    mustIncludeCodes: [],
    mustExcludeCodes: ['LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
  },
  {
    id: 'LEN-04',
    description: 'NOICAP 31 ký tự (Max 30 + 1) -> kích hoạt LOCAL_FIELD_OVER_SPEC (field=NOICAP)',
    overrides: { NOICAP: 'N'.repeat(31) },
    mustIncludeCodes: ['LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
    expectedFieldForCode: { LOCAL_FIELD_OVER_SPEC: 'NOICAP' },
  },
  {
    id: 'LEN-05',
    description: 'HANGBANGLAI 10 ký tự (sát biên Max 10) -> không có LOCAL_FIELD_OVER_SPEC',
    overrides: { HANGBANGLAI: 'H'.repeat(10) },
    mustIncludeCodes: [],
    mustExcludeCodes: ['LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
  },
  {
    id: 'LEN-06',
    description: 'HANGBANGLAI 11 ký tự (Max 10 + 1) -> kích hoạt LOCAL_FIELD_OVER_SPEC (field=HANGBANGLAI)',
    overrides: { HANGBANGLAI: 'H'.repeat(11) },
    mustIncludeCodes: ['LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
    expectedFieldForCode: { LOCAL_FIELD_OVER_SPEC: 'HANGBANGLAI' },
  },
  {
    id: 'LEN-07',
    description: 'MATINH_THUONGTRU 10 ký tự (sát biên Max 10) -> không có LOCAL_FIELD_OVER_SPEC',
    overrides: { MATINH_THUONGTRU: 'T'.repeat(10) },
    mustIncludeCodes: [],
    mustExcludeCodes: ['LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
  },
  {
    id: 'LEN-08',
    description: 'MATINH_THUONGTRU 11 ký tự (Max 10 + 1) -> kích hoạt LOCAL_FIELD_OVER_SPEC (field=MATINH_THUONGTRU)',
    overrides: { MATINH_THUONGTRU: 'T'.repeat(11) },
    mustIncludeCodes: ['LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
    expectedFieldForCode: { LOCAL_FIELD_OVER_SPEC: 'MATINH_THUONGTRU' },
  },
  {
    id: 'LEN-09',
    description: 'MAXA_THUONGTRU 10 ký tự (sát biên Max 10) -> không có LOCAL_FIELD_OVER_SPEC',
    overrides: { MAXA_THUONGTRU: 'X'.repeat(10) },
    mustIncludeCodes: [],
    mustExcludeCodes: ['LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
  },
  {
    id: 'LEN-10',
    description: 'MAXA_THUONGTRU 11 ký tự (Max 10 + 1) -> kích hoạt LOCAL_FIELD_OVER_SPEC (field=MAXA_THUONGTRU)',
    overrides: { MAXA_THUONGTRU: 'X'.repeat(11) },
    mustIncludeCodes: ['LOCAL_FIELD_OVER_SPEC'],
    expectedBlocking: false,
    expectedFieldForCode: { LOCAL_FIELD_OVER_SPEC: 'MAXA_THUONGTRU' },
  },
  {
    id: 'LEN-11',
    description: 'DVINONGDOCON 2 ký tự "00" (Max 1 + 1) -> kích hoạt LOCAL_FIELD_OVER_SPEC + GKSK_DVINONGDOCON_INVALID',
    overrides: { DVINONGDOCON: '00' },
    mustIncludeCodes: ['LOCAL_FIELD_OVER_SPEC', 'GKSK_DVINONGDOCON_INVALID'],
    expectedBlocking: false,
    expectedFieldForCode: { LOCAL_FIELD_OVER_SPEC: 'DVINONGDOCON' },
  },

  // 14. LOCAL_BHXH_REQUIRED_EMPTY
  {
    id: 'BHXH-01',
    description: '3 trường BHXH cho phép null (NGAYKHAMLAI, LYDO, TINHTRANGBENH) để trống -> KHÔNG báo LOCAL_BHXH_REQUIRED_EMPTY',
    overrides: { NGAYKHAMLAI: '', LYDO: '', TINHTRANGBENH: '' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['LOCAL_BHXH_REQUIRED_EMPTY'],
    expectedBlocking: false,
  },
  {
    id: 'BHXH-02',
    description: 'Nhiều trường BHXH bắt buộc (DIACHITHUONGTRU, NGAYKHAM, NOICAP) cùng để trống -> gộp thành ĐÚNG 1 dòng LOCAL_BHXH_REQUIRED_EMPTY',
    overrides: { DIACHITHUONGTRU: '', NGAYKHAM: '', NOICAP: '' },
    mustIncludeCodes: ['LOCAL_BHXH_REQUIRED_EMPTY'],
    expectedBlocking: false,
    expectedFieldForCode: { LOCAL_BHXH_REQUIRED_EMPTY: null },
  },

  // 15. LOCAL_KETLUAN_A03_NO_RECHECK
  {
    id: 'A03-01',
    description: 'KETLUAN="A0-3" nhưng NGAYKHAMLAI trống -> kích hoạt LOCAL_KETLUAN_A03_NO_RECHECK (warning)',
    overrides: { KETLUAN: 'A0-3', NGAYKHAMLAI: '' },
    mustIncludeCodes: ['LOCAL_KETLUAN_A03_NO_RECHECK'],
    expectedBlocking: false,
    expectedFieldForCode: { LOCAL_KETLUAN_A03_NO_RECHECK: 'NGAYKHAMLAI' },
  },

  // 16. LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM
  {
    id: 'ORDER-01',
    description: 'NGAYKETLUAN ("04/11/2026") < NGAYKHAM ("05/11/2026") -> kích hoạt LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM (warning)',
    overrides: { NGAYKHAM: '05/11/2026', NGAYKETLUAN: '04/11/2026' },
    mustIncludeCodes: ['LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM'],
    expectedBlocking: false,
    expectedFieldForCode: { LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM: 'NGAYKETLUAN' },
  },
  {
    id: 'ORDER-02',
    description: 'NGAYKETLUAN bằng NGAYKHAM ("05/11/2026") -> hợp lệ, không kích hoạt LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM',
    overrides: { NGAYKHAM: '05/11/2026', NGAYKETLUAN: '05/11/2026' },
    mustIncludeCodes: [],
    mustExcludeCodes: ['LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM'],
    expectedBlocking: false,
  },
];

describe('validateRecord — bộ kiểm thử data-driven (TEST-PLAN.md §3.1)', () => {
  it('có ít nhất 60 ca kiểm thử data-driven trong bộ test S3', () => {
    expect(VALIDATION_MATRIX_CASES.length).toBeGreaterThanOrEqual(60);
  });

  it.each(VALIDATION_MATRIX_CASES)(
    '[$id] $description',
    ({
      overrides,
      ctx,
      mustIncludeCodes,
      mustExcludeCodes,
      expectedBlocking,
      expectedFieldForCode,
    }) => {
      const record = makeValidSampleRecord(overrides);
      const issues = validateRecord(record, ctx ?? DEFAULT_CTX);
      const codes = issues.map((i) => i.code);

      for (const expectedCode of mustIncludeCodes) {
        expect(codes, `Phải chứa mã ${expectedCode}`).toContain(expectedCode);
      }

      for (const excludedCode of mustExcludeCodes ?? []) {
        expect(codes, `Không được chứa mã ${excludedCode}`).not.toContain(excludedCode);
      }

      expect(hasBlockingErrors(issues)).toBe(expectedBlocking);

      if (expectedFieldForCode) {
        for (const [code, expectedField] of Object.entries(expectedFieldForCode)) {
          const found = issues.find((i) => i.code === code);
          expect(found, `Không tìm thấy issue có mã ${code}`).toBeDefined();
          expect(found?.field).toBe(expectedField);
        }
      }
    },
  );

  it('gộp LOCAL_BHXH_REQUIRED_EMPTY thành đúng 1 dòng duy nhất liệt kê tất cả các thẻ trống', () => {
    const record = makeValidSampleRecord({
      NGAYKHAM: '',
      DIACHITHUONGTRU: '',
      MATINH_THUONGTRU: '',
      NOICAP: '',
      BACSYKETLUAN: '',
    });

    const issues = validateRecord(record, DEFAULT_CTX);
    const bhxhEmptyIssues = issues.filter((i) => i.code === 'LOCAL_BHXH_REQUIRED_EMPTY');

    expect(bhxhEmptyIssues).toHaveLength(1);
    expect(bhxhEmptyIssues[0]?.field).toBeNull();
    expect(bhxhEmptyIssues[0]?.fields).toEqual([
      'NGAYKHAM',
      'DIACHITHUONGTRU',
      'MATINH_THUONGTRU',
      'NOICAP',
      'BACSYKETLUAN',
    ]);
  });

  it('parseTodayContext hỗ trợ chuỗi YYYY-MM-DD, dd/MM/yyyy, đối tượng Date và ném lỗi khi sai định dạng', () => {
    expect(parseTodayContext('2026-11-23')).toEqual({
      day: 23,
      month: 11,
      year: 2026,
      comparable: 20261123,
    });
    expect(parseTodayContext('23/11/2026')).toEqual({
      day: 23,
      month: 11,
      year: 2026,
      comparable: 20261123,
    });
    expect(parseTodayContext(new Date(Date.UTC(2026, 10, 23)))).toEqual({
      day: 23,
      month: 11,
      year: 2026,
      comparable: 20261123,
    });
    expect(() => parseTodayContext('not-a-valid-today')).toThrow(/ctx\.today không hợp lệ/);
    expect(parseDdMmYyyy('31/02/2026')).toBeNull();
  });

  it('LOCAL_SO_FORMAT dùng IDBENHVIEN trong bản ghi nếu ctx.facilityId rỗng', () => {
    const record = makeValidSampleRecord({
      SO: '00001/GKSKLX/75001/26',
      IDBENHVIEN: '75001',
    });
    const issues = validateRecord(record, { facilityId: '', today: '2026-11-23' });
    expect(issues.some((i) => i.code === 'LOCAL_SO_FORMAT')).toBe(false);
    expect(issues.some((i) => i.code === 'GKSK_FACILITY_MISMATCH')).toBe(true);
  });
});
