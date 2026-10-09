import { describe, expect, it } from 'vitest';
import { formatBeijingClock, formatCountdown, parseBeijingClock } from './snapshot-time';

describe('Beijing snapshot time input', () => {
  it('accepts the entire 24h range', () => {
    expect(parseBeijingClock('00:00')).toEqual({ hour: 0, minute: 0 });
    expect(parseBeijingClock('23:59')).toEqual({ hour: 23, minute: 59 });
  });
  it('rejects invalid and partial clock values', () => {
    expect(parseBeijingClock('24:00')).toBeNull();
    expect(parseBeijingClock('20:60')).toBeNull();
    expect(parseBeijingClock('9:5')).toBeNull();
    expect(parseBeijingClock('')).toBeNull();
  });
  it('formats native time as zero-padded 24h input', () => {
    expect(formatBeijingClock(0, 5)).toBe('00:05');
    expect(formatBeijingClock(20, 30)).toBe('20:30');
  });
  it('falls back safely for invalid native settings', () => {
    expect(formatBeijingClock(-1, 66)).toBe('23:00');
  });
});

describe('countdown to the next snapshot', () => {
  it('never shows sixty minutes — the case the phone produced at 19:08', () => {
    // 3 h 59 min 36 s. Rounding the minutes on their own gave "3 小时 60 分".
    expect(formatCountdown(3 * 3600 + 59 * 60 + 36)).toBe('4 小时 0 分');
  });
  it('keeps a plain hour-and-minute span readable', () => {
    expect(formatCountdown(3 * 3600 + 59 * 60)).toBe('3 小时 59 分');
    expect(formatCountdown(23 * 3600 + 59 * 60 + 30)).toBe('24 小时 0 分');
  });
  it('stays coarse below an hour and never claims zero minutes', () => {
    expect(formatCountdown(5 * 60)).toBe('5 分');
    expect(formatCountdown(20)).toBe('1 分');
    expect(formatCountdown(0)).toBe('1 分');
  });
  it('refuses to count down to something that is not in the future', () => {
    expect(formatCountdown(-1)).toBe('—');
    expect(formatCountdown(Number.NaN)).toBe('—');
  });
});
