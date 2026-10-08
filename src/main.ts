import { App } from '@capacitor/app';
import * as api from './bridge';
import { AutoRefresher, type TickOutcome } from './refresh';
import {
  isBridgeError,
  type Bills,
  type Campus,
  type LoginType,
  type NoticeState,
  type SessionInfo,
  type SnapshotSource
} from './types';
import './styles.css';
import { drawElectricTrend } from './trend';
import { deriveView, historyCaption } from './view';
import { formatBeijingClock, parseBeijingClock } from './snapshot-time';

/**
 * Look up an element by id, and fail loudly at module load if it is not there.
 *
 * The constraint is `Element` rather than `HTMLElement` because the trend chart needs an
 * `SVGSVGElement`, which is not an `HTMLElement`. That also means the cast cannot be a plain
 * `as T`: an `HTMLElement` does not sufficiently overlap an arbitrary `T extends Element`, and
 * `tsc --noEmit` rejects it (TS2352) — which is a build failure, not a lint nit, because
 * `pnpm build` runs the typecheck first. The double cast through `unknown` is the honest way to
 * say "the id is the contract here"; `pnpm check:dom` is what enforces it.
 */
const $ = <T extends Element>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as unknown as T;
};

const els = {
  campus: $<HTMLSelectElement>('campus'),
  loginType: $<HTMLSelectElement>('login-type'),
  username: $<HTMLInputElement>('username'),
  password: $<HTMLInputElement>('password'),
  captchaCode: $<HTMLInputElement>('captcha-code'),
  captchaImage: $<HTMLButtonElement>('captcha-image'),
  captchaRefresh: $<HTMLButtonElement>('captcha-refresh'),
  loginForm: $<HTMLFormElement>('login-form'),
  loginButton: $<HTMLButtonElement>('login-button'),
  loginStatus: $<HTMLParagraphElement>('login-status'),
  panelLogin: $<HTMLElement>('login-panel'),
  panelResults: $<HTMLElement>('results-panel'),
  historyPanel: $<HTMLElement>('history-panel'),
  pill: $<HTMLElement>('session-pill'),
  room: $<HTMLElement>('room-name'),
  userName: $<HTMLElement>('user-name'),
  electric: $<HTMLElement>('electric-value'),
  water: $<HTMLElement>('water-value'),
  ac: $<HTMLElement>('ac-value'),
  acRow: $<HTMLElement>('ac-row'),
  electricUnit: $<HTMLElement>('electric-unit'),
  waterUnit: $<HTMLElement>('water-unit'),
  acUnit: $<HTMLElement>('ac-unit'),
  updatedAt: $<HTMLElement>('updated-at'),
  queryState: $<HTMLElement>('query-state'),
  queryButton: $<HTMLButtonElement>('query-button'),
  noticeToggle: $<HTMLInputElement>('notice-toggle'),
  dailyToggle: $<HTMLInputElement>('daily-toggle'),
  dailyDue: $<HTMLElement>('daily-due'),
  dailyTime: $<HTMLInputElement>('daily-time'),
  snapshotTestButton: $<HTMLButtonElement>('snapshot-test-button'),
  snapshotTestState: $<HTMLElement>('snapshot-test-state'),
  historyNote: $<HTMLElement>('history-note'),
  trendToggle: $<HTMLButtonElement>('trend-toggle'),
  trendPanel: $<HTMLElement>('trend-panel'),
  trendSvg: $<SVGSVGElement>('trend-svg'),
  trendSummary: $<HTMLElement>('trend-summary'),
  trendSelected: $<HTMLElement>('trend-selected'),
  trendIncreases: $<HTMLUListElement>('trend-increases'),
  trendEmpty: $<HTMLElement>('trend-empty'),
  logoutButton: $<HTMLButtonElement>('logout-button'),
  resultsStatus: $<HTMLElement>('results-status'),
  choices: $<HTMLElement>('refresh-choices'),
  sessionState: $<HTMLElement>('session-state'),
  nativeLog: $<HTMLElement>('native-log'),
  refreshTokenBtn: $<HTMLButtonElement>('refresh-token-btn'),
  healthBtn: $<HTMLButtonElement>('health-btn'),
  clearBtn: $<HTMLButtonElement>('clear-btn'),
  clearHistoryBtn: $<HTMLButtonElement>('clear-history-btn')
};

