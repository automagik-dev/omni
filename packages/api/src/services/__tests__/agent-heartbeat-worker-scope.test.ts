/**
 * `services/agent-heartbeat.ts` worker-context boundary (G5; ADR-0008).
 *
 * THE DEFECT. This is a NATS consumer — a raw `omni.agent.heartbeat.>`
 * subscription, not an eventBus one — and it called
 * `turnService.recordActivity(turnId)` directly on the ambient pool. It never
 * went through `classifyEnvelope`, so it had no world at all: no tenant, no
 * legacy/quarantine distinction, and a write on whatever handle happened to be
 * ambient. It is one of the two unscoped worker callers named in the
 * `turns.ts::turns` registry justification.
 *
 * THE TRUSTED DERIVATION. A heartbeat is published by an EXTERNAL client (the
 * genie publisher) as raw JSON, so nothing in its body may be believed: ADR-0008
 * requires the tenant to come from an authenticated context or a LOADED
 * resource's persisted ownership. The message names an `instanceId`, and
 * `instances` is the ownership ROOT, so the instance-owner registry — populated
 * only from `instances` rows this process already read — is the answer. Any
 * `tenantId` a publisher tries to put in the payload is dropped by
 * `parseHeartbeat`, which returns only its four validated fields.
 *
 * The derived tenant is then STAMPED onto an envelope and classified, so the
 * consumer inherits `runConsumerInTenantContext`'s three worlds unchanged.
 *
 * NOTE ON THE REGISTRY: `turns.ts::turns` stays `pending-G5-conversion` after
 * this. It is G6-GATED — `turns.agent_id` is NOT NULL and `agents` derives via
 * `owner_id -> persons` (G2-`unowned`), so `turns.tenant_id` is stamped NULL for
 * every row until the G6 backfill. Converting its callers is real work; it does
 * not license lowering that ceiling.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { __resetInstanceOwnerRegistry, rememberInstanceOwners } from '../../tenancy/instance-owner-registry';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { AgentHeartbeatConsumer } from '../agent-heartbeat';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';

function scope(): string | null {
  return currentTenantScope()?.tenantId ?? null;
}

type Msg = { subject: string; data: Uint8Array };

function createFakeNats() {
  const queue: Msg[] = [];
  const waiters: Array<(value: IteratorResult<Msg>) => void> = [];
  let ended = false;

  const drain = () => {
    while (waiters.length > 0 && queue.length > 0) {
      const w = waiters.shift();
      const m = queue.shift();
      if (w && m) w({ value: m, done: false });
    }
    if (ended) {
      while (waiters.length > 0) {
        const w = waiters.shift();
        if (w) w({ value: undefined as never, done: true });
      }
    }
  };

  const subscription = {
    unsubscribe() {
      ended = true;
      drain();
    },
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<Msg>> {
          const m = queue.shift();
          if (m) return Promise.resolve({ value: m, done: false });
          if (ended) return Promise.resolve({ value: undefined as never, done: true });
          return new Promise<IteratorResult<Msg>>((resolve) => waiters.push(resolve));
        },
        return(): Promise<IteratorResult<Msg>> {
          ended = true;
          drain();
          return Promise.resolve({ value: undefined as never, done: true });
        },
      };
    },
  };

  return {
    isClosed: () => false,
    subscribe: () => subscription,
    __push(payload: unknown) {
      queue.push({
        subject: 'omni.agent.heartbeat.inst-1.chat-1',
        data: new TextEncoder().encode(JSON.stringify(payload)),
      });
      drain();
    },
    __end() {
      ended = true;
      drain();
    },
  };
}

function fakePool(counters: { transactions: number }): Database {
  return {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      counters.transactions += 1;
      return cb({ execute: async () => [] });
    },
    execute: async () => [],
  } as unknown as Database;
}

function heartbeat(overrides: Record<string, unknown> = {}) {
  return {
    turnId: 'turn-abc',
    instanceId: 'inst-1',
    chatId: 'chat-1',
    timestamp: '2026-07-25T12:00:00.000Z',
    ...overrides,
  };
}

async function flush() {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
}

describe('agent-heartbeat — worker tenant context', () => {
  let consumer: AgentHeartbeatConsumer;
  let nats: ReturnType<typeof createFakeNats>;

  beforeEach(() => {
    consumer = new AgentHeartbeatConsumer();
    nats = createFakeNats();
    __resetInstanceOwnerRegistry();
  });

  afterEach(async () => {
    nats.__end();
    await consumer.stop();
    __resetInstanceOwnerRegistry();
  });

  test('the activity write runs inside the INSTANCE-derived tenant scope', async () => {
    const observed: Array<string | null> = [];
    const counters = { transactions: 0 };
    rememberInstanceOwners([{ id: 'inst-1', tenantId: TENANT_A }]);

    consumer.start({
      natsConnection: nats as never,
      turnService: {
        recordActivity: async () => {
          observed.push(scope());
        },
      } as never,
      db: fakePool(counters),
    });

    nats.__push(heartbeat());
    await flush();

    expect(observed).toEqual([TENANT_A]);
    expect(counters.transactions).toBe(1);
  });

  test('a payload tenant claim is IGNORED — the registry is the only source', async () => {
    const observed: Array<string | null> = [];
    const counters = { transactions: 0 };
    // The instance is owned by A; the publisher claims a different tenant and a
    // forged envelope version in the body.
    rememberInstanceOwners([{ id: 'inst-1', tenantId: TENANT_A }]);

    consumer.start({
      natsConnection: nats as never,
      turnService: {
        recordActivity: async () => {
          observed.push(scope());
        },
      } as never,
      db: fakePool(counters),
    });

    nats.__push(heartbeat({ tenantId: '22222222-2222-4222-8222-22222222222b', envelopeVersion: 99 }));
    await flush();

    expect(observed).toEqual([TENANT_A]);
  });

  test('legacy world: no db wired — the pre-G5 ambient call, byte-identical', async () => {
    const observed: Array<string | null> = [];
    rememberInstanceOwners([{ id: 'inst-1', tenantId: TENANT_A }]);

    consumer.start({
      natsConnection: nats as never,
      turnService: {
        recordActivity: async () => {
          observed.push(scope());
        },
      } as never,
    });

    nats.__push(heartbeat());
    await flush();

    expect(observed).toEqual([null]);
  });

  test('an instance with no observed ownership stays legacy (never another tenant)', async () => {
    const observed: Array<string | null> = [];
    const counters = { transactions: 0 };

    consumer.start({
      natsConnection: nats as never,
      turnService: {
        recordActivity: async () => {
          observed.push(scope());
        },
      } as never,
      db: fakePool(counters),
    });

    nats.__push(heartbeat());
    await flush();

    expect(observed).toEqual([null]);
    expect(counters.transactions).toBe(0);
  });
});
