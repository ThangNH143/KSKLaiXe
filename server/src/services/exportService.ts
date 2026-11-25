import zlib from 'node:zlib';
import ExcelJS from 'exceljs';
import {
  formatIssueMessage,
  hasBlockingErrors,
  TEMPLATE_FIELDS,
  validateRecord,
  type CertificateStatus,
  type FieldTag,
  type GkskRecord,
  type Issue,
  type ServerIssue,
} from '@gksk/shared';
import { buildGkskXml } from '../gksk/xml.js';

/** Độ lệch múi giờ Việt Nam (UTC+7) tính bằng mili giây. */
const VN_UTC_OFFSET_MS = 7 * 3600 * 1000;

/**
 * 6 cột đối soát nằm ở cuối file Excel đối soát (DATA-SPEC.md §5.4).
 * Khi người dùng sửa trực tiếp trên file Excel đối soát rồi Import ngược lại ở S11,
 * 6 cột này sẽ được xem là cột phụ bỏ qua (không báo lỗi).
 */
export const RECONCILE_EXTRA_COLUMNS = [
  'TRANG_THAI_DOI_SOAT',
  'DOT_IMPORT',
  'THOI_GIAN_DAY',
  'MSG_ID',
  'CERTIFICATE_ID_SO',
  'CHI_TIET_LOI_CANH_BAO',
] as const;

export type ReconcileExtraColumn = (typeof RECONCILE_EXTRA_COLUMNS)[number];

/** Danh sách 23 tên cột dữ liệu gốc theo đúng thứ tự bảng BHXH (DATA-SPEC.md §1 & §5.1). */
export const RECONCILE_TEMPLATE_COLUMNS: readonly FieldTag[] = TEMPLATE_FIELDS.map(
  (field) => field.tag,
);

/** Tổng hợp 29 cột của file Excel đối soát (23 cột gốc + 6 cột đối soát). */
export const RECONCILE_ALL_COLUMNS: readonly string[] = [
  ...RECONCILE_TEMPLATE_COLUMNS,
  ...RECONCILE_EXTRA_COLUMNS,
];

