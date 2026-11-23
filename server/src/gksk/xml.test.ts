import { describe, expect, it } from 'vitest';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { FIELD_ORDER, createEmptyRecord, type GkskRecord } from '@gksk/shared';
import {
  MAX_XML_BYTES,
  XmlSizeLimitError,
  buildGkskXml,
  escapeXmlText,
  stripInvalidXmlChars,
  toBase64Utf8,
} from './xml.js';

/** Bản ghi mẫu hoàn toàn là dữ liệu giả theo DATA-SPEC.md §6. */
function makeSampleRecord(overrides: Partial<GkskRecord> = {}): GkskRecord {
  return {
    ...createEmptyRecord(),
    SO: 'TEST.75001.1700000000.1',
    NGAYKHAM: '05/11/2026',
    HOTEN: 'TEST NGUYEN VAN A',
    GIOITINHVAL: '0',
    NGAYSINH: '21/05/1990',
    DIACHITHUONGTRU: 'So 1 Duong Thu, Bien Hoa, Dong Nai',
    MATINH_THUONGTRU: '75',
    MAHUYEN_THUONGTRU: '75731',
    MAXA_THUONGTRU: '7573126041',
    SOCMND_PASSPORT: 'TESTGKSK01',
    NGAYTHANGNAMCAP: '01/02/2021',
    NOICAP: 'Cuc CS QLHC',
    HANGBANGLAI: 'B',
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
  };
}

function parseRootWithFastXml(xml: string): Record<string, string> {
  const valid = XMLValidator.validate(xml);
  expect(valid).toBe(true);

  const parser = new XMLParser({
    parseTagValue: false,
    parseAttributeValue: false,
    ignoreAttributes: false,
  });

  const parsed = parser.parse(xml) as { root?: Record<string, string> };
  expect(parsed.root).toBeDefined();
  return parsed.root ?? {};
}

