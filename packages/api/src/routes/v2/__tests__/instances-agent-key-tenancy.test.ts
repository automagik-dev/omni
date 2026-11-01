/**
 * Agent-key auto-provisioning across tenants
 * (wish: omni-full-multitenancy, Group G4).
 *
 * THE COLLISION
 * -------------
 * Assigning an agent to an instance auto-provisions a scoped API key addressed
 * by NAME, and finds it again with `ApiKeyService.findAgentKeyByName` — an active system-key
 * predicate over `api_keys`, a legacy table with no `tenant_id` column and no
 * RLS. The name was `agent:<agentName>`, a single global namespace.
 *
 * So two tenants that each name an agent `support` addressed ONE row. Tenant B
 * assigning its agent found tenant A's key and appended B's instanceId to it:
 * a credential A holds, rotates, and can read messages with silently acquired
 * reach into B's instance. No layer below caught it, because there is no tenant
 * boundary on `api_keys` to catch it with.
 *
 * WHAT THESE TESTS FIX IN PLACE
 * -----------------------------
 * The behaviour, not the helper: each test drives the real `PATCH
 * /instances/:id` route and asserts on the service calls it makes, so a future
 * refactor that reintroduces a bare-name lookup fails here even if
 * `agentKeyName` still exists and still passes its own unit tests.
 *
 * The legacy case is asserted just as hard as the tenant case. The key name is
 * the lookup key for every agent key already provisioned on every existing
 * deployment; a request with no tenant context must still produce exactly
 * `agent:<name>`, or an upgrade orphans them all.
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { type TenantAuthContext, freezeContext } from '../../../tenancy/auth-context';
import type { AppVariables } from '../../../types';
import { instancesRoutes } from '../instances';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INSTANCE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTANCE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AGENT_A = 'a0000000-0000-4000-8000-000000000001';
const AGENT_B = 'b0000000-0000-4000-8000-000000000002';

/** Both tenants named their agent the same thing. That is the whole setup. */
const SHARED_AGENT_NAME = 'support';

interface ExistingKey {
  id: string;
  name: string;
  instanceIds: string[] | null;
  status?: 'active' | 'revoked';
}

interface Harness {
  app: Hono<{ Variables: AppVariables }>;
  keys: ExistingKey[];
  lookups: string[];
  created: { name: string; instanceIds: string[] }[];
  updated: { id: string; instanceIds: string[] | null }[];
  revoked: string[];
}

