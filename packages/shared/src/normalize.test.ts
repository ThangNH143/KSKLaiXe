import { describe, expect, it } from 'vitest';
import {
  cleanText,
  excelSerialToDdMmYyyy,
  formatDdMmYyyy,
  isValidCalendarDate,
  normalizeDateValue,
  normalizeGioiTinhValue,
  normalizeIdValue,
  normalizeKetLuanValue,
  normalizeRecord,
  normalizeStateValue,
} from './normalize.js';

describe('normalize — chuẩn hóa dữ liệu GKSK lái xe (DATA-SPEC.md §3)', () => {
  it('trim, chuẩn hóa Unicode về NFC và xóa ký tự điều khiển XML 1.0 không hợp lệ', () => {
    // Chuỗi NFD ("Nguyễn" tách dấu) -> NFC
    const nfd = '  Nguye\u0302\u0303n Va\u0306n A\x00\x07\x0B\x0C\x1F\uFFFE\uFFFF  ';
    const rec = normalizeRecord({
      HOTEN: nfd,
      LYDO: 'Dòng 1\nDòng 2\tChi tiết',
    });

    expect(rec.HOTEN).toBe('Nguyễn Văn A');
    expect(rec.HOTEN).toBe(rec.HOTEN.normalize('NFC'));
    // Giữ nguyên \n và \t hợp lệ của XML 1.0
    expect(rec.LYDO).toBe('Dòng 1\nDòng 2\tChi tiết');
  });

  const dateCases: ReadonlyArray<{
    readonly name: string;
    readonly input: unknown;
    readonly expected: string;
  }> = [
    { name: 'd/M/yyyy (1 chữ số ngày & tháng)', input: '5/9/2026', expected: '05/09/2026' },
    { name: 'd/MM/yyyy (21/5/1990)', input: '21/5/1990', expected: '21/05/1990' },
    { name: 'dd/MM/yyyy hợp lệ', input: '21/05/1990', expected: '21/05/1990' },
    { name: 'yyyy-MM-dd chuẩn ISO', input: '1990-05-21', expected: '21/05/1990' },
    { name: 'yyyy-M-d rút gọn', input: '2026-11-5', expected: '05/11/2026' },
    { name: 'năm nhuận 29/02/2024', input: '29/2/2024', expected: '29/02/2024' },
    {
      name: 'Date object UTC (1990-05-21T00:00:00.000Z)',
      input: new Date(Date.UTC(1990, 4, 21)),
      expected: '21/05/1990',
    },
    {
      name: 'Date object không hợp lệ (new Date("invalid"))',
      input: new Date('not-a-date'),
      expected: 'Invalid Date',
    },
    { name: 'Excel serial number 33014 -> 21/05/1990', input: 33014, expected: '21/05/1990' },
    { name: 'Excel serial number 46332 -> 06/11/2026', input: 46332, expected: '06/11/2026' },
    { name: 'Excel serial number 45351 -> 29/02/2024', input: 45351, expected: '29/02/2024' },
    { name: 'Excel serial chuỗi "33014" -> 21/05/1990', input: '33014', expected: '21/05/1990' },
    {
      name: 'Excel serial có phần thập phân giờ (46332.75) -> 06/11/2026',
      input: 46332.75,
      expected: '06/11/2026',
    },
    {
      name: 'ngày không tồn tại 31/02/1990 -> giữ nguyên để validator bắt lỗi',
      input: '31/02/1990',
      expected: '31/02/1990',
    },
    {
      name: 'năm không nhuận 29/02/2025 -> giữ nguyên để validator bắt lỗi',
      input: '29/02/2025',
      expected: '29/02/2025',
    },
    {
      name: 'tháng 4 chỉ có 30 ngày (31/04/2026) -> giữ nguyên để validator bắt lỗi',
      input: '31/04/2026',
      expected: '31/04/2026',
    },
    {
      name: 'ISO ngày không tồn tại 2025-02-29 -> giữ nguyên để validator bắt lỗi',
      input: '2025-02-29',
      expected: '2025-02-29',
    },
    { name: 'chuỗi sai định dạng "abc" -> giữ nguyên', input: 'abc', expected: 'abc' },
    { name: 'số âm (-5) ngoài phạm vi serial -> giữ chuỗi "-5"', input: -5, expected: '-5' },
    { name: 'null / undefined / rỗng -> ""', input: null, expected: '' },
  ];

  it.each(dateCases)('chuẩn hóa ngày: $name', ({ input, expected }) => {
    const rec = normalizeRecord({ NGAYSINH: input });
    expect(rec.NGAYSINH).toBe(expected);
  });

  it('SOCMND_PASSPORT giữ nguyên số 0 đầu, bỏ dấu nháy đơn đầu và khoảng trắng bên trong', () => {
    expect(normalizeRecord({ SOCMND_PASSPORT: '079000012345' }).SOCMND_PASSPORT).toBe(
      '079000012345',
    );
    expect(normalizeRecord({ SOCMND_PASSPORT: "'079 000 012 345" }).SOCMND_PASSPORT).toBe(
      '079000012345',
    );
    // Nếu truyền số đã mất số 0 đầu (79000012345) thì không tự bù số 0 đầu
    expect(normalizeRecord({ SOCMND_PASSPORT: 79000012345 }).SOCMND_PASSPORT).toBe(
      '79000012345',
    );
  });

  it.each([
    { raw: '0', expected: '0' },
    { raw: 'Nam', expected: '0' },
    { raw: 'NAM', expected: '0' },
    { raw: 'm', expected: '0' },
    { raw: 'M', expected: '0' },
    { raw: '1', expected: '1' },
    { raw: 'Nữ', expected: '1' },
    { raw: 'nữ', expected: '1' },
    { raw: 'Nu', expected: '1' },
    { raw: 'f', expected: '1' },
    { raw: 'F', expected: '1' },
    { raw: '', expected: '' },
    { raw: '2', expected: '2' },
    { raw: 'Khác', expected: 'Khác' },
  ])('chuẩn hóa GIOITINHVAL ($raw -> $expected) và nhận bí danh GIOITINH', ({ raw, expected }) => {
    expect(normalizeRecord({ GIOITINHVAL: raw }).GIOITINHVAL).toBe(expected);
    expect(normalizeRecord({ GIOITINH: raw }).GIOITINHVAL).toBe(expected);
  });

  it('ưu tiên GIOITINHVAL nếu cả GIOITINHVAL và bí danh GIOITINH cùng có mặt', () => {
    expect(normalizeRecord({ GIOITINHVAL: '1', GIOITINH: '0' }).GIOITINHVAL).toBe('1');
  });

  it.each([
    { raw: 'A0-1', expected: 'A0-1' },
    { raw: 'a0-1', expected: 'A0-1' },
    { raw: 'A0–2', expected: 'A0-2' }, // en-dash
    { raw: 'a0—3', expected: 'A0-3' }, // em-dash
    { raw: 'A0 − 1', expected: 'A0-1' }, // minus sign + khoảng trắng
    { raw: 'a0 - 2', expected: 'A0-2' },
    { raw: '', expected: '' },
    { raw: 'ok', expected: 'OK' },
  ])('chuẩn hóa KETLUAN ($raw -> $expected)', ({ raw, expected }) => {
    expect(normalizeRecord({ KETLUAN: raw }).KETLUAN).toBe(expected);
  });

  it('chuẩn hóa STATE: rỗng mặc định là ADD, có giá trị thì viết hoa', () => {
    expect(normalizeRecord({}).STATE).toBe('ADD');
    expect(normalizeRecord({ STATE: '   ' }).STATE).toBe('ADD');
    expect(normalizeRecord({ STATE: 'edit' }).STATE).toBe('EDIT');
    expect(normalizeRecord({ STATE: 'add' }).STATE).toBe('ADD');
  });

  it('các hàm phụ trợ xử lý đúng biên ngày và serial Excel', () => {
    expect(isValidCalendarDate(15, 0, 2026)).toBe(false);
    expect(isValidCalendarDate(15, 13, 2026)).toBe(false);
    expect(isValidCalendarDate(0, 5, 2026)).toBe(false);
    expect(isValidCalendarDate(15, 5, 999)).toBe(false);
    expect(excelSerialToDdMmYyyy(Number.NaN)).toBeNull();
    expect(excelSerialToDdMmYyyy(0)).toBeNull();
    expect(excelSerialToDdMmYyyy(3_000_000)).toBeNull();
    expect(formatDdMmYyyy(5, 11, 2026)).toBe('05/11/2026');
    expect(cleanText('  A\x00B  ')).toBe('AB');
    expect(normalizeDateValue(undefined)).toBe('');
    expect(normalizeDateValue('   ')).toBe('');
    expect(normalizeDateValue('99999999')).toBe('99999999');
    expect(normalizeIdValue("'012 345")).toBe('012345');
    expect(normalizeGioiTinhValue('Nam')).toBe('0');
    expect(normalizeKetLuanValue('a0–1')).toBe('A0-1');
    expect(normalizeStateValue('')).toBe('ADD');
  });
});
