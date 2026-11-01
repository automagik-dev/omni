/**
 * Connector routes: connect behaviour, tenancy and the instance-key refusal
 * (design §5; verification finding F2).
 *
 * These tests drive the REAL route module, the REAL Zod schemas and the REAL
 * `ConnectorService` over an in-memory database that applies the WHERE clause
 * the service builds (`connector-test-harness.ts`). The only fake is the ClickUp
 * transport: `GET /team` answers from a table, so no network is touched.
 *
 * Pinned here:
 *   * a valid token connects (`status=connected`, `lastValidatedAt` set);
 *   * an invalid token stores an `error` row with a readable, token-free message;
 *   * tenant B cannot list, read, update or delete tenant A's connector (404,
 *     never an existence oracle);
 *   * an instance-restricted API key is refused on every connector route;
 *   * no response — create, list or problem — contains the credential.
 */

import { describe, expect, test } from 'bun:test';
import { clickupManifest } from '@omni/connector-clickup';
import { type ConnectorManifest, ConnectorRegistry } from '@omni/connector-sdk';
import { AgentEventManifestSchema } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { connectorTenantContext, createConnectorTestDb } from '../../../__tests__/connector-test-harness';
import { errorHandler } from '../../../middleware/error';
import { SubscriptionResponseSchema } from '../../../schemas/connectors';
import { ConnectorService } from '../../../services/connectors';
import { runInTenantScope } from '../../../tenancy/tenant-scope';
import type { AppVariables } from '../../../types';
import { connectorRoutes } from '../connectors';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INSTANCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN = 'pk_route_test_token_1234567890';
const SECRET = 'clickup-route-test-webhook-secret';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

interface ClickUpFake {
  fetch: typeof fetch;
  calls: string[];
}

function clickupFetch(options: { valid: boolean; errorText?: string }): ClickUpFake {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    if (!url.endsWith('/team')) return json({ err: 'unexpected URL' }, 404);
    if (options.valid) return json({ teams: [{ id: 'team-1', name: 'Acme' }] });
    return json({ err: options.errorText ?? 'invalid token', ECODE: 'OAUTH_025' }, 401);
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

interface MountOptions {
  db: ReturnType<typeof createConnectorTestDb>['db'];
  tenantId?: string;
  instanceIds?: string[] | null;
  fetchImpl: typeof fetch;
  registry?: ConnectorRegistry;
}

function mount(opts: MountOptions) {
  const service = new ConnectorService(opts.db, null, opts.registry ?? new ConnectorRegistry([clickupManifest]), {
    fetch: opts.fetchImpl,
  });
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('apiKey', {
      id: 'key-1',
      name: 'route-test',
      scopes: ['*'],
      instanceIds: opts.instanceIds ?? null,
      expiresAt: null,
    } as never);
    c.set('services', { connectors: service, db: opts.db } as never);
    if (opts.tenantId) {
      await runInTenantScope(opts.db, connectorTenantContext(opts.tenantId), async () => {
        await next();
      });
      return;
    }
    await next();
  });
  app.route('/connectors', connectorRoutes);
  return app;
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'clickup',
    name: 'Acme ClickUp',
    credentials: { token: TOKEN },
    config: {},
    ...overrides,
  };
}

