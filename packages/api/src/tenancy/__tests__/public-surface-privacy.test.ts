/**
 * Public-surface privacy probes (wish: omni-full-multitenancy, Group G4).
 *
 * WISH "Public and bootstrap surfaces": an unauthenticated endpoint must expose
 * no tenant inventory, counts, identifiers, connection state, consumer offsets,
 * or resource existence without an explicit inline privacy contract.
 *
 * These probes are DUAL-WORLD BY DESIGN and deliberately assert the same thing
 * with the multitenancy flag off as with it on. An anonymous caller counting a
 * deployment's instances, or reading its consumer names/streams/sequences/event
 * ids, is a leak in the legacy world too — a feature flag is not a defensible
 * reason to keep serving it. This is the sanctioned, individually justified
 * exception to G4's legacy-invariance boundary, and it is scoped to exactly the
 * two leaks `SURFACE_INVENTORY.yaml` names under `public_surfaces`:
 * the per-channel instance-count aggregation and the `consumer_offsets` dump.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import { Hono } from 'hono';
import { healthRoutes } from '../../routes/health';
import type { AppVariables } from '../../types';
import { MULTITENANCY_FLAG_ENV } from '../feature-flag';

/**
 * A db that WOULD happily answer every inventory question, so a passing probe
 * means the handler chose not to ask rather than that the fixture had nothing
 * to leak.
 */
function leakyDb(): AppVariables['db'] {
  const rows = [
    {
      consumerName: 'omni-persistence-consumer',
      streamName: 'OMNI_EVENTS',
      lastSequence: 918_273,
      lastEventId: 'e7f1c0de-0000-4000-8000-000000000001',
      updatedAt: new Date('2026-07-20T10:00:00.000Z'),
    },
  ];
  const aggregate = [
    { channel: 'whatsapp', total: 7, active: 5 },
    { channel: 'discord', total: 3, active: 2 },
  ];
  // A real Promise carrying an extra `groupBy`, so `.from(t)` is awaitable
  // directly (the /info shape) AND chainable (the /health shape) without
  // hand-rolling a thenable.
  const from = () => Object.assign(Promise.resolve(aggregate), { groupBy: async () => aggregate });
  return {
    execute: async () => [],
    // `.select()` with columns → aggregation; `.select()` bare → row dump.
    select: (columns?: unknown) => (columns ? { from } : { from: async () => rows }),
  } as unknown as AppVariables['db'];
}

function fakeRegistry(connectedIds: string[]) {
  return {
    getAll: () => [{ getConnectedInstances: () => connectedIds }],
    get: () => undefined,
  } as unknown as AppVariables['channelRegistry'];
}

function publicApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('db', leakyDb());
    c.set('eventBus', { isConnected: () => true } as unknown as EventBus);
    c.set('channelRegistry', fakeRegistry(['i-1', 'i-2', 'i-3']));
    await next();
  });
  app.route('/api/v2', healthRoutes);
  return app;
}

/** Every scalar in a JSON tree, flattened, so a leak cannot hide in nesting. */
function scalars(value: unknown, out: unknown[] = []): unknown[] {
  if (value === null || typeof value !== 'object') {
    out.push(value);
    return out;
  }
  for (const entry of Object.values(value as Record<string, unknown>)) scalars(entry, out);
  return out;
}

function keysDeep(value: unknown, out: string[] = []): string[] {
  if (value === null || typeof value !== 'object') return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out.push(key);
    keysDeep(entry, out);
  }
  return out;
}

const WORLDS: readonly (string | undefined)[] = [undefined, 'true'];

describe.each(WORLDS.map((flag) => [flag === 'true' ? 'tenant mode on' : 'legacy mode (flag off)', flag] as const))(
  'public surfaces leak nothing — %s',
  (_label, flag) => {
    const original = process.env[MULTITENANCY_FLAG_ENV];

    beforeEach(() => {
      if (flag === undefined) delete process.env[MULTITENANCY_FLAG_ENV];
      else process.env[MULTITENANCY_FLAG_ENV] = flag;
    });
    afterEach(() => {
      if (original === undefined) delete process.env[MULTITENANCY_FLAG_ENV];
      else process.env[MULTITENANCY_FLAG_ENV] = original;
    });

    test('GET /health exposes no instance inventory, counts, or connection state', async () => {
      const res = await publicApp().request('/api/v2/health');
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      // Liveness contract is preserved: the endpoint still answers the question
      // it exists to answer.
      expect(body.status).toBe('healthy');
      expect(body.checks).toBeDefined();

      expect(body.instances).toBeUndefined();
      expect(keysDeep(body)).not.toContain('byChannel');
      // The seeded fixture totals are 10 instances, 7 active, 3 connected.
      // None of those numbers may appear anywhere in the document.
      const values = scalars(body);
      for (const leaked of [10, 7, 3, 5, 2]) expect(values).not.toContain(leaked);
      expect(JSON.stringify(body)).not.toContain('whatsapp');
      expect(JSON.stringify(body)).not.toContain('discord');
    });

    test('GET /info exposes no instance totals, active, or connected counts', async () => {
      const res = await publicApp().request('/api/v2/info');
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body.version).toBeDefined();
      expect(body.instances).toBeUndefined();
      const values = scalars(body);
      for (const leaked of [10, 7, 3]) expect(values).not.toContain(leaked);
    });

    test('GET /health/consumers exposes no consumer names, streams, sequences, event ids, or timestamps', async () => {
      const res = await publicApp().request('/api/v2/health/consumers');
      const body = (await res.json()) as Record<string, unknown>;
      const serialized = JSON.stringify(body);

      expect(res.status).toBe(200);
      // It still answers the liveness question an operator probe needs.
      expect(body.status).toBe('ok');

      expect(serialized).not.toContain('omni-persistence-consumer');
      expect(serialized).not.toContain('OMNI_EVENTS');
      expect(serialized).not.toContain('918273');
      expect(serialized).not.toContain('e7f1c0de');
      expect(serialized).not.toContain('2026-07-20');
      expect(keysDeep(body)).not.toContain('consumers');
      expect(keysDeep(body)).not.toContain('lastSequence');
      expect(keysDeep(body)).not.toContain('lastEventId');
      // Even the count is inventory: it tells an anonymous caller how many
      // consumers — and therefore how much pipeline — a deployment runs.
      expect(keysDeep(body)).not.toContain('totalTracked');
      expect(scalars(body)).not.toContain(1);
    });

    test('GET /_internal/health exposes no tenant-derived value', async () => {
      const res = await publicApp().request('/api/v2/_internal/health');
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(200);
      expect(body.instances).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('whatsapp');
    });
  },
);
