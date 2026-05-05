/**
 * update-maintenance tests
 *
 * Covers the post-update maintenance hook:
 *   - `resolveMaintenanceSkipReason` precedence (verify-failed > cli-flag > env).
 *   - `runPostUpdateMaintenance` skip / completed / failed paths.
 *   - `formatMaintenanceSummary` exact one-line shape.
 *   - `runDoctor({ dryRun: true })` contract — read-only even with fix=true.
 *
 * The actual `runDoctor` call is exercised via the helper's `runDoctorImpl`
 * injection point so we never monkey-patch the doctor module — bun's
 * `mock.module` leaks across test files and would corrupt `doctor.test.ts`.
 */

import { describe, expect, test } from 'bun:test';
import { type DoctorDeps, type DoctorReport, runDoctor } from '../commands/doctor.js';
import {
  OMNI_UPDATE_SKIP_MAINTENANCE_ENV,
  formatMaintenanceSummary,
  resolveMaintenanceSkipReason,
  runPostUpdateMaintenance,
} from '../commands/update.js';
import type { Config, ServerConfig } from '../config.js';

// -----------------------------------------------------------------------------
// resolveMaintenanceSkipReason — pure precedence logic
// -----------------------------------------------------------------------------

describe('resolveMaintenanceSkipReason', () => {
  test('returns null when verify is ok and no opt-out is set', () => {
    expect(
      resolveMaintenanceSkipReason({
        verifyOk: true,
        skipMaintenance: undefined,
        env: {},
      }),
    ).toBeNull();
  });

  test('returns "verify-failed" first, ignoring flag and env', () => {
    expect(
      resolveMaintenanceSkipReason({
        verifyOk: false,
        skipMaintenance: true,
        env: { [OMNI_UPDATE_SKIP_MAINTENANCE_ENV]: '1' },
      }),
    ).toBe('verify-failed');
  });

  test('returns "cli-flag" when verify ok and --skip-maintenance set', () => {
    expect(
      resolveMaintenanceSkipReason({
        verifyOk: true,
        skipMaintenance: true,
        env: {},
      }),
    ).toBe('cli-flag');
  });

  test('returns "env" when verify ok, no flag, env set to "1"', () => {
    expect(
      resolveMaintenanceSkipReason({
        verifyOk: true,
        skipMaintenance: undefined,
        env: { [OMNI_UPDATE_SKIP_MAINTENANCE_ENV]: '1' },
      }),
    ).toBe('env');
  });

  test('returns "env" for any non-empty truthy env value', () => {
    for (const value of ['1', 'true', 'yes', 'on', 'TRUE']) {
      expect(
        resolveMaintenanceSkipReason({
          verifyOk: true,
          skipMaintenance: undefined,
          env: { [OMNI_UPDATE_SKIP_MAINTENANCE_ENV]: value },
        }),
      ).toBe('env');
    }
  });

  test('returns null for env "0" / "false" / empty string', () => {
    for (const value of ['0', 'false', 'False', 'FALSE', '']) {
      expect(
        resolveMaintenanceSkipReason({
          verifyOk: true,
          skipMaintenance: undefined,
          env: { [OMNI_UPDATE_SKIP_MAINTENANCE_ENV]: value },
        }),
      ).toBeNull();
    }
  });

  test('cli-flag wins over env when both set and verify ok', () => {
    expect(
      resolveMaintenanceSkipReason({
        verifyOk: true,
        skipMaintenance: true,
        env: { [OMNI_UPDATE_SKIP_MAINTENANCE_ENV]: '1' },
      }),
    ).toBe('cli-flag');
  });
});

// -----------------------------------------------------------------------------
// runPostUpdateMaintenance — skip / completed / failed paths
// -----------------------------------------------------------------------------

