import { describe, expect, it } from 'vitest';
import { findMatches, mask, selftest } from './check-privacy.mjs';

/**
 * These tests exist because the guard itself can leak: a rule that never fires is a lie, and a
 * report that prints the matched value is a second copy of the thing it was supposed to protect.
 */
describe('privacy guard', () => {
  it('passes its own self-test', () => {
    expect(selftest()).toEqual([]);
  });

  it('flags a dormitory code in a residence context and masks it', () => {
    const hits = findMatches('宿舍 B7-210 的余额', []); // privacy:ignore 合成房号
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.rule)).toContain('dorm-code-in-context');
    expect(hits.every((h) => !h.masked.includes('210'))).toBe(true);
  });

  it('flags a credential value but not a presence flag or a placeholder', () => {
    expect(findMatches('access_token=AbCdEf123456GhIj7890', []).length).toBe(1); // privacy:ignore 合成凭据
    expect(findMatches('refreshToken=present cookies=TGC,error_times,locSession', [])).toEqual([]);
    expect(findMatches('Synjones-Auth: bearer <access_token>', [])).toEqual([]);
    expect(findMatches('password: string;', [])).toEqual([]);
    expect(findMatches('const password = els.password.value;', [])).toEqual([]);
    expect(findMatches('refresh_token=not-a-real-token-0000', [])).toEqual([]);
  });

  it('ignores a line that opted out explicitly', () => {
    expect(findMatches('楼栋 F12-345 privacy:ignore 已脱敏讨论', [])).toEqual([]);
  });

  it('catches values only the local denylist knows about', () => {
    expect(findMatches('学号 2400 0000 号', ['2400 0000'])).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'denylist' })]),
    );
  });

  it('masks without reproducing the value', () => {
    expect(mask('C12-3456')).toBe('C1***8'); // privacy:ignore 合成房号，用于验证打码
    expect(mask('ab')).toBe('*');
  });
});