const state = {
  session: null as SessionInfo | null,
  /** There is at least one stored reading on this device, live or not. */
  hasHistory: false,
  /** The figures on screen came from a query that just succeeded. */
  live: false,
  /** When the stored reading on screen was taken, so the caption can name its own age. */
  storedAt: null as number | null,
  /** Why the school could not be reached, when there is a reason to give. */
  storedReason: null as string | null,
  bills: null as Bills | null,
  captchaKey: '',
  querying: false
};

const setStatus = (
  el: HTMLElement,
  message: string,
  tone: 'idle' | 'ok' | 'wait' | 'error' = 'idle'
): void => {
  el.textContent = message;
  if (tone === 'idle') el.removeAttribute('data-tone');
  else el.setAttribute('data-tone', tone);
};

const appendLog = (line: string): void => {
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  els.nativeLog.textContent = `${stamp} ${line}\n${els.nativeLog.textContent ?? ''}`.slice(0, 4000);
};

const describeError = (error: unknown): string => {
  if (isBridgeError(error)) {
    const detail = error.detail ? ` [${error.detail}]` : '';
    return `${error.code}${detail}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
};

const campus = (): Campus => (els.campus.value === 'DXC' ? 'DXC' : 'GZIC');

/** The picker only offers the two types `frontInfo` declares; anything else is a bug, so it
 *  is sent as-is and the native layer refuses it rather than guessing. */
const loginType = (): LoginType => els.loginType.value as LoginType;

/**
 * Non-sensitive UI choices, kept so a restart does not silently change what you picked.
 *
 * This is deliberately limited to campus, login type and the refresh interval: no account, no
 * password, no token, no cookie. The key name carries no school identifier either, so the
 * `docs/DEVICE_VERIFICATION.md` §10 storage audit stays a real test rather than a tautology.
 */
const PREFS_KEY = '***';

interface Prefs {
  campus?: Campus;
  loginType?: LoginType;
  refreshMinutes?: number;
}

const readPrefs = (): Prefs => {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs;
  } catch {
    return {};
  }
};

const writePrefs = (patch: Prefs): void => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    // A blocked or full storage only costs the convenience, never the session.
  }
};

/** Re-apply the stored picks. The timer is only armed when there is a session to poll with. */
const applyPrefs = (authenticated: boolean): void => {
  const prefs = readPrefs();
  if (prefs.campus === 'GZIC' || prefs.campus === 'DXC') els.campus.value = prefs.campus;
  if (prefs.loginType === 'card' || prefs.loginType === 'sno') els.loginType.value = prefs.loginType;
  const minutes = Number(prefs.refreshMinutes);
  if (!Number.isFinite(minutes) || minutes < 0) return;
  const choice = els.choices.querySelector<HTMLInputElement>(
    `input[name="refresh"][value="${minutes}"]`
  );
  if (!choice) return;
  choice.checked = true;
  syncIntervalUi();
  if (authenticated && minutes > 0 && refresher.getIntervalMs() === 0) {
    refresher.setIntervalMinutes(minutes);
    refresher.noteQueryFinished(state.bills ? state.bills.updatedAt : 0);
  }
};

/**
 * Applies the view rule from `view.ts`: reading and trend whenever there is something to read,
 * school-facing controls only with a session, login whenever there is not.
 *
 * Every visibility change in the app goes through here. That is not tidiness — the first version
 * set these flags in three places and one of them was inside the logout path, which is how
 * signing out ended up erasing numbers the device still had.
 */
const applyView = (): void => {
  const view = deriveView({
    authenticated: Boolean(state.session?.authenticated),
    live: state.live,
    hasHistory: state.hasHistory
  });
  els.historyPanel.hidden = !view.historyVisible;
  els.panelResults.hidden = !view.controlsVisible;
  els.panelLogin.hidden = !view.loginVisible;
  // The caption is produced here rather than by each caller, because "every caller remembers to
  // label a stale reading" is exactly the kind of rule that fails silently. Anything that is not
  // a live reading says so, with its own timestamp.
  if (view.caption === 'history' && state.storedAt !== null) {
    els.historyNote.textContent = historyCaption(formatWhen(state.storedAt), state.storedReason);
    els.historyNote.hidden = false;
  } else {
    els.historyNote.hidden = true;
    els.historyNote.textContent = '';
  }
};

const renderSession = (session: SessionInfo | null): void => {
  state.session = session;
  const authed = Boolean(session?.authenticated);
  els.pill.dataset.state = authed ? 'ok' : 'off';
  els.pill.innerHTML = `<i></i> ${authed ? '已登录' : '未登录'}`;
  // The reading and the trend are not session-gated, so signing out leaves the last known
  // numbers on screen with their age; only the controls that can reach the school disappear.
  if (!authed) state.live = false;
  applyView();
  // The picker must not disagree with the session it belongs to: a restored DXC session with
  // GZIC showing would make the next login query the wrong campus.
  if (authed && session?.campus) els.campus.value = session.campus;
  els.sessionState.textContent = authed
    ? `会话：${session?.campus ?? '?'} · ${session?.name || '未命名'} · token 剩余 ${
        session && session.expiresIn >= 0 ? `${session.expiresIn}s` : '未知'
      } · refresh_token ${session?.canRefresh ? '已下发' : '无'}`
    : '会话：未登录';
  if (!authed) {
    // `state.bills` deliberately survives: it is the last thing the school actually said, and
    // clearing it here is what used to blank a screen that still had something to show.
    refresher.stop();
    syncIntervalUi();
  }
};

const formatValue = (value: number | null): string =>
  value === null || Number.isNaN(value) ? '—' : String(value);

/**
 * Pushes the latest result into the persistent notification, when the user switched it on.
 *
 * Called after every query the page makes, so a notification update normally corresponds to a
 * request the page wanted anyway. With no result yet it still starts the service, showing 更新 —:
 * a switch the user just turned on has to do something visible, otherwise the only feedback is a
 * checkbox that silently does nothing while the network is down.
 */
const syncNotice = (): void => {
  if (!els.noticeToggle.checked) return;
  const bills = state.bills;
  void api
    .startNotice({
      room: bills?.room || '宿舍',
      electric: String(bills?.electric ?? '—'),
      water: String(bills?.water ?? '—'),
      unit: bills?.electricUnit || '',
      updated: bills
        ? new Date(bills.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })
        : '—'
    })
    .then(() => api.noticeStatus().then(renderDaily))
    .catch((error) => appendLog(describeError(error)));
};

/**
 * Reflects the native daily switch.
 *
 * The checkbox is durable state in the app's own prefs, so the page reads it back rather than
 * keeping a second copy in localStorage — a second copy is how a switch ends up looking on while
 * the alarm behind it is gone.
 */
const renderDaily = (status: NoticeState): void => {
  els.dailyToggle.checked = status.dailyEnabled;
  // Enabled whenever the notification is live, armed, or simply switched on by the user. The last
  // clause is the fix for a race seen on 2026-10-08: dismissing the permission prompt fires a
  // visibility change, whose status read can land while `startNotice` is still queued behind a
  // query — and that transient `running:false` used to take the control away the moment the user
  // had earned it.
  els.dailyToggle.disabled = !(status.running || status.dailyEnabled || els.noticeToggle.checked);
  els.dailyTime.value = formatBeijingClock(status.dailyHour, status.dailyMinute);
  els.dailyDue.textContent = status.dailyEnabled
    ? `下次约 ${formatSpan(status.nextDueIn)}后`
    : '未开启';
  els.snapshotTestButton.disabled = !status.running || !state.session?.authenticated;
  els.snapshotTestButton.dataset.pending = String(status.testPending);
  els.snapshotTestButton.textContent = status.testPending
    ? '取消本次测试'
    : '约 5 分钟后测试一次';
  els.snapshotTestState.textContent = status.testPending
    ? status.testDueIn > 0
      ? `预计 ${formatSpan(status.testDueIn)}后（可能延迟）`
      : '等待系统投递'
    : '单次测试，不改变每日设置';
};

/** Coarse on purpose: an inexact alarm is a promise about a day, not about a minute. */
const formatSpan = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${Math.max(minutes, 1)} 分`;
};

/**
 * Paints a reading, and records whether it is live.
 *
 * `null` no longer wipes the figures. It used to, from inside `renderSession`, which meant that
 * losing a session — the exact moment a stored reading is worth something — blanked the screen.
 * Now `null` only means "there is nothing to paint yet", and `applyView` decides whether the
 * panel is shown at all.
 */
const renderBills = (bills: Bills | null, live = true): void => {
  if (!bills) {
    state.bills = null;
    state.live = false;
    state.storedAt = null;
    applyView();
    return;
  }
  state.bills = bills;
  state.live = live;
  state.storedAt = bills.updatedAt;
  // A reading the school just confirmed is also a row in the local store: `fetchBills` writes it
  // before it returns, so claiming history exists here is a fact rather than a hope.
  state.hasHistory = true;
  if (!els.trendPanel.hidden) void refreshTrend();
  els.room.textContent = bills.room || '未知房间';
  els.electric.textContent = formatValue(bills.electric);
  els.water.textContent = formatValue(bills.water);
  els.electricUnit.textContent = bills.electricUnit || '平台返回余额';
  els.waterUnit.textContent = bills.waterUnit || '平台返回余额';
  // The school has no air-conditioning fee item for this dormitory, so the row is removed
  // rather than shown as zero — but a campus that does return one still displays it.
  els.acRow.hidden = bills.ac === null;
  els.ac.textContent = formatValue(bills.ac);
  els.acUnit.textContent = bills.acUnit || '元';
  els.updatedAt.textContent = new Date(bills.updatedAt).toLocaleTimeString('zh-CN', {
    hour12: false
  });
  applyView();
};

let trendRange: number | 'all' = 30;
let trendRequest = 0;

/** Querying history is strictly local, unlike getBills. No chart-generated SCUT requests. */
const refreshTrend = async (): Promise<void> => {
  if (els.trendPanel.hidden) return;
  const request = ++trendRequest;
  try {
    const history = await api.electricHistory();
    if (request !== trendRequest || els.trendPanel.hidden) return;
    drawElectricTrend({
      svg: els.trendSvg,
      summary: els.trendSummary,
      selected: els.trendSelected,
      increases: els.trendIncreases,
      empty: els.trendEmpty
    }, history, trendRange);
  } catch {
    if (request === trendRequest) els.trendSummary.textContent = '本地历史暂不可用';
  }
};

const loadCaptcha = async (): Promise<void> => {
  els.captchaImage.innerHTML = '<span class="captcha-placeholder">加载中…</span>';
  try {
    const challenge = await api.getCaptcha();
    state.captchaKey = challenge.key;
    els.captchaImage.innerHTML = '';
    const img = document.createElement('img');
    img.src = challenge.image;
    img.alt = '一卡通图形验证码';
    els.captchaImage.append(img);
    els.captchaCode.value = '';
    els.captchaCode.focus({ preventScroll: true });
    setStatus(els.loginStatus, '', 'idle');
  } catch (error) {
    els.captchaImage.innerHTML = '<span class="captcha-placeholder">点击重试</span>';
    setStatus(els.loginStatus, `验证码加载失败：${describeError(error)}`, 'error');
    appendLog(describeError(error));
  }
};

const setBusy = (busy: boolean): void => {
  state.querying = busy;
  els.loginButton.disabled = busy;
  els.queryButton.disabled = busy;
  els.queryState.textContent = busy ? '查询中…' : '';
  if (!busy) els.queryState.textContent = '';
};

/** "今天 23:01" / "昨天 22:58" / "10 月 6 日 23:00" — coarse on purpose. */
const formatWhen = (millis: number): string => {
  const when = new Date(millis);
  const time = when.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(when)) / 86_400_000);
  if (days === 0) return `今天 ${time}`;
  if (days === 1) return `昨天 ${time}`;
  return `${when.getMonth() + 1} 月 ${when.getDate()} 日 ${time}`;
};

