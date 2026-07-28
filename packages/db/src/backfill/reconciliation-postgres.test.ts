/**
 * Real-PostgreSQL contracts for G6 reconciliation, quarantine reporting, key
 * classification, and the redaction probe. Keyed on `OMNI_G6_POSTGRES_URL`.
 *
 * Proves on the server:
 *   * per-table counts / null-owner / cross-tenant FK violation DETECTION;
 *   * the quarantine report carries identifiers only and is never exposed;
 *   * EVERY ledger image / receipt / report is free of secret material, with a
 *     seeded secret-bearing fixture row proving the redaction probe actually fires;
 *   * key classification matches seeded god / multi-tenant / single / unmapped
 *     keys with fully redacted output (no hash).
 */

import { describe, expect, test } from 'bun:test';
import { runBackfill } from './engine';
import { classifyLegacyKeys } from './key-classification';
import type { InstanceTenantMap } from './mapping-engine';
import { connect, dropDatabase, provisionDatabase, superUrl } from './pg-testing';
import { quarantineReport, reconcile } from './reconciliation';
import { scanForSecrets } from './redaction';

const base = superUrl();
const maybe = base.length > 0 ? describe : describe.skip;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INST_A = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const INST_B = 'aaaaaaaa-0000-4000-8000-0000000000b1';
const CHAT_A = 'cccccccc-0000-4000-8000-0000000000a1';
const EVENT_SECRET = 'eeeeeeee-0000-4000-8000-0000000000f1';
/** A raw secret seeded into a row's free-text column to test the redaction probe. */
const RAW_SECRET = 'sk-livedeadbeefdeadbeefdeadbeef0001';

const FIXTURE = `
INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
  ('${TENANT_A}', 'tenant-a', 'Tenant A', 86400, 100, 100),
  ('${TENANT_B}', 'tenant-b', 'Tenant B', 86400, 100, 100);
INSERT INTO instances (id, name, channel) VALUES
  ('${INST_A}', 'inst-a', 'whatsapp'), ('${INST_B}', 'inst-b', 'whatsapp');
INSERT INTO chats (id, instance_id, external_id, chat_type, channel) VALUES
  ('${CHAT_A}', '${INST_A}', 'ext-a', 'dm', 'whatsapp');
INSERT INTO omni_events (id, channel, event_type, instance_id, text_content) VALUES
  ('${EVENT_SECRET}', 'whatsapp', 'message', '${INST_A}', '${RAW_SECRET}');

-- Migration 0021 seeds one default automation; clear it so counts are deterministic.
DELETE FROM automations;
INSERT INTO automations (id, name, trigger_event_type, actions) VALUES
  ('11110000-0000-4000-8000-000000000001', 'auto-1', 'message', '[]'::jsonb);

-- Legacy keys: single-tenant, multi-tenant, god, and unmapped. key_hash is the
-- seeded secret that must NEVER reach a report.
INSERT INTO api_keys (id, name, key_prefix, key_hash, scopes, instance_ids, status) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'single', 'omni_sk_s1', 'HASHSINGLEdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef00', ARRAY['messages:read'], ARRAY['${INST_A}']::uuid[], 'active'),
  ('c0000000-0000-4000-8000-000000000002', 'multi', 'omni_sk_m1', 'HASHMULTIdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef000', ARRAY['messages:read'], ARRAY['${INST_A}','${INST_B}']::uuid[], 'active'),
  ('c0000000-0000-4000-8000-000000000003', 'god', 'omni_sk_g1', 'HASHGODdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef00000', ARRAY['*'], NULL, 'active'),
  ('c0000000-0000-4000-8000-000000000004', 'unmapped', 'omni_sk_u1', 'HASHUNMAPdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef000', ARRAY['messages:read'], ARRAY['aaaaaaaa-0000-4000-8000-0000000000ff']::uuid[], 'active');
`;

const instanceMap: InstanceTenantMap = new Map([
  [INST_A, TENANT_A],
  [INST_B, TENANT_B],
]);

