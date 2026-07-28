/**
 * Agent-key auto-provisioning across tenants
 * (wish: omni-full-multitenancy, Group G4).
 *
 * THE COLLISION
 * -------------
 * Assigning an agent to an instance auto-provisions a scoped API key addressed
 * by NAME, and finds it again with `ApiKeyService.findByName` — a name-only
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
}

interface Harness {
  app: Hono<{ Variables: AppVariables }>;
  keys: ExistingKey[];
  lookups: string[];
  created: { name: string; instanceIds: string[] }[];
  updated: { id: string; instanceIds: string[] | null }[];
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
}): Harness {
  const keys: ExistingKey[] = options.existingKeys ?? [];
  const lookups: string[] = [];
  const created: { name: string; instanceIds: string[] }[] = [];
  const updated: { id: string; instanceIds: string[] | null }[] = [];
  const agentName = options.agentName ?? SHARED_AGENT_NAME;

  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    if (options.authContext) c.set('authContext', options.authContext);
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, agentId: null, agentReplyFilter: null })),
        update: mock(async (id: string) => ({ id, channel: 'whatsapp-baileys' })),
      },
      agents: {
        getById: mock(async (id: string) => ({ id, name: agentName, metadata: null })),
      },
      apiKeys: {
        findByName: mock(async (name: string) => {
          lookups.push(name);
          return keys.find((k) => k.name === name) ?? null;
        }),
        update: mock(async (id: string, patch: { instanceIds: string[] | null }) => {
          updated.push({ id, instanceIds: patch.instanceIds });
          const row = keys.find((k) => k.id === id);
          if (row) row.instanceIds = patch.instanceIds;
          return row;
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

  return { app, keys, lookups, created, updated };
}

function assignAgent(h: Harness, instanceId: string, agentId: string): Promise<Response> {
  return h.app.request(`/instances/${instanceId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId }),
  }) as Promise<Response>;
}

describe('agent key provisioning is tenant-scoped', () => {
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

  test('a legacy request still finds and extends a pre-existing bare-named key', async () => {
    // The upgrade case: keys provisioned before this change must keep working
    // on a deployment that never turns multitenancy on.
    const existing: ExistingKey = { id: 'k_old', name: `agent:${SHARED_AGENT_NAME}`, instanceIds: [INSTANCE_A] };
    const h = harness({ existingKeys: [existing] });

    await assignAgent(h, INSTANCE_B, AGENT_A);

    expect(h.created).toEqual([]);
    expect(h.updated).toEqual([{ id: 'k_old', instanceIds: [INSTANCE_A, INSTANCE_B] }]);
  });
});
