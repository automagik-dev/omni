/**
 * Streaming / long-lived-state tenant keying — G5 deliverable (e)
 * (wish: omni-full-multitenancy; ADR-0008, ADR-0006; RELEASE_SLOS
 * `revocation.websocket_sse_channel_provider_session_termination_seconds_max`).
 *
 * WHAT THESE PROBES FIX
 * ---------------------
 *   1. a long-lived subscription is keyed AND authorized by tenant, not only by
 *      resource UUID — knowing a session/chat id is not authority to receive it;
 *   2. fan-out to a resource never crosses a tenant boundary, even when two
 *      tenants' subscriptions name the SAME resource id;
 *   3. subscriptions terminate on revocation (suspension OR a bumped revocation
 *      epoch) inside the RELEASE_SLOS ceiling, proven with SYNTHETIC epochs and
 *      a synthetic clock — never a production timing claim;
 *   4. DUAL WORLD: flag-off/legacy subscriptions carry no tenant, fan out by
 *      resource exactly as pre-G5, and the sweeper issues NO query at all.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import {
  STREAM_TERMINATION_CEILING_SECONDS,
  TenantStreamRegistry,
  authorizeStreamSubscription,
  resolveStreamSweepIntervalMs,
  streamSubscriptionKey,
  sweepRevokedStreamSubscriptions,
} from '../tenant-stream-subscriptions';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const SESSION = 'voice-session-shared';

const FLAG_ON = { OMNI_MULTITENANCY_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv;
const FLAG_OFF = {} as unknown as NodeJS.ProcessEnv;

/** A recording sink standing in for a live socket. */
function socket() {
  const sent: string[] = [];
  const closed: string[] = [];
  return {
    sent,
    closed,
    send: (data: string) => sent.push(data),
    close: (reason: string) => closed.push(reason),
  };
}

/**
 * A synthetic `tenants` control-plane table, injected through the same reader
 * seam production uses. Epochs here are SYNTHETIC — nothing about these numbers
 * claims a production propagation time.
 */
function fakeStateReader(rows: Record<string, { status: string; revocationEpoch: number }>) {
  const reads: string[] = [];
  const read = async (_db: Database, tenantId: string) => {
    reads.push(tenantId);
    return rows[tenantId] ?? null;
  };
  return { read, reads };
}

/** An auth-plane handle that fails the test if it is ever queried. */
function forbiddenAuthPlane(): Database {
  return {
    select: () => {
      throw new Error('flag-off sweep must not touch the database');
    },
  } as unknown as Database;
}

describe('authorizeStreamSubscription — authority, not resource knowledge', () => {
  test('legacy world: no tenant context and no owned resource is admitted unchanged', () => {
    expect(authorizeStreamSubscription({ authenticatedTenantId: null, resourceTenantId: null })).toEqual({ ok: true });
  });

  test('a tenant may subscribe to its OWN resource', () => {
    expect(authorizeStreamSubscription({ authenticatedTenantId: TENANT_A, resourceTenantId: TENANT_A })).toEqual({
      ok: true,
    });
  });

  test('knowing tenant B resource id is NOT authority — cross-tenant subscribe refused', () => {
    expect(authorizeStreamSubscription({ authenticatedTenantId: TENANT_A, resourceTenantId: TENANT_B })).toEqual({
      ok: false,
      reason: 'cross_tenant_resource',
    });
  });

  test('fail-closed: a tenant-context subscriber may not bind an unowned resource', () => {
    expect(authorizeStreamSubscription({ authenticatedTenantId: TENANT_A, resourceTenantId: null })).toEqual({
      ok: false,
      reason: 'unowned_resource',
    });
  });

  test('fail-closed: an owned resource may not be bound without a tenant context', () => {
    expect(authorizeStreamSubscription({ authenticatedTenantId: null, resourceTenantId: TENANT_A })).toEqual({
      ok: false,
      reason: 'tenant_context_required',
    });
  });

  test('a malformed tenant is refused before it can key anything', () => {
    expect(
      authorizeStreamSubscription({ authenticatedTenantId: 'not-a-uuid', resourceTenantId: 'not-a-uuid' }),
    ).toEqual({ ok: false, reason: 'malformed_tenant' });
  });
});

describe('streamSubscriptionKey — a resource UUID alone cannot address a stream', () => {
  test('the same resource under two tenants yields two distinct keys', () => {
    expect(streamSubscriptionKey(TENANT_A, SESSION)).not.toBe(streamSubscriptionKey(TENANT_B, SESSION));
  });

  test('the legacy key is stable and distinct from every tenant key', () => {
    const legacy = streamSubscriptionKey(null, SESSION);
    expect(legacy).not.toBe(streamSubscriptionKey(TENANT_A, SESSION));
    expect(legacy).toBe(streamSubscriptionKey(null, SESSION));
  });
});

