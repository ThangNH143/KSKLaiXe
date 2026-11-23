import { FIELD_BY_TAG, FIELD_ORDER } from './fields.js';
import type { FieldTag, GkskRecord } from './types.js';

/**
 * Biểu thức chính quy xóa các ký tự điều khiển không hợp lệ theo chuẩn XML 1.0:
 * - \x00-\x08
 * - \x0B, \x0C
 * - \x0E-\x1F
 * - \uFFFE, \uFFFF
 * (Giữ nguyên \x09 = \t, \x0A = \n, \x0D = \r).
 */
// eslint-disable-next-line no-control-regex
const INVALID_XML10_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;

/** Gốc thời gian số serial ngày Excel: 1899-12-30T00:00:00.000Z (đã xử lý sai số 1900 leap-year). */
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

/** Giới hạn serial Excel hợp lý: 1 (31/12/1899) đến 2958465 (31/12/9999). */
const MIN_EXCEL_SERIAL = 1;
const MAX_EXCEL_SERIAL = 2_958_465;

export type RawFieldValue = string | number | boolean | Date | null | undefined;
export type RawRecordInput = Readonly<Partial<Record<string, unknown>>>;

/**
 * Kiểm tra một bộ (ngày, tháng, năm) có tạo thành ngày lịch Gregorius có thật hay không
 * (tính theo UTC, không phụ thuộc múi giờ máy).
 */
export function isValidCalendarDate(day: number, month: number, year: number): boolean {
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    year < 1000 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  return (
    utcDate.getUTCFullYear() === year &&
    utcDate.getUTCMonth() === month - 1 &&
    utcDate.getUTCDate() === day
  );
}

/** Định dạng bộ (day, month, year) thành `dd/MM/yyyy` (zero-padded). */
export function formatDdMmYyyy(day: number, month: number, year: number): string {
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  const yyyy = String(year).padStart(4, '0');
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Chuyển số serial ngày Excel sang `dd/MM/yyyy` tính theo UTC từ gốc `1899-12-30`.
 * Trả `null` nếu số serial nằm ngoài phạm vi hợp lý hoặc không hữu hạn.
 */
export function excelSerialToDdMmYyyy(serial: number): string | null {
  if (!Number.isFinite(serial)) {
    return null;
  }
  const wholeDays = Math.floor(serial);
  if (wholeDays < MIN_EXCEL_SERIAL || wholeDays > MAX_EXCEL_SERIAL) {
    return null;
  }
  const utcDate = new Date(EXCEL_EPOCH_UTC_MS + wholeDays * MS_PER_DAY);
  return formatDdMmYyyy(
    utcDate.getUTCDate(),
    utcDate.getUTCMonth() + 1,
    utcDate.getUTCFullYear(),
  );
}

/**
 * Xóa ký tự điều khiển XML 1.0 không hợp lệ, chuẩn hóa Unicode NFC và `trim()`.
 */
export function cleanText(value: string): string {
  return value.replace(INVALID_XML10_CHARS_REGEX, '').normalize('NFC').trim();
}

/**
 * Chuẩn hóa một giá trị ngày theo DATA-SPEC.md §3:
 * - Đối tượng `Date`: lấy ngày/tháng/năm theo UTC → `dd/MM/yyyy` (nếu `Invalid Date` trả `Invalid Date`).
 * - Số hoặc chuỗi số nguyên dương (serial Excel, vd `33014`, `45351`, `46332`): tính từ `1899-12-30` UTC → `dd/MM/yyyy`.
 * - Chuỗi `d/M/yyyy` hoặc `dd/MM/yyyy`: nếu là ngày lịch hợp lệ → `dd/MM/yyyy` (zero-padded); nếu ngày không tồn tại (vd `31/02/1990`, `29/02/2025`, `31/04/2026`) → giữ nguyên chuỗi gốc để validator báo lỗi.
 * - Chuỗi `yyyy-MM-dd` (hoặc `yyyy-M-d`): nếu là ngày lịch hợp lệ → `dd/MM/yyyy`; nếu ngày không tồn tại → giữ nguyên chuỗi gốc để validator báo lỗi.
 */
export function normalizeDateValue(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return '';
  }

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      return 'Invalid Date';
    }
    return formatDdMmYyyy(
      raw.getUTCDate(),
      raw.getUTCMonth() + 1,
      raw.getUTCFullYear(),
    );
  }

  if (typeof raw === 'number') {
    const converted = excelSerialToDdMmYyyy(raw);
    return converted ?? cleanText(String(raw));
  }

  const text = cleanText(String(raw));
  if (text === '') {
    return '';
  }

  // d/M/yyyy hoặc dd/MM/yyyy
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    if (isValidCalendarDate(day, month, year)) {
      return formatDdMmYyyy(day, month, year);
    }
    return text;
  }

  // yyyy-MM-dd hoặc yyyy-M-d
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    if (isValidCalendarDate(day, month, year)) {
      return formatDdMmYyyy(day, month, year);
    }
    return text;
  }

  // Chuỗi số serial Excel (ví dụ "33014" hoặc "45351.0")
  if (/^\d+(\.0+)?$/.test(text)) {
    const serial = Number(text);
    const converted = excelSerialToDdMmYyyy(serial);
    if (converted !== null) {
      return converted;
    }
  }

  return text;
}

