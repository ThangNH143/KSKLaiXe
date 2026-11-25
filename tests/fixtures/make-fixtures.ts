import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import {
  TEMPLATE_FIELDS,
  type FieldTag,
} from '../../packages/shared/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const FIXTURES_DIR = __dirname;

export const TEMPLATE_TAGS: readonly FieldTag[] = TEMPLATE_FIELDS.map(
  (field) => field.tag,
);

export function makeDefaultFixtureRow(
  index = 1,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  const padded = String(index).padStart(2, '0');
  return {
    SO: `TEST.75001.FIX.${padded}`,
    NGAYKHAM: '05/11/2026',
    HOTEN: `TEST NGUYEN VAN ${padded}`,
    GIOITINHVAL: '0',
    NGAYSINH: '21/05/1990',
    DIACHITHUONGTRU: 'Bien Hoa, Dong Nai',
    MATINH_THUONGTRU: '75',
    MAHUYEN_THUONGTRU: '75731',
    MAXA_THUONGTRU: '7573126041',
    SOCMND_PASSPORT: `TESTGKSK${padded}`,
    NGAYTHANGNAMCAP: '10/01/2021',
    NOICAP: 'Cuc CS QLHC',
    HANGBANGLAI: 'B2',
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

export async function createWorkbookBuffer(options: {
  sheetName?: string;
  headers: readonly string[];
  rows: ReadonlyArray<Record<string, unknown> | null>;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(options.sheetName ?? 'GKSK');

  sheet.addRow([...options.headers]);

  for (const rowData of options.rows) {
    if (rowData === null) {
      sheet.addRow([]);
      continue;
    }
    const values = options.headers.map((header) => {
      const val = rowData[header];
      return val === undefined ? '' : val;
    });
    sheet.addRow(values);
  }

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

/**
 * Sinh toàn bộ 19 bộ dữ liệu Excel kiểm thử theo đúng bảng `docs/TEST-PLAN.md §2.1`:
 * 1. `ok_5rows.xlsx`
 * 2. `mixed_valid_invalid.xlsx`
 * 3. `reimport_overwrite.xlsx`
 * 4. `leading_zero.xlsx`
 * 5. `dates_mixed.xlsx`
 * 6. `dates_bad.xlsx`
 * 7. `missing_required_col.xlsx`
 * 8. `extra_cols_reordered.xlsx`
 * 9. `blank_rows.xlsx`
 * 10. `formulas.xlsx`
 * 11. `dup_so.xlsx`
 * 12. `facility_mismatch.xlsx`
 * 13. `alias_gioitinh.xlsx`
 * 14. `over_length.xlsx`
 * 15. `enum_variants.xlsx`
 * 16. `too_many_rows.xlsx`
 * 17. `big_1000.xlsx`
 * 18. `not_xlsx.xlsx`
 * 19. `empty.xlsx`
 */
export async function buildAllExcelFixtures(): Promise<Map<string, Buffer>> {
  const fixtures = new Map<string, Buffer>();

  // 1. ok_5rows.xlsx: 5 dòng hợp lệ, SO khác nhau, SOCMND_PASSPORT=TESTGKSK01..05
  fixtures.set(
    'ok_5rows.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows: [1, 2, 3, 4, 5].map((i) => makeDefaultFixtureRow(i)),
    }),
  );

  // 2. mixed_valid_invalid.xlsx: 3 dòng hợp lệ + 2 dòng sai ngày sinh (nhưng có SO) + 1 dòng trống SO
  fixtures.set(
    'mixed_valid_invalid.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows: [
        makeDefaultFixtureRow(1, { SO: 'TEST.75001.MIX.01' }),
        makeDefaultFixtureRow(2, { SO: 'TEST.75001.MIX.02' }),
        makeDefaultFixtureRow(3, { SO: 'TEST.75001.MIX.03' }),
        makeDefaultFixtureRow(4, {
          SO: 'TEST.75001.MIX.BAD1',
          NGAYSINH: '31/02/1990',
        }),
        makeDefaultFixtureRow(5, {
          SO: 'TEST.75001.MIX.BAD2',
          NGAYSINH: '29/02/2025',
        }),
        makeDefaultFixtureRow(6, { SO: '' }),
      ],
    }),
  );

  // 3. reimport_overwrite.xlsx: 4 dòng trùng SO với DB:
  // (1) giấy cũ đang invalid đã sửa đúng
  // (2) giấy cũ đang rejected đã sửa đúng
  // (3) giấy cũ đã accepted giữ nguyên dữ liệu
  // (4) giấy cũ đã accepted nhưng sửa HOTEN
  fixtures.set(
    'reimport_overwrite.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows: [
        makeDefaultFixtureRow(1, {
          SO: 'TEST.75001.REIMP.01',
          NGAYSINH: '21/05/1990',
        }),
        makeDefaultFixtureRow(2, {
          SO: 'TEST.75001.REIMP.02',
          KETLUAN: 'A0-1',
        }),
        makeDefaultFixtureRow(3, {
          SO: 'TEST.75001.REIMP.03',
          HOTEN: 'TEST NGUYEN VAN 03',
        }),
        makeDefaultFixtureRow(4, {
          SO: 'TEST.75001.REIMP.04',
          HOTEN: 'TEST NGUYEN VAN 04 DA SUA',
        }),
      ],
    }),
  );

  // 4. leading_zero.xlsx: CCCD 079000012345: dòng 2 ô số (mất số 0 -> 79000012345), dòng 3 ô chuỗi ('079000012345')
  fixtures.set(
    'leading_zero.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows: [
        makeDefaultFixtureRow(1, {
          SO: 'TEST.75001.ZERO.NUM',
          SOCMND_PASSPORT: 79000012345,
        }),
        makeDefaultFixtureRow(2, {
          SO: 'TEST.75001.ZERO.STR',
          SOCMND_PASSPORT: '079000012345',
        }),
      ],
    }),
  );

  // 5. dates_mixed.xlsx: NGAYSINH là Date, serial 33014, chuỗi 21/5/1990, chuỗi 1990-05-21 -> cả 4 thành 21/05/1990
  fixtures.set(
    'dates_mixed.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows: [
        makeDefaultFixtureRow(1, {
          SO: 'TEST.75001.DATE.1',
          NGAYSINH: new Date(Date.UTC(1990, 4, 21)),
        }),
        makeDefaultFixtureRow(2, {
          SO: 'TEST.75001.DATE.2',
          NGAYSINH: 33014,
        }),
        makeDefaultFixtureRow(3, {
          SO: 'TEST.75001.DATE.3',
          NGAYSINH: '21/5/1990',
        }),
        makeDefaultFixtureRow(4, {
          SO: 'TEST.75001.DATE.4',
          NGAYSINH: '1990-05-21',
        }),
      ],
    }),
  );

  // 6. dates_bad.xlsx: 31/02/1990, 1899-12-31, abc, năm 2027 -> 4 dòng GKSK_NGAYSINH_INVALID
  fixtures.set(
    'dates_bad.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows: [
        makeDefaultFixtureRow(1, {
          SO: 'TEST.75001.BADDATE.1',
          NGAYSINH: '31/02/1990',
        }),
        makeDefaultFixtureRow(2, {
          SO: 'TEST.75001.BADDATE.2',
          NGAYSINH: '1899-12-31',
        }),
        makeDefaultFixtureRow(3, {
          SO: 'TEST.75001.BADDATE.3',
          NGAYSINH: 'abc',
        }),
        makeDefaultFixtureRow(4, {
          SO: 'TEST.75001.BADDATE.4',
          NGAYSINH: '01/01/2027',
        }),
      ],
    }),
  );

  // 7. missing_required_col.xlsx: Không có cột KETLUAN
  fixtures.set(
    'missing_required_col.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS.filter((t) => t !== 'KETLUAN'),
      rows: [makeDefaultFixtureRow(1)],
    }),
  );

  // 8. extra_cols_reordered.xlsx: Thứ tự cột đảo, thêm cột GHICHU
  const reorderedHeaders: string[] = [...TEMPLATE_TAGS].reverse();
  reorderedHeaders.splice(2, 0, 'GHICHU');
  fixtures.set(
    'extra_cols_reordered.xlsx',
    await createWorkbookBuffer({
      headers: reorderedHeaders,
      rows: [
        makeDefaultFixtureRow(1, { GHICHU: 'Ghi chu phu 1' }),
        makeDefaultFixtureRow(2, { GHICHU: 'Ghi chu phu 2' }),
      ],
    }),
  );

  // 9. blank_rows.xlsx: Dòng trống xen kẽ (dòng 2 có dữ liệu, dòng 3 trống, dòng 4 trống, dòng 5 có dữ liệu)
  fixtures.set(
    'blank_rows.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows: [
        makeDefaultFixtureRow(1, { SO: 'TEST.75001.BLANK.1' }),
        null,
        null,
        makeDefaultFixtureRow(2, { SO: 'TEST.75001.BLANK.2' }),
      ],
    }),
  );

  // 10. formulas.xlsx: HOTEN = công thức ="TEST "&"A", kèm RichText ở NOICAP
  fixtures.set(
    'formulas.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows: [
        makeDefaultFixtureRow(1, {
          SO: 'TEST.75001.FORMULA.1',
          HOTEN: { formula: '"TEST "&"A"', result: 'TEST A' },
          NOICAP: {
            richText: [{ text: 'Cuc CS ' }, { text: 'QLHC' }],
          },
        }),
      ],
    }),
  );

  // 11. dup_so.xlsx: 2 dòng cùng SO trong 1 file
  fixtures.set(
    'dup_so.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows: [
        makeDefaultFixtureRow(1, {
          SO: 'TEST.75001.DUP.01',
          HOTEN: 'TEST DONG TRUOC',
        }),
        makeDefaultFixtureRow(2, {
          SO: 'TEST.75001.DUP.01',
          HOTEN: 'TEST DONG SAU',
        }),
      ],
    }),
  );

  // 12. facility_mismatch.xlsx: Cột IDBENHVIEN=75999
  fixtures.set(
    'facility_mismatch.xlsx',
    await createWorkbookBuffer({
      headers: [...TEMPLATE_TAGS, 'IDBENHVIEN'],
      rows: [
        makeDefaultFixtureRow(1, {
          SO: 'TEST.75001.MISMATCH.1',
          IDBENHVIEN: '75999',
        }),
      ],
    }),
  );

  // 13. alias_gioitinh.xlsx: Cột tiêu đề GIOITINH (không có GIOITINHVAL)
  fixtures.set(
    'alias_gioitinh.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS.map((tag) =>
        tag === 'GIOITINHVAL' ? 'GIOITINH' : tag,
      ),
      rows: [
        makeDefaultFixtureRow(1, {
          SO: 'TEST.75001.ALIAS.1',
          GIOITINH: '1',
        }),
      ],
    }),
  );

  // 14. over_length.xlsx: NOICAP 31 ký tự, SOCMND_PASSPORT 13 ký tự
  fixtures.set(
    'over_length.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows: [
        makeDefaultFixtureRow(1, {
          SO: 'TEST.75001.OVERLEN.1',
          NOICAP: 'N'.repeat(31),
          SOCMND_PASSPORT: 'TESTGKSK12345', // 13 ký tự
        }),
      ],
    }),
  );

  // 15. enum_variants.xlsx: GIOITINHVAL=Nam,nữ,M; KETLUAN=a0-1,A0–2 (gạch dài)
  fixtures.set(
    'enum_variants.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows: [
        makeDefaultFixtureRow(1, {
          SO: 'TEST.75001.ENUM.1',
          GIOITINHVAL: 'Nam',
          KETLUAN: 'a0-1',
        }),
        makeDefaultFixtureRow(2, {
          SO: 'TEST.75001.ENUM.2',
          GIOITINHVAL: 'nữ',
          KETLUAN: 'A0\u20132',
        }),
        makeDefaultFixtureRow(3, {
          SO: 'TEST.75001.ENUM.3',
          GIOITINHVAL: 'M',
          KETLUAN: 'A0 - 3',
          NGAYKHAMLAI: '06/05/2027',
        }),
      ],
    }),
  );

  // 16. too_many_rows.xlsx: 1001 dòng
  fixtures.set(
    'too_many_rows.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows: Array.from({ length: 1001 }, (_, idx) =>
        makeDefaultFixtureRow(idx + 1, {
          SO: `TEST.75001.TOO.${String(idx + 1).padStart(4, '0')}`,
        }),
      ),
    }),
  );

  // 17. big_1000.xlsx: 1000 dòng hợp lệ
  fixtures.set(
    'big_1000.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows: Array.from({ length: 1000 }, (_, idx) =>
        makeDefaultFixtureRow(idx + 1, {
          SO: `TEST.75001.BIG.${String(idx + 1).padStart(4, '0')}`,
        }),
      ),
    }),
  );

  // 18. not_xlsx.xlsx: file CSV/văn bản giả đổi đuôi thành .xlsx
  fixtures.set(
    'not_xlsx.xlsx',
    Buffer.from('SO,HOTEN,NGAYSINH\nTEST.75001.CSV,TEST CSV,21/05/1990\n', 'utf8'),
  );

  // 19. empty.xlsx: Chỉ có dòng tiêu đề
  fixtures.set(
    'empty.xlsx',
    await createWorkbookBuffer({
      headers: TEMPLATE_TAGS,
      rows: [],
    }),
  );

  return fixtures;
}

export async function writeFixturesToDisk(
  targetDir: string = FIXTURES_DIR,
): Promise<string[]> {
  fs.mkdirSync(targetDir, { recursive: true });
  const fixtures = await buildAllExcelFixtures();
  const writtenPaths: string[] = [];

  for (const [name, buf] of fixtures.entries()) {
    const filePath = path.join(targetDir, name);
    fs.writeFileSync(filePath, buf);
    writtenPaths.push(filePath);
  }

  return writtenPaths;
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  writeFixturesToDisk()
    .then((paths) => {
      process.stdout.write(
        `Generated ${paths.length} Excel fixtures in ${FIXTURES_DIR}\n`,
      );
    })
    .catch((err) => {
      process.stderr.write(
        `${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
      );
      process.exit(1);
    });
}
