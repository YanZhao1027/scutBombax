import { describe, expect, it } from 'vitest';
import {
  GAP_BREAK_MS,
  balanceIncreases,
  breaksTheLine,
  filterElectricHistory
} from './trend';
import type { ElectricHistory, ElectricHistoryPoint } from './types';

const DAY = 86_400_000;
const point = (day: number, electric: number | null): ElectricHistoryPoint => ({
  updatedAt: day * DAY,
  electric,
  source: 'nightly'
});

const sample: ElectricHistory = {
  campus: 'DXC',
  unit: '元',
  points: [
    point(100, 20),
    point(101, 18),
    point(102, 48),
    point(103, 46),
    point(104, null)
  ]
};

describe('filterElectricHistory', () => {
  it('drops readings with no balance and keeps the rest in time order', () => {
    expect(filterElectricHistory(sample, 'all').map((p) => p.electric)).toEqual([20, 18, 48, 46]);
  });

  it('never turns an absent balance into a zero', () => {
    const onlyAbsent: ElectricHistory = { ...sample, points: [point(101, null)] };
    expect(filterElectricHistory(onlyAbsent, 'all')).toEqual([]);
  });

  it('measures a range back from the newest reading, not from today', () => {
    expect(filterElectricHistory(sample, 2).map((p) => p.electric)).toEqual([18, 48, 46]);
  });

  it('sorts without disturbing the caller’s array', () => {
    const unsorted: ElectricHistory = { campus: 'DXC', unit: '元', points: [point(102, 5), point(100, 9)] };
    const before = unsorted.points.map((p) => p.updatedAt);
    expect(filterElectricHistory(unsorted, 'all').map((p) => p.updatedAt)).toEqual([
      100 * DAY,
      102 * DAY
    ]);
    expect(unsorted.points.map((p) => p.updatedAt)).toEqual(before);
  });

  it('rejects a timestamp that could not have come from a query', () => {
    const broken: ElectricHistory = {
      campus: 'DXC',
      unit: '元',
      points: [
        { updatedAt: 0, electric: 12, source: 'manual' },
        { updatedAt: Number.NaN, electric: 13, source: 'manual' }
      ]
    };
    expect(filterElectricHistory(broken, 'all')).toEqual([]);
  });
});

describe('breaksTheLine', () => {
  it('starts a new subpath at the first point of a series', () => {
    expect(breaksTheLine(null, 100 * DAY)).toBe(true);
  });

  it('connects consecutive nightly samples', () => {
    expect(breaksTheLine(100 * DAY, 101 * DAY)).toBe(false);
  });

  it('tolerates a late delivery, because the alarm is inexact', () => {
    // Measured on the device: 45 s late out of Doze. Hours late is also normal, and it is still
    // the same continuous series — the sample exists, only its minute moved.
    expect(breaksTheLine(100 * DAY, 100 * DAY + 6 * 3600_000)).toBe(false);
  });

  it('breaks across a missing day instead of inventing the slope', () => {
    expect(breaksTheLine(100 * DAY, 102 * DAY)).toBe(true);
    expect(breaksTheLine(100 * DAY, 100 * DAY + GAP_BREAK_MS + 1)).toBe(true);
  });
});

describe('balanceIncreases', () => {
  it('reports an objective rise, not a recharge amount', () => {
    const increases = balanceIncreases(filterElectricHistory(sample, 'all'));
    expect(increases).toEqual([{ at: 102 * DAY, delta: 30 }]);
  });

  it('finds every rise, including one that is smaller than the consumption either side', () => {
    const series = [point(1, 10), point(2, 8), point(3, 9), point(4, 7)];
    expect(balanceIncreases(series)).toEqual([{ at: 3 * DAY, delta: 1 }]);
  });

  it('is empty for a flat or falling series', () => {
    expect(balanceIncreases([point(1, 10), point(2, 10), point(3, 4)])).toEqual([]);
  });

  it('compares across a gap, which is why the caller must label it as an inference', () => {
    // A missing middle day means this +30 could be a top-up, a correction, or a balance that
    // moved for a reason the answer never states. The UI says 余额增项 for that reason.
    const withHole = [point(1, 10), point(9, 40)];
    expect(balanceIncreases(withHole)).toEqual([{ at: 9 * DAY, delta: 30 }]);
  });
});