describe('runPostUpdateMaintenance', () => {
  const baseReport: DoctorReport = {
    checks: [],
    summary: { ok: 12, warn: 0, fail: 0 },
    fixesApplied: [],
  };

  test('returns { outcome: "skipped" } when skipReason is set, never calls runDoctor', async () => {
    let called = false;
    const report = await runPostUpdateMaintenance({
      skipReason: 'cli-flag',
      runDoctorImpl: async () => {
        called = true;
        return baseReport;
      },
    });
    expect(report.outcome).toBe('skipped');
    expect(report.skipReason).toBe('cli-flag');
    expect(report.durationMs).toBe(0);
    expect(called).toBe(false);
  });

  test('returns { outcome: "completed", doctorReport } when runDoctor succeeds', async () => {
    const report = await runPostUpdateMaintenance({
      skipReason: null,
      runDoctorImpl: async () => baseReport,
    });
    expect(report.outcome).toBe('completed');
    expect(report.doctorReport).toBe(baseReport);
    expect(typeof report.durationMs).toBe('number');
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.skipReason).toBeUndefined();
    expect(report.error).toBeUndefined();
  });

  test('returns { outcome: "failed", error } when runDoctor throws', async () => {
    const report = await runPostUpdateMaintenance({
      skipReason: null,
      runDoctorImpl: async () => {
        throw new Error('pgserve unreachable');
      },
    });
    expect(report.outcome).toBe('failed');
    expect(report.error).toBe('pgserve unreachable');
    expect(report.doctorReport).toBeUndefined();
    expect(typeof report.durationMs).toBe('number');
  });

  test('captures non-Error throw values via String() coercion', async () => {
    const report = await runPostUpdateMaintenance({
      skipReason: null,
      runDoctorImpl: async () => {
        throw 'string-thrown';
      },
    });
    expect(report.outcome).toBe('failed');
    expect(report.error).toBe('string-thrown');
  });

  test('passes { json: true, dryRun: true } to the injected runDoctor', async () => {
    let captured: { json?: boolean; dryRun?: boolean; fix?: boolean } | null = null;
    await runPostUpdateMaintenance({
      skipReason: null,
      runDoctorImpl: async (opts) => {
        captured = opts;
        return baseReport;
      },
    });
    expect(captured).not.toBeNull();
    expect(captured?.json).toBe(true);
    expect(captured?.dryRun).toBe(true);
    // fix must NOT be set — the post-update probe stays read-only.
    expect(captured?.fix).toBeUndefined();
  });

  test('skip reasons round-trip correctly', async () => {
    for (const reason of ['verify-failed', 'cli-flag', 'env'] as const) {
      const report = await runPostUpdateMaintenance({ skipReason: reason });
      expect(report.outcome).toBe('skipped');
      expect(report.skipReason).toBe(reason);
    }
  });
});

// -----------------------------------------------------------------------------
// formatMaintenanceSummary — exact line-shape lock
// -----------------------------------------------------------------------------

describe('formatMaintenanceSummary', () => {
  test('renders the documented "Maintenance: X ok, Y warn, Z fail" line', () => {
    const report: DoctorReport = {
      checks: [],
      summary: { ok: 12, warn: 0, fail: 0 },
      fixesApplied: [],
    };
    expect(formatMaintenanceSummary(report)).toBe('Maintenance: 12 ok, 0 warn, 0 fail');
  });

  test('renders zero counts cleanly', () => {
    const report: DoctorReport = {
      checks: [],
      summary: { ok: 0, warn: 0, fail: 0 },
      fixesApplied: [],
    };
    expect(formatMaintenanceSummary(report)).toBe('Maintenance: 0 ok, 0 warn, 0 fail');
  });

  test('renders mixed counts in the correct order', () => {
    const report: DoctorReport = {
      checks: [],
      summary: { ok: 8, warn: 2, fail: 1 },
      fixesApplied: [],
    };
    expect(formatMaintenanceSummary(report)).toBe('Maintenance: 8 ok, 2 warn, 1 fail');
  });
});

// -----------------------------------------------------------------------------
// runDoctor dryRun contract — defeats accidental fix:true injection
// -----------------------------------------------------------------------------

describe('runDoctor dryRun contract', () => {
  // Build a minimal deps stub. Any pm2/config mutation method throws so
  // a regression that lets fix handlers run will fail loudly.
  function makeReadOnlyDeps(): DoctorDeps {
    const serverConfig: ServerConfig = {
      port: 8882,
      databaseUrl: 'postgres://localhost/omni',
      useCanonicalPgserve: true,
    } as ServerConfig;
    const cliConfig: Config = { apiKey: 'k', apiUrl: 'http://localhost:8882' } as Config;
    return {
      getPm2Processes: async () => [],
      canConnect: async () => true,
      omniDbExists: async () => true,
      findOrphanedDataDirs: () => [],
      fetchHealthVersion: async () => '0.0.0-test',
      validateStoredKey: async () => true,
      loadState: () => ({ serverConfig, cliConfig }),
      runPm2: async () => {
        throw new Error('runPm2 must NOT be called in dry-run');
      },
      saveCliConfig: () => {
        throw new Error('saveCliConfig must NOT be called in dry-run');
      },
      reloadCliConfig: () => cliConfig,
      generateApiKey: () => 'rotated',
      sleepMs: async () => {},
      capturePm2Conf: async () => 'pm2-logrotate compress true rotateInterval 0 0 * * * max_size 10M retain 30',
      listLockedInstances: async () => [],
      cliHasSigningKey: () => true,
      setupCanonicalPgserve: async () => 'postgres://localhost/omni',
      dumpEmbeddedDb: async () => ({ status: 'no-embedded-data' }),
      restoreSnapshotToCanonical: async () => ({ status: 'skipped' }),
      getCanonicalPgserveDataDir: () => '/tmp/canonical',
      saveServerConfig: () => {
        throw new Error('saveServerConfig must NOT be called in dry-run');
      },
    };
  }

  test('runDoctor with dryRun=true does not invoke fix handlers even when fix=true', async () => {
    const deps = makeReadOnlyDeps();
    const report = await runDoctor({ json: true, dryRun: true, fix: true }, deps);
    expect(report.fixesApplied).toEqual([]);
  });

  test('runDoctor without dryRun honors fix=false (no fix handlers run)', async () => {
    const deps = makeReadOnlyDeps();
    const report = await runDoctor({ json: true, fix: false }, deps);
    expect(report.fixesApplied).toEqual([]);
  });
});
