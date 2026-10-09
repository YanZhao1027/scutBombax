/** Strict, locale-neutral clock input for the native-owned Beijing time setting. */
export interface ClockTime { hour: number; minute: number }

export const parseBeijingClock = (value: string): ClockTime | null => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
};

export const formatBeijingClock = (hour: number, minute: number): string => {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59) return '23:00';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

/**
 * How long until the next snapshot, said the way an inexact alarm deserves: coarse.
 *
 * Rounding the minutes separately from the hours is what produced "下次约 3 小时 60 分后" on the
 * phone at 19:08 on 2026-10-09 — three hours and 59.6 minutes, where the minutes rounded up to 60
 * while the hours stayed at 3. Splitting a span that was already rounded is what makes it come out
 * as 4 小时 0 分 instead.
 */
export const formatCountdown = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${Math.max(minutes, 1)} 分`;
};
