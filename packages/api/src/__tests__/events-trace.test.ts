/**
 * EventService.trace + causation persistence (#957).
 *
 * Inserts a persisted chain (root → hop → two leaves) and asserts the trace
 * walk answers "why did this happen / what did it cause" — root→leaf via
 * causation_id, one correlation across the flow — plus the additive-migration
 * guarantee that pre-#957 rows read back causationId: null.
 */

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { EventBus } from '@omni/core';
import type { Database, NewOmniEvent } from '@omni/db';
import { omniEvents } from '@omni/db';
import { inArray } from 'drizzle-orm';
import { setupEventPersistence } from '../plugins/event-persistence';
import { EventService } from '../services/events';
import { describeWithDb, getTestDb } from './db-helper';

const CORRELATION = randomUUID();

function journalRow(overrides: Partial<NewOmniEvent> & Pick<NewOmniEvent, 'id' | 'eventType'>): NewOmniEvent {
  return {
    channel: 'internal',
    instanceId: null,
    direction: 'internal',
    status: 'completed',
    receivedAt: new Date(),
    metadata: { correlationId: CORRELATION },
    ...overrides,
  };
}

describeWithDb('EventService.trace (#957)', () => {
  let db: Database;
  let service: EventService;

  const rootId = randomUUID();
  const hopId = randomUUID();
  const leafAId = randomUUID();
  const leafBId = randomUUID();
  const grandchildId = randomUUID();
  const legacyId = randomUUID();
  const allIds = [rootId, hopId, leafAId, leafBId, grandchildId, legacyId];

  beforeAll(async () => {
    db = getTestDb();
    service = new EventService(db);

    // webhook root → automation hop → {call_agent leaf, second leaf} → grandchild
    await db.insert(omniEvents).values([
      journalRow({ id: rootId, eventType: 'custom.webhook.trace-e2e', causationId: null }),
      journalRow({ id: hopId, eventType: 'custom.trace-e2e.hop', causationId: rootId }),
      journalRow({
        id: leafAId,
        eventType: 'message.sent',
        direction: 'outbound',
        channel: 'discord',
        causationId: hopId,
      }),
      journalRow({ id: leafBId, eventType: 'custom.trace-e2e.leaf_b', causationId: hopId }),
      journalRow({ id: grandchildId, eventType: 'custom.trace-e2e.grandchild', causationId: leafAId }),
      // A row persisted before the migration existed: no stamp at all.
      journalRow({ id: legacyId, eventType: 'message.received', direction: 'inbound', channel: 'discord' }),
    ]);
  });

  afterAll(async () => {
    await db.delete(omniEvents).where(inArray(omniEvents.id, allIds));
  });

  test('trace from a leaf includes the root ingress event (walk UP)', async () => {
    const trace = await service.trace(leafAId);

    expect(trace.event.id).toBe(leafAId);
    expect(trace.ancestors.map((e) => e.id)).toEqual([rootId, hopId]);
    expect(trace.ancestors[0]?.causationId).toBeNull();
    expect(trace.truncated).toBe(false);
  });

  test('trace from the root walks DOWN through fan-out with depths', async () => {
    const trace = await service.trace(rootId);

    expect(trace.ancestors).toEqual([]);
    const byId = new Map(trace.descendants.map((d) => [d.event.id, d.depth]));
    expect(byId.get(hopId)).toBe(1);
    expect(byId.get(leafAId)).toBe(2);
    expect(byId.get(leafBId)).toBe(2);
    expect(byId.get(grandchildId)).toBe(3);
    expect(byId.size).toBe(4);
  });

  test('the whole chain shares ONE correlationId', async () => {
    const trace = await service.trace(leafAId);
    const chain = [...trace.ancestors, trace.event];
    for (const event of chain) {
      expect((event.metadata as { correlationId?: string })?.correlationId).toBe(CORRELATION);
    }
  });

  test('pre-migration rows read back causationId: null and trace as isolated roots', async () => {
    const trace = await service.trace(legacyId);
    expect(trace.event.causationId).toBeNull();
    expect(trace.ancestors).toEqual([]);
    expect(trace.descendants).toEqual([]);
  });

  test('trace of an unknown id throws NotFound', async () => {
    await expect(service.trace(randomUUID())).rejects.toThrow('Event');
  });
});

describeWithDb('custom event journaling (#957)', () => {
  let db: Database;

  beforeAll(() => {
    db = getTestDb();
  });

  test('custom.> subscriber persists a minimal journal row with causation + correlation', async () => {
    const subscriptions = new Map<string, (event: unknown) => Promise<void>>();
    const mockBus = {
      subscribe: async () => {},
      subscribePattern: async (pattern: string, handler: (event: unknown) => Promise<void>) => {
        subscriptions.set(pattern, handler);
      },
    } as unknown as EventBus;

    await setupEventPersistence(mockBus, db);
    const handler = subscriptions.get('custom.>');
    expect(handler).toBeDefined();
    if (!handler) return;

    const eventId = randomUUID();
    const parentId = randomUUID();
    try {
      await handler({
        id: eventId,
        type: 'custom.webhook.persistence-e2e',
        payload: { source: 'persistence-e2e', hello: 'world' },
        timestamp: Date.now(),
        metadata: { correlationId: CORRELATION, causationId: parentId, source: 'webhook' },
      });

      const row = await new EventService(db).getById(eventId);
      expect(row.eventType).toBe('custom.webhook.persistence-e2e');
      expect(row.channel).toBe('internal');
      expect(row.causationId).toBe(parentId);
      expect((row.metadata as { correlationId?: string })?.correlationId).toBe(CORRELATION);
      expect((row.rawPayload as { hello?: string })?.hello).toBe('world');
    } finally {
      await db.delete(omniEvents).where(inArray(omniEvents.id, [eventId]));
    }
  });
});
