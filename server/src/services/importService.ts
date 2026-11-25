import ExcelJS from 'exceljs';
import type { Logger } from 'pino';
import {
  cleanText,
  createEmptyRecord,
  EXCEL_REQUIRED_COLUMNS,
  FIELD_BY_TAG,
  FIELD_ORDER,
  FIELDS,
  hasBlockingErrors,
  normalizeRecord,
  SO_SERVER_MAX_LENGTH,
  TEMPLATE_FIELDS,
  validateRecord,
  type CertificateStatus,
  type ConflictMode,
  type FieldTag,
  type GkskRecord,
  type Issue,
} from '@gksk/shared';
import type {
  CertificateRow,
  DbRepositories,
  ImportBatchRow,
  UpsertCertificateInput,
} from '../db/types.js';
import { logger as defaultLogger } from '../logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { stripSensitiveFields } from './certificateService.js';
import {
  computeCertificatePayload,
  formatVnTodayIso,
  toSafeCertificateSummary,
  type SafeCertificateSummary,
} from './sendService.js';

/** Giới hạn kích thước file Excel upload tối đa: 5 MB (DATA-SPEC.md §5.2 & ARCHITECTURE.md §7). */
export const MAX_EXCEL_FILE_BYTES = 5 * 1024 * 1024;

/** Giới hạn số dòng dữ liệu tối đa trong 1 file Excel import: 1000 dòng (DATA-SPEC.md §5.2). */
export const MAX_EXCEL_DATA_ROWS = 1000;

/** Số dòng định dạng Text `@` và Data Validation trong file Excel mẫu: 2000 dòng (DATA-SPEC.md §5.1). */
export const TEMPLATE_FORMATTED_ROWS = 2000;

/** Giá trị ví dụ giả cho từng trường trong sheet `HuongDan` (DATA-SPEC.md §5.1 & §6). */
export const TEMPLATE_EXAMPLE_VALUES: Readonly<Record<FieldTag, string>> = {
  SO: 'TEST.75001.1700000000.1',
  NGAYKHAM: '05/11/2026',
  HOTEN: 'TEST NGUYEN VAN A',
  GIOITINHVAL: '0',
  NGAYSINH: '21/05/1990',
  DIACHITHUONGTRU: 'Phuong Tan Phong, Bien Hoa, Dong Nai',
  MATINH_THUONGTRU: '75',
  MAHUYEN_THUONGTRU: '75731',
  MAXA_THUONGTRU: '7573126041',
  SOCMND_PASSPORT: 'TESTGKSK01',
  NGAYTHANGNAMCAP: '10/01/2021',
  NOICAP: 'Cuc CS QLHC ve TTXH',
  HANGBANGLAI: 'B2',
  IDBENHVIEN: '75001',
  BENHVIEN: 'Benh vien Da khoa Dong Nai',
  NGAYKETLUAN: '06/11/2026',
  NONGDOCON: '0',
  DVINONGDOCON: '0',
  MATUY: '0',
  BACSYKETLUAN: 'TEST BAC SI KET LUAN',
  KETLUAN: 'A0-1',
  NGAYKHAMLAI: '',
  LYDO: '',
  TINHTRANGBENH: '',
  STATE: 'ADD',
};

/** Kiểm tra magic bytes `PK\x03\x04` (hoặc `PK\x05\x06`) của định dạng `.xlsx` (ZIP container). */
export function hasXlsxMagicBytes(buffer: Buffer): boolean {
  if (buffer.length < 4) {
    return false;
  }
  return (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
      (buffer[2] === 0x05 && buffer[3] === 0x06))
  );
}

/** Chuyển chỉ số cột 1-based (`1..26`) sang chữ cái cột Excel (`A..Z`). */
function toExcelColumnLetter(colNumber: number): string {
  let num = colNumber;
  let letters = '';
  while (num > 0) {
    const mod = (num - 1) % 26;
    letters = String.fromCharCode(65 + mod) + letters;
    num = Math.floor((num - 1) / 26);
  }
  return letters;
}

/** Đếm số ký tự Unicode (code points) sau khi chuẩn hóa NFC. */
function unicodeLength(text: string): number {
  return Array.from(text.normalize('NFC')).length;
}

/** Kết quả giải mã 1 ô Excel. */
interface ExtractedCellResult {
  rawValue: string | number | Date;
  formulaError: string | null;
}

/**
 * Trích xuất giá trị từ một ô `ExcelJS.Cell` theo đúng quy tắc DATA-SPEC.md §5.2:
 * - Ô công thức -> lấy kết quả (`result`);
 * - Ô rich-text -> ghép văn bản (`richText.map(t => t.text).join('')`);
 * - Ô lỗi công thức (`#N/A`, `#VALUE!`...) -> xem là chuỗi rỗng `""` và ghi nhận `formulaError`;
 * - Ô hyperlink -> lấy `text` hoặc `hyperlink`;
 * - Ô `Date` hoặc `number` -> giữ nguyên để `normalizeRecord` xử lý serial ngày hoặc chuỗi.
 */
