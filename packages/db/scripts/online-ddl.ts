#!/usr/bin/env bun
/**
 * Online DDL phase for the G2 additive ownership schema
 * (wish: omni-full-multitenancy, Group G2).
 *
 * This is the `db:online-ddl` command that migration 0041 and
 * `generate-tenant-ownership-sql.ts` tell the operator to run FIRST on a large
 * database. It adds the nullable `tenant_id` columns (catalog-only, instant) and
 * builds every G2 index with `CREATE INDEX CONCURRENTLY` — no long lock, and
 * resumable, because an INVALID index left by an interrupted build is dropped
 * and rebuilt rather than skipped forever by `IF NOT EXISTS`.
 *
 * Usage:
 *   bun run db:online-ddl --url <postgres-url> [--check]
 *
 *   --url    REQUIRED. The target database. `DATABASE_URL` is deliberately NOT
 *            read: index builds against "whatever was in the environment" is
 *            not an accident worth enabling.
 *   --check  Report the preflight (which high-volume tables still need indexes,
 *            and how big they are) and exit without changing anything.
 *
 * Afterwards run `bun run db:migrate`: 0041 finds every column and index present
 * and only adds the `NOT VALID` constraints and triggers, taking no long lock.
 * On a fresh or small install this phase is unnecessary — the migration alone
 * creates everything and this runner is then a no-op.
 */

import { applyOnlineTenantDdl, checkOnlineDdlPreflight, createDbHandle } from '../src/index';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const url = option('url');
if (!url) {
  process.stderr.write(
    'db:online-ddl: --url <postgres-url> is required.\n' +
      'DATABASE_URL is deliberately NOT consulted — name the target explicitly.\n',
  );
  process.exit(2);
}

// A concurrent build must never share a pooled connection that is inside a
// transaction; one connection, used serially, is the whole requirement.
const handle = createDbHandle({ url, maxConnections: 1 });

try {
  const preflight = await checkOnlineDdlPreflight(handle.db);
  process.stdout.write(
    preflight.blocked
      ? `preflight: ${preflight.blockers.length} high-volume table(s) at or above ${preflight.threshold} rows need indexes\n`
      : 'preflight: no high-volume table needs a long index build (this phase is optional here)\n',
  );
  for (const blocker of preflight.blockers) {
    process.stdout.write(
      `  - ${blocker.table}: ~${Math.round(blocker.estimatedRows)} rows, missing ${blocker.missingIndexes.join(', ')}\n`,
    );
  }

  if (flag('check')) process.exit(0);

  const report = await applyOnlineTenantDdl(handle.db, (step) => {
    process.stdout.write(`  ${step.kind}: ${step.name}\n`);
  });
  process.stdout.write(
    `online DDL complete: ${report.steps.length} statements, ${report.built.length} indexes, ` +
      `${report.repaired.length} repaired.\nNext: bun run db:migrate\n`,
  );
  process.exit(0);
} finally {
  await handle.close();
}
