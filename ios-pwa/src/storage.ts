/**
 * PWA data stays in the browser's origin-scoped IndexedDB.
 * We intentionally store no campus-card account, password, room, token or cookie.
 * The Cloudflare Worker is a static host, not a login or billing API.
 */
export type ReadingSource = 'manual' | 'import';
export interface Reading {
  updatedAt: number;
  electric: number;
  water: number | null;
  source: ReadingSource;
}
export interface HistoryBackup {
  format: 'bombax-pwa-local-history';
  version: 1;
  exportedAt: number;
  points: Reading[];
}

const DB = 'huagongmumian-pwa-history-v1';
const STORE = 'readings';
export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_RECORDS = 1000;
const EARLIEST = Date.UTC(2020, 0, 1);
const FUTURE_SKEW_MS = 7 * 86400_000;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validMoney(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) &&
    value >= 0 && value <= 1_000_000 &&
    Math.round(value * 100) / 100 === value;
}

export function parseManualMoney(text: string): number | null {
  const v = text.trim();
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(v)) return null;
  const num = Number(v);
  return validMoney(num) ? num : null;
}

export function validateReading(value: unknown, now = Date.now()): Reading {
  if (!object(value) ||
    !hasOnlyKeys(value, ['updatedAt', 'electric', 'water', 'source'])) {
    throw new Error('记录格式不受支持');
  }
  if (typeof value.updatedAt !== 'number' ||
    !Number.isSafeInteger(value.updatedAt) ||
    value.updatedAt < EARLIEST || value.updatedAt > now + FUTURE_SKEW_MS) {
    throw new Error('记录时间无效');
  }
  if (!validMoney(value.electric) ||
      !(value.water === null || validMoney(value.water))) {
    throw new Error('金额必须是有效的非负两位小数');
  }
  if (value.source !== 'manual' && value.source !== 'import') {
    throw new Error('记录来源不受支持');
  }
  return {
    updatedAt: value.updatedAt,
    electric: value.electric,
    water: value.water,
    source: value.source,
  };
}

export function parseBackup(text: string, now = Date.now()): Reading[] {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new Error('文件过大，请使用小于 1 MB 的本地备份');
  }
  let raw: unknown;
  try { raw = JSON.parse(text) as unknown; }
  catch { throw new Error('不是有效 JSON 文件'); }
  if (!object(raw) ||
      !hasOnlyKeys(raw, ['format', 'version', 'exportedAt', 'points']) ||
      raw.format !== 'bombax-pwa-local-history' || raw.version !== 1 ||
      !Array.isArray(raw.points) || raw.points.length > MAX_RECORDS) {
    throw new Error('请选择花工木棉 PWA 导出的历史备份');
  }
  const unique = new Map<number, Reading>();
  raw.points.forEach((row) => {
    const point = validateReading(row, now);
    unique.set(point.updatedAt, { ...point, source: 'import' });
  });
  return [...unique.values()].sort((a, b) => a.updatedAt - b.updatedAt);
}

export function formatBackup(points: Reading[], now = Date.now()): string {
  if (points.length > MAX_RECORDS) throw new Error('历史数量超出导出上限');
  const data: HistoryBackup = {
    format: 'bombax-pwa-local-history',
    version: 1,
    exportedAt: now,
    points: points.map((point) => validateReading(point, now))
  };
  return JSON.stringify(data, null, 2);
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('此浏览器不支持本机数据存储'));
      return;
    }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'updatedAt' });
      }
    };
    request.onerror = () => reject(new Error('无法打开本机历史记录'));
    request.onblocked = () => reject(new Error('请关闭其他旧版窗口后重试'));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function readHistory(): Promise<Reading[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        try {
          const data = req.result.map((row: unknown) => validateReading(row));
          resolve(data.sort((a, b) => a.updatedAt - b.updatedAt));
        } catch (e) { reject(e); }
      };
      req.onerror = () => reject(new Error('无法读取本地历史'));
    });
  } finally { db.close(); }
}

export async function saveReadings(points: Reading[]): Promise<void> {
  if (points.length > MAX_RECORDS) throw new Error('记录数量超出上限');
  const checked = points.map((p) => validateReading(p));
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('本机历史写入失败'));
      tx.onabort = () => reject(new Error('本机历史写入被中断'));
      checked.forEach((row) => tx.objectStore(STORE).put(row));
    });
  } finally { db.close(); }
}

export async function clearHistory(): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('无法清除本机历史'));
      tx.objectStore(STORE).clear();
    });
  } finally { db.close(); }
}

export function demoHistory(now = Date.now()): Reading[] {
  // Only transient on-screen fixtures. Never saved as actual history.
  const first = now - 13 * 86400_000;
  return Array.from({ length: 14 }, (_, i) => ({
    updatedAt: first + i * 86400_000,
    electric: Math.round((i < 8 ? 39.5 - i * 1.1 : 57.5 - (i - 8) * 1.25) * 100) / 100,
    water: Math.round((27.8 - i * 0.1) * 100) / 100,
    source: 'manual' as const,
  }));
}
