/**
 * Release-boundary rehearsal for v2.260902.5 -> v2.260908.20.
 *
 * The suite is discovered by scripts/pg-gate.ts and therefore runs only on
 * the disposable loopback PostgreSQL cluster created by that gate. It never
 * reads DATABASE_URL or any application data.
 *
 * The boundary ships thirteen migrations, 0053-0065: the event backbone wave
 * (schema registry, causation, ingress idempotency, strict schemas,
 * transactional emissions, agent manifests, durable consumers — RFC #925),
 * the Gupshup handoff options, ASC Flow, and ASC Brazil channel columns, and
 * the connector lifecycle contract. The rehearsal starts from the byte-pinned
 * 0052 schema, seeds the drizzle bookkeeping the way a deployed 2.260902.5
 * database carries it, and then drives the REAL journaled migrator
 * (`applyMigrations` from packages/db/src/migrate.ts) so that the journal
 * guard, the advisory lock, and the count check are exercised rather than
 * simulated.
 *
 * The migrator is pointed at a candidate folder materialised from the live
 * `packages/db/drizzle`: exactly the files the 2.260908.20 image ships
 * (0000-0065) and a journal truncated to idx 0-65. Both the drizzle migrator
 * and the count guard read `meta/_journal.json` from the folder they are
 * given, so migrations added to the live folder after this hop (0066+) belong
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
import {
  createDatabaseFromTemplate,
  ensureSqlTemplate,
  sqlTemplateName,
} from '../../packages/db/src/pg-migrated-template';
import { RLS_TENANT_TABLES, contextFunctionStatements, tablePolicyStatements } from '../../packages/db/src/tenancy-rls';

const postgresUrl = process.env.OMNI_G2_POSTGRES_URL ?? '';
const postgresDescribe = postgresUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G2_PSQL_BIN ?? 'psql';
const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', 'packages', 'db', 'drizzle');
const journalPath = join(drizzleDir, 'meta', '_journal.json');

const PREVIOUS_RELEASE_LAST_MIGRATION = '0052_webhook_source_signature.sql';
const PREVIOUS_RELEASE_MIGRATION_COUNT = 53;
const TARGET_MIGRATIONS = [
  '0053_gupshup_handoff_options.sql',
  '0054_asc_flow_channel.sql',
  '0055_asc_flow_handoff_mode.sql',
  '0056_event_schema_registry.sql',
  '0057_connector_lifecycle_contract.sql',
  '0058_omni_events_causation_id.sql',
  '0059_ingress_idempotency.sql',
  '0060_webhook_source_strict_schemas.sql',
  '0061_automation_transactional_emissions.sql',
  '0062_agent_event_manifest.sql',
  '0063_automation_manifest_provenance.sql',
  '0064_durable_consumers.sql',
  '0065_asc_channel.sql',
] as const;
const TARGET_LAST_MIGRATION = TARGET_MIGRATIONS[TARGET_MIGRATIONS.length - 1] as string;
const TARGET_JOURNAL_IDX = 65;

/** Every column the wave adds, per touched tenant table (runbook audit). */
const NEW_COLUMNS = {
  instances: [
    'gupshup_handoff_options',
    'asc_flow_base_url',
    'asc_flow_login',
    'asc_flow_chave',
    'asc_flow_handoff_servico',
    'asc_flow_handoff_mode',
    'asc_base_url',
    'asc_token',
    'asc_originador',
  ],
  webhook_sources: [
    'event_type_mapping',
    'expected_interval_seconds',
    'last_heartbeat_at',
    'heartbeat_count',
    'liveness_status',
    'liveness_armed_at',
    'stalled_at',
    'window_semantics',
    'mutation_policy',
    'idempotency_key_template',
    'total_duplicates',
    'strict_schemas',
  ],
  omni_events: ['causation_id', 'idempotency_key', 'journal_seq'],
  automations: ['transactional_emissions', 'managed_by_agent_id'],
  agents: ['event_manifest'],
} as const;

