/**
 * Contract tests for the online (CONCURRENTLY) index phase and its boot-path
 * preflight (wish: omni-full-multitenancy, Group G2).
 *
 * The runner talks to PostgreSQL, but everything worth pinning is decidable
 * without one: that the phase never emits a blocking index build, that it
 * repairs an INVALID index instead of skipping it forever, and — the part that
 * turns a crash-loop into one actionable error — that `applyMigrations()`
 * refuses to start a blocking 0041 build on a table too large to finish inside
 * the boot budget, while staying a no-op everywhere else.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from './client';
import { BLOCKING_INDEX_OVERRIDE_ENV_VAR, assertOnlineDdlPreflight } from './migrate';
import { ONLINE_DDL_COMMAND, applyOnlineTenantDdl, checkOnlineDdlPreflight, onlineIndexStatements } from './online-ddl';
import { addColumnStatements, allIndexStatements } from './tenancy-ownership';

const dialect = new PgDialect();
const here = dirname(fileURLToPath(import.meta.url));

type Rows = unknown[];

/** A `Database` that records rendered SQL and answers from a canned handler. */
function stubDb(handler: (text: string) => Rows = () => []): { db: Database; executed: string[] } {
  const executed: string[] = [];
  const db = {
    execute: async (query: unknown): Promise<Rows> => {
      const text =
        typeof query === 'string' ? query : dialect.sqlToQuery(query as Parameters<typeof dialect.sqlToQuery>[0]).sql;
      executed.push(text);
      return handler(text);
    },
    transaction: async () => {
      throw new Error('the online phase must never open a transaction');
    },
  };
  return { db: db as unknown as Database, executed };
}

const HIGH_VOLUME_INDEXES = allIndexStatements()
  .filter((s) => s.volume === 'high')
  .map((s) => s.statement);

const ALL_INDEX_NAMES = allIndexStatements().map((s) => s.statement.name);

/** Answers the preflight's two catalog queries. */
function preflightHandler(options: {
  usableIndexes: readonly string[];
  estimates: Record<string, number>;
  probe?: number;
}): (text: string) => Rows {
  return (text) => {
    if (text.includes('pg_index')) return options.usableIndexes.map((relname) => ({ relname }));
    if (text.includes('reltuples')) {
      return Object.entries(options.estimates).map(([relname, reltuples]) => ({ relname, reltuples }));
    }
    if (text.includes('probe')) return [{ n: options.probe ?? 0 }];
    return [];
  };
}

describe('online index statements', () => {
  test('every index is built CONCURRENTLY and never blocks', () => {
    const statements = onlineIndexStatements();
    expect(statements.length).toBe(ALL_INDEX_NAMES.length);
    for (const { statement } of statements) {
      expect(statement).toContain('CONCURRENTLY');
      expect(statement).toContain('IF NOT EXISTS');
    }
  });
});

describe('applyOnlineTenantDdl', () => {
  test('adds every nullable column, then builds every index, in one non-transactional pass', async () => {
    const { db, executed } = stubDb(preflightHandler({ usableIndexes: [], estimates: {} }));
    const report = await applyOnlineTenantDdl(db);

    for (const statement of addColumnStatements()) expect(executed).toContain(statement);
    expect(report.built).toEqual(ALL_INDEX_NAMES);
    expect(report.repaired).toEqual([]);
    // A blocking build inside this phase would defeat its entire purpose.
    for (const text of executed) {
      if (text.startsWith('CREATE')) expect(text).toContain('CONCURRENTLY');
    }
    expect(executed.some((t) => /^BEGIN/i.test(t))).toBe(false);
  });

  test('an INVALID index left by an interrupted build is dropped and rebuilt, not skipped', async () => {
    const broken = ALL_INDEX_NAMES[0] as string;
    const { db, executed } = stubDb((text) => (text.includes('pg_index') ? [{ relname: broken }] : []));
    const report = await applyOnlineTenantDdl(db);

    expect(report.repaired).toEqual([broken]);
    expect(executed).toContain(`DROP INDEX CONCURRENTLY IF EXISTS "${broken}";`);
    expect(report.built).toContain(broken);
  });

  test('progress is reported per statement', async () => {
    const kinds: string[] = [];
    const { db } = stubDb();
    await applyOnlineTenantDdl(db, (step) => kinds.push(step.kind));
    expect(kinds.filter((k) => k === 'column').length).toBe(addColumnStatements().length);
    expect(kinds.filter((k) => k === 'index').length).toBe(ALL_INDEX_NAMES.length);
  });
});

