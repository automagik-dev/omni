/**
 * Connector credential surfaces (design §3; verification finding F2).
 *
 * The sealed codec's own unit test (`connector-sealed-surfaces.test.ts`) calls
 * `sanitizeConnector` with a hand-built row. This suite is the missing
 * integration half: it drives the REAL `ConnectorService` over an in-memory
 * database, so it pins what create/update/subscriptions actually persist and
 * return — and what the config-audit surface records.
 *
 * Pinned here:
 *   * `create` seals the credential under the active tenant; the stored value is
 *     ciphertext, the response carries only `hasCredentials`;
 *   * an invalid token stores a readable `error` row whose message is scrubbed;
 *   * `update` re-seals under the PERSISTED row's tenant;
 *   * a tenant-B scope cannot see, read, update, delete or subscribe to A's row;
 *   * the subscription verification secret is sealed and never returned;
 *   * an audit row fingerprints both secrets instead of storing them.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { clickupManifest } from '@omni/connector-clickup';
import { ConnectorRegistry } from '@omni/connector-sdk';
import { CONNECTOR_EVENT_TYPE, setTenantSecretMasterKey } from '@omni/core';
import { Hono } from 'hono';
import { connectorTenantContext, createConnectorTestDb } from '../../__tests__/connector-test-harness';
import { configAuditMiddleware } from '../../middleware/config-audit';
import { errorHandler } from '../../middleware/error';
import { connectorRoutes } from '../../routes/v2/connectors';
import { openCredentialField } from '../../tenancy/sealed-credentials';
import { runInTenantScope } from '../../tenancy/tenant-scope';
import type { AppVariables } from '../../types';
import { ConnectorService } from '../connectors';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const AUTOMATION_ID = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'pk_credential_surface_token_0001';
const ROTATED_TOKEN = 'pk_credential_surface_token_0002';
const SECRET = 'clickup-credential-surface-webhook-secret';
const MASTER_KEY = new Uint8Array(32).fill(7);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function clickupFetch(options: { valid: boolean; errorText?: string } = { valid: true }): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.endsWith('/team')) return json({ err: 'unexpected URL' }, 404);
    if (options.valid) return json({ teams: [{ id: 'team-1', name: 'Acme' }] });
    return json({ err: options.errorText ?? 'invalid token', ECODE: 'OAUTH_025' }, 401);
  }) as unknown as typeof fetch;
}

function serviceFor(db: ReturnType<typeof createConnectorTestDb>['db'], fetchImpl: typeof fetch = clickupFetch()) {
  return new ConnectorService(db, null, new ConnectorRegistry([clickupManifest]), { fetch: fetchImpl });
}

function inTenant<T>(db: ReturnType<typeof createConnectorTestDb>['db'], tenantId: string, fn: () => Promise<T>) {
  return runInTenantScope(db, connectorTenantContext(tenantId), fn);
}

/** A real create, so every later assertion starts from service-written state. */
async function createConnector(
  db: ReturnType<typeof createConnectorTestDb>['db'],
  options: { tenantId?: string; fetchImpl?: typeof fetch; token?: string; name?: string } = {},
) {
  const service = serviceFor(db, options.fetchImpl ?? clickupFetch());
  return inTenant(db, options.tenantId ?? TENANT_A, () =>
    service.create(
      {
        provider: 'clickup',
        name: options.name ?? 'Acme ClickUp',
        credentials: { token: options.token ?? TOKEN },
        config: {},
      },
      'test',
    ),
  );
}

function subscriptionInput() {
  return {
    eventKey: 'taskStatusUpdated',
    targetAutomationId: AUTOMATION_ID,
    verificationSecret: SECRET,
  };
}

beforeEach(() => setTenantSecretMasterKey(MASTER_KEY));
afterEach(() => setTenantSecretMasterKey(null));

