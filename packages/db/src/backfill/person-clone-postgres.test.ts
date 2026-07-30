/**
 * Real-PostgreSQL contracts for G6 person cloning (ADR-0002).
 * Keyed on `OMNI_G6_POSTGRES_URL` via the pg-gate; disposable cluster only.
 *
 * Proves on the server:
 *   * a person spanning two tenants is CLONED per tenant with references rewired
 *     deterministically, and overlapping natural identifiers never merge;
 *   * a single-tenant person is assigned directly; an orphan quarantines;
 *   * one ledger entry per created clone, with a compensating undo;
 *   * clone -> undo restores the original graph (clones gone, references back).
 */

import { describe, expect, test } from 'bun:test';
import { applyInverse } from './compensation';
import type { ToolingSql } from './db';
import { runBackfill } from './engine';
import { findBySource } from './ledger';
import type { InstanceTenantMap } from './mapping-engine';
import { personCloneId, runPersonCloning } from './person-clone';
import { connect, dropDatabase, provisionDatabase, superUrl } from './pg-testing';
import { assertTenantUniquesPresent, replacePreservedGlobalUniques } from './rehearsal';

const base = superUrl();
const maybe = base.length > 0 ? describe : describe.skip;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INST_A = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const INST_B = 'aaaaaaaa-0000-4000-8000-0000000000b1';
const PERSON_SPAN = 'f0000000-0000-4000-8000-000000000001';
const PERSON_SINGLE = 'f0000000-0000-4000-8000-000000000002';
const PERSON_ORPHAN = 'f0000000-0000-4000-8000-000000000003';
const CHAT_A = 'c0000000-0000-4000-8000-0000000000a1';
const CHAT_B = 'c0000000-0000-4000-8000-0000000000b1';

/** A shared natural identifier (same phone/JID) present in BOTH tenants. */
const SHARED_JID = '55119999@s.whatsapp.net';

const FIXTURE = `
INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
  ('${TENANT_A}', 'tenant-a', 'Tenant A', 86400, 100, 100),
  ('${TENANT_B}', 'tenant-b', 'Tenant B', 86400, 100, 100);

INSERT INTO instances (id, name, channel) VALUES
  ('${INST_A}', 'inst-a', 'whatsapp'), ('${INST_B}', 'inst-b', 'whatsapp');

INSERT INTO persons (id, display_name, primary_phone) VALUES
  ('${PERSON_SPAN}', 'Spanning Person', '+5511999990000'),
  ('${PERSON_SINGLE}', 'Single Person', '+5511888880000'),
  ('${PERSON_ORPHAN}', 'Orphan Person', NULL);

INSERT INTO chats (id, instance_id, external_id, chat_type, channel) VALUES
  ('${CHAT_A}', '${INST_A}', 'ext-a', 'dm', 'whatsapp'),
  ('${CHAT_B}', '${INST_B}', 'ext-b', 'dm', 'whatsapp');

-- Same JID in both tenants, both pointing at the ONE global spanning person.
INSERT INTO platform_identities (id, person_id, channel, instance_id, platform_user_id) VALUES
  ('a1000000-0000-4000-8000-000000000001', '${PERSON_SPAN}', 'whatsapp', '${INST_A}', '${SHARED_JID}'),
  ('a1000000-0000-4000-8000-000000000002', '${PERSON_SPAN}', 'whatsapp', '${INST_B}', '${SHARED_JID}'),
  ('a1000000-0000-4000-8000-000000000003', '${PERSON_SINGLE}', 'whatsapp', '${INST_A}', 'single@s.whatsapp.net');

INSERT INTO chat_participants (id, chat_id, person_id, platform_user_id) VALUES
  ('b1000000-0000-4000-8000-000000000001', '${CHAT_A}', '${PERSON_SPAN}', '${SHARED_JID}'),
  ('b1000000-0000-4000-8000-000000000002', '${CHAT_B}', '${PERSON_SPAN}', '${SHARED_JID}');

INSERT INTO messages (id, chat_id, sender_person_id, external_id, source, message_type, platform_timestamp) VALUES
  ('d1000000-0000-4000-8000-000000000001', '${CHAT_A}', '${PERSON_SPAN}', 'm-a', 'whatsapp', 'text', now()),
  ('d1000000-0000-4000-8000-000000000002', '${CHAT_B}', '${PERSON_SPAN}', 'm-b', 'whatsapp', 'text', now());
`;

const instanceMap: InstanceTenantMap = new Map([
  [INST_A, TENANT_A],
  [INST_B, TENANT_B],
]);

async function personIdOf(sql: ToolingSql, table: string, column: string, rowId: string): Promise<string | null> {
  const rows = (await sql.unsafe(`SELECT ${column} AS p FROM "${table}" WHERE id = $1`, [rowId])) as unknown as {
    p: string | null;
  }[];
  return rows[0]?.p ?? null;
}

async function exists(sql: ToolingSql, table: string, id: string): Promise<boolean> {
  const rows = (await sql.unsafe(`SELECT 1 AS x FROM "${table}" WHERE id = $1`, [id])) as unknown as { x: number }[];
  return rows.length > 0;
}

