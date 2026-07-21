/**
 * Real PostgreSQL enforcement for the G2 additive ownership schema
 * (wish: omni-full-multitenancy, Group G2).
 *
 * Set `OMNI_G2_POSTGRES_URL` to a DISPOSABLE PostgreSQL database created with
 * freshly generated synthetic credentials. Every run uses and drops its own
 * random schema; no application, shared, or production data is read or written,
 * and no ambient `DATABASE_URL` is consulted.
 *
 * These are the gate for "clean fresh install + upgrade from snapshot; legacy
 * behavior unchanged while flag is off" (WISH G2 gate). A static SQL assertion
 * cannot prove a constraint rejects a row — only the server can.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPOSITE_FK_TARGETS,
  G2_NEW_TABLES,
  PLATFORM_ONLY_TABLES,
  SPLIT_DESTINATIONS,
  TENANT_OWNERSHIP_SPECS,
  addColumnStatements,
  allIndexStatements,
  compositeFkName,
  tenantIdUniqueIndexName,
} from './tenancy-ownership';

const postgresUrl = process.env.OMNI_G2_POSTGRES_URL ?? '';
const postgresDescribe = postgresUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G2_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', 'drizzle');

const MIGRATION_0041 = '0041_tenant_ownership_columns.sql';
const g2Sql = readFileSync(join(drizzleDir, MIGRATION_0041), 'utf-8');

/** Every committed migration up to and including 0040 — the real pre-G2 state. */
const throughG1Sql = readdirSync(drizzleDir)
  .filter((f) => f.endsWith('.sql') && f < MIGRATION_0041)
  .sort()
  .map((f) => readFileSync(join(drizzleDir, f), 'utf-8'))
  .join('\n');

interface SqlResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a script through psql.
 *
 * The script goes through a temp FILE rather than stdin: the committed
 * migrations are ~120 KB and a stdin pipe truncates them silently, which
 * produces a half-applied schema and a very confusing failure.
 *
 * `-A -t` is set on the command line rather than with `\pset`, because `\pset`
 * echoes "Output format is unaligned." into stdout and corrupts scalar reads.
 */
