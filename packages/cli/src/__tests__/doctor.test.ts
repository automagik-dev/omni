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

// Neutralize host XDG_RUNTIME_DIR so the synchronous canonical-pgserve socket
// probe in runtime-env.ts (`probeCanonicalSocketSync`) returns false. Without
// this pin, the suite emits the UDS-form DATABASE_URL on dev hosts that have
// `pgserve install`-ed locally, and the legacy-fallback (TCP `:8432/omni`)
// assertions below fail. CI runners have no canonical socket so they were
// always green; this just makes dev hosts match.
process.env.XDG_RUNTIME_DIR = join(tmpdir(), 'omni-doctor-test-no-xdg');

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
  /** omni-nats pm2 max_restarts value. `undefined` simulates "no flag set". */
  natsMaxRestarts: number | undefined;
  /** omni-api pm2 child PID. Used by port-canonical-owner. */
  apiPid: number | undefined;
  /** omni-nats pm2 child PID. Used by port-canonical-owner. */
  natsPid: number | undefined;
  /**
   * Map of port → owning PID (or null when nothing listens). Stubs the
   * `ss -tlnp` lookup. Healthy default has each canonical port owned by
   * the corresponding pm2 child PID.
   */
  portOwners: Record<number, number | null>;
  /** Recorded process.kill calls — tests assert which squatter PIDs were signaled. */
  processKillCalls: Array<{ pid: number; signal: 'SIGTERM' | 'SIGKILL' }>;
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
  /** Instances reported by listLockedInstances() (P2a check input). */
  lockedInstances: Array<{ id: string; name: string }>;
  /** Whether cliHasSigningKey() returns true. */
  cliHasSigningKey: boolean;
  /**
   * Result the stubbed `setupCanonicalPgserve()` returns when fixPgserveCanonical
   * is invoked. Default: a fake canonical url. Tests can override to null
   * to exercise the error path.
   */
  canonicalPgserveSetupResult: string | null;
  /** Set to true the first time `setupCanonicalPgserve()` is called. */
  canonicalPgserveSetupCalled: boolean;
  /** Recorded saveServerConfig calls — tests assert what migration persists. */
  savedServerConfigs: Array<Partial<ServerConfig>>;
  /**
   * Result the stubbed `dumpEmbeddedDb()` returns. Default matches a fresh
   * install (`no-embedded-data`). Tests can override to exercise the
   * dumped or invalid paths.
   */
  dumpResult:
    | { status: 'no-embedded-data'; embeddedDir: string }
    | { status: 'embedded-data-invalid'; embeddedDir: string }
    | { status: 'dumped'; embeddedDir: string; snapshotPath: string; bytes: number };
  /** When set, the stubbed dump throws this error (simulates pg_dump failure). */
  dumpError: Error | null;
  /** Set to true the first time `dumpEmbeddedDb()` is called. */
  dumpCalled: boolean;
  /** When set, the stubbed restore throws this error (simulates psql failure). */
  restoreError: Error | null;
  /** Set to true the first time `restoreSnapshotToCanonical()` is called. */
  restoreCalled: boolean;
  /** Canonical data dir reported by the stubbed `getCanonicalPgserveDataDir()`. */
  canonicalDataDir: string;
  /**
   * Records the order in which fix-handler dependencies were invoked, so
   * tests can assert the correct dump → stop → install → restore → delete
   * → start sequence.
   */
  callOrder: Array<
    'pm2-stop-api' | 'dump-embedded' | 'setup-canonical' | 'restore-snapshot' | 'pm2-start-api' | 'pm2-delete-api'
  >;
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
    natsMaxRestarts: 10,
    apiPid: 1001,
    natsPid: 1002,
    portOwners: { 8882: 1001, 4222: 1002 },
    processKillCalls: [],
    pm2ConfOutput: HEALTHY_PM2_CONF,
    serverConfig: {
      port: 8882,
      databaseUrl: 'postgresql://postgres:postgres@localhost:8432/omni',
      dataDir: join(tmpdir(), 'omni-doctor-test'),
      logLevel: 'info',
      nodeEnv: 'production',
      // Default healthy harness: canonical pgserve already adopted (matches
      // the new fresh-install default). Tests that exercise the legacy
      // embedded path explicitly override `useCanonicalPgserve: false`.
      useCanonicalPgserve: true,
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
    // P2a defaults: no locked instances + no signing key → check is OK
    // ("nothing to assert"). Tests opt into the WARN path explicitly.
    lockedInstances: [],
    cliHasSigningKey: false,
    canonicalPgserveSetupResult: 'postgresql://postgres:postgres@localhost:8432/omni',
    canonicalPgserveSetupCalled: false,
    savedServerConfigs: [],
    dumpResult: { status: 'no-embedded-data', embeddedDir: '/tmp/omni-test/embedded' },
    dumpError: null,
    dumpCalled: false,
    restoreError: null,
    restoreCalled: false,
    canonicalDataDir: '/tmp/omni-test/canonical',
    callOrder: [],
    ...overrides,
  };
}

