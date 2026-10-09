#!/usr/bin/env node
/**
 * Privacy guard.
 *
 * The rule it enforces: a person's identifiers never enter this repository, and never leave this
 * machine in a form somebody else can read. That rule was written down before it was enforced, and
 * a dormitory room number still got into a documentation commit on 2026-10-09 — transcribed out of
 * `uiautomator`'s accessibility tree, which is exactly how a "redacted" note stops being redacted.
 * Vigilance is not a control; this file is.
 *
 * Two layers:
 *
 *  1. Shape rules that need no local data — a building-room code, a mainland ID card, a mobile
 *     number, and a credential-shaped assignment with a real value in it.
 *  2. A gitignored denylist of literal values (`privacy-denylist.local.txt`), so the specific
 *     room/account that belongs to whoever is testing cannot recur.
 *
 * Matches are always printed masked. A tool that echoes the secret it found is a second leak.
 *
 * Usage:
 *   node scripts/check-privacy.mjs            # every tracked file, worktree contents
 *   node scripts/check-privacy.mjs --staged   # staged blobs only (what a pre-commit hook wants)
 *   node scripts/check-privacy.mjs --paths evidence docs  # extra directories, e.g. the evidence archive
 *   node scripts/check-privacy.mjs --selftest # prove the rules fire, and prove masking works
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Is this assignment carrying an actual secret, or just a name, a placeholder, or a code expression?
 *
 * The guard is a tripwire, not a parser, so it fires on what the tokens measured on device look
 * like: long, mixed case, digits (`eyJ…` JWTs, 32-char hex session ids). Everything the repository
 * legitimately writes — `bearer …`, `<access_token>`, `password: string`,
 * `refresh_token=not-a-real-token-0000`, `els.password.value` — stays quiet. The self-test pins
 * both directions, because a guard with five false positives per build gets switched off within a
 * week, and a switched-off guard protects nothing.
 */
export function looksLikeSecret(raw) {
  const value = String(raw).replace(/^["']|["']$/g, '');
  if (value.length < 20) return false;
  if (/\s/.test(value)) return false;
  if (/(placeholder|example|not-a-real|changeme|dummy|bogus|redacted)/i.test(value)) return false;
  if (value.startsWith('eyJ')) return true;
  const digits = (value.match(/[0-9]/g) ?? []).length;
  if (/[A-Z]/.test(value) && digits >= 2) return true;
  return value.length >= 30 && digits >= 4 && /^[A-Za-z0-9+/_=-]+$/.test(value);
}

export const RULES = [
  {
    id: 'dorm-code',
    // Building letter + two digits + a three-or-four-digit room. Deliberately narrower than
    // "anything with a dash": `SHA-256`, `H2-300`, `1234-5678` and `10-09` must stay quiet — the
    // self-test pins that. A one-digit building is still caught, but only in a residence context.
    re: /\b[A-HJ-Z][0-9]{2}-[0-9]{3,4}\b/g,
    hint: '字母+两位编号-房号 形状：宿舍标识',
  },
  {
    id: 'dorm-code-in-context',
    // Same shape, wider digit counts, but only on a line that already talks about a dormitory —
    // that is how a screen transcription of a dormitory line gets caught without flagging CSS
    // anchors. (privacy:ignore — the example this rule exists to catch is written below as a fixture)
    re: /\b[A-HJ-Z][0-9]{1,2}-[0-9]{2,4}\b/g,
    hint: '宿舍语境里的 字母+编号-房号',
    onlyWith: /(宿舍|房号|楼栋|床位|roomName|roomId|room\s*[:=]|dormitory)/i,
  },
  {
    id: 'cn-id-card',
    re: /\b[0-9]{17}[0-9Xx]\b/g,
    hint: '18 位身份证号形状',
  },
  {
    id: 'mainland-mobile',
    re: /(?<![0-9])1[3-9][0-9]{9}(?![0-9])/g,
    hint: '11 位大陆手机号形状',
  },
  {
    id: 'credential-value',
    re: /\b(?:authorization|access_token|refresh_token|id_token|client_secret|password|passwd|tgc|locsession|jsessionid|captcha_key|captcha_header_key|synjones-auth)\b\s*[:=]\s*(?:bearer|basic|token)?\s*"?([A-Za-z0-9._\/+=-]{6,})"?/gi,
    hint: '凭据名后面跟着看似真实的值',
    skipValue: (value) => !looksLikeSecret(value),
  },
];

/** Paths that are generated, third-party or byte-heavy: scanned shape rules drown in them. */
export const SKIP_PATH_RE = /^(dist\/|node_modules\/|android\/app\/build\/|android\/build\/|android\/\.gradle\/|pnpm-lock\.yaml$)/;

/** Never text-scanned: images, packages, bundles. Reported as "not scanned" rather than assumed clean. */
export const BINARY_SUFFIX_RE = /\.(png|jpe?g|gif|webp|apk|aab|bundle|pack|jar|so|woff2?|ttf|ico|zip)$/i;

/**
 * @param {string} text
 * @param {string[]} denylist literal values that must never appear
 * @returns {{line: number, rule: string, masked: string, hint: string}[]}
 */
export function findMatches(text, denylist = []) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/\bprivacy:ignore\b/.test(line)) return; // explicit, per-line, reviewable opt-out
    for (const rule of RULES) {
      if (rule.onlyWith && !rule.onlyWith.test(line)) continue;
      rule.re.lastIndex = 0;
      let match;
      while ((match = rule.re.exec(line)) !== null) {
        const captured = match[1] === undefined ? match[0] : match[1];
        if (rule.skipValue && rule.skipValue(captured)) continue;
        hits.push({ line: index + 1, rule: rule.id, masked: mask(match[0]), hint: rule.hint });
        if (match[0].length === 0) break; // guard against a zero-length match looping
      }
    }
    for (const value of denylist) {
      if (!value) continue;
      if (line.includes(value)) {
        hits.push({ line: index + 1, rule: 'denylist', masked: mask(value), hint: '本机 denylist 里的具体值' });
      }
    }
  });
  return hits;
}

