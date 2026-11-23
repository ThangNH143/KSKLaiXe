import { FIELD_ORDER, type GkskRecord } from '@gksk/shared';

/** Khai báo XML chuẩn UTF-8 (không BOM, không DOCTYPE). */
export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/** Giới hạn kích thước tối đa của file XML UTF-8 theo API-CONTRACT.md §3 & DATA-SPEC.md §4 (1 MB). */
export const MAX_XML_BYTES = 1024 * 1024;

/**
 * Biểu thức chính quy lọc bỏ các ký tự điều khiển cấm trong XML 1.0:
 * - \x00-\x08
 * - \x0B, \x0C
 * - \x0E-\x1F
 * - \uFFFE, \uFFFF
 * (Giữ nguyên \x09 = \t, \x0A = \n, \x0D = \r).
 */
// eslint-disable-next-line no-control-regex
const INVALID_XML10_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;

const XML_ESCAPE_MAP: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

const XML_ESCAPE_REGEX = /[&<>"']/g;

/** Lỗi khi kích thước XML UTF-8 vượt giới hạn 1 MB của API (không chứa PII trong thông điệp). */
export class XmlSizeLimitError extends Error {
  readonly byteLength: number;
  readonly maxBytes: number;

  constructor(byteLength: number, maxBytes: number = MAX_XML_BYTES) {
    super(
      `Kích thước XML (${byteLength} byte) vượt giới hạn tối đa ${maxBytes} byte (1 MB).`,
    );
    this.name = 'XmlSizeLimitError';
    this.byteLength = byteLength;
    this.maxBytes = maxBytes;
  }
}

/**
 * Loại bỏ các ký tự điều khiển bị cấm trong XML 1.0.
 */
export function stripInvalidXmlChars(value: string): string {
  return value.replace(INVALID_XML10_CHARS_REGEX, '');
}

/**
 * Xóa ký tự điều khiển cấm XML 1.0 và escape 5 ký tự đặc biệt XML (`& < > " '`).
 */
export function escapeXmlText(value: string): string {
  return stripInvalidXmlChars(value).replace(
    XML_ESCAPE_REGEX,
    (ch) => XML_ESCAPE_MAP[ch] ?? ch,
  );
}

/**
 * Dựng chuỗi XML GKSK Lái xe từ bản ghi 25 trường theo đúng DATA-SPEC.md §4:
 * - Khai báo `<?xml version="1.0" encoding="UTF-8"?>` (không BOM, không DOCTYPE, không comment, không Signature).
 * - Gốc `<root>`, xuất đủ 25 thẻ theo đúng thứ tự bảng BHXH (`FIELD_ORDER`).
 * - Thẻ rỗng xuất dạng `<TAG></TAG>`, thụt 2 khoảng trắng, kết thúc dòng `\n`.
 * - Escape `& < > " '` và xóa ký tự điều khiển cấm XML 1.0.
 * - Kiểm tra tổng kích thước UTF-8 không vượt quá 1 MB.
 */
export function buildGkskXml(record: GkskRecord): string {
  const lines: string[] = [XML_DECLARATION, '<root>'];

  for (const tag of FIELD_ORDER) {
    const rawValue = record[tag] ?? '';
    const escaped = escapeXmlText(rawValue);
    lines.push(`  <${tag}>${escaped}</${tag}>`);
  }

  lines.push('</root>');
  const xml = `${lines.join('\n')}\n`;

  const byteLength = Buffer.byteLength(xml, 'utf8');
  if (byteLength > MAX_XML_BYTES) {
    throw new XmlSizeLimitError(byteLength, MAX_XML_BYTES);
  }

  return xml;
}

/**
 * Mã hóa chuỗi XML sang Base64 chuẩn (có padding `=`, không xuống dòng) từ byte UTF-8.
 */
export function toBase64Utf8(xml: string): string {
  return Buffer.from(xml, 'utf8').toString('base64');
}