/**
 * Record a stubbed pm2 invocation. Mirrors the side-effects the real fix
 * handlers expect (key rotation, env drift clearing, logrotate keys) and
 * appends a coarse call-order trace so canonical-pgserve tests can assert
 * the stop → migrate → install → delete → start ordering. Extracted from
 * `mkDeps` so the dep closure stays under biome's complexity ceiling.
 */
/**
 * Mirror the real-world side-effect of `pm2 restart <name>`: when the
 * canonical port has no owner (squatter was killed in the previous fix
 * step) the pm2 child rebinds. Extracted so `recordPm2` stays under
 * biome's complexity ceiling.
 */
function reclaimPortAfterRestart(state: HarnessState, processName: string | undefined): void {
  if (processName === 'omni-nats' && state.portOwners[4222] === null) {
    state.portOwners[4222] = state.natsPid ?? null;
    return;
  }
  if (processName === 'omni-api') {
    const apiPort = state.serverConfig.port;
    if (state.portOwners[apiPort] === null) {
      state.portOwners[apiPort] = state.apiPid ?? null;
    }
  }
}

async function recordPm2(state: HarnessState, args: string[], env?: Record<string, string>): Promise<number> {
  state.pm2Calls.push({ args, env });

  // Coarse ordering trace for the canonical-pgserve migration tests.
  if (args[0] === 'stop' && args[1] === 'omni-api') state.callOrder.push('pm2-stop-api');
  else if (args[0] === 'start' && args[1] === 'omni-api') state.callOrder.push('pm2-start-api');
  else if (args[0] === 'delete' && args[1] === 'omni-api') state.callOrder.push('pm2-delete-api');

  // The cli-key-valid fix handler uses runPm2 to restart; flipping
  // keyFixApplied here lets the recheck pick up the "fixed" state.
  if (args[0] === 'restart' || args[0] === 'start') {
    state.keyFixApplied = true;
    if (state.pm2DriftAfterFix) state.pm2Drift = false;
    if (state.maxRestartsAfterFix !== undefined) state.apiMaxRestarts = state.maxRestartsAfterFix;
  }

  // The pm2-logrotate-installed fix re-runs `pm2 set pm2-logrotate:*`;
  // flip pm2ConfOutput to the post-fix state when the last key is set.
  if (args[0] === 'set' && args[1]?.startsWith('pm2-logrotate:') && state.pm2ConfAfterFix !== null) {
    state.pm2ConfOutput = state.pm2ConfAfterFix;
  }

  if (args[0] === 'restart') reclaimPortAfterRestart(state, args[1]);

  return state.pm2ExitCode;
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
          pid: state.apiPid,
          pm2_env: {
            status: state.apiStatus,
            env: pm2StoredEnv,
            max_restarts: state.apiMaxRestarts,
          },
        },
        {
          name: 'omni-nats',
          pid: state.natsPid,
          pm2_env: {
            status: state.natsStatus,
            env: {},
            max_restarts: state.natsMaxRestarts,
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
    runPm2: async (args: string[], env?: Record<string, string>) => recordPm2(state, args, env),
    saveCliConfig: (config: Config) => {
      state.cliConfig = { ...state.cliConfig, ...config };
    },
    reloadCliConfig: () => ({ ...state.cliConfig }),
    generateApiKey: () => 'omni_sk_rotated-test-key',
    sleepMs: async () => {
      // No real sleep in tests — we're deterministic.
    },
    capturePm2Conf: async () => state.pm2ConfOutput,
    listLockedInstances: async () => [...state.lockedInstances],
    cliHasSigningKey: () => state.cliHasSigningKey,
    setupCanonicalPgserve: async () => {
      state.canonicalPgserveSetupCalled = true;
      state.callOrder.push('setup-canonical');
      return state.canonicalPgserveSetupResult;
    },
    dumpEmbeddedDb: async (_currentUrl: string) => {
      state.dumpCalled = true;
      state.callOrder.push('dump-embedded');
      if (state.dumpError) throw state.dumpError;
      return state.dumpResult;
    },
    restoreSnapshotToCanonical: async (dump, _canonicalUrl: string) => {
      state.restoreCalled = true;
      state.callOrder.push('restore-snapshot');
      if (state.restoreError) throw state.restoreError;
      return dump.status === 'dumped'
        ? { status: 'restored' as const, snapshotPath: dump.snapshotPath }
        : { status: 'skipped' as const };
    },
    getCanonicalPgserveDataDir: () => state.canonicalDataDir,
    saveServerConfig: (partial) => {
      state.serverConfig = { ...state.serverConfig, ...partial };
      state.savedServerConfigs.push({ ...partial });
    },
    findPortOwner: async (port: number) => state.portOwners[port] ?? null,
    processKill: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => {
      state.processKillCalls.push({ pid, signal });
      // Simulate the squatter dying: any port owned by this PID becomes
      // unowned (null). The fixer's polling loop will then exit and the
      // subsequent `pm2 restart` reclaim handler (in recordPm2) reassigns.
      for (const portStr of Object.keys(state.portOwners)) {
        const port = Number(portStr);
        if (state.portOwners[port] === pid) state.portOwners[port] = null;
      }
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runDoctor — read-only mode', () => {
  test('reports all 12 checks with OK when state is healthy', async () => {
    // Match the harness version to whatever the CLI currently reports so
    // `version-match` is OK without hard-coding the CLI version here.
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    expect(report.checks).toHaveLength(12);
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
      'cli-signing-key-for-locked-instances',
      'pgserve-canonical',
      'port-canonical-owner',
    ]);
    for (const check of report.checks) {
      expect(check.level).toBe('OK');
    }
    expect(report.summary).toEqual({ ok: 12, warn: 0, fail: 0 });
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

  test('cli-signing-key-for-locked-instances OK when no instances are locked', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION, lockedInstances: [], cliHasSigningKey: false });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'cli-signing-key-for-locked-instances');
    expect(check?.level).toBe('OK');
    expect(check?.detail).toContain('no instances require signed requests');
  });

  test('cli-signing-key-for-locked-instances OK when locked instances + key present', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({
      serverVersion: VERSION,
      lockedInstances: [{ id: 'inst-1', name: 'whatsapp-prod' }],
      cliHasSigningKey: true,
    });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'cli-signing-key-for-locked-instances');
    expect(check?.level).toBe('OK');
    expect(check?.detail).toContain('CLI has a signing key');
  });

  test('cli-signing-key-for-locked-instances WARN when locked instances + no key', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({
      serverVersion: VERSION,
      lockedInstances: [
        { id: 'inst-1', name: 'whatsapp-prod' },
        { id: 'inst-2', name: 'telegram-prod' },
      ],
      cliHasSigningKey: false,
    });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'cli-signing-key-for-locked-instances');
    expect(check?.level).toBe('WARN');
    expect(check?.detail).toContain('whatsapp-prod');
    expect(check?.detail).toContain('telegram-prod');
    expect(check?.detail).toContain('omni trust handshake');
    // Operator's escape hatch is mentioned so they know they're not stuck.
    expect(check?.detail).toContain('unlock-only PATCH');
  });

  test('cli-signing-key-for-locked-instances WARN truncates list at 3 with "+N more" suffix', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({
      serverVersion: VERSION,
      lockedInstances: [
        { id: 'i1', name: 'a' },
        { id: 'i2', name: 'b' },
        { id: 'i3', name: 'c' },
        { id: 'i4', name: 'd' },
        { id: 'i5', name: 'e' },
      ],
      cliHasSigningKey: false,
    });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'cli-signing-key-for-locked-instances');
    expect(check?.level).toBe('WARN');
    expect(check?.detail).toContain('a, b, c');
    expect(check?.detail).toContain('+2 more');
    // Names beyond the first 3 are NOT in the message — keeps the warning
    // readable when an operator has many instances locked.
    expect(check?.detail).not.toContain(', d');
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
    expect(startCall?.env?.DATABASE_URL).toMatch(/postgres@(\/omni\?host=|[^/]+:8432\/omni)/);
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
    // Disable role-cutover sentinel reads so buildRuntimeEnv assertions
    // see the legacy postgres:postgres URL on hosts where the sentinel
    // file exists (Felipe's dogfood host).
    process.env.OMNI_ROLE_CUTOVER = '0';
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

