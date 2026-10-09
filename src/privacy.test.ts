import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * The repository has had a personal identifier committed once already (a dormitory room number,
 * transcribed off a phone screen, 2026-10-09), so "never commit identifiers" is not a rule the
 * codebase can be trusted to remember. These two cases make `pnpm test` fail if the guard regresses
 * or if something shape-matching enters the tracked tree — the check runs in the same gate that
 * already runs on every build, not as a step somebody has to think of.
 *
 * The guard lives in `scripts/check-privacy.mjs` and is invoked as a child process rather than
 * imported: its own self-test asserts masking, and importing it here would put matched values in
 * vitest's reporter output.
 */
const run = (args: string[]): string =>
  execFileSync(process.execPath, ['scripts/check-privacy.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

describe('privacy guard is part of the build gate', () => {
  it('passes its own self-test', () => {
    expect(run(['--selftest'])).toContain('self-test ok');
  });

  it('finds no identifier or credential-shaped value in the tracked tree', () => {
    expect(run([])).toContain('privacy guard: clean');
  });
});
