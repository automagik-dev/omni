/**
 * Regression tests for issue #496 — CRITICAL: bare v2 list endpoints must
 * never leak raw PostgreSQL driver text.
 *
 * Before the fix, `GET /v2/{access,event-ops,processed-events}` fell through
 * to the root-mounted `automationsRoutes./:id` catch-all (mounted at `/` to
 * expose `/automation-logs` and `/automation-metrics`). The catch-all called
 * `services.automations.getById(<literal-segment>)`, which hit PG with a
 * non-UUID string and surfaced `invalid input syntax for type uuid: "…"` in
 * the 500 body.
 *
 * The contract under test here is narrow and strict:
 *   - Each of the three bare paths returns a clean JSON body
 *   - No response body contains PG driver phrases
 *   - Status is either 200 (list) or 404 (not-a-resource) — never 500
 */

import { describe, expect, test } from 'bun:test';
import type { AccessRule } from '@omni/db';
import { Hono } from 'hono';
import { accessRoutes } from '../routes/v2/access';
import { eventOpsRoutes } from '../routes/v2/event-ops';
import { v2Routes } from '../routes/v2/index';
import { processedEventsRoutes } from '../routes/v2/processed-events';
import type { AppVariables } from '../types';

// Substrings that must NEVER appear in any response body for these bare paths.
// If any of these show up, the PG driver is leaking through the error pipeline.
const PG_LEAK_NEEDLES = [
  'invalid input syntax',
  'invalid input syntax for type uuid',
  'syntax error at',
  'duplicate key value',
  'relation "',
  'ERROR:',
  'at pg.',
  'postgres:',
  'DrizzleError',
];

function expectNoPgLeak(body: unknown): void {
  const serialized = JSON.stringify(body);
  for (const needle of PG_LEAK_NEEDLES) {
    expect(serialized.toLowerCase()).not.toContain(needle.toLowerCase());
  }
}

function makeAccessApp(rules: AccessRule[] = []) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      access: {
        // Only `list` is exercised for the bare-path regression. Other methods
        // are unreachable from this test and are intentionally not stubbed.
        list: async (_options: unknown) => rules,
      },
    } as unknown as AppVariables['services']);
    await next();
  });
  app.route('/access', accessRoutes);
  return app;
}

function makeEventOpsApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  // No services needed: the bare handler is pure and never reaches the service layer.
  app.route('/event-ops', eventOpsRoutes);
  return app;
}

function makeProcessedEventsApp() {
  const app = new Hono<{ Variables: AppVariables }>();
  app.route('/processed-events', processedEventsRoutes);
  return app;
}

describe('issue #496 — bare v2 list handlers (no PG driver leak)', () => {
  describe('GET /v2/access', () => {
    test('returns 200 with empty items when no rules', async () => {
      const app = makeAccessApp([]);
      const res = await app.request('/access');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: AccessRule[] };
      expect(body.items).toEqual([]);
      expectNoPgLeak(body);
    });

    test('returns 200 with rules list when rules exist', async () => {
      const fakeRule = {
        id: '00000000-0000-0000-0000-000000000001',
        ruleType: 'deny',
      } as unknown as AccessRule;
      const app = makeAccessApp([fakeRule]);
      const res = await app.request('/access');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: AccessRule[] };
      expect(body.items).toHaveLength(1);
      expect(body.items[0]?.id).toBe('00000000-0000-0000-0000-000000000001');
      expectNoPgLeak(body);
    });

    test('accepts valid query filters', async () => {
      const app = makeAccessApp([]);
      const res = await app.request('/access?type=allow');
      expect(res.status).toBe(200);
      const body = await res.json();
      expectNoPgLeak(body);
    });
  });

  describe('GET /v2/event-ops', () => {
    test('returns 404 with clean NOT_FOUND body', async () => {
      const app = makeEventOpsApp();
      const res = await app.request('/event-ops');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('/v2/event-ops');
      expectNoPgLeak(body);
    });
  });

  describe('GET /v2/processed-events', () => {
    test('returns 404 with clean NOT_FOUND body', async () => {
      const app = makeProcessedEventsApp();
      const res = await app.request('/processed-events');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('#411');
      expectNoPgLeak(body);
    });
  });

  // --------------------------------------------------------------------------
  // Integration: full v2Routes aggregator — proves the three bare paths are
  // intercepted BEFORE falling through to the root-mounted catch-all.
  //
  // The root mount `v2Routes.route('/', automationsRoutes)` registers the
  // automations `/:id` handler at the root. Before the fix, bare paths like
  // `/access` hit that handler with `id="access"` and called
  // `services.automations.getById("access")`. This stub makes
  // `automations.getById` throw a fake PG UUID error — if the regression
  // returns, the test will see it in the response body.
  // --------------------------------------------------------------------------
  describe('full v2Routes aggregator — no fallthrough to /:id catch-all', () => {
    class FakePgUuidError extends Error {
      code = '22P02';
      constructor(value: string) {
        super(`invalid input syntax for type uuid: "${value}"`);
        this.name = 'PostgresError';
      }
    }

    function makeFullApp() {
      const app = new Hono<{ Variables: AppVariables }>();
      app.use('*', async (c, next) => {
        c.set('services', {
          access: { list: async () => [] },
          // Tripwire: if anything falls through to the catch-all, this throws
          // the exact PG error shape that originally leaked in production.
          automations: {
            getById: async (id: string) => {
              throw new FakePgUuidError(id);
            },
          },
        } as unknown as AppVariables['services']);
        await next();
      });
      app.route('/v2', v2Routes);
      return app;
    }

    test('GET /v2/access returns 200, never 500 with PG text', async () => {
      const app = makeFullApp();
      const res = await app.request('/v2/access');
      const body = await res.json();
      expect(res.status).toBe(200);
      expectNoPgLeak(body);
    });

    test('GET /v2/event-ops returns 404, never 500 with PG text', async () => {
      const app = makeFullApp();
      const res = await app.request('/v2/event-ops');
      const body = await res.json();
      expect(res.status).toBe(404);
      expectNoPgLeak(body);
    });

    test('GET /v2/processed-events returns 404, never 500 with PG text', async () => {
      const app = makeFullApp();
      const res = await app.request('/v2/processed-events');
      const body = await res.json();
      expect(res.status).toBe(404);
      expectNoPgLeak(body);
    });
  });
});
