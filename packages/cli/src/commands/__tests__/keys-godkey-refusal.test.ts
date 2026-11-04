/**
 * Bootstrap god-key refusal under enforcement
 * (wish: omni-full-multitenancy, Group G4; WISH line 180, Success Criterion 19).
 *
 * `omni keys create --profile admin` mints a data-plane key with every scope,
 * bypasses redaction, and prints the plaintext secret to the terminal. WISH
 * Success Criterion 19 says the primary-key bootstrap must not create or print a
 * plaintext data-plane god key.
 *
 * G4's legacy-invariance boundary protects today's flag-off CLI behavior, so
 * this is delivered as ENFORCEMENT-WORLD behavior: with `OMNI_DB_ENFORCEMENT=on`
 * the path refuses before it touches a TTY, a database, or a key generator. That
 * is consistent with what G3 already did at the database layer — under
 * enforcement the runtime role has REVOKE ALL on `auth_credentials`, so a god
 * key minted this way would be unusable anyway; refusing at the CLI turns a
 * confusing runtime failure into an explicit, explained one.
 *
 * The residual legacy-mode exposure is a NAMED DEFERRAL to the state-machine
 * advance, recorded in the G4 handoff. It is deliberately not classified away.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEYS_MODULE = fileURLToPath(new URL('../keys.ts', import.meta.url));
const children = new Set<{ kill(): void; exited: Promise<number> }>();
let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'omni-key-refusal-'));
});

afterEach(async () => {
  // A failed assertion or test timeout must not leave a prompt/child running.
  await Promise.all(
    [...children].map(async (child) => {
      child.kill();
      await child.exited;
    }),
  );
  rmSync(configDir, { recursive: true, force: true });
});

/**
 * Exercise the real output.error/process.exit boundary in an isolated process.
 * Other CLI suites mock output.error process-wide. If that mock returns, the
 * enforcement refusal can fall through to the unanswered TTY prompt; the old
 * probe timed out before its finally restored the parent's streams/exit.
 */
async function runAdminCreate(enforcement: string | undefined, isTTY: boolean) {
  const child = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `import { __testables } from ${JSON.stringify(KEYS_MODULE)};
Object.defineProperty(process.stdin, 'isTTY', { value: ${isTTY}, configurable: true });
await __testables.handleAdminCreate({ name: 'god', profile: 'admin' });`,
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        OMNI_CONFIG_DIR: configDir,
        ...(enforcement === undefined ? {} : { OMNI_DB_ENFORCEMENT: enforcement }),
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  children.add(child);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    if (child.exitCode === null) child.kill();
    await child.exited;
    children.delete(child);
  }
}

describe('god-key bootstrap refusal (enforcement world)', () => {
  test('refuses to mint or print an admin key when enforcement is on, even with a TTY', async () => {
    const { exitCode, stderr, stdout } = await runAdminCreate('on', true);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('OMNI_DB_ENFORCEMENT=on');
    expect(stderr).toContain('admin (god) key');
    expect(stderr).not.toContain('require a TTY');
    // No prompt or plaintext: refusal precedes the TTY, DB and key generation.
    expect(stdout).toBe('');
  });

  test.each(['1', 'true', 'ON', 'off', '', undefined])(
    'enforcement=%s preserves the legacy non-TTY refusal',
    async (value) => {
      const { exitCode, stderr, stdout } = await runAdminCreate(value, false);

      expect(exitCode).toBe(1);
      expect(stderr).toContain('require a TTY');
      expect(stderr).not.toContain('OMNI_DB_ENFORCEMENT=on');
      expect(stdout).toBe('');
    },
  );
});
