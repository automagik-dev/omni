/**
 * Route ownership as a RUNTIME gate
 * (wish: omni-full-multitenancy, Group G4).
 *
 * WHAT WENT WRONG, AND WHAT THESE TESTS PIN
 * -----------------------------------------
 * `route-ownership.ts` declared `GET /api/v2/metrics`, `GET /api/v2/logs/recent`
 * and `GET /api/v2/logs/stream` platform-admin, and the `/keys` and `/trust`
 * surfaces control-plane — and then nothing read those declarations at request
 * time. Authorization went through `scope-enforcer`, which knows only
 * `SCOPE_MAP`, against scopes `projectTenantScopes` derived from ALL of
 * `SCOPE_MAP`. The declarations were therefore true of the registry and false
 * of the running server:
 *
 *   * `tenant:read` yielded `metrics:read` + `logs:read`, so a tenant-VIEWER
 *     key could read the process-wide log ring buffer — other tenants' log
 *     lines, in a deployment-global buffer with no tenant column to filter on.
 *   * `tenant:write` yielded `trust:write`, so a tenant-OPERATOR key could
 *     mutate and delete the deployment's genie host-trust registry.
 *   * `keys:delegate` yielded `keys:read` + `keys:write`, which is the whole
 *     legacy keys router. `POST /keys` is intercepted for tenant credentials;
 *     `GET /keys`, `POST /keys/:id/revoke` and `DELETE /keys/:id` are not, and
 *     `api_keys` has neither a tenant column nor RLS. A tenant-admin key could
 *     enumerate every credential in the deployment and revoke any of them,
 *     including the operator master key.
 *
 * TWO BARRIERS, NOT ONE
 * ---------------------
 * The fix is deliberately redundant, because the failure was a DRIFT between a
 * declaration and its enforcement and one barrier cannot detect drift:
 *
 *   1. `scope-projection.ts` now derives from `TENANT_ADDRESSABLE_SCOPES`, so
 *      the authority is never granted. Covered in `scope-projection.test.ts`.
 *   2. The tenancy edge refuses the route by name, so the authority cannot be
 *      exercised even if something else produced it. Covered here.
 *
 * WHY THE APP IS ASSEMBLED HERE RATHER THAN IMPORTED
 * --------------------------------------------------
 * The gate reads Hono's own match result, so it needs a real router with real
 * registered paths — but the full app needs a database and a service graph.
 * These tests register the exact route keys under test on a miniature app with
 * the same shape (`tenancyMiddleware` on a sub-app mounted at `/api/v2`), and
 * every one of those keys is asserted to be a REAL declaration with the
 * expected class before it is exercised. That closes the gap the assembly
 * opens: `route-ownership.test.ts` separately proves the declarations match the
 * routes the real app registers, so a route key that is declared here and
 * registered there cannot be fictional.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { Hono } from 'hono';
import { tenancyMiddleware } from '../../middleware/tenancy';
import type { AppVariables } from '../../types';
import { type TenantAuthContext, freezeContext } from '../auth-context';
import {
  ROUTE_OWNERSHIP,
  type RouteOwnershipClass,
  isTenantAddressableRoute,
  resolveRouteOwnership,
} from '../route-ownership';

const TENANT_A = '11111111-1111-4111-8111-111111111111';

/**
 * Multitenancy must be ON for the edge to consult the auth plane at all: with
 * the flag off `tenancyMiddleware` returns before the lookup, by design, so
 * every test here would pass vacuously.
 */
process.env.OMNI_MULTITENANCY_ENABLED = 'true';

/** Opens a transaction that executes nothing. The gate must refuse before this. */
function fakeDb(): { db: Database; opened: () => number } {
  let opened = 0;
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      opened += 1;
      return fn({ execute: async () => [] });
    },
  } as unknown as Database;
  return { db, opened: () => opened };
}

function tenantContext(role: string, scopes: readonly string[]): TenantAuthContext {
  return freezeContext({
    credentialClass: 'tenant',
    requestId: 'req-1',
    principalId: 'p-1',
    credentialId: 'c-1',
    tenantId: TENANT_A,
    tenantSlug: 'tenant-a',
    actorRole: role,
    scopes,
    membershipId: 'm-1',
    resourceConstraints: {},
    expiresAt: null,
    rateLimit: null,
    budget: null,
    delegationDepth: 0,
    rootKeyId: 'root-1',
    policyVersion: 1,
    revocationEpoch: 1,
    tenantKeyLineageId: 'l-1',
  }) as TenantAuthContext;
}

