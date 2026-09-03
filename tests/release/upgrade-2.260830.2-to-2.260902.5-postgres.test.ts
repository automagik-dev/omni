/**
 * Release-boundary rehearsal for v2.260830.2 -> v2.260902.5.
 *
 * The suite is discovered by scripts/pg-gate.ts and therefore runs only on
 * the disposable loopback PostgreSQL cluster created by that gate. It never
 * reads DATABASE_URL or any application data.
 *
 * The boundary ships exactly one migration, 0052, which adds two nullable
 * columns to `webhook_sources`. The rehearsal starts from the byte-pinned
 * 0051 schema, seeds the drizzle bookkeeping the way a deployed 2.260830.2
 * database carries it, and then drives the REAL journaled migrator
 * (`applyMigrations` from packages/db/src/migrate.ts) so that the journal
 * guard, the advisory lock, and the count check are exercised rather than
 * simulated.
 *
 * The migrator is pointed at a candidate folder materialised from the live
 * `packages/db/drizzle`: exactly the files the 2.260902.5 image ships
 * (0000-0052) and a journal truncated to idx 0-52. Both the drizzle migrator
 * and the count guard read `meta/_journal.json` from the folder they are
 * given, so migrations added to the live folder after this hop (0053+) belong
 * to later rehearsals and never leak into this one. The digest and pinning
 * helpers still read the live folder: the bytes must not drift.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDbHandle } from '../../packages/db/src/client';
import { applyMigrations } from '../../packages/db/src/migrate';
import { RLS_TENANT_TABLES, contextFunctionStatements, tablePolicyStatements } from '../../packages/db/src/tenancy-rls';

const postgresUrl = process.env.OMNI_G2_POSTGRES_URL ?? '';
const postgresDescribe = postgresUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G2_PSQL_BIN ?? 'psql';
const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', 'packages', 'db', 'drizzle');
const journalPath = join(drizzleDir, 'meta', '_journal.json');

const PREVIOUS_RELEASE_LAST_MIGRATION = '0051_message_pin_star.sql';
const PREVIOUS_RELEASE_MIGRATION_COUNT = 52;
const TARGET_MIGRATIONS = ['0052_webhook_source_signature.sql'] as const;
const TARGET_MIGRATION = TARGET_MIGRATIONS[0];
const TARGET_JOURNAL_IDX = 52;
const TARGET_TABLE = 'webhook_sources';
const TARGET_COLUMNS = ['signature_config', 'signature_secret'] as const;

// SHA-256 over each sorted `filename + NUL + bytes + NUL`. This pins the exact
// deployed SQL without requiring release tags to be present in a CI clone.
// The 0000-0051 digest is the 2.260830.2 database boundary; the 0040-0051
// digest is the previous runbook's target set and must not drift either.
const PREVIOUS_RELEASE_MIGRATIONS_SHA256 = '9dbd44a3a020bee315d552a4e454714a45722740eb0f454d5a931b8fc0f4a3f7';
const PREVIOUS_HOP_MIGRATIONS_SHA256 = '6837fab414b2ae5831cc1f7657fa2cb6b8f20c57bf9960f22ceb1b1bbda9c772';
const TARGET_MIGRATIONS_SHA256 = 'f0199e0fbf6e73de7d59eec3fefad899a9bc4f40df57645d03875c67ccc7adfe';

interface JournalEntry {
  readonly idx: number;
  readonly when: number;
  readonly tag: string;
}

const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as { entries: JournalEntry[] } & Record<string, unknown>;
const journalEntries = journal.entries;

const migrationFiles = readdirSync(drizzleDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();
const previousReleaseMigrations = migrationFiles.filter((file) => file <= PREVIOUS_RELEASE_LAST_MIGRATION);
// What the 2.260902.5 image ships: 0000-0052 and the matching journal prefix.
const candidateMigrations = migrationFiles.filter((file) => file <= TARGET_MIGRATION);
const candidateJournalEntries = journalEntries.filter((entry) => entry.idx <= TARGET_JOURNAL_IDX);

function migrationSql(file: string): string {
  return readFileSync(join(drizzleDir, file), 'utf-8');
}

function migrationDigest(files: readonly string[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(migrationSql(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** drizzle-orm's per-file bookkeeping hash: SHA-256 over the whole file text. */
function drizzleFileHash(file: string): string {
  return createHash('sha256').update(migrationSql(file)).digest('hex');
}

