/**
 * Danh sách 25 tên thẻ dữ liệu GKSK Lái xe theo đúng thứ tự bảng BHXH (PL2 CV 3829 / DATA-SPEC.md §1).
 * Cũng là thứ tự xuất thẻ XML trong thẻ gốc `<root>`.
 */
export const FIELD_ORDER = [
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
] as const;

export type FieldTag = (typeof FIELD_ORDER)[number];

export type FieldType = 'text' | 'date' | 'number' | 'enum';

export type SensitiveTag = 'NONGDOCON' | 'MATUY' | 'LYDO' | 'TINHTRANGBENH';

export interface FieldSpec {
  readonly order: number;
  readonly tag: FieldTag;
  readonly label: string;
  readonly type: FieldType;
  /** Độ dài tối đa theo bảng BHXH (undefined nếu là kiểu NUMBER không giới hạn độ dài chuỗi). */
  readonly maxLength?: number;
  /** Độ dài tối đa Sở Y tế chấp nhận (nếu khác BHXH, ví dụ SO: BHXH 20, Sở ≤ 30). */
  readonly serverMaxLength?: number;
  /** Bắt buộc theo bảng BHXH (ALLOW_NULL trống = true; 3 thẻ được phép null = false). */
  readonly bhxhRequired: boolean;
  /** Bắt buộc theo Hệ thống Sở Y tế Đồng Nai (thiếu → từ chối giấy). */
  readonly soRequired: boolean;
  readonly enumValues?: readonly string[];
  readonly enumLabels?: Readonly<Record<string, string>>;
  /** Trường nhạy cảm: không log, không trả/hiển thị trên bảng danh sách đối soát. */
  readonly sensitive: boolean;
  /** Có mặt trong file Excel mẫu 23 cột hay không (`IDBENHVIEN`, `BENHVIEN` = false). */
  readonly inTemplate: boolean;
  /** Trường chỉ đọc / tự điền từ cấu hình server (`IDBENHVIEN`, `BENHVIEN` = true). */
  readonly readOnly: boolean;
  /** Bí danh tên cột chấp nhận khi Import Excel (ví dụ `GIOITINH` cho `GIOITINHVAL`). */
  readonly excelAliases?: readonly string[];
  readonly note?: string;
}

/** Bản ghi dữ liệu GKSK lái xe gồm đúng 25 khóa, mọi giá trị đều là chuỗi. */
export type GkskRecord = Record<FieldTag, string>;

/** Dữ liệu giấy dùng cho bảng danh sách đối soát (đã loại bỏ 4 trường nhạy cảm). */
export type GkskListFields = Omit<GkskRecord, SensitiveTag>;

export type IssueSeverity = 'error' | 'warning' | 'info';

export type IssueSource = 'server-mirror' | 'local';

export interface Issue {
  readonly code: string;
  readonly field: FieldTag | null;
  readonly severity: IssueSeverity;
  readonly source: IssueSource;
  /** Danh sách thẻ liên quan (dùng cho mã gộp như `LOCAL_BHXH_REQUIRED_EMPTY`). */
  readonly fields?: readonly FieldTag[];
}

/** Lỗi hoặc cảnh báo trả về trực tiếp trong `data.errors` / `data.warnings` của API Sở. */
export interface ServerIssue {
  readonly code: string;
  readonly field: string | null;
}

/** Chế độ đối chiếu theo mã `SO` khi xem trước Import Excel (DATA-SPEC.md §5.2). */
export type ConflictMode =
  | 'new'
  | 'overwrite_pending'
  | 'accepted_unchanged'
  | 'accepted_modified'
  | 'missing_so';

/** Trạng thái xử lý của 1 giấy GKSK trong CSDL nội bộ. */
export type CertificateStatus =
  | 'invalid'
  | 'ready'
  | 'sending'
  | 'accepted'
  | 'rejected'
  | 'error';

/** 4 tab lọc nhanh trên màn hình Danh sách & Đối soát. */
export type ReconcileTab = 'all' | 'unsent' | 'accepted' | 'attention';
