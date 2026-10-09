import { describe, expect, it } from 'vitest';
import { dueLabel, shouldAdoptStoredReading } from './local-sync';

describe('#28: background snapshot reconciliation', () => {
  it('adopts a newer background snapshot even after a foreground live query', () => {
    expect(shouldAdoptStoredReading(2000, 1000)).toBe(true);
  });
  it('does not paint the same stored row over an already-live reading', () => {
    expect(shouldAdoptStoredReading(1000, 1000)).toBe(false);
  });
  it('never regresses from a newer foreground reading to old history', () => {
    expect(shouldAdoptStoredReading(900, 1000)).toBe(false);
  });
  it('paints the first stored record after a cold start, but rejects bad timestamps', () => {
    expect(shouldAdoptStoredReading(123456, null)).toBe(true);
    expect(shouldAdoptStoredReading(0, null)).toBe(false);
    expect(shouldAdoptStoredReading(Number.NaN, null)).toBe(false);
  });
  it('advances the countdown with absolute time even without further native events', () => {
    const due = 1_000_000;
    expect(dueLabel(due - 20 * 60_000, due, 'daily')).toBe('下次约 20 分后');
    expect(dueLabel(due - 5 * 60_000, due, 'daily')).toBe('下次约 5 分后');
  });
  it('shows overdue inexact alarms honestly until they actually fire', () => {
    const due = 1_000_000;
    expect(dueLabel(due, due, 'daily')).toBe('等待系统投递');
    expect(dueLabel(due + 225_000, due, 'test')).toBe('等待系统投递');
  });
  it('handles an absent due time', () => {
    expect(dueLabel(Date.now(), 0, 'daily')).toBe('未开启');
    expect(dueLabel(Date.now(), 0, 'test')).toBe('');
  });
});