/** Bảng tra CRC-32 chuẩn IEEE 802.3 (dùng cho định dạng PKZIP). */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** Tính mã kiểm tra CRC-32 của một Buffer. */
export function computeCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i]!;
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Làm sạch mã số giấy (`SO`) để tạo tên file XML an toàn, không cho phép thoát thư mục
 * (`..`, `/`, `\`) hoặc chứa ký tự cấm của hệ thống file Windows/POSIX (`/ \ : * ? " < > |` và ký tự điều khiển).
 *
 * Ví dụ:
 * - `"TEST.75001.1"` -> `"TEST.75001.1.xml"`
 * - `"00001/GKSKLX/75001/26"` -> `"00001_GKSKLX_75001_26.xml"`
 * - `"../../etc/passwd"` -> `"_etc_passwd.xml"`
 */
export function sanitizeXmlFileName(so: string): string {
  // eslint-disable-next-line no-control-regex
  const withoutControls = so.trim().replace(/[\x00-\x1f\x7f]+/g, '_');
  const withoutPathTraversal = withoutControls.replace(/\.\.+/g, '_');
  const withoutForbidden = withoutPathTraversal.replace(/[/\\:*?"<>|]+/g, '_');
  const collapsed = withoutForbidden
    .replace(/_+/g, '_')
    .replace(/^[._\s]+|[._\s]+$/g, '');

  const baseName = collapsed.length > 0 ? collapsed : 'GKSK';
  if (baseName.toLowerCase().endsWith('.xml')) {
    const stem = baseName.slice(0, -4).replace(/^[._\s]+|[._\s]+$/g, '');
    return `${stem.length > 0 ? stem : 'GKSK'}.xml`;
  }
  return `${baseName}.xml`;
}

/** Bí danh tương thích với tên hàm nêu trong IMPLEMENTATION-PLAN.md S10 (`buildXmlFileName`). */
export const buildXmlFileName = sanitizeXmlFileName;

/**
 * Định dạng mốc thời gian theo giờ Việt Nam (`UTC+7`) thành `YYYYMMDD_HHmmss`
 * dùng cho tên file `GKSK_XML_<YYYYMMDD_HHmmss>.zip` và `GKSK_doi_soat_<YYYYMMDD_HHmmss>.xlsx`.
 */
export function formatVnFileTimestamp(now: number | Date = Date.now()): string {
  const ms = now instanceof Date ? now.getTime() : now;
  const safeMs = Number.isFinite(ms) ? ms : Date.now();
  const vnIso = new Date(safeMs + VN_UTC_OFFSET_MS).toISOString();
  const yyyymmdd = vnIso.slice(0, 4) + vnIso.slice(5, 7) + vnIso.slice(8, 10);
  const hhmmss = vnIso.slice(11, 13) + vnIso.slice(14, 16) + vnIso.slice(17, 19);
  return `${yyyymmdd}_${hhmmss}`;
}

/**
 * Định dạng thời gian gửi gần nhất sang chuỗi giờ Việt Nam (`dd/MM/yyyy HH:mm:ss`)
 * để hiển thị trong cột `THOI_GIAN_DAY` của file Excel đối soát.
 */
export function formatVnDateTimeDisplay(
  value?: number | string | Date | null,
): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  let ms: number;
  if (typeof value === 'number') {
    ms = value;
  } else if (value instanceof Date) {
    ms = value.getTime();
  } else {
    ms = Date.parse(value);
  }
  if (!Number.isFinite(ms)) {
    return '';
  }
  const vnIso = new Date(ms + VN_UTC_OFFSET_MS).toISOString();
  const yyyy = vnIso.slice(0, 4);
  const mm = vnIso.slice(5, 7);
  const dd = vnIso.slice(8, 10);
  const timePart = vnIso.slice(11, 19);
  return `${dd}/${mm}/${yyyy} ${timePart}`;
}

/** Dữ liệu đầu vào cho một giấy khi đóng gói `.zip` nhiều file XML. */
export type XmlZipInputItem =
  | GkskRecord
  | {
      so?: string;
      fields: GkskRecord;
      status?: CertificateStatus;
      issues?: readonly Issue[];
      xml?: string;
    };

export interface BuildXmlZipOptions {
  /** Mã CSYT để kiểm tra lỗi chặn nếu cần tự gọi `validateRecord`. */
  facilityId?: string;
  /** Ngày hiện tại (`YYYY-MM-DD`) truyền vào `validateRecord`. */
  today?: string | Date;
}

export interface ZipEntryInfo {
  fileName: string;
  uncompressedSize: number;
  compressedSize: number;
  crc32: number;
}

function isGkskRecordDirect(item: XmlZipInputItem): item is GkskRecord {
  return (
    typeof item === 'object' &&
    item !== null &&
    !('fields' in item) &&
    typeof (item as GkskRecord).SO === 'string'
  );
}

/**
 * Đóng gói danh sách file vào định dạng PKZIP chuẩn (метод DEFLATE = 8, có cờ UTF-8 bit 11).
 * Tương thích 100% với Windows Explorer, 7-Zip, WinRAR, macOS Archive Utility và `unzip`.
 */
export function createZipArchiveBuffer(
  entries: ReadonlyArray<{ fileName: string; content: Buffer }>,
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  // Mốc giờ DOS mặc định cố định (2026-11-23 08:00:00) để kết quả đóng gói xác định (deterministic)
  const dosTime = (8 << 11) | (0 << 5) | 0;
  const dosDate = ((2026 - 1980) << 9) | (11 << 5) | 23;
  const utf8Flag = 0x0800; // Bit 11: tên file mã hóa UTF-8
  const compressionMethod = 8; // 8 = DEFLATE

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.fileName, 'utf8');
    const rawBuf = entry.content;
    const compressedBuf = zlib.deflateRawSync(rawBuf, { level: 6 });
    const crc = computeCrc32(rawBuf);

    // Local File Header (30 bytes + fileName)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed to extract (2.0)
    localHeader.writeUInt16LE(utf8Flag, 6); // general purpose bit flag
    localHeader.writeUInt16LE(compressionMethod, 8); // compression method (DEFLATE)
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedBuf.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localParts.push(localHeader, nameBuf, compressedBuf);

    // Central Directory File Header (46 bytes + fileName)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed to extract
    centralHeader.writeUInt16LE(utf8Flag, 8);
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedBuf.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(0, 38); // external file attributes
    centralHeader.writeUInt32LE(localOffset, 42); // relative offset of local header

    centralParts.push(centralHeader, nameBuf);
    localOffset += localHeader.length + nameBuf.length + compressedBuf.length;
  }

  const centralDirBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // End of central directory signature
  eocd.writeUInt16LE(0, 4); // number of this disk
  eocd.writeUInt16LE(0, 6); // disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8); // number of central directory records on this disk
  eocd.writeUInt16LE(entries.length, 10); // total number of central directory records
  eocd.writeUInt32LE(centralDirBuffer.length, 12); // size of central directory
  eocd.writeUInt32LE(localOffset, 16); // offset of start of central directory
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirBuffer, eocd]);
}