maybe('G6 reconciliation & reporting — real PostgreSQL', () => {
  test('the redaction probe fires on a raw secret, and never on the ledger images', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      // Prove the probe is not vacuous: it flags the raw seeded secret.
      expect(scanForSecrets({ leaked: RAW_SECRET }).length).toBeGreaterThan(0);

      await runBackfill(sql, {
        mode: 'apply',
        instanceTenantMap: instanceMap,
        tables: ['instances', 'chats', 'omni_events', 'automations'],
      });

      // Every ledger image (pre + post) is scanned: no secret survives redaction,
      // even though the source row carried one in text_content.
      const images = await sql<{ pre: unknown; post: unknown }[]>`
        SELECT pre_image_redacted AS pre, post_image_redacted AS post FROM tenant_migration_ledger`;
      expect(images.length).toBeGreaterThan(0);
      for (const img of images) {
        expect(scanForSecrets(img.pre)).toEqual([]);
        expect(scanForSecrets(img.post)).toEqual([]);
      }
      // And the raw secret literally does not appear in any stored image.
      expect(JSON.stringify(images)).not.toContain(RAW_SECRET);
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });

  test('reconciliation counts, and cross-tenant FK violations are DETECTED', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      await runBackfill(sql, {
        mode: 'apply',
        instanceTenantMap: instanceMap,
        tables: ['instances', 'chats', 'omni_events', 'automations'],
      });

      let report = await reconcile(sql, ['instances', 'chats', 'omni_events', 'automations']);
      const chats = report.tables.find((t) => t.table === 'chats')!;
      expect(chats.assigned).toBe(1);
      expect(chats.crossTenantFkViolations).toBe(0);
      // automations is stop-blocked -> its one row is a quarantined, accounted null.
      const automations = report.tables.find((t) => t.table === 'automations')!;
      expect(automations.nullOwner).toBe(1);
      expect(automations.unresolved).toBe(0);

      // Seed a cross-tenant corruption of the kind reconciliation exists to
      // catch: a row that predates the composite FK. Drop the NOT VALID FK (which
      // would otherwise block the write) to simulate that pre-existing state,
      // then force the chat to tenant B while its instance is tenant A.
      await sql.unsafe(`ALTER TABLE "chats" DROP CONSTRAINT IF EXISTS "chats_instance_id_tenant_fk"`);
      await sql.unsafe(`UPDATE "chats" SET tenant_id = $1 WHERE id = $2`, [TENANT_B, CHAT_A]);
      report = await reconcile(sql, ['chats']);
      expect(report.tables.find((t) => t.table === 'chats')!.crossTenantFkViolations).toBe(1);
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });

  test('the quarantine report carries identifiers only and is redaction-clean', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      await runBackfill(sql, { mode: 'apply', instanceTenantMap: instanceMap, tables: ['automations'] });
      const report = await quarantineReport(sql, ['automations']);
      expect(report.total).toBe(1);
      const entry = report.entries.find((e) => e.table === 'automations')!;
      expect(entry.count).toBe(1);
      expect(entry.identifiers).toHaveLength(1);
      expect(scanForSecrets(report)).toEqual([]);
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });

  test('key classification matches seeded classes with fully redacted output', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      const report = await classifyLegacyKeys(sql, instanceMap);
      expect(report.counts['tenant-key-candidate']).toBe(1);
      expect(report.counts['multi-tenant']).toBe(1);
      expect(report.counts['platform-credential']).toBe(1); // god key
      expect(report.counts.unresolved).toBe(1);

      // No hash, no secret material anywhere in the report.
      expect(JSON.stringify(report)).not.toMatch(/HASH(SINGLE|MULTI|GOD|UNMAP)/);
      expect(scanForSecrets(report)).toEqual([]);

      const god = report.keys.find((k) => k.name === 'god')!;
      expect(god.requiresOwnerAndPurpose).toBe(true);
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });
});
