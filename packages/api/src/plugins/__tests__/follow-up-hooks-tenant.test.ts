/**
 * Follow-up-hooks worker-tenant boundary (wish: omni-full-multitenancy, Group
 * G5; ADR-0008).
 *
 * The five follow-up-hooks consumers classify their envelope ONCE and thread
 * the trusted tenant into every service call. These probes assert the THREADING
 * contract with fakes (no DB, no NATS):
 *
 *   1. a tenant-world envelope threads its trusted tenant to `resolveChatId`'s
 *      DB block AND to the lifecycle service call;
 *   2. a legacy envelope threads `null` — every call runs unscoped;
 *   3. a malformed envelope (tenant claim, no version) is refused — no service
 *      call happens (never processed globally);
 *   4. the tenant is taken from the ENVELOPE metadata, never a payload field
 *      named `tenantId`.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import { currentTenantScope } from '../../tenancy/tenant-scope';
import { setupFollowUpHooks } from '../follow-up-hooks';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';

/** Capture the handlers `setupFollowUpHooks` registers. */
function captureBus() {
  const handlers = new Map<string, (event: unknown) => Promise<void>>();
  const bus = {
    subscribe: async (type: string, handler: (event: never) => Promise<void>) => {
      handlers.set(type, handler as unknown as (event: unknown) => Promise<void>);
    },
  } as unknown as EventBus;
  const fire = (type: string, event: unknown): Promise<void> => {
    const handler = handlers.get(type);
    if (!handler) throw new Error(`no handler for ${type}`);
    return handler(event);
  };
  return { bus, fire };
}

/**
 * A db fake whose `transaction` records the tenant stamped by the worker scope.
 * `runInWorkerTenantScope` → `withTenantTransaction` runs
 * `set_config('app.tenant_id', <tenant>, true)`; we capture that argument.
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

function servicesWith(calls: { chatTenantScope: (string | null)[]; disarm: unknown[] }) {
  return {
    chats: {
      findByExternalIdSmart: mock(async () => {
        // Record whether a worker scope is active when the chat read runs.
        calls.chatTenantScope.push(currentTenantScope()?.tenantId ?? null);
        return { id: 'chat-uuid', settings: {} };
      }),
    },
    followUpLifecycle: {
      armForOutbound: mock(async (input: unknown) => {
        calls.disarm.push(input);
      }),
      disarm: mock(async (input: unknown) => {
        calls.disarm.push(input);
      }),
      touchInboundTimestamp: mock(async () => undefined),
    },
  } as never;
}

function messageSent(tenant: 'tenant' | 'legacy' | 'malformed') {
  const metadata: Record<string, unknown> = { instanceId: 'inst-1' };
  if (tenant === 'tenant') {
    metadata.envelopeVersion = 1;
    metadata.tenantId = TENANT_A;
  } else if (tenant === 'malformed') {
    metadata.tenantId = TENANT_A; // claim with NO version
  }
  return {
    id: crypto.randomUUID(),
    // A payload tenantId must NEVER be trusted — put a decoy here.
    payload: { chatId: 'ext-chat', senderAgentId: 'agent-1', tenantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
    metadata,
    timestamp: Date.now(),
  };
}

describe('follow-up-hooks worker-tenant threading', () => {
  test('a tenant envelope threads the trusted tenant into the chat read and the arm call', async () => {
    const stamped: string[] = [];
    const calls = { chatTenantScope: [] as (string | null)[], disarm: [] as unknown[] };
    const { bus, fire } = captureBus();
    await setupFollowUpHooks(bus, servicesWith(calls), fakeDb(stamped));

    await fire('message.sent', messageSent('tenant'));

    // The chat read ran inside a worker scope stamped with the ENVELOPE tenant.
    expect(calls.chatTenantScope).toEqual([TENANT_A]);
    expect(stamped).toContain(TENANT_A);
    // The arm call was threaded the same trusted tenant — not the payload decoy.
    expect((calls.disarm[0] as { tenantId?: unknown }).tenantId).toBe(TENANT_A);
  });

  test('a legacy envelope threads null — the chat read runs unscoped', async () => {
    const stamped: string[] = [];
    const calls = { chatTenantScope: [] as (string | null)[], disarm: [] as unknown[] };
    const { bus, fire } = captureBus();
    await setupFollowUpHooks(bus, servicesWith(calls), fakeDb(stamped));

    await fire('message.sent', messageSent('legacy'));

    expect(calls.chatTenantScope).toEqual([null]);
    expect(stamped).toEqual([]);
    expect((calls.disarm[0] as { tenantId?: unknown }).tenantId).toBeNull();
  });

  test('a malformed envelope is refused — no chat read, no arm call', async () => {
    const stamped: string[] = [];
    const calls = { chatTenantScope: [] as (string | null)[], disarm: [] as unknown[] };
    const { bus, fire } = captureBus();
    await setupFollowUpHooks(bus, servicesWith(calls), fakeDb(stamped));

    // The handler swallows nothing here — trustedTenantOf throws before any
    // service call. The subscription layer would term it; assert defense in
    // depth: no work happened.
    await expect(fire('message.sent', messageSent('malformed'))).rejects.toThrow(/quarantined/);
    expect(calls.chatTenantScope).toEqual([]);
    expect(calls.disarm).toEqual([]);
  });
});
