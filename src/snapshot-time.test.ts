import { describe, expect, it } from 'vitest';
import { formatBeijingClock, parseBeijingClock } from './snapshot-time';

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
