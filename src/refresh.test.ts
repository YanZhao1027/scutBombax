import { describe, expect, it } from 'vitest';
import {
  AutoRefresher,
  MINUTES_TO_MS,
  RETRY_BACKOFF_MS,
  nextDelayMs,
  type AutoRefreshState,
  type TickOutcome,
  type TimerHost
} from './refresh';

/**
 * A deterministic clock + timer queue. The whole point of the foreground policy
 * is that it never polls when it should not, so these tests drive time by hand
 * instead of waiting on real timers.
 */
class FakeHost implements TimerHost {
  time = 1_000_000;
  private seq = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): number {
    const id = this.seq++;
    this.timers.set(id, { at: this.time + ms, callback });
    return id;
  }

  clearTimeout(id: number): void {
    this.timers.delete(id);
  }

  now(): number {
    return this.time;
  }

  /** Delays of the still-pending timers, relative to the fake clock. */
  get pending(): number[] {
    return [...this.timers.values()].map((t) => t.at - this.time).sort((a, b) => a - b);
  }

  get timerCount(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    this.time += ms;
    for (let guard = 0; guard < 64; guard++) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= this.time);
      if (due.length === 0) return;
      due.sort((a, b) => a[1].at - b[1].at);
      for (const [id, timer] of due) {
        this.timers.delete(id);
        timer.callback();
      }
    }
    throw new Error('timer cascade too long');
  }
}

/** Lets the promise chain started by a tick settle. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

class Harness {
  readonly host = new FakeHost();
  readonly states: AutoRefreshState[] = [];
  calls = 0;
  outcomes: TickOutcome[] = [];
  /** When true a tick parks inside `run` until `release()` is called. */
  blocking = false;
  private releaser: (() => void) | null = null;

  constructor(initial: TickOutcome[] = ['ok']) {
    this.outcomes = initial;
  }

  private nextOutcome(): TickOutcome {
    return this.outcomes.length > 1 ? (this.outcomes.shift() as TickOutcome) : this.outcomes[0];
  }

  start(): AutoRefresher {
    return new AutoRefresher(
      async () => {
        this.calls++;
        if (this.blocking) {
          await new Promise<void>((resolve) => {
            this.releaser = resolve;
          });
        }
        return this.nextOutcome();
      },
      this.host,
      (state) => this.states.push(state)
    );
  }

  /** Unblocks a pending tick so tests can observe the in-flight state. */
  release(): void {
    const resolve = this.releaser;
    this.releaser = null;
    resolve?.();
  }
}

describe('nextDelayMs', () => {
  it('returns null when the timer is off', () => {
    expect(nextDelayMs(0, 1000, 2000, false)).toBeNull();
  });

  it('fires immediately when asked or when the interval already elapsed', () => {
    expect(nextDelayMs(MINUTES_TO_MS(5), 0, 123, true)).toBe(0);
    expect(nextDelayMs(1000, 0, 5000, false)).toBe(0);
  });

  it('waits out the remaining interval otherwise', () => {
    const interval = MINUTES_TO_MS(5);
    expect(nextDelayMs(interval, 1_000, 1_000 + interval - 400, false)).toBe(400);
  });
});