/** Keep enough to locate the line, drop enough that the report cannot be the leak. */
export function mask(value) {
  const text = String(value);
  if (text.length <= 2) return '*';
  return `${text.slice(0, 2)}***${text.length}`;
}

export function listFiles(cwd, mode) {
  if (mode === 'staged') {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z'], {
      cwd, encoding: 'utf8',
    });
    return out.split('\0').filter(Boolean);
  }
  const out = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

export function readTracked(cwd, file, mode) {
  if (mode !== 'staged') return readFileSync(path.join(cwd, file));
  return execFileSync('git', ['show', `:${file}`], { cwd, encoding: 'buffer' });
}

export function readDenylist(cwd, name = 'privacy-denylist.local.txt') {
  const p = path.join(cwd, name);
  if (!existsSync(p)) return { values: [], present: false, path: p };
  const values = readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  return { values, present: true, path: p };
}

function loadIgnorePatterns(cwd) {
  const p = path.join(cwd, '.privacy-ignore');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((glob) => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '::').replace(/\*/g, '[^/]*').replace(/::/g, '.*')}$`));
}

/**
 * @param {string} cwd
 * @param {{mode?: string, paths?: string[]}} options
 */
export function scan(cwd, { mode = 'tracked', paths = [] } = {}) {
  const deny = readDenylist(cwd);
  const ignores = loadIgnorePatterns(cwd);
  const report = [];

  for (const file of listFiles(cwd, mode)) {
    if (SKIP_PATH_RE.test(file) || ignores.some((re) => re.test(file))) continue;
    let text;
    try {
      text = readTracked(cwd, file, mode).toString('utf8');
    } catch {
      continue; // a binary or a just-deleted staged path
    }
    const hits = findMatches(text, deny.values);
    if (hits.length) report.push({ file, hits });
  }

  for (const root of paths) {
    for (const file of walk(path.resolve(cwd, root))) {
      const rel = path.relative(cwd, file);
      if (SKIP_PATH_RE.test(rel) || ignores.some((re) => re.test(rel))) continue;
      if (BINARY_SUFFIX_RE.test(rel)) continue;
      let text;
      try {
        if (statSync(file).size > 4 * 1024 * 1024) continue;
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const hits = findMatches(text, deny.values);
      if (hits.length) report.push({ file: rel, hits });
    }
  }

  return { report, denylist: deny };
}

/** Files under a directory that is deliberately outside the repository, e.g. the evidence archive. */
function walk(abs) {
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [abs];
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const full = path.join(abs, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

export function format(report) {
  const lines = [];
  for (const entry of report) {
    for (const hit of entry.hits) {
      lines.push(`${entry.file}:${hit.line}  ${hit.rule}  ${hit.masked}  （${hit.hint}）`);
    }
  }
  return lines;
}

/** Self-test: every rule must fire, masking must hide the value, and benign text must stay quiet. */
export function selftest() {
  const room = ['F', '1', '2', '-', '3', '4', '5'].join(''); // a fake, never a real dormitory
  const smallRoom = ['B', '7', '-', '2', '1', '0'].join(''); // one-digit building: only counts in context
  const id = '1'.repeat(17) + 'X';
  const mobile = '13' + '8'.repeat(9);
  const samples = [
    { text: `楼栋 ${room} 已记录`, rule: 'dorm-code' },
    { text: `宿舍 ${smallRoom} 的余额`, rule: 'dorm-code-in-context' },
    { text: `身份证 ${id}`, rule: 'cn-id-card' },
    { text: `电话 ${mobile}`, rule: 'mainland-mobile' },
    { text: 'authorization: Bearer abc123DEF456ghi789JKL0', rule: 'credential-value' }, // privacy:ignore 合成凭据
    { text: 'refresh_token="aB3dE5fG7h9Jk0l1M2n3P4q5"', rule: 'credential-value' }, // privacy:ignore 合成凭据
    { text: 'access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0', rule: 'credential-value' }, // privacy:ignore 合成凭据
    { text: `JSESSIONID=${'0123456789abcdef'.repeat(2)}`, rule: 'credential-value' },
  ];
  const benign = [
    '10-09 18:47:25.937 stage=history result=recorded source=login',
    'origWhen 1791558000000 = 2026-10-09 23:00:00 Beijing',
    'stage=login.captchaForm result=ok campus=DXC refreshToken=present cookies=TGC,error_times,locSession',
    'certificate SHA-256 digest: ef607f9df8e7872c9008d6aaf35da6d5ee69db217a97bc7b0f6d191629ff89d4',
    'versionCode=2 versionName="0.2.0" minSdk=24 targetSdk=36',
    '# heading anchor H2-300 and a range 1234-5678 in a changelog',
    'window=+3m44s998ms repeatInterval=0 count=0 flags=0x20',
    'id: "trend-svg" viewBox="0 0 360 224" — a bare G7 and a bare 304 are not a dorm code',
    'expires_in 6048000 s = 70 days; bridge=4; api=34',
    // The exact shapes this repository writes about credentials, all of which must stay quiet:
    'Synjones-Auth: bearer …',
    'Synjones-Auth: bearer <access_token>',
    'const password = els.password.value;',
    'password: string;',
    'bogus token     : same request with refresh_token=not-a-real-token-0000',
  ];

  const failures = [];
  for (const sample of samples) {
    const hits = findMatches(sample.text, []);
    if (!hits.some((h) => h.rule === sample.rule)) failures.push(`rule ${sample.rule} did not fire`);
    for (const hit of hits) {
      if (sample.text.includes(hit.masked)) failures.push(`mask leaked ${hit.rule}`);
      if (hit.masked.length > 8) failures.push(`mask too revealing for ${hit.rule}`);
    }
  }
  for (const line of benign) {
    const hits = findMatches(line, []);
    if (hits.length) failures.push(`false positive: ${line.slice(0, 28)}… → ${hits.map((h) => h.rule).join(',')}`);
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'privacy-selftest-'));
  const listFile = path.join(dir, 'deny.txt');
  writeFileSync(listFile, `${room}\n# comment\n`);
  const deny = readFileSync(listFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const viaDenylist = findMatches(`备注 ${room} 已完成`, deny);
  if (!viaDenylist.some((h) => h.rule === 'denylist')) failures.push('denylist did not fire');
  if (viaDenylist.some((h) => h.masked.includes(room.slice(2)))) failures.push('denylist mask leaked the tail');
  rmSync(dir, { recursive: true, force: true });

  return failures;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) {
    const failures = selftest();
    if (failures.length) {
      console.error('privacy guard self-test FAILED:');
      for (const f of failures) console.error(`  - ${f}`);
      process.exit(1);
    }
    console.log('privacy guard self-test ok (every detection fired, benign lines stayed quiet, masking holds)');
    return;
  }

  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const mode = argv.includes('--staged') ? 'staged' : 'tracked';
  const pathsIndex = argv.indexOf('--paths');
  const paths = pathsIndex === -1 ? [] : argv.slice(pathsIndex + 1).filter((a) => !a.startsWith('--'));

  const { report, denylist } = scan(cwd, { mode, paths });
  const lines = format(report);

  if (!denylist.present && mode === 'tracked') {
    console.warn(`note: ${denylist.path} is absent — exact-value checking is off (shape rules still run)`);
  }

  if (lines.length) {
    console.error(`privacy guard found ${lines.length} candidate(s) in ${report.length} file(s) (${mode}):`);
    for (const line of lines) console.error(`  ${line}`);
    console.error('Values are masked on purpose. Fix the file, or add `privacy:ignore` on the line with a reason.');
    process.exit(1);
  }
  console.log(`privacy guard: clean (${mode}${paths.length ? `, +${paths.join(',')}` : ''}, ${denylist.present ? `denylist ${denylist.values.length} value(s)` : 'no denylist'})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
