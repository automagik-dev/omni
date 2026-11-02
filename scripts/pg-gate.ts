#!/usr/bin/env bun
/**
 * The real-PostgreSQL gate (wish: omni-full-multitenancy, Group G3).
 *
 * WHY THIS EXISTS
 * ---------------
 * G2's independent review filed this as its top carry-forward finding: the
 * real-PostgreSQL suites are opt-in, keyed on `OMNI_G1_POSTGRES_URL` /
 * `OMNI_G2_POSTGRES_URL`, and `describe.skip` themselves into silence when the
 * variable is unset. A normal `bun test` run therefore reports a comfortable
 * green while every isolation assertion — the ones that actually prove tenant
 * containment — never executed. A skipped security test is worse than a missing
 * one, because it looks like coverage.
 *
 * This gate is the loud path. It:
 *
 *   1. stands up a DISPOSABLE cluster (or accepts one via `--url`);
 *   2. exports EVERY real-PG opt-in variable from that one URL, so no
 *      `*-postgres.test.ts` in the repository can skip;
 *   3. runs them;
 *   4. FAILS when a server is unavailable, when any suite skipped, or when the
 *      set of discovered `*-postgres.test.ts` files is not the set that ran.
 *
 * Step 4 is the part that matters. Adding a new `*-postgres.test.ts` without
 * wiring its env var here fails the gate rather than silently skipping, so the
 * gate cannot rot the way the G1/G2 suites did.
 *
 * Plain `bun test` keeps its opt-in skipping — that is a convenience for a
 * laptop with no server, and it is not a gate.
 *
 * Usage:
 *   bun scripts/pg-gate.ts                 # ephemeral cluster, created and destroyed
 *   bun scripts/pg-gate.ts --url <url>     # use an existing DISPOSABLE database
 *   bun scripts/pg-gate.ts --keep          # leave the cluster up for debugging
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
// Do not import suite setup here: it validates inherited OMNI_G* URLs at load.
// The gate first acquires its own target, then replaces those URLs for its child.
import { assertPgTestTarget } from '../packages/db/src/pg-test-target';
import {
  createDisposableCluster,
  destroyDisposableCluster,
  isDisposablePgPort,
  onDisposableExit,
  resolvePgBinaries,
} from './disposable-pg-cluster';
import { reportPgGateResult } from './pg-gate-report';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const packagesDir = join(repoRoot, 'packages');
const releaseTestsDir = join(repoRoot, 'tests', 'release');

/**
 * Every opt-in variable a `*-postgres.test.ts` in this repository reads.
 *
 * All of them are set to the SAME disposable URL. Each suite creates its own
 * database underneath it, so they do not collide.
 */
const POSTGRES_URL_VARS = [
  'OMNI_G1_POSTGRES_URL',
  'OMNI_G2_POSTGRES_URL',
  'OMNI_G3_POSTGRES_URL',
  'OMNI_G4_POSTGRES_URL',
  'OMNI_G6_POSTGRES_URL',
] as const;

/** Discover the suites the gate is responsible for. */
function findPostgresSuites(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.turbo') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findPostgresSuites(full, out);
    else if (/-postgres\.test\.ts$/.test(entry)) out.push(relative(repoRoot, full));
  }
  return out;
}