function postConnector(app: Hono<{ Variables: AppVariables }>, body: Record<string, unknown> = createBody()) {
  return app.request('/connectors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /connectors — connect behaviour', () => {
  test('a valid token validates against GET /team and reports connected', async () => {
    const { db, tables } = createConnectorTestDb();
    const clickup = clickupFetch({ valid: true });
    const app = mount({ db, tenantId: TENANT_A, fetchImpl: clickup.fetch });

    const res = await postConnector(app);
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      data: Record<string, unknown>;
    };
    expect(body.data).toMatchObject({
      provider: 'clickup',
      name: 'Acme ClickUp',
      status: 'connected',
      hasCredentials: true,
      lastError: null,
      lastErrorCode: null,
      config: {},
    });
    expect(body.data.lastValidatedAt).toBeTruthy();
    // The credential is write-only: not in the object, not in its JSON.
    expect(body.data).not.toHaveProperty('credentials');
    expect(JSON.stringify(body)).not.toContain(TOKEN);

    // The transport was asked to validate exactly once.
    expect(clickup.calls).toHaveLength(1);
    expect(clickup.calls[0]).toContain('/team');
    // The row is owned by the active tenant.
    expect(tables.connectors).toHaveLength(1);
    expect(tables.connectors[0]?.tenantId).toBe(TENANT_A);
  });

  test('an invalid token leaves an error row with a readable, token-free message', async () => {
    const { db, tables } = createConnectorTestDb();
    const clickup = clickupFetch({ valid: false, errorText: `this token is invalid: ${TOKEN}` });
    const app = mount({ db, tenantId: TENANT_A, fetchImpl: clickup.fetch });

    const res = await postConnector(app);
    // A provider rejection is not a 500: the row exists and reports `error`.
    expect(res.status).toBe(201);

    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({ status: 'error', lastErrorCode: 'AUTH_FAILED', lastValidatedAt: null });
    expect(String(body.data.lastError)).toContain('401');
    expect(String(body.data.lastError)).not.toContain(TOKEN);
    expect(body.data.hasCredentials).toBe(true);
    expect(JSON.stringify(body)).not.toContain(TOKEN);

    expect(tables.connectors).toHaveLength(1);
    expect(tables.connectors[0]?.status).toBe('error');
  });
});

