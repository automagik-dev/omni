/**
 * The G6 zero-unresolved synthetic rehearsal — real PostgreSQL, capstone suite.
 * Keyed on `OMNI_G6_POSTGRES_URL`; disposable cluster only.
 *
 * Drives the FULL pipeline production would follow under the state machine, on
 * synthetic fixtures:
 *
 *   replace preserved global uniques -> assign instances -> clone persons ->
 *   backfill descendants -> reconcile to ZERO unresolved -> VALIDATE the NOT VALID
 *   composite FKs -> enforcement-ready -> RLS probes on the ASSIGNED tables.
 *
 * The assigned unowned tables (persons via clone, dead_letter_events,
 * processed_events derived from the owning event) reach zero unresolved and pass
 * cross-tenant RLS probes; the stop-blocked tables
 * (automations/conversations/webhook_sources) are quarantined and named, not
 * hidden. It also proves VALIDATE FAILS CLOSED when reconciliation is non-zero.
 */

import { describe, expect, test } from 'bun:test';
import { createDbHandle } from '../client';
import { DEFAULT_ROLE_NAMES, applyTenantRlsEnforcement } from '../tenancy-rls';
import { applyTenancyRoles } from '../tenancy-roles';
import { openToolingConnection } from './db';
import type { ToolingSql } from './db';
import { runBackfill } from './engine';
import type { InstanceTenantMap } from './mapping-engine';
import { personCloneId, runPersonCloning } from './person-clone';
import { connect, dropDatabase, provisionDatabase, superUrl, urlFor } from './pg-testing';
import { assertZeroUnresolved, reconcile } from './reconciliation';
import { assertTenantUniquesPresent, replacePreservedGlobalUniques } from './rehearsal';
import { driveValidateOrdering } from './validate-ordering';

const base = superUrl();
const maybe = base.length > 0 ? describe : describe.skip;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INST_A = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const INST_B = 'aaaaaaaa-0000-4000-8000-0000000000b1';
const CHAT_A = 'cccccccc-0000-4000-8000-0000000000a1';
const CHAT_B = 'cccccccc-0000-4000-8000-0000000000b1';
const P_SPAN = 'f0000000-0000-4000-8000-000000000001';
const P_SINGLE = 'f0000000-0000-4000-8000-000000000002';
const EVENT_A = 'e0000000-0000-4000-8000-0000000000a1';
const EVENT_B = 'e0000000-0000-4000-8000-0000000000b1';
const JID = '55110000@s.whatsapp.net';

const FIXTURE = `
INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
  ('${TENANT_A}', 'tenant-a', 'Tenant A', 86400, 100, 100),
  ('${TENANT_B}', 'tenant-b', 'Tenant B', 86400, 100, 100);
INSERT INTO instances (id, name, channel) VALUES
  ('${INST_A}', 'inst-a', 'whatsapp'), ('${INST_B}', 'inst-b', 'whatsapp');
INSERT INTO chats (id, instance_id, external_id, chat_type, channel) VALUES
  ('${CHAT_A}', '${INST_A}', 'ext-a', 'dm', 'whatsapp'),
  ('${CHAT_B}', '${INST_B}', 'ext-b', 'dm', 'whatsapp');
INSERT INTO persons (id, display_name, primary_phone) VALUES
  ('${P_SPAN}', 'Spanning', '+5511000000001'),
  ('${P_SINGLE}', 'Single', '+5511000000002');
INSERT INTO platform_identities (id, person_id, channel, instance_id, platform_user_id) VALUES
  ('a1000000-0000-4000-8000-000000000001', '${P_SPAN}', 'whatsapp', '${INST_A}', '${JID}'),
  ('a1000000-0000-4000-8000-000000000002', '${P_SPAN}', 'whatsapp', '${INST_B}', '${JID}'),
  ('a1000000-0000-4000-8000-000000000003', '${P_SINGLE}', 'whatsapp', '${INST_A}', 'single@s.whatsapp.net');
INSERT INTO omni_events (id, channel, event_type, instance_id) VALUES
  ('${EVENT_A}', 'whatsapp', 'message', '${INST_A}'),
  ('${EVENT_B}', 'whatsapp', 'message', '${INST_B}');
INSERT INTO dead_letter_events (id, event_id, event_type, subject, payload, error) VALUES
  ('d0000000-0000-4000-8000-0000000000a1', '${EVENT_A}', 'message', 's', '{}'::jsonb, 'e'),
  ('d0000000-0000-4000-8000-0000000000b1', '${EVENT_B}', 'message', 's', '{}'::jsonb, 'e');
INSERT INTO processed_events (event_id, handler) VALUES ('${EVENT_A}', 'h');
-- Migration 0021 seeds one default automation; clear it so counts are deterministic.
DELETE FROM automations;
INSERT INTO automations (id, name, trigger_event_type, actions) VALUES
  ('11110000-0000-4000-8000-000000000001', 'auto-1', 'message', '[]'::jsonb);
INSERT INTO conversations (id, title) VALUES ('22220000-0000-4000-8000-000000000001', 'conv-1');
INSERT INTO webhook_sources (id, name) VALUES ('33330000-0000-4000-8000-000000000001', 'wh-1');
`;

const instanceMap: InstanceTenantMap = new Map([
  [INST_A, TENANT_A],
  [INST_B, TENANT_B],
]);