// SHA-256 over each sorted `filename + NUL + bytes + NUL`. This pins the exact
// deployed SQL without requiring release tags to be present in a CI clone.
// The 0000-0052 digest is the 2.260902.5 database boundary; the 0052-only
// digest is the previous runbook's target set and must not drift either.
const PREVIOUS_RELEASE_MIGRATIONS_SHA256 = '4aba548905663292d3298e267cdfacf50dedbe1e262e4012d922745f027a6fcc';
const PREVIOUS_HOP_MIGRATIONS_SHA256 = 'f0199e0fbf6e73de7d59eec3fefad899a9bc4f40df57645d03875c67ccc7adfe';
const TARGET_MIGRATIONS_SHA256 = '6ac850cccb70948b03fc9f0ef6ee0377263248b370be1ec086e29db6e4919369';

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
// What the 2.260908.20 image ships: 0000-0065 and the matching journal prefix.
const candidateMigrations = migrationFiles.filter((file) => file <= TARGET_LAST_MIGRATION);
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
 * The migrations folder exactly as the 2.260908.20 image ships it: the `.sql`
 * files through 0065 (byte-identical copies of the live files) and a journal
 * with the real top-level shape but only entries idx 0-64. drizzle reads
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
      (file) => file > PREVIOUS_RELEASE_LAST_MIGRATION && file <= TARGET_LAST_MIGRATION,
    );
    expect(targetReleaseMigrations).toEqual([...TARGET_MIGRATIONS]);
    expect(candidateMigrations).toEqual([...previousReleaseMigrations, ...TARGET_MIGRATIONS]);
    expect(migrationDigest(previousReleaseMigrations)).toBe(PREVIOUS_RELEASE_MIGRATIONS_SHA256);
    expect(migrationDigest([PREVIOUS_RELEASE_LAST_MIGRATION])).toBe(PREVIOUS_HOP_MIGRATIONS_SHA256);
    expect(migrationDigest(TARGET_MIGRATIONS)).toBe(TARGET_MIGRATIONS_SHA256);
  });

  test('the journal accepts idx 53-65 with strictly increasing `when` values', () => {
    // packages/db/src/migrate.ts documents the failure mode: drizzle silently
    // skips a migration whose journal `when` is not later than the last applied
    // row's created_at, and the count guard only catches it after the fact.
    // Only the prefix the candidate ships is under test; later entries (0066+)
    // belong to later hops and are excluded from the materialised folder.
    expect(candidateJournalEntries).toHaveLength(PREVIOUS_RELEASE_MIGRATION_COUNT + TARGET_MIGRATIONS.length);
    expect(journalEntries.slice(0, candidateJournalEntries.length)).toEqual(candidateJournalEntries);
    candidateJournalEntries.forEach((entry, position) => {
      expect(entry.idx).toBe(position);
      expect(candidateMigrations[position]).toBe(`${entry.tag}.sql`);
      if (position > 0) expect(entry.when).toBeGreaterThan(journalEntry(position - 1).when);
    });
    const previous = journalEntry(PREVIOUS_RELEASE_MIGRATION_COUNT - 1);
    const target = journalEntry(TARGET_JOURNAL_IDX);
    expect(`${previous.tag}.sql`).toBe(PREVIOUS_RELEASE_LAST_MIGRATION);
    expect(`${target.tag}.sql`).toBe(TARGET_LAST_MIGRATION);
    expect(candidateJournalEntries.at(-1)).toEqual(target);
  });

  test('the wave is additive: no destructive statement, no raw transaction, one documented widening', () => {
    const alterColumnFiles: string[] = [];
    for (const file of TARGET_MIGRATIONS) {
      // Header comments legitimately discuss policies, deletes, and locks;
      // the additive contract binds the statements, so lint those alone.
      const statements = migrationSql(file)
        .split('\n')
        .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith('--'))
        .join('\n');
      // The boot migrator runs each file inside its own transaction on a
      // pooled postgres-js connection; raw transaction control is rejected.
      // A raw control statement ends in `;` — 0063's PL/pgSQL `DO $$ BEGIN`
      // block is a function body, not transaction control, and stays legal.
      expect(statements).not.toMatch(/^\s*(BEGIN|COMMIT|START TRANSACTION|ROLLBACK)\s*;/im);
      expect(statements).not.toMatch(/\b(DROP TABLE|DROP COLUMN|DROP INDEX|TRUNCATE|DELETE FROM|UPDATE\s+")/i);
      expect(statements).not.toMatch(/\b(POLICY|ROW LEVEL SECURITY)\b/i);
      if (/ALTER\s+COLUMN/i.test(statements)) alterColumnFiles.push(file);
    }
    // The single type change in the wave is 0059's binary-coercible widening
    // of the event-type column (varchar(50) -> varchar(255)); anything else
    // would need its own rewrite/lock audit in the runbook.
    expect(alterColumnFiles).toEqual(['0059_ingress_idempotency.sql']);
    expect(migrationSql('0059_ingress_idempotency.sql')).toContain(
      'ALTER TABLE "omni_events" ALTER COLUMN "event_type" TYPE varchar(255);',
    );
  });

  test('the tenancy contract is untouched: policies ignore the new columns, new tables are global', () => {
    for (const [table, columns] of Object.entries(NEW_COLUMNS)) {
      expect(RLS_TENANT_TABLES).toContain(table);
      const policyDdl = tablePolicyStatements(table).join('\n');
      expect(policyDdl).toContain('"tenant_id" = public.omni_current_tenant_id()');
      for (const column of columns) expect(policyDdl).not.toContain(column);
    }
    // event_schemas and durable_consumers are global by design (their header
    // comments document the decision): no tenant_id, no policies.
    expect(RLS_TENANT_TABLES).not.toContain('event_schemas');
    expect(RLS_TENANT_TABLES).not.toContain('durable_consumers');
    for (const file of ['0056_event_schema_registry.sql', '0064_durable_consumers.sql']) {
      const statements = migrationSql(file)
        .split('\n')
        .filter((line) => line.trim().length > 0 && !line.trimStart().startsWith('--'))
        .join('\n');
      expect(statements).not.toContain('tenant_id');
    }
  });
});

