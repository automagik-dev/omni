/**
 * The REPLAY call sites thread the envelope tenant (G5; ADR-0008).
 *
 * `services/__tests__/agent-replay-worker-scope.test.ts` proves
 * `AgentReplayService` honours a threaded tenant. It cannot prove that
 * `plugins/event-listeners.ts` threads one — and the guard justification for
 * `agent-replay.ts::{instances,messages}` rests on exactly that: "the two
 * fire-and-forget event-listener callers detached and threaded".
 *
 * Dropping `trustedEnvelopeTenant(event)` at either call site left the whole
 * suite green: the replay is fire-and-forget behind `.catch(log)`, and the only
 * test that fires an envelope through this handler asserts on the SEPARATE
 * `runConsumerInTenantContext` write. So this probe drives the real handler and
 * asserts the tenant scope the replay's own read observed — including which
 * HANDLE issued it, since a scope that is opened but not used is the same defect
 * one class over.
 */

import { describe, expect, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { setupConnectionListener } from '../event-listeners';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';

interface Observed {
  op: string;
  scope: string | null;
  handle: 'POOL' | 'TX';
}

function chain<T>(rows: T): T {
  const self: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (onOk: (v: T) => unknown, onErr?: (e: unknown) => unknown) => Promise.resolve(rows).then(onOk, onErr);
        }
        return () => self;
      },
    },
  );
  return self as T;
}

/**
 * The replay's instance read is the observation point. The row has no `agentId`,
 * so the handler stops right after it — one read, deterministic.
 */
function makeDb(observed: Observed[]): Database {
  const row = { id: 'inst-1', channel: 'telegram', replayEnabled: false, lastSeenAt: null, agentId: null };
  const record = (op: string, handle: 'POOL' | 'TX') =>
    observed.push({ op, scope: currentTenantScope()?.tenantId ?? null, handle });
  const tx = {
    select: () => {
      record('select', 'TX');
      return chain([row]);
    },
    update: () => {
      record('update', 'TX');
      return chain([]);
    },
    execute: async () => [],
  };
  const db = {
    select: () => {
      record('select', 'POOL');
      return chain([row]);
    },
    update: () => {
      record('update', 'POOL');
      return chain([]);
    },
    transaction: async <T>(cb: (handle: unknown) => Promise<T>): Promise<T> => cb(tx),
    execute: async () => [],
  };
  return db as unknown as Database;
}

function harness(observed: Observed[]) {
  const handlers = new Map<string, (event: unknown) => Promise<void>>();
  const bus = {
    subscribe: async (eventType: string, cb: (event: unknown) => Promise<void>) => {
      handlers.set(eventType, cb);
      return { unsubscribe: async () => {} };
    },
    subscribePattern: async () => ({ unsubscribe: async () => {} }),
    publish: async () => ({ id: 'evt-1' }),
  } as unknown as EventBus;

  const fire = async (eventType: string, metadata: Record<string, unknown>) => {
    const handler = handlers.get(eventType);
    if (!handler) throw new Error(`no handler for ${eventType}`);
    await handler({
      payload: { instanceId: 'inst-1', channelType: 'telegram', reason: 'network' },
      metadata: { correlationId: 'corr-1', instanceId: 'inst-1', ...metadata },
    });
    // The replay is fire-and-forget; wait for its detached chain to reach the
    // db rather than sleeping a fixed slice — a loaded CI runner can stall the
    // detached continuation past any fixed number of milliseconds.
    const deadline = Date.now() + 2000;
    while (observed.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5));
    }
    // One more macrotask so everything downstream of the first db call lands.
    await new Promise((r) => setTimeout(r, 10));
  };

  return { bus, fire, db: makeDb(observed) };
}

describe('event-listeners threads the envelope tenant into the replay', () => {
  test('instance.connected, tenant envelope: the replay read runs in that tenant’s scope', async () => {
    const observed: Observed[] = [];
    const h = harness(observed);
    await setupConnectionListener(h.bus, h.db);

    await h.fire('instance.connected', { envelopeVersion: 1, tenantId: TENANT_A });

    // The connect handler's own `instances` update, then the replay's read.
    const reads = observed.filter((o) => o.op === 'select');
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.scope).toBe(TENANT_A);
      expect(read.handle).toBe('TX');
    }
  });

  test('instance.connected, legacy envelope: the replay read stays ambient', async () => {
    const observed: Observed[] = [];
    const h = harness(observed);
    await setupConnectionListener(h.bus, h.db);

    await h.fire('instance.connected', {});

    const reads = observed.filter((o) => o.op === 'select');
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.scope).toBeNull();
      expect(read.handle).toBe('POOL');
    }
  });

  test('instance.disconnected, tenant envelope: the lastSeenAt write is scoped too', async () => {
    const observed: Observed[] = [];
    const h = harness(observed);
    await setupConnectionListener(h.bus, h.db);

    await h.fire('instance.disconnected', { envelopeVersion: 1, tenantId: TENANT_A });

    const writes = observed.filter((o) => o.op === 'update');
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write.scope).toBe(TENANT_A);
      expect(write.handle).toBe('TX');
    }
  });
});