describe('TenantStreamRegistry — fan-out never crosses a tenant', () => {
  test('two tenants subscribed to the SAME resource id receive only their own payloads', () => {
    const registry = new TenantStreamRegistry<ReturnType<typeof socket>>();
    const a = socket();
    const b = socket();
    registry.add(a, { tenantId: TENANT_A, resourceId: SESSION, revocationEpoch: 1, close: a.close });
    registry.add(b, { tenantId: TENANT_B, resourceId: SESSION, revocationEpoch: 1, close: b.close });

    for (const [conn] of registry.matching(SESSION, TENANT_A)) conn.send('for-A');

    expect(a.sent).toEqual(['for-A']);
    expect(b.sent).toEqual([]);
  });

  test('DUAL WORLD: legacy subscriptions fan out by resource alone, as pre-G5', () => {
    const registry = new TenantStreamRegistry<ReturnType<typeof socket>>();
    const one = socket();
    const two = socket();
    registry.add(one, { tenantId: null, resourceId: SESSION, revocationEpoch: 0, close: one.close });
    registry.add(two, { tenantId: null, resourceId: SESSION, revocationEpoch: 0, close: two.close });

    for (const [conn] of registry.matching(SESSION, null)) conn.send('legacy');

    expect(one.sent).toEqual(['legacy']);
    expect(two.sent).toEqual(['legacy']);
  });

  test('a legacy fan-out does not reach a tenant-bound subscriber, and vice versa', () => {
    const registry = new TenantStreamRegistry<ReturnType<typeof socket>>();
    const legacy = socket();
    const bound = socket();
    registry.add(legacy, { tenantId: null, resourceId: SESSION, revocationEpoch: 0, close: legacy.close });
    registry.add(bound, { tenantId: TENANT_A, resourceId: SESSION, revocationEpoch: 1, close: bound.close });

    for (const [conn] of registry.matching(SESSION, null)) conn.send('legacy');
    for (const [conn] of registry.matching(SESSION, TENANT_A)) conn.send('tenant');

    expect(legacy.sent).toEqual(['legacy']);
    expect(bound.sent).toEqual(['tenant']);
  });

  test('terminateTenant closes only the named tenant, leaving siblings connected', () => {
    const registry = new TenantStreamRegistry<ReturnType<typeof socket>>();
    const a = socket();
    const b = socket();
    registry.add(a, { tenantId: TENANT_A, resourceId: SESSION, revocationEpoch: 1, close: a.close });
    registry.add(b, { tenantId: TENANT_B, resourceId: SESSION, revocationEpoch: 1, close: b.close });

    const closed = registry.terminateTenant(TENANT_A, 'tenant_suspended');

    expect(closed).toBe(1);
    expect(a.closed).toEqual(['tenant_suspended']);
    expect(b.closed).toEqual([]);
    expect(registry.size).toBe(1);
  });
});

