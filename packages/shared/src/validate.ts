import {
  BHXH_REQUIRED_TAGS,
  FIELD_BY_TAG,
  FIELD_ORDER,
  SO_BHXH_MAX_LENGTH,
  SO_SERVER_MAX_LENGTH,
} from './fields.js';
import { isValidCalendarDate } from './normalize.js';
import type { FieldTag, GkskRecord, Issue } from './types.js';

export interface ValidateContext {
  /** Mã cơ sở y tế theo cấu hình máy chủ (`GKSK_FACILITY_ID`), vd `"75001"`. */
  readonly facilityId: string;
  /**
   * Ngày hiện tại dạng `YYYY-MM-DD`, `dd/MM/yyyy` hoặc `Date` (truyền vào để kiểm thử xác định,
   * không phụ thuộc đồng hồ/múi giờ hệ thống).
   */
  readonly today: string | Date;
}

export interface ParsedDate {
  readonly day: number;
  readonly month: number;
  readonly year: number;
  /** Giá trị số `YYYYMMDD` để so sánh thứ tự hai ngày nhanh và không phụ thuộc múi giờ. */
  readonly comparable: number;
}

const VALID_KETLUAN = new Set(['A0-1', 'A0-2', 'A0-3']);
const VALID_BINARY_ENUM = new Set(['0', '1']);
const NONGDOCON_REGEX = /^\d+([.,]\d+)?$/;

/**
 * Phân tích chuỗi ngày chuẩn `dd/MM/yyyy` (10 ký tự) thành `{ day, month, year, comparable }`.
 * Trả `null` nếu không khớp `dd/MM/yyyy` hoặc không phải ngày lịch có thật.
 */
export function parseDdMmYyyy(value: string): ParsedDate | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!isValidCalendarDate(day, month, year)) {
    return null;
  }
  return {
    day,
    month,
    year,
    comparable: year * 10_000 + month * 100 + day,
  };
}

/**
 * Phân tích tham số `ctx.today` (`YYYY-MM-DD`, `dd/MM/yyyy` hoặc `Date`) theo UTC.
 */
export function parseTodayContext(today: string | Date): ParsedDate {
  if (today instanceof Date) {
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth() + 1;
    const day = today.getUTCDate();
    return {
      day,
      month,
      year,
      comparable: year * 10_000 + month * 100 + day,
    };
  }

  const trimmed = today.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (isValidCalendarDate(day, month, year)) {
      return {
        day,
        month,
        year,
        comparable: year * 10_000 + month * 100 + day,
      };
    }
  }

  const dmyParsed = parseDdMmYyyy(trimmed);
  if (dmyParsed) {
    return dmyParsed;
  }

  throw new Error(
    `ctx.today không hợp lệ (${today}); cần định dạng YYYY-MM-DD, dd/MM/yyyy hoặc đối tượng Date hợp lệ.`,
  );
}

/** Đếm số ký tự Unicode (code points) sau khi chuẩn hóa NFC (DATA-SPEC.md §2). */
function charLength(value: string): number {
  return Array.from(value.normalize('NFC')).length;
}

/** Escape ký tự đặc biệt khi ghép `facilityId` vào biểu thức chính quy. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Kiểm tra toàn bộ bản ghi GKSK lái xe (đã qua `normalizeRecord` hoặc bản ghi 25 khóa)
 * theo DATA-SPEC.md §1 (server-mirror R/W) và §2 (`LOCAL_*`).
 *
 * Hàm thuần, không I/O, không gọi `Date.now()` / giờ hệ thống.
 */