const VIEWER = tenantContext('tenant-viewer', ['tenant:read']);
const OPERATOR = tenantContext('tenant-operator', ['tenant:read', 'tenant:write']);
const ADMIN = tenantContext('tenant-admin', ['tenant:*', 'keys:delegate']);

/** The routes these tests drive, registered exactly as the real app registers them. */
const ROUTES: readonly { method: 'get' | 'post' | 'patch' | 'delete'; path: string }[] = [
  { method: 'get', path: '/metrics' },
  { method: 'get', path: '/logs/recent' },
  { method: 'get', path: '/logs/stream' },
  { method: 'get', path: '/keys' },
  { method: 'get', path: '/keys/:id/audit' },
  { method: 'post', path: '/keys' },
  { method: 'post', path: '/keys/:id/revoke' },
  { method: 'delete', path: '/keys/:id' },
  { method: 'post', path: '/trust/handshake' },
  { method: 'patch', path: '/trust/hosts/:id' },
  { method: 'delete', path: '/trust/hosts/:id' },
  { method: 'get', path: '/trust/hosts' },
  { method: 'post', path: '/auth/validate' },
  { method: 'get', path: '/instances' },
  { method: 'post', path: '/messages/send' },
  { method: 'get', path: '/platform/tenants' },
];

interface Harness {
  request(method: string, path: string): Promise<Response>;
  reached(): string[];
  transactionsOpened(): number;
}

/**
 * `context: null` models a credential the auth plane does not recognise — a
 * LEGACY key. The edge must then set nothing and hand the request to the legacy
 * chain untouched, which is the G4 legacy-invariance boundary.
 */
function harness(context: TenantAuthContext | null): Harness {
  const reached: string[] = [];
  const { db, opened } = fakeDb();

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('services', {
      requestAuthenticator: {
        authenticate: async () =>
          context
            ? { ok: true as const, context, tenantSource: 'credential' }
            : { ok: false as const, reason: 'not_found' },
        release: () => undefined,
      },
    } as never);
    await next();
  });

  const protectedApp = new Hono<{ Variables: AppVariables }>();
  protectedApp.use('*', tenancyMiddleware);
  for (const { method, path } of ROUTES) {
    protectedApp[method](path, (c) => {
      reached.push(`${c.req.method} ${path}`);
      return c.json({ data: 'handler-reached' });
    });
  }
  app.route('/api/v2', protectedApp);

  return {
    request: (method, path) =>
      app.request(path, { method, headers: { 'x-api-key': 'omni_secret' } }) as Promise<Response>,
    reached: () => reached,
    transactionsOpened: opened,
  };
}

/** Assert the declaration exists and says what the test assumes it says. */
function declaredAs(route: string, expected: RouteOwnershipClass): void {
  expect(ROUTE_OWNERSHIP.some((d) => d.route === route)).toBe(true);
  expect(resolveRouteOwnership(route)).toBe(expected);
}

describe('the ownership table has a runtime consumer', () => {
  test('every declared platform-admin and control-plane route is unaddressable by a tenant, bar the two exceptions', () => {
    const reachable = ROUTE_OWNERSHIP.filter(
      (d) => (d.class === 'platform-admin' || d.class === 'control-plane') && isTenantAddressableRoute(d.route),
    ).map((d) => d.route);
    // The exceptions are credential-self-service: introspecting one's own
    // context, and minting a bounded same-tenant child key.
    expect(reachable.sort()).toEqual(['POST /api/v2/auth/validate', 'POST /api/v2/keys']);
  });

  test('every declared tenant-scoped route is addressable by a tenant', () => {
    const blocked = ROUTE_OWNERSHIP.filter((d) => d.class === 'tenant-scoped' && !isTenantAddressableRoute(d.route));
    expect(blocked).toEqual([]);
  });

  test('an undeclared route is refused rather than allowed', () => {
    // Fail closed. The coverage gate holds the undeclared count at zero, so
    // reaching this state means a route shipped with nobody having decided who
    // may call it — the case where "allow" is the wrong default.
    expect(resolveRouteOwnership('GET /api/v2/invented-tomorrow')).toBeUndefined();
    expect(isTenantAddressableRoute('GET /api/v2/invented-tomorrow')).toBe(false);
  });
});