describe('connector create/update persistence surfaces', () => {
  test('create seals the credential at rest and returns only hasCredentials', async () => {
    const { db, tables } = createConnectorTestDb();
    const view = await createConnector(db);

    expect(view).toMatchObject({ status: 'connected', hasCredentials: true, lastError: null });
    expect(view).not.toHaveProperty('credentials');

    const stored = tables.connectors[0]?.credentials;
    expect(typeof stored).toBe('string');
    expect(stored).not.toContain(TOKEN);
    expect(String(stored).startsWith('{"v":')).toBe(true);

    // Opens only under the row's own tenant; another tenant gets null, never
    // ciphertext.
    const opened = openCredentialField(TENANT_A, stored as string);
    expect(JSON.parse(opened as string)).toEqual({ token: TOKEN });
    expect(openCredentialField(TENANT_B, stored as string)).toBeNull();

    // Neither the secret nor the envelope appears in the view.
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('{"v":');
  });

  test('an invalid token stores an error row with a scrubbed message, never a false connected', async () => {
    const { db, tables } = createConnectorTestDb();
    const view = await createConnector(db, {
      fetchImpl: clickupFetch({ valid: false, errorText: `rejected token ${TOKEN}` }),
    });

    expect(view).toMatchObject({ status: 'error', lastErrorCode: 'AUTH_FAILED', lastValidatedAt: null });
    expect(String(view.lastError)).toContain('401');
    expect(String(view.lastError)).not.toContain(TOKEN);
    expect(JSON.stringify(view)).not.toContain(TOKEN);

    const stored = tables.connectors[0]?.credentials as string;
    expect(stored.startsWith('{"v":')).toBe(true);
    expect(stored).not.toContain(TOKEN);
  });

  test('update re-seals under the persisted row tenant and drops the old value', async () => {
    const { db, tables } = createConnectorTestDb();
    const created = await createConnector(db);
    const first = tables.connectors[0]?.credentials as string;

    const service = serviceFor(db);
    const updated = await inTenant(db, TENANT_A, () =>
      service.update(created.id, { credentials: { token: ROTATED_TOKEN } }),
    );

    const second = tables.connectors[0]?.credentials as string;
    expect(second).not.toBe(first);
    expect(second).not.toContain(ROTATED_TOKEN);
    expect(JSON.parse(openCredentialField(TENANT_A, second) as string)).toEqual({ token: ROTATED_TOKEN });
    // The old envelope is no longer the persisted value.
    expect(tables.connectors.filter((row) => row.credentials === first)).toEqual([]);
    expect(updated.hasCredentials).toBe(true);
    expect(JSON.stringify(updated)).not.toContain(ROTATED_TOKEN);
  });
});