describe('boot-path preflight', () => {
  test('an already-migrated database is not blocked and costs one catalog query', async () => {
    const { db, executed } = stubDb(preflightHandler({ usableIndexes: ALL_INDEX_NAMES, estimates: {} }));
    const preflight = await checkOnlineDdlPreflight(db);
    expect(preflight.blocked).toBe(false);
    expect(preflight.blockers).toEqual([]);
    expect(executed).toHaveLength(1);
  });

  test('a fresh install (tables absent from pg_class) is not blocked', async () => {
    const { db } = stubDb(preflightHandler({ usableIndexes: [], estimates: {} }));
    expect((await checkOnlineDdlPreflight(db)).blocked).toBe(false);
  });

  test('a small database is not blocked even with every index pending', async () => {
    const estimates = Object.fromEntries(HIGH_VOLUME_INDEXES.map((s) => [s.table, 1_000]));
    const { db } = stubDb(preflightHandler({ usableIndexes: [], estimates }));
    expect((await checkOnlineDdlPreflight(db)).blocked).toBe(false);
  });

  test('a large table with a pending index build is blocked, and named', async () => {
    const table = HIGH_VOLUME_INDEXES[0]?.table as string;
    const { db } = stubDb(preflightHandler({ usableIndexes: [], estimates: { [table]: 5_000_000 } }));
    const preflight = await checkOnlineDdlPreflight(db);

    expect(preflight.blocked).toBe(true);
    expect(preflight.blockers.map((b) => b.table)).toEqual([table]);
    expect(preflight.blockers[0]?.missingIndexes.length).toBeGreaterThan(0);
  });

  test('a never-analyzed table falls back to a bounded probe rather than trusting reltuples = -1', async () => {
    const table = HIGH_VOLUME_INDEXES[0]?.table as string;
    const handler = preflightHandler({ usableIndexes: [], estimates: { [table]: -1 }, probe: 2_000_000 });
    const { db, executed } = stubDb(handler);
    const preflight = await checkOnlineDdlPreflight(db, 1_000);

    expect(preflight.blocked).toBe(true);
    expect(executed.some((t) => t.includes('LIMIT 1000'))).toBe(true);
  });

  test('an INVALID index counts as missing — a half-built index is not coverage', async () => {
    const table = HIGH_VOLUME_INDEXES[0]?.table as string;
    // Catalog reports every index EXCEPT the invalid one for this table.
    const usable = ALL_INDEX_NAMES.filter((n) => n !== HIGH_VOLUME_INDEXES[0]?.name);
    const { db } = stubDb(preflightHandler({ usableIndexes: usable, estimates: { [table]: 5_000_000 } }));
    expect((await checkOnlineDdlPreflight(db)).blocked).toBe(true);
  });
});

describe('applyMigrations guard', () => {
  const largeTable = HIGH_VOLUME_INDEXES[0]?.table as string;
  const blocked = preflightHandler({ usableIndexes: [], estimates: { [largeTable]: 5_000_000 } });

  test('refuses with an actionable message instead of crash-looping on a timed-out build', async () => {
    const { db } = stubDb(blocked);
    const error = await assertOnlineDdlPreflight(db, { env: {} }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(ONLINE_DDL_COMMAND);
    expect((error as Error).message).toContain(largeTable);
    expect((error as Error).message).toContain(BLOCKING_INDEX_OVERRIDE_ENV_VAR);
  });

  test('the operator override accepts the downtime and proceeds', async () => {
    const { db, executed } = stubDb(blocked);
    await assertOnlineDdlPreflight(db, { env: { [BLOCKING_INDEX_OVERRIDE_ENV_VAR]: 'on' } });
    expect(executed).toEqual([]);
  });

  test('a small or migrated database passes silently — the guard is a no-op by default', async () => {
    const { db } = stubDb(preflightHandler({ usableIndexes: ALL_INDEX_NAMES, estimates: {} }));
    await assertOnlineDdlPreflight(db, { env: {} });
  });
});

describe('db:online-ddl is a real command', () => {
  test('the documented script exists and points at a file that exists', () => {
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>;
    };
    const script = pkg.scripts['db:online-ddl'];
    expect(script).toBeDefined();
    const target = (script as string).replace(/^bun run /, '');
    expect(readFileSync(join(here, '..', target), 'utf-8')).toContain('applyOnlineTenantDdl');
  });

  test('the command 0041 and the generator tell operators to run is the one that exists', () => {
    const generator = readFileSync(join(here, '..', 'scripts', 'generate-tenant-ownership-sql.ts'), 'utf-8');
    expect(generator).toContain('db:online-ddl');
    expect(ONLINE_DDL_COMMAND).toContain('db:online-ddl');
  });
});