function option(name: string): string | undefined {
  const flag = `--${name}`;
  const argument = process.argv.find((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (argument === undefined) return undefined;
  const value = argument === flag ? process.argv[process.argv.indexOf(flag) + 1] : argument.slice(flag.length + 1);
  if (!value || value.startsWith('--')) throw new Error(`pg-gate: ${flag} requires a value`);
  return value;
}

const suites = [...findPostgresSuites(packagesDir), ...findPostgresSuites(releaseTestsDir)].sort();
if (suites.length === 0) {
  process.stderr.write('pg-gate: found no *-postgres.test.ts suites — the discovery glob is broken.\n');
  process.exit(1);
}

process.stdout.write(`pg-gate: ${suites.length} real-PostgreSQL suites\n`);
for (const suite of suites) process.stdout.write(`  ${suite}\n`);

// --- acquire a server -------------------------------------------------------
const explicitUrl = option('url');
let url = explicitUrl ?? '';
let dataDir: string | null = null;

let outputDir: string | null = null;
let childProcess: ReturnType<typeof Bun.spawn> | null = null;
const keep = process.argv.includes('--keep');
let keptReported = false;
const binaries = resolvePgBinaries();
const cleanup = () => {
  childProcess?.kill();
  if (outputDir) {
    rmSync(outputDir, { recursive: true, force: true });
    outputDir = null;
  }
  if (dataDir && !keep) {
    destroyDisposableCluster(dataDir, binaries);
    dataDir = null;
  } else if (dataDir && !keptReported) {
    process.stdout.write(`pg-gate: cluster KEPT at ${dataDir} (destroy it yourself)\n`);
    keptReported = true;
  }
};
const release = onDisposableExit(cleanup);
let exitCode = 1;
try {
  if (explicitUrl) {
    const parsed = new URL(explicitUrl);
    if (explicitUrl.includes('?') || parsed.hostname !== '127.0.0.1' || !isDisposablePgPort(Number(parsed.port))) {
      throw new Error('pg-gate: requires 127.0.0.1 on a disposable port (never 5432 or 15432)');
    }
    assertPgTestTarget(explicitUrl, { ...process.env, OMNI_PG_TEST_TARGET: parsed.host });
  }
  if (!explicitUrl) {
    try {
      const cluster = await createDisposableCluster();
      url = cluster.url;
      dataDir = cluster.dataDir;
      process.stdout.write(`pg-gate: disposable cluster on 127.0.0.1:${cluster.port}\n`);
    } catch (error) {
      // LOUD, not skipped. This is the exact failure mode the gate exists for.
      process.stderr.write(
        `pg-gate: FAILED — no PostgreSQL server is available and none could be created.\n  ${error instanceof Error ? error.message : String(error)}\n  Install a PostgreSQL SERVER build (initdb + postgres in the same directory),\n  set OMNI_PG_BIN_DIR to it, or pass --url pointing at a DISPOSABLE database.\n  The gate does not skip.\n`,
      );
      throw error;
    }
  }

  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const variable of POSTGRES_URL_VARS) env[variable] = url;
  // Test helpers accept TCP only at this gate's explicitly acquired target.
  env.OMNI_PG_TEST_TARGET = new URL(url).host;
  // The shared preflight checks postgres.js resolved options without connecting.
  assertPgTestTarget(url, env);
  // Mute the app logger under the gate unless the caller asked for logs (#967):
  // the suites intentionally exercise warn/error paths and the JSON flood is
  // pure I/O on green runs. bun test's own failure diagnostics are unaffected.
  if (!env.LOG_LEVEL) env.LOG_LEVEL = 'silent';
  // The suites shell out to psql; point them at whichever client we resolved.
  for (const variable of [
    'OMNI_G1_PSQL_BIN',
    'OMNI_G2_PSQL_BIN',
    'OMNI_G3_PSQL_BIN',
    'OMNI_G4_PSQL_BIN',
    'OMNI_G6_PSQL_BIN',
  ])
    env[variable] = binaries.psql;

  // The PostgreSQL suites can emit several MiB of NOTICE output. Bun's
  // synchronous in-memory pipe has a fixed capacity and kills the child when
  // it fills, so spool both streams to disposable files before parsing the
  // summary. The longer timeout covers integration-scale index assertions.
  outputDir = mkdtempSync(join(tmpdir(), 'omni-pg-gate-output-'));
  const { child, output } = await (async () => {
    try {
      const stdoutPath = join(outputDir, 'stdout');
      const stderrPath = join(outputDir, 'stderr');
      const child = Bun.spawn({
        cmd: ['bun', 'test', '--timeout', '30000', ...suites],
        cwd: repoRoot,
        env,
        stdout: Bun.file(stdoutPath),
        stderr: Bun.file(stderrPath),
      });
      childProcess = child;
      await child.exited;
      childProcess = null;
      return {
        child,
        output: `${readFileSync(stdoutPath, 'utf-8')}${readFileSync(stderrPath, 'utf-8')}`,
      };
    } finally {
      if (outputDir) rmSync(outputDir, { recursive: true, force: true });
      outputDir = null;
    }
  })();

  // Name failing suites before any NOTICE flood; retain every byte in a separate log.
  exitCode = reportPgGateResult(output, suites, child.exitCode);
} finally {
  const destroyed = dataDir && !keep;
  cleanup();
  release();
  if (destroyed) {
    process.stdout.write('pg-gate: disposable cluster destroyed\n');
  }
}

process.exitCode = exitCode;