describe('revocation sweep — synthetic epochs, RELEASE_SLOS ceiling', () => {
  test('the sweep cadence is at or under the RELEASE_SLOS termination ceiling', () => {
    expect(STREAM_TERMINATION_CEILING_SECONDS).toBe(30);
    expect(resolveStreamSweepIntervalMs()).toBeLessThanOrEqual(STREAM_TERMINATION_CEILING_SECONDS * 1000);
  });

  test('a SUSPENDED tenant loses its subscriptions; the active sibling keeps its own', async () => {
    const registry = new TenantStreamRegistry<ReturnType<typeof socket>>();
    const a = socket();
    const b = socket();
    registry.add(a, { tenantId: TENANT_A, resourceId: SESSION, revocationEpoch: 1, close: a.close });
    registry.add(b, { tenantId: TENANT_B, resourceId: SESSION, revocationEpoch: 1, close: b.close });

    const plane = fakeStateReader({
      [TENANT_A]: { status: 'suspended', revocationEpoch: 2 },
      [TENANT_B]: { status: 'active', revocationEpoch: 1 },
    });

    const stats = await sweepRevokedStreamSubscriptions(forbiddenAuthPlane(), registry, FLAG_ON, plane.read);

    expect(stats.terminated).toBe(1);
    expect(a.closed).toEqual(['tenant_revoked']);
    expect(b.closed).toEqual([]);
  });

  test('a BUMPED revocation epoch terminates a still-active tenant subscription', async () => {
    const registry = new TenantStreamRegistry<ReturnType<typeof socket>>();
    const stale = socket();
    registry.add(stale, { tenantId: TENANT_A, resourceId: SESSION, revocationEpoch: 7, close: stale.close });

    const plane = fakeStateReader({ [TENANT_A]: { status: 'active', revocationEpoch: 8 } });
    const stats = await sweepRevokedStreamSubscriptions(forbiddenAuthPlane(), registry, FLAG_ON, plane.read);

    expect(stats.terminated).toBe(1);
    expect(stale.closed).toEqual(['tenant_revoked']);
    expect(registry.size).toBe(0);
  });

  test('an unchanged epoch on an active tenant terminates nothing', async () => {
    const registry = new TenantStreamRegistry<ReturnType<typeof socket>>();
    const live = socket();
    registry.add(live, { tenantId: TENANT_A, resourceId: SESSION, revocationEpoch: 7, close: live.close });

    const plane = fakeStateReader({ [TENANT_A]: { status: 'active', revocationEpoch: 7 } });
    const stats = await sweepRevokedStreamSubscriptions(forbiddenAuthPlane(), registry, FLAG_ON, plane.read);

    expect(stats.terminated).toBe(0);
    expect(live.closed).toEqual([]);
    expect(registry.size).toBe(1);
  });

  test('fail-closed: a tenant that no longer resolves at all is terminated', async () => {
    const registry = new TenantStreamRegistry<ReturnType<typeof socket>>();
    const orphan = socket();
    registry.add(orphan, { tenantId: TENANT_A, resourceId: SESSION, revocationEpoch: 1, close: orphan.close });

    const stats = await sweepRevokedStreamSubscriptions(
      forbiddenAuthPlane(),
      registry,
      FLAG_ON,
      fakeStateReader({}).read,
    );

    expect(stats.terminated).toBe(1);
    expect(orphan.closed).toEqual(['tenant_revoked']);
  });

  test('one auth-plane read per DISTINCT tenant, not per connection', async () => {
    const registry = new TenantStreamRegistry<ReturnType<typeof socket>>();
    for (let i = 0; i < 5; i += 1) {
      const s = socket();
      registry.add(s, { tenantId: TENANT_A, resourceId: `res-${i}`, revocationEpoch: 1, close: s.close });
    }
    const plane = fakeStateReader({ [TENANT_A]: { status: 'active', revocationEpoch: 1 } });
    await sweepRevokedStreamSubscriptions(forbiddenAuthPlane(), registry, FLAG_ON, plane.read);
    expect(plane.reads).toEqual([TENANT_A]);
  });

  test('DUAL WORLD: flag-off sweeps nothing and issues no query', async () => {
    const registry = new TenantStreamRegistry<ReturnType<typeof socket>>();
    const legacy = socket();
    registry.add(legacy, { tenantId: null, resourceId: SESSION, revocationEpoch: 0, close: legacy.close });

    const stats = await sweepRevokedStreamSubscriptions(forbiddenAuthPlane(), registry, FLAG_OFF);

    expect(stats.terminated).toBe(0);
    expect(legacy.closed).toEqual([]);
    expect(registry.size).toBe(1);
  });

  test('flag-on: legacy (tenantless) subscriptions are never swept or queried', async () => {
    const registry = new TenantStreamRegistry<ReturnType<typeof socket>>();
    const legacy = socket();
    registry.add(legacy, { tenantId: null, resourceId: SESSION, revocationEpoch: 0, close: legacy.close });

    const plane = fakeStateReader({});
    const stats = await sweepRevokedStreamSubscriptions(forbiddenAuthPlane(), registry, FLAG_ON, plane.read);

    expect(stats.terminated).toBe(0);
    expect(plane.reads).toEqual([]);
    expect(legacy.closed).toEqual([]);
  });

  test('SYNTHETIC CLOCK: a revocation at t=0 is terminated within the ceiling', async () => {
    const registry = new TenantStreamRegistry<ReturnType<typeof socket>>();
    const s = socket();
    registry.add(s, { tenantId: TENANT_A, resourceId: SESSION, revocationEpoch: 1, close: s.close });

    // Synthetic timeline: the tenant is suspended at t=0; the sweeper's next tick
    // lands at `resolveStreamSweepIntervalMs()`. No wall clock is consulted.
    const revokedAtMs = 0;
    const sweptAtMs = revokedAtMs + resolveStreamSweepIntervalMs();

    const plane = fakeStateReader({ [TENANT_A]: { status: 'suspended', revocationEpoch: 2 } });
    const stats = await sweepRevokedStreamSubscriptions(forbiddenAuthPlane(), registry, FLAG_ON, plane.read);

    expect(stats.terminated).toBe(1);
    expect((sweptAtMs - revokedAtMs) / 1000).toBeLessThanOrEqual(STREAM_TERMINATION_CEILING_SECONDS);
  });
});
