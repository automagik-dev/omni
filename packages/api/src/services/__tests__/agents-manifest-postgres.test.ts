/**
 * Agent event manifest persistence over real PostgreSQL (issue #985,
 * RFC #925 G4a).
 *
 * Proves migration 0061 + the jsonb round-trip against a disposable database
 * with every migration applied:
 *
 *   * `agents.event_manifest` exists and defaults to NULL for new rows;
 *   * `AgentService.updateManifest` stores the manifest verbatim, returns it
 *     on the updated row, and publishes `system.agent.manifest.updated`;
 *   * a fresh read (`getById`) round-trips the exact jsonb document;
 *   * updateManifest on a missing agent throws NotFound and publishes nothing.
 *
 * Set `OMNI_G1_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { AgentEventManifest, EventBus } from '@omni/core';
import { type Database, createDbHandle } from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { AgentService } from '../agents';

const superUrl = process.env.OMNI_G1_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G1_PSQL_BIN ?? 'psql';

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

interface PublishedEvent {
  type: string;
  payload: Record<string, unknown>;
}

/** An EventBus fake that records publishes for assertions. */
function recordingBus(events: PublishedEvent[]): EventBus {
  return {
    publishGeneric: async (type: string, payload: Record<string, unknown>) => {
      events.push({ type, payload });
      return { id: crypto.randomUUID(), ok: true };
    },
  } as unknown as EventBus;
}

const manifest: AgentEventManifest = {
  accepts: [{ event: 'custom.clickup.task.status_changed', filter: { list_id: '901300373349' } }],
  publishes: [{ event: 'custom.review.parecer.ready' }],
};

postgresDescribe('agent event manifest persistence (real PostgreSQL)', () => {
  const dbName = `omni_985_manifest_${crypto.randomUUID().replaceAll('-', '')}`;
  const closers: (() => Promise<void>)[] = [];
  let db: Database;
  let journal: PublishedEvent[];
  let service: AgentService;

  beforeAll(() => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const handle = createDbHandle({ url: urlFor(superUrl, dbName), maxConnections: 3 });
    closers.push(() => handle.close().catch(() => undefined));
    db = handle.db;

    journal = [];
    service = new AgentService(db, recordingBus(journal));
  });

  afterAll(async () => {
    for (const close of closers) await close();
  });

  test('new agents start with a NULL manifest', async () => {
    const created = await service.create({ name: 'manifest-suite-agent', provider: 'claude' });
    expect(created.eventManifest).toBeNull();
  });

  test('updateManifest stores, round-trips, and publishes the state change', async () => {
    const created = await service.create({ name: 'manifest-roundtrip-agent', provider: 'claude' });
    journal.length = 0;

    const updated = await service.updateManifest(created.id, manifest);
    expect(updated.eventManifest).toEqual(manifest);

    // Fresh read — the jsonb document must come back byte-equivalent.
    const reread = await service.getById(created.id);
    expect(reread.eventManifest).toEqual(manifest);

    expect(journal).toHaveLength(1);
    expect(journal[0]?.type).toBe('system.agent.manifest.updated');
    expect(journal[0]?.payload.agentId).toBe(created.id);
    expect(journal[0]?.payload.manifest).toEqual(manifest);
  });

  test('replacement is full, not a merge', async () => {
    const created = await service.create({ name: 'manifest-replace-agent', provider: 'claude' });
    await service.updateManifest(created.id, manifest);

    const slimmed: AgentEventManifest = { accepts: [], publishes: [{ event: 'custom.alerts.raised' }] };
    await service.updateManifest(created.id, slimmed);

    const reread = await service.getById(created.id);
    expect(reread.eventManifest).toEqual(slimmed);
  });

  test('updateManifest on a missing agent throws NotFound and publishes nothing', async () => {
    journal.length = 0;
    await expect(service.updateManifest('00000000-0000-4000-8000-000000000000', manifest)).rejects.toThrow('Agent');
    expect(journal).toHaveLength(0);
  });
});