/**
 * Chuẩn hóa `SOCMND_PASSPORT` theo DATA-SPEC.md §3:
 * - Đọc là chuỗi, bỏ dấu `'` ở đầu (ký hiệu ép kiểu text của Excel) và bỏ mọi khoảng trắng bên trong.
 * - Không tự bù số 0 đầu.
 */
export function normalizeIdValue(text: string): string {
  const withoutLeadingApostrophe = text.replace(/^'+/, '');
  return withoutLeadingApostrophe.replace(/\s+/g, '');
}

/**
 * Chuẩn hóa `GIOITINHVAL` theo DATA-SPEC.md §3:
 * - Nhận `0`, `1` hoặc `Nam / Nữ / Nu / M / F` (không phân biệt hoa thường) → `0` hoặc `1`.
 * - Giá trị khác giữ nguyên (để validator cảnh báo `GKSK_GIOITINH_UNKNOWN`).
 */
export function normalizeGioiTinhValue(text: string): string {
  if (text === '') {
    return '';
  }
  const lower = text.toLowerCase();
  if (lower === '0' || lower === 'nam' || lower === 'm') {
    return '0';
  }
  if (lower === '1' || lower === 'nữ' || lower === 'nu' || lower === 'f') {
    return '1';
  }
  return text;
}

/**
 * Chuẩn hóa `KETLUAN` theo DATA-SPEC.md §3:
 * - Chuyển chữ hoa, thay en-dash (`–`, \u2013), em-dash (`—`, \u2014), minus (`−`, \u2212) và khoảng trắng quanh dấu gạch ngang về `-`.
 */
export function normalizeKetLuanValue(text: string): string {
  if (text === '') {
    return '';
  }
  return text
    .toUpperCase()
    .replace(/\s*[-–—−]\s*/g, '-');
}

/**
 * Chuẩn hóa `STATE` theo DATA-SPEC.md §3:
 * - Rỗng → `ADD`; có giá trị → viết hoa.
 */
export function normalizeStateValue(text: string): string {
  if (text === '') {
    return 'ADD';
  }
  return text.toUpperCase();
}

/**
 * Trích giá trị thô của một trường từ input, hỗ trợ bí danh cột Excel (ví dụ `GIOITINH` cho `GIOITINHVAL`
 * khi `GIOITINHVAL` không được truyền hoặc bằng `undefined`).
 */
function pickRawFieldValue(raw: RawRecordInput, tag: FieldTag): unknown {
  if (Object.prototype.hasOwnProperty.call(raw, tag) && raw[tag] !== undefined) {
    return raw[tag];
  }
  const aliases = FIELD_BY_TAG[tag].excelAliases;
  if (aliases) {
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(raw, alias) && raw[alias] !== undefined) {
        return raw[alias];
      }
    }
  }
  return undefined;
}

/**
 * Chuẩn hóa toàn bộ bản ghi GKSK lái xe (25 trường) theo DATA-SPEC.md §3.
 * Hàm thuần, không I/O, không phụ thuộc múi giờ máy.
 */
export function normalizeRecord(raw: RawRecordInput): GkskRecord {
  const result = {} as GkskRecord;

  for (const tag of FIELD_ORDER) {
    const spec = FIELD_BY_TAG[tag];
    const rawVal = pickRawFieldValue(raw, tag);

    if (spec.type === 'date') {
      result[tag] = normalizeDateValue(rawVal);
      continue;
    }

    const baseText =
      rawVal === null || rawVal === undefined ? '' : cleanText(String(rawVal));

    switch (tag) {
      case 'SOCMND_PASSPORT':
        result[tag] = normalizeIdValue(baseText);
        break;
      case 'GIOITINHVAL':
        result[tag] = normalizeGioiTinhValue(baseText);
        break;
      case 'KETLUAN':
        result[tag] = normalizeKetLuanValue(baseText);
        break;
      case 'STATE':
        result[tag] = normalizeStateValue(baseText);
        break;
      default:
        result[tag] = baseText;
        break;
    }
  }

  return result;
}
