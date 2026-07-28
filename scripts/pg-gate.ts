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

import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDisposableCluster, destroyDisposableCluster, resolvePgBinaries } from './disposable-pg-cluster';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const packagesDir = join(repoRoot, 'packages');

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
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const suites = findPostgresSuites(packagesDir).sort();
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
    process.exit(1);
  }
}

const binaries = resolvePgBinaries();
const env: Record<string, string> = { ...(process.env as Record<string, string>) };
for (const variable of POSTGRES_URL_VARS) env[variable] = url;
// The suites shell out to psql; point them at whichever client we resolved.
for (const variable of [
  'OMNI_G1_PSQL_BIN',
  'OMNI_G2_PSQL_BIN',
  'OMNI_G3_PSQL_BIN',
  'OMNI_G4_PSQL_BIN',
  'OMNI_G6_PSQL_BIN',
])
  env[variable] = binaries.psql;

let exitCode = 1;
try {
  const child = Bun.spawnSync({
    cmd: ['bun', 'test', ...suites],
    cwd: repoRoot,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = `${child.stdout.toString()}${child.stderr.toString()}`;
  process.stdout.write(output);

  // --- assert nothing skipped ---------------------------------------------
  const skipped = /(\d+)\s+skip/.exec(output);
  const skipCount = skipped ? Number(skipped[1]) : 0;
  const ran = /(\d+)\s+pass/.exec(output);
  const passCount = ran ? Number(ran[1]) : 0;

  const problems: string[] = [];
  if (child.exitCode !== 0) problems.push(`bun test exited ${child.exitCode}`);
  if (skipCount > 0) problems.push(`${skipCount} test(s) SKIPPED — the gate requires every suite to run`);
  if (passCount === 0) problems.push('no tests passed — the suites did not execute');
  // Every discovered suite must have RUN. `bun test` prints a per-file header
  // only when a file produced output, so presence-of-filename is not a usable
  // signal; the trailing "Ran N tests across M files" is.
  const acrossFiles = /across\s+(\d+)\s+files?/.exec(output);
  const filesRun = acrossFiles ? Number(acrossFiles[1]) : 0;
  if (filesRun !== suites.length) {
    problems.push(`bun test ran ${filesRun} file(s), expected ${suites.length}`);
  }

  if (problems.length > 0) {
    process.stderr.write(`\npg-gate: FAILED\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    exitCode = 1;
  } else {
    process.stdout.write(`\npg-gate: PASSED — ${passCount} assertions across ${suites.length} suites, 0 skipped\n`);
    exitCode = 0;
  }
} finally {
  if (dataDir && !process.argv.includes('--keep')) {
    destroyDisposableCluster(dataDir);
    process.stdout.write('pg-gate: disposable cluster destroyed\n');
  } else if (dataDir) {
    process.stdout.write(`pg-gate: cluster KEPT at ${dataDir} (destroy it yourself)\n`);
  }
}

process.exit(exitCode);
