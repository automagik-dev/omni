/**
 * Message-persistence worker-tenant boundary (wish: omni-full-multitenancy,
 * Group G5; ADR-0008).
 *
 * `message-persistence` is the dominant inbound consumer: every `message.received`
 * / `message.sent` event on every channel lands here and writes `chats`,
 * `messages`, `chat_participants`, `chat_id_mappings`, `platform_identities` and
 * `instances`. Until this leg it was the last big unconverted consumer, which is
 * why nine db-access-guard sites across `services/chats.ts`, `services/messages.ts`,
 * `services/persons.ts` and `services/instances.ts` stayed `pending-G5-conversion`
 * even though their route callers had been scoped since G4: a site is only as
 * scoped as its least-scoped caller.
 *
 * These probes assert the conversion contract with fakes (no DB, no NATS):
 *
 *   1. a tenant-world envelope runs every awaited service call inside ONE worker
 *      tenant transaction stamped with the envelope's trusted tenant;
 *   2. a legacy envelope (no version, no tenant) runs the same body with NO scope
 *      — byte-identical to pre-G5, the dual-world contract;
 *   3. a malformed envelope (tenant claim, no version) is refused before any
 *      service call — quarantine, never a global-processing fallback;
 *   4. the tenant comes from producer-stamped envelope metadata, NEVER from a
 *      payload field named `tenantId`;
 *   5. THE TRAP (G4 leg-2): the fire-and-forget writes this handler spawns
 *      (`chats.updateLastMessage`, `instances.updateLastMessageAt`,
 *      `chats.upsertLidMapping`, the profile fetch) must run in their OWN worker
 *      transaction, not the handler's. Inheriting it would be a use-after-commit
 *      on a released connection the moment the handler returns.
 */

import { describe, expect, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import { CURRENT_ENVELOPE_VERSION } from '@omni/core';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { setupMessagePersistence } from '../message-persistence';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';
const TENANT_B = '22222222-2222-4222-8222-2222222222bb';
const INSTANCE = 'instance-1';

/** Capture the handlers `setupMessagePersistence` registers. */
function captureBus() {
  const handlers = new Map<string, (event: unknown) => Promise<void>>();
  const bus = {
    subscribe: async (type: string, handler: (event: never) => Promise<void>) => {
      handlers.set(type, handler as unknown as (event: unknown) => Promise<void>);
    },
    publish: async () => undefined,
  } as unknown as EventBus;
  const fire = (type: string, event: unknown): Promise<void> => {
    const handler = handlers.get(type);
    if (!handler) throw new Error(`no handler for ${type}`);
    return handler(event);
  };
  return { bus, fire };
}

/**
 * A db fake whose `transaction` hands back a FRESH tx object per call, so a test
 * can tell one worker transaction from another by identity, and which records the
 * tenant each scope stamps (`set_config('app.tenant_id', …)`).
 */
function fakeDb(stamped: string[]) {
  return {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
      cb({
        execute: async (q: unknown) => {
          const text = JSON.stringify(q);
          const match = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.exec(text);
          if (match) stamped.push(match[0]);
          return [] as unknown;
        },
      }),
  } as never;
}

interface Observation {
  readonly call: string;
  readonly tenantId: string | null;
  readonly tx: unknown;
}

/**
 * A services fake that records, for every call message-persistence makes, which
 * tenant scope (if any) was active and WHICH transaction object it was.
 */
function servicesWith(db: unknown, seen: Observation[]) {
  const observe = (call: string) => {
    const scope = currentTenantScope();
    seen.push({ call, tenantId: scope?.tenantId ?? null, tx: scope?.tx ?? null });
  };
  const chat = { id: 'chat-uuid', canonicalId: null as string | null, name: null as string | null };
  return {
    db,
    chats: {
      findByExternalIdSmart: async () => {
        observe('chats.findByExternalIdSmart');
        return null;
      },
      findOrCreate: async () => {
        observe('chats.findOrCreate');
        return { chat, created: true };
      },
      update: async () => {
        observe('chats.update');
        return chat;
      },
      upsertLidMapping: async () => {
        observe('chats.upsertLidMapping');
        return undefined;
      },
      findOrCreateParticipant: async () => {
        observe('chats.findOrCreateParticipant');
        return { participant: { displayName: null } };
      },
      recordParticipantActivity: async () => {
        observe('chats.recordParticipantActivity');
        return undefined;
      },
      updateLastMessage: async () => {
        observe('chats.updateLastMessage');
        return undefined;
      },
    },
    messages: {
      findOrCreate: async () => {
        observe('messages.findOrCreate');
        return { message: { id: 'message-uuid' }, created: true };
      },
      getByExternalId: async () => {
        observe('messages.getByExternalId');
        return null;
      },
      recordEdit: async () => {
        observe('messages.recordEdit');
        return undefined;
      },
      updateDeliveryStatus: async () => {
        observe('messages.updateDeliveryStatus');
        return undefined;
      },
    },
    persons: {
      findOrCreateIdentity: async () => {
        observe('persons.findOrCreateIdentity');
        return { identity: { id: 'identity-uuid' }, person: { id: 'person-uuid' }, isNew: false };
      },
      updateIdentityProfile: async () => {
        observe('persons.updateIdentityProfile');
        return undefined;
      },
    },
    instances: {
      updateLastMessageAt: async () => {
        observe('instances.updateLastMessageAt');
        return undefined;
      },
      getLastMessageAt: async () => {
        observe('instances.getLastMessageAt');
        return null;
      },
    },
    consumerOffsets: {
      updateOffset: async () => undefined,
    },
  } as never;
}

/** A `message.received` event whose rawPayload triggers the LID fire-and-forget path. */
function receivedEvent(metadata: Record<string, unknown>, payloadExtras: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    timestamp: 1_700_000_000_000,
    payload: {
      externalId: 'ext-1',
      chatId: '5511999999999@lid',
      from: '5511999999999@lid',
      senderName: 'Sender',
      content: { type: 'text', text: 'hello' },
      rawPayload: { resolvedPhoneJid: '5511999999999@s.whatsapp.net' },
      ...payloadExtras,
    },
    metadata: { instanceId: INSTANCE, channelType: 'whatsapp', ...metadata },
  };
}