// ---------------------------------------------------------------------------
// pgserve-canonical (canonical-pgserve-pm2-supervision wave 3)
// ---------------------------------------------------------------------------

describe('runDoctor — pgserve-canonical check', () => {
  test('OK when serverConfig.useCanonicalPgserve === true', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    // mkHarness defaults useCanonicalPgserve: true; this test asserts the
    // healthy path explicitly so the contract is captured even if the
    // default flips later.
    state.serverConfig = { ...state.serverConfig, useCanonicalPgserve: true };

    const report = await runDoctor({ fix: false }, mkDeps(state));
    const check = report.checks.find((c) => c.id === 'pgserve-canonical');

    expect(check?.level).toBe('OK');
    expect(check?.detail).toContain('canonical pgserve');
  });

  test('WARN when useCanonicalPgserve is undefined (legacy embedded install)', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    // Strip the canonical flag to simulate a pre-existing embedded install.
    state.serverConfig = { ...state.serverConfig, useCanonicalPgserve: undefined };

    const report = await runDoctor({ fix: false }, mkDeps(state));
    const check = report.checks.find((c) => c.id === 'pgserve-canonical');

    expect(check?.level).toBe('WARN');
    expect(check?.detail).toContain('embedded pgserve');
    expect(check?.detail).toContain('omni doctor --fix');
  });

  test('WARN when useCanonicalPgserve is explicitly false', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({
      serverVersion: VERSION,
      serverConfig: {
        port: 8882,
        databaseUrl: 'postgresql://postgres:postgres@localhost:8432/omni',
        dataDir: join(tmpdir(), 'omni-doctor-test'),
        logLevel: 'info',
        nodeEnv: 'production',
        useCanonicalPgserve: false,
      },
    });

    const report = await runDoctor({ fix: false }, mkDeps(state));
    const check = report.checks.find((c) => c.id === 'pgserve-canonical');
    expect(check?.level).toBe('WARN');
  });

  test('--fix migrates embedded → canonical: setup, persist, relaunch', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    state.serverConfig = { ...state.serverConfig, useCanonicalPgserve: false };
    state.canonicalPgserveSetupResult = 'postgresql://postgres:postgres@localhost:8432/omni';

    const report = await runDoctor({ fix: true }, mkDeps(state));

    // setupCanonicalPgserve was invoked
    expect(state.canonicalPgserveSetupCalled).toBe(true);
    // ServerConfig persisted with the canonical flag + url
    expect(state.savedServerConfigs).toHaveLength(1);
    expect(state.savedServerConfigs[0]).toMatchObject({
      databaseUrl: 'postgresql://postgres:postgres@localhost:8432/omni',
      useCanonicalPgserve: true,
    });
    // pm2 was relaunched (stop, then delete + start) so PGSERVE_EMBEDDED=false takes effect
    const pm2Cmds = state.pm2Calls.map((c) => c.args[0]);
    expect(pm2Cmds).toContain('stop');
    expect(pm2Cmds).toContain('delete');
    expect(pm2Cmds).toContain('start');
    // The `stop` MUST happen before `setupCanonicalPgserve` is invoked — otherwise
    // the embedded pgserve still holds port 8432 and `pgserve install` fails with
    // EADDRINUSE. We assert ordering by checking that stop is the first pm2 call.
    expect(pm2Cmds[0]).toBe('stop');
    // Fix was recorded with a useful detail line
    const migrationFix = report.fixesApplied.find((f) => f.includes('canonical pgserve'));
    expect(migrationFix).toBeDefined();
  });

  test('--fix runs pgserve-canonical FIRST so cli-key-valid does not cascade', async () => {
    // Reproduces the live bug found 2026-04-30: when omni-api is stopped
    // for the migration, cli-key-valid FAILed, and its fix rotated keys
    // while the api was unreachable, leaving env+DB out of sync.
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    state.serverConfig = { ...state.serverConfig, useCanonicalPgserve: false };
    // Simulate the cascade trigger: cli-key-valid FAILs initially, but
    // becomes OK after migration (because re-eval picks up the restored API).
    state.keyValid = false;
    state.keyValidAfterFix = true;
    state.canonicalPgserveSetupResult = 'postgresql://postgres:postgres@localhost:8432/omni';

    const report = await runDoctor({ fix: true }, mkDeps(state));

    // cli-key-valid fix MUST NOT have been invoked — pgserve-canonical fix ran
    // first, then re-evaluation picked up the recovered key state.
    const keyRotationFix = report.fixesApplied.find((f) => typeof f === 'string' && f.includes('rotated CLI key'));
    expect(keyRotationFix).toBeUndefined();
    // pgserve-canonical fix DID run.
    expect(state.canonicalPgserveSetupCalled).toBe(true);
  });

  test('--fix brings omni-api back up when canonical setup fails (no half-migrated state)', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    state.serverConfig = { ...state.serverConfig, useCanonicalPgserve: false };
    state.canonicalPgserveSetupResult = null;

    await runDoctor({ fix: true }, mkDeps(state));

    // Migration aborted — but fixPgserveCanonical must have started omni-api
    // back up so the operator isn't left with a stopped API.
    const pm2Cmds = state.pm2Calls.map((c) => c.args[0]);
    expect(pm2Cmds).toContain('stop');
    expect(pm2Cmds).toContain('start');
    // Stop happened before start (recovery ordering).
    const stopIdx = pm2Cmds.indexOf('stop');
    const startIdx = pm2Cmds.indexOf('start');
    expect(stopIdx).toBeLessThan(startIdx);
  });

  test('--fix records FAILED when setupCanonicalPgserve returns null', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    state.serverConfig = { ...state.serverConfig, useCanonicalPgserve: false };
    state.canonicalPgserveSetupResult = null;

    const report = await runDoctor({ fix: true }, mkDeps(state));

    // Setup was attempted
    expect(state.canonicalPgserveSetupCalled).toBe(true);
    // No config write — operator stays on embedded
    expect(state.savedServerConfigs).toHaveLength(0);
    // Fix recorded as failed (so the operator sees the actionable error)
    const failedFix = report.fixesApplied.find((f) => f.startsWith('FAILED pgserve-canonical'));
    expect(failedFix).toBeDefined();
    expect(failedFix).toContain('canonical pgserve setup failed');
  });

  test('--fix does NOT rotate cli-key when canonical-pgserve fix returned FAILED (cascade gating)', async () => {
    // Companion to the success-path cascade test above. When canonical
    // migration FAILS (setupCanonicalPgserve returns null), Phase 2 must
    // skip cascade-prone fixes that depend on omni-api being reachable
    // and DB+env in sync. Without this gating, cli-key-valid rotates the
    // key while api is still recovering from the failed migration,
    // leaving pm2 env out of sync with the DB hash — exact reproduction
    // of the pre-#580 cascade. See omni#583.
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    state.serverConfig = { ...state.serverConfig, useCanonicalPgserve: false };
    // Phase 1 will FAIL: setupCanonicalPgserve returns null -> "FAILED pgserve-canonical: ..."
    state.canonicalPgserveSetupResult = null;
    // cli-key-valid stays FAIL across Phase 1's recovery restart (the
    // live bug: api was actually unreachable, keyValid stayed false even
    // after pm2 start). With keyValidAfterFix=false the harness keeps
    // returning false from validateStoredKey, so Phase 2 sees the check
    // still FAIL and would normally invoke fixCliKeyValid — which is
    // exactly the cascade we are gating against.
    state.keyValid = false;
    state.keyValidAfterFix = false;

    const report = await runDoctor({ fix: true }, mkDeps(state));

    // Phase 1 attempted and FAILED.
    expect(state.canonicalPgserveSetupCalled).toBe(true);
    const failedFix = report.fixesApplied.find((f) => f.startsWith('FAILED pgserve-canonical'));
    expect(failedFix).toBeDefined();

    // cli-key-valid fix MUST NOT have run — no rotation message present.
    const rotatedKey = report.fixesApplied.find((f) => typeof f === 'string' && f.includes('rotated CLI key'));
    expect(rotatedKey).toBeUndefined();

    // SKIPPED entry recorded for cli-key-valid so the operator sees an
    // actionable explanation instead of a destructive rotation.
    const skippedKey = report.fixesApplied.find((f) => f.startsWith('SKIPPED cli-key-valid'));
    expect(skippedKey).toBeDefined();
    expect(skippedKey).toContain('failed canonical-pgserve migration');
  });

  // -------------------------------------------------------------------------
  // Embedded → canonical data migration via pg_dump + psql (issue #584)
  //
  // Before the data-migration step landed, `omni doctor --fix` flipped
  // `databaseUrl` to canonical without moving the existing PG cluster.
  // Operators with non-trivial data ended up on an empty canonical DB even
  // though their messages/chats/etc. were still on disk under
  // `~/.omni/data/pgserve/`. These tests pin the new ordering — mirroring
  // genie's `db backup` / `db restore` pattern (pg_dump → gzip → psql):
  //   dump (while embedded live) → stop omni-api → install canonical →
  //   restore snapshot → persist → relaunch.
  // -------------------------------------------------------------------------

  test('--fix runs dump → stop → install → restore → delete → start in that order', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    state.serverConfig = { ...state.serverConfig, useCanonicalPgserve: false };
    state.dumpResult = {
      status: 'dumped',
      embeddedDir: '/home/operator/.omni/data/pgserve',
      snapshotPath: '/home/operator/.omni/backups/embedded-migration-2026-04-30T23-30-00-000Z.sql.gz',
      bytes: 42_000_000,
    };
    state.canonicalDataDir = '/home/operator/.pgserve/data';

    const report = await runDoctor({ fix: true }, mkDeps(state));

    // All four side-effects ran
    expect(state.dumpCalled).toBe(true);
    expect(state.canonicalPgserveSetupCalled).toBe(true);
    expect(state.restoreCalled).toBe(true);

    // Required ordering: dump must come BEFORE stop (embedded must be live
    // for pg_dump). install must come BEFORE restore (canonical must exist
    // for psql to write into).
    const dumpIdx = state.callOrder.indexOf('dump-embedded');
    const stopIdx = state.callOrder.indexOf('pm2-stop-api');
    const setupIdx = state.callOrder.indexOf('setup-canonical');
    const restoreIdx = state.callOrder.indexOf('restore-snapshot');
    expect(dumpIdx).toBeGreaterThanOrEqual(0);
    expect(stopIdx).toBeGreaterThan(dumpIdx);
    expect(setupIdx).toBeGreaterThan(stopIdx);
    expect(restoreIdx).toBeGreaterThan(setupIdx);

    // Final result message surfaces the snapshot path AND the canonical data
    // dir so the operator can verify the destination without grepping logs.
    const fix = report.fixesApplied.find((f) => f.includes('canonical pgserve'));
    expect(fix).toBeDefined();
    expect(fix).toContain('embedded-migration-2026-04-30T23-30-00-000Z.sql.gz');
    expect(fix).toContain('/home/operator/.pgserve/data');
    expect(fix).toContain('postgresql://postgres:postgres@localhost:8432/omni');
  });

  test('--fix on a fresh install (no embedded data) skips dump+restore and proceeds', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    state.serverConfig = { ...state.serverConfig, useCanonicalPgserve: false };
    state.canonicalDataDir = '/home/operator/.pgserve/data';
    // Default dumpResult is already 'no-embedded-data'; explicit for readability.
    state.dumpResult = { status: 'no-embedded-data', embeddedDir: '/home/operator/.omni/data/pgserve' };

    const report = await runDoctor({ fix: true }, mkDeps(state));

    // Dump probe ran (so we don't second-guess) but returned no-op.
    expect(state.dumpCalled).toBe(true);
    expect(state.canonicalPgserveSetupCalled).toBe(true);
    // Restore was still called but skipped internally (status === 'skipped')
    // because dump status was no-embedded-data.
    expect(state.restoreCalled).toBe(true);
    expect(state.savedServerConfigs).toHaveLength(1);
    const fix = report.fixesApplied.find((f) => f.includes('canonical pgserve'));
    expect(fix).toContain('no embedded data to migrate; canonical started empty');
    expect(fix).toContain('/home/operator/.pgserve/data');
  });

  test('--fix rolls back omni-api to embedded when pg_dump throws (omni-api never stopped)', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    state.serverConfig = { ...state.serverConfig, useCanonicalPgserve: false };
    state.dumpError = new Error('pg_dump not found in PATH — install postgresql-client');

    const report = await runDoctor({ fix: true }, mkDeps(state));

    expect(state.dumpCalled).toBe(true);
    // We never proceeded past dump — no stop, no setup, no restore.
    expect(state.callOrder).not.toContain('pm2-stop-api');
    expect(state.canonicalPgserveSetupCalled).toBe(false);
    expect(state.restoreCalled).toBe(false);
    expect(state.savedServerConfigs).toHaveLength(0);

    const failedFix = report.fixesApplied.find((f) => f.startsWith('FAILED pgserve-canonical'));
    expect(failedFix).toBeDefined();
    expect(failedFix).toContain('pg_dump of embedded omni DB failed');
    expect(failedFix).toContain('postgresql-client');
  });

  test('--fix rolls back to embedded + preserves snapshot when restore fails', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    state.serverConfig = { ...state.serverConfig, useCanonicalPgserve: false };
    state.dumpResult = {
      status: 'dumped',
      embeddedDir: '/home/op/.omni/data/pgserve',
      snapshotPath: '/home/op/.omni/backups/embedded-migration-2026-04-30T23-31-00-000Z.sql.gz',
      bytes: 12_345_678,
    };
    state.restoreError = new Error('ERROR: relation "messages" already exists');

    const report = await runDoctor({ fix: true }, mkDeps(state));

    // Sequence reached restore but failed there
    expect(state.dumpCalled).toBe(true);
    expect(state.canonicalPgserveSetupCalled).toBe(true);
    expect(state.restoreCalled).toBe(true);

    // omni-api must have been brought back up so operator isn't dead.
    expect(state.callOrder).toContain('pm2-stop-api');
    expect(state.callOrder).toContain('pm2-start-api');
    const stopIdx = state.callOrder.indexOf('pm2-stop-api');
    const startIdx = state.callOrder.indexOf('pm2-start-api');
    expect(startIdx).toBeGreaterThan(stopIdx);

    // No config write — embedded mode preserved.
    expect(state.savedServerConfigs).toHaveLength(0);

    // Failure message includes the snapshot path so operators can replay
    // manually with `gunzip -c <path> | psql <canonical-url>`.
    const failedFix = report.fixesApplied.find((f) => f.startsWith('FAILED pgserve-canonical'));
    expect(failedFix).toBeDefined();
    expect(failedFix).toContain('psql restore into canonical pgserve failed');
    expect(failedFix).toContain('snapshot preserved at /home/op/.omni/backups/embedded-migration-');
    expect(failedFix).toContain('relation "messages" already exists');
  });
});