describe('AutoRefresher', () => {
  it('is off until an interval is chosen, and never runs when off', () => {
    const h = new Harness();
    const refresher = h.start();
    expect(refresher.getState()).toBe('off');
    h.host.advance(MINUTES_TO_MS(60));
    expect(h.calls).toBe(0);

    refresher.setIntervalMinutes(0);
    expect(refresher.getState()).toBe('off');
    expect(h.host.timerCount).toBe(0);
  });

  it('queries once right away when turned on with no previous result', () => {
    const h = new Harness();
    const refresher = h.start();
    refresher.setIntervalMinutes(5);
    expect(refresher.getState()).toBe('waiting');
    expect(h.host.pending).toEqual([0]);

    h.host.advance(0);
    expect(h.calls).toBe(1);
    expect(refresher.getState()).toBe('running');
  });

  it('returns to waiting and re-arms a full interval after a good query', async () => {
    const h = new Harness();
    const refresher = h.start();
    refresher.setIntervalMinutes(10);
    h.host.advance(0);
    await flush();
    expect(refresher.getState()).toBe('waiting');
    expect(h.host.pending).toEqual([MINUTES_TO_MS(10)]);

    h.host.advance(MINUTES_TO_MS(10) - 1);
    expect(h.calls).toBe(1);
    h.host.advance(1);
    await flush();
    expect(h.calls).toBe(2);
    // off → waiting → running → waiting → running → waiting
    expect(h.states).toEqual([
      'waiting',
      'running',
      'waiting',
      'running',
      'waiting'
    ]);
  });

  it('keeps at most one query in flight', async () => {
    const h = new Harness(['ok', 'ok']);
    h.blocking = true;
    const refresher = h.start();
    refresher.setIntervalMinutes(5);
    h.host.advance(0);
    expect(h.calls).toBe(1);

    // Re-arming the schedule while the first request is still pending must not
    // overlap it, and the swallowed tick must not queue up either.
    refresher.setIntervalMinutes(1);
    h.host.advance(0);
    expect(h.calls).toBe(1);

    h.release();
    await flush();
    expect(h.calls).toBe(1);
    expect(h.host.pending).toEqual([MINUTES_TO_MS(1)]);
  });

  it('stops all polling when the page or app leaves the foreground', async () => {
    const h = new Harness();
    const refresher = h.start();
    refresher.setIntervalMinutes(5);
    h.host.advance(0);
    expect(h.calls).toBe(1);

    refresher.setVisible(false);
    expect(h.host.timerCount).toBe(0);
    await flush();
    expect(refresher.getState()).toBe('off');
    h.host.advance(MINUTES_TO_MS(30));
    expect(h.calls).toBe(1);
    expect(h.host.timerCount).toBe(0);
  });

  it('does not fire on return to foreground while the interval is still young', async () => {
    const h = new Harness();
    const refresher = h.start();
    refresher.setIntervalMinutes(5);
    h.host.advance(0);
    await flush();
    refresher.noteQueryFinished(h.host.now());
    refresher.setVisible(false);

    refresher.setVisible(true);
    expect(h.host.pending).toEqual([MINUTES_TO_MS(5)]);
    h.host.advance(MINUTES_TO_MS(4));
    expect(h.calls).toBe(1);
  });

  it('queries once when the foreground returns after the interval elapsed', async () => {
    const h = new Harness();
    const refresher = h.start();
    refresher.setIntervalMinutes(5);
    h.host.advance(0);
    await flush();
    expect(h.calls).toBe(1);
    refresher.noteQueryFinished(h.host.now());
    refresher.setVisible(false);

    h.host.advance(MINUTES_TO_MS(7));
    refresher.setVisible(true);
    expect(h.host.pending).toEqual([0]);
    h.host.advance(0);
    await flush();
    expect(h.calls).toBe(2);
  });

  it('halts on a captcha/reauth condition and stays halted', async () => {
    const h = new Harness(['reauth']);
    const refresher = h.start();
    refresher.setIntervalMinutes(5);
    h.host.advance(0);
    await flush();
    expect(refresher.getState()).toBe('halted');

    h.host.advance(MINUTES_TO_MS(60));
    expect(h.calls).toBe(1);

    // Visibility changes must not resurrect a halted timer.
    refresher.setVisible(false);
    refresher.setVisible(true);
    h.host.advance(MINUTES_TO_MS(60));
    await flush();
    expect(h.calls).toBe(1);
    expect(refresher.getState()).toBe('halted');
  });

  it('re-arms after a successful reauthentication', async () => {
    const h = new Harness(['reauth', 'ok']);
    const refresher = h.start();
    refresher.setIntervalMinutes(5);
    h.host.advance(0);
    await flush();
    expect(refresher.getState()).toBe('halted');

    refresher.resume();
    expect(refresher.getState()).toBe('waiting');
    // Resume respects the interval: a re-login normally queries on its own.
    expect(h.host.pending).toEqual([MINUTES_TO_MS(5)]);
    h.host.advance(MINUTES_TO_MS(5));
    await flush();
    expect(h.calls).toBe(2);
    expect(refresher.getState()).toBe('waiting');
  });

  it('retries a transient network failure exactly once, after a short backoff', async () => {
    const h = new Harness(['network', 'network', 'ok']);
    const refresher = h.start();
    refresher.setIntervalMinutes(5);

    h.host.advance(0);
    await flush();
    expect(refresher.getState()).toBe('waiting');
    expect(h.host.pending).toEqual([RETRY_BACKOFF_MS]);

    h.host.advance(RETRY_BACKOFF_MS);
    await flush();
    expect(h.calls).toBe(2);
    // The second failure does not open a second retry; the plan resumes.
    expect(h.host.pending).toEqual([MINUTES_TO_MS(5)]);

    h.host.advance(MINUTES_TO_MS(5));
    await flush();
    expect(h.calls).toBe(3);
    expect(refresher.getState()).toBe('waiting');
    expect(h.host.pending).toEqual([MINUTES_TO_MS(5)]);
  });

  it('gives up retries when the app is backgrounded mid-failure', async () => {
    const h = new Harness(['network']);
    const refresher = h.start();
    refresher.setIntervalMinutes(5);
    h.host.advance(0);
    await flush();
    expect(h.host.pending).toEqual([RETRY_BACKOFF_MS]);

    refresher.setVisible(false);
    expect(h.host.timerCount).toBe(0);
    h.host.advance(MINUTES_TO_MS(10));
    expect(h.calls).toBe(1);
  });

  it('pushes the schedule back after a manual query', () => {
    const h = new Harness();
    const refresher = h.start();
    refresher.setIntervalMinutes(5);
    expect(h.host.pending).toEqual([0]);
    // A query that just finished resets the window instead of firing again.
    refresher.noteQueryFinished(h.host.now());
    expect(h.host.pending).toEqual([MINUTES_TO_MS(5)]);
    h.host.advance(MINUTES_TO_MS(4));
    expect(h.calls).toBe(0);
  });
});
