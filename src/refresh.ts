/**
 * Foreground-only refresh policy.
 *
 * There is deliberately no background scheduler in this app: the timer lives in
 * the visible page, is cancelled whenever the page/app leaves the foreground, and
 * never runs more than one query at a time.
 */

export type TickOutcome = 'ok' | 'network' | 'reauth' | 'error';

export type AutoRefreshState = 'off' | 'waiting' | 'running' | 'halted';

export interface TimerHost {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number): void;
  now(): number;
}

export const browserHost: TimerHost = {
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  now: () => Date.now()
};

/** Short, bounded backoff for the single allowed retry after a transient failure. */
export const RETRY_BACKOFF_MS = 5_000;

export const MINUTES_TO_MS = (minutes: number): number => minutes * 60_000;

/**
 * How long to wait before the next query.
 * Returns null when nothing is scheduled (timer off or already halted).
 */
export const nextDelayMs = (
  intervalMs: number,
  lastFinishedAt: number,
  now: number,
  forceImmediate: boolean
): number | null => {
  if (intervalMs <= 0) return null;
  if (forceImmediate) return 0;
  const remaining = intervalMs - (now - lastFinishedAt);
  return remaining > 0 ? remaining : 0;
};

export class AutoRefresher {
  private intervalMs = 0;
  private visible = true;
  private inFlight = false;
  private lastFinishedAt = 0;
  private timerId: number | null = null;
  private retryPending = false;
  private state: AutoRefreshState = 'off';

  constructor(
    private readonly run: () => Promise<TickOutcome>,
    private readonly host: TimerHost = browserHost,
    private readonly onStateChange: (state: AutoRefreshState) => void = () => {}
  ) {}

  getState(): AutoRefreshState {
    return this.state;
  }

  getIntervalMs(): number {
    return this.intervalMs;
  }

  /** 0 turns the timer off. Selecting an interval re-arms a halted timer. */
  setIntervalMinutes(minutes: number): void {
    this.clearTimer();
    this.intervalMs = MINUTES_TO_MS(Math.max(0, Math.floor(minutes)));
    this.retryPending = false;
    if (this.intervalMs === 0) {
      this.setState('off');
      return;
    }
    this.setState('waiting');
    this.schedule({ immediate: this.shouldRunNow() });
  }

  /** Page/app visibility. Hidden stops all polling immediately. */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      this.clearTimer();
      if (this.state === 'waiting') this.setState('off');
      return;
    }
    if (this.intervalMs === 0 || this.state === 'halted') return;
    // Coming back to the foreground: query once only if the interval elapsed.
    this.setState('waiting');
    this.schedule({ immediate: this.shouldRunNow() });
  }

  /** A manual refresh just happened, so the next automatic one is a full interval away. */
  noteQueryFinished(at?: number): void {
    this.lastFinishedAt = at ?? this.host.now();
    this.retryPending = false;
    if (this.state !== 'halted' && this.intervalMs > 0 && this.visible) {
      this.schedule();
    }
  }

  /** Re-arm after a successful reauthentication. */
  resume(): void {
    if (this.intervalMs === 0) return;
    this.setState('waiting');
    this.schedule({ immediate: this.shouldRunNow() });
  }

  stop(): void {
    this.clearTimer();
    this.intervalMs = 0;
    this.setState('off');
  }

  private shouldRunNow(): boolean {
    if (this.lastFinishedAt === 0) return true;
    return this.host.now() - this.lastFinishedAt >= this.intervalMs;
  }

  private clearTimer(): void {
    if (this.timerId !== null) {
      this.host.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private setState(state: AutoRefreshState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange(state);
  }

  private schedule({ immediate = false }: { immediate?: boolean } = {}): void {
    this.clearTimer();
    if (this.intervalMs === 0 || !this.visible || this.state === 'halted') return;
    const delay = nextDelayMs(
      this.intervalMs,
      this.lastFinishedAt,
      this.host.now(),
      immediate
    );
    if (delay === null) return;
    this.timerId = this.host.setTimeout(() => {
      this.timerId = null;
      void this.tick();
    }, delay);
  }

  private async tick(): Promise<void> {
    // At most one in-flight query, always.
    if (this.inFlight || !this.visible) return;
    this.inFlight = true;
    const previous = this.state;
    if (previous !== 'halted') this.setState('running');

    let outcome: TickOutcome;
    try {
      outcome = await this.run();
    } catch {
      outcome = 'error';
    } finally {
      this.inFlight = false;
      this.lastFinishedAt = this.host.now();
    }

    if (outcome === 'reauth') {
      // A captcha or reauthentication condition must stop auto-refresh.
      this.clearTimer();
      this.setState('halted');
      return;
    }

    if (this.state === 'halted') return;

    if (outcome === 'network' && !this.retryPending) {
      // One bounded retry for a transient network error, then back to the plan.
      this.retryPending = true;
      // The query is not in flight any more, so say "waiting" (or "off" when the
      // page is hidden) and let the UI show that it is idle until the backoff.
      this.setState(this.visible ? 'waiting' : 'off');
      if (this.visible && this.intervalMs > 0) {
        this.clearTimer();
        this.timerId = this.host.setTimeout(() => {
          this.timerId = null;
          void this.tick();
        }, RETRY_BACKOFF_MS);
      }
      return;
    }

    this.retryPending = false;
    // A query that finishes while the page is hidden leaves the timer off:
    // nothing may be scheduled until the foreground comes back.
    this.setState(this.visible ? 'waiting' : 'off');
    this.schedule();
  }
}
