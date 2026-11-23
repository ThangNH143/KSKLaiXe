import { FIELD_BY_TAG } from './fields.js';
import type { FieldTag } from './types.js';

/** Mã từ chối giấy từ Hệ thống Sở Y tế (`data.errors`, HTTP 200, `status = rejected`) — API-CONTRACT.md §9. */
export const SERVER_ERROR_CODES = [
  'GKSK_XML_INVALID',
  'GKSK_SO_MISSING',
  'GKSK_SO_TOO_LONG',
  'GKSK_FACILITY_MISMATCH',
  'GKSK_HOTEN_INVALID',
  'GKSK_ID_MISSING',
  'GKSK_NGAYSINH_INVALID',
  'GKSK_NGAYKETLUAN_INVALID',
  'GKSK_KETLUAN_MISSING',
] as const;

/** Mã cảnh báo từ Hệ thống Sở Y tế (`data.warnings`, giấy vẫn được lưu) — API-CONTRACT.md §10. */
export const SERVER_WARNING_CODES = [
  'GKSK_UNSIGNED',
  'GKSK_SIGNATURE_INVALID',
  'GKSK_SIGNED_DATA_MISMATCH',
  'GKSK_UNKNOWN_TAG',
  'GKSK_ID_INVALID',
  'GKSK_KETLUAN_UNKNOWN',
  'GKSK_GIOITINH_UNKNOWN',
  'GKSK_NONGDOCON_INVALID',
  'GKSK_DVINONGDOCON_INVALID',
  'GKSK_MATUY_INVALID',
  'GKSK_DATE_INVALID',
  'GKSK_FIELD_TOO_LONG',
  'GKSK_STATE_ADD_EXISTS',
  'GKSK_SKIPPED_STALE',
] as const;

/** Mã kiểm tra cục bộ của ứng dụng (`LOCAL_*`) — DATA-SPEC.md §2. */
export const LOCAL_ISSUE_CODES = [
  'LOCAL_FIELD_OVER_SPEC',
  'LOCAL_SO_OVER_20',
  'LOCAL_SO_FORMAT',
  'LOCAL_BHXH_REQUIRED_EMPTY',
  'LOCAL_NGAYSINH_FUTURE',
  'LOCAL_KETLUAN_A03_NO_RECHECK',
  'LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM',
  'LOCAL_ID_CREATES_PERSON',
  'LOCAL_SO_DUPLICATE_IN_BATCH',
  'LOCAL_SO_EXISTS',
  'LOCAL_SO_ACCEPTED_UNCHANGED',
  'LOCAL_SO_ACCEPTED_MODIFIED',
  'LOCAL_FACILITY_MISMATCH',
] as const;

export const ALL_ISSUE_CODES = [
  ...SERVER_ERROR_CODES,
  ...SERVER_WARNING_CODES,
  ...LOCAL_ISSUE_CODES,
] as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];
export type ServerWarningCode = (typeof SERVER_WARNING_CODES)[number];
export type LocalIssueCode = (typeof LOCAL_ISSUE_CODES)[number];
export type IssueCode = (typeof ALL_ISSUE_CODES)[number];