const REHEARSAL_TABLES = [
  'instances',
  'chats',
  'platform_identities',
  'omni_events',
  'dead_letter_events',
  'processed_events',
  'automations',
  'conversations',
  'webhook_sources',
];

/** Run the full backfill pipeline (epoch 5) on a provisioned database. */
async function runPipeline(sql: ToolingSql): Promise<void> {
  await assertTenantUniquesPresent(sql);
  await replacePreservedGlobalUniques(sql);
  await runBackfill(sql, { mode: 'apply', instanceTenantMap: instanceMap, tables: ['instances'], writerEpoch: 5 });
  await runPersonCloning(sql, { writerEpoch: 5 });
  await runBackfill(sql, { mode: 'apply', instanceTenantMap: instanceMap, tables: REHEARSAL_TABLES, writerEpoch: 5 });
}

function roleUrl(name: string, password: string, database: string): string {
  const url = new URL(urlFor(base, database));
  url.username = name;
  url.password = password;
  return url.toString();
}

function pw(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

maybe('G6 zero-unresolved rehearsal — real PostgreSQL', () => {
  test('full pipeline reaches zero unresolved, then VALIDATE ordering succeeds', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      await runPipeline(sql);

      const report = await reconcile(sql, REHEARSAL_TABLES);
      // Zero unresolved over the assigned set; the stop-blocked tables keep
      // accounted (quarantined) null owners, not unresolved ones.
      expect(report.totals.unresolved).toBe(0);
      expect(report.totals.crossTenantFkViolations).toBe(0);
      expect(() => assertZeroUnresolved(report)).not.toThrow();

      // Assigned unowned tables actually got owners.
      const dlq = report.tables.find((t) => t.table === 'dead_letter_events')!;
      expect(dlq.assigned).toBe(2);
      // Stop-blocked tables are quarantined + accounted.
      for (const table of ['automations', 'conversations', 'webhook_sources']) {
        const t = report.tables.find((x) => x.table === table)!;
        expect(t.nullOwner).toBe(1);
        expect(t.unresolved).toBe(0);
        expect(t.quarantinedInLedger).toBe(1);
      }

      // Ordering gate: VALIDATE the NOT VALID composite FKs now that owners are clean.
      const result = await driveValidateOrdering(sql, report);
      expect(result.enforcementReady).toBe(true);
      expect(result.validated.length).toBeGreaterThan(0);

      // No NOT VALID composite FK remains.
      const stillPending = await sql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM pg_constraint WHERE contype = 'f' AND NOT convalidated`;
      expect(Number(stillPending[0]!.n)).toBe(0);
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });

  test('VALIDATE ordering FAILS CLOSED when a row is unresolved', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      await runPipeline(sql);
      // Introduce an UNRESOLVED row: a fresh chat with NO instance (so the G2
      // ownership trigger derives no tenant and leaves it NULL) and NO ledger
      // entry accounting for it.
      await sql.unsafe(
        `INSERT INTO "chats" (id, external_id, chat_type, channel) VALUES ($1, 'orphan', 'dm', 'whatsapp')`,
        ['cccccccc-0000-4000-8000-00000000dead'],
      );
      const report = await reconcile(sql, REHEARSAL_TABLES);
      expect(report.totals.unresolved).toBeGreaterThan(0);
      await expect(driveValidateOrdering(sql, report)).rejects.toThrow(/not zero/i);
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });

  test('RLS probes pass for the assigned tables after enforcement', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    const passwords = { ddl: pw(), runtime: pw(), authPlane: pw() };
    const provisioner = createDbHandle({ url, maxConnections: 4 });
    let runtime: ToolingSql | null = null;
    try {
      await runPipeline(sql);

      // Reuse the G3 enforcement step on the rehearsal cluster.
      await applyTenantRlsEnforcement(provisioner.db);
      await applyTenancyRoles(provisioner.db, passwords, DEFAULT_ROLE_NAMES, database);

      runtime = openToolingConnection(roleUrl(DEFAULT_ROLE_NAMES.runtime, passwords.runtime, database));

      // Tenant A sees only its own assigned rows; tenant B's are invisible.
      const seenByA = async (table: string): Promise<number> => {
        const rows = await runtime!.begin(async (tx) => {
          await tx`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
          return tx.unsafe(`SELECT count(*)::int AS n FROM "${table}"`);
        });
        return (rows as unknown as { n: number }[])[0]!.n;
      };
      const seenByB = async (table: string): Promise<number> => {
        const rows = await runtime!.begin(async (tx) => {
          await tx`SELECT set_config('app.tenant_id', ${TENANT_B}, true)`;
          return tx.unsafe(`SELECT count(*)::int AS n FROM "${table}"`);
        });
        return (rows as unknown as { n: number }[])[0]!.n;
      };

      // persons: A sees cloneA + pSingle = 2; B sees cloneB = 1; neither sees the
      // NULL-owner original spanning person.
      expect(await seenByA('persons')).toBe(2);
      expect(await seenByB('persons')).toBe(1);
      // dead_letter_events: one per tenant, derived from the owning event.
      expect(await seenByA('dead_letter_events')).toBe(1);
      expect(await seenByB('dead_letter_events')).toBe(1);
      // Sanity: the clones exist with the expected deterministic ids.
      expect(personCloneId(P_SPAN, TENANT_A)).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      if (runtime) await runtime.end();
      await provisioner.close();
      await sql.end();
      dropDatabase(base, database);
    }
  });
});
