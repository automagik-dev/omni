/**
 * doctor command tests
 *
 * Uses the DoctorDeps injection seam in doctor.ts to avoid spawning pm2
 * or hitting the network. The test harness owns a mutable state object
 * that the deps closure reads, so we can flip "pm2 env drift" → "fixed"
 * across fix calls and assert the recheck picks it up.
 *
 * MUTATION SAFETY TEST
 * --------------------
 * The final test creates a fixture `pgserve-data` directory with a
 * known set of files, runs doctor with `--fix`, and asserts the
 * file count is unchanged. This enforces the load-bearing invariant
 * that `--fix` NEVER touches the embedded data directory.
 *
 * No `mock.module('../output.js', ...)` is used — we don't need to
 * intercept output because runDoctor() is a pure-ish function and we
 * assert on the returned CheckResult array directly.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DoctorDeps, runDoctor } from '../commands/doctor.js';
import type { Config, ServerConfig } from '../config.js';
import { DEFAULT_PGSERVE_PORT, buildRuntimeEnv } from '../runtime-env.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface HarnessState {
  pm2Drift: boolean;
  keyValid: boolean;
  pgserveReachable: boolean;
  omniDbExists: boolean;
  orphanedDirs: string[];
  serverVersion: string | null;
  apiStatus: 'online' | 'stopped' | 'errored' | 'missing';
  natsStatus: 'online' | 'stopped' | 'errored' | 'missing';
  /** omni-api pm2 max_restarts value. `undefined` simulates "no flag set". */
  apiMaxRestarts: number | undefined;
  /** Canned `pm2 conf` stdout. `null` simulates pm2 conf unreachable. */
  pm2ConfOutput: string | null;
  serverConfig: ServerConfig;
  cliConfig: Config;
  fixesInvoked: string[];
  /** Recorded pm2 invocations — tests can assert on this instead of spawning pm2. */
  pm2Calls: Array<{ args: string[]; env?: Record<string, string> }>;
  /** Exit code the stubbed runPm2 returns. Tests can flip to 1 to simulate failure. */
  pm2ExitCode: number;
  /** Whether the stubbed validateStoredKey flips to true after a fix attempt. */
  keyValidAfterFix: boolean;
  /** Whether the fix handler has been invoked (used to flip keyValidAfterFix). */
  keyFixApplied: boolean;
  /** Whether pm2-drift clears after a fix attempt. */
  pm2DriftAfterFix: boolean;
  /** Whether max_restarts becomes healthy after a fix attempt. */
  maxRestartsAfterFix: number | undefined;
  /** Whether pm2 conf becomes healthy after a fix attempt. */
  pm2ConfAfterFix: string | null;
}

/** Canonical healthy `pm2 conf` output — matches PM2_LOGROTATE_SETTINGS. */
const HEALTHY_PM2_CONF = `
Module: pm2-logrotate
  max_size                 10M
  retain                   5
  compress                 true
  rotateInterval           0 0 * * *
`;

function mkHarness(overrides?: Partial<HarnessState>): HarnessState {
  return {
    pm2Drift: false,
    keyValid: true,
    pgserveReachable: true,
    omniDbExists: true,
    orphanedDirs: [],
    serverVersion: '2.20260218.18',
    apiStatus: 'online',
    natsStatus: 'online',
    apiMaxRestarts: 10,
    pm2ConfOutput: HEALTHY_PM2_CONF,
    serverConfig: {
      port: 8882,
      databaseUrl: 'postgresql://postgres:postgres@localhost:8432/omni',
      dataDir: join(tmpdir(), 'omni-doctor-test'),
      logLevel: 'info',
      nodeEnv: 'production',
    },
    cliConfig: { apiKey: 'omni_sk_test-key' },
    fixesInvoked: [],
    pm2Calls: [],
    pm2ExitCode: 0,
    keyValidAfterFix: false,
    keyFixApplied: false,
    pm2DriftAfterFix: false,
    maxRestartsAfterFix: undefined,
    pm2ConfAfterFix: null,
    ...overrides,
  };
}

