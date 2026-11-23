import { describe, expect, it } from 'vitest';
import { ping } from './index.js';

describe('shared ping', () => {
  it('trả về chuỗi pong', () => {
    expect(ping()).toBe('pong');
  });
});
