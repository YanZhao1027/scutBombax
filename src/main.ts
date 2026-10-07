import { App } from '@capacitor/app';
import * as api from './bridge';
import { AutoRefresher, type TickOutcome } from './refresh';
import { isBridgeError, type Bills, type Campus, type LoginType, type SessionInfo } from './types';
import './styles.css';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
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
  pill: $<HTMLElement>('session-pill'),
  room: $<HTMLElement>('room-name'),
  userName: $<HTMLElement>('user-name'),
  electric: $<HTMLElement>('electric-value'),
  water: $<HTMLElement>('water-value'),
  ac: $<HTMLElement>('ac-value'),
  electricUnit: $<HTMLElement>('electric-unit'),
  waterUnit: $<HTMLElement>('water-unit'),
  acUnit: $<HTMLElement>('ac-unit'),
  updatedAt: $<HTMLElement>('updated-at'),
  queryState: $<HTMLElement>('query-state'),
  queryButton: $<HTMLButtonElement>('query-button'),
  logoutButton: $<HTMLButtonElement>('logout-button'),
  resultsStatus: $<HTMLElement>('results-status'),
  choices: $<HTMLElement>('refresh-choices'),
  sessionState: $<HTMLElement>('session-state'),
  nativeLog: $<HTMLElement>('native-log'),
  refreshTokenBtn: $<HTMLButtonElement>('refresh-token-btn'),
  healthBtn: $<HTMLButtonElement>('health-btn'),
  clearBtn: $<HTMLButtonElement>('clear-btn')
};

const state = {
  session: null as SessionInfo | null,
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

const renderSession = (session: SessionInfo | null): void => {
  state.session = session;
  const authed = Boolean(session?.authenticated);
  els.pill.dataset.state = authed ? 'ok' : 'off';
  els.pill.innerHTML = `<i></i> ${authed ? '已登录' : '未登录'}`;
  els.panelResults.hidden = !authed;
  // The picker must not disagree with the session it belongs to: a restored DXC session with
  // GZIC showing would make the next login query the wrong campus.
  if (authed && session?.campus) els.campus.value = session.campus;
  els.sessionState.textContent = authed
    ? `会话：${session?.campus ?? '?'} · ${session?.name || '未命名'} · token 剩余 ${
        session && session.expiresIn >= 0 ? `${session.expiresIn}s` : '未知'
      } · refresh_token ${session?.canRefresh ? '已下发' : '无'}`
    : '会话：未登录';
  if (!authed) {
    state.bills = null;
    renderBills(null);
    refresher.stop();
    syncIntervalUi();
  }
};

const formatValue = (value: number | null): string =>
  value === null || Number.isNaN(value) ? '—' : String(value);

const renderBills = (bills: Bills | null): void => {
  state.bills = bills;
  if (!bills) {
    els.room.textContent = '宿舍';
    for (const el of [els.electric, els.water, els.ac]) el.textContent = '—';
    els.updatedAt.textContent = '等待查询';
    return;
  }
  els.room.textContent = bills.room || '未知房间';
  els.electric.textContent = formatValue(bills.electric);
  els.water.textContent = formatValue(bills.water);
  els.ac.textContent = formatValue(bills.ac);
  els.electricUnit.textContent = bills.electricUnit || '平台返回余额';
  els.waterUnit.textContent = bills.waterUnit || '平台返回余额';
  els.acUnit.textContent =
    bills.ac === null ? '该校区无空调费数据' : bills.acUnit || '平台返回余额';
  els.updatedAt.textContent = new Date(bills.updatedAt).toLocaleTimeString('zh-CN', {
    hour12: false
  });
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

/** Single entry point for querying so the UI can never overlap requests. */
const query = async (source: 'manual' | 'auto' | 'login' | 'restore'): Promise<TickOutcome> => {
  if (state.querying) return 'error';
  setBusy(true);
  try {
    const bills = await api.getBills();
    renderBills(bills);
    const health = await api.health();
    renderSession(health.session);
    setStatus(els.resultsStatus, '', 'idle');
    appendLog(`getBills → OK (${source})`);
    return 'ok';
  } catch (error) {
    if (isBridgeError(error)) {
      appendLog(`getBills → ${error.code}${error.detail ? ` [${error.detail}]` : ''}`);
      if (error.code === 'REAUTH_REQUIRED' || error.code === 'CAPTCHA_REQUIRED') {
        setStatus(els.resultsStatus, '需要重新登录或验证码校验。', 'error');
        void api.health().then((h) => renderSession(h.session)).catch(() => {});
        return 'reauth';
      }
      if (error.code === 'NETWORK') {
        setStatus(els.resultsStatus, '网络暂时不可用，稍后自动重试一次。', 'wait');
        return 'network';
      }
      if (error.code === 'CAMPUS_NETWORK_REQUIRED') {
        // The school's edge answers 403 for any off-campus source address. The
        // wording is the native layer's so the SSL VPN advice stays in one
        // place; the outcome is still 'network' because the device may move
        // back onto an allowed network, and the retry stays bounded at one.
        setStatus(els.resultsStatus, describeError(error), 'error');
        return 'network';
      }
      setStatus(els.resultsStatus, describeError(error), 'error');
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
  els.loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitLogin();
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
    appendLog(`health → ok platform=${result.platform} app=${result.appVersion}`);
    // Prefs are needed most when the user is about to log in, so apply them on both paths —
    // gating them on an existing session left the pickers on their HTML defaults after 退出.
    applyPrefs(result.session.authenticated);
    if (result.session.authenticated) {
      // A restored session is only useful if it shows something. Without this the pill says
      // 已登录 while the cards stay empty until the user thinks to press 立即刷新.
      els.captchaImage.innerHTML = '<span class="captcha-placeholder">已登录，暂不需要</span>';
      if (refresher.getIntervalMs() === 0) void query('restore');
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
