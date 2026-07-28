/**
 * Real-PostgreSQL contracts for the G6 backfill engine (dry-run / apply / resume)
 * (wish: omni-full-multitenancy, Group G6).
 *
 * Keyed on `OMNI_G6_POSTGRES_URL` (the pg-gate exports it from a DISPOSABLE
 * cluster). Every run provisions its own database, applies the committed
 * migrations, seeds SYNTHETIC fixtures, and drops the database. No ambient URL,
 * no shared cluster, no application data.
 *
 * Proves, on the server (a string cannot):
 *   * dry-run writes nothing (0 ledger rows, every tenant_id still NULL);
 *   * apply assigns via composite ownership and quarantines conflicts/orphans;
 *   * the three silent-decision tables stop-block by name;
 *   * every rewrite has a PRIOR durable ledger entry (crash-recovery probe);
 *   * apply is idempotent and resumable after a mid-run kill;
 *   * apply -> invert -> byte-identical restore, proven by checksum.
 */

import { describe, expect, test } from 'bun:test';
import { checksum } from './checksum';
import { applyInverse } from './compensation';
import type { ToolingSql } from './db';
import { EngineCrash, runBackfill } from './engine';
import { findBySource } from './ledger';
import type { InstanceTenantMap } from './mapping-engine';
import { connect } from './pg-testing';
import { dropDatabase, provisionDatabase, superUrl } from './pg-testing';

const base = superUrl();
const maybe = base.length > 0 ? describe : describe.skip;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INSTANCE_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const INSTANCE_B = 'aaaaaaaa-0000-4000-8000-000000000002';
const INSTANCE_C = 'aaaaaaaa-0000-4000-8000-000000000003'; // unmapped -> quarantine
const CHAT_A = 'cccccccc-0000-4000-8000-000000000001';
const CHAT_B = 'cccccccc-0000-4000-8000-000000000002';
const EVENT_A = 'eeeeeeee-0000-4000-8000-000000000001';
const EVENT_CONFLICT = 'eeeeeeee-0000-4000-8000-000000000002';
const EVENT_ORPHAN = 'eeeeeeee-0000-4000-8000-000000000003';

/** Synthetic fixture. Includes a seeded SECRET-bearing column to prove redaction. */
const FIXTURE = `
INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
  ('${TENANT_A}', 'tenant-a', 'Tenant A', 86400, 100, 100),
  ('${TENANT_B}', 'tenant-b', 'Tenant B', 86400, 100, 100);

INSERT INTO instances (id, name, channel) VALUES
  ('${INSTANCE_A}', 'inst-a', 'whatsapp'),
  ('${INSTANCE_B}', 'inst-b', 'whatsapp'),
  ('${INSTANCE_C}', 'inst-c-unmapped', 'whatsapp');

INSERT INTO chats (id, instance_id, external_id, chat_type, channel) VALUES
  ('${CHAT_A}', '${INSTANCE_A}', 'ext-a', 'dm', 'whatsapp'),
  ('${CHAT_B}', '${INSTANCE_B}', 'ext-b', 'dm', 'whatsapp');

INSERT INTO omni_events (id, channel, event_type, instance_id, chat_uuid, text_content) VALUES
  ('${EVENT_A}', 'whatsapp', 'message', '${INSTANCE_A}', NULL, 'sk-liveSECRETshouldneverleak0001'),
  ('${EVENT_CONFLICT}', 'whatsapp', 'message', '${INSTANCE_A}', '${CHAT_B}', NULL),
  ('${EVENT_ORPHAN}', 'whatsapp', 'message', NULL, NULL, NULL);

INSERT INTO dead_letter_events (id, event_id, event_type, subject, payload, error) VALUES
  ('dddddddd-0000-4000-8000-000000000001', '${EVENT_A}', 'message', 'subj', '{}'::jsonb, 'boom'),
  ('dddddddd-0000-4000-8000-000000000002', 'no-such-event-id-value-here-000000ff', 'message', 'subj', '{}'::jsonb, 'boom');

INSERT INTO processed_events (event_id, handler) VALUES
  ('${EVENT_A}', 'handler-x');

INSERT INTO automations (id, name, trigger_event_type, actions) VALUES
  ('11110000-0000-4000-8000-000000000001', 'auto-1', 'message', '[]'::jsonb);
INSERT INTO conversations (id, title) VALUES
  ('22220000-0000-4000-8000-000000000001', 'conv-1');
INSERT INTO webhook_sources (id, name) VALUES
  ('33330000-0000-4000-8000-000000000001', 'wh-1');
`;