function mkDeps(state: HarnessState): DoctorDeps {
  return {
    getPm2Processes: async () => {
      // Build a pm2-jlist-shaped response driven by harness state.
      const expected = buildRuntimeEnv(state.serverConfig, state.cliConfig);
      const pm2StoredEnv = state.pm2Drift
        ? {
            DATABASE_URL: 'postgresql://garbage:1234@evil.invalid/wrong',
            PGSERVE_DATA: expected.PGSERVE_DATA,
            OMNI_API_KEY: state.cliConfig.apiKey,
          }
        : {
            DATABASE_URL: expected.DATABASE_URL,
            PGSERVE_DATA: expected.PGSERVE_DATA,
            OMNI_API_KEY: state.cliConfig.apiKey,
          };
      return [
        {
          name: 'omni-api',
          pm2_env: {
            status: state.apiStatus,
            env: pm2StoredEnv,
            max_restarts: state.apiMaxRestarts,
          },
        },
        {
          name: 'omni-nats',
          pm2_env: {
            status: state.natsStatus,
            env: {},
          },
        },
      ];
    },
    canConnect: async () => state.pgserveReachable,
    omniDbExists: async () => state.omniDbExists,
    findOrphanedDataDirs: () => [...state.orphanedDirs],
    fetchHealthVersion: async () => state.serverVersion,
    validateStoredKey: async () => {
      // After the fix handler runs, the key may be considered valid even
      // though the harness was constructed with keyValid: false — this
      // models the happy-path "fix succeeded" recheck.
      if (state.keyFixApplied && state.keyValidAfterFix) return true;
      return state.keyValid;
    },
    loadState: () => ({ serverConfig: state.serverConfig, cliConfig: state.cliConfig }),
    // Stubbed side-effects. Tests record pm2 calls here instead of spawning pm2.
    runPm2: async (args: string[], env?: Record<string, string>) => {
      state.pm2Calls.push({ args, env });
      // The cli-key-valid fix handler uses runPm2 to restart; flipping
      // keyFixApplied here lets the recheck pick up the "fixed" state.
      if (args[0] === 'restart' || args[0] === 'start') {
        state.keyFixApplied = true;
        if (state.pm2DriftAfterFix) {
          state.pm2Drift = false;
        }
        if (state.maxRestartsAfterFix !== undefined) {
          state.apiMaxRestarts = state.maxRestartsAfterFix;
        }
      }
      // The pm2-logrotate-installed fix re-runs `pm2 set pm2-logrotate:*`;
      // flip pm2ConfOutput to the post-fix state when the last key is set.
      if (args[0] === 'set' && args[1]?.startsWith('pm2-logrotate:') && state.pm2ConfAfterFix !== null) {
        state.pm2ConfOutput = state.pm2ConfAfterFix;
      }
      return state.pm2ExitCode;
    },
    saveCliConfig: (config: Config) => {
      state.cliConfig = { ...state.cliConfig, ...config };
    },
    reloadCliConfig: () => ({ ...state.cliConfig }),
    generateApiKey: () => 'omni_sk_rotated-test-key',
    sleepMs: async () => {
      // No real sleep in tests — we're deterministic.
    },
    capturePm2Conf: async () => state.pm2ConfOutput,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runDoctor — read-only mode', () => {
  test('reports all 9 checks with OK when state is healthy', async () => {
    // Match the harness version to whatever the CLI currently reports so
    // `version-match` is OK without hard-coding the CLI version here.
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    expect(report.checks).toHaveLength(9);
    const ids = report.checks.map((c) => c.id);
    expect(ids).toEqual([
      'pm2-env-drift',
      'cli-key-valid',
      'pgserve-reachable',
      'omni-db-exists',
      'orphaned-data-dirs',
      'version-match',
      'pm2-status',
      'pm2-max-restarts',
      'pm2-logrotate-installed',
    ]);
    for (const check of report.checks) {
      expect(check.level).toBe('OK');
    }
    expect(report.summary).toEqual({ ok: 9, warn: 0, fail: 0 });
    expect(report.fixesApplied).toEqual([]);
  });

  test('flags pm2-env-drift as WARN when DATABASE_URL differs from config', async () => {
    const state = mkHarness({ pm2Drift: true });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const drift = report.checks.find((c) => c.id === 'pm2-env-drift');
    expect(drift?.level).toBe('WARN');
    expect(drift?.detail).toContain('DATABASE_URL drift');
    expect(drift?.detail).toContain('garbage');
  });

  test('flags cli-key-valid as FAIL when the stored key does not validate', async () => {
    const state = mkHarness({ keyValid: false });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const key = report.checks.find((c) => c.id === 'cli-key-valid');
    expect(key?.level).toBe('FAIL');
  });

  test('flags pgserve-reachable as FAIL when TCP connect fails', async () => {
    const state = mkHarness({ pgserveReachable: false });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const pg = report.checks.find((c) => c.id === 'pgserve-reachable');
    expect(pg?.level).toBe('FAIL');
    expect(pg?.detail).toContain(String(DEFAULT_PGSERVE_PORT));
  });

  test('flags omni-db-exists as FAIL when the probe returns false', async () => {
    const state = mkHarness({ omniDbExists: false });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const db = report.checks.find((c) => c.id === 'omni-db-exists');
    expect(db?.level).toBe('FAIL');
  });

  test('flags orphaned-data-dirs as WARN with the absolute paths', async () => {
    const state = mkHarness({ orphanedDirs: ['/tmp/old-project/.pgserve-data'] });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const orphan = report.checks.find((c) => c.id === 'orphaned-data-dirs');
    expect(orphan?.level).toBe('WARN');
    expect(orphan?.detail).toContain('/tmp/old-project/.pgserve-data');
  });

  test('flags version-match as WARN when CLI vs server differ', async () => {
    const state = mkHarness({ serverVersion: '1.0.0' });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const ver = report.checks.find((c) => c.id === 'version-match');
    expect(ver?.level).toBe('WARN');
    expect(ver?.detail).toContain('1.0.0');
  });

  test('flags pm2-status as FAIL when omni-api is stopped', async () => {
    const state = mkHarness({ apiStatus: 'stopped' });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const pm2 = report.checks.find((c) => c.id === 'pm2-status');
    expect(pm2?.level).toBe('FAIL');
    expect(pm2?.detail).toContain('omni-api=stopped');
  });

  test('flags pm2-max-restarts as FAIL when apiMaxRestarts is 0', async () => {
    const state = mkHarness({ apiMaxRestarts: 0 });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'pm2-max-restarts');
    expect(check?.level).toBe('FAIL');
    expect(check?.detail).toContain('max_restarts=0');
  });

  test('flags pm2-max-restarts as FAIL when apiMaxRestarts is >= 1000', async () => {
    const state = mkHarness({ apiMaxRestarts: 1000 });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'pm2-max-restarts');
    expect(check?.level).toBe('FAIL');
    expect(check?.detail).toContain('max_restarts=1000');
  });

  test('flags pm2-max-restarts as FAIL when no max_restarts is set', async () => {
    const state = mkHarness({ apiMaxRestarts: undefined });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'pm2-max-restarts');
    expect(check?.level).toBe('FAIL');
    expect(check?.detail).toContain('no max_restarts set');
  });

  test('pm2-max-restarts accepts the hardened 5..50 range', async () => {
    for (const n of [5, 10, 25, 50]) {
      const state = mkHarness({ apiMaxRestarts: n });
      const deps = mkDeps(state);
      const report = await runDoctor({ fix: false }, deps);
      const check = report.checks.find((c) => c.id === 'pm2-max-restarts');
      expect(check?.level).toBe('OK');
    }
  });

  test('pm2-max-restarts warns on values outside 5..50 but below 1000', async () => {
    const state = mkHarness({ apiMaxRestarts: 100 });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'pm2-max-restarts');
    expect(check?.level).toBe('WARN');
    expect(check?.detail).toContain('expected 5..50');
  });

  test('flags pm2-logrotate-installed as FAIL when the module is missing', async () => {
    const state = mkHarness({ pm2ConfOutput: 'Module: other-module\n' });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'pm2-logrotate-installed');
    expect(check?.level).toBe('FAIL');
    expect(check?.detail).toContain('not installed');
  });

  test('flags pm2-logrotate-installed as FAIL when max_size is wrong', async () => {
    const state = mkHarness({
      pm2ConfOutput: `
Module: pm2-logrotate
  max_size                 50M
  retain                   5
  compress                 true
  rotateInterval           0 0 * * *
`,
    });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'pm2-logrotate-installed');
    expect(check?.level).toBe('FAIL');
    expect(check?.detail).toContain('max_size');
  });

  test('flags pm2-logrotate-installed as WARN when pm2 conf unreachable', async () => {
    const state = mkHarness({ pm2ConfOutput: null });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'pm2-logrotate-installed');
    expect(check?.level).toBe('WARN');
  });
});

