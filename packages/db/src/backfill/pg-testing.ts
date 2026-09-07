/**
 * Shared disposable-cluster harness for the G6 real-PostgreSQL suites.
 *
 * Generic ONLY: it creates/drops databases, applies the committed migrations
 * (read from disk, never spelled out here), and hands back a tooling connection.
 * It contains NO literal tenant-table SQL — every fixture lives inside a
 * `*-postgres.test.ts` file, which the db-access guard's scanner excludes — so
 * this helper adds zero sites to the guard.
 *
 * Not a test file itself; imported by direct path from the G6 postgres suites.
 */

import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionMigratedDatabase } from '../pg-migrated-template';
import { type ToolingSql, openToolingConnection } from './db';

/** The disposable superuser URL every G6 suite keys on (via the pg-gate). */
export function superUrl(): string {
  return process.env.OMNI_G6_POSTGRES_URL ?? process.env.OMNI_G4_POSTGRES_URL ?? '';
}

export function psqlBin(): string {
  return process.env.OMNI_G6_PSQL_BIN ?? process.env.OMNI_G4_PSQL_BIN ?? 'psql';
}

export interface SqlResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Run a script through psql against `url` (used for DDL/migrations/fixtures). */
export function runSqlOn(url: string, script: string): SqlResult {
  const file = join(tmpdir(), `omni-g6-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [psqlBin(), '-X', '--no-psqlrc', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  } finally {
    rmSync(file, { force: true });
  }
}

export function runSqlOrThrow(url: string, script: string): void {
  const result = runSqlOn(url, script);
  if (result.exitCode !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
}

/** Build a URL for a specific database on the same disposable cluster. */
export function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Create a fresh database on the disposable cluster with every committed
 * migration applied — a file-level clone of the migrated template (#967), so
 * the chain is replayed once per cluster instead of once per call — and run an
 * optional fixture script. Returns the database name and its URL.
 */
export function provisionDatabase(base: string, fixture?: string): { database: string; url: string } {
  const database = `omni_g6_${crypto.randomUUID().replaceAll('-', '')}`;
  provisionMigratedDatabase({ superUrl: base, psqlBin: psqlBin() }, database);
  const url = urlFor(base, database);
  if (fixture) runSqlOrThrow(url, fixture);
  return { database, url };
}

export function dropDatabase(base: string, database: string): void {
  runSqlOn(base, `DROP DATABASE IF EXISTS "${database}" WITH (FORCE);`);
}

/** Open a tooling connection to a provisioned database. Caller must `end()`. */
export function connect(url: string): ToolingSql {
  return openToolingConnection(url);
}