export function validateRecord(record: GkskRecord, ctx: ValidateContext): Issue[] {
  const issues: Issue[] = [];
  const today = parseTodayContext(ctx.today);
  const facilityId = ctx.facilityId.trim();

  // ---------------------------------------------------------------------------
  // 1. Các lỗi chặn Server-Mirror (cột Server = R trong DATA-SPEC.md §1)
  // ---------------------------------------------------------------------------

  // #1 SO
  const so = record.SO.trim();
  const soLen = charLength(so);
  if (so === '') {
    issues.push({
      code: 'GKSK_SO_MISSING',
      field: 'SO',
      severity: 'error',
      source: 'server-mirror',
    });
  } else if (soLen > SO_SERVER_MAX_LENGTH) {
    issues.push({
      code: 'GKSK_SO_TOO_LONG',
      field: 'SO',
      severity: 'error',
      source: 'server-mirror',
    });
  }

  // #3 HOTEN (1..255 ký tự)
  const hoten = record.HOTEN.trim();
  const hotenLen = charLength(hoten);
  if (hoten === '' || hotenLen > 255) {
    issues.push({
      code: 'GKSK_HOTEN_INVALID',
      field: 'HOTEN',
      severity: 'error',
      source: 'server-mirror',
    });
  }

  // #5 NGAYSINH (bắt buộc, ngày thật dd/MM/yyyy, năm 1900..năm hiện tại)
  const ngaysinhRaw = record.NGAYSINH.trim();
  const ngaysinhParsed = parseDdMmYyyy(ngaysinhRaw);
  if (
    !ngaysinhParsed ||
    ngaysinhParsed.year < 1900 ||
    ngaysinhParsed.year > today.year
  ) {
    issues.push({
      code: 'GKSK_NGAYSINH_INVALID',
      field: 'NGAYSINH',
      severity: 'error',
      source: 'server-mirror',
    });
  }

  // #10 SOCMND_PASSPORT (bắt buộc)
  const socmnd = record.SOCMND_PASSPORT.trim();
  if (socmnd === '') {
    issues.push({
      code: 'GKSK_ID_MISSING',
      field: 'SOCMND_PASSPORT',
      severity: 'error',
      source: 'server-mirror',
    });
  }

  // #14 IDBENHVIEN (phải bằng mã CSYT tài khoản)
  const idBenhVien = record.IDBENHVIEN.trim();
  if (idBenhVien === '' || idBenhVien !== facilityId) {
    issues.push({
      code: 'GKSK_FACILITY_MISMATCH',
      field: 'IDBENHVIEN',
      severity: 'error',
      source: 'server-mirror',
    });
  }

  // #16 NGAYKETLUAN (bắt buộc, ngày dd/MM/yyyy hợp lệ)
  const ngayKetLuanRaw = record.NGAYKETLUAN.trim();
  const ngayKetLuanParsed = parseDdMmYyyy(ngayKetLuanRaw);
  if (!ngayKetLuanParsed) {
    issues.push({
      code: 'GKSK_NGAYKETLUAN_INVALID',
      field: 'NGAYKETLUAN',
      severity: 'error',
      source: 'server-mirror',
    });
  }

  // #21 KETLUAN (bắt buộc)
  const ketLuan = record.KETLUAN.trim();
  if (ketLuan === '') {
    issues.push({
      code: 'GKSK_KETLUAN_MISSING',
      field: 'KETLUAN',
      severity: 'error',
      source: 'server-mirror',
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Các cảnh báo Server-Mirror (cột Server = W trong DATA-SPEC.md §1)
  // ---------------------------------------------------------------------------

  // Ngày không bắt buộc với Sở nhưng nếu có giá trị phải đúng dd/MM/yyyy:
  // NGAYKHAM, NGAYTHANGNAMCAP, NGAYKHAMLAI -> GKSK_DATE_INVALID
  const optionalDateTags: readonly FieldTag[] = [
    'NGAYKHAM',
    'NGAYTHANGNAMCAP',
    'NGAYKHAMLAI',
  ];
  for (const dateTag of optionalDateTags) {
    const val = record[dateTag].trim();
    if (val !== '' && !parseDdMmYyyy(val)) {
      issues.push({
        code: 'GKSK_DATE_INVALID',
        field: dateTag,
        severity: 'warning',
        source: 'server-mirror',
      });
    }
  }

  // #4 GIOITINHVAL: khác rỗng và ngoài {'0', '1'} -> GKSK_GIOITINH_UNKNOWN
  const gioiTinh = record.GIOITINHVAL.trim();
  if (gioiTinh !== '' && !VALID_BINARY_ENUM.has(gioiTinh)) {
    issues.push({
      code: 'GKSK_GIOITINH_UNKNOWN',
      field: 'GIOITINHVAL',
      severity: 'warning',
      source: 'server-mirror',
    });
  }

  // #10 SOCMND_PASSPORT: toàn số 0, hoặc toàn chữ số nhưng dài 10 hay 11 chữ số -> GKSK_ID_INVALID
  if (socmnd !== '') {
    const isAllZeros = /^0+$/.test(socmnd);
    const isTenOrElevenDigits = /^\d{10,11}$/.test(socmnd);
    if (isAllZeros || isTenOrElevenDigits) {
      issues.push({
        code: 'GKSK_ID_INVALID',
        field: 'SOCMND_PASSPORT',
        severity: 'warning',
        source: 'server-mirror',
      });
    }
  }

  // #17 NONGDOCON: số với '.' hoặc ',' -> GKSK_NONGDOCON_INVALID
  const nongDoCon = record.NONGDOCON.trim();
  if (nongDoCon !== '' && !NONGDOCON_REGEX.test(nongDoCon)) {
    issues.push({
      code: 'GKSK_NONGDOCON_INVALID',
      field: 'NONGDOCON',
      severity: 'warning',
      source: 'server-mirror',
    });
  }

  // #18 DVINONGDOCON: khác rỗng và ngoài {'0', '1'} -> GKSK_DVINONGDOCON_INVALID
  const dviNongDoCon = record.DVINONGDOCON.trim();
  if (dviNongDoCon !== '' && !VALID_BINARY_ENUM.has(dviNongDoCon)) {
    issues.push({
      code: 'GKSK_DVINONGDOCON_INVALID',
      field: 'DVINONGDOCON',
      severity: 'warning',
      source: 'server-mirror',
    });
  }

  // #19 MATUY: khác rỗng và ngoài {'0', '1'} -> GKSK_MATUY_INVALID
  const maTuy = record.MATUY.trim();
  if (maTuy !== '' && !VALID_BINARY_ENUM.has(maTuy)) {
    issues.push({
      code: 'GKSK_MATUY_INVALID',
      field: 'MATUY',
      severity: 'warning',
      source: 'server-mirror',
    });
  }

  // #21 KETLUAN: khác rỗng và ngoài {'A0-1', 'A0-2', 'A0-3'} -> GKSK_KETLUAN_UNKNOWN
  if (ketLuan !== '' && !VALID_KETLUAN.has(ketLuan)) {
    issues.push({
      code: 'GKSK_KETLUAN_UNKNOWN',
      field: 'KETLUAN',
      severity: 'warning',
      source: 'server-mirror',
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Các cảnh báo & thông tin cục bộ (LOCAL_* trong DATA-SPEC.md §2)
  // ---------------------------------------------------------------------------

  // LOCAL_FIELD_OVER_SPEC: mọi thẻ có maxLength (trừ SO) khi độ dài > maxLength
  for (const tag of FIELD_ORDER) {
    if (tag === 'SO') {
      continue;
    }
    const maxLen = FIELD_BY_TAG[tag].maxLength;
    if (maxLen === undefined) {
      continue;
    }
    const val = record[tag].trim();
    if (val !== '' && charLength(val) > maxLen) {
      issues.push({
        code: 'LOCAL_FIELD_OVER_SPEC',
        field: tag,
        severity: 'warning',
        source: 'local',
      });
    }
  }

  // LOCAL_SO_OVER_20 (info): SO dài 21..30 ký tự
  if (soLen > SO_BHXH_MAX_LENGTH && soLen <= SO_SERVER_MAX_LENGTH) {
    issues.push({
      code: 'LOCAL_SO_OVER_20',
      field: 'SO',
      severity: 'info',
      source: 'local',
    });
  }

  // LOCAL_SO_FORMAT (info): SO khác rỗng nhưng không khớp ^\d{5}/GKSKLX/<IDBENHVIEN>/\d{2}$
  if (so !== '') {
    const targetFacility = facilityId !== '' ? facilityId : idBenhVien;
    const soFormatRegex = new RegExp(
      `^\\d{5}/GKSKLX/${escapeRegExp(targetFacility)}/\\d{2}$`,
    );
    if (!soFormatRegex.test(so)) {
      issues.push({
        code: 'LOCAL_SO_FORMAT',
        field: 'SO',
        severity: 'info',
        source: 'local',
      });
    }
  }

  // LOCAL_BHXH_REQUIRED_EMPTY (info): thẻ có bhxhRequired = true nhưng để trống,
  // chỉ tính các thẻ Sở không bắt buộc (soRequired = false) và gộp thành ĐÚNG 1 DÒNG.
  const emptyBhxhTags: FieldTag[] = [];
  for (const tag of BHXH_REQUIRED_TAGS) {
    if (FIELD_BY_TAG[tag].soRequired) {
      continue;
    }
    if (record[tag].trim() === '') {
      emptyBhxhTags.push(tag);
    }
  }
  if (emptyBhxhTags.length > 0) {
    issues.push({
      code: 'LOCAL_BHXH_REQUIRED_EMPTY',
      field: null,
      fields: emptyBhxhTags,
      severity: 'info',
      source: 'local',
    });
  }

  // LOCAL_NGAYSINH_FUTURE (warning): NGAYSINH hợp lệ trong năm hiện tại nhưng sau hôm nay
  if (
    ngaysinhParsed &&
    ngaysinhParsed.year >= 1900 &&
    ngaysinhParsed.year <= today.year &&
    ngaysinhParsed.comparable > today.comparable
  ) {
    issues.push({
      code: 'LOCAL_NGAYSINH_FUTURE',
      field: 'NGAYSINH',
      severity: 'warning',
      source: 'local',
    });
  }

  // LOCAL_KETLUAN_A03_NO_RECHECK (warning): KETLUAN = A0-3 mà NGAYKHAMLAI trống
  if (ketLuan === 'A0-3' && record.NGAYKHAMLAI.trim() === '') {
    issues.push({
      code: 'LOCAL_KETLUAN_A03_NO_RECHECK',
      field: 'NGAYKHAMLAI',
      severity: 'warning',
      source: 'local',
    });
  }

  // LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM (warning): NGAYKETLUAN < NGAYKHAM
  const ngayKhamParsed = parseDdMmYyyy(record.NGAYKHAM.trim());
  if (
    ngayKetLuanParsed &&
    ngayKhamParsed &&
    ngayKetLuanParsed.comparable < ngayKhamParsed.comparable
  ) {
    issues.push({
      code: 'LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM',
      field: 'NGAYKETLUAN',
      severity: 'warning',
      source: 'local',
    });
  }

  // LOCAL_ID_CREATES_PERSON (warning): SOCMND_PASSPORT là 9 hoặc 12 chữ số (và không phải toàn số 0)
  if (
    socmnd !== '' &&
    !/^0+$/.test(socmnd) &&
    (/^\d{9}$/.test(socmnd) || /^\d{12}$/.test(socmnd))
  ) {
    issues.push({
      code: 'LOCAL_ID_CREATES_PERSON',
      field: 'SOCMND_PASSPORT',
      severity: 'warning',
      source: 'local',
    });
  }

  return issues;
}

/**
 * Kiểm tra danh sách `Issue[]` có chứa lỗi chặn (`severity === 'error'`) hay không.
 */
export function hasBlockingErrors(issues: readonly Issue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