/** Bảng ánh xạ toàn bộ mã lỗi/cảnh báo/thông tin sang thông điệp tiếng Việt có dấu. */
export const ISSUE_MESSAGES: Readonly<Record<IssueCode, string>> = {
  // API-CONTRACT.md §9 — Mã từ chối giấy (data.errors)
  GKSK_XML_INVALID:
    'Nội dung XML/JSON không hợp lệ (sai cú pháp, chứa DOCTYPE, vượt quá 1 MB hoặc thiếu thẻ SO).',
  GKSK_SO_MISSING: 'Thiếu số giấy khám sức khỏe (SO).',
  GKSK_SO_TOO_LONG: 'Số giấy khám sức khỏe (SO) vượt quá 30 ký tự.',
  GKSK_FACILITY_MISMATCH: 'Mã cơ sở y tế (IDBENHVIEN) trống hoặc không khớp với tài khoản CSYT.',
  GKSK_HOTEN_INVALID: 'Họ tên (HOTEN) bị trống hoặc vượt quá 255 ký tự.',
  GKSK_ID_MISSING: 'Thiếu số CMND/CCCD/hộ chiếu (SOCMND_PASSPORT).',
  GKSK_NGAYSINH_INVALID:
    'Ngày sinh (NGAYSINH) không đúng định dạng dd/MM/yyyy hoặc năm sinh nằm ngoài khoảng 1900 đến năm hiện tại.',
  GKSK_NGAYKETLUAN_INVALID: 'Ngày kết luận (NGAYKETLUAN) không đúng định dạng ngày dd/MM/yyyy hợp lệ.',
  GKSK_KETLUAN_MISSING: 'Thiếu kết luận khám sức khỏe (KETLUAN).',

  // API-CONTRACT.md §10 — Cảnh báo (data.warnings)
  GKSK_UNSIGNED: 'Giấy chưa có chữ ký số (bình thường ở phiên bản hiện tại, giấy vẫn được lưu).',
  GKSK_SIGNATURE_INVALID: 'Chữ ký số trên giấy không hợp lệ hoặc không khớp nội dung.',
  GKSK_SIGNED_DATA_MISMATCH: 'Dữ liệu JSON không khớp với nội dung đã ký (SIGNDATA).',
  GKSK_UNKNOWN_TAG: 'Gói tin chứa thẻ không thuộc đặc tả PL2 CV 3829 (hệ thống Sở đã bỏ qua thẻ này).',
  GKSK_ID_INVALID:
    'Số giấy tờ (SOCMND_PASSPORT) không đúng chuẩn CMND/CCCD (toàn số 0 hoặc 10/11 chữ số) — giấy vẫn lưu nhưng không tự gắn người.',
  GKSK_KETLUAN_UNKNOWN: 'Mã kết luận (KETLUAN) nằm ngoài danh mục chuẩn (A0-1, A0-2, A0-3).',
  GKSK_GIOITINH_UNKNOWN: 'Mã giới tính (GIOITINHVAL) không hợp lệ (chỉ nhận 0 = Nam, 1 = Nữ).',
  GKSK_NONGDOCON_INVALID: 'Giá trị nồng độ cồn (NONGDOCON) không phải số hợp lệ.',
  GKSK_DVINONGDOCON_INVALID:
    'Đơn vị nồng độ cồn (DVINONGDOCON) không hợp lệ (chỉ nhận 0 hoặc 1).',
  GKSK_MATUY_INVALID: 'Kết quả xét nghiệm ma túy (MATUY) không hợp lệ (chỉ nhận 0 hoặc 1).',
  GKSK_DATE_INVALID:
    'Ngày khám, ngày cấp giấy tờ hoặc ngày khám lại không đúng định dạng dd/MM/yyyy (hệ thống Sở lưu trống).',
  GKSK_FIELD_TOO_LONG:
    'Giá trị trường vượt quá độ dài tối đa theo bảng đặc tả BHXH (hệ thống Sở vẫn lưu nguyên giá trị).',
  GKSK_STATE_ADD_EXISTS:
    'Trạng thái là ADD nhưng số giấy đã tồn tại trên hệ thống Sở — đã tự động ghi đè giấy cũ.',
  GKSK_SKIPPED_STALE:
    'Hệ thống Sở đã có bản ghi mới hơn nên bản gửi này không ghi đè dữ liệu hiện có.',

  // DATA-SPEC.md §2 — Mã cục bộ (LOCAL_*)
  LOCAL_FIELD_OVER_SPEC:
    'Giá trị vượt quá độ dài tối đa theo bảng BHXH (hệ thống Sở sẽ trả cảnh báo nhưng vẫn lưu).',
  LOCAL_SO_OVER_20:
    'Số giấy (SO) dài 21–30 ký tự (vượt giới hạn 20 của bảng BHXH nhưng hệ thống Sở vẫn chấp nhận tối đa 30 ký tự).',
  LOCAL_SO_FORMAT:
    'Số giấy (SO) không theo mẫu chuẩn BHXH (NNNNN/GKSKLX/<mã CSYT>/<YY>); bình thường nếu là giấy thử nghiệm.',
  LOCAL_BHXH_REQUIRED_EMPTY:
    'Một số trường bắt buộc theo bảng BHXH đang để trống (hệ thống Sở không chặn nhưng nên bổ sung đầy đủ).',
  LOCAL_NGAYSINH_FUTURE:
    'Ngày sinh lớn hơn ngày hiện tại (hệ thống Sở vẫn có thể nhận nếu cùng năm nhưng sẽ không tạo hồ sơ người).',
  LOCAL_KETLUAN_A03_NO_RECHECK:
    'Kết luận là A0-3 (đạt tiêu chuẩn, yêu cầu khám lại) nhưng đang để trống ngày khám lại (NGAYKHAMLAI).',
  LOCAL_NGAYKETLUAN_BEFORE_NGAYKHAM: 'Ngày kết luận (NGAYKETLUAN) sớm hơn ngày khám (NGAYKHAM).',
  LOCAL_ID_CREATES_PERSON:
    'Số giấy tờ có 9 hoặc 12 chữ số (CMND/CCCD) — khi đẩy lên Sở sẽ tạo hồ sơ người mới nếu chưa tồn tại.',
  LOCAL_SO_DUPLICATE_IN_BATCH:
    'Trùng số giấy (SO) trong cùng file Excel (khi lưu chỉ lấy dòng xuất hiện sau cùng).',
  LOCAL_SO_EXISTS:
    'Số giấy (SO) đã có trong danh sách nội bộ ở trạng thái chưa đẩy/lỗi — mặc định chọn để ghi đè bản sửa mới.',
  LOCAL_SO_ACCEPTED_UNCHANGED:
    'Số giấy (SO) đã đẩy thành công lên Sở và dữ liệu không thay đổi — mặc định bỏ chọn để tránh đẩy lại.',
  LOCAL_SO_ACCEPTED_MODIFIED:
    'Số giấy (SO) đã đẩy thành công lên Sở nhưng dữ liệu trong file Excel đã thay đổi — mặc định bỏ chọn, hãy kiểm tra kỹ trước khi chọn ghi đè.',
  LOCAL_FACILITY_MISMATCH:
    'Cột IDBENHVIEN trong file Excel không khớp với mã CSYT cấu hình trên máy chủ (lỗi chặn).',
};

