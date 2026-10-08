export type Campus = 'GZIC' | 'DXC';

/**
 * Which of the school's card login types the account belongs to, as `frontInfo` names them:
 * `card` = 账号登录 (a campus-card account), `sno` = 学工号登录 (a student/staff number).
 * Sending the wrong one is answered `code=8000`, i.e. indistinguishable from a wrong
 * password, so it is an explicit user choice rather than a guess.
 */
export type LoginType = 'card' | 'sno';

/** Stable app-level errors. Raw upstream text never crosses the bridge. */
export type ScutErrorCode =
  | 'CAPTCHA_REQUIRED'
  | 'CAPTCHA_INVALID'
  | 'INVALID_CREDENTIALS'
  | 'REAUTH_REQUIRED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'PROTOCOL_CHANGED'
  | 'NO_SESSION'
  | 'BUSY'
  | 'INVALID_INPUT'
  | 'NETWORK'
  | 'CAMPUS_NETWORK_REQUIRED';

export class BridgeError extends Error {
  constructor(
    readonly code: ScutErrorCode,
    message: string,
    /** Redacted upstream signal (HTTP status or service code), never a body. */
    readonly detail?: string
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}

export const isBridgeError = (value: unknown): value is BridgeError =>
  value instanceof BridgeError;

export interface CaptchaChallenge {
  key: string;
  /** data: URL ready for an <img src>. */
  image: string;
}

export interface SessionInfo {
  authenticated: boolean;
  campus: Campus | null;
  /** Display name from the card system, empty when unavailable. */
  name: string;
  /** Seconds until the current access token expires; -1 when unknown. */
  expiresIn: number;
  /** Whether SCUT handed back a usable refresh token at login. */
  canRefresh: boolean;
}

export interface Bills {
  campus: Campus;
  room: string;
  electric: number;
  water: number;
  /** null when the campus has no air-conditioning fee item. */
  ac: number | null;
  /** Raw unit text observed from upstream, kept for semantics verification. */
  electricUnit: string;
  waterUnit: string;
  acUnit: string;
  /** Epoch millis on the device. */
  updatedAt: number;
}

/** Why a balance was queried — recorded with the snapshot so a daily series can be isolated. */
export type SnapshotSource = 'manual' | 'auto' | 'login' | 'restore' | 'nightly' | 'test' | 'unknown';

/** A stored reading: `Bills`, plus the reason it exists. */
export interface Snapshot extends Bills {
  source: SnapshotSource;
}

export interface LoginInput {
  username: string;
  password: string;
  campus: Campus;
  /** Omitted by older callers; the native layer rejects an unknown value. */
  loginType?: LoginType;
  captchaKey?: string;
  captchaCode?: string;
}

/**
 * State of the opt-in persistent balance notification, and of the daily refresh that can sit on
 * top of it. Both are off by default; the daily switch only has meaning while the notice is on,
 * because the notice's service is the only thing the alarm is allowed to wake.
 */
export interface NoticeState {
  /** POST_NOTIFICATIONS granted (always true below Android 13). */
  granted: boolean;
  /** Notifications are not switched off for the app at the system level. */
  enabled: boolean;
  running: boolean;
  /** Whether the once-a-day background refresh is armed. */
  dailyEnabled: boolean;
  /** Seconds until the next planned wake; -1 when the daily switch is off. */
  nextDueIn: number;
  /** User-selected Beijing wall-clock time, stored natively. */
  dailyHour: number;
  dailyMinute: number;
  /** One-off inexact verification alarm, independent of the daily setting. */
  testPending: boolean;
  testDueIn: number;
}

export interface NoticePayload {
  room: string;
  electric: string;
  water: string;
  unit: string;
  updated: string;
}

export interface HealthResult {
  ok: boolean;
  platform: string;
  appVersion: string;
  bridgeVersion: string;
  session: SessionInfo;
}

export interface RefreshResult {
  refreshed: boolean;
  session: SessionInfo;
  /** Present only when the refresh failed, so the UI can require relogin. */
  error?: ScutErrorCode;
}

export interface NativeLogLine {
  /** Redirect/auth stage name, e.g. "dxc.thirdLogin". */
  stage: string;
  method: string;
  host: string;
  path: string;
  status: number;
  elapsedMs: number;
  /** Non-sensitive service code from an upstream JSON body. */
  serviceCode?: string;
}

/** Read-only, local electricity history; never includes room, account or token. */
export interface ElectricHistoryPoint {
  updatedAt: number;
  electric: number | null;
  source: SnapshotSource;
}

export interface ElectricHistory {
  campus: Campus | null;
  /** Unit may be unknown, especially outside the DXC user-verified field. */
  unit: string;
  points: ElectricHistoryPoint[];
}
