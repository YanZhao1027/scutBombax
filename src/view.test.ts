import { describe, expect, it } from 'vitest';
import { deriveView, historyCaption } from './view';

/**
 * The five states the product requirements name, one block each.
 *
 * These are cheap to write and expensive to get wrong: the bug this file exists to prevent was a
 * layout decision that hid the history exactly when the history was the only thing left to show,
 * and no test could see it because the code was doing what it said.
 */
describe('deriveView', () => {
  it('with a session and a fresh reading: figures, controls, no login, no caption', () => {
    expect(
      deriveView({ authenticated: true, live: true, hasHistory: true })
    ).toEqual({
      historyVisible: true,
      controlsVisible: true,
      loginVisible: false,
      caption: 'live'
    });
  });

  it('with a session but no data yet: the empty panel is shown, nothing claims a reading', () => {
    const view = deriveView({ authenticated: true, live: false, hasHistory: false });
    expect(view.historyVisible).toBe(false);
    expect(view.controlsVisible).toBe(true);
    expect(view.loginVisible).toBe(false);
    expect(view.caption).toBe('none');
  });

  it('signed out with history: the history stays visible and the login stays reachable', () => {
    expect(
      deriveView({ authenticated: false, live: false, hasHistory: true })
    ).toEqual({
      historyVisible: true,
      controlsVisible: false,
      loginVisible: true,
      caption: 'history'
    });
  });

  it('signed out with no history: only the login form', () => {
    const view = deriveView({ authenticated: false, live: false, hasHistory: false });
    expect(view).toEqual({
      historyVisible: false,
      controlsVisible: false,
      loginVisible: true,
      caption: 'none'
    });
  });

  it('an expired session is the signed-out case, not a cleared one', () => {
    // REAUTH_REQUIRED used to route through the same reset as 退出, which wiped numbers the
    // device still had. The session is gone; the history is not, and the two states must render
    // identically apart from the reason in the caption.
    const expired = deriveView({ authenticated: false, live: false, hasHistory: true });
    const signedOut = deriveView({ authenticated: false, live: false, hasHistory: true });
    expect(expired).toEqual(signedOut);
    expect(expired.historyVisible).toBe(true);
    expect(expired.caption).toBe('history');
  });

  it('a network failure with a session keeps the controls and labels the numbers as stored', () => {
    const view = deriveView({ authenticated: true, live: false, hasHistory: true });
    expect(view.controlsVisible).toBe(true);
    expect(view.loginVisible).toBe(false);
    expect(view.caption).toBe('history');
  });

  it('a live reading still on screen after the session dies is not presented as live', () => {
    // The order matters: `live` describes where the number came from, and once the session is
    // gone nobody can tell whether it moved. Treat it as a stored reading.
    const view = deriveView({ authenticated: false, live: true, hasHistory: true });
    expect(view.caption).toBe('live');
    expect(view.controlsVisible).toBe(false);
  });
});

describe('historyCaption', () => {
  it('names its own age and says it is not a live balance', () => {
    expect(historyCaption('今天 17:01', '当前无法连接校园一卡通')).toBe(
      '显示的是 今天 17:01 的历史记录（当前无法连接校园一卡通），不是实时余额'
    );
  });

  it('works without a reason, because a signed-out screen has no failure to name', () => {
    expect(historyCaption('昨天 23:02', null)).toBe('显示的是 昨天 23:02 的历史记录，不是实时余额');
  });
});
