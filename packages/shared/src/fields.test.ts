import { describe, expect, it } from 'vitest';
import {
  BHXH_OPTIONAL_TAGS,
  BHXH_REQUIRED_TAGS,
  EXCEL_REQUIRED_COLUMNS,
  FIELD_BY_TAG,
  FIELD_ORDER,
  FIELDS,
  SENSITIVE_TAGS,
  SO_BHXH_MAX_LENGTH,
  SO_REQUIRED_TAGS,
  SO_SERVER_MAX_LENGTH,
  TEMPLATE_FIELDS,
  createEmptyRecord,
} from './fields.js';
import type { FieldTag } from './types.js';

describe('FIELDS — đặc tả 25 trường GKSK lái xe theo bảng BHXH (DATA-SPEC.md §1)', () => {
  const EXPECTED_BHXH_ORDER: readonly FieldTag[] = [
    'SO',
    'NGAYKHAM',
    'HOTEN',
    'GIOITINHVAL',
    'NGAYSINH',
    'DIACHITHUONGTRU',
    'MATINH_THUONGTRU',
    'MAHUYEN_THUONGTRU',
    'MAXA_THUONGTRU',
    'SOCMND_PASSPORT',
    'NGAYTHANGNAMCAP',
    'NOICAP',
    'HANGBANGLAI',
    'IDBENHVIEN',
    'BENHVIEN',
    'NGAYKETLUAN',
    'NONGDOCON',
    'DVINONGDOCON',
    'MATUY',
    'BACSYKETLUAN',
    'KETLUAN',
    'NGAYKHAMLAI',
    'LYDO',
    'TINHTRANGBENH',
    'STATE',
  ];

  it('có đúng 25 trường, đúng thứ tự BHXH, không trùng lặp tag', () => {
    expect(FIELDS).toHaveLength(25);
    expect(FIELD_ORDER).toHaveLength(25);
    expect(FIELDS.map((f) => f.tag)).toEqual(EXPECTED_BHXH_ORDER);
    expect(FIELD_ORDER).toEqual(EXPECTED_BHXH_ORDER);
    expect(new Set(FIELD_ORDER).size).toBe(25);

    expect(FIELD_ORDER[0]).toBe('SO');
    expect(FIELD_ORDER[1]).toBe('NGAYKHAM');
    expect(FIELD_ORDER[24]).toBe('STATE');

    FIELDS.forEach((field, index) => {
      expect(field.order).toBe(index + 1);
      expect(FIELD_BY_TAG[field.tag]).toBe(field);
      expect(field.label.trim().length).toBeGreaterThan(0);
    });
  });

  it('định nghĩa maxLength khớp 100% bảng DATA-SPEC.md §1', () => {
    const expectedMaxLength: Record<FieldTag, number | undefined> = {
      SO: 20,
      NGAYKHAM: 10,
      HOTEN: 255,
      GIOITINHVAL: 20,
      NGAYSINH: 10,
      DIACHITHUONGTRU: 255,
      MATINH_THUONGTRU: 10,
      MAHUYEN_THUONGTRU: 10,
      MAXA_THUONGTRU: 10,
      SOCMND_PASSPORT: 12,
      NGAYTHANGNAMCAP: 10,
      NOICAP: 30,
      HANGBANGLAI: 10,
      IDBENHVIEN: 255,
      BENHVIEN: 255,
      NGAYKETLUAN: 10,
      NONGDOCON: undefined,
      DVINONGDOCON: 1,
      MATUY: 1,
      BACSYKETLUAN: 255,
      KETLUAN: 10,
      NGAYKHAMLAI: 10,
      LYDO: 255,
      TINHTRANGBENH: 255,
      STATE: 5,
    };

    for (const tag of FIELD_ORDER) {
      expect(FIELD_BY_TAG[tag].maxLength, `maxLength của ${tag}`).toBe(expectedMaxLength[tag]);
    }
    expect(SO_BHXH_MAX_LENGTH).toBe(20);
    expect(SO_SERVER_MAX_LENGTH).toBe(30);
    expect(FIELD_BY_TAG.SO.serverMaxLength).toBe(30);
  });

  it('có đúng 3 trường bhxhRequired=false (NGAYKHAMLAI, LYDO, TINHTRANGBENH) và 22 trường true', () => {
    expect(BHXH_OPTIONAL_TAGS).toEqual(['NGAYKHAMLAI', 'LYDO', 'TINHTRANGBENH']);
    expect(BHXH_REQUIRED_TAGS).toHaveLength(22);
    expect(BHXH_OPTIONAL_TAGS.length + BHXH_REQUIRED_TAGS.length).toBe(25);
  });

  it('có đúng 7 trường Sở bắt buộc (SO, HOTEN, NGAYSINH, SOCMND_PASSPORT, IDBENHVIEN, NGAYKETLUAN, KETLUAN)', () => {
    expect(SO_REQUIRED_TAGS).toEqual([
      'SO',
      'HOTEN',
      'NGAYSINH',
      'SOCMND_PASSPORT',
      'IDBENHVIEN',
      'NGAYKETLUAN',
      'KETLUAN',
    ]);
    expect(SO_REQUIRED_TAGS).toHaveLength(7);
  });

  it('có đúng 4 trường nhạy cảm (SENSITIVE_TAGS)', () => {
    expect(SENSITIVE_TAGS).toEqual(['NONGDOCON', 'MATUY', 'LYDO', 'TINHTRANGBENH']);
  });

  it('cấu hình đúng 23 cột mẫu Excel, 2 trường chỉ đọc tự điền từ cấu hình và 6 cột bắt buộc Excel', () => {
    expect(TEMPLATE_FIELDS).toHaveLength(23);
    expect(TEMPLATE_FIELDS.some((f) => f.tag === 'IDBENHVIEN')).toBe(false);
    expect(TEMPLATE_FIELDS.some((f) => f.tag === 'BENHVIEN')).toBe(false);

    const readOnlyTags = FIELDS.filter((f) => f.readOnly).map((f) => f.tag);
    expect(readOnlyTags).toEqual(['IDBENHVIEN', 'BENHVIEN']);

    expect(EXCEL_REQUIRED_COLUMNS).toEqual([
      'SO',
      'HOTEN',
      'NGAYSINH',
      'SOCMND_PASSPORT',
      'NGAYKETLUAN',
      'KETLUAN',
    ]);
    expect(FIELD_BY_TAG.GIOITINHVAL.excelAliases).toEqual(['GIOITINH']);
  });

  it('khai báo đúng enumValues cho 5 trường enum', () => {
    expect(FIELD_BY_TAG.GIOITINHVAL.enumValues).toEqual(['0', '1']);
    expect(FIELD_BY_TAG.DVINONGDOCON.enumValues).toEqual(['0', '1']);
    expect(FIELD_BY_TAG.MATUY.enumValues).toEqual(['0', '1']);
    expect(FIELD_BY_TAG.KETLUAN.enumValues).toEqual(['A0-1', 'A0-2', 'A0-3']);
    expect(FIELD_BY_TAG.STATE.enumValues).toEqual(['ADD', 'EDIT']);
  });

  it('createEmptyRecord tạo object đủ 25 khóa theo thứ tự BHXH với giá trị rỗng', () => {
    const rec = createEmptyRecord();
    expect(Object.keys(rec)).toEqual(FIELD_ORDER);
    for (const tag of FIELD_ORDER) {
      expect(rec[tag]).toBe('');
    }
  });
});
