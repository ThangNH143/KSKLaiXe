import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import {
  createMssqlPool,
  createRepositories,
  runMigrations,
} from '../server/src/db/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

async function main(): Promise<void> {
  dotenv.config({ path: path.join(ROOT_DIR, '.env') });

  const args = process.argv.slice(2);
  const username = (args[0] ?? '').trim();
  const password = args[1] ?? '';
  const fullName = (args[2] ?? '').trim();

  if (!username || !password) {
    process.stderr.write(
      'Cách dùng: npm run user:set -- <ten_dang_nhap> <mat_khau_moi> ["Họ và tên"]\n' +
        'Ví dụ:     npm run user:set -- thangnh MatKhauMoi@2026 "Nguyễn Hoàng Thắng"\n',
    );
    process.exit(1);
  }

  if (username.length < 2 || username.length > 64) {
    process.stderr.write('Lỗi: Tên đăng nhập phải từ 2 đến 64 ký tự.\n');
    process.exit(1);
  }

  if (password.length < 6) {
    process.stderr.write('Lỗi: Mật khẩu phải có ít nhất 6 ký tự.\n');
    process.exit(1);
  }

  const host = (process.env.DB_HOST ?? '').trim();
  const port = Number.parseInt(process.env.DB_PORT ?? '1433', 10) || 1433;
  const user = (process.env.DB_USER ?? '').trim();
  const dbPassword = process.env.DB_PASSWORD ?? '';
  const name = (process.env.DB_NAME ?? '').trim();
  const encrypt =
    (process.env.DB_ENCRYPT ?? 'false').trim().toLowerCase() === 'true';
  const trustServerCert =
    (process.env.DB_TRUST_SERVER_CERT ?? 'true').trim().toLowerCase() !==
    'false';

  if (!host || !user || !dbPassword || !name) {
    process.stderr.write(
      'Lỗi: Thiếu cấu hình kết nối MSSQL (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME) trong file .env.\n',
    );
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  process.stdout.write(
    `[user:set] Đang kết nối MSSQL tại ${host}:${port} (DB=${name})...\n`,
  );
  const pool = await createMssqlPool({
    host,
    port,
    user,
    dbPassword,
    name,
    encrypt,
    trustServerCert,
  });

  try {
    await runMigrations(pool);
    const repos = createRepositories(pool);
    const result = await repos.users.upsertByUsername({
      username,
      passwordHash,
      ...(fullName ? { fullName } : {}),
      isActive: true,
    });

    process.stdout.write(
      `[user:set] ${result.created ? 'ĐÃ TẠO MỚI' : 'ĐÃ CẬP NHẬT MẬT KHẨU'} tài khoản "${result.row.username}" (ID=${result.row.id}, Họ tên="${result.row.fullName}", Trạng thái=Hoạt động) trong bảng dbo.gksk_users.\n`,
    );
    process.stdout.write(
      `[user:set] Bạn có thể mở trình duyệt và đăng nhập ngay bằng tài khoản "${result.row.username}" (không cần khởi động lại NSSM/Server).\n`,
    );
  } finally {
    await pool.close();
  }
}

main().catch((err) => {
  process.stderr.write(
    `[user:set] LỖI: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
