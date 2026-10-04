import { registerPlugin } from '@capacitor/core';
import type {
  Bills,
  BridgeError,
  CaptchaChallenge,
  HealthResult,
  LoginInput,
  RefreshResult,
  ScutErrorCode,
  SessionInfo
} from './types';
import { BridgeError as BridgeErrorClass } from './types';

/**
 * The only JS surface allowed to talk to SCUT — and it does so by handing the
 * work to native Kotlin. Nothing in this file may call fetch() against a school
 * host; the WebView is blocked by CORS there by design.
 */
interface ScutApiNativePlugin {
  health(): Promise<HealthResult>;
  getCaptcha(): Promise<CaptchaChallenge>;
  login(input: LoginInput): Promise<SessionInfo>;
  getBills(): Promise<Bills>;
  refreshSession(): Promise<RefreshResult>;
  logout(): Promise<SessionInfo>;
}

const ScutApi = registerPlugin<ScutApiNativePlugin>('ScutApi');

const KNOWN_CODES: ScutErrorCode[] = [
  'CAPTCHA_REQUIRED',
  'CAPTCHA_INVALID',
  'INVALID_CREDENTIALS',
  'REAUTH_REQUIRED',
  'UPSTREAM_UNAVAILABLE',
  'PROTOCOL_CHANGED',
  'NO_SESSION',
  'BUSY',
  'INVALID_INPUT',
  'NETWORK',
  'CAMPUS_NETWORK_REQUIRED'
];

/**
 * What a native rejection actually looks like.
 *
 * Capacitor serialises `call.reject(msg, code, ex, data)` as
 * `{ message, code, data }` and the injected native-bridge copies those keys
 * onto an Error object, so the redacted `detail` we put into `data` arrives
 * nested — reading `raw.detail` alone would silently drop every diagnostic.
 */
type RawBridgeError = {
  message?: unknown;
  code?: unknown;
  detail?: unknown;
  data?: { detail?: unknown } | null;
};

const detailOf = (raw: RawBridgeError): string | undefined => {
  const nested = raw?.data && typeof raw.data === 'object' ? raw.data.detail : undefined;
  const candidate = typeof nested === 'string' ? nested : raw?.detail;
  return typeof candidate === 'string' && candidate ? candidate : undefined;
};

const normalize = (cause: unknown): BridgeError => {
  if (cause instanceof BridgeErrorClass) return cause;
  const raw = (cause ?? {}) as RawBridgeError;
  const code = KNOWN_CODES.includes(raw?.code as ScutErrorCode)
    ? (raw.code as ScutErrorCode)
    : 'UPSTREAM_UNAVAILABLE';
  const message =
    typeof raw?.message === 'string' && raw.message ? raw.message : '原生请求不可用';
  return new BridgeErrorClass(code, message, detailOf(raw));
};

const call = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (cause) {
    throw normalize(cause);
  }
};

export const health = (): Promise<HealthResult> => call(() => ScutApi.health());

export const getCaptcha = (): Promise<CaptchaChallenge> => call(() => ScutApi.getCaptcha());

export const login = (input: LoginInput): Promise<SessionInfo> => call(() => ScutApi.login(input));

export const getBills = (): Promise<Bills> => call(() => ScutApi.getBills());

export const refreshSession = (): Promise<RefreshResult> => call(() => ScutApi.refreshSession());

export const logout = (): Promise<SessionInfo> => call(() => ScutApi.logout());
