/**
 * The hourly unread-count-refresh cron's tenant fan-out (G5; ADR-0008).
 *
 * This cron is the last SCHEDULER caller that reached `instances.listActive()`
 * on the ambient pool. Its shape is exactly the one `runForEachActiveTenantRow`
 * was written for and the two daily sync crons already use: a whole-table
 * `listActive()` read followed by a per-row side effect that is NOT a database
 * write (here, an in-process call into the WhatsApp plugin). It needs no open
 * decision — the fan-out is a pure adoption of the existing precedent.
 *
 * What is pinned:
 *   1. FLAG-OFF IS BYTE-IDENTICAL — one ambient `listActive`, zero auth-plane
 *      queries, and every active WhatsApp instance refreshed exactly as before.
 *   2. FLAG-ON ENUMERATES — one scoped `listActive` per ACTIVE tenant, each
 *      inside that tenant's worker scope, so the read is expressible under RLS.
 *   3. NO CROSS-TENANT BLEED — an instance owned by tenant B is never refreshed
 *      during tenant A's pass.
 *   4. THE CHANNEL FILTER SURVIVES — non-WhatsApp instances are still skipped,
 *      per tenant.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { __refreshUnreadCountsForTest } from '../scheduler';
import { MULTITENANCY_FLAG_ENV } from '../tenancy/feature-flag';
import { currentTenantScope } from '../tenancy/tenant-scope';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';

const FLAG_ON: NodeJS.ProcessEnv = { [MULTITENANCY_FLAG_ENV]: 'true' };
const FLAG_OFF: NodeJS.ProcessEnv = {};

interface StubInstance {
  id: string;
  channel: string;
  tenantId: string | null;
}

function fakeAuthPlaneDb(ids: string[], counter: { selects: number }): Database {
  return {
    select: () => {
      counter.selects += 1;
      return { from: () => ({ where: async () => ids.map((id) => ({ id })) }) };
    },
  } as unknown as Database;
}

function fakeScopeDb(): Database {
  return {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => cb({ execute: async () => [] as unknown }),
  } as unknown as Database;
}

function harness(opts: { instances: StubInstance[]; tenants: string[]; env: NodeJS.ProcessEnv }) {
  const counter = { selects: 0 };
  const listScopes: Array<string | null> = [];
  const refreshed: string[] = [];

  const services = {
    db: fakeScopeDb(),
    authPlane: { db: fakeAuthPlaneDb(opts.tenants, counter) },
    instances: {
      listActive: async () => {
        listScopes.push(currentTenantScope()?.tenantId ?? null);
        return opts.instances;
      },
    },
  } as never;

  const channelRegistry = {
    get: () => ({ refreshUnreadCounts: (id: string) => refreshed.push(id) }),
  } as never;

  return {
    run: () => __refreshUnreadCountsForTest(services, channelRegistry, opts.env),
    counter,
    listScopes,
    refreshed,
  };
}

describe('unread-count-refresh — flag-off is byte-identical', () => {
  test('one ambient listActive, no auth-plane query, all WhatsApp instances refreshed', async () => {
    const h = harness({
      env: FLAG_OFF,
      tenants: [TENANT_A],
      instances: [
        { id: 'wa-1', channel: 'whatsapp-baileys', tenantId: null },
        { id: 'wa-2', channel: 'whatsapp-baileys', tenantId: null },
        { id: 'dc-1', channel: 'discord', tenantId: null },
      ],
    });

    const count = await h.run();

    expect(h.counter.selects).toBe(0);
    expect(h.listScopes).toEqual([null]);
    expect(h.refreshed).toEqual(['wa-1', 'wa-2']);
    expect(count).toBe(2);
  });
});

describe('unread-count-refresh — tenant world', () => {
  test('one SCOPED listActive per active tenant', async () => {
    const h = harness({
      env: FLAG_ON,
      tenants: [TENANT_A, TENANT_B],
      instances: [],
    });

    await h.run();

    expect(h.counter.selects).toBe(1);
    // Per-tenant scoped reads plus the transitional NULL-tenant pass.
    expect(h.listScopes).toEqual([TENANT_A, TENANT_B, null]);
  });

  test('an instance owned by tenant B is not refreshed during tenant A’s pass', async () => {
    const h = harness({
      env: FLAG_ON,
      tenants: [TENANT_A],
      instances: [
        { id: 'wa-a', channel: 'whatsapp-baileys', tenantId: TENANT_A },
        { id: 'wa-b', channel: 'whatsapp-baileys', tenantId: TENANT_B },
      ],
    });

    await h.run();

    expect(h.refreshed).toEqual(['wa-a']);
  });

  test('the WhatsApp channel filter still applies per tenant', async () => {
    const h = harness({
      env: FLAG_ON,
      tenants: [TENANT_A],
      instances: [
        { id: 'wa-a', channel: 'whatsapp-baileys', tenantId: TENANT_A },
        { id: 'dc-a', channel: 'discord', tenantId: TENANT_A },
      ],
    });

    await h.run();

    expect(h.refreshed).toEqual(['wa-a']);
  });

  test('no WhatsApp plugin registered: nothing runs and no query is issued', async () => {
    const counter = { selects: 0 };
    const services = {
      db: fakeScopeDb(),
      authPlane: { db: fakeAuthPlaneDb([TENANT_A], counter) },
      instances: { listActive: async () => [] },
    } as never;
    const registryWithoutWhatsApp = { get: () => undefined } as never;

    expect(await __refreshUnreadCountsForTest(services, registryWithoutWhatsApp, FLAG_ON)).toBe(0);
    expect(counter.selects).toBe(0);
  });
});