// ---------------------------------------------------------------------------
// pm2-max-restarts now covers omni-nats too (post-port-canonical-owner wish)
// ---------------------------------------------------------------------------

describe('runDoctor — pm2-max-restarts covers omni-nats', () => {
  test('FAIL when omni-nats max_restarts is 0 even though omni-api is healthy', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION, apiMaxRestarts: 10, natsMaxRestarts: 0 });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'pm2-max-restarts');
    expect(check?.level).toBe('FAIL');
    expect(check?.detail).toContain('omni-nats');
    expect(check?.detail).toContain('max_restarts=0');
    expect(check?.detail).toContain('unbounded');
  });

  test('FAIL when omni-nats has no max_restarts set', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION, natsMaxRestarts: undefined });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'pm2-max-restarts');
    expect(check?.level).toBe('FAIL');
    expect(check?.detail).toContain('omni-nats has no max_restarts set');
  });

  test('OK when both api and nats are in the hardened range', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION, apiMaxRestarts: 10, natsMaxRestarts: 10 });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'pm2-max-restarts');
    expect(check?.level).toBe('OK');
  });
});

// ---------------------------------------------------------------------------
// port-canonical-owner — orphan squatter detection + reclaim
//
// 2026-05-07 incident reproduction: orphan nats-server from a previous
// session held 4222, pm2 omni-nats crash-looped 75 times trying to bind.
// The check identifies the squatter PID and the fixer reclaims the port
// (SIGTERM → SIGKILL → pm2 restart). A safety guard refuses to kill a
// PID that is itself pm2-managed under another name.
// ---------------------------------------------------------------------------