export function extractExcelCellValue(cell: ExcelJS.Cell): ExtractedCellResult {
  const val = cell.value;
  if (val === null || val === undefined) {
    return { rawValue: '', formulaError: null };
  }

  if (typeof val === 'string' || typeof val === 'number' || val instanceof Date) {
    return { rawValue: val, formulaError: null };
  }

  if (typeof val === 'boolean') {
    return { rawValue: val ? '1' : '0', formulaError: null };
  }

  if (typeof val === 'object') {
    // 1. Ô lỗi trực tiếp: { error: '#N/A' }
    if ('error' in val && typeof (val as { error?: unknown }).error === 'string') {
      return {
        rawValue: '',
        formulaError: (val as { error: string }).error,
      };
    }

    // 2. Ô RichText: { richText: [{ text: '...' }] }
    if (
      'richText' in val &&
      Array.isArray((val as { richText?: unknown }).richText)
    ) {
      const parts = (val as { richText: Array<{ text?: unknown }> }).richText;
      const joined = parts
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .join('');
      return { rawValue: joined, formulaError: null };
    }

    // 3. Ô Công thức (Formula / SharedFormula): { formula?: string, sharedFormula?: string, result?: ... }
    if ('formula' in val || 'sharedFormula' in val || 'result' in val) {
      const res = (val as { result?: unknown }).result;
      if (res === null || res === undefined) {
        return { rawValue: '', formulaError: null };
      }
      if (
        typeof res === 'object' &&
        res !== null &&
        'error' in res &&
        typeof (res as { error?: unknown }).error === 'string'
      ) {
        return {
          rawValue: '',
          formulaError: (res as { error: string }).error,
        };
      }
      if (
        typeof res === 'string' ||
        typeof res === 'number' ||
        res instanceof Date
      ) {
        return { rawValue: res, formulaError: null };
      }
      if (typeof res === 'boolean') {
        return { rawValue: res ? '1' : '0', formulaError: null };
      }
      return { rawValue: String(res), formulaError: null };
    }

    // 4. Ô Hyperlink: { text: '...', hyperlink: '...' }
    if ('text' in val) {
      const textField = (val as { text?: unknown }).text;
      if (typeof textField === 'string') {
        return { rawValue: textField, formulaError: null };
      }
      if (
        typeof textField === 'object' &&
        textField !== null &&
        'richText' in textField &&
        Array.isArray((textField as { richText?: unknown }).richText)
      ) {
        const joined = (
          textField as { richText: Array<{ text?: unknown }> }
        ).richText
          .map((p) => (typeof p?.text === 'string' ? p.text : ''))
          .join('');
        return { rawValue: joined, formulaError: null };
      }
    }
  }

  return { rawValue: String(val), formulaError: null };
}

/** Thông tin một dòng trả về từ `previewImport(buffer)` (DATA-SPEC.md §5.2). */
export interface ImportPreviewRow {
  /** Số dòng thực tế trên file Excel (bắt đầu từ dòng 2 trở đi). */
  rowNumber: number;
  /** Mã số giấy đã chuẩn hóa. */
  so: string;
  /** Đủ 25 trường đã chuẩn hóa (để gửi lại lên `POST /api/import/commit`). */
  fields: GkskRecord;
  /** Mã băm SHA-256 viết hoa của Base64 XML. */
  dataSha256: string;
  /** Trạng thái dữ liệu của dòng: `'ready'` (không có lỗi chặn) hoặc `'invalid'` (có lỗi chặn). */
  status: 'ready' | 'invalid';
  /** Chế độ đối chiếu theo mã `SO` với CSDL hiện tại (`new | overwrite_pending | accepted_unchanged | accepted_modified | missing_so`). */
  conflictMode: ConflictMode;
  /** Có cho phép người dùng tick chọn lưu vào CSDL hay không (`false` nếu thiếu/quá dài `SO` hoặc bị dòng trùng `SO` phía sau ghi đè). */
  canCommit: boolean;
  /** Trạng thái tick chọn mặc định trên bảng xem trước theo đúng DATA-SPEC.md §5.2. */
  defaultSelected: boolean;
  /** ID giấy hiện có trong CSDL nếu trùng `SO`. */
  existingCertificateId: number | null;
  /** Trạng thái hiện tại trong CSDL nếu trùng `SO`. */
  existingStatus: CertificateStatus | null;
  /** Danh sách toàn bộ lỗi, cảnh báo và thông tin tiếng Việt của dòng. */
  issues: Issue[];
}

/** Thống kê tóm tắt của bản xem trước Import Excel (IMPLEMENTATION-PLAN.md S14). */
export interface ImportPreviewSummary {
  totalRows: number;
  readyCount: number;
  invalidCount: number;
  newCount: number;
  overwritePendingCount: number;
  acceptedUnchangedCount: number;
  acceptedModifiedCount: number;
  missingSoCount: number;
  defaultSelectedCount: number;
}