describe('gksk/xml — buildGkskXml & toBase64Utf8', () => {
  it('khớp snapshot XML chuẩn cho bản ghi mẫu (DATA-SPEC.md §4 & §6)', () => {
    const xml = buildGkskXml(makeSampleRecord());

    const expected = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<root>',
      '  <SO>TEST.75001.1700000000.1</SO>',
      '  <NGAYKHAM>05/11/2026</NGAYKHAM>',
      '  <HOTEN>TEST NGUYEN VAN A</HOTEN>',
      '  <GIOITINHVAL>0</GIOITINHVAL>',
      '  <NGAYSINH>21/05/1990</NGAYSINH>',
      '  <DIACHITHUONGTRU>So 1 Duong Thu, Bien Hoa, Dong Nai</DIACHITHUONGTRU>',
      '  <MATINH_THUONGTRU>75</MATINH_THUONGTRU>',
      '  <MAHUYEN_THUONGTRU>75731</MAHUYEN_THUONGTRU>',
      '  <MAXA_THUONGTRU>7573126041</MAXA_THUONGTRU>',
      '  <SOCMND_PASSPORT>TESTGKSK01</SOCMND_PASSPORT>',
      '  <NGAYTHANGNAMCAP>01/02/2021</NGAYTHANGNAMCAP>',
      '  <NOICAP>Cuc CS QLHC</NOICAP>',
      '  <HANGBANGLAI>B</HANGBANGLAI>',
      '  <IDBENHVIEN>75001</IDBENHVIEN>',
      '  <BENHVIEN>Benh vien Thu</BENHVIEN>',
      '  <NGAYKETLUAN>06/11/2026</NGAYKETLUAN>',
      '  <NONGDOCON>0</NONGDOCON>',
      '  <DVINONGDOCON>0</DVINONGDOCON>',
      '  <MATUY>0</MATUY>',
      '  <BACSYKETLUAN>TEST BAC SI</BACSYKETLUAN>',
      '  <KETLUAN>A0-1</KETLUAN>',
      '  <NGAYKHAMLAI></NGAYKHAMLAI>',
      '  <LYDO></LYDO>',
      '  <TINHTRANGBENH></TINHTRANGBENH>',
      '  <STATE>ADD</STATE>',
      '</root>',
      '',
    ].join('\n');

    expect(xml).toBe(expected);
  });

  it('xuất đủ đúng 25 thẻ theo thứ tự BHXH và thẻ rỗng có dạng <TAG></TAG>', () => {
    const emptyRecord = createEmptyRecord();
    const xml = buildGkskXml(emptyRecord);

    const openTags = Array.from(xml.matchAll(/^ {2}<([A-Z0-9_]+)><\/\1>$/gm), (m) => m[1]);
    expect(openTags).toEqual([...FIELD_ORDER]);
    expect(openTags).toHaveLength(25);
    expect(xml).not.toMatch(/<[A-Z0-9_]+\s*\/>/);
    expect(xml).not.toContain('\r\n');
  });

  it('round-trip bằng fast-xml-parser khớp 100% 25 giá trị gồm & < > " \', tiếng Việt có dấu và xuống dòng', () => {
    const record = makeSampleRecord({
      SO: 'TEST.75001.1700000000.2',
      HOTEN: 'TEST NGUYỄN VĂN Ă & B <C> "D" \'E\'',
      DIACHITHUONGTRU: 'Số 12/3 Đường 30/4 & Nguyễn Ái Quốc, Biên Hòa, Đồng Nai',
      NOICAP: 'Cục CS QLHC về TTXH',
      BENHVIEN: 'Bệnh viện Thử nghiệm & Kiểm định "Đồng Nai"',
      BACSYKETLUAN: 'BS. TRẦN THỊ BÍCH NGỌC',
      KETLUAN: 'A0-3',
      NGAYKHAMLAI: '06/05/2027',
      LYDO: 'Dòng 1: Thị lực < 8/10 & cần đeo kính "chuẩn"\nDòng 2: Khám lại sau \'6 tháng\' > quy định',
      TINHTRANGBENH: 'Tình trạng bình thường\t— ghi chú có dấu tiếng Việt: Đặng, Ước, Ắc',
      STATE: 'EDIT',
    });

    const xml = buildGkskXml(record);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&gt;');
    expect(xml).toContain('&quot;');
    expect(xml).toContain('&apos;');

    const root = parseRootWithFastXml(xml);
    expect(Object.keys(root)).toEqual([...FIELD_ORDER]);

    for (const tag of FIELD_ORDER) {
      expect(root[tag]).toBe(record[tag]);
    }
  });

  it('không chứa BOM, DOCTYPE, comment, Signature hay các thẻ ngoài danh sách 25 thẻ', () => {
    const xml = buildGkskXml(makeSampleRecord());
    const utf8Bytes = Buffer.from(xml, 'utf8');

    expect(xml.charCodeAt(0)).toBe('<'.charCodeAt(0));
    expect(xml.charCodeAt(0)).not.toBe(0xfeff);
    expect(utf8Bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(xml).not.toContain('DOCTYPE');
    expect(xml).not.toContain('<!--');
    expect(xml).not.toContain('Signature');
    expect(xml).not.toContain('<UUID');
    expect(xml).not.toContain('<STATUS');
    expect(xml).not.toContain('<SIGNDATA');
  });

  it('escape an toàn dữ liệu có dạng thẻ XML/DOCTYPE/comment để không phá vỡ cấu trúc XML', () => {
    const record = makeSampleRecord({
      LYDO: '<!DOCTYPE foo><!-- comment --><Signature>fake</Signature></LYDO><SO>INJECTED</SO>',
    });

    const xml = buildGkskXml(record);
    expect(xml).not.toContain('<!DOCTYPE');
    expect(xml).not.toContain('<!--');
    expect(xml).not.toContain('<Signature>');

    const root = parseRootWithFastXml(xml);
    expect(Object.keys(root)).toEqual([...FIELD_ORDER]);
    expect(root.SO).toBe('TEST.75001.1700000000.1');
    expect(root.LYDO).toBe(record.LYDO);
  });

  it('xác định tuyệt đối: hai lần gọi với cùng bản ghi trả về chuỗi giống hệt nhau', () => {
    const record = makeSampleRecord({
      HOTEN: 'TEST PHẠM THỊ ĐÀO',
      LYDO: 'A & B\nC < D',
    });

    const first = buildGkskXml(record);
    const second = buildGkskXml(record);
    expect(first).toBe(second);
  });

  it('loại bỏ toàn bộ ký tự điều khiển cấm của XML 1.0 và giữ nguyên \\t, \\n', () => {
    const dirty = 'A\x00B\x01C\x08D\x0BE\x0CF\x0EG\x1FH\uFFFEI\uFFFFJ\tK\nL';
    expect(stripInvalidXmlChars(dirty)).toBe('ABCDEFGHIJ\tK\nL');
    expect(escapeXmlText('A\x00 & <B>')).toBe('A &amp; &lt;B&gt;');

    const record = makeSampleRecord({
      HOTEN: 'TEST\x00 NGUYEN\x07 VAN\x1F A',
      LYDO: 'Dong 1\x0B\x0C\nDong 2\tOK\uFFFE\uFFFF',
    });
    const xml = buildGkskXml(record);

    expect(xml).not.toContain('\x00');
    const root = parseRootWithFastXml(xml);
    expect(root.HOTEN).toBe('TEST NGUYEN VAN A');
    expect(root.LYDO).toBe('Dong 1\nDong 2\tOK');
  });

  it('ném XmlSizeLimitError khi kích thước XML UTF-8 vượt quá 1 MB và không lộ nội dung hồ sơ', () => {
    const secretPayload = 'NHAY_CAM_KHONG_DUOC_LO_'.repeat(50_000);
    const oversized = makeSampleRecord({
      LYDO: secretPayload,
    });

    let caught: unknown;
    try {
      buildGkskXml(oversized);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(XmlSizeLimitError);
    const err = caught as XmlSizeLimitError;
    expect(err.byteLength).toBeGreaterThan(MAX_XML_BYTES);
    expect(err.maxBytes).toBe(MAX_XML_BYTES);
    expect(err.message).not.toContain('NHAY_CAM_KHONG_DUOC_LO');
  });

  it('toBase64Utf8 mã hóa và giải mã lại khớp chính xác từng byte UTF-8 (kể cả tiếng Việt & Golden Vector)', () => {
    // Kiểm tra Golden Vector XML ở API-CONTRACT.md §5
    expect(toBase64Utf8('<root><SO>TEST.75001.1</SO></root>')).toBe(
      'PHJvb3Q+PFNPPlRFU1QuNzUwMDEuMTwvU08+PC9yb290Pg==',
    );

    const record = makeSampleRecord({
      HOTEN: 'TEST ĐẶNG THỊ ÁNH TUYẾT',
      DIACHITHUONGTRU: 'Số 99 Đường Đồng Khởi, TP. Biên Hòa, Tỉnh Đồng Nai',
      LYDO: 'Ký tự đặc biệt: & < > " \'\nDòng thứ 2',
    });

    const xml = buildGkskXml(record);
    const b64 = toBase64Utf8(xml);

    // Base64 chuẩn không có ký tự xuống dòng
    expect(b64).not.toMatch(/[\r\n]/);
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/);

    const decodedBuf = Buffer.from(b64, 'base64');
    const expectedBuf = Buffer.from(xml, 'utf8');
    expect(decodedBuf.equals(expectedBuf)).toBe(true);
    expect(decodedBuf.toString('utf8')).toBe(xml);
  });
});