describe('runDoctor — port-canonical-owner check', () => {
  test('OK when every canonical port is owned by its pm2-managed PID', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({ serverVersion: VERSION });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'port-canonical-owner');
    expect(check?.level).toBe('OK');
    expect(check?.detail).toContain('all canonical ports owned by pm2-managed processes');
  });

  test('FAIL when an orphan PID holds 4222 instead of pm2 omni-nats', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({
      serverVersion: VERSION,
      // Orphan PID 9999 squats on 4222; pm2 omni-nats child PID is 1002.
      portOwners: { 8882: 1001, 4222: 9999 },
    });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'port-canonical-owner');
    expect(check?.level).toBe('FAIL');
    expect(check?.detail).toContain('omni-nats:4222');
    expect(check?.detail).toContain('pid=9999');
    expect(check?.detail).toContain('pm2 child pid=1002');
  });

  test('OK is silent when no listener exists yet (pm2-status flags it instead)', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({
      serverVersion: VERSION,
      // Nothing listening on 4222 yet (pm2 still starting).
      portOwners: { 8882: 1001, 4222: null },
    });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: false }, deps);

    const check = report.checks.find((c) => c.id === 'port-canonical-owner');
    // No listener → no squatter to flag. Other checks (pm2-status) cover
    // the "managed process not running" case so we don't double-report.
    expect(check?.level).toBe('OK');
  });
});