/**
 * Shows the newest stored reading when the school cannot be reached.
 *
 * The label is the point of the whole function: a balance from last night is useful, and the same
 * number presented as if it were current is not. So the note names the age and says plainly that
 * this is not a live figure, and the timestamp line keeps showing when it was actually taken.
 */
const showLastKnown = async (reason: string | null): Promise<void> => {
  try {
    const snapshot = await api.lastSnapshot();
    if (!snapshot) {
      // Nothing stored: the placeholders stay, and no caption is invented for them.
      state.hasHistory = false;
      applyView();
      return;
    }
    // A query that already succeeded owns the screen. The stored row behind it is the same
    // reading, one round trip older, and painting it would replace a live number with a stale
    // one and then have to label the result as history.
    if (state.live) return;
    state.hasHistory = true;
    state.storedReason = reason;
    renderBills(snapshot, false);
  } catch {
    // No history, or the store is unavailable: leave the empty cards rather than invent context.
    els.historyNote.hidden = true;
    els.historyNote.textContent = '';
  }
};

/** Single entry point for querying so the UI can never overlap requests. */
const query = async (source: SnapshotSource): Promise<TickOutcome> => {
  if (state.querying) return 'error';
  setBusy(true);
  try {
    const bills = await api.getBills(source);
    renderBills(bills);
    els.historyNote.hidden = true;
    els.historyNote.textContent = '';
    const health = await api.health();
    renderSession(health.session);
    setStatus(els.resultsStatus, '', 'idle');
    syncNotice();
    appendLog(`getBills → OK (${source})`);
    return 'ok';
  } catch (error) {
    if (isBridgeError(error)) {
      appendLog(`getBills → ${error.code}${error.detail ? ` [${error.detail}]` : ''}`);
      if (error.code === 'REAUTH_REQUIRED' || error.code === 'CAPTCHA_REQUIRED') {
        setStatus(els.resultsStatus, '需要重新登录或验证码校验。', 'error');
        void api.health().then((h) => renderSession(h.session)).catch(() => {});
        // A dead session does not make the last reading worthless — it is still the best estimate
        // the user has, provided the screen says when it was taken.
        void showLastKnown('登录状态已失效');
        return 'reauth';
      }
      if (error.code === 'NETWORK') {
        setStatus(els.resultsStatus, '网络暂时不可用，稍后自动重试一次。', 'wait');
        void showLastKnown('当前无法连接校园一卡通');
        return 'network';
      }
      if (error.code === 'CAMPUS_NETWORK_REQUIRED') {
        // The school's edge answers 403 for any off-campus source address. The
        // wording is the native layer's so the SSL VPN advice stays in one
        // place; the outcome is still 'network' because the device may move
        // back onto an allowed network, and the retry stays bounded at one.
        setStatus(els.resultsStatus, describeError(error), 'error');
        void showLastKnown('需要校园网或学校 SSLVPN');
        return 'network';
      }
      setStatus(els.resultsStatus, describeError(error), 'error');
      void showLastKnown('查询未成功');
      return 'error';
    }
    setStatus(els.resultsStatus, describeError(error), 'error');
    return 'error';
  } finally {
    setBusy(false);
  }
};