function journalEntry(idx: number): JournalEntry {
  const entry = journalEntries.find((candidate) => candidate.idx === idx);
  if (!entry) throw new Error(`journal has no entry with idx ${idx}`);
  return entry;
}

/**
 * The migrations folder exactly as the 2.260902.5 image ships it: the `.sql`
 * files through 0052 (byte-identical copies of the live files) and a journal
 * with the real top-level shape but only entries idx 0-52. drizzle reads
 * `meta/_journal.json` and then `<tag>.sql` for every entry from this folder,
 * and `applyMigrations` counts the same journal for its guard.
 */
function materializeCandidateMigrations(): string {
  const dir = mkdtempSync(join(tmpdir(), 'omni-release-candidate-'));
  mkdirSync(join(dir, 'meta'));
  for (const file of candidateMigrations) copyFileSync(join(drizzleDir, file), join(dir, file));
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: candidateJournalEntries }, null, 2),
  );
  return dir;
}

interface SqlResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runSqlOn(url: string, script: string): SqlResult {
  const file = join(tmpdir(), `omni-release-upgrade-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [psqlBin, '-X', '--no-psqlrc', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } finally {
    rmSync(file, { force: true });
  }
}

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

describe('release migration artifacts', () => {
  test('the source and target boundaries stay byte-for-byte pinned', () => {
    expect(previousReleaseMigrations).toHaveLength(PREVIOUS_RELEASE_MIGRATION_COUNT);
    const targetReleaseMigrations = migrationFiles.filter(
      (file) => file > PREVIOUS_RELEASE_LAST_MIGRATION && file <= TARGET_MIGRATION,
    );
    expect(targetReleaseMigrations).toEqual([...TARGET_MIGRATIONS]);
    expect(candidateMigrations).toEqual([...previousReleaseMigrations, ...TARGET_MIGRATIONS]);
    expect(migrationDigest(previousReleaseMigrations)).toBe(PREVIOUS_RELEASE_MIGRATIONS_SHA256);
    expect(
      migrationDigest(previousReleaseMigrations.filter((file) => file > '0039_instances_message_supersede_mode.sql')),
    ).toBe(PREVIOUS_HOP_MIGRATIONS_SHA256);
    expect(migrationDigest(TARGET_MIGRATIONS)).toBe(TARGET_MIGRATIONS_SHA256);
  });

  test('the journal accepts idx 52 with a strictly later `when` than idx 51', () => {
    // packages/db/src/migrate.ts documents the failure mode: drizzle silently
    // skips a migration whose journal `when` is not later than the last applied
    // row's created_at, and the count guard only catches it after the fact.
    // Only the prefix the candidate ships is under test; later entries (0053+)
    // belong to later hops and are excluded from the materialised folder.
    expect(candidateJournalEntries).toHaveLength(PREVIOUS_RELEASE_MIGRATION_COUNT + TARGET_MIGRATIONS.length);
    expect(journalEntries.slice(0, candidateJournalEntries.length)).toEqual(candidateJournalEntries);
    candidateJournalEntries.forEach((entry, position) => {
      expect(entry.idx).toBe(position);
      expect(candidateMigrations[position]).toBe(`${entry.tag}.sql`);
      if (position > 0) expect(entry.when).toBeGreaterThan(journalEntry(position - 1).when);
    });
    const previous = journalEntry(TARGET_JOURNAL_IDX - 1);
    const target = journalEntry(TARGET_JOURNAL_IDX);
    expect(`${previous.tag}.sql`).toBe(PREVIOUS_RELEASE_LAST_MIGRATION);
    expect(`${target.tag}.sql`).toBe(TARGET_MIGRATION);
    expect(target.when).toBeGreaterThan(previous.when);
    expect(candidateJournalEntries.at(-1)).toEqual(target);
  });

  test('0052 is additive, idempotent, transaction-free, and touches no policy or data', () => {
    const sql = migrationSql(TARGET_MIGRATION);
    const statements = sql
      .split('\n')
      .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith('--'))
      .map((line) => line.trim());
    expect(statements).toEqual(
      TARGET_COLUMNS.map(
        (column) =>
          `ALTER TABLE "${TARGET_TABLE}" ADD COLUMN IF NOT EXISTS "${column}" ${column === 'signature_config' ? 'jsonb' : 'text'};`,
      ),
    );
    // The boot migrator runs the file inside its own transaction on a pooled
    // postgres-js connection; raw transaction control would be rejected.
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|START TRANSACTION|ROLLBACK)\b/im);
    expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE|DROP|POLICY|ROW LEVEL SECURITY|NOT NULL|DEFAULT)\b/i);
  });

  test('the tenancy RLS contract for webhook_sources does not depend on the new columns', () => {
    expect(RLS_TENANT_TABLES).toContain(TARGET_TABLE);
    const policyDdl = tablePolicyStatements(TARGET_TABLE).join('\n');
    expect(policyDdl).toContain('"tenant_id" = public.omni_current_tenant_id()');
    for (const column of TARGET_COLUMNS) expect(policyDdl).not.toContain(column);
  });
});

postgresDescribe('v2.260830.2 -> v2.260902.5 release rehearsal (real PostgreSQL)', () => {
  let database = '';
  let databaseUrl = '';
  let candidateDrizzleDir = '';
  let handle: ReturnType<typeof createDbHandle> | null = null;

  function runSql(script: string): SqlResult {
    return runSqlOn(databaseUrl, script);
  }

  function runOrThrow(script: string): void {
    const result = runSql(script);
    if (result.exitCode !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  }

  function scalar(query: string): string {
    const result = runSql(query);
    if (result.exitCode !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
    return result.stdout.trim();
  }

  function columnCount(): string {
    return scalar(`
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${TARGET_TABLE}';
      `);
  }

  function signatureColumns(): string {
    return scalar(`
        SELECT string_agg(column_name || ':' || data_type || '/' || is_nullable || '/' || coalesce(column_default, 'none'), ',' ORDER BY column_name)
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${TARGET_TABLE}'
          AND column_name IN ('${TARGET_COLUMNS.join("','")}');
      `);
  }

  function appliedMigrationCount(): string {
    return scalar('SELECT count(*) FROM "drizzle"."__drizzle_migrations";');
  }

  /**
   * Everything on `webhook_sources` that 0052 must leave alone: row-level
   * security flags and policies, the 0041 ownership trigger, constraints
   * (PK, unique, tenant FK), and indexes.
   */
  function catalogFingerprint(): string {
    return scalar(`
        SELECT string_agg(line, E'\\n' ORDER BY line) FROM (
          SELECT 'rls:' || c.relrowsecurity::text || '/' || c.relforcerowsecurity::text AS line
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = '${TARGET_TABLE}'
          UNION ALL
          SELECT 'policy:' || policyname || '|' || cmd || '|' || coalesce(qual, '-') || '|' || coalesce(with_check, '-')
          FROM pg_policies WHERE schemaname = 'public' AND tablename = '${TARGET_TABLE}'
          UNION ALL
          SELECT 'trigger:' || tgname FROM pg_trigger
          WHERE tgrelid = 'public.${TARGET_TABLE}'::regclass AND NOT tgisinternal
          UNION ALL
          SELECT 'constraint:' || conname || '|' || contype::text FROM pg_constraint
          WHERE conrelid = 'public.${TARGET_TABLE}'::regclass
          UNION ALL
          SELECT 'index:' || indexname FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = '${TARGET_TABLE}'
        ) AS catalog;
      `);
  }

  beforeAll(() => {
    database = `omni_release_upgrade_${crypto.randomUUID().replaceAll('-', '')}`;
    const created = runSqlOn(postgresUrl, `CREATE DATABASE "${database}";`);
    if (created.exitCode !== 0) throw new Error(`could not create disposable database: ${created.stderr}`);
    databaseUrl = urlFor(postgresUrl, database);
    handle = createDbHandle({ url: databaseUrl, maxConnections: 2 });
    candidateDrizzleDir = materializeCandidateMigrations();
  });

  afterAll(async () => {
    if (handle) await handle.close();
    if (database) runSqlOn(postgresUrl, `DROP DATABASE IF EXISTS "${database}" WITH (FORCE);`);
    if (candidateDrizzleDir) rmSync(candidateDrizzleDir, { recursive: true, force: true });
  });

  test('applies 0052 once through the journaled migrator and proves image-only rollback safe', async () => {
    if (!handle) throw new Error('database handle was not created');
    const db = handle.db;

    // The v2.260830.2 boundary: every migration through 0051, applied in order.
    for (const migration of previousReleaseMigrations) runOrThrow(migrationSql(migration));
    expect(columnCount()).toBe('10');
    expect(signatureColumns()).toBe('');

    // Rows shaped the way 2.260830.2 writes them. The second one supplies a
    // tenant, which the 0041 `unowned` trigger deliberately discards: webhook
    // sources have no FK-covered parent, so ownership stays NULL (G0 rule).
    runOrThrow(`
        INSERT INTO tenants (
          id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget
        ) VALUES (
          '40000000-0000-4000-8000-000000000001',
          'release-rehearsal',
          'Release rehearsal',
          3600,
          100,
          1000
        );
        INSERT INTO webhook_sources (id, name, description, expected_headers)
        VALUES (
          '40000000-0000-4000-8000-000000000002',
          'old-github',
          'header presence only',
          '{"X-GitHub-Event": true}'::jsonb
        );
        INSERT INTO webhook_sources (id, name, tenant_id)
        VALUES (
          '40000000-0000-4000-8000-000000000003',
          'old-owned',
          '40000000-0000-4000-8000-000000000001'
        );
      `);
    expect(scalar(`SELECT coalesce(tenant_id::text, 'NULL') FROM webhook_sources WHERE name = 'old-owned';`)).toBe(
      'NULL',
    );

    // Enforcement-mode catalog state: the tenancy policies an enforced
    // 2.260830.2 database already carries on this table. 0052 must not
    // disturb them. The policies are the repository's own generators, so the
    // rehearsal tracks the real predicate rather than a copy of it.
    runOrThrow([...contextFunctionStatements(), ...tablePolicyStatements(TARGET_TABLE)].join('\n'));
    const fingerprintBefore = catalogFingerprint();
    expect(fingerprintBefore).toContain('rls:true/true');
    expect(fingerprintBefore.match(/^policy:/gm)).toHaveLength(4);
    expect(fingerprintBefore).toContain('trigger:webhook_sources_tenant_ownership_trg');
    expect(fingerprintBefore).toContain('constraint:webhook_sources_tenant_fk|f');

    // Drizzle bookkeeping as a deployed 2.260830.2 database carries it: one
    // row per applied file, `created_at` = journal `when`, hash = SHA-256 of
    // the file text (packages/db/src/migrate.ts relies on this table for its
    // count guard; drizzle's own skip rule compares `when` against the last
    // row's `created_at`).
    const bookkeepingRows = previousReleaseMigrations
      .map((file, position) => `('${drizzleFileHash(file)}', ${journalEntry(position).when})`)
      .join(',\n');
    runOrThrow(`
        CREATE SCHEMA IF NOT EXISTS "drizzle";
        CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        );
        INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ${bookkeepingRows};
      `);
    expect(appliedMigrationCount()).toBe(String(PREVIOUS_RELEASE_MIGRATION_COUNT));

    // The real boot path: advisory lock, drizzle migrator, count guard — fed
    // the candidate folder so only the 0052 hop is on the table.
    await applyMigrations(db, candidateDrizzleDir);

    const target = journalEntry(TARGET_JOURNAL_IDX);
    expect(appliedMigrationCount()).toBe(String(PREVIOUS_RELEASE_MIGRATION_COUNT + 1));
    expect(
      scalar(`
          SELECT hash || '@' || created_at FROM "drizzle"."__drizzle_migrations"
          ORDER BY created_at DESC LIMIT 1;
        `),
    ).toBe(`${drizzleFileHash(TARGET_MIGRATION)}@${target.when}`);

    // Exactly the two documented columns, nullable, no default, no backfill.
    expect(columnCount()).toBe('12');
    expect(signatureColumns()).toBe('signature_config:jsonb/YES/none,signature_secret:text/YES/none');
    expect(
      scalar(`
          SELECT count(*) || '/' || count(*) FILTER (WHERE signature_config IS NULL AND signature_secret IS NULL)
          FROM webhook_sources;
        `),
    ).toBe('2/2');

    // RLS flags, policies, trigger, constraints, and indexes are untouched.
    expect(catalogFingerprint()).toBe(fingerprintBefore);

    // Re-running the migrator is a no-op, and — unlike 0045 — the raw file is
    // also safe to replay by hand because every statement is IF NOT EXISTS.
    await applyMigrations(db, candidateDrizzleDir);
    expect(appliedMigrationCount()).toBe(String(PREVIOUS_RELEASE_MIGRATION_COUNT + 1));
    const rawReplay = runSql(migrationSql(TARGET_MIGRATION));
    expect(rawReplay.exitCode).toBe(0);
    expect(rawReplay.stderr).toContain('already exists, skipping');
    expect(columnCount()).toBe('12');

    // Mixed-version writes: an old-shaped insert (2.260830.2 omits the new
    // columns) and a target-shaped insert coexist on the same table.
    runOrThrow(`
        INSERT INTO webhook_sources (id, name)
        VALUES ('40000000-0000-4000-8000-000000000004', 'late-old-write');
        INSERT INTO webhook_sources (id, name, signature_config, signature_secret)
        VALUES (
          '40000000-0000-4000-8000-000000000005',
          'signed-target-write',
          '{"algorithm":"hmac-sha256","header":"X-Hub-Signature-256","prefix":"sha256="}'::jsonb,
          'sealed:rehearsal-only-not-a-real-secret'
        );
      `);
    expect(
      scalar(`
          SELECT coalesce(signature_config->>'algorithm', 'NULL') || '/' || coalesce(signature_secret, 'NULL')
          FROM webhook_sources WHERE name = 'late-old-write';
        `),
    ).toBe('NULL/NULL');
    expect(scalar(`SELECT signature_config->>'header' FROM webhook_sources WHERE name = 'signed-target-write';`)).toBe(
      'X-Hub-Signature-256',
    );

    // Image-only rollback: the 2.260830.2 migrator only refuses an applied
    // count LOWER than its 52 files, so it boots against 53 rows, and its
    // explicit column lists never see the two extra columns.
    expect(Number(appliedMigrationCount())).toBeGreaterThanOrEqual(PREVIOUS_RELEASE_MIGRATION_COUNT);
    expect(
      scalar(`
          SELECT count(*) FROM webhook_sources
          WHERE name IN ('old-github', 'old-owned', 'late-old-write', 'signed-target-write');
        `),
    ).toBe('4');

    // Optional manual reverse (documented in the runbook): drop the columns
    // AND the 0052 bookkeeping row together, so a later re-upgrade re-applies
    // 0052 instead of believing it already ran. Rows survive; only the values
    // written into the two columns are discarded.
    runOrThrow(`
        ALTER TABLE "webhook_sources" DROP COLUMN IF EXISTS "signature_secret";
        ALTER TABLE "webhook_sources" DROP COLUMN IF EXISTS "signature_config";
        DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = ${target.when};
      `);
    expect(columnCount()).toBe('10');
    expect(appliedMigrationCount()).toBe(String(PREVIOUS_RELEASE_MIGRATION_COUNT));
    expect(scalar('SELECT count(*) FROM webhook_sources;')).toBe('4');
    expect(catalogFingerprint()).toBe(fingerprintBefore);

    // ...and the re-upgrade after that manual reverse is the ordinary hop.
    await applyMigrations(db, candidateDrizzleDir);
    expect(columnCount()).toBe('12');
    expect(appliedMigrationCount()).toBe(String(PREVIOUS_RELEASE_MIGRATION_COUNT + 1));
    expect(signatureColumns()).toBe('signature_config:jsonb/YES/none,signature_secret:text/YES/none');
  }, 30_000);
});
