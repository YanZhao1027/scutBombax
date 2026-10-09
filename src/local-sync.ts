import { formatCountdown } from './snapshot-time';

/**
 * A background snapshot is history, not a live foreground query.
 * Replace the displayed reading only when the local store has strictly newer information.
 * Do not overwrite a newer live reading or re-label a same-timestamp live reading as history.
 */
export const shouldAdoptStoredReading = (
  candidateAt: number,
  displayedAt: number | null
): boolean => Number.isFinite(candidateAt) && candidateAt > 0 &&
  (displayedAt === null || candidateAt > displayedAt);

/**
 * The due time belongs to the native alarm, not the timestamp of the last WebView render.
 * A past-due inexact alarm is still pending: do not silently jump to "tomorrow" before delivery.
 */
export const dueLabel = (now: number, dueAt: number, kind: 'daily' | 'test'): string => {
  if (!Number.isFinite(dueAt) || dueAt <= 0) return kind === 'daily' ? '未开启' : '';
  if (dueAt <= now) return '等待系统投递';
  const span = formatCountdown((dueAt - now) / 1000);
  return kind === 'daily' ? `下次约 ${span}后` : `预计 ${span}后（可能延迟）`;
};