const refresher = new AutoRefresher(
  async () => {
    if (!state.session?.authenticated) return 'reauth';
    return query('auto');
  },
  undefined,
  (next) => {
    if (next === 'halted') {
      setStatus(els.resultsStatus, '自动刷新已暂停：需要重新登录。', 'wait');
    }
    if (next === 'waiting' || next === 'running') {
      const label = selectedIntervalLabel();
      els.queryState.textContent =
        next === 'running' ? '查询中…' : `自动刷新：${label}`;
    }
    if (next === 'off' && !state.querying) els.queryState.textContent = '';
  }
);

const selectedIntervalLabel = (): string => {
  const checked = els.choices.querySelector<HTMLInputElement>('input[name="refresh"]:checked');
  const minutes = Number(checked?.value ?? '0');
  return minutes === 0 ? '关闭' : `${minutes} 分钟`;
};

const syncIntervalUi = (): void => {
  const checked = els.choices.querySelector<HTMLInputElement>('input[name="refresh"]:checked');
  if (checked && Number(checked.value) === 0) els.queryState.textContent = '';
};

const submitLogin = async (): Promise<void> => {
  const username = els.username.value.trim();
  const password = els.password.value;
  const captchaCode = els.captchaCode.value.trim();
  if (!username || !password) {
    setStatus(els.loginStatus, '请填写账号和密码。', 'error');
    return;
  }
  if (state.querying) return;
  setStatus(els.loginStatus, '登录中…', 'wait');
  els.loginButton.disabled = true;
  try {
    const session = await api.login({
      username,
      password,
      campus: campus(),
      loginType: loginType(),
      captchaKey: state.captchaKey || undefined,
      captchaCode: captchaCode || undefined
    });
    els.password.value = '';
    renderSession(session);
    writePrefs({ campus: campus(), loginType: loginType() });
    // A stored interval only becomes meaningful once there is a session to poll with.
    applyPrefs(true);
    setStatus(els.loginStatus, '登录成功。', 'ok');
    appendLog(`login → OK (${session.campus})`);
    // A re-login clears the condition that halted the timer, so re-arm it here;
    // `query` is still the only funnel, so this can never overlap the query below.
    if (refresher.getState() === 'halted') refresher.resume();
    await query('login');
    if (refresher.getIntervalMs() > 0) refresher.noteQueryFinished();
  } catch (error) {
    appendLog(describeError(error));
    if (isBridgeError(error) && (error.code === 'CAPTCHA_REQUIRED' || error.code === 'CAPTCHA_INVALID')) {
      setStatus(els.loginStatus, '验证码不正确或已过期，已为你换一张。', 'error');
      void loadCaptcha();
    } else if (isBridgeError(error) && error.code === 'INVALID_CREDENTIALS') {
      setStatus(els.loginStatus, '账号或密码不正确。', 'error');
      void loadCaptcha();
    } else {
      setStatus(els.loginStatus, describeError(error), 'error');
    }
  } finally {
    els.loginButton.disabled = false;
  }
};