function tenantContext(tenantId: string): TenantAuthContext {
  return freezeContext({
    credentialClass: 'tenant',
    requestId: 'req-1',
    principalId: 'p-1',
    credentialId: 'c-1',
    tenantId,
    tenantSlug: 'slug',
    actorRole: 'tenant-admin',
    scopes: ['tenant:*'],
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

/**
 * `authContext` undefined models a LEGACY request — no tenant context at all,
 * which is what every request on a flag-off deployment is.
 */
function harness(options: {
  authContext?: TenantAuthContext;
  existingKeys?: ExistingKey[];
  agentName?: string;
  agentNames?: Record<string, string>;
  agentAssignments?: [string, string][];
  instanceTenantId?: string | null;
  instanceTenants?: Record<string, string | null>;
  revokeFails?: boolean;
  routedAgents?: Record<string, string[]>;
}): Harness {
  const keys: ExistingKey[] = options.existingKeys ?? [];
  const lookups: string[] = [];
  const created: { name: string; instanceIds: string[] }[] = [];
  const updated: { id: string; instanceIds: string[] | null }[] = [];
  const agentName = options.agentName ?? SHARED_AGENT_NAME;
  const assignments = new Map(options.agentAssignments);
  const revoked: string[] = [];
  const tenantId =
    options.instanceTenantId !== undefined ? options.instanceTenantId : (options.authContext?.tenantId ?? null);

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    if (options.authContext) c.set('authContext', options.authContext);
    c.set('services', {
      routes: { list: mock(async (id: string) => (options.routedAgents?.[id] ?? []).map((agentId) => ({ agentId }))) },
      instances: {
        create: mock(async (data: { agentId?: string }) => {
          if (data.agentId) assignments.set(INSTANCE_B, data.agentId);
          return { ...data, id: INSTANCE_B, tenantId };
        }),
        getById: mock(async (id: string) => ({
          id,
          agentId: assignments.get(id) ?? null,
          agentReplyFilter: null,
          tenantId: options.instanceTenants?.[id] ?? tenantId,
        })),
        update: mock(async (id: string, patch: { agentId?: string | null }) => {
          if (patch.agentId === null) assignments.delete(id);
          else if (patch.agentId !== undefined) assignments.set(id, patch.agentId);
          return { id, channel: 'whatsapp-baileys', tenantId };
        }),
      },
      agents: {
        getById: mock(async (id: string) => ({ id, name: options.agentNames?.[id] ?? agentName, metadata: null })),
      },
      apiKeys: {
        findAgentKeyByName: mock(async (name: string) => {
          lookups.push(name);
          return keys.find((k) => k.name === name && k.status !== 'revoked') ?? null;
        }),
        findAgentKeysByNames: mock(async (names: string[]) => {
          lookups.push(...names);
          return keys.filter((key) => names.includes(key.name) && key.status !== 'revoked');
        }),
        update: mock(async (id: string, patch: { instanceIds: string[] | null }) => {
          updated.push({ id, instanceIds: patch.instanceIds });
          const row = keys.find((k) => k.id === id);
          if (row) row.instanceIds = patch.instanceIds;
          return row;
        }),
        revoke: mock(async (id: string) => {
          if (options.revokeFails) throw new Error('revoke failed');
          revoked.push(id);
          const row = keys.find((key) => key.id === id);
          if (row) row.status = 'revoked';
          return row ?? null;
        }),
        create: mock(async (opts: { name: string; instanceIds: string[] }) => {
          created.push({ name: opts.name, instanceIds: opts.instanceIds });
          keys.push({ id: `k_${keys.length + 1}`, name: opts.name, instanceIds: opts.instanceIds });
          return { key: { id: `k_${keys.length}` } };
        }),
      },
    } as never);
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/instances', instancesRoutes);

  return { app, keys, lookups, created, updated, revoked };
}

function assignAgent(h: Harness, instanceId: string, agentId: string | null): Promise<Response> {
  return h.app.request(`/instances/${instanceId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId }),
  }) as Promise<Response>;
}

describe('agent key provisioning is tenant-scoped', () => {
  test('unbinding retains the key while a route on the instance still names the old agent', async () => {
    const key: ExistingKey = {
      id: 'routed',
      name: `agent:${TENANT_A}:${SHARED_AGENT_NAME}`,
      instanceIds: [INSTANCE_A],
    };
    const h = harness({
      authContext: tenantContext(TENANT_A),
      existingKeys: [key],
      agentAssignments: [[INSTANCE_A, AGENT_A]],
      routedAgents: { [INSTANCE_A]: [AGENT_A] },
    });
    expect((await assignAgent(h, INSTANCE_A, null)).status).toBe(200);
    expect(h.revoked).toEqual([]);
    expect(h.updated).toEqual([]);
    expect(key.instanceIds).toEqual([INSTANCE_A]);
  });

  test("tenant B naming an agent like tenant A's does not touch tenant A's key", async () => {
    // Tenant A is already provisioned, under A's qualified name.
    const aKey: ExistingKey = {
      id: 'k_a',
      name: `agent:${TENANT_A}:${SHARED_AGENT_NAME}`,
      instanceIds: [INSTANCE_A],
    };
    const h = harness({ authContext: tenantContext(TENANT_B), existingKeys: [aKey] });

    const res = await assignAgent(h, INSTANCE_B, AGENT_B);
    expect(res.status).toBe(200);

    // B looked up its OWN name and found nothing, so it minted its own key.
    expect(h.lookups).toEqual([`agent:${TENANT_B}:${SHARED_AGENT_NAME}`]);
    expect(h.created).toEqual([{ name: `agent:${TENANT_B}:${SHARED_AGENT_NAME}`, instanceIds: [INSTANCE_B] }]);

    // The bug, stated as an assertion: A's key is untouched and never acquired
    // B's instance.
    expect(h.updated).toEqual([]);
    expect(aKey.instanceIds).toEqual([INSTANCE_A]);
  });

  test('tenant B cannot graft onto a bare-named key either', async () => {
    // The pre-qualification world: A's key still carries the legacy bare name.
    // B must not find it — a legacy row is not B's to extend.
    const legacyKey: ExistingKey = { id: 'k_legacy', name: `agent:${SHARED_AGENT_NAME}`, instanceIds: [INSTANCE_A] };
    const h = harness({ authContext: tenantContext(TENANT_B), existingKeys: [legacyKey] });

    await assignAgent(h, INSTANCE_B, AGENT_B);

    expect(h.lookups).not.toContain(`agent:${SHARED_AGENT_NAME}`);
    expect(legacyKey.instanceIds).toEqual([INSTANCE_A]);
    expect(h.created).toEqual([{ name: `agent:${TENANT_B}:${SHARED_AGENT_NAME}`, instanceIds: [INSTANCE_B] }]);
  });

  test('a tenant extends its own key across its own instances, as before', async () => {
    const ownKey: ExistingKey = {
      id: 'k_a',
      name: `agent:${TENANT_A}:${SHARED_AGENT_NAME}`,
      instanceIds: [INSTANCE_A],
    };
    const h = harness({ authContext: tenantContext(TENANT_A), existingKeys: [ownKey] });

    const second = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await assignAgent(h, second, AGENT_A);

    expect(h.created).toEqual([]);
    expect(h.updated).toEqual([{ id: 'k_a', instanceIds: [INSTANCE_A, second] }]);
  });
});

describe('legacy invariance', () => {
  test('a request with no tenant context uses the bare legacy name, unchanged', async () => {
    const h = harness({});
    await assignAgent(h, INSTANCE_A, AGENT_A);

    expect(h.lookups).toEqual([`agent:${SHARED_AGENT_NAME}`]);
    expect(h.created).toEqual([{ name: `agent:${SHARED_AGENT_NAME}`, instanceIds: [INSTANCE_A] }]);
  });

  for (const [label, agentId, tenantId] of [
    ['foreign tenant', AGENT_A, TENANT_A],
    ['other agent', AGENT_B, null],
    ['unbound', null, null],
  ] as const) {
    test(`no-tenant PATCH leaves a bare key with ${label} grants untouched`, async () => {
      const existing: ExistingKey = { id: 'ambiguous', name: `agent:${SHARED_AGENT_NAME}`, instanceIds: [INSTANCE_A] };
      const h = harness({
        existingKeys: [existing],
        instanceTenants: { [INSTANCE_A]: tenantId },
        agentAssignments: agentId ? [[INSTANCE_A, agentId]] : [],
      });
      expect((await assignAgent(h, INSTANCE_B, AGENT_A)).status).toBe(200);
      expect(h.updated).toEqual([]);
      expect(existing.instanceIds).toEqual([INSTANCE_A]);
      expect(h.created).toEqual([{ name: `agent:${SHARED_AGENT_NAME}`, instanceIds: [INSTANCE_B] }]);
    });
  }

  test('a legacy request still finds and extends a pre-existing bare-named key', async () => {
    // The upgrade case: keys provisioned before this change must keep working
    // on a deployment that never turns multitenancy on.
    const existing: ExistingKey = { id: 'k_old', name: `agent:${SHARED_AGENT_NAME}`, instanceIds: [INSTANCE_A] };
    const h = harness({ existingKeys: [existing], agentAssignments: [[INSTANCE_A, AGENT_A]] });

    await assignAgent(h, INSTANCE_B, AGENT_A);

    expect(h.created).toEqual([]);
    expect(h.updated).toEqual([{ id: 'k_old', instanceIds: [INSTANCE_A, INSTANCE_B] }]);
  });
});

for (const [label, context, keyName] of [
  ['legacy', undefined, `agent:${SHARED_AGENT_NAME}`],
  ['tenant', tenantContext(TENANT_A), `agent:${TENANT_A}:${SHARED_AGENT_NAME}`],
] as const) {
  describe(`${label} agent key removal never widens authority`, () => {
    test('POST with an agent provisions a new scoped key', async () => {
      const h = harness({ authContext: context });
      const res = await h.app.request('/instances', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'first', channel: 'whatsapp-baileys', agentId: AGENT_A }),
      });
      expect(res.status).toBe(201);
      expect(h.created).toEqual([{ name: keyName, instanceIds: [INSTANCE_B] }]);
    });

    test('POST binds a second instance before PATCH unbinds the first, preserving the second key grant', async () => {
      const key: ExistingKey = { id: 'old', name: keyName, instanceIds: [INSTANCE_A] };
      const h = harness({ authContext: context, existingKeys: [key], agentAssignments: [[INSTANCE_A, AGENT_A]] });
      const created = await h.app.request('/instances', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'second', channel: 'whatsapp-baileys', agentId: AGENT_A }),
      });
      expect(created.status).toBe(201);
      expect(key.instanceIds).toEqual([INSTANCE_A, INSTANCE_B]);
      expect((await assignAgent(h, INSTANCE_A, null)).status).toBe(200);
      expect(h.revoked).toEqual([]);
      expect(key.instanceIds).toEqual([INSTANCE_B]);
    });

    test('unbinding the last instance revokes the key without writing null or an empty list', async () => {
      const key: ExistingKey = { id: 'old', name: keyName, instanceIds: [INSTANCE_A] };
      const h = harness({ authContext: context, existingKeys: [key], agentAssignments: [[INSTANCE_A, AGENT_A]] });
      expect((await assignAgent(h, INSTANCE_A, null)).status).toBe(200);
      expect(h.revoked).toEqual(['old']);
      expect(h.updated).toEqual([]);
      expect(key.instanceIds).toEqual([INSTANCE_A]);
      expect(key.status).toBe('revoked');
    });

    test('reassignment removes only that instance from the old key and provisions the new agent', async () => {
      const key: ExistingKey = { id: 'old', name: keyName, instanceIds: [INSTANCE_A, INSTANCE_B] };
      const h = harness({
        authContext: context,
        existingKeys: [key],
        agentAssignments: [[INSTANCE_A, AGENT_A]],
        agentNames: { [AGENT_B]: 'replacement' },
      });
      expect((await assignAgent(h, INSTANCE_A, AGENT_B)).status).toBe(200);
      expect(h.revoked).toEqual([]);
      expect(h.updated).toEqual([{ id: 'old', instanceIds: [INSTANCE_B] }]);
      expect(h.created).toEqual([
        { name: keyName.replace(SHARED_AGENT_NAME, 'replacement'), instanceIds: [INSTANCE_A] },
      ]);
    });

    test('a later bind creates a fresh key and further binds extend that active key', async () => {
      const old: ExistingKey = { id: 'old', name: keyName, instanceIds: [INSTANCE_A] };
      const h = harness({ authContext: context, existingKeys: [old], agentAssignments: [[INSTANCE_A, AGENT_A]] });
      expect((await assignAgent(h, INSTANCE_A, null)).status).toBe(200);
      expect((await assignAgent(h, INSTANCE_A, AGENT_A)).status).toBe(200);
      expect(h.created).toEqual([{ name: keyName, instanceIds: [INSTANCE_A] }]);
      const fresh = h.keys.find((key) => key.id !== old.id);
      if (!fresh) throw new Error('fresh key was not provisioned');
      expect(fresh.id).not.toBe(old.id);
      expect(old.status).toBe('revoked');
      expect((await assignAgent(h, INSTANCE_B, AGENT_A)).status).toBe(200);
      expect(h.created).toHaveLength(1);
      expect(h.updated).toEqual([{ id: fresh.id, instanceIds: [INSTANCE_A, INSTANCE_B] }]);
      expect(old.instanceIds).toEqual([INSTANCE_A]);
    });
  });
}

for (const context of [undefined, tenantContext(TENANT_B)]) {
  test(`instance tenant controls bind and unbind naming for ${context ? 'foreign tenant' : 'legacy'} credentials`, async () => {
    const keyName = `agent:${TENANT_A}:${SHARED_AGENT_NAME}`;
    const h = harness({ authContext: context, instanceTenantId: TENANT_A });
    expect((await assignAgent(h, INSTANCE_A, AGENT_A)).status).toBe(200);
    expect(h.created).toEqual([{ name: keyName, instanceIds: [INSTANCE_A] }]);
    expect((await assignAgent(h, INSTANCE_A, null)).status).toBe(200);
    expect(h.lookups).toEqual([keyName, keyName, `agent:${SHARED_AGENT_NAME}`]);
    expect(h.revoked).toEqual(['k_1']);
  });
}

test('a failed revoke remains best effort and the PATCH returns 200', async () => {
  const key: ExistingKey = {
    id: 'old',
    name: `agent:${SHARED_AGENT_NAME}`,
    instanceIds: [INSTANCE_A],
    status: 'active',
  };
  const h = harness({ existingKeys: [key], agentAssignments: [[INSTANCE_A, AGENT_A]], revokeFails: true });
  expect((await assignAgent(h, INSTANCE_A, null)).status).toBe(200);
  expect(key.status).toBe('active');
  expect(key.instanceIds).toEqual([INSTANCE_A]);
});

test('unbind removes the instance from every canonical and legacy system key that lists it', async () => {
  const qualified = `agent:${TENANT_A}:${SHARED_AGENT_NAME}`;
  const bare = `agent:${SHARED_AGENT_NAME}`;
  const keys: ExistingKey[] = [
    { id: 'qualified', name: qualified, instanceIds: [INSTANCE_A] },
    { id: 'legacy', name: bare, instanceIds: [INSTANCE_A, INSTANCE_B] },
    { id: 'duplicate', name: bare, instanceIds: [INSTANCE_A] },
    { id: 'unrelated', name: bare, instanceIds: [INSTANCE_B] },
    { id: 'widened', name: bare, instanceIds: null },
  ];
  const h = harness({ instanceTenantId: TENANT_A, existingKeys: keys, agentAssignments: [[INSTANCE_A, AGENT_A]] });
  expect((await assignAgent(h, INSTANCE_A, null)).status).toBe(200);
  expect(h.revoked).toEqual(['qualified', 'duplicate']);
  expect(h.updated).toEqual([{ id: 'legacy', instanceIds: [INSTANCE_B] }]);
  expect(keys[3]?.instanceIds).toEqual([INSTANCE_B]);
  expect(keys[4]?.instanceIds).toBeNull();
});