maybe('G6 person cloning — real PostgreSQL', () => {
  test('spanning person is cloned per tenant; references rewired; identifiers never merge', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      // Root phase assigns instances; cloning derives person tenants from them.
      await runBackfill(sql, { mode: 'apply', instanceTenantMap: instanceMap, tables: ['instances'] });
      // Fenced-transformation precondition: replace the preserved global
      // natural-key uniques with their tenant-aware partials so a per-tenant
      // clone sharing a phone/JID is permitted (rehearsal-cluster DDL only).
      await assertTenantUniquesPresent(sql);
      await replacePreservedGlobalUniques(sql);
      const report = await runPersonCloning(sql, {});

      expect(report.personsScanned).toBe(3);
      expect(report.cloned).toBe(1);
      expect(report.clonesCreated).toBe(2);
      expect(report.singleTenantAssigned).toBe(1);
      expect(report.quarantined).toBe(1);

      const cloneA = personCloneId(PERSON_SPAN, TENANT_A);
      const cloneB = personCloneId(PERSON_SPAN, TENANT_B);
      expect(await exists(sql, 'persons', cloneA)).toBe(true);
      expect(await exists(sql, 'persons', cloneB)).toBe(true);

      // Clones carry the SAME natural phone but different tenants — no merge.
      const cloneARow = (await sql.unsafe(`SELECT tenant_id, primary_phone FROM "persons" WHERE id = $1`, [
        cloneA,
      ])) as unknown as { tenant_id: string; primary_phone: string }[];
      const cloneBRow = (await sql.unsafe(`SELECT tenant_id, primary_phone FROM "persons" WHERE id = $1`, [
        cloneB,
      ])) as unknown as { tenant_id: string; primary_phone: string }[];
      expect(cloneARow[0]!.primary_phone).toBe('+5511999990000');
      expect(cloneBRow[0]!.primary_phone).toBe('+5511999990000');
      // Same natural identifier, DIFFERENT tenants — never merged.
      expect(cloneARow[0]!.tenant_id).toBe(TENANT_A);
      expect(cloneBRow[0]!.tenant_id).toBe(TENANT_B);
      expect(cloneARow[0]!.tenant_id).not.toBe(cloneBRow[0]!.tenant_id);

      // References rewired to the per-tenant clone.
      expect(await personIdOf(sql, 'platform_identities', 'person_id', 'a1000000-0000-4000-8000-000000000001')).toBe(
        cloneA,
      );
      expect(await personIdOf(sql, 'platform_identities', 'person_id', 'a1000000-0000-4000-8000-000000000002')).toBe(
        cloneB,
      );
      expect(await personIdOf(sql, 'chat_participants', 'person_id', 'b1000000-0000-4000-8000-000000000001')).toBe(
        cloneA,
      );
      expect(await personIdOf(sql, 'messages', 'sender_person_id', 'd1000000-0000-4000-8000-000000000002')).toBe(
        cloneB,
      );

      // The single-tenant person is assigned directly; the orphan quarantines.
      const single = await findBySource(sql, 'persons', { id: PERSON_SINGLE });
      expect(single?.targetTenantId).toBe(TENANT_A);
      const orphan = await findBySource(sql, 'persons', { id: PERSON_ORPHAN });
      expect(orphan?.status).toBe('quarantined');

      // The spanning ORIGINAL keeps a NULL owner but is accounted for (quarantined
      // with its clone list), so the zero-unresolved gate does not flag it.
      const original = await findBySource(sql, 'persons', { id: PERSON_SPAN });
      expect(original?.status).toBe('quarantined');
      expect(original?.targetTenantId).toBeNull();

      // One ledger entry PER CREATED CLONE, keyed by the clone's own identity.
      expect((await findBySource(sql, 'persons', { id: cloneA }))?.targetTenantId).toBe(TENANT_A);
      expect((await findBySource(sql, 'persons', { id: cloneB }))?.targetTenantId).toBe(TENANT_B);
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });

  test('cloning is idempotent and its compensation restores the original graph', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      await runBackfill(sql, { mode: 'apply', instanceTenantMap: instanceMap, tables: ['instances'] });
      await replacePreservedGlobalUniques(sql);
      await runPersonCloning(sql, {});
      const cloneA = personCloneId(PERSON_SPAN, TENANT_A);
      const cloneB = personCloneId(PERSON_SPAN, TENANT_B);

      // Idempotent: a second run creates no additional clones.
      const second = await runPersonCloning(sql, {});
      expect(second.clonesCreated).toBe(0);

      // Replay every clone's compensating action: rewire references back, delete clone.
      for (const cloneId of [cloneA, cloneB]) {
        const rows = await sql<
          {
            compensating_action: {
              rewireBack: { table: string; column: string; to: string }[];
              deleteClone: { table: string; primaryKey: Record<string, unknown> };
            };
          }[]
        >`
          SELECT compensating_action FROM tenant_migration_ledger
          WHERE source_table = 'persons' AND source_primary_key = ${sql.json({ id: cloneId })}`;
        const comp = rows[0]!.compensating_action;
        for (const rw of comp.rewireBack) {
          // Restore person_id from clone back to the source person on that table.
          await sql.unsafe(`UPDATE "${rw.table}" SET "${rw.column}" = $1 WHERE "${rw.column}" = $2`, [rw.to, cloneId]);
        }
        await applyInverse(sql, {
          type: 'delete-row',
          table: comp.deleteClone.table,
          primaryKey: comp.deleteClone.primaryKey,
        });
      }

      // Original graph restored: clones gone, references back on the source person.
      expect(await exists(sql, 'persons', cloneA)).toBe(false);
      expect(await exists(sql, 'persons', cloneB)).toBe(false);
      expect(await personIdOf(sql, 'platform_identities', 'person_id', 'a1000000-0000-4000-8000-000000000001')).toBe(
        PERSON_SPAN,
      );
      expect(await personIdOf(sql, 'messages', 'sender_person_id', 'd1000000-0000-4000-8000-000000000001')).toBe(
        PERSON_SPAN,
      );
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });
});