const clearSession = async (notify: boolean): Promise<void> => {
  refresher.stop();
  // A balance that is no longer being refreshed must not stay on the shade, and a session that is
  // gone must not keep a daily alarm that would only wake something with nothing to query.
  els.noticeToggle.checked = false;
  els.dailyToggle.checked = false;
  els.dailyToggle.disabled = true;
  els.dailyDue.textContent = '未开启';
  void api.stopNotice().catch(() => undefined);
  try {
    const session = await api.logout();
    renderSession(session);
  } catch (error) {
    appendLog(describeError(error));
    renderSession(null);
  }
  els.captchaCode.value = '';
  syncIntervalUi();
  if (notify) setStatus(els.resultsStatus, '登录状态已清除。', 'ok');
};

const wire = (): void => {
  els.trendToggle.addEventListener('click', () => {
    const opening = els.trendPanel.hidden;
    els.trendPanel.hidden = !opening;
    els.trendToggle.setAttribute('aria-expanded', String(opening));
    els.trendToggle.textContent = opening ? '收起电费趋势 ↑' : '查看电费趋势 →';
    if (opening) void refreshTrend();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-trend-range]').forEach(button => {
    button.addEventListener('click', () => {
      trendRange = button.dataset.trendRange === 'all' ? 'all' : Number(button.dataset.trendRange);
      document.querySelectorAll<HTMLButtonElement>('[data-trend-range]').forEach(item => {
        item.setAttribute('aria-pressed', String(item === button));
      });
      void refreshTrend();
    });
  });
  els.loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitLogin();
  });
  els.noticeToggle.addEventListener('change', () => {
    void (async () => {
      if (!els.noticeToggle.checked) {
        // Native stopNotice takes the daily alarm with it; reflect that instead of leaving a
        // switch on that no longer does anything.
        const status = await api.stopNotice().catch(() => null);
        if (status) renderDaily(status);
        else {
          els.dailyToggle.checked = false;
          els.dailyToggle.disabled = true;
          els.dailyDue.textContent = '未开启';
        }
        setStatus(els.resultsStatus, '常驻通知已关闭，每日余额快照同时关闭。', 'idle');
        return;
      }
      let status = await api.noticeStatus().catch(() => null);
      if (!status?.granted || !status?.enabled) {
        // Android 13+ needs a runtime grant; the first toggle asks instead of failing quietly.
        status = await api.requestNoticePermission().catch(() => null);
      }
      if (!status?.granted || !status?.enabled) {
        els.noticeToggle.checked = false;
        setStatus(els.resultsStatus, '通知权限未授予，无法开启常驻通知。', 'error');
        return;
      }
      syncNotice();
      els.dailyToggle.disabled = false;
      void api.noticeStatus().then(renderDaily).catch(() => undefined);
      setStatus(els.resultsStatus, '常驻通知已开启（余额仍只在前台查询时更新）。', 'ok');
    })();
  });

  els.dailyTime.addEventListener('change', () => {
    const time = parseBeijingClock(els.dailyTime.value);
    if (!time) {
      setStatus(els.resultsStatus, '请选择有效的时间。', 'error');
      void api.noticeStatus().then(renderDaily).catch(() => undefined);
      return;
    }
    els.dailyTime.disabled = true;
    void api.setDailyTime(time.hour, time.minute)
      .then((status) => {
        renderDaily(status);
        setStatus(els.resultsStatus, `每日快照时间已设为 ${formatBeijingClock(time.hour, time.minute)}（北京时间）。`, 'ok');
      })
      .catch((error) => {
        setStatus(els.resultsStatus, describeError(error), 'error');
        void api.noticeStatus().then(renderDaily).catch(() => undefined);
      })
      .finally(() => { els.dailyTime.disabled = false; });
  });

  els.snapshotTestButton.addEventListener('click', () => {
    const cancel = els.snapshotTestButton.dataset.pending === 'true';
    els.snapshotTestButton.disabled = true;
    const operation = cancel ? api.cancelSnapshotTest() : api.scheduleSnapshotTest();
    void operation.then((status) => {
      renderDaily(status);
      setStatus(
        els.resultsStatus,
        cancel ? '本次测试已取消。' : '已安排约 5 分钟后测试一次（可能延迟）。',
        'ok'
      );
    }).catch((error) => {
      setStatus(els.resultsStatus, describeError(error), 'error');
    }).finally(() => {
      void api.noticeStatus().then(renderDaily).catch(() => undefined);
    });
  });

  els.dailyToggle.addEventListener('change', () => {
    void (async () => {
      if (!els.noticeToggle.checked) {
        els.dailyToggle.checked = false;
        setStatus(els.resultsStatus, '每日余额快照需要先开启常驻通知。', 'error');
        return;
      }
      try {
        const status = els.dailyToggle.checked ? await api.enableDaily() : await api.disableDaily();
        renderDaily(status);
        setStatus(
          els.resultsStatus,
          status.dailyEnabled
            ? `每日快照已开启，${els.dailyDue.textContent}。`
            : '每日余额快照已关闭。',
          status.dailyEnabled ? 'ok' : 'idle'
        );
      } catch (error) {
        // The native side refused (no session, no permission, no alarm) — say so rather than
        // leaving the switch looking armed.
        els.dailyToggle.checked = false;
        els.dailyDue.textContent = '未开启';
        setStatus(els.resultsStatus, describeError(error), 'error');
      }
    })();
  });

  els.captchaImage.addEventListener('click', () => void loadCaptcha());
  els.captchaRefresh.addEventListener('click', () => void loadCaptcha());
  els.queryButton.addEventListener('click', () => {
    void (async () => {
      const outcome = await query('manual');
      if (outcome === 'ok') refresher.noteQueryFinished();
    })();
  });
  els.logoutButton.addEventListener('click', () => void clearSession(true));
  // Separate from 退出, and it asks. Losing a session should not cost someone weeks of readings,
  // and losing readings should not be a single careless tap either.
  els.clearHistoryBtn.addEventListener('click', () => {
    void (async () => {
      const sure = window.confirm('将删除本机保存的全部余额历史与趋势，登录状态不受影响。确定吗？');
      if (!sure) return;
      try {
        const { deleted } = await api.clearHistory();
        state.hasHistory = false;
        state.live = false;
        renderBills(null);
        if (!els.trendPanel.hidden) void refreshTrend();
        setStatus(els.resultsStatus, `本机历史已清除（${deleted} 条）。`, 'ok');
      } catch (error) {
        setStatus(els.resultsStatus, describeError(error), 'error');
      }
    })();
  });
  els.clearBtn.addEventListener('click', () => void clearSession(true));
  els.healthBtn.addEventListener('click', () => {
    void api
      .health()
      .then((result) => {
        renderSession(result.session);
        applyPrefs(result.session.authenticated);
        appendLog(
          `health → ok platform=${result.platform} app=${result.appVersion} bridge=${result.bridgeVersion}`
        );
      })
      .catch((error) => appendLog(describeError(error)));
  });
  els.refreshTokenBtn.addEventListener('click', () => {
    els.refreshTokenBtn.disabled = true;
    void api
      .refreshSession()
      .then((result) => {
        renderSession(result.session);
        appendLog(
          result.refreshed
            ? 'refresh_token → OK（会话已更新）'
            : `refresh_token → 未刷新${result.error ? ` (${result.error})` : ''}`
        );
        setStatus(
          els.resultsStatus,
          result.refreshed ? 'token 刷新成功。' : '学校端不接受 token 刷新，token 到期后请重新登录。',
          result.refreshed ? 'ok' : 'error'
        );
        if (!result.refreshed) void loadCaptcha();
      })
      .catch((error) => {
        appendLog(describeError(error));
        setStatus(els.resultsStatus, describeError(error), 'error');
      })
      .finally(() => {
        els.refreshTokenBtn.disabled = false;
      });
  });
  els.choices.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name !== 'refresh') return;
    const minutes = Number(input.value);
    writePrefs({ refreshMinutes: minutes });
    refresher.setIntervalMinutes(minutes);
    els.queryState.textContent = minutes === 0 ? '' : `自动刷新：${selectedIntervalLabel()}`;
    setStatus(
      els.resultsStatus,
      minutes === 0 ? '自动刷新已关闭。' : `已选择 ${minutes} 分钟自动刷新（仅前台）。`,
      'idle'
    );
    // Turning the timer on right away should not fire a query by itself unless
    // the last result is already older than the chosen interval.
    if (minutes > 0) refresher.noteQueryFinished(state.bills ? state.bills.updatedAt : 0);
  });

  // Visibility is the only scheduler input. AutoRefresher owns the "came back
  // and the interval elapsed → query once" rule, so the page never starts a
  // second query on top of the scheduled one.
  const applyVisibility = (visible: boolean): void => {
    refresher.setVisible(visible);
    // The next-wake hint is a fact about the alarm, not about this page, and the alarm can fire
    // while nobody is looking. Re-read it on the way back in so the row cannot keep claiming
    // "下次约 1 分后" a day later.
    if (visible) void api.noticeStatus().then(renderDaily).catch(() => undefined);
  };

  document.addEventListener('visibilitychange', () => {
    applyVisibility(document.visibilityState === 'visible');
  });

  void App.addListener('appStateChange', ({ isActive }) => {
    applyVisibility(isActive);
  }).catch(() => {
    // Web preview has no native lifecycle; visibilitychange is enough there.
  });

  void App.addListener('pause', () => applyVisibility(false)).catch(() => {});
  void App.addListener('resume', () => applyVisibility(true)).catch(() => {});
};

