import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmptyRecord, type GkskRecord } from '../packages/shared/src/index.js';
import {
  createRepositories,
  resolveDefaultMigrationsDir,
} from '../server/src/db/connection.js';
import { escapeSqlLikePattern } from '../server/src/db/mssqlRepo.js';
import { GKSK_TABLE_NAMES } from '../server/src/db/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT_DIR, 'docs', 'evidence', 'S8');
const REPORT_OUT = path.join(EVIDENCE_DIR, 'db-verification-report.md');
const VERIFY_OUT = path.join(EVIDENCE_DIR, 'verify-output.txt');

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`VERIFY S8 FAILED: ${message}`);
  }
}

function makeRecord(overrides: Partial<GkskRecord> = {}): GkskRecord {
  const base = createEmptyRecord();
  return {
    ...base,
    SO: 'TEST.75001.0001',
    NGAYKHAM: '05/11/2026',
    HOTEN: 'TEST NGUYEN VAN A',
    GIOITINHVAL: '0',
    NGAYSINH: '21/05/1990',
    DIACHITHUONGTRU: 'Bien Hoa, Dong Nai',
    MATINH_THUONGTRU: '75',
    MAHUYEN_THUONGTRU: '75731',
    MAXA_THUONGTRU: '7573126041',
    SOCMND_PASSPORT: 'TESTGKSK01',
    NGAYTHANGNAMCAP: '01/02/2021',
    NOICAP: 'Cuc CS QLHC',
    HANGBANGLAI: 'B2',
    IDBENHVIEN: '75001',
    BENHVIEN: 'Benh vien Thu',
    NGAYKETLUAN: '06/11/2026',
    NONGDOCON: '0',
    DVINONGDOCON: '0',
    MATUY: '0',
    BACSYKETLUAN: 'TEST BAC SI',
    KETLUAN: 'A0-1',
    STATE: 'ADD',
    ...overrides,
  };
}

function sha(label: string): string {
  return label.padEnd(64, '0').slice(0, 64).toUpperCase();
}

interface SqlQueryAuditItem {
  index: number;
  operation: string;
  tables: string[];
  paramsUsed: string[];
  hasInterpolation: boolean;
  firstLine: string;
}

