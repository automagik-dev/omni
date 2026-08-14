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
    { channel: 'whatsapp', total: FIXTURE_COUNTS.whatsapp.total, active: FIXTURE_COUNTS.whatsapp.active },
    { channel: 'discord', total: FIXTURE_COUNTS.discord.total, active: FIXTURE_COUNTS.discord.active },
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
    c.set('channelRegistry', fakeRegistry(Array.from({ length: FIXTURE_COUNTS.connected }, (_, i) => `i-${i}`)));
    await next();
  });
  app.route('/api/v2', healthRoutes);
  return app;
}

/**
 * Every scalar in a JSON tree, flattened, so a leak cannot hide in nesting.
 * A field named in `exclude` has only its own LEAF scalar dropped — the benign
 * process metadata (`uptime`, `timestamp`, `version`) that would otherwise
 * collide with a forbidden count by coincidence. The exclusion is leaf-only on
 * purpose: an object or array under such a key is still recursed into, so a
 * forbidden count nested beneath a key that happens to be named `version` (etc.)
 * can never be swallowed by the skip.
 */
function scalars(value: unknown, exclude: ReadonlySet<string> = new Set(), out: unknown[] = []): unknown[] {
  if (value === null || typeof value !== 'object') {
    out.push(value);
    return out;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const isLeaf = entry === null || typeof entry !== 'object';
    if (isLeaf && exclude.has(key)) continue;
    scalars(entry, exclude, out);
  }
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

/**
 * Deliberately large, distinctive fixture magnitudes. A genuine leak of a
 * tenant count surfaces one of these unmistakable numbers, whereas an unrelated
 * small integer a public handler legitimately emits — a `uptime` of a few
 * seconds, a sub-millisecond `latency` — can never collide with one by
 * coincidence. This is what lets the value scan stay strict without depending
 * on how long the process has been alive when the test happens to run.
 */
const FIXTURE_COUNTS = {
  whatsapp: { total: 613, active: 409 },
  discord: { total: 400, active: 208 },
  connected: 419,
} as const;

/** Every seeded count that must never appear on a public surface. */
const FORBIDDEN_COUNTS: readonly number[] = [
  FIXTURE_COUNTS.whatsapp.total + FIXTURE_COUNTS.discord.total, // 1013 instances
  FIXTURE_COUNTS.whatsapp.active + FIXTURE_COUNTS.discord.active, // 617 active
  FIXTURE_COUNTS.connected, // 419 connected
  FIXTURE_COUNTS.whatsapp.total,
  FIXTURE_COUNTS.whatsapp.active,
  FIXTURE_COUNTS.discord.total,
  FIXTURE_COUNTS.discord.active,
];

/**
 * Process/build metadata excluded from the value scan: their values are
 * unrelated to tenant inventory. `uptime` in particular is a free-running clock
 * that would otherwise collide with a small count by pure coincidence — the
 * original flake — so it is skipped by field name rather than by value.
 */
const BENIGN_FIELDS: ReadonlySet<string> = new Set(['uptime', 'timestamp', 'version']);

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
      // Structural guard: a leak arriving under one of the aggregation keys is
      // caught by shape alone. (`connected` is intentionally NOT checked here —
      // it is a legitimate key on the NATS check, `checks.nats.details.connected`.)
      for (const key of ['instances', 'byChannel', 'total', 'active']) {
        expect(keysDeep(body)).not.toContain(key);
      }
      // Value guard for a leak arriving under some OTHER key: the seeded counts
      // are distinctive large numbers, and benign process fields (uptime,
      // timestamp, version) are excluded, so no accidental collision is possible.
      const values = scalars(body, BENIGN_FIELDS);
      for (const leaked of FORBIDDEN_COUNTS) expect(values).not.toContain(leaked);
      expect(JSON.stringify(body)).not.toContain('whatsapp');
      expect(JSON.stringify(body)).not.toContain('discord');
    });

    test('GET /info exposes no instance totals, active, or connected counts', async () => {
      const res = await publicApp().request('/api/v2/info');
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body.version).toBeDefined();
      expect(body.instances).toBeUndefined();
      // /info carries no NATS check, so every aggregation key is unambiguous here.
      for (const key of ['instances', 'byChannel', 'total', 'active', 'connected']) {
        expect(keysDeep(body)).not.toContain(key);
      }
      const values = scalars(body, BENIGN_FIELDS);
      for (const leaked of FORBIDDEN_COUNTS) expect(values).not.toContain(leaked);
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

    test('GET /health/consumers reveals no connection state when the query fails', async () => {
      // The success path was scrubbed; the failure path still handed an
      // anonymous caller the raw driver message. A connection error names the
      // host, port, database, and role — connection state, which the WISH
      // forbids on a public surface just as plainly as it forbids offsets.
      const app = new Hono<{ Variables: AppVariables }>();
      app.use('*', async (c, next) => {
        c.set('db', {
          select: () => ({
            from: async () => {
              throw new Error(
                'connection to server at "omni-db.internal" (10.0.3.7), port 5432 failed: role "omni_runtime" does not exist',
              );
            },
          }),
        } as unknown as AppVariables['db']);
        await next();
      });
      app.route('/api/v2', healthRoutes);

      const res = await app.request('/api/v2/health/consumers');
      const serialized = JSON.stringify(await res.json());

      expect(res.status).toBe(500);
      for (const leaked of ['omni-db.internal', '10.0.3.7', '5432', 'omni_runtime']) {
        expect(serialized).not.toContain(leaked);
      }
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