const boot = async (): Promise<void> => {
  wire();
  try {
    const result = await api.health();
    renderSession(result.session);
    // The stored reading is a local read, so it runs on every start — signed out is precisely
    // the state where it is the only thing worth showing. No school request is involved, and a
    // query that later succeeds replaces it with a live reading.
    void showLastKnown(null);
    // Reflect a service the OS may still be holding on to, rather than showing an off switch
    // next to a live notification. A still-armed daily alarm implies one too: waking that service
    // is the only thing the alarm does.
    void api
      .noticeStatus()
      .then((status) => {
        els.noticeToggle.checked = status.running || status.dailyEnabled;
        renderDaily(status);
        // A daily alarm can only wake a service that is already running — measured on the device
        // on 2026-10-08: with the notice stopped, the inexact alarm fired and Android answered
        // `BackgroundServiceStartNotAllowedException`. So a switch that implies a notification has
        // to leave one standing, and this is the one moment we know for sure we are in the
        // foreground and allowed to start it.
        if (els.noticeToggle.checked && !status.running) syncNotice();
      })
      .catch(() => undefined);
    appendLog(`health → ok platform=${result.platform} app=${result.appVersion}`);
    // Prefs are needed most when the user is about to log in, so apply them on both paths —
    // gating them on an existing session left the pickers on their HTML defaults after 退出.
    applyPrefs(result.session.authenticated);
    if (result.session.authenticated) {
      // A restored session is only useful if it shows something. Without this the pill says
      // 已登录 while the cards stay empty until the user thinks to press 立即刷新.
      els.captchaImage.innerHTML = '<span class="captcha-placeholder">已登录，暂不需要</span>';
      // Always query on a restored session. Gating this on the timer looked reasonable but was
      // wrong twice over: a stored interval arms the timer while the page may still report
      // itself hidden (so the timer refuses to fire), and nothing else produced the first query
      // — the pill said 已登录 over empty cards again. The single-flight guard in query() keeps
      // this from overlapping any scheduled tick, and noting the finish pushes the next tick a
      // full interval away.
      void query('restore').then(() => {
        if (refresher.getIntervalMs() > 0) refresher.noteQueryFinished();
      });
    } else {
      void loadCaptcha();
    }
  } catch (error) {
    appendLog(describeError(error));
    setStatus(els.loginStatus, '原生桥不可用，请在 Android 设备上运行。', 'error');
    // No captcha request was ever issued on this path, so the tile must not keep
    // claiming it is still loading.
    els.captchaImage.innerHTML = '<span class="captcha-placeholder">不可用</span>';
  }
};

void boot();
