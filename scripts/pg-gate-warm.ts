#!/usr/bin/env bun
/**
 * Keep-warm wrapper around scripts/pg-gate.ts (#967).
 *
 * A cold `make test-pg-gate` spends ~15-20s standing up a disposable cluster
 * (initdb + postmaster start) that it destroys at the end. For a dev loop that
 * runs the gate repeatedly, this wrapper creates that cluster ONCE, remembers
 * it in `.pg-gate-warm.json` (gitignored), and reruns the gate against it with
 * `--url`. The gate itself is byte-identical: same suites, same zero-skip /
 * file-count contract. Because the migrated-template cache (see
 * packages/db/src/pg-migrated-template.ts) lives inside the kept cluster, warm
 * reruns also skip the per-suite migration replays.
 *
 * The kept cluster is still disposable by construction — loopback only, random
 * port, generated credential — and `stop` destroys it exactly like the gate's
 * own teardown would.
 *
 * Usage:
 *   bun scripts/pg-gate-warm.ts run      # create-if-needed, then run the gate
 *   bun scripts/pg-gate-warm.ts stop     # destroy the kept cluster + state
 *   bun scripts/pg-gate-warm.ts status   # is a kept cluster alive?
 */

import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createDisposableCluster, destroyDisposableCluster, resolvePgBinaries } from './disposable-pg-cluster';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const stateFile = join(repoRoot, '.pg-gate-warm.json');

const WarmStateSchema = z.object({
  url: z.string().url(),
  dataDir: z.string().min(1),
  port: z.number().int().positive(),
});
type WarmState = z.infer<typeof WarmStateSchema>;

async function readState(): Promise<WarmState | null> {
  if (!existsSync(stateFile)) return null;
  try {
    return WarmStateSchema.parse(await Bun.file(stateFile).json());
  } catch {
    // Unreadable or hand-mangled state: treat as absent, clean it up.
    rmSync(stateFile, { force: true });
    return null;
  }
}

/** A cluster only counts as warm when it actually answers a query. */
function isAlive(state: WarmState): boolean {
  const result = Bun.spawnSync({
    cmd: [resolvePgBinaries().psql, '-X', '--no-psqlrc', '-A', '-t', '--dbname', state.url, '-c', 'SELECT 1'],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return result.exitCode === 0 && result.stdout.toString().trim() === '1';
}

function destroyState(state: WarmState): void {
  destroyDisposableCluster(state.dataDir);
  rmSync(stateFile, { force: true });
}

async function ensureWarmCluster(): Promise<WarmState> {
  const existing = await readState();
  if (existing) {
    if (isAlive(existing)) {
      process.stdout.write(`pg-gate-warm: reusing kept cluster on 127.0.0.1:${existing.port}\n`);
      return existing;
    }
    process.stdout.write('pg-gate-warm: kept cluster is dead — destroying and recreating\n');
    destroyState(existing);
  }
  const cluster = await createDisposableCluster();
  const state: WarmState = { url: cluster.url, dataDir: cluster.dataDir, port: cluster.port };
  await Bun.write(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  process.stdout.write(`pg-gate-warm: created kept cluster on 127.0.0.1:${state.port}\n`);
  return state;
}

const command = process.argv[2];

if (command === 'run') {
  const state = await ensureWarmCluster();
  const gate = Bun.spawnSync({
    cmd: ['bun', join(here, 'pg-gate.ts'), '--url', state.url],
    cwd: repoRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  process.stdout.write(`pg-gate-warm: cluster kept on 127.0.0.1:${state.port} — \`make pg-gate-warm-stop\` to drop\n`);
  process.exit(gate.exitCode ?? 1);
} else if (command === 'stop') {
  const state = await readState();
  if (!state) {
    process.stdout.write('pg-gate-warm: no kept cluster\n');
  } else {
    destroyState(state);
    process.stdout.write('pg-gate-warm: kept cluster destroyed\n');
  }
} else if (command === 'status') {
  const state = await readState();
  if (!state) {
    process.stdout.write('pg-gate-warm: no kept cluster\n');
  } else {
    process.stdout.write(
      `pg-gate-warm: 127.0.0.1:${state.port} (${isAlive(state) ? 'alive' : 'DEAD'}) at ${state.dataDir}\n`,
    );
  }
} else {
  process.stderr.write('usage: pg-gate-warm.ts run | stop | status\n');
  process.exit(2);
}