describe('GET/PATCH/DELETE /connectors/:id — tenant containment', () => {
  test("tenant B cannot list, read, update or delete tenant A's connector", async () => {
    const { db, tables } = createConnectorTestDb();
    const clickup = clickupFetch({ valid: true });

    const tenantA = mount({ db, tenantId: TENANT_A, fetchImpl: clickup.fetch });
    const created = (await (await postConnector(tenantA)).json()) as { data: { id: string } };
    const connectorId = created.data.id;

    const tenantB = mount({ db, tenantId: TENANT_B, fetchImpl: clickup.fetch });

    const list = await tenantB.request('/connectors');
    expect(list.status).toBe(200);
    expect(((await list.json()) as { data: unknown[] }).data).toEqual([]);

    for (const [method, path, body] of [
      ['GET', `/connectors/${connectorId}`, undefined],
      ['PATCH', `/connectors/${connectorId}`, { name: 'stolen' }],
      ['DELETE', `/connectors/${connectorId}`, undefined],
    ] as const) {
      const res = await tenantB.request(path, {
        method,
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      // Cross-tenant is 404, not 403: an id from another tenant must not be an
      // existence oracle.
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    }

    // B's failed mutations left A's row intact.
    expect(tables.connectors).toHaveLength(1);
    expect(tables.connectors[0]?.name).toBe('Acme ClickUp');

    // The owner still reads it.
    const owned = await tenantA.request(`/connectors/${connectorId}`);
    expect(owned.status).toBe(200);
    expect(((await owned.json()) as { data: { id: string } }).data.id).toBe(connectorId);
  });
});

describe('instance-restricted API keys are refused', () => {
  test('every connector route returns 403 CONNECTORS_TENANT_SCOPED and writes nothing', async () => {
    const { db, tables } = createConnectorTestDb();
    const clickup = clickupFetch({ valid: true });
    const app = mount({ db, tenantId: TENANT_A, instanceIds: [INSTANCE_ID], fetchImpl: clickup.fetch });

    for (const path of ['/connectors', '/connectors/providers']) {
      const res = await app.request(path);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CONNECTORS_TENANT_SCOPED');
    }

    const create = await postConnector(app);
    expect(create.status).toBe(403);
    expect(tables.connectors).toHaveLength(0);
    // Refused before the provider is ever contacted.
    expect(clickup.calls).toHaveLength(0);
  });
});

describe('responses never carry the credential', () => {
  test('list and get expose hasCredentials but never the token or a credential field', async () => {
    const { db } = createConnectorTestDb();
    const clickup = clickupFetch({ valid: true });
    const app = mount({ db, tenantId: TENANT_A, fetchImpl: clickup.fetch });

    const created = (await (await postConnector(app)).json()) as { data: { id: string } };
    const id = created.data.id;

    const list = (await (await app.request('/connectors')).json()) as { data: Array<Record<string, unknown>> };
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).not.toHaveProperty('credentials');
    expect(list.data[0]).not.toHaveProperty('verificationSecret');
    expect(list.data[0]?.hasCredentials).toBe(true);
    expect(JSON.stringify(list)).not.toContain(TOKEN);

    const one = (await (await app.request(`/connectors/${id}`)).json()) as { data: Record<string, unknown> };
    expect(one.data).not.toHaveProperty('credentials');
    expect(JSON.stringify(one)).not.toContain(TOKEN);

    // A subscription response is the other write-only-secret surface.
    // No automation is seeded, so this is the validation error path; the secret
    // supplied in the request must not be echoed by the problem response.
    const subscription = await app.request(`/connectors/${id}/subscriptions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventKey: 'taskStatusUpdated',
        targetAutomationId: '33333333-3333-4333-8333-333333333333',
        verificationSecret: SECRET,
      }),
    });
    expect(subscription.status).toBe(400);
    const problem = await subscription.text();
    expect(problem).not.toContain(SECRET);
    expect(problem).not.toContain(TOKEN);
  });
});

const TYPED_EVENT = 'connector.fixture-provider.item.created';
const OTHER_EVENT = 'connector.fixture-provider.item.deleted';
const GLOB = 'connector.fixture-provider.*';
const TYPED_TARGET = '33333333-3333-4333-8333-333333333333';
const LEGACY_TARGET = '44444444-4444-4444-8444-444444444444';
const OTHER_TARGET = '55555555-5555-4555-8555-555555555555';

const eventsOnlyManifest: ConnectorManifest = {
  id: 'fixture-provider',
  label: 'Fixture provider',
  version: '1',
  credentialFields: [{ key: 'token', label: 'Optional token', secret: true, optional: true }],
  configSchema: z.object({}),
  async validate() {
    return { ok: true };
  },
  events: [{ key: 'item.created', label: 'Item created' }],
  actions: [],
  verification: { kind: 'hmac-sha256', header: 'X-Signature', encoding: 'hex' },
  guide: {},
};

function requestBody(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

async function managementFixture() {
  const { db, tables } = createConnectorTestDb({
    automations: [
      { id: TYPED_TARGET, triggerEventType: TYPED_EVENT, tenantId: TENANT_A },
      { id: LEGACY_TARGET, triggerEventType: 'connector.event', tenantId: TENANT_A },
      { id: OTHER_TARGET, triggerEventType: OTHER_EVENT, tenantId: TENANT_A },
    ],
  });
  const app = mount({
    db,
    tenantId: TENANT_A,
    fetchImpl: fetch,
    registry: new ConnectorRegistry([eventsOnlyManifest]),
  });
  const res = await postConnector(app, { provider: eventsOnlyManifest.id, name: 'Events only', credentials: {} });
  expect(res.status).toBe(201);
  const connector = z.object({ data: z.object({ id: z.string().uuid() }) }).parse(await res.json());
  return { app, tables, path: `/connectors/${connector.data.id}/subscriptions` };
}

async function problemMessage(res: Response): Promise<string> {
  expect(res.status).toBe(400);
  return z.object({ error: z.object({ message: z.string() }) }).parse(await res.json()).error.message;
}

describe('connector ingress subscription management', () => {
  test('target-less globs are accepted with a nullable target and no subscription secret', async () => {
    const { app, tables, path } = await managementFixture();
    const res = await app.request(
      path,
      requestBody('POST', { ingress: 'connector', eventKey: GLOB, filters: { project: 7 } }),
    );
    expect(res.status).toBe(201);
    const { data } = SubscriptionResponseSchema.parse(await res.json());
    expect(data).toMatchObject({
      ingress: 'connector',
      providerEventKey: GLOB,
      targetAutomationId: null,
      filters: { project: 7 },
    });
    expect(data.inboundUrl).toBe(`/api/v2/connectors/hooks/${data.connectorId}`);
    expect(data).not.toHaveProperty('verificationSecret');
    expect(tables.connector_event_subscriptions[0]?.verificationSecret).toBeNull();
    expect(tables.omni_events).toHaveLength(0);
  });

  test('targeted glob creation refuses with the subscription key and automation trigger', async () => {
    const { app, tables, path } = await managementFixture();
    const message = await problemMessage(
      await app.request(
        path,
        requestBody('POST', {
          ingress: 'connector',
          eventKey: GLOB,
          targetAutomationId: TYPED_TARGET,
        }),
      ),
    );
    expect(message).toContain(GLOB);
    expect(message).toContain(TYPED_EVENT);
    expect(tables.connector_event_subscriptions).toHaveLength(0);
  });

  test('create refuses legacy and other typed triggers naming the required and actual types', async () => {
    const { app, tables, path } = await managementFixture();
    for (const target of [
      { id: LEGACY_TARGET, type: 'connector.event' },
      { id: OTHER_TARGET, type: OTHER_EVENT },
    ]) {
      const message = await problemMessage(
        await app.request(
          path,
          requestBody('POST', {
            ingress: 'connector',
            eventKey: TYPED_EVENT,
            targetAutomationId: target.id,
          }),
        ),
      );
      expect(message).toContain(TYPED_EVENT);
      expect(message).toContain(target.type);
    }
    expect(tables.connector_event_subscriptions).toHaveLength(0);
  });

  test('exact typed targets create and PATCH, while mismatched PATCH targets are refused with both types', async () => {
    const { app, tables, path } = await managementFixture();
    const created = await app.request(
      path,
      requestBody('POST', {
        ingress: 'connector',
        eventKey: TYPED_EVENT,
        targetAutomationId: TYPED_TARGET,
      }),
    );
    expect(created.status).toBe(201);
    const { data } = SubscriptionResponseSchema.parse(await created.json());
    expect(data.targetAutomationId).toBe(TYPED_TARGET);
    for (const target of [
      { id: LEGACY_TARGET, type: 'connector.event' },
      { id: OTHER_TARGET, type: OTHER_EVENT },
    ]) {
      const message = await problemMessage(
        await app.request(`${path}/${data.id}`, requestBody('PATCH', { targetAutomationId: target.id })),
      );
      expect(message).toContain(TYPED_EVENT);
      expect(message).toContain(target.type);
      expect(tables.connector_event_subscriptions[0]?.targetAutomationId).toBe(TYPED_TARGET);
    }
    const patched = await app.request(
      `${path}/${data.id}`,
      requestBody('PATCH', { status: 'paused', targetAutomationId: TYPED_TARGET }),
    );
    expect(patched.status).toBe(200);
    expect(SubscriptionResponseSchema.parse(await patched.json()).data.status).toBe('paused');
  });

  test('PATCH refuses a target on a glob, secrets, and changes to ingress without writing', async () => {
    const { app, tables, path } = await managementFixture();
    const created = await app.request(path, requestBody('POST', { ingress: 'connector', eventKey: GLOB }));
    const { data } = SubscriptionResponseSchema.parse(await created.json());
    const message = await problemMessage(
      await app.request(`${path}/${data.id}`, requestBody('PATCH', { targetAutomationId: TYPED_TARGET })),
    );
    expect(message).toContain(GLOB);
    expect(message).toContain(TYPED_EVENT);
    for (const patch of [{ verificationSecret: SECRET }, { ingress: 'subscription', status: 'paused' }]) {
      await problemMessage(await app.request(`${path}/${data.id}`, requestBody('PATCH', patch)));
      expect(tables.connector_event_subscriptions[0]).toMatchObject({
        ingress: 'connector',
        targetAutomationId: null,
        status: 'active',
        verificationSecret: null,
      });
    }
  });

  test('PATCH revalidates a persisted target even when only filters change', async () => {
    const { app, tables, path } = await managementFixture();
    const created = await app.request(
      path,
      requestBody('POST', { ingress: 'connector', eventKey: TYPED_EVENT, targetAutomationId: TYPED_TARGET }),
    );
    const { data } = SubscriptionResponseSchema.parse(await created.json());
    const target = tables.automations.find((row) => row.id === TYPED_TARGET);
    if (!target) throw new Error('missing automation fixture');
    target.triggerEventType = 'connector.event';
    const message = await problemMessage(
      await app.request(`${path}/${data.id}`, requestBody('PATCH', { filters: { project: 1 } })),
    );
    expect(message).toContain(TYPED_EVENT);
    expect(message).toContain('connector.event');
    expect(tables.connector_event_subscriptions[0]?.filters).toEqual({});
  });

  test('wrong namespaces, malformed or overlong names and per-subscription secrets are refused', async () => {
    const { app, tables, path } = await managementFixture();
    for (const input of [
      { eventKey: 'connector.other-provider.item.created' },
      { eventKey: 'connector.fixture-provider..created' },
      { eventKey: 'custom.fixture-provider.item.created' },
      { eventKey: `connector.fixture-provider.${'a'.repeat(100)}` },
      { eventKey: TYPED_EVENT, verificationSecret: SECRET },
    ]) {
      const res = await app.request(path, requestBody('POST', { ingress: 'connector', ...input }));
      expect(res.status).toBe(400);
      expect(await res.text()).not.toContain(SECRET);
    }
    expect(tables.connector_event_subscriptions).toHaveLength(0);
  });

  test('a connector-ingress test returns 409 without a journal row or subscription change', async () => {
    const { app, tables, path } = await managementFixture();
    const res = await app.request(path, requestBody('POST', { ingress: 'connector', eventKey: GLOB }));
    const { data } = SubscriptionResponseSchema.parse(await res.json());
    const before = structuredClone(tables.connector_event_subscriptions);
    const testResponse = await app.request(`${path}/${data.id}/test`, requestBody('POST', { payload: { project: 7 } }));
    expect(testResponse.status).toBe(409);
    expect(z.object({ error: z.object({ code: z.string() }) }).parse(await testResponse.json()).error.code).toBe(
      'CONNECTOR_INGRESS_TEST_UNSUPPORTED',
    );
    expect(tables.omni_events).toHaveLength(0);
    expect(tables.connector_event_subscriptions).toEqual(before);
  });

  test('ClickUp creation keeps requiring its target and secret with ingress omitted or explicit', async () => {
    const { db, tables } = createConnectorTestDb({
      automations: [{ id: LEGACY_TARGET, triggerEventType: 'connector.event', tenantId: TENANT_A }],
    });
    const app = mount({ db, tenantId: TENANT_A, fetchImpl: clickupFetch({ valid: true }).fetch });
    const created = z.object({ data: z.object({ id: z.string() }) }).parse(await (await postConnector(app)).json());
    const path = `/connectors/${created.data.id}/subscriptions`;
    for (const input of [
      { eventKey: 'taskStatusUpdated', targetAutomationId: LEGACY_TARGET, verificationSecret: SECRET },
      {
        ingress: 'subscription',
        eventKey: 'taskCreated',
        targetAutomationId: LEGACY_TARGET,
        verificationSecret: SECRET,
      },
    ]) {
      const res = await app.request(path, requestBody('POST', input));
      expect(res.status).toBe(201);
      const { data } = SubscriptionResponseSchema.parse(await res.json());
      expect(data.ingress).toBe('subscription');
      expect(data.targetAutomationId).toBe(LEGACY_TARGET);
      expect(data.inboundUrl).toBe(`/api/v2/connectors/events/${data.id}`);
    }
    for (const input of [
      { eventKey: 'taskCreated', verificationSecret: SECRET },
      { eventKey: 'taskCreated', targetAutomationId: LEGACY_TARGET },
    ]) {
      expect((await app.request(path, requestBody('POST', input))).status).toBe(400);
    }
    expect(tables.connector_event_subscriptions).toHaveLength(2);
  });

  test('agent manifests still refuse every connector namespace in accepts and publishes', () => {
    for (const type of ['connector.event', TYPED_EVENT, GLOB]) {
      expect(AgentEventManifestSchema.safeParse({ accepts: [{ event: type }] }).success).toBe(false);
      expect(AgentEventManifestSchema.safeParse({ publishes: [{ event: type }] }).success).toBe(false);
    }
  });
});