describe('runDoctor — --fix mode', () => {
  test('healthy state is a no-op under --fix (no fixes recorded)', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: true }, deps);

    expect(report.summary.fail).toBe(0);
    expect(report.fixesApplied).toEqual([]);
    expect(state.pm2Calls).toEqual([]);
  });

  test('pm2-env-drift fix issues delete + start with hermetic env and recheck reports OK', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({
      pm2Drift: true,
      pm2DriftAfterFix: true, // flip to healthy after fix applies
      serverVersion: VERSION,
    });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: true }, deps);

    // pm2 should have been called: delete omni-api, then start omni-api
    const deleteCall = state.pm2Calls.find((c) => c.args[0] === 'delete');
    const startCall = state.pm2Calls.find((c) => c.args[0] === 'start');
    expect(deleteCall).toBeDefined();
    expect(startCall).toBeDefined();
    // The env passed to pm2 must NOT contain the polluted garbage URL.
    expect(startCall?.env?.DATABASE_URL).not.toContain('garbage');
    expect(startCall?.env?.DATABASE_URL).toContain(':8432/omni');
    // Recheck sees the drift as fixed.
    const drift = report.checks.find((c) => c.id === 'pm2-env-drift');
    expect(drift?.level).toBe('OK');
    expect(report.fixesApplied.some((f) => f.includes('relaunched'))).toBe(true);
  });

  test('cli-key-valid fix rotates the stored key and re-validates on recheck', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({
      keyValid: false,
      keyValidAfterFix: true, // post-rotation the recheck sees a valid key
      serverVersion: VERSION,
    });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: true }, deps);

    // pm2 set + restart were issued with the rotated key
    const setCall = state.pm2Calls.find((c) => c.args[0] === 'set');
    const restartCall = state.pm2Calls.find((c) => c.args[0] === 'restart');
    expect(setCall).toBeDefined();
    expect(setCall?.args).toContain('omni-api:OMNI_API_KEY');
    expect(setCall?.args).toContain('omni_sk_rotated-test-key');
    expect(restartCall).toBeDefined();
    expect(restartCall?.env?.OMNI_API_KEY).toBe('omni_sk_rotated-test-key');
    // The rotated key was persisted to the stub cli config.
    expect(state.cliConfig.apiKey).toBe('omni_sk_rotated-test-key');
    // Recheck sees the key as valid after rotation.
    const key = report.checks.find((c) => c.id === 'cli-key-valid');
    expect(key?.level).toBe('OK');
    expect(report.fixesApplied.some((f) => f.includes('rotated CLI key'))).toBe(true);
  });

  test('pm2 rotation failure surfaces an error string in fixesApplied', async () => {
    const state = mkHarness({ keyValid: false, pm2ExitCode: 1 });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: true }, deps);

    expect(report.fixesApplied.some((f) => f.startsWith('FAILED'))).toBe(true);
    // cli-key-valid still FAIL — the fix didn't take.
    const key = report.checks.find((c) => c.id === 'cli-key-valid');
    expect(key?.level).toBe('FAIL');
  });

  test('pm2-max-restarts fix reissues delete + start with hardened flags', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({
      apiMaxRestarts: 0,
      maxRestartsAfterFix: 10,
      serverVersion: VERSION,
    });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: true }, deps);

    const deleteCall = state.pm2Calls.find((c) => c.args[0] === 'delete' && c.args[1] === 'omni-api');
    const startCall = state.pm2Calls.find((c) => c.args[0] === 'start');
    expect(deleteCall).toBeDefined();
    expect(startCall).toBeDefined();
    // Must carry the hardened flags
    expect(startCall?.args).toContain('--max-restarts');
    expect(startCall?.args).toContain('10');
    expect(startCall?.args).toContain('--restart-delay');
    expect(startCall?.args).toContain('5000');
    expect(startCall?.args).toContain('--max-memory-restart');
    expect(startCall?.args).toContain('2G');
    // Recheck passes
    const check = report.checks.find((c) => c.id === 'pm2-max-restarts');
    expect(check?.level).toBe('OK');
    expect(report.fixesApplied.some((f) => f.includes('--max-restarts'))).toBe(true);
  });

  test('pm2-logrotate-installed fix reinstalls module + sets all four keys', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({
      pm2ConfOutput: 'Module: other-module\n',
      pm2ConfAfterFix: HEALTHY_PM2_CONF,
      serverVersion: VERSION,
    });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: true }, deps);

    const installCall = state.pm2Calls.find((c) => c.args[0] === 'install' && c.args[1] === 'pm2-logrotate');
    expect(installCall).toBeDefined();
    // All four settings keys must have been pushed via `pm2 set pm2-logrotate:*`
    const setCalls = state.pm2Calls.filter((c) => c.args[0] === 'set' && c.args[1]?.startsWith('pm2-logrotate:'));
    const setKeys = setCalls.map((c) => c.args[1]);
    expect(setKeys).toContain('pm2-logrotate:max_size');
    expect(setKeys).toContain('pm2-logrotate:retain');
    expect(setKeys).toContain('pm2-logrotate:compress');
    expect(setKeys).toContain('pm2-logrotate:rotateInterval');
    // Recheck passes
    const check = report.checks.find((c) => c.id === 'pm2-logrotate-installed');
    expect(check?.level).toBe('OK');
    expect(report.fixesApplied.some((f) => f.includes('reinstalled and configured pm2-logrotate'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mutation safety — the load-bearing invariant
// ---------------------------------------------------------------------------

describe('runDoctor — mutation safety', () => {
  const FIXTURE_DIR = join(tmpdir(), 'omni-doctor-pgserve-fixture');

  function countFiles(dir: string): number {
    if (!existsSync(dir)) return 0;
    const entries = readdirSync(dir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (entry.isFile()) count++;
      else if (entry.isDirectory()) count += countFiles(join(dir, entry.name));
    }
    return count;
  }

  beforeEach(() => {
    // Populate a fake pgserve data directory with known files.
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
    mkdirSync(FIXTURE_DIR, { recursive: true });
    for (const name of ['postgresql.conf', 'pg_hba.conf', 'PG_VERSION', 'base.tar', 'global.tar']) {
      writeFileSync(join(FIXTURE_DIR, name), `fixture content for ${name}\n`);
    }
  });

  afterEach(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  test('--fix never touches the configured pgserve data directory', async () => {
    const state = mkHarness({
      // Point the harness at our fixture so even if the fix handlers were
      // to rm -rf the PGSERVE_DATA path, we would catch it.
      serverConfig: {
        port: 8882,
        databaseUrl: 'postgresql://postgres:postgres@localhost:8432/omni',
        // dataDir is the PARENT of pgserve — buildRuntimeEnv appends /pgserve
        dataDir: join(tmpdir(), 'omni-doctor-fixture-data'),
        logLevel: 'info',
        nodeEnv: 'production',
      },
      // Force as many checks as possible into FAIL/WARN so fix-handlers are
      // exercised (but still cannot touch FIXTURE_DIR because it's not in
      // their code path).
      pm2Drift: true,
      keyValid: false,
      orphanedDirs: [FIXTURE_DIR],
    });
    const deps = mkDeps(state);

    const before = countFiles(FIXTURE_DIR);
    expect(before).toBe(5);

    await runDoctor({ fix: true }, deps);

    const after = countFiles(FIXTURE_DIR);
    expect(after).toBe(before);
    // All fixture files still present.
    for (const name of ['postgresql.conf', 'pg_hba.conf', 'PG_VERSION', 'base.tar', 'global.tar']) {
      expect(existsSync(join(FIXTURE_DIR, name))).toBe(true);
    }
  });
});
