/**
 * `middleware/auth.ts` turn-activity tracking — the G4 leg-2 use-after-commit
 * trap, closed (G5; ADR-0008).
 *
 * THE DEFECT. The middleware started a FIRE-AND-FORGET from inside a request:
 *
 *     services.turns.getOpenByApiKey(id).then((turn) => {
 *       if (turn) services.turns.recordActivity(turn.id).catch(() => {});
 *     }).catch(() => {});
 *
 * Nothing detached it and nothing scoped it. Its continuations resolve on a
 * later microtask, so they can run AFTER the request's tenant transaction has
 * committed and its pooled connection has been released — and `scopedHandle`
 * would still hand them that transaction through the ALS. That is exactly the
 * leg-2 trap `runDetachedFromTenantScope` exists for.
 *
 * REACHABILITY, STATED HONESTLY. Today the tenant world does not reach this
 * block: `tenancyMiddleware` runs first, sets `authContext`, and the very first
 * line of `authMiddleware` returns early when it is set — so under flag-on the
 * fire-and-forget never starts, and under flag-off there is no transaction to
 * outlive. The trap is LATENT, not live: `authMiddleware` is also mounted
 * standalone (`app.post('/a2a/:instanceId', authMiddleware, …)`), and any future
 * mount inside a scope would make it live with no other code change. The
 * structural test below therefore constructs the scope explicitly and says so;
 * the byte-identity test uses the shape production actually produces.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { Hono } from 'hono';
import { currentTenantScope, runInTenantScope } from '../../tenancy/tenant-scope';
import { authMiddleware } from '../auth';

const REQUEST_TENANT = '33333333-3333-4333-8333-33333333333c';

function scope(): string | null {
  return currentTenantScope()?.tenantId ?? null;
}

function fakePool(counters: { transactions: number }): Database {
  const db = {
    transaction: async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      counters.transactions += 1;
      return cb({ execute: async () => [] });
    },
    execute: async () => [],
  };
  return db as unknown as Database;
}

interface Observed {
  helper: string;
  scope: string | null;
}

function makeServices(observed: Observed[], counters: { transactions: number }) {
  return {
    db: fakePool(counters),
    apiKeys: {
      validate: async () => ({
        id: 'key-1',
        name: 'k',
        scopes: ['*'],
        instanceIds: null,
        profile: null,
        chatAllowlist: [],
        instanceAllowlist: [],
        outboundRecipientAllowlist: [],
        profileOverrides: null,
      }),
    },
    turns: {
      getOpenByApiKey: async () => {
        observed.push({ helper: 'getOpenByApiKey', scope: scope() });
        return { id: 'turn-1' };
      },
      recordActivity: async () => {
        observed.push({ helper: 'recordActivity', scope: scope() });
      },
    },
  };
}

/** Drive the middleware exactly as the router does. */
async function runMiddleware(services: unknown, wrap?: (fn: () => Promise<unknown>) => Promise<unknown>) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services' as never, services as never);
    await next();
  });
  app.use('*', authMiddleware as never);
  app.get('/x', (c) => c.text('ok'));

  const call = () => app.request('/x', { headers: { 'x-api-key': 'secret' } });
  const res = (await (wrap ? wrap(call as () => Promise<unknown>) : call())) as Response;
  // The fire-and-forget resolves on later microtasks; let them drain.
  await new Promise((r) => setTimeout(r, 5));
  return res;
}

describe('auth middleware turn tracking — legacy world is byte-identical', () => {
  test('no scope active: the same two calls, on the ambient pool, no worker transaction', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };

    const res = await runMiddleware(makeServices(observed, counters));

    expect(res.status).toBe(200);
    expect(observed.map((o) => o.helper)).toEqual(['getOpenByApiKey', 'recordActivity']);
    expect(observed.every((o) => o.scope === null)).toBe(true);
    expect(counters.transactions).toBe(0);
  });
});

describe('auth middleware turn tracking — the latent leg-2 trap is closed', () => {
  test('STRUCTURAL: started inside a scope, the continuations never inherit that transaction', async () => {
    const observed: Observed[] = [];
    const counters = { transactions: 0 };
    const services = makeServices(observed, counters);

    await runMiddleware(services, (call) =>
      runInTenantScope(
        services.db,
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
        call as () => Promise<unknown>,
      ),
    );

    expect(observed.map((o) => o.helper)).toEqual(['getOpenByApiKey', 'recordActivity']);
    // Both continuations ran in a FRESH worker transaction for the captured
    // tenant — never the request's, which by then may have committed.
    for (const entry of observed) expect(entry.scope).toBe(REQUEST_TENANT);
    // The request scope opened one; the detached worker opened its own.
    expect(counters.transactions).toBeGreaterThanOrEqual(2);
  });
});
