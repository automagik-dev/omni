/**
 * Real-PostgreSQL contracts for the G6 ownership-write fence protocol (ADR-0007).
 * Keyed on `OMNI_G6_POSTGRES_URL`.
 *
 * Proves: writer-epoch rejection and HWM capture; the post-snapshot replay driver
 * selects EXACTLY the ledger delta beyond a snapshot LSN; the final atomic
 * reconciliation reports no-gap when clean and a gap when a stale-epoch write or a
 * stuck decision exists.
 */

import { describe, expect, test } from 'bun:test';
import { EngineCrash, runBackfill } from './engine';
import {
  WriterEpochError,
  activateFence,
  assertWriterAllowed,
  captureHighWaterMark,
  checkWriterEpoch,
  finalReconciliationUnderFence,
  postSnapshotDelta,
} from './fence';
import type { InstanceTenantMap } from './mapping-engine';
import { connect, dropDatabase, provisionDatabase, superUrl } from './pg-testing';

const base = superUrl();
const maybe = base.length > 0 ? describe : describe.skip;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INST_A = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const INST_B = 'aaaaaaaa-0000-4000-8000-0000000000b1';
const CHAT_A = 'cccccccc-0000-4000-8000-0000000000a1';
const CHAT_B = 'cccccccc-0000-4000-8000-0000000000b1';

const FIXTURE = `
INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
  ('${TENANT_A}', 'tenant-a', 'Tenant A', 86400, 100, 100),
  ('${TENANT_B}', 'tenant-b', 'Tenant B', 86400, 100, 100);
INSERT INTO instances (id, name, channel) VALUES
  ('${INST_A}', 'inst-a', 'whatsapp'), ('${INST_B}', 'inst-b', 'whatsapp');
INSERT INTO chats (id, instance_id, external_id, chat_type, channel) VALUES
  ('${CHAT_A}', '${INST_A}', 'ext-a', 'dm', 'whatsapp'),
  ('${CHAT_B}', '${INST_B}', 'ext-b', 'dm', 'whatsapp');
`;

const instanceMap: InstanceTenantMap = new Map([
  [INST_A, TENANT_A],
  [INST_B, TENANT_B],
]);

maybe('G6 fence protocol — real PostgreSQL', () => {
  test('writer-epoch rejection and high-water-mark capture', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      expect(checkWriterEpoch(3, 3).allowed).toBe(true);
      expect(checkWriterEpoch(2, 3).allowed).toBe(false);
      expect(() => assertWriterAllowed(2, 3)).toThrow(WriterEpochError);

      const activation = await activateFence(sql, 5);
      expect(activation.epoch).toBe(5);
      expect(activation.highWaterLsn).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/);
      expect(activation.activationId).toMatch(/^[0-9a-f]{64}$/);

      const later = await captureHighWaterMark(sql);
      expect(later).toMatch(/^[0-9A-F]+\/[0-9A-F]+$/);
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });

  test('post-snapshot replay driver selects EXACTLY the delta beyond the snapshot', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      // Batch 1: instances. Then take the snapshot high-water mark.
      await runBackfill(sql, { mode: 'apply', instanceTenantMap: instanceMap, tables: ['instances'], writerEpoch: 5 });
      const snapshot = await captureHighWaterMark(sql);

      // Batch 2 (post-snapshot): chats.
      await runBackfill(sql, { mode: 'apply', instanceTenantMap: instanceMap, tables: ['chats'], writerEpoch: 5 });

      const delta = await postSnapshotDelta(sql, snapshot);
      // The delta is exactly the post-snapshot writes — the two chats, and no instance.
      expect(delta.every((d) => d.sourceTable === 'chats')).toBe(true);
      expect(delta.length).toBe(2);
      const total = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM tenant_migration_ledger`;
      expect(Number(total[0]!.n)).toBe(4); // 2 instances + 2 chats, but delta is only the 2 chats
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });

  test('final reconciliation reports no-gap when clean, gap when a decision is stuck', async () => {
    const clean = provisionDatabase(base, FIXTURE);
    const sqlClean = connect(clean.url);
    try {
      await runBackfill(sqlClean, {
        mode: 'apply',
        instanceTenantMap: instanceMap,
        tables: ['instances', 'chats'],
        writerEpoch: 5,
      });
      const activation = await activateFence(sqlClean, 5);
      const result = await finalReconciliationUnderFence(sqlClean, activation);
      expect(result.noGap).toBe(true);
      expect(result.staleEpochWrites).toBe(0);
      expect(result.plannedNotApplied).toBe(0);
    } finally {
      await sqlClean.end();
      dropDatabase(base, clean.database);
    }

    const gapped = provisionDatabase(base, FIXTURE);
    const sqlGap = connect(gapped.url);
    try {
      // A crash leaves a `planned` decision that never applied — a gap.
      try {
        await runBackfill(sqlGap, {
          mode: 'apply',
          instanceTenantMap: instanceMap,
          tables: ['instances'],
          writerEpoch: 5,
          faultAfterPlanned: 1,
        });
      } catch (error) {
        expect(error instanceof EngineCrash).toBe(true);
      }
      const activation = await activateFence(sqlGap, 5);
      const result = await finalReconciliationUnderFence(sqlGap, activation);
      expect(result.noGap).toBe(false);
      expect(result.plannedNotApplied).toBeGreaterThan(0);
    } finally {
      await sqlGap.end();
      dropDatabase(base, gapped.database);
    }
  });

  test('a stale-epoch write is detected as a gap under a higher fence', async () => {
    const { database, url } = provisionDatabase(base, FIXTURE);
    const sql = connect(url);
    try {
      // Writes at epoch 0, then a fence activated at epoch 5: the earlier writes
      // are stale-epoch and must show up as a gap.
      await runBackfill(sql, { mode: 'apply', instanceTenantMap: instanceMap, tables: ['instances'], writerEpoch: 0 });
      const activation = await activateFence(sql, 5);
      const result = await finalReconciliationUnderFence(sql, activation);
      expect(result.noGap).toBe(false);
      expect(result.staleEpochWrites).toBeGreaterThan(0);
    } finally {
      await sql.end();
      dropDatabase(base, database);
    }
  });
});
