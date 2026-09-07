/**
 * SDK platform control-plane surface (issue #981).
 *
 * Pins the method → route mapping for the tenant/membership operations and
 * root-key issuance, and — the part the server audits — WHERE the reason
 * travels: reads send the `x-platform-reason` header, mutations send `reason`
 * in the JSON body.
 * A local Bun server records every request so the assertions are on the actual
 * wire shape, not on mocks of our own code.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import { OmniApiError, type OmniClient, createOmniClient } from '../index';

interface RecordedRequest {
  method: string;
  path: string;
  reasonHeader: string | null;
  body: Record<string, unknown> | null;
}

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const MEMBERSHIP_ID = '22222222-2222-4222-8222-222222222222';
const PRINCIPAL_ID = '33333333-3333-4333-8333-333333333333';

const tenant = {
  id: TENANT_ID,
  slug: 'acme',
  displayName: 'Acme Corp',
  status: 'active',
  policyVersion: 1,
  revocationEpoch: 0,
  maxKeyTtlSeconds: 3600,
  maxKeyRateLimit: 100,
  maxKeyBudget: 1000,
  createdByPrincipalId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  suspendedAt: null,
  archivedAt: null,
};

const membership = {
  id: MEMBERSHIP_ID,
  tenantId: TENANT_ID,
  principalId: PRINCIPAL_ID,
  role: 'tenant-operator',
  status: 'active',
  invitedByPrincipalId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  disabledAt: null,
};

const rootKey = {
  id: '44444444-4444-4444-8444-444444444444',
  tenantId: TENANT_ID,
  principalId: PRINCIPAL_ID,
  membershipId: MEMBERSHIP_ID,
  name: 'acme-root',
  role: 'tenant-owner',
  scopes: ['messages:send'],
  constraints: {},
  delegationDepth: 0,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  rateLimit: 60,
  budget: 500,
  plainTextKey: 'omni_root_plaintext_only_once',
};

describe('platform control plane', () => {
  let server: Server;
  let client: OmniClient;
  const requests: RecordedRequest[] = [];

  // Exact-match route table — every test request targets the fixture ids.
  const TENANTS = '/api/v2/platform/tenants';
  const MEMBERSHIPS = `${TENANTS}/${TENANT_ID}/memberships`;
  const routes: Record<string, () => Response> = {
    [`GET ${TENANTS}`]: () => Response.json({ items: [tenant] }),
    [`POST ${TENANTS}`]: () => Response.json({ data: tenant }, { status: 201 }),
    [`GET ${TENANTS}/${TENANT_ID}`]: () => Response.json({ data: tenant }),
    [`POST ${TENANTS}/${TENANT_ID}/suspend`]: () => Response.json({ data: tenant }),
    [`POST ${TENANTS}/${TENANT_ID}/archive`]: () => Response.json({ data: tenant }),
    [`GET ${MEMBERSHIPS}`]: () => Response.json({ items: [membership] }),
    [`POST ${MEMBERSHIPS}`]: () => Response.json({ data: membership }, { status: 201 }),
    [`POST ${MEMBERSHIPS}/${MEMBERSHIP_ID}/disable`]: () => Response.json({ data: membership }),
    [`POST ${MEMBERSHIPS}/${MEMBERSHIP_ID}/status`]: () => Response.json({ data: membership }),
    [`POST ${MEMBERSHIPS}/${MEMBERSHIP_ID}/role`]: () => Response.json({ data: membership }),
    [`POST ${TENANTS}/${TENANT_ID}/keys/root`]: () => Response.json({ data: rootKey }, { status: 201 }),
  };

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const body = req.method === 'POST' ? ((await req.json()) as Record<string, unknown>) : null;
        requests.push({
          method: req.method,
          path: url.pathname,
          reasonHeader: req.headers.get('x-platform-reason'),
          body,
        });

        const handler = routes[`${req.method} ${url.pathname}`];
        if (handler) return handler();

        // Mirrors the API's app.notFound shape for unmounted surfaces.
        return Response.json(
          { error: { code: 'NOT_FOUND', message: `Endpoint not found: ${req.method} ${url.pathname}` } },
          { status: 404 },
        );
      },
    });
    client = createOmniClient({ baseUrl: `http://localhost:${server.port}`, apiKey: 'test-key' });
  });

  beforeEach(() => {
    requests.length = 0;
  });

  afterAll(() => {
    server.stop(true);
  });

  function lastRequest(): RecordedRequest {
    expect(requests.length).toBe(1);
    return requests[0];
  }

  // ── Reads: reason travels as the x-platform-reason header ────────────────

  test('tenants.list → GET /platform/tenants with reason header', async () => {
    const result = await client.platform.tenants.list('quarterly audit');
    expect(result.items).toHaveLength(1);
    const req = lastRequest();
    expect(req.method).toBe('GET');
    expect(req.path).toBe('/api/v2/platform/tenants');
    expect(req.reasonHeader).toBe('quarterly audit');
    expect(req.body).toBeNull();
  });

  test('tenants.get → GET /platform/tenants/:id with reason header', async () => {
    const result = await client.platform.tenants.get(TENANT_ID, 'support ticket 42');
    expect(result.id).toBe(TENANT_ID);
    const req = lastRequest();
    expect(req.method).toBe('GET');
    expect(req.path).toBe(`/api/v2/platform/tenants/${TENANT_ID}`);
    expect(req.reasonHeader).toBe('support ticket 42');
  });

  test('memberships.list → GET /platform/tenants/:id/memberships with reason header', async () => {
    const result = await client.platform.tenants.memberships.list(TENANT_ID, 'access review');
    expect(result.items).toHaveLength(1);
    const req = lastRequest();
    expect(req.method).toBe('GET');
    expect(req.path).toBe(`/api/v2/platform/tenants/${TENANT_ID}/memberships`);
    expect(req.reasonHeader).toBe('access review');
  });

  // ── Mutations: reason travels in the JSON body ───────────────────────────

  test('tenants.create → POST /platform/tenants with reason in body', async () => {
    await client.platform.tenants.create({
      slug: 'acme',
      displayName: 'Acme Corp',
      maxKeyTtlSeconds: 3600,
      maxKeyRateLimit: 100,
      maxKeyBudget: 1000,
      reason: 'onboarding request OPS-1421',
    });
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/api/v2/platform/tenants');
    expect(req.reasonHeader).toBeNull();
    expect(req.body).toEqual({
      slug: 'acme',
      displayName: 'Acme Corp',
      maxKeyTtlSeconds: 3600,
      maxKeyRateLimit: 100,
      maxKeyBudget: 1000,
      reason: 'onboarding request OPS-1421',
    });
  });

  test('tenants.suspend → POST /platform/tenants/:id/suspend with reason in body', async () => {
    await client.platform.tenants.suspend(TENANT_ID, 'billing overdue');
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.path).toBe(`/api/v2/platform/tenants/${TENANT_ID}/suspend`);
    expect(req.reasonHeader).toBeNull();
    expect(req.body).toEqual({ reason: 'billing overdue' });
  });

  test('tenants.archive → POST /platform/tenants/:id/archive with reason in body', async () => {
    await client.platform.tenants.archive(TENANT_ID, 'contract ended');
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.path).toBe(`/api/v2/platform/tenants/${TENANT_ID}/archive`);
    expect(req.body).toEqual({ reason: 'contract ended' });
  });

  test('memberships.attach → POST /platform/tenants/:id/memberships with reason in body', async () => {
    await client.platform.tenants.memberships.attach(TENANT_ID, {
      principalId: PRINCIPAL_ID,
      role: 'tenant-operator',
      reason: 'new hire',
    });
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.path).toBe(`/api/v2/platform/tenants/${TENANT_ID}/memberships`);
    expect(req.reasonHeader).toBeNull();
    expect(req.body).toEqual({ principalId: PRINCIPAL_ID, role: 'tenant-operator', reason: 'new hire' });
  });

  test('memberships.disable → POST .../memberships/:id/disable with reason in body', async () => {
    await client.platform.tenants.memberships.disable(TENANT_ID, MEMBERSHIP_ID, 'offboarding');
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.path).toBe(`/api/v2/platform/tenants/${TENANT_ID}/memberships/${MEMBERSHIP_ID}/disable`);
    expect(req.body).toEqual({ reason: 'offboarding' });
  });

  test('memberships.setStatus → POST .../memberships/:id/status with status + reason in body', async () => {
    await client.platform.tenants.memberships.setStatus(TENANT_ID, MEMBERSHIP_ID, 'disabled', 'security hold');
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.path).toBe(`/api/v2/platform/tenants/${TENANT_ID}/memberships/${MEMBERSHIP_ID}/status`);
    expect(req.body).toEqual({ status: 'disabled', reason: 'security hold' });
  });

  test('memberships.setRole → POST .../memberships/:id/role with role + reason in body', async () => {
    await client.platform.tenants.memberships.setRole(TENANT_ID, MEMBERSHIP_ID, 'tenant-admin', 'promotion');
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.path).toBe(`/api/v2/platform/tenants/${TENANT_ID}/memberships/${MEMBERSHIP_ID}/role`);
    expect(req.body).toEqual({ role: 'tenant-admin', reason: 'promotion' });
  });

  test('tenants.keys.issueRoot → POST /platform/tenants/:id/keys/root with reason in body', async () => {
    const expiresAt = rootKey.expiresAt;
    const result = await client.platform.tenants.keys.issueRoot(TENANT_ID, {
      principalId: PRINCIPAL_ID,
      membershipId: MEMBERSHIP_ID,
      role: 'tenant-owner',
      name: 'acme-root',
      scopes: ['messages:send'],
      expiresAt,
      rateLimit: 60,
      budget: 500,
      resourceConstraints: { instanceAllowlist: ['instance-1'] },
      reason: 'bootstrap tenant OPS-1421',
    });
    // The one-shot plaintext comes back to the caller untouched.
    expect(result.plainTextKey).toBe('omni_root_plaintext_only_once');
    expect(result.id).toBe(rootKey.id);
    const req = lastRequest();
    expect(req.method).toBe('POST');
    expect(req.path).toBe(`/api/v2/platform/tenants/${TENANT_ID}/keys/root`);
    expect(req.reasonHeader).toBeNull();
    expect(req.body).toEqual({
      principalId: PRINCIPAL_ID,
      membershipId: MEMBERSHIP_ID,
      role: 'tenant-owner',
      name: 'acme-root',
      scopes: ['messages:send'],
      expiresAt,
      rateLimit: 60,
      budget: 500,
      resourceConstraints: { instanceAllowlist: ['instance-1'] },
      reason: 'bootstrap tenant OPS-1421',
    });
  });

  test('tenants.keys.issueRoot omits resourceConstraints from the body when not given', async () => {
    await client.platform.tenants.keys.issueRoot(TENANT_ID, {
      principalId: PRINCIPAL_ID,
      membershipId: MEMBERSHIP_ID,
      role: 'tenant-owner',
      name: 'acme-root',
      scopes: ['messages:send'],
      expiresAt: rootKey.expiresAt,
      rateLimit: 60,
      budget: 500,
      reason: 'bootstrap tenant OPS-1421',
    });
    const req = lastRequest();
    expect(req.body).not.toBeNull();
    expect(Object.keys(req.body ?? {})).not.toContain('resourceConstraints');
  });

  // ── Errors surface as OmniApiError with the server's message ─────────────

  test('an unmounted control plane surfaces as OmniApiError 404 with the endpoint message', async () => {
    const promise = client.platform.tenants.get('99999999-9999-4999-8999-999999999999', 'check');
    const err = (await promise.catch((e: unknown) => e)) as OmniApiError;
    expect(err).toBeInstanceOf(OmniApiError);
    expect(err.status).toBe(404);
    expect(err.message).toStartWith('Endpoint not found:');
  });
});