function runSqlOn(url: string, script: string, env?: Record<string, string>): SqlResult {
  const file = join(tmpdir(), `omni-g2-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [psqlBin, '-X', '--no-psqlrc', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      env: env ? { ...process.env, ...env } : process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  } finally {
    rmSync(file, { force: true });
  }
}

/**
 * Each suite gets its OWN disposable database, not just its own schema.
 *
 * A schema is not enough: the committed migrations create some foreign keys
 * before their parent table exists in the target schema, so PostgreSQL resolves
 * the parent through `search_path` and silently binds the constraint to
 * `public`. That produces a schema whose constraints point at another schema's
 * tables — an invisible false pass. A dedicated database makes `public` the only
 * schema there is.
 */
function createDatabase(): { url: string; name: string } {
  const name = `omni_g2_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = runSqlOn(postgresUrl, `CREATE DATABASE "${name}";`);
  if (admin.exitCode !== 0) throw new Error(`could not create disposable database: ${admin.stderr}`);
  const url = new URL(postgresUrl);
  url.pathname = `/${name}`;
  return { url: url.toString(), name };
}

function dropDatabase(name: string): void {
  runSqlOn(postgresUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`);
}

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

/** Disposable database for the upgrade suite. Assigned in beforeAll. */
let main = { url: '', name: '' };
const schemaName = 'public';

function inSchema(script: string): string {
  return script;
}

function runSql(script: string, env?: Record<string, string>): SqlResult {
  return runSqlOn(main.url, script, env);
}

function runOrThrow(script: string): void {
  const result = runSql(script);
  if (result.exitCode !== 0) throw new Error(`psql failed: ${result.stderr || result.stdout}`);
}

function scalar(query: string): string {
  const result = runSql(query);
  if (result.exitCode !== 0) throw new Error(`psql failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** Representative legacy rows: everything NULL-owner, exactly as at HEAD. */
const LEGACY_ROWS = `
INSERT INTO instances (id, name, channel) VALUES
  ('aaaa0000-0000-4000-8000-000000000001', 'legacy-instance', 'whatsapp');
INSERT INTO persons (id) VALUES ('ffff0000-0000-4000-8000-000000000001');
INSERT INTO conversations (id) VALUES ('cccc0000-0000-4000-8000-000000000001');
INSERT INTO chats (id, external_id, chat_type, channel, instance_id) VALUES
  ('bbbb0000-0000-4000-8000-000000000001', 'legacy-chat', 'direct', 'whatsapp',
   'aaaa0000-0000-4000-8000-000000000001');
INSERT INTO messages (id, chat_id, external_id, source, message_type, platform_timestamp) VALUES
  ('eeee0000-0000-4000-8000-000000000001', 'bbbb0000-0000-4000-8000-000000000001',
   'legacy-message', 'inbound', 'text', now());
`;

const TENANTS = `
INSERT INTO tenants (id, slug, display_name, status, max_key_ttl_seconds, max_key_rate_limit, max_key_budget)
VALUES ('${TENANT_A}', 'g2-tenant-a', 'G2 Tenant A', 'active', 3600, 100, 1000),
       ('${TENANT_B}', 'g2-tenant-b', 'G2 Tenant B', 'active', 3600, 100, 1000);
`;

postgresDescribe('G2 ownership schema — real PostgreSQL', () => {
  beforeAll(() => {
    // UPGRADE PATH: build the real committed pre-G2 state, seed legacy
    // NULL-owner rows, and only then apply G2 on top.
    main = createDatabase();
    runOrThrow(`${throughG1Sql}\n${LEGACY_ROWS}\n${TENANTS}`);
  });

  afterAll(() => {
    dropDatabase(main.name);
  });

  // -------------------------------------------------------------------------
  // Upgrade from the committed 0040 state
  // -------------------------------------------------------------------------

  describe('upgrade from the real committed 0040 schema', () => {
    test('legacy NULL-owner rows exist before G2 and G2 applies cleanly over them', () => {
      expect(scalar('SELECT count(*) FROM instances;')).toBe('1');
      const applied = runSql(inSchema(g2Sql));
      expect(applied.stderr).not.toContain('ERROR');
      expect(applied.exitCode).toBe(0);
      // No composite FK was skipped for want of its parent unique index.
      expect(applied.stderr).not.toContain('run the online DDL phase');
    });

    test('every legacy row survived and is still NULL-owner', () => {
      expect(scalar('SELECT count(*) FROM messages WHERE tenant_id IS NULL;')).toBe('1');
      expect(scalar('SELECT count(*) FROM chats WHERE tenant_id IS NULL;')).toBe('1');
      expect(scalar('SELECT count(*) FROM instances WHERE tenant_id IS NULL;')).toBe('1');
    });

    test('re-applying the migration is a no-op (idempotent)', () => {
      const before = scalar(
        `SELECT count(*) FROM pg_constraint WHERE connamespace = '${schemaName}'::regnamespace AND contype = 'f';`,
      );
      const again = runSql(inSchema(g2Sql));
      expect(again.exitCode).toBe(0);
      expect(again.stderr).not.toContain('ERROR');
      const after = scalar(
        `SELECT count(*) FROM pg_constraint WHERE connamespace = '${schemaName}'::regnamespace AND contype = 'f';`,
      );
      expect(after).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // Catalog probes — the schema contract, read back from the server
  // -------------------------------------------------------------------------

  describe('catalog contract', () => {
    test('all 29 tenant tables have a NULLABLE tenant_id with no default', () => {
      for (const spec of TENANT_OWNERSHIP_SPECS) {
        const row = scalar(`
          SELECT is_nullable || '/' || coalesce(column_default, 'none') || '/' || data_type
          FROM information_schema.columns
          WHERE table_schema = '${schemaName}' AND table_name = '${spec.table}' AND column_name = 'tenant_id';
        `);
        expect(row).toBe('YES/none/uuid');
      }
    });

    test('platform-only and split legacy tables have NO tenant_id column', () => {
      for (const table of [...PLATFORM_ONLY_TABLES, ...SPLIT_DESTINATIONS.map((s) => s.legacyTable)]) {
        const count = scalar(`
          SELECT count(*) FROM information_schema.columns
          WHERE table_schema = '${schemaName}' AND table_name = '${table}' AND column_name = 'tenant_id';
        `);
        expect(count).toBe('0');
      }
    });

    test('every composite same-tenant foreign key exists and is NOT VALID', () => {
      for (const spec of TENANT_OWNERSHIP_SPECS) {
        for (const parent of spec.parents) {
          const name = compositeFkName(spec.table, parent.column);
          const state = scalar(`
            SELECT contype::text || '/' || convalidated::text FROM pg_constraint
            WHERE conname = '${name}' AND connamespace = '${schemaName}'::regnamespace;
          `);
          expect(state).toBe('f/false');
        }
      }
    });

    test('every composite FK target carries a valid (tenant_id, id) unique index', () => {
      for (const table of COMPOSITE_FK_TARGETS) {
        const state = scalar(`
          SELECT i.indisunique::text || '/' || i.indisvalid::text
          FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
          WHERE c.relname = '${tenantIdUniqueIndexName(table)}'
            AND c.relnamespace = '${schemaName}'::regnamespace;
        `);
        expect(state).toBe('true/true');
      }
    });

    test('every G2 index from the spec exists in the database', () => {
      for (const { statement } of allIndexStatements()) {
        const count = scalar(`
          SELECT count(*) FROM pg_class
          WHERE relname = '${statement.name}' AND relnamespace = '${schemaName}'::regnamespace AND relkind = 'i';
        `);
        expect(count).toBe('1');
      }
    });

    test('all split destinations and both ledger tables exist', () => {
      for (const table of G2_NEW_TABLES) {
        const count = scalar(`
          SELECT count(*) FROM information_schema.tables
          WHERE table_schema = '${schemaName}' AND table_name = '${table}';
        `);
        expect(count).toBe('1');
      }
    });

    test('split destinations are created EMPTY — G2 copies no legacy row', () => {
      for (const table of G2_NEW_TABLES) {
        expect(scalar(`SELECT count(*) FROM "${table}";`)).toBe('0');
      }
    });

    test('every non-root tenant table has its BEFORE INSERT derivation trigger', () => {
      for (const spec of TENANT_OWNERSHIP_SPECS) {
        const expected = spec.derivation === 'root' ? '0' : '1';
        const count = scalar(`
          SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE c.relname = '${spec.table}' AND c.relnamespace = '${schemaName}'::regnamespace
            AND NOT t.tgisinternal AND t.tgname = '${spec.table}_tenant_ownership_trg';
        `);
        expect(count).toBe(expected);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Legacy behavior is unchanged
  // -------------------------------------------------------------------------

  describe('legacy behavior while the flag is off', () => {
    test('an old-shaped write with no ownership anywhere still succeeds and stays NULL', () => {
      const result = runSql(
        inSchema(`
          INSERT INTO instances (id, name, channel)
          VALUES ('aaaa0000-0000-4000-8000-000000000002', 'legacy-two', 'whatsapp');
        `),
      );
      expect(result.exitCode).toBe(0);
      expect(scalar("SELECT coalesce(tenant_id::text, 'NULL') FROM instances WHERE name = 'legacy-two';")).toBe('NULL');
    });

    test('a child written under a legacy NULL-owner parent is ACCEPTED and stays NULL', () => {
      const result = runSql(
        inSchema(`
          INSERT INTO chats (id, external_id, chat_type, channel, instance_id)
          VALUES ('bbbb0000-0000-4000-8000-000000000002', 'legacy-chat-2', 'direct', 'whatsapp',
                  'aaaa0000-0000-4000-8000-000000000001');
        `),
      );
      expect(result.exitCode).toBe(0);
      expect(scalar("SELECT coalesce(tenant_id::text, 'NULL') FROM chats WHERE external_id = 'legacy-chat-2';")).toBe(
        'NULL',
      );
    });

    test('the pre-existing global unique constraints still reject their duplicates', () => {
      const duplicate = runSql(
        inSchema(`INSERT INTO instances (name, channel) VALUES ('legacy-instance', 'whatsapp');`),
      );
      expect(duplicate.exitCode).not.toBe(0);
      // The pre-existing GLOBAL uniqueness on instances.name is untouched by
      // G2, so it still rejects a duplicate regardless of ownership.
      expect(duplicate.stderr).toContain('duplicate key value violates unique constraint');
      expect(duplicate.stderr).toContain('Key (name)=(legacy-instance) already exists');
    });
  });

  // -------------------------------------------------------------------------
  // Trusted dual-write propagation
  // -------------------------------------------------------------------------

  describe('trusted dual-write propagation', () => {
    beforeAll(() => {
      runOrThrow(
        inSchema(`
          INSERT INTO instances (id, name, channel, tenant_id) VALUES
            ('aaaa0000-0000-4000-8000-0000000000a1', 'inst-a', 'whatsapp', '${TENANT_A}'),
            ('aaaa0000-0000-4000-8000-0000000000b1', 'inst-b', 'whatsapp', '${TENANT_B}');
          INSERT INTO chats (id, external_id, chat_type, channel, instance_id) VALUES
            ('bbbb0000-0000-4000-8000-0000000000a1', 'chat-a', 'direct', 'whatsapp',
             'aaaa0000-0000-4000-8000-0000000000a1'),
            ('bbbb0000-0000-4000-8000-0000000000b1', 'chat-b', 'direct', 'whatsapp',
             'aaaa0000-0000-4000-8000-0000000000b1');
        `),
      );
    });

    test('the ownership root persists a trusted tenant id', () => {
      expect(scalar("SELECT tenant_id FROM instances WHERE name = 'inst-a';")).toBe(TENANT_A);
    });

    test('a child under a fully-owned parent propagates exactly', () => {
      expect(scalar("SELECT tenant_id FROM chats WHERE external_id = 'chat-a';")).toBe(TENANT_A);
      expect(scalar("SELECT tenant_id FROM chats WHERE external_id = 'chat-b';")).toBe(TENANT_B);
    });

    test('propagation is identical with the multitenancy flag off and on', () => {
      // The derivation lives in the database, so the application flag cannot
      // change it. Prove it by writing under each setting and comparing.
      for (const flag of ['false', 'true']) {
        const id = `bbbb0000-0000-4000-8000-00000000f${flag === 'true' ? '1' : '0'}01`;
        const result = runSql(
          inSchema(`
            INSERT INTO chats (id, external_id, chat_type, channel, instance_id)
            VALUES ('${id}', 'flag-${flag}', 'direct', 'whatsapp', 'aaaa0000-0000-4000-8000-0000000000a1');
          `),
          { OMNI_MULTITENANCY_ENABLED: flag },
        );
        expect(result.exitCode).toBe(0);
        expect(scalar(`SELECT tenant_id FROM chats WHERE external_id = 'flag-${flag}';`)).toBe(TENANT_A);
      }
    });

    test('a caller-supplied tenant id on a derived table is IGNORED, not honoured', () => {
      runOrThrow(
        inSchema(`
          INSERT INTO chats (id, external_id, chat_type, channel, instance_id, tenant_id)
          VALUES ('bbbb0000-0000-4000-8000-0000000000c1', 'forged', 'direct', 'whatsapp',
                  'aaaa0000-0000-4000-8000-0000000000a1', '${TENANT_B}');
        `),
      );
      // Derived from the instance (tenant A), NOT the request-supplied tenant B.
      expect(scalar("SELECT tenant_id FROM chats WHERE external_id = 'forged';")).toBe(TENANT_A);
    });

    test('a forged tenant id above a legacy NULL-owner parent is discarded, and the row stays NULL', () => {
      runOrThrow(
        inSchema(`
          INSERT INTO chats (id, external_id, chat_type, channel, instance_id, tenant_id)
          VALUES ('bbbb0000-0000-4000-8000-0000000000c2', 'forged-legacy', 'direct', 'whatsapp',
                  'aaaa0000-0000-4000-8000-000000000001', '${TENANT_B}');
        `),
      );
      expect(scalar("SELECT coalesce(tenant_id::text, 'NULL') FROM chats WHERE external_id = 'forged-legacy';")).toBe(
        'NULL',
      );
    });

    test('equal non-null parents propagate exactly', () => {
      runOrThrow(
        inSchema(`
          INSERT INTO agent_routes (id, instance_id, scope, chat_id)
          VALUES ('dddd0000-0000-4000-8000-0000000000a1', 'aaaa0000-0000-4000-8000-0000000000a1', 'chat',
                  'bbbb0000-0000-4000-8000-0000000000a1');
        `),
      );
      expect(scalar("SELECT tenant_id FROM agent_routes WHERE id = 'dddd0000-0000-4000-8000-0000000000a1';")).toBe(
        TENANT_A,
      );
    });

    test('mixed known/NULL parents stay NULL', () => {
      runOrThrow(
        inSchema(`
          INSERT INTO chats (id, external_id, chat_type, channel, instance_id, conversation_id)
          VALUES ('bbbb0000-0000-4000-8000-0000000000d1', 'mixed', 'direct', 'whatsapp',
                  'aaaa0000-0000-4000-8000-0000000000a1', 'cccc0000-0000-4000-8000-000000000001');
        `),
      );
      expect(scalar("SELECT coalesce(tenant_id::text, 'NULL') FROM chats WHERE external_id = 'mixed';")).toBe('NULL');
    });

    test('disagreeing non-null parents are REJECTED', () => {
      const result = runSql(
        inSchema(`
          INSERT INTO agent_routes (id, instance_id, scope, chat_id)
          VALUES ('dddd0000-0000-4000-8000-0000000000e1', 'aaaa0000-0000-4000-8000-0000000000b1', 'chat',
                  'bbbb0000-0000-4000-8000-0000000000a1');
        `),
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('cross-tenant ownership conflict');
    });

    test('an `unowned` table forces NULL even when a tenant id is supplied', () => {
      runOrThrow(
        inSchema(`INSERT INTO persons (id, tenant_id) VALUES ('ffff0000-0000-4000-8000-0000000000a1', '${TENANT_A}');`),
      );
      expect(
        scalar(
          "SELECT coalesce(tenant_id::text, 'NULL') FROM persons WHERE id = 'ffff0000-0000-4000-8000-0000000000a1';",
        ),
      ).toBe('NULL');
    });
  });

  // -------------------------------------------------------------------------
  // Composite foreign keys
  // -------------------------------------------------------------------------

  describe('composite same-tenant foreign keys', () => {
    test('a same-tenant pair is ACCEPTED', () => {
      const result = runSql(
        inSchema(`
          INSERT INTO agent_sessions (id, instance_id, session_key, provider_session_data)
          VALUES ('99990000-0000-4000-8000-0000000000a1', 'aaaa0000-0000-4000-8000-0000000000a1', 'sess-a', '{}');
        `),
      );
      expect(result.exitCode).toBe(0);
      expect(scalar("SELECT tenant_id FROM agent_sessions WHERE session_key = 'sess-a';")).toBe(TENANT_A);
    });

    test('a CROSS-TENANT pair is REJECTED once tenant ids are present', () => {
      const result = runSql(
        inSchema(`
          UPDATE chats SET tenant_id = '${TENANT_B}' WHERE external_id = 'chat-a';
        `),
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/violates foreign key constraint/);
    });

    test('a non-null child above a NULL-owner parent is REJECTED by the composite FK', () => {
      const result = runSql(
        inSchema(`
          UPDATE chats SET tenant_id = '${TENANT_A}' WHERE external_id = 'legacy-chat';
        `),
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('chats_instance_id_tenant_fk');
    });

    test('NOT VALID means legacy rows were never scanned — they are all still present', () => {
      expect(scalar("SELECT count(*) FROM chats WHERE external_id = 'legacy-chat';")).toBe('1');
    });
  });

  // -------------------------------------------------------------------------
  // Tenant-aware unique indexes
  // -------------------------------------------------------------------------

  describe('tenant-aware unique indexes are additive', () => {
    test('two tenants may not collide inside one tenant, but legacy NULL rows are unconstrained', () => {
      // Two NULL-owner rows with the same natural key are still governed only by
      // the pre-existing global unique index — the partial tenant index ignores
      // them entirely.
      const partial = scalar(`
        SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = 'instances_tenant_name_uq' AND i.indpred IS NOT NULL;
      `);
      expect(partial).toBe('1');
    });
  });

  // -------------------------------------------------------------------------
  // Migration ledger
  // -------------------------------------------------------------------------

  describe('migration ledger', () => {
    const checksum = 'a'.repeat(64);

    test('a complete ledger entry is accepted and mirrored into history', () => {
      runOrThrow(
        inSchema(`
          INSERT INTO tenant_migration_ledger (
            id, source_table, source_primary_key, target_tenant_id, decision_rule,
            pre_image_redacted, pre_image_checksum, post_image_redacted, post_image_checksum,
            inverse_action, wal_lsn_high_water, writer_epoch, status, ambiguity_state,
            reconciliation_receipt, attempt_count, checkpoint, redaction_policy
          ) VALUES (
            '77770000-0000-4000-8000-000000000001', 'instances', '{"id": "aaaa"}', '${TENANT_A}',
            'g0-approved-instance-mapping', '{"redacted": true}', '${checksum}',
            '{"redacted": true}', '${checksum}', '{"op": "set_tenant_null"}', '0/16B3748', 1,
            'applied', 'none', '{"counts": {"before": 1, "after": 1}}', 1, '{"batch": 1}', 'g2-default'
          );
        `),
      );
      expect(scalar('SELECT count(*) FROM tenant_migration_ledger_history;')).toBe('1');
    });

    test('an update to the head row appends a new immutable revision', () => {
      runOrThrow(
        inSchema(
          `UPDATE tenant_migration_ledger SET attempt_count = 2 WHERE id = '77770000-0000-4000-8000-000000000001';`,
        ),
      );
      expect(scalar('SELECT count(*) FROM tenant_migration_ledger_history;')).toBe('2');
      expect(scalar('SELECT max(revision) FROM tenant_migration_ledger_history;')).toBe('2');
    });

    test('history rejects UPDATE, DELETE and TRUNCATE', () => {
      for (const operation of [
        "UPDATE tenant_migration_ledger_history SET status = 'tampered'",
        'DELETE FROM tenant_migration_ledger_history',
        'TRUNCATE TABLE tenant_migration_ledger_history',
      ]) {
        const result = runSql(inSchema(operation));
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain('migration ledger history is append-only');
      }
    });

    test('a decision with neither an inverse nor a compensating action is rejected', () => {
      const result = runSql(
        inSchema(`
          INSERT INTO tenant_migration_ledger (
            source_table, source_primary_key, decision_rule, pre_image_redacted, pre_image_checksum,
            wal_lsn_high_water, writer_epoch, redaction_policy
          ) VALUES ('chats', '{"id": "b"}', 'rule', '{}', '${checksum}', '0/16B3748', 1, 'g2-default');
        `),
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('tenant_migration_ledger_inverse_or_compensating_check');
    });

    test('an applied decision must carry its tenant, post-image and reconciliation receipt', () => {
      const result = runSql(
        inSchema(`
          INSERT INTO tenant_migration_ledger (
            source_table, source_primary_key, decision_rule, pre_image_redacted, pre_image_checksum,
            inverse_action, wal_lsn_high_water, writer_epoch, status, redaction_policy
          ) VALUES ('chats', '{"id": "c"}', 'rule', '{}', '${checksum}', '{"op": "noop"}',
                    '0/16B3748', 1, 'applied', 'g2-default');
        `),
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('tenant_migration_ledger_applied_completeness_check');
    });

    test('an ambiguous decision may never carry a target tenant', () => {
      const result = runSql(
        inSchema(`
          INSERT INTO tenant_migration_ledger (
            source_table, source_primary_key, target_tenant_id, decision_rule, pre_image_redacted,
            pre_image_checksum, inverse_action, wal_lsn_high_water, writer_epoch, ambiguity_state, redaction_policy
          ) VALUES ('chats', '{"id": "d"}', '${TENANT_A}', 'rule', '{}', '${checksum}', '{"op": "noop"}',
                    '0/16B3748', 1, 'ambiguous', 'g2-default');
        `),
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('tenant_migration_ledger_quarantine_check');
    });

    test('the ledger has no column that could hold a plaintext secret', () => {
      const suspicious = scalar(`
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = '${schemaName}'
          AND table_name IN ('tenant_migration_ledger', 'tenant_migration_ledger_history')
          AND (column_name LIKE '%secret%' OR column_name LIKE '%password%'
            OR column_name LIKE '%plaintext%' OR column_name LIKE '%token%' OR column_name LIKE '%key_hash%');
      `);
      expect(suspicious).toBe('0');
    });
  });
});

// ---------------------------------------------------------------------------
// Fresh install + online DDL phase — each needs its own schema
// ---------------------------------------------------------------------------

postgresDescribe('G2 fresh install', () => {
  const freshSchema = 'public';
  let fresh = { url: '', name: '' };

  const freshScalar = (query: string): string => {
    const result = runSqlOn(fresh.url, query);
    if (result.exitCode !== 0) throw new Error(`psql failed: ${result.stderr}`);
    return result.stdout.trim();
  };

  beforeAll(() => {
    fresh = createDatabase();
    const result = runSqlOn(fresh.url, `${throughG1Sql}\n${g2Sql}`);
    if (result.exitCode !== 0) throw new Error(`fresh install failed: ${result.stderr}`);
  });

  afterAll(() => {
    dropDatabase(fresh.name);
  });

  test('a fresh install from migrations alone is COMPLETE — no index or FK is missing', () => {
    const missingIndexes = allIndexStatements().filter(({ statement }) => {
      return (
        freshScalar(
          `SELECT count(*) FROM pg_class WHERE relname = '${statement.name}' AND relnamespace = '${freshSchema}'::regnamespace;`,
        ) !== '1'
      );
    });
    expect(missingIndexes.map((i) => i.statement.name)).toEqual([]);

    const expectedFks = TENANT_OWNERSHIP_SPECS.flatMap((s) => s.parents.map((p) => compositeFkName(s.table, p.column)));
    expect(
      freshScalar(
        `SELECT count(*) FROM pg_constraint WHERE connamespace = '${freshSchema}'::regnamespace AND conname = ANY(ARRAY['${expectedFks.join("','")}']);`,
      ),
    ).toBe(String(expectedFks.length));
  });
});

postgresDescribe('G2 online DDL phase', () => {
  const onlineSchema = 'public';
  let online = { url: '', name: '' };

  const inOnline = (script: string): string => script;
  const runOnline = (script: string): SqlResult => runSqlOn(online.url, script);
  const onlineScalar = (query: string): string => {
    const result = runSqlOn(online.url, query);
    if (result.exitCode !== 0) throw new Error(`psql failed: ${result.stderr}`);
    return result.stdout.trim();
  };

  beforeAll(() => {
    // Pre-G2 state only: the online phase must be able to run BEFORE 0041.
    online = createDatabase();
    const result = runSqlOn(online.url, `${throughG1Sql}\n${LEGACY_ROWS}\n${TENANTS}`);
    if (result.exitCode !== 0) throw new Error(`pre-G2 setup failed: ${result.stderr}`);
  });

  afterAll(() => {
    dropDatabase(online.name);
  });

  test('the online phase adds columns and builds every index CONCURRENTLY, before any migration', () => {
    // ADD COLUMN is transaction-safe; CREATE INDEX CONCURRENTLY is not, so each
    // statement is sent on its own with no surrounding transaction.
    for (const statement of addColumnStatements()) {
      const result = runOnline(inOnline(statement));
      expect(result.exitCode).toBe(0);
    }
    for (const { statement } of allIndexStatements()) {
      const result = runOnline(inOnline(statement.concurrent));
      expect(result.stderr).not.toContain('ERROR');
      expect(result.exitCode).toBe(0);
    }
    const count = onlineScalar(
      `SELECT count(*) FROM pg_class WHERE relnamespace = '${onlineSchema}'::regnamespace AND relkind = 'i' AND relname LIKE '%tenant%';`,
    );
    expect(Number(count)).toBeGreaterThanOrEqual(allIndexStatements().length);
  });

  test('an INVALID index left by an interrupted build is detected and repaired', () => {
    const target = 'chats_tenant_idx';
    // Simulate the residue of an interrupted CREATE INDEX CONCURRENTLY.
    const seeded = runOnline(`
      DROP INDEX IF EXISTS "${target}";
      CREATE INDEX "${target}" ON "chats" ("tenant_id") WHERE "tenant_id" IS NOT NULL;
      UPDATE pg_index SET indisvalid = false
      WHERE indexrelid = '"${onlineSchema}"."${target}"'::regclass;
    `);
    expect(seeded.exitCode).toBe(0);
    expect(
      onlineScalar(
        `SELECT count(*) FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = '${target}' AND c.relnamespace = '${onlineSchema}'::regnamespace AND NOT i.indisvalid;`,
      ),
    ).toBe('1');

    // The recovery path: drop concurrently, then rebuild concurrently.
    expect(runOnline(`DROP INDEX CONCURRENTLY IF EXISTS "${target}";`).exitCode).toBe(0);
    const rebuild = runOnline(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${target}" ON "chats" ("tenant_id") WHERE "tenant_id" IS NOT NULL;`,
    );
    expect(rebuild.exitCode).toBe(0);

    expect(
      onlineScalar(
        `SELECT i.indisvalid::text FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = '${target}' AND c.relnamespace = '${onlineSchema}'::regnamespace;`,
      ),
    ).toBe('true');
  });

  test('the migration then runs as a metadata-only no-op over the pre-built schema', () => {
    const result = runOnline(g2Sql);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('ERROR');
    expect(result.stderr).not.toContain('run the online DDL phase');

    // Same end state as the fresh path: every composite FK present and NOT VALID.
    const expectedFks = TENANT_OWNERSHIP_SPECS.flatMap((s) => s.parents.map((p) => compositeFkName(s.table, p.column)));
    expect(
      onlineScalar(
        `SELECT count(*) FROM pg_constraint WHERE connamespace = '${onlineSchema}'::regnamespace AND NOT convalidated AND conname = ANY(ARRAY['${expectedFks.join("','")}']);`,
      ),
    ).toBe(String(expectedFks.length));
  });
});