/**
 * Giải nén buffer `.zip` (do `buildXmlZip` sinh ra) thành danh sách `{ fileName, content }`
 * để phục vụ kiểm thử round-trip khớp từng byte UTF-8.
 */
export function extractZipArchiveBuffer(
  zipBuffer: Buffer,
): Array<{ fileName: string; content: Buffer }> {
  // Tìm End of Central Directory (EOCD - 0x06054b50) từ cuối buffer
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= 0; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Buffer không phải là định dạng ZIP hợp lệ (thiếu EOCD).');
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  const results: Array<{ fileName: string; content: Buffer }> = [];
  let ptr = centralDirOffset;

  for (let idx = 0; idx < totalEntries; idx++) {
    const sig = zipBuffer.readUInt32LE(ptr);
    if (sig !== 0x02014b50) {
      throw new Error(`Central directory header tại offset ${ptr} không hợp lệ.`);
    }

    const method = zipBuffer.readUInt16LE(ptr + 10);
    const expectedCrc = zipBuffer.readUInt32LE(ptr + 16);
    const compressedSize = zipBuffer.readUInt32LE(ptr + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(ptr + 24);
    const nameLen = zipBuffer.readUInt16LE(ptr + 28);
    const extraLen = zipBuffer.readUInt16LE(ptr + 30);
    const commentLen = zipBuffer.readUInt16LE(ptr + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(ptr + 42);

    const fileName = zipBuffer
      .subarray(ptr + 46, ptr + 46 + nameLen)
      .toString('utf8');

    const localSig = zipBuffer.readUInt32LE(localHeaderOffset);
    if (localSig !== 0x04034b50) {
      throw new Error(`Local file header tại offset ${localHeaderOffset} không hợp lệ.`);
    }
    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedData = zipBuffer.subarray(dataStart, dataStart + compressedSize);

    let content: Buffer;
    if (method === 0) {
      content = Buffer.from(compressedData);
    } else if (method === 8) {
      content = zlib.inflateRawSync(compressedData);
    } else {
      throw new Error(`Phương thức nén ZIP method=${method} không được hỗ trợ.`);
    }

    if (content.length !== uncompressedSize) {
      throw new Error(
        `Kích thước giải nén của ${fileName} không khớp (${content.length} !== ${uncompressedSize}).`,
      );
    }
    const actualCrc = computeCrc32(content);
    if (actualCrc !== expectedCrc) {
      throw new Error(
        `CRC-32 của ${fileName} không khớp (${actualCrc} !== ${expectedCrc}).`,
      );
    }

    results.push({ fileName, content });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return results;
}

/**
 * Đóng gói nhiều file `<SO>.xml` của các giấy hợp lệ (không có lỗi dữ liệu chặn) vào một Buffer `.zip`
 * theo đúng DATA-SPEC.md §4 và IMPLEMENTATION-PLAN.md S10.
 *
 * - Các bản ghi đang ở trạng thái `invalid` hoặc có lỗi chặn (`hasBlockingErrors`) sẽ tự động bị bỏ qua.
 * - Tên mỗi file bên trong `.zip` được làm sạch qua `sanitizeXmlFileName(so)`. Nếu có hai bản ghi
 *   sau khi làm sạch bị trùng tên file thì tự động đánh hậu tố `_2.xml`, `_3.xml`... để không đè nhau.
 */
export function buildXmlZip(
  records: readonly XmlZipInputItem[],
  options?: BuildXmlZipOptions,
): Buffer {
  const usedNames = new Map<string, number>();
  const zipEntries: Array<{ fileName: string; content: Buffer }> = [];

  for (const item of records) {
    const fields = isGkskRecordDirect(item) ? item : item.fields;
    const status = isGkskRecordDirect(item) ? undefined : item.status;

    if (status === 'invalid') {
      continue;
    }

    const facilityId = (options?.facilityId ?? fields.IDBENHVIEN ?? '').trim();
    const today = options?.today ?? new Date();
    const issues =
      !isGkskRecordDirect(item) && item.issues
        ? item.issues
        : validateRecord(fields, {
            facilityId,
            today,
          });

    if (hasBlockingErrors(issues)) {
      continue;
    }

    const so = (!isGkskRecordDirect(item) && item.so ? item.so : fields.SO).trim();
    const baseFileName = sanitizeXmlFileName(so);
    const count = usedNames.get(baseFileName) ?? 0;
    usedNames.set(baseFileName, count + 1);

    const finalFileName =
      count === 0
        ? baseFileName
        : `${baseFileName.slice(0, -4)}_${count + 1}.xml`;

    const xml =
      !isGkskRecordDirect(item) && typeof item.xml === 'string'
        ? item.xml
        : buildGkskXml(fields);

    zipEntries.push({
      fileName: finalFileName,
      content: Buffer.from(xml, 'utf8'),
    });
  }

  return createZipArchiveBuffer(zipEntries);
}

/**
 * Ánh xạ trạng thái giấy GKSK sang nhãn tiếng Việt chuẩn trong cột `TRANG_THAI_DOI_SOAT`
 * theo đúng DATA-SPEC.md §5.4 và ARCHITECTURE.md §8.
 */
export function formatReconcileStatusLabel(status: CertificateStatus): string {
  switch (status) {
    case 'accepted':
      return 'Đã đẩy thành công';
    case 'ready':
      return 'Chờ đẩy cổng';
    case 'invalid':
      return 'Lỗi dữ liệu Excel';
    case 'rejected':
      return 'Cổng Sở từ chối';
    case 'error':
      return 'Lỗi mạng - Chờ gửi lại';
    case 'sending':
      return 'Đang đẩy cổng';
  }
}

/** Dữ liệu đầu vào của mỗi dòng khi xuất file Excel đối soát (`buildReconcileExcel`). */
export interface ReconcileExcelItem {
  so?: string;
  fields: GkskRecord;
  status: CertificateStatus;
  batchFilename?: string | null;
  excelRowNumber?: number | null;
  serverCertificateId?: string | null;
  /** Thời gian gửi gần nhất (epoch ms, ISO string hoặc Date). */
  lastSentAt?: number | string | Date | null;
  /** `msg_id` của lần gửi gần nhất. */
  lastMsgId?: string | null;
  /** Các vấn đề kiểm tra cục bộ (`validateRecord`). */
  localIssues?: readonly Issue[];
  /** Các lỗi từ chối trả về từ Hệ thống Sở (`submission.errors`). */
  serverErrors?: readonly ServerIssue[];
  /** Các cảnh báo trả về từ Hệ thống Sở (`submission.warnings`). */
  serverWarnings?: readonly ServerIssue[];
  /** Thông báo lỗi mạng/cấu hình của lần gửi gần nhất (`submission.lastError`). */
  lastError?: string | null;
}

/**
 * Định dạng chuỗi tiếng Việt mô tả chi tiết lỗi/cảnh báo cho cột `CHI_TIET_LOI_CANH_BAO`
 * trong file Excel đối soát (DATA-SPEC.md §5.4).
 */
export function formatReconcileIssueDetails(item: ReconcileExcelItem): string {
  const parts: string[] = [];
  const seen = new Set<string>();

  const pushUnique = (text: string) => {
    const clean = text.trim();
    if (clean.length > 0 && !seen.has(clean)) {
      seen.add(clean);
      parts.push(clean);
    }
  };

  if (item.serverErrors && item.serverErrors.length > 0) {
    for (const err of item.serverErrors) {
      pushUnique(`[Sở từ chối - ${err.code}] ${formatIssueMessage(err)}`);
    }
  }

  if (item.lastError && item.status === 'error') {
    pushUnique(item.lastError);
  }

  if (item.localIssues && item.localIssues.length > 0) {
    // Khi giấy đang invalid, ưu tiên hiển thị các lỗi chặn và cảnh báo
    for (const issue of item.localIssues) {
      if (item.status === 'accepted' && issue.severity === 'info') {
        continue;
      }
      const prefix =
        issue.severity === 'error'
          ? `[Lỗi - ${issue.code}]`
          : issue.severity === 'warning'
            ? `[Cảnh báo - ${issue.code}]`
            : `[Thông tin - ${issue.code}]`;
      pushUnique(`${prefix} ${formatIssueMessage(issue)}`);
    }
  }

  if (item.serverWarnings && item.serverWarnings.length > 0) {
    for (const warn of item.serverWarnings) {
      pushUnique(`[Cảnh báo Sở - ${warn.code}] ${formatIssueMessage(warn)}`);
    }
  }

  return parts.join(' | ');
}

/**
 * Định dạng giá trị cột `DOT_IMPORT` (tên file Excel & số dòng).
 */
export function formatReconcileBatchInfo(
  batchFilename?: string | null,
  excelRowNumber?: number | null,
): string {
  const name = batchFilename?.trim() ?? '';
  if (name.length > 0 && typeof excelRowNumber === 'number' && excelRowNumber > 0) {
    return `${name} (dòng ${excelRowNumber})`;
  }
  if (name.length > 0) {
    return name;
  }
  if (typeof excelRowNumber === 'number' && excelRowNumber > 0) {
    return `Dòng ${excelRowNumber}`;
  }
  return '';
}

/**
 * Xuất file Excel đối soát `.xlsx` bằng `exceljs` theo đúng DATA-SPEC.md §5.4:
 * - Sheet `GKSK`:
 *   - **23 cột dữ liệu gốc** theo đúng thứ tự bảng BHXH (trừ `IDBENHVIEN`, `BENHVIEN`), định dạng Text (`numFmt = '@'`).
 *   - **6 cột đối soát ở cuối**: `TRANG_THAI_DOI_SOAT`, `DOT_IMPORT`, `THOI_GIAN_DAY`, `MSG_ID`, `CERTIFICATE_ID_SO`, `CHI_TIET_LOI_CANH_BAO`.
 * - Nhờ 23 cột đầu giữ nguyên tên thẻ và định dạng Text `@`, người dùng có thể lọc các dòng bị lỗi/từ chối,
 *   sửa trực tiếp trên file Excel đối soát này rồi đem Import ngược trở lại vào webapp!
 */
export async function buildReconcileExcel(
  items: readonly ReconcileExcelItem[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GKSKLaiXe';
  workbook.created = new Date('2026-11-23T00:00:00.000Z');

  const sheet = workbook.addWorksheet('GKSK', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = RECONCILE_ALL_COLUMNS.map((colName, index) => ({
    header: colName,
    key: colName,
    width: index < RECONCILE_TEMPLATE_COLUMNS.length ? 18 : 28,
    style: { numFmt: '@' },
  }));

  // Định dạng dòng tiêu đề (dòng 1)
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell, colNumber) => {
    cell.numFmt = '@';
    const isReconcileCol = colNumber > RECONCILE_TEMPLATE_COLUMNS.length;
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: isReconcileCol ? 'FFE2EFDA' : 'FFD9E1F2' },
    };
  });

  for (const item of items) {
    const rowValues: Record<string, string> = {};

    // 23 cột dữ liệu gốc
    for (const tag of RECONCILE_TEMPLATE_COLUMNS) {
      const rawVal = tag === 'SO' && item.so ? item.so : item.fields[tag];
      rowValues[tag] = typeof rawVal === 'string' ? rawVal : '';
    }

    // 6 cột đối soát ở cuối
    rowValues.TRANG_THAI_DOI_SOAT = formatReconcileStatusLabel(item.status);
    rowValues.DOT_IMPORT = formatReconcileBatchInfo(
      item.batchFilename,
      item.excelRowNumber,
    );
    rowValues.THOI_GIAN_DAY = formatVnDateTimeDisplay(item.lastSentAt);
    rowValues.MSG_ID = item.lastMsgId?.trim() ?? '';
    rowValues.CERTIFICATE_ID_SO = item.serverCertificateId?.trim() ?? '';
    rowValues.CHI_TIET_LOI_CANH_BAO = formatReconcileIssueDetails(item);

    const addedRow = sheet.addRow(rowValues);
    addedRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.numFmt = '@';
      if (typeof cell.value !== 'string') {
        cell.value = cell.value === null || cell.value === undefined ? '' : String(cell.value);
      }
    });
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
