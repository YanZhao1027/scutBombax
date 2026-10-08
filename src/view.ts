/**
 * Which parts of the screen exist right now, as a pure function of three facts.
 *
 * This module exists because the first version of the history feature put the balance figures and
 * the trend chart inside the panel that is hidden when there is no session — so the exact moment
 * the history was most useful (network down, session expired, signed out) was the moment it could
 * not be seen. The rule that fixes it is short enough to state once here and test directly, rather
 * than being spread across five `hidden =` assignments in the wiring.
 *
 * Nothing in here touches the DOM or the bridge: no view decision may cost a school request, and
 * a pure function is how that stays true.
 */

export interface ViewFacts {
  /** A live SCUT session is held — the only thing that can query, refresh or arm a snapshot. */
  authenticated: boolean;
  /** The figures currently painted came from a query that just succeeded. */
  live: boolean;
  /** There is at least one stored reading on this device. */
  hasHistory: boolean;
}

export interface View {
  /** The balance display and the trend. Visible whenever there is something to display. */
  historyVisible: boolean;
  /** Query button, auto-refresh, notification and nightly switches, logout. Session-only. */
  controlsVisible: boolean;
  /** The login form. Hidden while a session is live. */
  loginVisible: boolean;
  /**
   * How the displayed numbers must be described: `live` may say nothing, `history` must name its
   * own age, and `none` means the placeholders are showing and nothing should claim a reading.
   */
  caption: 'live' | 'history' | 'none';
}

export function deriveView(facts: ViewFacts): View {
  const hasSomethingToRead = facts.live || facts.hasHistory;
  return {
    historyVisible: hasSomethingToRead,
    controlsVisible: facts.authenticated,
    loginVisible: !facts.authenticated,
    // A live reading wins the label. Once it is gone, anything still on screen is a stored
    // reading and has to say so — that asymmetry is the whole point of the caption.
    caption: facts.live ? 'live' : hasSomethingToRead ? 'history' : 'none'
  };
}

/**
 * The caption text for a stored reading. Kept here so the wording is one string in one place:
 * "not a live balance" is the claim the product must never let slide.
 */
export function historyCaption(when: string, reason: string | null): string {
  const why = reason ? `（${reason}）` : '';
  return `显示的是 ${when} 的历史记录${why}，不是实时余额`;
}