/** Let the handler's fire-and-forget continuations settle. */
async function drain(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('message-persistence worker-tenant boundary (G5, ADR-0008)', () => {
  test('a tenant envelope runs the awaited path in ONE worker transaction stamped with the envelope tenant', async () => {
    const stamped: string[] = [];
    const db = fakeDb(stamped);
    const seen: Observation[] = [];
    const { bus, fire } = captureBus();
    await setupMessagePersistence(bus, servicesWith(db, seen));

    await fire('message.received', receivedEvent({ envelopeVersion: CURRENT_ENVELOPE_VERSION, tenantId: TENANT_A }));
    await drain();

    // Every service call the handler AWAITS is inside the tenant scope.
    const awaited = seen.filter(
      (o) => o.call !== 'chats.updateLastMessage' && o.call !== 'instances.updateLastMessageAt',
    );
    expect(awaited.length).toBeGreaterThan(3);
    for (const o of awaited) expect(o.tenantId).toBe(TENANT_A);
    expect(stamped.every((t) => t === TENANT_A)).toBe(true);

    // ...and it is ONE transaction for the whole awaited work item, not one per call.
    const awaitedTxs = new Set(
      seen.filter((o) => o.call === 'chats.findOrCreate' || o.call === 'messages.findOrCreate').map((o) => o.tx),
    );
    expect(awaitedTxs.size).toBe(1);
  });

  test('THE TRAP: fire-and-forget writes run in their OWN worker transaction, never the handler transaction', async () => {
    const stamped: string[] = [];
    const db = fakeDb(stamped);
    const seen: Observation[] = [];
    const { bus, fire } = captureBus();
    await setupMessagePersistence(bus, servicesWith(db, seen));

    await fire('message.received', receivedEvent({ envelopeVersion: CURRENT_ENVELOPE_VERSION, tenantId: TENANT_A }));
    await drain();

    const handlerTx = seen.find((o) => o.call === 'messages.findOrCreate')?.tx;
    expect(handlerTx).toBeTruthy();

    const detached = seen.filter(
      (o) =>
        o.call === 'chats.updateLastMessage' ||
        o.call === 'instances.updateLastMessageAt' ||
        o.call === 'chats.upsertLidMapping',
    );
    expect(detached.length).toBeGreaterThan(0);
    for (const o of detached) {
      // Still tenant-scoped (the write is RLS-policed)...
      expect(o.tenantId).toBe(TENANT_A);
      // ...but NOT on the handler's transaction, which is committed and released
      // by the time these continuations run.
      expect(o.tx).not.toBe(handlerTx);
    }
  });

  test('a legacy envelope runs the same body with no scope at all (dual world)', async () => {
    const stamped: string[] = [];
    const db = fakeDb(stamped);
    const seen: Observation[] = [];
    const { bus, fire } = captureBus();
    await setupMessagePersistence(bus, servicesWith(db, seen));

    await fire('message.received', receivedEvent({}));
    await drain();

    expect(seen.length).toBeGreaterThan(3);
    for (const o of seen) expect(o.tenantId).toBeNull();
    expect(stamped).toEqual([]);
  });

  test('a malformed envelope (tenant claim, no version) is refused before any service call', async () => {
    const stamped: string[] = [];
    const db = fakeDb(stamped);
    const seen: Observation[] = [];
    const { bus, fire } = captureBus();
    await setupMessagePersistence(bus, servicesWith(db, seen));

    await expect(fire('message.received', receivedEvent({ tenantId: TENANT_A }))).rejects.toThrow(
      /quarantin|worker-tenant-context/i,
    );
    await drain();

    expect(seen).toEqual([]);
    expect(stamped).toEqual([]);
  });

  test('an unknown envelope version is refused, never processed', async () => {
    const stamped: string[] = [];
    const db = fakeDb(stamped);
    const seen: Observation[] = [];
    const { bus, fire } = captureBus();
    await setupMessagePersistence(bus, servicesWith(db, seen));

    await expect(
      fire('message.received', receivedEvent({ envelopeVersion: 9999, tenantId: TENANT_A })),
    ).rejects.toThrow(/quarantin|worker-tenant-context/i);
    await drain();

    expect(seen).toEqual([]);
  });

  test('the tenant comes from envelope metadata, never from a caller-claimed payload field', async () => {
    const stamped: string[] = [];
    const db = fakeDb(stamped);
    const seen: Observation[] = [];
    const { bus, fire } = captureBus();
    await setupMessagePersistence(bus, servicesWith(db, seen));

    // Payload claims tenant B; the producer-stamped envelope says tenant A.
    await fire(
      'message.received',
      receivedEvent({ envelopeVersion: CURRENT_ENVELOPE_VERSION, tenantId: TENANT_A }, { tenantId: TENANT_B }),
    );
    await drain();

    for (const o of seen) expect(o.tenantId).toBe(TENANT_A);
    expect(stamped.includes(TENANT_B)).toBe(false);
  });
});