describe('runDoctor — port-canonical-owner --fix', () => {
  test('SIGTERMs the squatter, polls until it exits, then pm2 restart claims the port', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({
      serverVersion: VERSION,
      portOwners: { 8882: 1001, 4222: 9999 },
    });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: true }, deps);

    // The squatter received SIGTERM (no SIGKILL needed — harness simulates
    // a graceful exit on first signal).
    const term = state.processKillCalls.find((c) => c.pid === 9999 && c.signal === 'SIGTERM');
    expect(term).toBeDefined();
    // pm2 restart omni-nats was issued so pm2 reclaims 4222.
    const restart = state.pm2Calls.find((c) => c.args[0] === 'restart' && c.args[1] === 'omni-nats');
    expect(restart).toBeDefined();
    // Recheck shows the port is now owned by the pm2 child PID.
    const check = report.checks.find((c) => c.id === 'port-canonical-owner');
    expect(check?.level).toBe('OK');
    // Fix message mentions the reclaim.
    expect(report.fixesApplied.some((f) => f.includes('reclaimed') && f.includes('pid=9999'))).toBe(true);
  });

  test('refuses to kill a squatter that is itself pm2-managed under another name', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({
      serverVersion: VERSION,
      // Worst-case foot-gun: omni-api's pid is somehow listening on 4222.
      // The fixer must NOT kill it — that would crash a sibling channel
      // process. Instead it records SKIPPED with the explanation.
      portOwners: { 8882: 1001, 4222: 1001 },
    });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: true }, deps);

    // No kill ever issued for a pm2-managed PID.
    expect(state.processKillCalls.find((c) => c.pid === 1001)).toBeUndefined();
    // Skip message recorded so the operator sees why.
    const skipped = report.fixesApplied.find(
      (f) => f.includes('SKIPPED') && f.includes('pm2-managed') && f.includes('pid=1001'),
    );
    expect(skipped).toBeDefined();
  });

  test('escalates to SIGKILL when the squatter does not exit after SIGTERM', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({
      serverVersion: VERSION,
      portOwners: { 8882: 1001, 4222: 9999 },
    });
    // Override processKill to ignore SIGTERM (squatter is unkillable
    // gracefully) so the fixer must escalate to SIGKILL after polling.
    const deps: DoctorDeps = {
      ...mkDeps(state),
      processKill: (pid, signal) => {
        state.processKillCalls.push({ pid, signal });
        if (signal === 'SIGKILL') {
          // SIGKILL always wins.
          for (const portStr of Object.keys(state.portOwners)) {
            const port = Number(portStr);
            if (state.portOwners[port] === pid) state.portOwners[port] = null;
          }
        }
        return true;
      },
    };

    await runDoctor({ fix: true }, deps);

    // Both signals must have been sent in order.
    const signals = state.processKillCalls.filter((c) => c.pid === 9999).map((c) => c.signal);
    expect(signals).toContain('SIGTERM');
    expect(signals).toContain('SIGKILL');
    expect(signals.indexOf('SIGTERM')).toBeLessThan(signals.indexOf('SIGKILL'));
  });
});

describe('runDoctor — pm2-status --fix dispatches port reconciliation', () => {
  test('FAIL pm2-status with port squatter triggers reclaim + restart', async () => {
    const { VERSION } = await import('../version.js');
    const state = mkHarness({
      serverVersion: VERSION,
      // pm2 nats is in the crash-loop "waiting restart" state because the
      // orphan owns 4222. This is the exact 2026-05-07 incident shape.
      natsStatus: 'errored',
      portOwners: { 8882: 1001, 4222: 9999 },
    });
    const deps = mkDeps(state);

    const report = await runDoctor({ fix: true }, deps);

    // The orphan was killed.
    expect(state.processKillCalls.find((c) => c.pid === 9999)).toBeDefined();
    // pm2 restart omni-nats was issued.
    expect(state.pm2Calls.find((c) => c.args[0] === 'restart' && c.args[1] === 'omni-nats')).toBeDefined();
    // The pm2-status fix entry mentions the reclaim outcome.
    const fix = report.fixesApplied.find((f) => f.includes('reclaimed') || f.includes('restarted omni-nats'));
    expect(fix).toBeDefined();
  });
});