postgresDescribe('v2.260902.5 -> v2.260908.20 release rehearsal (real PostgreSQL)', () => {
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

  /** name:type/nullable/default for the given columns, alphabetical. */
  function columnsReport(table: string, columns: readonly string[]): string {
    return scalar(`
        SELECT string_agg(column_name || ':' || data_type || '/' || is_nullable || '/' || coalesce(column_default, 'none'), ',' ORDER BY column_name)
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = '${table}'
          AND column_name IN ('${columns.join("','")}');
      `);
  }

  function appliedMigrationCount(): string {
    return scalar('SELECT count(*) FROM "drizzle"."__drizzle_migrations";');
  }

  /**
   * Everything on a touched tenant table that the wave must leave alone:
   * row-level security flags and policies, ownership triggers, and
   * constraints (PK, unique, FKs). Indexes are fingerprinted separately
   * because the wave deliberately ADDS indexes to these tables.
   */
  function catalogFingerprint(table: string): string {
    return scalar(`
        SELECT string_agg(line, E'\\n' ORDER BY line) FROM (
          SELECT 'rls:' || c.relrowsecurity::text || '/' || c.relforcerowsecurity::text AS line
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = '${table}'
          UNION ALL
          SELECT 'policy:' || policyname || '|' || cmd || '|' || coalesce(qual, '-') || '|' || coalesce(with_check, '-')
          FROM pg_policies WHERE schemaname = 'public' AND tablename = '${table}'
          UNION ALL
          SELECT 'trigger:' || tgname FROM pg_trigger
          WHERE tgrelid = 'public.${table}'::regclass AND NOT tgisinternal
          UNION ALL
          SELECT 'constraint:' || conname || '|' || contype::text FROM pg_constraint
          WHERE conrelid = 'public.${table}'::regclass
        ) AS catalog;
      `);
  }

  function indexNames(table: string): string {
    return scalar(`
        SELECT string_agg(indexname, ',' ORDER BY indexname) FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = '${table}';
      `);
  }

  beforeAll(() => {
    database = `omni_release_upgrade_${crypto.randomUUID().replaceAll('-', '')}`;
    // The v2.260902.5 boundary (0000-0052) is frozen by definition — its bytes
    // are pinned by PREVIOUS_RELEASE_MIGRATIONS_SHA256 above — so its migrated
    // state is cached once per cluster as a template database and cloned here
    // (#967). The template name embeds a digest of the same bytes, so any
    // drift builds a fresh template (and fails the pinning test regardless).
    const access = { superUrl: postgresUrl, psqlBin };
    const previousReleaseSql = previousReleaseMigrations.map(migrationSql).join('\n');
    const template = sqlTemplateName('omni_rel_tmpl', previousReleaseSql);
    ensureSqlTemplate(access, template, previousReleaseSql);
    createDatabaseFromTemplate(access, database, template);
    databaseUrl = urlFor(postgresUrl, database);
    handle = createDbHandle({ url: databaseUrl, maxConnections: 2 });
    candidateDrizzleDir = materializeCandidateMigrations();
  });

  afterAll(async () => {
    if (handle) await handle.close();
    if (database) runSqlOn(postgresUrl, `DROP DATABASE IF EXISTS "${database}" WITH (FORCE);`);
    if (candidateDrizzleDir) rmSync(candidateDrizzleDir, { recursive: true, force: true });
  });

  test('applies 0053-0065 once through the journaled migrator and proves image-only rollback safe', async () => {
    if (!handle) throw new Error('database handle was not created');
    const db = handle.db;

    // The v2.260902.5 boundary: every migration through 0052 — the database is
    // a clone of the pinned-boundary template built in beforeAll, and the
    // assertions below prove the cloned state is exactly that boundary.
    for (const [table, columns] of Object.entries(NEW_COLUMNS)) {
      expect(columnsReport(table, columns)).toBe('');
    }
    expect(scalar("SELECT to_regclass('public.event_schemas') IS NULL;")).toBe('t');
    expect(scalar("SELECT to_regclass('public.durable_consumers') IS NULL;")).toBe('t');
    expect(
      scalar(`
          SELECT character_maximum_length FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'omni_events' AND column_name = 'event_type';
        `),
    ).toBe('50');

    // Rows shaped the way 2.260902.5 writes them: webhook sources with the
    // 0052-era signature columns, journal events with the old column list.
    runOrThrow(`
        INSERT INTO tenants (
          id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget
        ) VALUES (
          '50000000-0000-4000-8000-000000000001',
          'release-rehearsal',
          'Release rehearsal',
          3600,
          100,
          1000
        );
        INSERT INTO webhook_sources (id, name, description, expected_headers, signature_config)
        VALUES (
          '50000000-0000-4000-8000-000000000002',
          'old-github',
          'signed the 0052 way',
          '{"X-GitHub-Event": true}'::jsonb,
          '{"algorithm":"hmac-sha256","header":"X-Hub-Signature-256"}'::jsonb
        );
        INSERT INTO webhook_sources (id, name)
        VALUES ('50000000-0000-4000-8000-000000000003', 'old-plain');
        INSERT INTO omni_events (id, channel, event_type, text_content)
        VALUES
          ('50000000-0000-4000-8000-000000000004', 'whatsapp', 'message.received', 'pre-upgrade row one'),
          ('50000000-0000-4000-8000-000000000005', 'slack', 'message.sent', 'pre-upgrade row two');
      `);

    // Enforcement-mode catalog state: the tenancy policies an enforced
    // 2.260902.5 database already carries on the journal and source tables.
    // The wave must not disturb them. The policies are the repository's own
    // generators, so the rehearsal tracks the real predicate, not a copy.
    runOrThrow(
      [
        ...contextFunctionStatements(),
        ...tablePolicyStatements('webhook_sources'),
        ...tablePolicyStatements('omni_events'),
      ].join('\n'),
    );
    const sourceFingerprintBefore = catalogFingerprint('webhook_sources');
    const eventsFingerprintBefore = catalogFingerprint('omni_events');
    expect(sourceFingerprintBefore).toContain('rls:true/true');
    expect(sourceFingerprintBefore.match(/^policy:/gm)).toHaveLength(4);
    expect(eventsFingerprintBefore).toContain('rls:true/true');
    expect(eventsFingerprintBefore.match(/^policy:/gm)).toHaveLength(4);
    const sourceIndexesBefore = indexNames('webhook_sources');
    const eventsIndexesBefore = indexNames('omni_events');

    // Drizzle bookkeeping as a deployed 2.260902.5 database carries it: one
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
    // the candidate folder so only the 0053-0065 wave is on the table.
    await applyMigrations(db, candidateDrizzleDir);

    const target = journalEntry(TARGET_JOURNAL_IDX);
    expect(appliedMigrationCount()).toBe(String(PREVIOUS_RELEASE_MIGRATION_COUNT + TARGET_MIGRATIONS.length));
    expect(
      scalar(`
          SELECT hash || '@' || created_at FROM "drizzle"."__drizzle_migrations"
          ORDER BY created_at DESC LIMIT 1;
        `),
    ).toBe(`${drizzleFileHash(TARGET_LAST_MIGRATION)}@${target.when}`);

    // Every documented column with its documented type, nullability, and
    // default — nothing more (the runbook's migration audit, verbatim).
    expect(columnsReport('instances', NEW_COLUMNS.instances)).toBe(
      [
        'asc_base_url:text/YES/none',
        'asc_flow_base_url:text/YES/none',
        'asc_flow_chave:text/YES/none',
        'asc_flow_handoff_mode:text/YES/none',
        'asc_flow_handoff_servico:integer/YES/none',
        'asc_flow_login:text/YES/none',
        'asc_originador:character varying/YES/none',
        'asc_token:text/YES/none',
        'gupshup_handoff_options:jsonb/YES/none',
      ].join(','),
    );
    expect(columnsReport('webhook_sources', NEW_COLUMNS.webhook_sources)).toBe(
      [
        'event_type_mapping:jsonb/YES/none',
        'expected_interval_seconds:integer/YES/none',
        'heartbeat_count:integer/NO/0',
        "idempotency_key_template:text/NO/'{source}:{sha256(body)}'::text",
        'last_heartbeat_at:timestamp with time zone/YES/none',
        'liveness_armed_at:timestamp with time zone/YES/none',
        'liveness_status:character varying/YES/none',
        'mutation_policy:character varying/YES/none',
        'stalled_at:timestamp with time zone/YES/none',
        'strict_schemas:boolean/NO/false',
        'total_duplicates:integer/NO/0',
        'window_semantics:character varying/YES/none',
      ].join(','),
    );
    expect(columnsReport('omni_events', NEW_COLUMNS.omni_events)).toBe(
      [
        'causation_id:uuid/YES/none',
        'idempotency_key:text/YES/none',
        "journal_seq:bigint/NO/nextval('omni_events_journal_seq_seq'::regclass)",
      ].join(','),
    );
    expect(columnsReport('automations', NEW_COLUMNS.automations)).toBe(
      ['managed_by_agent_id:uuid/YES/none', 'transactional_emissions:boolean/NO/false'].join(','),
    );
    expect(columnsReport('agents', NEW_COLUMNS.agents)).toBe('event_manifest:jsonb/YES/none');
    expect(
      scalar(`
          SELECT character_maximum_length FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'omni_events' AND column_name = 'event_type';
        `),
    ).toBe('255');
    expect(scalar('SELECT count(*) FROM event_schemas;')).toBe('0');
    expect(scalar('SELECT count(*) FROM durable_consumers;')).toBe('0');
    // 0063's provenance FK: unvalidated (no deploy-time scan), cascading.
    expect(
      scalar(`
          SELECT contype::text || '/' || convalidated::text || '/' || confdeltype::text FROM pg_constraint
          WHERE conname = 'automations_managed_by_agent_fk';
        `),
    ).toBe('f/false/c');

    // Pre-existing rows keep their values, gain the documented defaults, and
    // are backfilled with unique journal positions (0064's BIGSERIAL).
    expect(
      scalar(`
          SELECT count(*) || '/' || count(*) FILTER (
            WHERE strict_schemas = false
              AND idempotency_key_template = '{source}:{sha256(body)}'
              AND total_duplicates = 0
              AND heartbeat_count = 0
              AND liveness_status IS NULL
              AND event_type_mapping IS NULL
          )
          FROM webhook_sources;
        `),
    ).toBe('2/2');
    expect(
      scalar(`
          SELECT count(*) || '/' || count(*) FILTER (
            WHERE causation_id IS NULL AND idempotency_key IS NULL AND journal_seq IS NOT NULL
          ) || '/' || count(DISTINCT journal_seq)
          FROM omni_events;
        `),
    ).toBe('2/2/2');
    expect(scalar(`SELECT signature_config->>'algorithm' FROM webhook_sources WHERE name = 'old-github';`)).toBe(
      'hmac-sha256',
    );

    // RLS flags, policies, triggers, and constraints are untouched; the index
    // delta is exactly the documented set, nothing else.
    expect(catalogFingerprint('webhook_sources')).toBe(sourceFingerprintBefore);
    expect(catalogFingerprint('omni_events')).toBe(eventsFingerprintBefore);
    expect(indexNames('webhook_sources')).toBe(
      [sourceIndexesBefore, 'webhook_sources_supervised_idx'].join(',').split(',').sort().join(','),
    );
    expect(indexNames('omni_events')).toBe(
      [
        eventsIndexesBefore,
        'omni_events_causation_idx',
        'omni_events_idempotency_key_uq',
        'omni_events_journal_seq_uq',
        'omni_events_tenant_idempotency_key_uq',
      ]
        .join(',')
        .split(',')
        .sort()
        .join(','),
    );

    // Re-running the migrator is a no-op, and every raw file in the wave is
    // also safe to replay by hand: each statement is IF NOT EXISTS or guarded
    // (0063's DO block), and 0059's widening to the same type is a no-op.
    await applyMigrations(db, candidateDrizzleDir);
    expect(appliedMigrationCount()).toBe(String(PREVIOUS_RELEASE_MIGRATION_COUNT + TARGET_MIGRATIONS.length));
    for (const file of TARGET_MIGRATIONS) {
      const rawReplay = runSql(migrationSql(file));
      expect(`${file}:${rawReplay.exitCode}`).toBe(`${file}:0`);
    }
    expect(
      scalar(`
          SELECT count(*) || '/' || count(DISTINCT journal_seq) FROM omni_events;
        `),
    ).toBe('2/2');

    // Mixed-version writes: an old-shaped insert (2.260902.5 names its
    // columns, so the new defaults fill themselves) and a target-shaped
    // insert with an idempotency key coexist; the journal sequence keeps
    // advancing past the backfilled rows.
    runOrThrow(`
        INSERT INTO omni_events (id, channel, event_type, text_content)
        VALUES ('50000000-0000-4000-8000-000000000006', 'whatsapp', 'message.received', 'late old write');
        INSERT INTO omni_events (id, channel, event_type, idempotency_key)
        VALUES (
          '50000000-0000-4000-8000-000000000007',
          'discord',
          'custom.webhook.old-github',
          'old-github:rehearsal-body-hash'
        );
      `);
    expect(
      scalar(`
          SELECT coalesce(idempotency_key, 'NULL') FROM omni_events
          WHERE id = '50000000-0000-4000-8000-000000000006';
        `),
    ).toBe('NULL');
    expect(
      scalar(`
          SELECT (min(journal_seq) FILTER (WHERE text_content LIKE 'pre-upgrade%')
            < min(journal_seq) FILTER (WHERE text_content IS NULL OR text_content = 'late old write'))::text
          FROM omni_events;
        `),
    ).toBe('true');

    // The runbook's dedup claim: THE DATABASE refuses an idempotency-key
    // redelivery via the 0059 unique index, not application logic.
    const redelivery = runSql(`
        INSERT INTO omni_events (id, channel, event_type, idempotency_key)
        VALUES (
          '50000000-0000-4000-8000-000000000008',
          'discord',
          'custom.webhook.old-github',
          'old-github:rehearsal-body-hash'
        );
      `);
    expect(redelivery.exitCode).not.toBe(0);
    expect(redelivery.stderr).toContain('omni_events_idempotency_key_uq');

    // Image-only rollback: the 2.260902.5 migrator only refuses an applied
    // count LOWER than its 53 files, so it boots against 65 rows, and its
    // explicit column lists never see the new columns or tables.
    expect(Number(appliedMigrationCount())).toBeGreaterThanOrEqual(PREVIOUS_RELEASE_MIGRATION_COUNT);
    expect(scalar('SELECT count(*) FROM omni_events;')).toBe('4');
    expect(scalar('SELECT count(*) FROM webhook_sources;')).toBe('2');
  }, 60_000);
});
