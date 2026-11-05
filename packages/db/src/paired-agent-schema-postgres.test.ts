/** Paired-agents slice 2: real constraints, index preparation and CLI preflight.
 * Only make test-pg-gate injects OMNI_G2_POSTGRES_URL (a disposable cluster).
 * Runtime/DDL connections prove their non-superuser, NOBYPASSRLS identity.
 * Superuser use is limited to fixture provisioning, statistics and invalid-index
 * simulation, and teardown. No ambient DATABASE_URL is consulted.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { createDbHandle } from './client';
import { applyOnlineTenantDdl, checkOnlineDdlPreflight } from './online-ddl';
import {
  assertPgTestRole,
  createDatabaseFromTemplate,
  driverRejection,
  ensureSqlTemplate,
  pgRoleUrl,
  sqlTemplateName,
} from './pg-migrated-template';
import {
  DEFAULT_ROLE_NAMES,
  connectorIngressFunctionStatements,
  connectorIngressRoleStatements,
  contextFunctionStatements,
} from './tenancy-rls';
import { applyTenancyRoles } from './tenancy-roles';

const superUrl = process.env.OMNI_G2_POSTGRES_URL ?? '';
const postgresDescribe = superUrl ? describe : describe.skip;
const psqlBin = process.env.OMNI_G2_PSQL_BIN ?? 'psql';
const drizzleDir = join(import.meta.dir, '..', 'drizzle');
const migrationFile = readdirSync(drizzleDir).find((name) => name.endsWith('_paired_agent_consumers.sql'));
if (!migrationFile) throw new Error('paired-agent migration missing');
const migration = readFileSync(join(drizzleDir, migrationFile), 'utf8');
const prefix = readdirSync(drizzleDir)
  .filter((name) => name.endsWith('.sql') && name < migrationFile)
  .sort()
  .map((name) => readFileSync(join(drizzleDir, name), 'utf8'))
  .join('\n');
const legacyId = '00000000-0000-4000-8000-000000000001';
const agentId = '00000000-0000-4000-8000-000000000002';
const sourceId = '00000000-0000-4000-8000-000000000003';
const keyId = '00000000-0000-4000-8000-000000000004';

// Independent expected definitions pin table, ordering and predicates, not names.
const expectedIndexes = [
  {
    name: 'omni_events_instance_type_seq_idx',
    columns: 'instance_id, event_type, journal_seq',
    predicate: 'instance_id',
  },
  {
    name: 'omni_events_source_type_seq_idx',
    columns: 'source_kind, source_id, event_type, journal_seq',
    predicate: 'source_kind',
  },
  { name: 'omni_events_agent_type_seq_idx', columns: 'agent_id, event_type, journal_seq', predicate: 'agent_id' },
  { name: 'omni_events_producing_key_idx', columns: 'producing_key_id', predicate: 'producing_key_id' },
].map(({ name, columns, predicate }) => ({
  name,
  definition: `CREATE INDEX ${name} ON public.omni_events USING btree (${columns}) WHERE (${predicate} IS NOT NULL)`,
}));

function fixtureSql(url: string, script: string): void {
  const file = join(tmpdir(), `omni-pa-fixture-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [psqlBin, '-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  } finally {
    rmSync(file, { force: true });
  }
}

postgresDescribe('paired-agent schema and journal preparation', () => {
  const database = `omni_pa_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: crypto.randomUUID(), runtime: crypto.randomUUID(), authPlane: crypto.randomUUID() };
  let runtime: ReturnType<typeof createDbHandle>;
  let ddl: ReturnType<typeof createDbHandle>;
  let fixture: ReturnType<typeof createDbHandle>;
  let ddlUrl = '';

  beforeAll(async () => {
    const access = { superUrl, psqlBin };
    const template = sqlTemplateName('omni_pa_prefix', prefix);
    ensureSqlTemplate(access, template, prefix);
    createDatabaseFromTemplate(access, database, template);
    const fixtureUrl = pgRoleUrl(superUrl, database);
    fixtureSql(
      fixtureUrl,
      `
      INSERT INTO omni_events (id, channel, event_type) VALUES ('${legacyId}', 'system', 'custom.legacy');
      ${migration}
      ${migration}
    `,
    );
    fixture = createDbHandle({ url: fixtureUrl, maxConnections: 1 });
    // Install role-grant prerequisites while keeping the additive schema's
    // legacy (RLS-off) state. Runtime queries still prove the live role.
    for (const statement of [
      ...connectorIngressRoleStatements(),
      ...contextFunctionStatements(),
      ...connectorIngressFunctionStatements(),
    ])
      await fixture.db.execute(sql.raw(statement));
    await applyTenancyRoles(fixture.db, passwords, DEFAULT_ROLE_NAMES, database);
    ddlUrl = pgRoleUrl(superUrl, database, { name: DEFAULT_ROLE_NAMES.ddl, password: passwords.ddl });
    ddl = createDbHandle({ url: ddlUrl, maxConnections: 1 });
    await assertPgTestRole(ddl.db, DEFAULT_ROLE_NAMES.ddl);
    runtime = createDbHandle({
      url: pgRoleUrl(superUrl, database, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }),
      maxConnections: 1,
    });
    await assertPgTestRole(runtime.db, DEFAULT_ROLE_NAMES.runtime);
    await runtime.db.execute(sql`INSERT INTO agents (id, name, provider) VALUES (${agentId}, 'pa-fixture', 'custom')`);
  });

  afterAll(async () => {
    await runtime?.close();
    await ddl?.close();
    await fixture?.close();
    if (superUrl) fixtureSql(superUrl, `DROP DATABASE IF EXISTS "${database}" WITH (FORCE);`);
  });

  async function assertDefinitions(): Promise<void> {
    const rows = await runtime.db.execute<{ name: string; definition: string; valid: boolean; ready: boolean }>(sql`
      SELECT c.relname::text AS name, pg_get_indexdef(c.oid) AS definition,
        i.indisvalid AS valid, i.indisready AS ready
      FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN (
        'omni_events_instance_type_seq_idx', 'omni_events_source_type_seq_idx',
        'omni_events_agent_type_seq_idx', 'omni_events_producing_key_idx'
      ) ORDER BY c.relname
    `);
    expect([...rows]).toEqual(
      expectedIndexes
        .map((index) => ({ ...index, valid: true, ready: true }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    );
  }

  test('migration is idempotent, preserves legacy NULL stamps and installs exact index definitions', async () => {
    const rows = await runtime.db.execute(sql`
      SELECT producing_key_id, source_kind, source_id FROM omni_events WHERE id = ${legacyId}
    `);
    expect([...rows]).toEqual([{ producing_key_id: null, source_kind: null, source_id: null }]);
    await assertDefinitions();
    const runbook = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'docs/deployment/paired-agent-journal-indexes.md'),
      'utf8',
    );
    for (const index of expectedIndexes) expect(runbook).toContain(index.definition);
    const constraints = await runtime.db.execute(sql`
      SELECT convalidated FROM pg_constraint WHERE conname = 'omni_events_source_ref_ck'
    `);
    expect(constraints[0]?.convalidated).toBe(false);
  });

  test('source CHECK rejects both half references and unknown kinds; accepts NULL and all source kinds', async () => {
    for (const [kind, id] of [
      ['connector', null],
      [null, sourceId],
      ['unknown', sourceId],
    ]) {
      await expect(
        driverRejection(
          runtime.db.execute(sql`
        INSERT INTO omni_events (channel, event_type, source_kind, source_id)
        VALUES ('system', 'custom.invalid', ${kind}, ${id})
      `),
        ),
      ).rejects.toThrow('omni_events_source_ref_ck');
    }
    for (const kind of [null, 'connector', 'connector_subscription', 'webhook_source']) {
      await runtime.db.execute(sql`
        INSERT INTO omni_events (channel, event_type, source_kind, source_id)
        VALUES ('system', 'custom.valid', ${kind}, ${kind === null ? null : sourceId})
      `);
    }
  });

  test('grant kind CHECK, active uniqueness and revoked replacement are enforced', async () => {
    const insert = (kind: string) =>
      runtime.db.execute(sql`
      INSERT INTO agent_source_grants (agent_id, source_kind, source_id, approved_by_key_id)
      VALUES (${agentId}, ${kind}, ${sourceId}, ${keyId})
    `);
    await expect(driverRejection(insert('unknown'))).rejects.toThrow('agent_source_grants_kind_ck');
    for (const kind of ['connector', 'connector_subscription', 'webhook_source', 'agent']) await insert(kind);
    await expect(driverRejection(insert('connector'))).rejects.toThrow('agent_source_grants_active_uq');
    await runtime.db.execute(sql`UPDATE agent_source_grants SET revoked_at = now() WHERE source_kind = 'connector'`);
    await insert('connector');
    const rows = await runtime.db.execute(sql`
      SELECT count(*)::int AS n FROM agent_source_grants WHERE source_kind = 'connector'
    `);
    expect(rows[0]?.n).toBe(2);
  });

  test('online phase repairs invalid and not-ready residue and rebuilds missing indexes with exact definitions', async () => {
    await ddl.db.execute(sql`DROP INDEX omni_events_instance_type_seq_idx`);
    // Disposable-only catalog corruption simulates two interrupted builds.
    await fixture.db.execute(sql`
      UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'omni_events_source_type_seq_idx'::regclass
    `);
    await fixture.db.execute(sql`
      UPDATE pg_index SET indisready = false WHERE indexrelid = 'omni_events_agent_type_seq_idx'::regclass
    `);
    const before = await checkOnlineDdlPreflight(runtime.db, 0);
    expect(before.blockers).toContainEqual({
      table: 'omni_events',
      estimatedRows: expect.any(Number),
      missingIndexes: [
        'omni_events_instance_type_seq_idx',
        'omni_events_source_type_seq_idx',
        'omni_events_agent_type_seq_idx',
      ],
    });
    const report = await applyOnlineTenantDdl(ddl.db);
    expect(report.repaired.sort()).toEqual(['omni_events_agent_type_seq_idx', 'omni_events_source_type_seq_idx']);
    await assertDefinitions();
    expect((await checkOnlineDdlPreflight(runtime.db, 0)).blocked).toBe(false);
  });

  test('estimate boundary, stale low estimate and never-analyzed bounded probe are explicit limits', async () => {
    await runtime.db.execute(sql`
      INSERT INTO omni_events (channel, event_type)
      SELECT 'system', 'custom.stats' FROM generate_series(1, 25)
    `);
    await ddl.db.execute(sql`ANALYZE omni_events`);
    await ddl.db.execute(sql`DROP INDEX omni_events_producing_key_idx`);
    const boundaries: [number, boolean][] = [
      [999_999, false],
      [1_000_000, true],
      [10, false],
    ];
    for (const [estimate, blocked] of boundaries) {
      await fixture.db.execute(sql`UPDATE pg_class SET reltuples = ${estimate} WHERE oid = 'omni_events'::regclass`);
      expect((await checkOnlineDdlPreflight(runtime.db)).blocked).toBe(blocked);
    }
    const rows = await runtime.db.execute(sql`SELECT count(*)::int AS n FROM omni_events`);
    expect(rows[0]?.n).toBeGreaterThan(10);
    await fixture.db.execute(sql`UPDATE pg_class SET reltuples = -1 WHERE oid = 'omni_events'::regclass`);
    expect((await checkOnlineDdlPreflight(runtime.db, 20)).blockers).toContainEqual({
      table: 'omni_events',
      estimatedRows: 20,
      missingIndexes: ['omni_events_producing_key_idx'],
    });
    expect((await checkOnlineDdlPreflight(runtime.db, 100)).blocked).toBe(false);
    await applyOnlineTenantDdl(ddl.db);
  });

  test('runner --check exits 3 when blocked and 0 after its online run; missing URL exits 2', async () => {
    await ddl.db.execute(sql`DROP INDEX omni_events_producing_key_idx`);
    await fixture.db.execute(sql`UPDATE pg_class SET reltuples = 1000000 WHERE oid = 'omni_events'::regclass`);
    const run = async (...args: string[]) => {
      const child = Bun.spawn({
        cmd: [process.execPath, 'run', 'scripts/online-ddl.ts', ...args],
        cwd: join(import.meta.dir, '..'),
        env: process.env,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { output: stdout + stderr, exit };
    };
    const blocked = await run('--url', ddlUrl, '--check');
    expect(blocked.exit).toBe(3);
    expect(blocked.output).toContain('omni_events');
    expect(blocked.output).toContain('omni_events_producing_key_idx');
    expect((await run('--url', ddlUrl)).exit).toBe(0);
    expect((await run('--url', ddlUrl, '--check')).exit).toBe(0);
    expect((await run('--check')).exit).toBe(2);
    await assertDefinitions();
  });

  test('deleting an agent cascades grants but preserves consumer ownership without a foreign key', async () => {
    await runtime.db.execute(sql`
      INSERT INTO durable_consumers (name, event_type, agent_id) VALUES ('orphan-fixture', '*', ${agentId})
    `);
    await runtime.db.execute(sql`DELETE FROM agents WHERE id = ${agentId}`);
    const consumers = await runtime.db.execute(
      sql`SELECT agent_id FROM durable_consumers WHERE name = 'orphan-fixture'`,
    );
    expect(consumers[0]?.agent_id).toBe(agentId);
    const grants = await runtime.db.execute(
      sql`SELECT count(*)::int AS n FROM agent_source_grants WHERE agent_id = ${agentId}`,
    );
    expect(grants[0]?.n).toBe(0);
  });
});
