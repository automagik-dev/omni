/**
 * `services/agent-replay.ts::{instances,messages}` worker-context boundary
 * (G5; ADR-0008).
 *
 * Two callers reach this service, and only one of them had a tenant:
 *
 *   * `routes/v2/instances.ts` — the manual replay endpoint, inside the edge
 *     tenant transaction (G4). It threads NOTHING and must keep observing the
 *     REQUEST's scope: that is the shape the real route produces.
 *   * `plugins/event-listeners.ts` — the `instance.connected` /
 *     `instance.disconnected` consumers, which call `onInstanceConnect` and
 *     `updateLastSeenAt` FIRE-AND-FORGET. Those had no scope at all: the
 *     instance read, the message pages and the `lastSeenAt` write ran on the
 *     ambient pool while the rest of the consumer ran tenant-scoped.
 *
 * The conversion cannot wrap the whole call: `replayMissedMessages` PUBLISHES a
 * `message.received` per replayed row, and a worker transaction held across a
 * publish makes the event a pre-commit side effect (a phantom on rollback).
 * So the tenant is THREADED and each discrete DB block opens its own short
 * scope — the `runTenantWorkDb` shape turn-monitor uses.
 *
 * This file is the enforcement the static guard cannot provide (run12's
 * FIX-FIRST lesson: the guard sees the SERVICE, never the CALL SITE), probing
 * every helper that reads/writes under a live tenant.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { currentTenantScope, runInTenantScope } from '../../tenancy/tenant-scope';
import { AgentReplayService } from '../agent-replay';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const REQUEST_TENANT = '33333333-3333-4333-8333-33333333333c';

function scope(): string | null {
  return currentTenantScope()?.tenantId ?? null;
}

/** Drizzle-shaped chain stub: every builder method returns itself; awaiting yields `result`. */
function chain<T>(result: T): T {
  const self: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (onOk: (v: T) => unknown, onErr?: (e: unknown) => unknown) =>
            Promise.resolve(result).then(onOk, onErr);
        }
        return () => self;
      },
    },
  );
  return self as T;
}

interface Observed {
  op: string;
  scope: string | null;
}

function makeDb(observed: Observed[], selects: unknown[], counters: { transactions: number }): Database {
  const db = {
    select: () => {
      observed.push({ op: 'select', scope: scope() });
      return chain(selects.shift() ?? []);
    },
    update: () => {
      observed.push({ op: 'update', scope: scope() });
      return chain([]);
    },
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      counters.transactions += 1;
      return cb(db);
    },
    execute: async () => [],
  };
  return db as unknown as Database;
}

const INSTANCE_ROW = {
  id: 'instance-1',
  channel: 'whatsapp-baileys',
  replayEnabled: true,
  lastSeenAt: new Date(Date.now() - 60_000),
  agentId: 'agent-1',
};

const MESSAGE_ROW = {
  id: 'msg-1',
  chatId: 'chat-1',
  externalId: 'ext-1',
  messageType: 'text',
  textContent: 'oi',
  mediaUrl: null,
  mediaLocalPath: null,
  mediaMimeType: null,
  senderPlatformUserId: '5511999999999',
  replyToExternalId: null,
  rawPayload: null,
  platformTimestamp: new Date(Date.now() - 30_000),
  isFromMe: false,
  senderAgentId: null,
  chatExternalId: '5511999999999@s.whatsapp.net',
  chatInstanceId: 'instance-1',
};

function makeService(observed: Observed[], selects: unknown[], counters: { transactions: number }) {
  const publishScopes: Array<string | null> = [];
  const eventBus = {
    publish: async () => {
      publishScopes.push(scope());
    },
  } as unknown as ConstructorParameters<typeof AgentReplayService>[1];
  const db = makeDb(observed, selects, counters);
  return { service: new AgentReplayService(db, eventBus), publishScopes, db };
}

describe('agent-replay — consumer caller threads the envelope tenant', () => {
  test('onInstanceConnect: instance read, message page and lastSeenAt write all observe the tenant scope', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const { service } = makeService(observed, [[INSTANCE_ROW], [MESSAGE_ROW], []], counters);

    await service.onInstanceConnect('instance-1', TENANT_A);

    expect(observed.length).toBeGreaterThanOrEqual(3);
    for (const entry of observed) {
      expect(entry.scope).toBe(TENANT_A);
    }
    // The lastSeenAt write is the `instances` half of the site.
    expect(observed.some((o) => o.op === 'update')).toBe(true);
  });

  test('the worker scope does NOT span the redispatch publish', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const { service, publishScopes } = makeService(observed, [[INSTANCE_ROW], [MESSAGE_ROW], []], counters);

    await service.onInstanceConnect('instance-1', TENANT_A);

    expect(publishScopes.length).toBe(1);
    expect(publishScopes).toEqual([null]);
  });

  test('updateLastSeenAt threads its own tenant when called from the disconnect consumer', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const { service } = makeService(observed, [], counters);

    await service.updateLastSeenAt('instance-1', undefined, TENANT_A);

    expect(observed).toEqual([{ op: 'update', scope: TENANT_A }]);
    expect(counters.transactions).toBe(1);
  });
});

describe('agent-replay — the request caller keeps the REQUEST scope', () => {
  test('replayMissedMessages threading nothing stays on the edge transaction', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const { service, db } = makeService(observed, [[MESSAGE_ROW], []], counters);

    // The real route shape: inside the edge tenant scope, no threaded tenant.
    await runInTenantScope(
      db,
      {
        credentialClass: 'tenant',
        requestId: 'req-1',
        principalId: 'p',
        credentialId: 'c',
        tenantId: REQUEST_TENANT,
        tenantSlug: null,
        actorRole: 'tenant-admin',
        scopes: [],
        membershipId: 'm',
        resourceConstraints: {},
        expiresAt: null,
        rateLimit: null,
        budget: null,
        delegationDepth: 0,
        rootKeyId: 'r',
        policyVersion: 0,
        revocationEpoch: 0,
        tenantKeyLineageId: 'l',
      } as never,
      () => service.replayMissedMessages({ instanceId: 'instance-1', since: new Date(Date.now() - 60_000) }),
    );

    expect(observed.length).toBeGreaterThan(0);
    for (const entry of observed) {
      expect(entry.scope).toBe(REQUEST_TENANT);
    }
  });
});

describe('agent-replay — legacy world is byte-identical', () => {
  test('no threaded tenant and no active scope: no transaction, no scope', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const { service } = makeService(observed, [[INSTANCE_ROW], [MESSAGE_ROW], []], counters);

    await service.onInstanceConnect('instance-1');

    expect(counters.transactions).toBe(0);
    expect(observed.every((o) => o.scope === null)).toBe(true);
  });
});