describe('connector tenant containment', () => {
  test("tenant B cannot list, read, update, delete or subscribe to tenant A's connector", async () => {
    const { db, tables } = createConnectorTestDb({
      automations: [{ id: AUTOMATION_ID, triggerEventType: CONNECTOR_EVENT_TYPE, tenantId: TENANT_A }],
    });
    const created = await createConnector(db);
    const service = serviceFor(db);

    const list = await inTenant(db, TENANT_B, () => service.list());
    expect(list.items).toEqual([]);

    // Attach each expectation before starting the next request: the service
    // rejects synchronously enough that a batch of pre-started promises would
    // surface as an unhandled rejection rather than a test failure.
    await expect(inTenant(db, TENANT_B, () => service.getById(created.id))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(inTenant(db, TENANT_B, () => service.update(created.id, { name: 'stolen' }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(inTenant(db, TENANT_B, () => service.delete(created.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      inTenant(db, TENANT_B, () => service.createSubscription(created.id, subscriptionInput())),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(inTenant(db, TENANT_B, () => service.listSubscriptions(created.id))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    // Nothing was created or changed under B.
    expect(tables.connectors).toHaveLength(1);
    expect(tables.connectors[0]?.name).toBe('Acme ClickUp');
    expect(tables.connector_event_subscriptions).toHaveLength(0);

    // A still owns everything.
    const owned = await inTenant(db, TENANT_A, () => service.getById(created.id));
    expect(owned.id).toBe(created.id);
  });
});

describe('subscription verification-secret surfaces', () => {
  test('the secret is sealed at rest and never returned by create or list', async () => {
    const { db, tables } = createConnectorTestDb({
      automations: [{ id: AUTOMATION_ID, triggerEventType: CONNECTOR_EVENT_TYPE, tenantId: TENANT_A }],
    });
    const created = await createConnector(db);
    const service = serviceFor(db);

    const subscription = await inTenant(db, TENANT_A, () =>
      service.createSubscription(created.id, subscriptionInput()),
    );
    expect(subscription).not.toHaveProperty('verificationSecret');
    expect(JSON.stringify(subscription)).not.toContain(SECRET);

    const stored = tables.connector_event_subscriptions[0]?.verificationSecret as string;
    expect(stored).not.toContain(SECRET);
    expect(stored.startsWith('{"v":')).toBe(true);
    expect(openCredentialField(TENANT_A, stored)).toBe(SECRET);
    expect(openCredentialField(TENANT_B, stored)).toBeNull();

    const list = await inTenant(db, TENANT_A, () => service.listSubscriptions(created.id));
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('verificationSecret');
    expect(JSON.stringify(list)).not.toContain(SECRET);
    expect(JSON.stringify(list)).not.toContain('{"v":');

    // Rotating the secret re-seals without echoing either value.
    const rotated = 'rotated-clickup-webhook-secret';
    const updated = await inTenant(db, TENANT_A, () =>
      service.updateSubscription(created.id, subscription.id, { verificationSecret: rotated }),
    );
    const resealed = tables.connector_event_subscriptions[0]?.verificationSecret as string;
    expect(resealed).not.toBe(stored);
    expect(openCredentialField(TENANT_A, resealed)).toBe(rotated);
    expect(JSON.stringify(updated)).not.toContain(rotated);
  });
});

/**
 * The connector routes with the REAL config-audit middleware in front, over the
 * in-memory DB. Used to inspect exactly what the audit row would store.
 */
function mountAuditedApp(db: ReturnType<typeof createConnectorTestDb>['db']): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('requestId', 'req-audit');
    c.set('apiKey', { id: 'key-1', name: 'audit-test', scopes: ['*'], instanceIds: null } as never);
    c.set('services', { connectors: serviceFor(db), db } as never);
    await runInTenantScope(db, connectorTenantContext(TENANT_A), async () => {
      await next();
    });
  });
  app.use('/api/v2/*', configAuditMiddleware);
  app.route('/api/v2/connectors', connectorRoutes);
  return app;
}

interface AuditRow {
  changes?: Record<string, { before?: unknown; after?: unknown }>;
  changedFields?: string[];
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

describe('audit surface', () => {
  test('a connector create writes fingerprints, never the credential', async () => {
    const { db, tables } = createConnectorTestDb();
    const app = mountAuditedApp(db);

    const res = await app.request(
      '/api/v2/connectors',
      jsonRequest('POST', {
        provider: 'clickup',
        name: 'Acme ClickUp',
        credentials: { token: TOKEN },
        config: {},
      }),
    );
    expect(res.status).toBe(201);
    await Bun.sleep(0);

    expect(tables.config_audit_logs).toHaveLength(1);
    const audit = tables.config_audit_logs[0] as AuditRow;
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(TOKEN);
    // The audit row stores a one-way fingerprint of the sealed envelope, so the
    // ciphertext never lands in the audit surface either.
    expect(serialized).not.toContain('{"v":');
    expect(audit.changes?.credentials?.after).toMatch(/^sha256:[0-9a-f]{12}$/);
    expect(audit.changedFields).toContain('credentials');
  });

  test('a subscription secret rotation writes a fingerprint, never the secret', async () => {
    const { db, tables } = createConnectorTestDb({
      automations: [{ id: AUTOMATION_ID, triggerEventType: CONNECTOR_EVENT_TYPE, tenantId: TENANT_A }],
    });
    const created = await createConnector(db);
    const subscription = await inTenant(db, TENANT_A, () =>
      serviceFor(db).createSubscription(created.id, subscriptionInput()),
    );

    const rotated = 'rotated-clickup-webhook-secret';
    const app = mountAuditedApp(db);
    const res = await app.request(
      `/api/v2/connectors/${created.id}/subscriptions/${subscription.id}`,
      jsonRequest('PATCH', { verificationSecret: rotated }),
    );
    expect(res.status).toBe(200);
    await Bun.sleep(0);

    const audit = tables.config_audit_logs.at(-1) as AuditRow;
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(rotated);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('{"v":');
    expect(audit.changes?.verificationSecret?.after).toMatch(/^sha256:[0-9a-f]{12}$/);
    expect(audit.changedFields).toContain('verificationSecret');
  });
});
