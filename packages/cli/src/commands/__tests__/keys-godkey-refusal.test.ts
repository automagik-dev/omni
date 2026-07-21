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
import { __testables } from '../keys';

const ENFORCEMENT_ENV_VAR = 'OMNI_DB_ENFORCEMENT';

/**
 * Run the admin path and report HOW it refused.
 *
 * `output.error` normally calls `process.exit`, but another suite in this
 * package replaces it with a throwing mock, and in a full-package run that
 * replacement is live. The probe therefore records BOTH signals and asserts on
 * the refusal itself rather than on the mechanism that delivers it — the
 * property under test is "no god key was minted or printed", not "process.exit
 * was the messenger".
 */
async function runAdminCreate(): Promise<{ refusal: string; stdout: string; exitCodes: number[] }> {
  const exitCodes: number[] = [];
  const chunks: string[] = [];

  const originalExit = process.exit;
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalErrWrite = process.stderr.write.bind(process.stderr);
  const originalLog = console.log;
  const originalConsoleError = console.error;
  // `output.error` may deliver the refusal by exiting (isolated run) or by
  // throwing (full-package run, where another suite mocks it). Both land in
  // `refusal`; stderr is captured because the exit path writes the reason there
  // before exiting, and the reason is what this probe is actually about.
  const errChunks: string[] = [];

  Object.defineProperty(process, 'exit', {
    value: (code?: number) => {
      exitCodes.push(code ?? 0);
      throw new Error(`__exit_${code ?? 0}__`);
    },
    configurable: true,
    writable: true,
  });
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;
  console.log = (...args: unknown[]) => {
    chunks.push(args.map(String).join(' '));
  };
  process.stderr.write = ((chunk: string | Uint8Array) => {
    errChunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stderr.write;
  console.error = (...args: unknown[]) => {
    errChunks.push(args.map(String).join(' '));
  };

  let refusal = '';
  try {
    await __testables.handleAdminCreate({ name: 'god', profile: 'admin' } as never);
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  } finally {
    Object.defineProperty(process, 'exit', { value: originalExit, configurable: true, writable: true });
    process.stdout.write = originalWrite;
    process.stderr.write = originalErrWrite;
    console.log = originalLog;
    console.error = originalConsoleError;
  }

  return { refusal: `${refusal}\n${errChunks.join('')}`, stdout: chunks.join(''), exitCodes };
}

describe('god-key bootstrap refusal (enforcement world)', () => {
  const original = process.env[ENFORCEMENT_ENV_VAR];
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    // A TTY is present on purpose: the refusal must not be an accident of the
    // pre-existing non-TTY guard.
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true, writable: true });
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENFORCEMENT_ENV_VAR];
    else process.env[ENFORCEMENT_ENV_VAR] = original;
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true, writable: true });
  });

  test('refuses to mint or print an admin key when enforcement is on', async () => {
    process.env[ENFORCEMENT_ENV_VAR] = 'on';
    const { refusal, stdout } = await runAdminCreate();

    // Refused for the ENFORCEMENT reason, naming the variable that caused it.
    expect(refusal).toContain('OMNI_DB_ENFORCEMENT=on');
    expect(refusal).toContain('admin (god) key');
    // And it refused BEFORE prompting, which proves it never reached the TTY
    // path, the DB layer, or key generation — nothing was minted, even
    // transiently.
    expect(stdout).not.toContain('I UNDERSTAND');
    expect(stdout).not.toContain('API Key (save this');
  });

  test('anything other than a literal "on" leaves legacy behavior untouched', async () => {
    // The dual-world boundary: `1`, `true`, `ON` are NOT enforcement, exactly as
    // `resolveEnforcementMode` defines it. The legacy path is entered and stops
    // at its own pre-existing non-TTY guard, unchanged by G4.
    for (const value of ['1', 'true', 'ON', 'off', '']) {
      process.env[ENFORCEMENT_ENV_VAR] = value;
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true, writable: true });

      const { refusal } = await runAdminCreate();
      // Refused by the LEGACY TTY guard, not by the enforcement guard: the
      // enforcement branch was not entered for any near-miss value.
      expect(refusal).toContain('require a TTY');
      expect(refusal).not.toContain('OMNI_DB_ENFORCEMENT=on');
    }
  });
});