/** Kết quả trả về của `previewImport(buffer)` (`POST /api/import/excel`). */
export interface ImportPreviewResult {
  sheetName: string;
  matchedColumns: FieldTag[];
  ignoredColumns: string[];
  summary: ImportPreviewSummary;
  rows: ImportPreviewRow[];
}

/** Một dòng gửi lên trong body của `POST /api/import/commit`. */
export interface CommitImportRowInput {
  rowNumber?: number | null;
  fields: Partial<Record<string, unknown>>;
  selected?: boolean;
}

/** Dữ liệu đầu vào của `commitImport(payload)` (`POST /api/import/commit`). */
export interface CommitImportPayload {
  filename: string;
  rows: readonly CommitImportRowInput[];
}

/** Kết quả trả về của `commitImport(payload)`. */
export interface CommitImportResult {
  batch: ImportBatchRow;
  totalCommitted: number;
  inserted: number;
  updated: number;
  readyCount: number;
  invalidCount: number;
  skippedCount: number;
  items: SafeCertificateSummary[];
}

export interface ImportServiceOptions {
  repos: DbRepositories;
  facilityId: string;
  facilityName: string;
  today?: string | Date;
  now?: () => number;
  logger?: Logger;
}

/**
 * Tạo dòng hướng dẫn định dạng & độ dài tối đa từ `FieldSpec` cho sheet `HuongDan`
 * (lấy từ `FIELDS`, không gõ tay hai chỗ — DATA-SPEC.md §5.1).
 */
function buildFieldFormatDescription(fieldTag: FieldTag): string {
  const spec = FIELD_BY_TAG[fieldTag];
  const parts: string[] = [];

  if (spec.type === 'date') {
    parts.push('Ngày dd/MM/yyyy');
  } else if (spec.type === 'number') {
    parts.push('Số (dấu . hoặc ,)');
  } else if (spec.type === 'enum' && spec.enumValues) {
    const enumDesc = spec.enumValues
      .map((val) => {
        const label = spec.enumLabels?.[val];
        return label ? `${val} (${label})` : val;
      })
      .join(', ');
    parts.push(`Danh mục: ${enumDesc}`);
  } else {
    parts.push('Văn bản (Text)');
  }

  if (spec.serverMaxLength !== undefined && spec.maxLength !== undefined) {
    parts.push(`Tối đa ${spec.maxLength} ký tự BHXH (Sở nhận ≤ ${spec.serverMaxLength})`);
  } else if (spec.maxLength !== undefined) {
    parts.push(`Tối đa ${spec.maxLength} ký tự`);
  }

  if (spec.note) {
    parts.push(spec.note);
  }

  return parts.join(' · ');
}

function buildRequiredColumnDescription(fieldTag: FieldTag): string {
  const spec = FIELD_BY_TAG[fieldTag];
  const soText = spec.soRequired ? 'Sở: Bắt buộc' : 'Sở: Không';
  const bhxhText = spec.bhxhRequired ? 'BHXH: Không null (✔)' : 'BHXH: Cho phép null';
  return `${soText} | ${bhxhText}`;
}

/**
 * Dịch vụ tạo file Excel mẫu (`GKSK_mau_nhap_lieu.xlsx`), đọc & kiểm tra file Excel (`previewImport`)
 * với cơ chế đối chiếu trùng `SO` thông minh, và lưu vào Danh sách đối soát (`commitImport`)
 * theo đúng DATA-SPEC.md §5.1–§5.3 & IMPLEMENTATION-PLAN.md S11.
 */
export class ImportService {
  private readonly repos: DbRepositories;
  private readonly facilityId: string;
  private readonly facilityName: string;
  private readonly todayOverride: string | Date | undefined;
  private readonly nowFn: () => number;
  private readonly log: Logger;

  constructor(options: ImportServiceOptions) {
    this.repos = options.repos;
    this.facilityId = options.facilityId.trim();
    this.facilityName = options.facilityName.trim();
    this.todayOverride = options.today;
    this.nowFn = options.now ?? (() => Date.now());
    this.log = options.logger ?? defaultLogger;
  }

  private getToday(): string | Date {
    return this.todayOverride ?? formatVnTodayIso(this.nowFn());
  }

  /**
   * `GET /api/import/template` — Tạo file mẫu `GKSK_mau_nhap_lieu.xlsx` bằng `exceljs` (DATA-SPEC.md §5.1):
   * 1. Sheet `GKSK`:
   *    - Dòng 1: 23 tên thẻ theo đúng thứ tự bảng BHXH (trừ `IDBENHVIEN`, `BENHVIEN`).
   *    - Định dạng Text (`numFmt = '@'`) cho toàn bộ 23 cột trong ít nhất 2000 dòng đầu.
   *    - Để trống dữ liệu (chỉ có dòng tiêu đề dòng 1), đóng băng dòng 1 (`ySplit: 1`).
   *    - Gắn Data Validation dạng danh sách (dropdown) cho `GIOITINHVAL` (`0,1`), `DVINONGDOCON` (`0,1`),
   *      `MATUY` (`0,1`), `KETLUAN` (`A0-1,A0-2,A0-3`), `STATE` (`ADD,EDIT`).
   * 2. Sheet `HuongDan`:
   *    - Bảng 5 cột sinh tự động từ `FIELDS`: `Thẻ`, `Ý nghĩa`, `Bắt buộc (Sở / BHXH)`, `Định dạng & độ dài tối đa`, `Ví dụ mẫu`.
   */
  public async buildTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GKSKLaiXe';
    workbook.created = new Date('2026-11-23T00:00:00.000Z');

