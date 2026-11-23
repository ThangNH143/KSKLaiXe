import { describe, expect, it } from 'vitest';
import {
  ALL_ISSUE_CODES,
  ISSUE_MESSAGES,
  LOCAL_ISSUE_CODES,
  SERVER_ERROR_CODES,
  SERVER_WARNING_CODES,
  formatIssueMessage,
  getIssueMessage,
} from './messages.js';

describe('ISSUE_MESSAGES — ánh xạ mã lỗi/cảnh báo sang tiếng Việt (API-CONTRACT §9–10 & DATA-SPEC §2)', () => {
  it('bao phủ đủ 9 mã từ chối §9, 14 mã cảnh báo §10 và 13 mã LOCAL_* §2 (tổng 36 mã)', () => {
    expect(SERVER_ERROR_CODES).toHaveLength(9);
    expect(SERVER_WARNING_CODES).toHaveLength(14);
    expect(LOCAL_ISSUE_CODES).toHaveLength(13);
    expect(ALL_ISSUE_CODES).toHaveLength(36);
    expect(new Set(ALL_ISSUE_CODES).size).toBe(36);
    expect(Object.keys(ISSUE_MESSAGES).sort()).toEqual([...ALL_ISSUE_CODES].sort());
  });

  it('có các mã đối chiếu import ghi đè thông minh LOCAL_SO_EXISTS / UNCHANGED / MODIFIED', () => {
    expect(LOCAL_ISSUE_CODES).toContain('LOCAL_SO_EXISTS');
    expect(LOCAL_ISSUE_CODES).toContain('LOCAL_SO_ACCEPTED_UNCHANGED');
    expect(LOCAL_ISSUE_CODES).toContain('LOCAL_SO_ACCEPTED_MODIFIED');
  });

  it('100% mã đều có thông điệp tiếng Việt có dấu khác rỗng', () => {
    const vietnameseDiacriticRegex =
      /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/;

    for (const code of ALL_ISSUE_CODES) {
      const msg = getIssueMessage(code);
      expect(msg, `Thiếu thông điệp cho ${code}`).toBeTruthy();
      expect(msg, `Thông điệp của ${code} không được trùng nguyên mã`).not.toBe(code);
      expect(msg, `Thông điệp của ${code} phải là tiếng Việt có dấu`).toMatch(
        vietnameseDiacriticRegex,
      );
    }
  });

  it('getIssueMessage trả về nguyên mã nếu gặp mã lạ chưa khai báo (API-CONTRACT §10)', () => {
    expect(getIssueMessage('GKSK_FUTURE_UNKNOWN_CODE')).toBe('GKSK_FUTURE_UNKNOWN_CODE');
    expect(getIssueMessage('toString')).toBe('toString');
  });

  it('formatIssueMessage gắn nhãn trường hoặc danh sách trường gộp rõ ràng', () => {
    const withField = formatIssueMessage({
      code: 'LOCAL_FIELD_OVER_SPEC',
      field: 'NOICAP',
    });
    expect(withField).toContain('[Nơi cấp (NOICAP)]');
    expect(withField).toContain(ISSUE_MESSAGES.LOCAL_FIELD_OVER_SPEC);

    const withFields = formatIssueMessage({
      code: 'LOCAL_BHXH_REQUIRED_EMPTY',
      field: null,
      fields: ['NGAYKHAM', 'DIACHITHUONGTRU'],
    });
    expect(withFields).toContain('NGAYKHAM, DIACHITHUONGTRU');

    const plain = formatIssueMessage({
      code: 'GKSK_UNSIGNED',
      field: null,
    });
    expect(plain).toBe(ISSUE_MESSAGES.GKSK_UNSIGNED);

    const unknownField = formatIssueMessage({
      code: 'GKSK_UNKNOWN_TAG',
      field: 'CUSTOM_TAG',
    });
    expect(unknownField).toContain('[CUSTOM_TAG]');
  });
});