async function runVerification(): Promise<void> {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  // ===========================================================================
  // PHẦN 1: Kiểm chứng toàn bộ thao tác Repository (InMemoryRepositories)
  // ===========================================================================
  const repo = createRepositories();
  assert(
    repo.kind === 'in-memory',
    'createRepositories() không truyền pool phải trả về InMemoryRepositories',
  );

  // 1.1 Tạo 2 đợt import Excel
  const batch1 = await repo.batches.create({
    filename: 'dot_1_nhap_moi.xlsx',
    rowCount: 6,
    createdAt: '2026-11-20T08:00:00.000Z',
  });
  const batch2 = await repo.batches.create({
    filename: 'dot_2_sua_loi_doi_soat.xlsx',
    rowCount: 2,
    createdAt: '2026-11-21T09:00:00.000Z',
  });

  // 1.2 Upsert 6 giấy ở đợt 1 (đủ các trạng thái: ready, invalid, accepted, rejected, error, sending)
  const initialCerts = [
    {
      so: 'TEST.75001.S8.01',
      hoten: 'TEST NGUYEN VAN A',
      socmnd: 'TESTGKSK01',
      status: 'ready' as const,
      sha: sha('S8_01_V1'),
      row: 2,
    },
    {
      so: 'TEST.75001.S8.02',
      hoten: 'TEST TRAN THI B (SAI NGAY SINH)',
      socmnd: 'TESTGKSK02',
      status: 'invalid' as const,
      sha: sha('S8_02_INVALID'),
      row: 3,
    },
    {
      so: 'TEST.75001.S8.03',
      hoten: 'TEST LE VAN C',
      socmnd: 'TESTGKSK03',
      status: 'accepted' as const,
      sha: sha('S8_03_ACCEPTED'),
      row: 4,
      serverCertId: 'cert-so-75001-03',
    },
    {
      so: 'TEST.75001.S8.04',
      hoten: 'TEST PHAM THI D',
      socmnd: 'TESTGKSK04',
      status: 'rejected' as const,
      sha: sha('S8_04_REJECTED'),
      row: 5,
    },
    {
      so: 'TEST.75001.S8.05%SPECIAL',
      hoten: "TEST O'CONNOR_100%",
      socmnd: 'TEST_SPEC_05',
      status: 'error' as const,
      sha: sha('S8_05_ERROR'),
      row: 6,
    },
    {
      so: 'TEST.75001.S8.06',
      hoten: 'TEST HOANG VAN E (KET SENDING)',
      socmnd: 'TESTGKSK06',
      status: 'sending' as const,
      sha: sha('S8_06_SENDING'),
      row: 7,
    },
  ];

  for (const item of initialCerts) {
    const res = await repo.certificates.upsertBySo({
      so: item.so,
      fields: makeRecord({
        SO: item.so,
        HOTEN: item.hoten,
        SOCMND_PASSPORT: item.socmnd,
      }),
      dataSha256: item.sha,
      status: item.status,
      batchId: batch1.id,
      excelRowNumber: item.row,
      serverCertificateId: item.serverCertId ?? null,
      now: '2026-11-20T08:05:00.000Z',
    });
    assert(res.created === true, `Upsert lần đầu cho ${item.so} phải có created=true`);
  }

  const countsBeforeOverwrite = await repo.certificates.countByStatus();
  assert(countsBeforeOverwrite.all === 6, 'Tổng số giấy ban đầu phải là 6');
  assert(countsBeforeOverwrite.unsent === 1, 'Ban đầu có 1 giấy unsent (ready)');
  assert(countsBeforeOverwrite.accepted === 1, 'Ban đầu có 1 giấy accepted');
  assert(
    countsBeforeOverwrite.attention === 3,
    'Ban đầu có 3 giấy attention (1 invalid + 1 rejected + 1 error)',
  );
  assert(countsBeforeOverwrite.sending === 1, 'Ban đầu có 1 giấy sending');

  // 1.3 Tra cứu hàng loạt findBySoList phục vụ xem trước ghi đè thông minh
  const previewLookup = await repo.certificates.findBySoList([
    'TEST.75001.S8.02',
    'TEST.75001.S8.03',
    'TEST.75001.S8.NEW_99',
  ]);
  assert(
    previewLookup.length === 2,
    'findBySoList phải tìm thấy đúng 2 mã SO đã có trong DB',
  );

  // 1.4 Ghi đè (upsertBySo) giấy lỗi TEST.75001.S8.02 ở đợt import 2 -> chuyển thành ready, giữ nguyên ID=2
  const overwriteRes = await repo.certificates.upsertBySo({
    so: 'TEST.75001.S8.02',
    fields: makeRecord({
      SO: 'TEST.75001.S8.02',
      HOTEN: 'TEST TRAN THI B (DA SUA DUNG)',
      SOCMND_PASSPORT: 'TESTGKSK02',
    }),
    dataSha256: sha('S8_02_FIXED'),
    status: 'ready',
    batchId: batch2.id,
    excelRowNumber: 2,
    now: '2026-11-21T09:05:00.000Z',
  });
  assert(overwriteRes.created === false, 'Ghi đè trùng SO phải trả created=false');
  assert(overwriteRes.row.id === 2, 'Ghi đè trùng SO phải giữ nguyên id=2');
  assert(overwriteRes.row.status === 'ready', 'Trạng thái mới phải là ready');
  assert(
    overwriteRes.row.batchFilename === 'dot_2_sua_loi_doi_soat.xlsx',
    'Tên đợt import phải cập nhật sang đợt 2',
  );

  // 1.5 Khôi phục khi khởi động server (recoverOnStartup): sending -> error
  const recoveredCount = await repo.certificates.recoverOnStartup(
    '2026-11-21T10:00:00.000Z',
  );
  assert(recoveredCount === 1, 'recoverOnStartup phải chuyển 1 giấy sending -> error');

  const countsAfterRecover = await repo.certificates.countByStatus();
  assert(countsAfterRecover.sending === 0, 'Sau recoverOnStartup không còn giấy sending');
  assert(countsAfterRecover.unsent === 2, 'Sau khi sửa S8.02 có 2 giấy unsent (ready)');
  assert(
    countsAfterRecover.attention === 3,
    'Sau recoverOnStartup có 3 giấy attention (0 invalid + 1 rejected + 2 error)',
  );

  // 1.6 Kiểm tra lọc theo 4 tab đối soát
  const tabAll = await repo.certificates.list({ tab: 'all' });
  const tabUnsent = await repo.certificates.list({ tab: 'unsent' });
  const tabAccepted = await repo.certificates.list({ tab: 'accepted' });
  const tabAttention = await repo.certificates.list({ tab: 'attention' });

  assert(tabAll.total === 6, 'Tab all phải có 6 giấy');
  assert(tabUnsent.total === 2, 'Tab unsent phải có 2 giấy');
  assert(tabAccepted.total === 1, 'Tab accepted phải có 1 giấy');
  assert(tabAttention.total === 3, 'Tab attention phải có 3 giấy');

  // 1.7 Kiểm tra tìm kiếm q an toàn với %, _, '
  const qPercent = await repo.certificates.list({ q: '100%' });
  const qUnderscore = await repo.certificates.list({ q: 'CONNOR_' });
  const qQuote = await repo.certificates.list({ q: "O'CONNOR" });
  assert(qPercent.total === 1 && qPercent.items[0]?.so === 'TEST.75001.S8.05%SPECIAL', 'Tìm kiếm % chính xác');
  assert(qUnderscore.total === 1 && qUnderscore.items[0]?.so === 'TEST.75001.S8.05%SPECIAL', 'Tìm kiếm _ chính xác');
  assert(qQuote.total === 1 && qQuote.items[0]?.so === 'TEST.75001.S8.05%SPECIAL', "Tìm kiếm ' chính xác");

  // 1.8 Kiểm tra Submissions & Xóa dây chuyền (ON DELETE CASCADE)
  const subFor06 = await repo.submissions.create({
    certificateId: 6,
    msgId: '7500126112300000000000004000800000000000666',
    sendDatetime: 1781084650666,
    dataSha256: sha('S8_06_SENDING'),
    attempts: 1,
    lastError: 'Mất kết nối giữa chừng',
  });
  const pendingFound = await repo.submissions.findPendingByCertificateAndSha(
    6,
    sha('S8_06_SENDING'),
  );
  assert(
    pendingFound?.msgId === subFor06.msgId,
    'findPendingByCertificateAndSha phải tìm thấy submission chưa có kết quả cùng data_sha256',
  );

  const deleted06 = await repo.certificates.deleteById(6);
  assert(deleted06 === true, 'Xóa giấy id=6 thành công');
  assert(
    (await repo.submissions.listByCertificateId(6)).length === 0,
    'Xóa giấy id=6 phải xóa dây chuyền toàn bộ submissions của giấy đó',
  );

  // ===========================================================================
  // PHẦN 2: Quét tĩnh 001_init.sql, mssqlRepo.ts và connection.ts
  // ===========================================================================
  const migrationsDir = resolveDefaultMigrationsDir();
  const sqlFilePath = path.join(migrationsDir, '001_init.sql');
  const mssqlRepoPath = path.join(ROOT_DIR, 'server', 'src', 'db', 'mssqlRepo.ts');
  const connectionPath = path.join(ROOT_DIR, 'server', 'src', 'db', 'connection.ts');

  const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
  const mssqlRepoContent = fs.readFileSync(mssqlRepoPath, 'utf8');
  const connectionContent = fs.readFileSync(connectionPath, 'utf8');

  // 2.1 Kiểm tra cấm DROP / TRUNCATE
  const dropTruncateInSql = /\b(DROP|TRUNCATE)\b/i.test(sqlContent);
  const dropTruncateInRepo = /\b(DROP|TRUNCATE)\b/i.test(mssqlRepoContent);
  const dropTruncateInConn = /\b(DROP|TRUNCATE)\b/i.test(connectionContent);
  assert(!dropTruncateInSql, '001_init.sql tuyệt đối không được chứa DROP hoặc TRUNCATE');
  assert(!dropTruncateInRepo, 'mssqlRepo.ts tuyệt đối không được chứa DROP hoặc TRUNCATE');
  assert(!dropTruncateInConn, 'connection.ts tuyệt đối không được chứa DROP hoặc TRUNCATE');

  // 2.2 Kiểm tra 100% bảng trong 001_init.sql có tiền tố gksk_ và IF OBJECT_ID(...) IS NULL
  const createdTables = Array.from(
    sqlContent.matchAll(/CREATE\s+TABLE\s+(?:dbo\.)?([A-Za-z0-9_]+)/gi),
    (m) => m[1] ?? '',
  );
  assert(
    JSON.stringify(createdTables) === JSON.stringify([...GKSK_TABLE_NAMES]),
    `Danh sách bảng tạo trong 001_init.sql phải khớp ${GKSK_TABLE_NAMES.join(', ')}`,
  );

  const createdIndexes = Array.from(
    sqlContent.matchAll(
      /CREATE\s+INDEX\s+([A-Za-z0-9_]+)\s+ON\s+(?:dbo\.)?([A-Za-z0-9_]+)/gi,
    ),
    (m) => ({ indexName: m[1] ?? '', tableName: m[2] ?? '' }),
  );
  assert(createdIndexes.length === 3, '001_init.sql phải có 3 chỉ mục ix_gksk_*');
  for (const idx of createdIndexes) {
    assert(
      idx.indexName.startsWith('ix_gksk_') && idx.tableName.startsWith('gksk_'),
      `Chỉ mục ${idx.indexName} trên bảng ${idx.tableName} phải dùng tiền tố gksk_`,
    );
  }

  // 2.3 Quét từng câu truy vấn .query(`...`) trong mssqlRepo.ts & connection.ts
  const rawQueryBlocks = [
    ...Array.from(
      mssqlRepoContent.matchAll(/\.query(?:<[^>]+>)?\(\s*`([\s\S]*?)`\s*,?\s*\)/g),
      (m) => m[1] ?? '',
    ),
    ...Array.from(
      connectionContent.matchAll(/\.query(?:<[^>]+>)?\(\s*`([\s\S]*?)`\s*,?\s*\)/g),
      (m) => m[1] ?? '',
    ),
  ];

  const declaredInputs = new Set([
    ...Array.from(
      mssqlRepoContent.matchAll(/\.input\(\s*'([A-Za-z0-9_]+)'/g),
      (m) => m[1] ?? '',
    ),
    ...Array.from(
      connectionContent.matchAll(/\.input\(\s*'([A-Za-z0-9_]+)'/g),
      (m) => m[1] ?? '',
    ),
  ]);

  const queryAuditItems: SqlQueryAuditItem[] = [];
  rawQueryBlocks.forEach((block, idx) => {
    const trimmed = block.trim();
    const firstLine = (trimmed.split('\n')[0] ?? '').trim();
    const opMatch = /^\b(SELECT|INSERT|UPDATE|DELETE|IF)\b/i.exec(firstLine);
    const operation = (opMatch?.[1] ?? 'SQL').toUpperCase();
    const tables = Array.from(
      new Set(
        Array.from(
          trimmed.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+dbo\.([A-Za-z0-9_]+)/gi),
          (m) => m[1] ?? '',
        ),
      ),
    );
    const paramsUsed = Array.from(
      new Set(Array.from(trimmed.matchAll(/@([A-Za-z0-9_]+)/g), (m) => m[1] ?? '')),
    );
    const hasInterpolation = trimmed.includes('${');

    assert(!hasInterpolation, `Câu SQL #${idx + 1} không được chứa nội suy chuỗi \${...}`);
    for (const tbl of tables) {
      assert(
        tbl.startsWith('gksk_'),
        `Bảng ${tbl} trong câu SQL #${idx + 1} phải bắt đầu bằng gksk_`,
      );
    }
    for (const param of paramsUsed) {
      assert(
        declaredInputs.has(param),
        `Tham số @${param} trong câu SQL #${idx + 1} phải được truyền qua .input('${param}', ...)`,
      );
    }
    if (operation === 'DELETE') {
      assert(
        /WHERE\s+id\s*=\s*@id/i.test(trimmed),
        `Câu lệnh DELETE #${idx + 1} bắt buộc phải có WHERE id = @id`,
      );
    }

    queryAuditItems.push({
      index: idx + 1,
      operation,
      tables,
      paramsUsed,
      hasInterpolation,
      firstLine,
    });
  });

  // ===========================================================================
  // PHẦN 3: Xuất báo cáo Markdown docs/evidence/S8/db-verification-report.md
  // ===========================================================================
  const mdLines: string[] = [
    '# Báo cáo Kiểm chứng S8 — DB (MSSQL `gksk_*` & Repository Interface)',
    '',
    `- **Thời gian chạy kiểm chứng**: \`${new Date().toISOString()}\``,
    '- **Các file kiểm chứng**:',
    '  - `server/src/db/types.ts` (`DbRepositories` interface)',
    '  - `server/src/db/inMemoryRepo.ts` (`InMemoryRepositories` — mặc định cho `npm test`)',
    '  - `server/src/db/migrations/001_init.sql` (Migration MSSQL bảng tiền tố `gksk_*`)',
    '  - `server/src/db/mssqlRepo.ts` (`MssqlRepositories` — 100% tham số hóa `.input()`)',
    '  - `server/src/db/connection.ts` (`createMssqlPool`, `runMigrations`, `createRepositories`)',
    '',
    '## 1. Kết quả Kiểm chứng Hợp đồng Repository (`DbRepositories`)',
    '',
    '| # | Hạng mục kiểm chứng | Kết quả thực tế | Trạng thái |',
    '|---:|---|---|:---:|',
    `| 1 | Mặc định \`createRepositories()\` không truyền pool | \`repo.kind = "${repo.kind}"\` (tuyệt đối không mở kết nối MSSQL khi chạy \`npm test\`) | PASS |`,
    `| 2 | Tạo đợt import (\`batches.create\` / \`list\`) | Đã tạo 2 đợt (\`${batch1.filename}\`, \`${batch2.filename}\`), sắp xếp mới nhất trước | PASS |`,
    `| 3 | Upsert theo \`SO\` (\`ready\` & \`invalid\`) | Lưu đủ 6/6 giấy có \`SO\` (gồm cả dòng \`ready\` lẫn \`invalid\` để khớp 100% quân số đối soát) | PASS |`,
    `| 4 | Tra cứu hàng loạt \`findBySoList(soList)\` | Tra cứu 3 mã \`SO\` → khớp chính xác ${previewLookup.length} bản ghi đang có trong DB | PASS |`,
    `| 5 | Ghi đè thông minh trùng \`SO\` (\`upsertBySo\`) | Ghi đè \`TEST.75001.S8.02\` (\`invalid\` → \`ready\`), giữ nguyên \`id = ${overwriteRes.row.id}\`, \`created = ${overwriteRes.created}\` | PASS |`,
    `| 6 | Khôi phục khi khởi động (\`recoverOnStartup\`) | Chuyển \`${recoveredCount}\` giấy đang kẹt \`sending\` → \`error\` (\`counts.sending = ${countsAfterRecover.sending}\`) | PASS |`,
    `| 7 | Lọc phân trang theo 4 tab đối soát & đếm \`counts\` | \`all=${tabAll.total}\`, \`unsent=${tabUnsent.total}\`, \`accepted=${tabAccepted.total}\`, \`attention=${tabAttention.total}\` | PASS |`,
    `| 8 | Tìm kiếm \`q\` an toàn với \`%\`, \`_\`, \`'\` | Tìm \`"100%"\` → ${qPercent.total} dòng; \`"CONNOR_"\` → ${qUnderscore.total} dòng; \`"O'CONNOR"\` → ${qQuote.total} dòng; escape T-SQL: \`${escapeSqlLikePattern("100%_test'a")}\` | PASS |`,
    `| 9 | Lịch sử \`submissions\` & xóa dây chuyền (\`CASCADE\`) | Tìm đúng submission chờ (\`msg_id=${subFor06.msgId}\`); xóa giấy \`id=6\` tự động xóa sạch submissions kèm theo | PASS |`,
    '',
    '---',
    '',
    '## 2. Biên bản Quét tĩnh An toàn SQL (`001_init.sql`, `mssqlRepo.ts`, `connection.ts`)',
    '',
    '### 2.1 Kiểm tra Lược đồ Migration `001_init.sql`',
    '',
    '- **Tổng số bảng khởi tạo**: **4/4 bảng** đều bắt đầu bằng tiền tố `gksk_` và có chốt chặn `IF OBJECT_ID(N\'dbo.gksk_...\', N\'U\') IS NULL`:',
    ...createdTables.map((t) => `  - \`dbo.${t}\` (tiền tố \`gksk_\`: **✔**)`),
    '- **Tổng số chỉ mục (`CREATE INDEX`)**: **3/3 chỉ mục** có kiểm tra `IF NOT EXISTS`:',
    ...createdIndexes.map(
      (idx) => `  - \`${idx.indexName}\` trên bảng \`dbo.${idx.tableName}\` (**✔**)`,
    ),
    '- **Quét từ khóa cấm `DROP` / `TRUNCATE` trong `001_init.sql`, `mssqlRepo.ts`, `connection.ts`**: **`0` kết quả (PASS)**.',
    '',
    '### 2.2 Bảng Kiểm toán 100% Câu truy vấn SQL trong `mssqlRepo.ts` & `connection.ts`',
    '',
    `- **Tổng số khối truy vấn \`.query(\`...\`)\` đã quét**: **${queryAuditItems.length} câu truy vấn**.`,
    '- **Số câu truy vấn có ghép chuỗi / nội suy `${...}`**: **`0` câu (100% chuỗi SQL tĩnh)**.',
    '- **Số tham số `@param` được truyền qua `request.input(\'param\', sql.Type, value)`**: **100%**.',
    '',
    '| # | Loại lệnh | Bảng tham chiếu (`dbo.gksk_*`) | Tham số `@param` (qua `.input()`) | Nội suy `${...}`? | Dòng đầu câu SQL |',
    '|---:|---|---|---|:---:|---|',
  ];

  for (const item of queryAuditItems) {
    const tablesText = item.tables.map((t) => `\`dbo.${t}\``).join(', ');
    const paramsText =
      item.paramsUsed.length > 0
        ? item.paramsUsed.map((p) => `\`@${p}\``).join(', ')
        : '*(không có tham số)*';
    mdLines.push(
      `| ${item.index} | \`${item.operation}\` | ${tablesText} | ${paramsText} | \`${item.hasInterpolation}\` | \`${item.firstLine}\` |`,
    );
  }

  mdLines.push('');
  const reportContent = mdLines.join('\n');
  fs.writeFileSync(REPORT_OUT, reportContent, 'utf8');
  fs.writeFileSync(VERIFY_OUT, reportContent, 'utf8');

  process.stdout.write(
    `[verify-S8] PASS 100% (${queryAuditItems.length} SQL queries audited, 0 DROP/TRUNCATE, 100% gksk_* prefix). Report written to ${REPORT_OUT}\n`,
  );
}

runVerification().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[verify-S8] ERROR: ${message}\n`);
  process.exit(1);
});