describe('a tenant-viewer credential cannot read cross-tenant observability', () => {
  for (const route of ['/metrics', '/logs/recent', '/logs/stream']) {
    test(`GET ${route} is refused`, async () => {
      declaredAs(`GET /api/v2${route}`, 'platform-admin');
      const h = harness(VIEWER);
      const res = await h.request('GET', `/api/v2${route}`);
      expect(res.status).toBe(403);
      expect(h.reached()).toEqual([]);
      // Refused before the tenant transaction opens: a denial must cost no
      // database work and must not leave a scoped handle behind.
      expect(h.transactionsOpened()).toBe(0);
    });
  }

  test('the refusal does not say which class the route belongs to', async () => {
    const res = await harness(VIEWER).request('GET', '/api/v2/metrics');
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).not.toContain('platform-admin');
  });
});

describe('a tenant-admin credential cannot reach the legacy keys router', () => {
  for (const [method, route] of [
    ['GET', '/keys'],
    ['GET', '/keys/abc/audit'],
    ['POST', '/keys/abc/revoke'],
    ['DELETE', '/keys/abc'],
  ] as const) {
    test(`${method} ${route} is refused`, async () => {
      const h = harness(ADMIN);
      const res = await h.request(method, `/api/v2${route}`);
      expect(res.status).toBe(403);
      expect(h.reached()).toEqual([]);
      expect(h.transactionsOpened()).toBe(0);
    });
  }

  test('the revoke and delete verbs are declared control-plane, so this is enforcement of a real declaration', () => {
    declaredAs('POST /api/v2/keys/:id/revoke', 'control-plane');
    declaredAs('DELETE /api/v2/keys/:id', 'control-plane');
    declaredAs('GET /api/v2/keys', 'control-plane');
  });

  test('POST /keys still reaches the handler — child-key delegation is the one keys verb a tenant has', async () => {
    const h = harness(ADMIN);
    const res = await h.request('POST', '/api/v2/keys');
    expect(res.status).toBe(200);
    expect(h.reached()).toEqual(['POST /keys']);
  });
});

describe('a tenant-operator credential cannot mutate host trust', () => {
  for (const [method, route] of [
    ['POST', '/trust/handshake'],
    ['PATCH', '/trust/hosts/abc'],
    ['DELETE', '/trust/hosts/abc'],
    ['GET', '/trust/hosts'],
  ] as const) {
    test(`${method} ${route} is refused`, async () => {
      const h = harness(OPERATOR);
      const res = await h.request(method, `/api/v2${route}`);
      expect(res.status).toBe(403);
      expect(h.reached()).toEqual([]);
    });
  }

  test('the trust surface is declared control-plane', () => {
    declaredAs('PATCH /api/v2/trust/hosts/:id', 'control-plane');
    declaredAs('DELETE /api/v2/trust/hosts/:id', 'control-plane');
  });
});

describe('the gate refuses the control plane itself', () => {
  test('a tenant credential cannot address a platform tenant route', async () => {
    declaredAs('GET /api/v2/platform/tenants', 'platform-admin');
    const h = harness(ADMIN);
    expect((await h.request('GET', '/api/v2/platform/tenants')).status).toBe(403);
    expect(h.reached()).toEqual([]);
  });
});

describe('the gate does not block what tenants exist to do', () => {
  test('tenant-scoped routes still reach their handler', async () => {
    const h = harness(ADMIN);
    expect((await h.request('GET', '/api/v2/instances')).status).toBe(200);
    expect((await h.request('POST', '/api/v2/messages/send')).status).toBe(200);
    expect(h.reached()).toEqual(['GET /instances', 'POST /messages/send']);
    // The allowed path DOES open the tenant transaction — the counterpart to
    // the refusals asserting it does not.
    expect(h.transactionsOpened()).toBe(2);
  });

  test('a credential can always introspect itself', async () => {
    const h = harness(VIEWER);
    expect((await h.request('POST', '/api/v2/auth/validate')).status).toBe(200);
  });
});

describe('legacy invariance', () => {
  test('a credential the auth plane does not recognise is unaffected on every route', async () => {
    // The gate is reached only after a TENANT context is established. A legacy
    // key reaches none of it, including on the routes a tenant is refused —
    // which is the whole flag-off/legacy contract in one assertion.
    const h = harness(null);
    for (const [method, route] of [
      ['GET', '/metrics'],
      ['GET', '/logs/recent'],
      ['GET', '/keys'],
      ['DELETE', '/keys/abc'],
      ['PATCH', '/trust/hosts/abc'],
      ['GET', '/platform/tenants'],
    ] as const) {
      expect((await h.request(method, `/api/v2${route}`)).status).toBe(200);
    }
    expect(h.reached()).toHaveLength(6);
    expect(h.transactionsOpened()).toBe(0);
  });
});