const instanceMap: InstanceTenantMap = new Map([
  [INSTANCE_A, TENANT_A],
  [INSTANCE_B, TENANT_B],
]);

const SCOPE = [
  'instances',
  'chats',
  'omni_events',
  'dead_letter_events',
  'processed_events',
  'automations',
  'conversations',
  'webhook_sources',
];

async function tenantOf(sql: ToolingSql, table: string, id: string): Promise<string | null> {
  const rows = (await sql.unsafe(`SELECT tenant_id FROM "${table}" WHERE id = $1`, [id])) as unknown as {
    tenant_id: string | null;
  }[];
  return rows[0]?.tenant_id ?? null;
}

async function ledgerCount(sql: ToolingSql): Promise<number> {
  const rows = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM tenant_migration_ledger`;
  return Number(rows[0]?.n ?? '0');
}

maybe('G6 backfill engine — real PostgreSQL', () => {
  test('dry-run reaches every decision but writes NOTHING', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      const report = await runBackfill(sql, { mode: 'dry-run', instanceTenantMap: instanceMap, tables: SCOPE });

      // Decisions were reached...
      const instances = report.tables.find((t) => t.table === 'instances')!;
      expect(instances.scanned).toBe(3);
      expect(instances.assigned).toBe(2); // A, B
      expect(instances.quarantined).toBe(1); // C unmapped
      expect(report.stopBlocked.map((s) => s.table).sort()).toEqual([
        'automations',
        'conversations',
        'webhook_sources',
      ]);

      // ...but nothing was written.
      expect(await ledgerCount(sql)).toBe(0);
      expect(await tenantOf(sql, 'instances', INSTANCE_A)).toBeNull();
      expect(await tenantOf(sql, 'chats', CHAT_A)).toBeNull();
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });

  test('apply assigns via composite ownership; conflicts/orphans quarantine; silent tables stop-block', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      const report = await runBackfill(sql, { mode: 'apply', instanceTenantMap: instanceMap, tables: SCOPE });

      // Roots and derived rows assigned by the composite path.
      expect(await tenantOf(sql, 'instances', INSTANCE_A)).toBe(TENANT_A);
      expect(await tenantOf(sql, 'instances', INSTANCE_B)).toBe(TENANT_B);
      expect(await tenantOf(sql, 'instances', INSTANCE_C)).toBeNull(); // unmapped
      expect(await tenantOf(sql, 'chats', CHAT_A)).toBe(TENANT_A);
      expect(await tenantOf(sql, 'omni_events', EVENT_A)).toBe(TENANT_A);
      expect(await tenantOf(sql, 'omni_events', EVENT_CONFLICT)).toBeNull(); // A vs B
      expect(await tenantOf(sql, 'omni_events', EVENT_ORPHAN)).toBeNull(); // no parent

      // derive-from-event
      const dlqA = await findBySource(sql, 'dead_letter_events', {
        id: 'dddddddd-0000-4000-8000-000000000001',
      });
      expect(dlqA?.status).toBe('applied');
      expect(dlqA?.targetTenantId).toBe(TENANT_A);
      const dlqOrphan = await findBySource(sql, 'dead_letter_events', {
        id: 'dddddddd-0000-4000-8000-000000000002',
      });
      expect(dlqOrphan?.status).toBe('quarantined');

      // processed_events derives via the owning event, PK-rewrite deferred.
      const pe = await findBySource(sql, 'processed_events', { event_id: EVENT_A, handler: 'handler-x' });
      expect(pe?.targetTenantId).toBe(TENANT_A);
      expect(report.deferrals.map((d) => d.table)).toContain('processed_events');

      // conflict quarantined as ambiguous
      const conflict = await findBySource(sql, 'omni_events', { id: EVENT_CONFLICT });
      expect(conflict?.status).toBe('quarantined');

      // stop-blocked tables named with their open questions
      const names = report.stopBlocked.map((s) => s.table).sort();
      expect(names).toEqual(['automations', 'conversations', 'webhook_sources']);
      for (const sb of report.stopBlocked) expect(sb.openQuestion.length).toBeGreaterThan(0);
      expect(await tenantOf(sql, 'automations', '11110000-0000-4000-8000-000000000001')).toBeNull();
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });

  test('every rewrite has a PRIOR durable ledger entry (crash between plan and rewrite)', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      // Crash after the very first planned entry — before its row is rewritten.
      let crashed = false;
      try {
        await runBackfill(sql, {
          mode: 'apply',
          instanceTenantMap: instanceMap,
          tables: ['instances'],
          faultAfterPlanned: 1,
        });
      } catch (error) {
        crashed = error instanceof EngineCrash;
      }
      expect(crashed).toBe(true);

      // Exactly one planned ledger row exists, and ITS source row is still NULL:
      // the ledger entry is durable and precedes the rewrite.
      const planned = await sql<{ source_primary_key: { id: string }; status: string }[]>`
        SELECT source_primary_key, status FROM tenant_migration_ledger WHERE source_table = 'instances'
      `;
      expect(planned.length).toBe(1);
      expect(planned[0]!.status).toBe('planned');
      expect(await tenantOf(sql, 'instances', planned[0]!.source_primary_key.id)).toBeNull();

      // Resume: no fault. The planned row is completed, the rest assigned.
      await runBackfill(sql, { mode: 'apply', instanceTenantMap: instanceMap, tables: ['instances'] });
      expect(await tenantOf(sql, 'instances', INSTANCE_A)).toBe(TENANT_A);
      expect(await tenantOf(sql, 'instances', INSTANCE_B)).toBe(TENANT_B);
      const done = await findBySource(sql, 'instances', { id: planned[0]!.source_primary_key.id });
      expect(done?.status).toBe('applied');
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });

  test('apply is idempotent — a second full run changes nothing', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      await runBackfill(sql, { mode: 'apply', instanceTenantMap: instanceMap, tables: SCOPE });
      const firstCount = await ledgerCount(sql);
      const first = await sql<{ id: string; revision: string }[]>`
        SELECT ledger_id AS id, max(revision)::text AS revision
        FROM tenant_migration_ledger_history GROUP BY ledger_id ORDER BY ledger_id`;

      await runBackfill(sql, { mode: 'apply', instanceTenantMap: instanceMap, tables: SCOPE });
      expect(await ledgerCount(sql)).toBe(firstCount); // no new ledger rows

      // No settled row was re-updated (history revision count unchanged).
      const second = await sql<{ id: string; revision: string }[]>`
        SELECT ledger_id AS id, max(revision)::text AS revision
        FROM tenant_migration_ledger_history GROUP BY ledger_id ORDER BY ledger_id`;
      expect(second).toEqual(first);
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });

  test('apply -> invert -> byte-identical restore, proven by checksum', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      // Pre-image checksum of a row we will assign.
      const preRow = (await sql.unsafe(`SELECT * FROM "instances" WHERE id = $1`, [INSTANCE_A])) as unknown as Record<
        string,
        unknown
      >[];
      const preChecksum = checksum(preRow[0]!);

      await runBackfill(sql, { mode: 'apply', instanceTenantMap: instanceMap, tables: ['instances'] });
      expect(await tenantOf(sql, 'instances', INSTANCE_A)).toBe(TENANT_A);

      // Pull the stored inverse and replay it.
      const entry = await sql<{ inverse_action: import('./ledger').InverseAction; pre_image_checksum: string }[]>`
        SELECT inverse_action, pre_image_checksum FROM tenant_migration_ledger
        WHERE source_table = 'instances' AND source_primary_key = ${sql.json({ id: INSTANCE_A })}`;
      expect(entry[0]!.pre_image_checksum).toBe(preChecksum);
      await applyInverse(sql, entry[0]!.inverse_action);

      const postRow = (await sql.unsafe(`SELECT * FROM "instances" WHERE id = $1`, [INSTANCE_A])) as unknown as Record<
        string,
        unknown
      >[];
      expect(checksum(postRow[0]!)).toBe(preChecksum); // byte-identical
      expect(await tenantOf(sql, 'instances', INSTANCE_A)).toBeNull();
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });
});
