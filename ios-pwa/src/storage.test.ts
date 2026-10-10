import { describe, expect, it } from 'vitest';
import { demoHistory, formatBackup, parseBackup, parseManualMoney, validateReading } from './storage';

describe('iOS PWA local-only history', () => {
  const now = Date.UTC(2026, 9, 10);
  const valid = { updatedAt: now - 2000, electric: 19.42, water: 28.2, source: 'manual' as const };
  it('validates normal user amounts and rejects credentials or room fields', () => {
    expect(validateReading(valid, now)).toEqual(valid);
    expect(() => validateReading({ ...valid, room: 'TEST-ROOM' }, now)).toThrow();
    expect(() => validateReading({ ...valid, password: 'not-a-real-secret' }, now)).toThrow();
    expect(() => validateReading({ ...valid, electric: -9 }, now)).toThrow();
    expect(() => validateReading({ ...valid, water: Number.NaN }, now)).toThrow();
  });
  it('checks timestamps and only allows known sources', () => {
    expect(() => validateReading({ ...valid, updatedAt: 1 }, now)).toThrow();
    expect(() => validateReading({ ...valid, updatedAt: now + 9 * 86400_000 }, now)).toThrow();
    expect(() => validateReading({ ...valid, source: 'nightly' }, now)).toThrow();
  });
  it('rejects unsafe or malformed manual money', () => {
    expect(parseManualMoney(' 12.30 ')).toBe(12.3);
    expect(parseManualMoney('0')).toBe(0);
    for (const bad of ['-1', '1.234', 'NaN', 'Infinity', '3e2', '1000001', '¥5']) {
      expect(parseManualMoney(bad)).toBeNull();
    }
  });
  it('exports a portable backup but no other fields', () => {
    const text = formatBackup([valid], now);
    const restored = parseBackup(text, now);
    expect(restored).toEqual([{ ...valid, source: 'import' }]);
    expect(JSON.parse(text)).toHaveProperty('format', 'bombax-pwa-local-history');
    expect(text).not.toContain('room');
  });
  it('refuses arbitrary JSON and extra top-level fields', () => {
    expect(() => parseBackup('{}', now)).toThrow();
    expect(() => parseBackup('!', now)).toThrow();
    const text = formatBackup([valid], now);
    expect(() => parseBackup(text.replace('"version": 1,', '"version": 1, "token": "example",'), now)).toThrow();
  });
  it('deduplicates records on import by sampling time', () => {
    const json = JSON.parse(formatBackup([valid, valid], now));
    expect(parseBackup(JSON.stringify(json), now)).toHaveLength(1);
  });
  it('does not persist the example dataset', () => {
    const data = demoHistory(now);
    expect(data).toHaveLength(14);
    expect(data[8].electric).toBeGreaterThan(data[7].electric);
  });
});