    // -------------------------------------------------------------------------
    // Sheet 1: GKSK (23 cột dữ liệu, trống dữ liệu, freeze dòng 1, Text '@')
    // -------------------------------------------------------------------------
    const gkskSheet = workbook.addWorksheet('GKSK', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    gkskSheet.columns = TEMPLATE_FIELDS.map((field) => ({
      header: field.tag,
      key: field.tag,
      width: Math.max(18, field.tag.length + 4),
      style: { numFmt: '@' },
    }));

    const headerRow = gkskSheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.numFmt = '@';
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD9E1F2' },
      };
    });

    // Áp định dạng Text '@' và Data Validation dropdown cho 2000 dòng đầu (dòng 2 -> 2001)
    const dropdownFormulaByTag: Readonly<Partial<Record<FieldTag, string>>> = {
      GIOITINHVAL: '"0,1"',
      DVINONGDOCON: '"0,1"',
      MATUY: '"0,1"',
      KETLUAN: '"A0-1,A0-2,A0-3"',
      STATE: '"ADD,EDIT"',
    };

    const totalCols = TEMPLATE_FIELDS.length;
    const lastRowNumber = TEMPLATE_FORMATTED_ROWS + 1; // dòng 2..2001 = 2000 dòng dữ liệu

    for (let colIdx = 1; colIdx <= totalCols; colIdx++) {
      const col = gkskSheet.getColumn(colIdx);
      col.numFmt = '@';
    }

    for (let rowNum = 2; rowNum <= lastRowNumber; rowNum++) {
      const row = gkskSheet.getRow(rowNum);
      for (let colIdx = 1; colIdx <= totalCols; colIdx++) {
        const cell = row.getCell(colIdx);
        cell.numFmt = '@';
      }
    }

    // Gắn Data Validation dạng list cho 5 cột enum trên khoảng dòng 2..2001
    TEMPLATE_FIELDS.forEach((field, index) => {
      const formula = dropdownFormulaByTag[field.tag];
      if (!formula) {
        return;
      }
      const colLetter = toExcelColumnLetter(index + 1);
      const sqref = `${colLetter}2:${colLetter}${lastRowNumber}`;
      const validations = (
        gkskSheet as unknown as {
          dataValidations: {
            add: (ref: string, rule: ExcelJS.DataValidation) => void;
          };
        }
      ).dataValidations;

      validations.add(sqref, {
        type: 'list',
        allowBlank: !field.soRequired,
        formulae: [formula],
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle: `Giá trị ${field.tag}`,
        error: `Giá trị khuyến nghị cho ${field.label} (${field.tag}): ${formula.replace(/"/g, '')}`,
      });
    });

    // -------------------------------------------------------------------------
    // Sheet 2: HuongDan (sinh trực tiếp từ FIELDS + dòng ví dụ giả)
    // -------------------------------------------------------------------------
    const guideSheet = workbook.addWorksheet('HuongDan', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    guideSheet.columns = [
      { header: 'Thẻ', key: 'tag', width: 24, style: { numFmt: '@' } },
      { header: 'Ý nghĩa', key: 'label', width: 32, style: { numFmt: '@' } },
      {
        header: 'Bắt buộc (Sở / BHXH)',
        key: 'required',
        width: 34,
        style: { numFmt: '@' },
      },
      {
        header: 'Định dạng & độ dài tối đa',
        key: 'format',
        width: 62,
        style: { numFmt: '@' },
      },
      {
        header: 'Ví dụ giả (chỉ dùng thử nghiệm)',
        key: 'example',
        width: 34,
        style: { numFmt: '@' },
      },
    ];

    const guideHeader = guideSheet.getRow(1);
    guideHeader.font = { bold: true };
    guideHeader.eachCell((cell) => {
      cell.numFmt = '@';
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2EFDA' },
      };
    });

    for (const field of FIELDS) {
      const exampleValue =
        field.tag === 'IDBENHVIEN'
          ? `${this.facilityId} (hệ thống tự điền)`
          : field.tag === 'BENHVIEN'
            ? `${this.facilityName} (hệ thống tự điền)`
            : TEMPLATE_EXAMPLE_VALUES[field.tag];

      const row = guideSheet.addRow({
        tag: field.tag,
        label: field.label,
        required: buildRequiredColumnDescription(field.tag),
        format: buildFieldFormatDescription(field.tag),
        example: exampleValue,
      });
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.numFmt = '@';
      });
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * `POST /api/import/excel` — Đọc file `.xlsx` từ Buffer bộ nhớ, kiểm tra dữ liệu từng dòng
   * và đối chiếu mã `SO` với CSDL hiện tại để phân loại 5 chế độ `conflictMode` (DATA-SPEC.md §5.2).
   */
  public async previewImport(buffer: Buffer): Promise<ImportPreviewResult> {
    if (!buffer || buffer.length === 0) {
      throw new AppError(
        'EMPTY_EXCEL_FILE',
        'File tải lên đang rỗng.',
        400,
      );
    }

    if (buffer.length > MAX_EXCEL_FILE_BYTES) {
      throw new AppError(
        'EXCEL_FILE_TOO_LARGE',
        'Kích thước file Excel vượt quá giới hạn tối đa 5 MB.',
        413,
      );
    }

    if (!hasXlsxMagicBytes(buffer)) {
      throw new AppError(
        'INVALID_EXCEL_FORMAT',
        'File tải lên không đúng định dạng .xlsx hợp lệ (sai chữ ký ZIP/PK).',
        415,
      );
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ) as ArrayBuffer,
      );
    } catch {
      throw new AppError(
        'INVALID_EXCEL_FORMAT',
        'Không thể đọc cấu trúc file .xlsx. Vui lòng kiểm tra lại định dạng file Excel.',
        400,
      );
    }

    // Đọc sheet có tên 'GKSK' (không phân biệt hoa thường); nếu không có thì lấy sheet đầu tiên
    const worksheet =
      workbook.worksheets.find(
        (ws) => ws.name.trim().toUpperCase() === 'GKSK',
      ) ?? workbook.worksheets[0];

    if (!worksheet) {
      throw new AppError(
        'EXCEL_NO_WORKSHEET',
        'File Excel không có trang tính (sheet) nào.',
        400,
      );
    }

    // Phân tích dòng tiêu đề (dòng 1)
    const headerRow = worksheet.getRow(1);
    const maxCol = Math.max(worksheet.columnCount, headerRow.cellCount);

    // Ánh xạ tên thẻ và bí danh
    const canonicalTags = new Set<string>(FIELD_ORDER);
    const aliasToCanonical = new Map<string, FieldTag>();
    for (const field of FIELDS) {
      if (field.excelAliases) {
        for (const alias of field.excelAliases) {
          aliasToCanonical.set(alias.toUpperCase(), field.tag);
        }
      }
    }

    const directColByTag = new Map<FieldTag, number>();
    const aliasCols: Array<{
      aliasHeader: string;
      canonicalTag: FieldTag;
      colNumber: number;
    }> = [];
    const ignoredColumns: string[] = [];

    for (let colNum = 1; colNum <= maxCol; colNum++) {
      const extracted = extractExcelCellValue(headerRow.getCell(colNum));
      const rawHeader = cleanText(String(extracted.rawValue));
      if (rawHeader === '') {
        continue;
      }
      // Bỏ mọi khoảng trắng bên trong và chuyển chữ HOA để khớp cột linh hoạt
      const normalizedHeader = rawHeader.replace(/\s+/g, '').toUpperCase();

      if (canonicalTags.has(normalizedHeader)) {
        const tag = normalizedHeader as FieldTag;
        if (!directColByTag.has(tag)) {
          directColByTag.set(tag, colNum);
        } else {
          ignoredColumns.push(rawHeader);
        }
        continue;
      }

      const aliasedTag = aliasToCanonical.get(normalizedHeader);
      if (aliasedTag) {
        aliasCols.push({
          aliasHeader: rawHeader,
          canonicalTag: aliasedTag,
          colNumber: colNum,
        });
        continue;
      }

      ignoredColumns.push(rawHeader);
    }

    // Giải quyết bí danh (ví dụ GIOITINH -> GIOITINHVAL; nếu có cả hai thì GIOITINHVAL thắng và báo GIOITINH bị bỏ qua)
    const colByTag = new Map<FieldTag, number>(directColByTag);
    for (const aliasEntry of aliasCols) {
      if (colByTag.has(aliasEntry.canonicalTag)) {
        ignoredColumns.push(aliasEntry.aliasHeader);
      } else {
        colByTag.set(aliasEntry.canonicalTag, aliasEntry.colNumber);
      }
    }

    // Kiểm tra 6 cột bắt buộc phải có mặt trong file Excel (`SO`, `HOTEN`, `NGAYSINH`, `SOCMND_PASSPORT`, `KETLUAN`, `NGAYKETLUAN`)
    const missingRequiredColumns = EXCEL_REQUIRED_COLUMNS.filter(
      (reqTag) => !colByTag.has(reqTag),
    );
    if (missingRequiredColumns.length > 0) {
      throw new AppError(
        'EXCEL_MISSING_REQUIRED_COLUMNS',
        `File Excel thiếu các cột bắt buộc: ${missingRequiredColumns.join(', ')}.`,
        400,
      );
    }

    const matchedColumns = FIELD_ORDER.filter((tag) => colByTag.has(tag));

    // Đọc các dòng dữ liệu từ dòng 2 trở đi (bỏ qua dòng hoàn toàn trống)
    interface ParsedRawRow {
      rowNumber: number;
      record: GkskRecord;
      facilityMismatchInExcel: boolean;
      formulaErrorTags: FieldTag[];
    }

    const parsedRawRows: ParsedRawRow[] = [];
    const rowCount = worksheet.rowCount;
    const allScannedColNumbers = Array.from(colByTag.values());

    for (let rowNum = 2; rowNum <= rowCount; rowNum++) {
      const row = worksheet.getRow(rowNum);
      if (!row || row.cellCount === 0) {
        continue;
      }

      const rawInput: Record<string, unknown> = {};
      const formulaErrorTags: FieldTag[] = [];
      let hasAnyNonEmptyValue = false;

      // Kiểm tra các cột đã khớp
      for (const [tag, colNum] of colByTag.entries()) {
        const cell = row.getCell(colNum);
        const { rawValue, formulaError } = extractExcelCellValue(cell);
        if (formulaError !== null) {
          hasAnyNonEmptyValue = true;
          formulaErrorTags.push(tag);
          rawInput[tag] = '';
          continue;
        }
        const strTrimmed = cleanText(String(rawValue));
        if (strTrimmed !== '') {
          hasAnyNonEmptyValue = true;
        }
        rawInput[tag] = rawValue;
      }

      // Kiểm tra cả các cột ngoài danh sách khớp xem dòng có thực sự trống hoàn toàn không
      if (!hasAnyNonEmptyValue) {
        const maxRowCol = Math.max(row.cellCount, maxCol);
        for (let c = 1; c <= maxRowCol; c++) {
          if (allScannedColNumbers.includes(c)) {
            continue;
          }
          const { rawValue, formulaError } = extractExcelCellValue(row.getCell(c));
          if (formulaError !== null || cleanText(String(rawValue)) !== '') {
            hasAnyNonEmptyValue = true;
            break;
          }
        }
      }

      if (!hasAnyNonEmptyValue) {
        continue;
      }

      if (parsedRawRows.length >= MAX_EXCEL_DATA_ROWS) {
        throw new AppError(
          'EXCEL_TOO_MANY_ROWS',
          `File Excel vượt quá giới hạn tối đa ${MAX_EXCEL_DATA_ROWS} dòng dữ liệu.`,
          400,
        );
      }

      // Kiểm tra xung đột cột IDBENHVIEN nếu file Excel có cột này (DATA-SPEC.md §3 & §5.2)
      let facilityMismatchInExcel = false;
      if (colByTag.has('IDBENHVIEN')) {
        const rawFacility = cleanText(String(rawInput.IDBENHVIEN ?? ''));
        if (rawFacility !== '' && rawFacility !== this.facilityId) {
          facilityMismatchInExcel = true;
        }
      }

      const normalized = normalizeRecord(rawInput);
      // Ghi đè IDBENHVIEN và BENHVIEN bằng cấu hình server sau khi đã ghi nhận cờ xung đột
      normalized.IDBENHVIEN = this.facilityId;
      normalized.BENHVIEN = this.facilityName;

      parsedRawRows.push({
        rowNumber: rowNum,
        record: normalized,
        facilityMismatchInExcel,
        formulaErrorTags,
      });
    }

    // Xác định vị trí xuất hiện của từng mã SO hợp lệ (1..30 ký tự) trong cùng file Excel để xử lý trùng SO nội bộ
    const lastRowNumberBySo = new Map<string, number>();
    const countBySo = new Map<string, number>();

    for (const item of parsedRawRows) {
      const so = item.record.SO.trim();
      const soLen = unicodeLength(so);
      if (so !== '' && soLen <= SO_SERVER_MAX_LENGTH) {
        lastRowNumberBySo.set(so, item.rowNumber);
        countBySo.set(so, (countBySo.get(so) ?? 0) + 1);
      }
    }

    // Tra cứu hàng loạt trong DB theo danh sách SO hợp lệ
    const validSoList = Array.from(lastRowNumberBySo.keys());
    const existingRows =
      validSoList.length > 0
        ? await this.repos.certificates.findBySoList(validSoList)
        : [];
    const existingBySo = new Map<string, CertificateRow>(
      existingRows.map((row) => [row.so, row]),
    );

    const today = this.getToday();
    const seenSoCount = new Map<string, number>();
    const previewRows: ImportPreviewRow[] = [];

    const summary: ImportPreviewSummary = {
      totalRows: parsedRawRows.length,
      readyCount: 0,
      invalidCount: 0,
      newCount: 0,
      overwritePendingCount: 0,
      acceptedUnchangedCount: 0,
      acceptedModifiedCount: 0,
      missingSoCount: 0,
      defaultSelectedCount: 0,
    };

    for (const item of parsedRawRows) {
      const { rowNumber, record, facilityMismatchInExcel } = item;
      const so = record.SO.trim();
      const soLen = unicodeLength(so);
      const isValidSoKey = so !== '' && soLen <= SO_SERVER_MAX_LENGTH;

      const issues: Issue[] = validateRecord(record, {
        facilityId: this.facilityId,
        today,
      });

      if (facilityMismatchInExcel) {
        issues.unshift({
          code: 'LOCAL_FACILITY_MISMATCH',
          field: 'IDBENHVIEN',
          severity: 'error',
          source: 'local',
        });
      }

      const { dataSha256 } = computeCertificatePayload(record);
      const isInvalid = hasBlockingErrors(issues);
      const status: 'ready' | 'invalid' = isInvalid ? 'invalid' : 'ready';

      let conflictMode: ConflictMode;
      let canCommit: boolean;
      let defaultSelected: boolean;
      let existingCertificateId: number | null = null;
      let existingStatus: CertificateStatus | null = null;

      if (!isValidSoKey) {
        conflictMode = 'missing_so';
        canCommit = false;
        defaultSelected = false;
      } else {
        const seenIndex = (seenSoCount.get(so) ?? 0) + 1;
        seenSoCount.set(so, seenIndex);
        const totalOccurrences = countBySo.get(so) ?? 1;
        const isLastOccurrence = lastRowNumberBySo.get(so) === rowNumber;

        // Dòng sau cùng trở đi có cùng SO trong file nhận cảnh báo LOCAL_SO_DUPLICATE_IN_BATCH
        if (seenIndex > 1) {
          issues.push({
            code: 'LOCAL_SO_DUPLICATE_IN_BATCH',
            field: 'SO',
            severity: 'warning',
            source: 'local',
          });
        } else if (totalOccurrences > 1 && !isLastOccurrence) {
          // Dòng trước bị dòng sau trùng SO đè
          issues.push({
            code: 'LOCAL_SO_DUPLICATE_IN_BATCH',
            field: 'SO',
            severity: 'warning',
            source: 'local',
          });
        }

        if (!isLastOccurrence) {
          // Theo DATA-SPEC.md §5.2 mục 5: trùng SO trong cùng file thì chỉ cho chọn dòng cuối cùng của SO đó
          conflictMode = 'missing_so';
          canCommit = false;
          defaultSelected = false;
        } else {
          canCommit = true;
          const existing = existingBySo.get(so);
          if (!existing) {
            conflictMode = 'new';
            defaultSelected = true;
          } else {
            existingCertificateId = existing.id;
            existingStatus = existing.status;

            if (existing.status === 'accepted') {
              if (existing.dataSha256 === dataSha256) {
                conflictMode = 'accepted_unchanged';
                defaultSelected = false;
                issues.push({
                  code: 'LOCAL_SO_ACCEPTED_UNCHANGED',
                  field: 'SO',
                  severity: 'info',
                  source: 'local',
                });
              } else {
                conflictMode = 'accepted_modified';
                defaultSelected = false;
                issues.push({
                  code: 'LOCAL_SO_ACCEPTED_MODIFIED',
                  field: 'SO',
                  severity: 'warning',
                  source: 'local',
                });
              }
            } else {
              conflictMode = 'overwrite_pending';
              defaultSelected = true;
              issues.push({
                code: 'LOCAL_SO_EXISTS',
                field: 'SO',
                severity: 'info',
                source: 'local',
              });
            }
          }
        }
      }

      if (status === 'ready') {
        summary.readyCount += 1;
      } else {
        summary.invalidCount += 1;
      }

      switch (conflictMode) {
        case 'new':
          summary.newCount += 1;
          break;
        case 'overwrite_pending':
          summary.overwritePendingCount += 1;
          break;
        case 'accepted_unchanged':
          summary.acceptedUnchangedCount += 1;
          break;
        case 'accepted_modified':
          summary.acceptedModifiedCount += 1;
          break;
        case 'missing_so':
          summary.missingSoCount += 1;
          break;
      }

      if (defaultSelected) {
        summary.defaultSelectedCount += 1;
      }

      previewRows.push({
        rowNumber,
        so,
        fields: record,
        dataSha256,
        status,
        conflictMode,
        canCommit,
        defaultSelected,
        existingCertificateId,
        existingStatus,
        issues,
      });
    }

    this.log.info(
      {
        sheetName: worksheet.name,
        totalRows: summary.totalRows,
        readyCount: summary.readyCount,
        invalidCount: summary.invalidCount,
        newCount: summary.newCount,
        overwritePendingCount: summary.overwritePendingCount,
        acceptedUnchangedCount: summary.acceptedUnchangedCount,
        acceptedModifiedCount: summary.acceptedModifiedCount,
        missingSoCount: summary.missingSoCount,
        ignoredColumnsCount: ignoredColumns.length,
      },
      'Hoàn tất phân tích xem trước file Excel import',
    );

    return {
      sheetName: worksheet.name,
      matchedColumns,
      ignoredColumns,
      summary,
      rows: previewRows,
    };
  }

  /**
   * `POST /api/import/commit` — Lưu hoặc ghi đè các dòng được chọn (cả dòng `ready` lẫn dòng `invalid` có `SO` ≤ 30 ký tự)
   * vào bảng `gksk_certificates`, gắn với đợt import `gksk_import_batches` (DATA-SPEC.md §5.3).
   */
  public async commitImport(
    payload: CommitImportPayload,
  ): Promise<CommitImportResult> {
    const filename = payload.filename.trim();
    if (filename.length === 0) {
      throw new AppError(
        'INVALID_IMPORT_FILENAME',
        'Tên file Excel đợt import không được để trống.',
        400,
      );
    }

    if (!Array.isArray(payload.rows) || payload.rows.length === 0) {
      throw new AppError(
        'EMPTY_COMMIT_ROWS',
        'Danh sách dòng lưu vào đối soát không được rỗng.',
        400,
      );
    }

    if (payload.rows.length > MAX_EXCEL_DATA_ROWS) {
      throw new AppError(
        'COMMIT_TOO_MANY_ROWS',
        `Mỗi đợt lưu tối đa ${MAX_EXCEL_DATA_ROWS} dòng dữ liệu.`,
        400,
      );
    }

    const today = this.getToday();
    const nowDate = new Date(this.nowFn());

    // Lọc các dòng được chọn (selected !== false) và có SO hợp lệ (1..30 ký tự);
    // nếu có trùng SO trong danh sách gửi lên thì dòng sau cùng thắng.
    const dedupedBySo = new Map<
      string,
      {
        rowNumber: number | null;
        fields: GkskRecord;
        dataSha256: string;
        status: 'ready' | 'invalid';
      }
    >();
    let skippedCount = 0;

    for (const rowInput of payload.rows) {
      if (rowInput.selected === false) {
        skippedCount += 1;
        continue;
      }

      const rawFields = rowInput.fields ?? {};
      const rawFacility = cleanText(String(rawFields.IDBENHVIEN ?? ''));
      const facilityMismatchInRow =
        rawFacility !== '' && rawFacility !== this.facilityId;

      const normalized = normalizeRecord(rawFields);
      normalized.IDBENHVIEN = this.facilityId;
      normalized.BENHVIEN = this.facilityName;

      const so = normalized.SO.trim();
      const soLen = unicodeLength(so);
      if (so === '' || soLen > SO_SERVER_MAX_LENGTH) {
        skippedCount += 1;
        continue;
      }

      const issues = validateRecord(normalized, {
        facilityId: this.facilityId,
        today,
      });
      if (facilityMismatchInRow) {
        issues.unshift({
          code: 'LOCAL_FACILITY_MISMATCH',
          field: 'IDBENHVIEN',
          severity: 'error',
          source: 'local',
        });
      }

      const status: 'ready' | 'invalid' = hasBlockingErrors(issues)
        ? 'invalid'
        : 'ready';
      const { dataSha256 } = computeCertificatePayload(normalized);

      if (dedupedBySo.has(so)) {
        skippedCount += 1;
      }

      dedupedBySo.set(so, {
        rowNumber:
          typeof rowInput.rowNumber === 'number' &&
          Number.isInteger(rowInput.rowNumber) &&
          rowInput.rowNumber > 0
            ? rowInput.rowNumber
            : null,
        fields: normalized,
        dataSha256,
        status,
      });
    }

    if (dedupedBySo.size === 0) {
      throw new AppError(
        'NO_COMMITTABLE_ROWS',
        'Không có dòng nào có mã số giấy (SO) hợp lệ (≤ 30 ký tự) để lưu vào Danh sách đối soát.',
        400,
      );
    }

    const batch = await this.repos.batches.create({
      filename,
      rowCount: dedupedBySo.size,
      createdAt: nowDate,
    });

    const upsertInputs: UpsertCertificateInput[] = [];
    let readyCount = 0;
    let invalidCount = 0;

    for (const [so, item] of dedupedBySo.entries()) {
      if (item.status === 'ready') {
        readyCount += 1;
      } else {
        invalidCount += 1;
      }
      upsertInputs.push({
        so,
        fields: item.fields,
        dataSha256: item.dataSha256,
        status: item.status,
        batchId: batch.id,
        excelRowNumber: item.rowNumber,
        now: nowDate,
      });
    }

    const upsertResult = await this.repos.certificates.upsertManyBySo(upsertInputs);

    this.log.info(
      {
        batchId: batch.id,
        totalCommitted: upsertResult.rows.length,
        inserted: upsertResult.inserted,
        updated: upsertResult.updated,
        readyCount,
        invalidCount,
        skippedCount,
      },
      'Hoàn tất lưu đợt Import Excel vào Danh sách đối soát',
    );

    return {
      batch,
      totalCommitted: upsertResult.rows.length,
      inserted: upsertResult.inserted,
      updated: upsertResult.updated,
      readyCount,
      invalidCount,
      skippedCount,
      items: upsertResult.rows.map((row) => toSafeCertificateSummary(row)),
    };
  }
}

export function createImportService(options: ImportServiceOptions): ImportService {
  return new ImportService(options);
}

export { stripSensitiveFields, createEmptyRecord };
