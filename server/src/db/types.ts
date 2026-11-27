import type {
  CertificateStatus,
  GkskRecord,
  ReconcileTab,
  ServerIssue,
} from '@gksk/shared';

/** Danh sách 5 bảng chuẩn trong CSDL MSSQL (bắt buộc 100% có tiền tố `gksk_`). */
export const GKSK_TABLE_NAMES = [
  'gksk_schema_migrations',
  'gksk_import_batches',
  'gksk_certificates',
  'gksk_submissions',
  'gksk_users',
] as const;

export type GkskTableName = (typeof GKSK_TABLE_NAMES)[number];

/** Bản ghi tài khoản người dùng nội bộ trong CSDL (`gksk_users`). */
export interface UserRow {
  id: number;
  username: string;
  passwordHash: string;
  fullName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Thông tin người dùng an toàn trả về API (tuyệt đối không có `passwordHash`). */
export interface SafeUserRow {
  id: number;
  username: string;
  fullName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertUserInput {
  username: string;
  passwordHash: string;
  fullName?: string;
  isActive?: boolean;
  now?: string | Date;
}

/** Kho lưu trữ tài khoản người dùng nội bộ (`gksk_users`). */
export interface UsersRepository {
  findByUsername(username: string): Promise<UserRow | null>;
  findById(id: number): Promise<UserRow | null>;
  list(): Promise<SafeUserRow[]>;
  upsertByUsername(
    input: UpsertUserInput,
  ): Promise<{ row: SafeUserRow; created: boolean }>;
  updatePassword(
    id: number,
    passwordHash: string,
    now?: string | Date,
  ): Promise<SafeUserRow | null>;
  updateActiveStatus(
    id: number,
    isActive: boolean,
    now?: string | Date,
  ): Promise<SafeUserRow | null>;
}

/** Bản ghi đợt Import file Excel (`gksk_import_batches`). */
export interface ImportBatchRow {
  id: number;
  filename: string;
  rowCount: number;
  createdAt: string;
}

export interface CreateImportBatchInput {
  filename: string;
  rowCount: number;
  createdAt?: string | Date;
}

/** Bản ghi giấy khám sức khỏe lái xe trong CSDL (`gksk_certificates`). */
export interface CertificateRow {
  id: number;
  so: string;
  fields: GkskRecord;
  fieldsJson: string;
  dataSha256: string;
  status: CertificateStatus;
  batchId: number | null;
  batchFilename: string | null;
  excelRowNumber: number | null;
  serverCertificateId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Dữ liệu đầu vào khi thêm mới hoặc ghi đè giấy theo mã `so` (`upsertBySo`). */
export interface UpsertCertificateInput {
  so: string;
  fields: GkskRecord;
  dataSha256: string;
  status: CertificateStatus;
  batchId?: number | null;
  excelRowNumber?: number | null;
  serverCertificateId?: string | null;
  now?: string | Date;
}

/** Kết quả của thao tác `upsertBySo`. */
export interface UpsertCertificateResult {
  row: CertificateRow;
  /** `true` nếu thêm mới, `false` nếu ghi đè bản ghi đã tồn tại cùng `so`. */
  created: boolean;
}

/** Số đếm thống kê đối soát theo 4 tab và từng trạng thái chi tiết (ARCHITECTURE.md §4 & §8). */
export interface ReconcileCounts {
  /** Tổng số giấy (`ready + accepted + invalid + rejected + error + sending`). */
  all: number;
  /** Tab "Chưa đẩy (Sẵn sàng)" (`status = 'ready'`). */
  unsent: number;
  /** Tab "Đã đẩy thành công" (`status = 'accepted'`). */
  accepted: number;
  /** Tab "Cần xử lý" (`invalid + rejected + error`). */
  attention: number;
  /** Số lượng từng trạng thái đơn lẻ. */
  ready: number;
  invalid: number;
  rejected: number;
  error: number;
  sending: number;
}

/** Bộ lọc chung khi đếm thống kê `counts` (không phụ thuộc `tab` đang chọn). */
export interface CertificateCountFilter {
  batchId?: number;
  fromDate?: string;
  toDate?: string;
  q?: string;
}

/** Tham số truy vấn danh sách giấy có phân trang và lọc đối soát (ARCHITECTURE.md §4). */
export interface CertificateListQuery extends CertificateCountFilter {
  /** Tab lọc nhanh: `all | unsent | accepted | attention` (mặc định `all`). */
  tab?: ReconcileTab;
  /** Lọc chi tiết theo 1 trạng thái cụ thể (ví dụ lọc con trong tab `attention`: `invalid | rejected | error`). */
  status?: CertificateStatus;
  /** Trang hiện tại (bắt đầu từ 1, mặc định 1). */
  page?: number;
  /** Số bản ghi mỗi trang (mặc định 50, tối đa 1000). */
  pageSize?: number;
}

/** Kết quả truy vấn danh sách giấy phân trang kèm thống kê `counts`. */
export interface CertificateListResult {
  items: CertificateRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: ReconcileCounts;
}

/** Dữ liệu cập nhật trạng thái giấy trong quá trình đẩy cổng. */
export interface UpdateCertificateStatusInput {
  status: CertificateStatus;
  serverCertificateId?: string | null;
  now?: string | Date;
}

/** Bản ghi một lần đẩy gói tin lên Hệ thống Sở (`gksk_submissions`). */
export interface SubmissionRow {
  id: number;
  certificateId: number;
  msgId: string;
  sendDatetime: number;
  dataSha256: string;
  attempts: number;
  httpStatus: number | null;
  resCode: string | null;
  resultStatus: 'accepted' | 'rejected' | null;
  serverSubmissionId: string | null;
  errors: ServerIssue[];
  errorsJson: string | null;
  warnings: ServerIssue[];
  warningsJson: string | null;
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface CreateSubmissionInput {
  certificateId: number;
  msgId: string;
  sendDatetime: number;
  dataSha256: string;
  attempts?: number;
  httpStatus?: number | null;
  resCode?: string | null;
  resultStatus?: 'accepted' | 'rejected' | null;
  serverSubmissionId?: string | null;
  errors?: ServerIssue[] | null;
  warnings?: ServerIssue[] | null;
  lastError?: string | null;
  createdAt?: string | Date;
  finishedAt?: string | Date | null;
}

export interface UpdateSubmissionInput {
  msgId?: string;
  sendDatetime?: number;
  attempts?: number;
  httpStatus?: number | null;
  resCode?: string | null;
  resultStatus?: 'accepted' | 'rejected' | null;
  serverSubmissionId?: string | null;
  errors?: ServerIssue[] | null;
  warnings?: ServerIssue[] | null;
  lastError?: string | null;
  finishedAt?: string | Date | null;
}

/** Kho lưu trữ đợt import Excel (`gksk_import_batches`). */
export interface BatchesRepository {
  create(input: CreateImportBatchInput): Promise<ImportBatchRow>;
  findById(id: number): Promise<ImportBatchRow | null>;
  list(): Promise<ImportBatchRow[]>;
}

/** Kho lưu trữ giấy GKSK lái xe (`gksk_certificates`). */
export interface CertificatesRepository {
  /** Thêm mới hoặc ghi đè theo mã `so` (lưu cả bản ghi `ready` lẫn `invalid` có `so`). */
  upsertBySo(input: UpsertCertificateInput): Promise<UpsertCertificateResult>;
  /** Upsert hàng loạt theo danh sách (phục vụ `commitImport` ở S11). */
  upsertManyBySo(inputs: readonly UpsertCertificateInput[]): Promise<{
    inserted: number;
    updated: number;
    rows: CertificateRow[];
  }>;
  findById(id: number): Promise<CertificateRow | null>;
  findByIds(ids: readonly number[]): Promise<CertificateRow[]>;
  findBySo(so: string): Promise<CertificateRow | null>;
  /** Tra cứu hàng loạt theo danh sách mã `so` (phục vụ xem trước ghi đè thông minh khi Import Excel). */
  findBySoList(soList: readonly string[]): Promise<CertificateRow[]>;
  /** Truy vấn phân trang theo 4 tab đối soát (`all | unsent | accepted | attention`), đợt import, ngày, từ khóa `q`. */
  list(query?: CertificateListQuery): Promise<CertificateListResult>;
  /** Đếm số lượng theo từng nhóm đối soát và trạng thái. */
  countByStatus(filter?: CertificateCountFilter): Promise<ReconcileCounts>;
  /** Cập nhật trạng thái giấy và `server_certificate_id`. */
  updateStatus(
    id: number,
    input: UpdateCertificateStatusInput,
  ): Promise<CertificateRow | null>;
  /** Xóa giấy cục bộ khỏi DB (kéo theo xóa toàn bộ `submissions` của giấy đó). */
  deleteById(id: number): Promise<boolean>;
  /** Khi khởi động server: chuyển mọi giấy đang kẹt ở `sending` về `error` (ARCHITECTURE.md §6). */
  recoverOnStartup(now?: string | Date): Promise<number>;
}

/** Kho lưu trữ lịch sử các lần gửi (`gksk_submissions`). */
export interface SubmissionsRepository {
  create(input: CreateSubmissionInput): Promise<SubmissionRow>;
  update(id: number, input: UpdateSubmissionInput): Promise<SubmissionRow | null>;
  findById(id: number): Promise<SubmissionRow | null>;
  findByMsgId(msgId: string): Promise<SubmissionRow | null>;
  listByCertificateId(certificateId: number): Promise<SubmissionRow[]>;
  findLatestByCertificateId(certificateId: number): Promise<SubmissionRow | null>;
  findLatestByCertificateIds(
    certificateIds: readonly number[],
  ): Promise<Map<number, SubmissionRow>>;
  /**
   * Tìm lần gửi gần nhất của giấy chưa có kết quả (`resultStatus === null`) và cùng `dataSha256`
   * để giữ nguyên `msg_id` & `send_datetime` khi gửi lại sau lỗi mạng (ARCHITECTURE.md §6).
   */
  findPendingByCertificateAndSha(
    certificateId: number,
    dataSha256: string,
  ): Promise<SubmissionRow | null>;
}

/** Giao diện tổng hợp 4 kho dữ liệu của hệ thống GKSKLaiXe (IMPLEMENTATION-PLAN.md S8 & ARCHITECTURE.md §5). */
export interface DbRepositories {
  readonly kind: 'in-memory' | 'mssql';
  readonly batches: BatchesRepository;
  readonly certificates: CertificatesRepository;
  readonly submissions: SubmissionsRepository;
  readonly users: UsersRepository;
}
