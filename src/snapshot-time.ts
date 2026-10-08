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