/**
 * Tra thông điệp tiếng Việt theo mã lỗi/cảnh báo.
 * Theo API-CONTRACT.md §10: mã lạ không có trong bảng sẽ hiển thị nguyên mã.
 */
export function getIssueMessage(code: string): string {
  if (Object.prototype.hasOwnProperty.call(ISSUE_MESSAGES, code)) {
    return ISSUE_MESSAGES[code as IssueCode];
  }
  return code;
}

/**
 * Định dạng thông điệp tiếng Việt kèm tên trường (hoặc danh sách trường với mã gộp).
 */
export function formatIssueMessage(issue: {
  readonly code: string;
  readonly field?: string | null;
  readonly fields?: readonly string[];
}): string {
  const base = getIssueMessage(issue.code);
  if (issue.fields && issue.fields.length > 0) {
    return `${base} Các thẻ trống: ${issue.fields.join(', ')}.`;
  }
  if (issue.field) {
    const spec = Object.prototype.hasOwnProperty.call(FIELD_BY_TAG, issue.field)
      ? FIELD_BY_TAG[issue.field as FieldTag]
      : undefined;
    const fieldLabel = spec ? `${spec.label} (${spec.tag})` : issue.field;
    return `[${fieldLabel}] ${base}`;
  }
  return base;
}
