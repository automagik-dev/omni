/**
 * Connector sealed-surface proof.
 *
 * The sealing codec is shared, but the connector columns are new and always
 * sealed. This pins: seal-on-write, open-only-under-the-row's-tenant,
 * cross-tenant null (never ciphertext), flag-off inert, and a sanitized view
 * that never carries the secret or its ciphertext.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { clickupManifest } from '@omni/connector-clickup';
import { ConnectorRegistry } from '@omni/connector-sdk';
import { setTenantSecretMasterKey } from '@omni/core';
import type { Connector } from '@omni/db';
import { connectorTenantContext, createConnectorTestDb } from '../../__tests__/connector-test-harness';
import { openCredentialField, sealCredentialField } from '../../tenancy/sealed-credentials';
import { runInTenantScope } from '../../tenancy/tenant-scope';
import { ConnectorService } from '../connectors';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'pk_sealed_surface_token';
const MASTER_KEY = new Uint8Array(32).fill(7);

function row(tenantId: string | null, credentials: string): Connector {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    provider: 'clickup',
    name: 'ClickUp',
    credentials,
    hookSecret: null,
    totalUnmatched: 0,
    lastUnmatchedAt: null,
    lastUnmatchedEventType: null,
    config: {},
    status: 'connected',
    lastValidatedAt: null,
    lastError: null,
    lastErrorCode: null,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    tenantId,
  };
}

function service(): ConnectorService {
  return new ConnectorService({} as never, null, new ConnectorRegistry([clickupManifest]));
}

describe('connector credential sealing', () => {
  beforeEach(() => setTenantSecretMasterKey(MASTER_KEY));
  afterEach(() => setTenantSecretMasterKey(null));

  test('empty credentials seal on create for an events-only connector with optional credentials', async () => {
    const { db, tables } = createConnectorTestDb();
    const registry = new ConnectorRegistry([
      {
        ...clickupManifest,
        credentialFields: [{ key: 'token', label: 'Optional token', secret: true, optional: true }],
        actions: [],
        async validate() {
          return { ok: true };
        },
      },
    ]);
    const connectorService = new ConnectorService(db, null, registry);
    const view = await runInTenantScope(db, connectorTenantContext(TENANT_A), () =>
      connectorService.create({ provider: 'clickup', name: 'Events only', credentials: {} }),
    );
    const sealed = tables.connectors[0]?.credentials;
    if (typeof sealed !== 'string') throw new Error('expected stored credentials');
    expect(sealed).not.toBe('{}');
    expect(sealed.startsWith('{"v":')).toBe(true);
    expect(openCredentialField(TENANT_A, sealed)).toBe('{}');
    expect(openCredentialField(TENANT_B, sealed)).toBeNull();
    expect(view.status).toBe('connected');
  });

  test('seals on write, opens under the row tenant, and fails closed cross-tenant', () => {
    const sealed = sealCredentialField(TENANT_A, JSON.stringify({ token: TOKEN }));
    expect(sealed).not.toContain(TOKEN);
    expect(sealed?.startsWith('{"v":')).toBe(true);

    expect(JSON.parse(openCredentialField(TENANT_A, sealed) as string)).toEqual({ token: TOKEN });
    // Wrong tenant: null, never the envelope string.
    expect(openCredentialField(TENANT_B, sealed)).toBeNull();
    // No tenant/key: null.
    expect(openCredentialField(null, sealed)).toBeNull();
  });

  test('hook secrets seal on create and rotation, flip availability, and never enter views', async () => {
    const { db, tables } = createConnectorTestDb();
    const registry = new ConnectorRegistry([
      {
        ...clickupManifest,
        async validate() {
          return { ok: true };
        },
      },
    ]);
    const connectorService = new ConnectorService(db, null, registry);
    const scope = <T>(fn: () => Promise<T>) => runInTenantScope(db, connectorTenantContext(TENANT_A), fn);
    const secret = 'connector-hook-secret-original';
    const rotated = 'connector-hook-secret-rotated';
    const created = await scope(() =>
      connectorService.create({
        provider: 'clickup',
        name: 'Hook lifecycle',
        credentials: { token: TOKEN },
      }),
    );
    expect(created.hasHookSecret).toBe(false);
    const views = [created];
    for (const hookSecret of [secret, rotated]) {
      const updated = await scope(() => connectorService.update(created.id, { hookSecret }));
      expect(updated.hasHookSecret).toBe(true);
      const stored = tables.connectors[0]?.hookSecret;
      if (typeof stored !== 'string') throw new Error('expected sealed hook secret');
      expect(stored).not.toContain(hookSecret);
      expect(openCredentialField(TENANT_A, stored)).toBe(hookSecret);
      expect(openCredentialField(TENANT_B, stored)).toBeNull();
      views.push(updated, await scope(() => connectorService.getById(created.id)));
    }
    const withSecret = await scope(() =>
      connectorService.create({
        provider: 'clickup',
        name: 'Hook on create',
        credentials: { token: TOKEN },
        hookSecret: secret,
      }),
    );
    expect(withSecret.hasHookSecret).toBe(true);
    const stored = tables.connectors[1]?.hookSecret;
    if (typeof stored !== 'string') throw new Error('expected hook secret sealed on create');
    expect(stored).not.toContain(secret);
    expect(openCredentialField(TENANT_A, stored)).toBe(secret);
    views.push(withSecret, ...(await scope(() => connectorService.list())).items);
    setTenantSecretMasterKey(null);
    const unavailable = await scope(() => connectorService.getById(created.id));
    expect(unavailable.hasHookSecret).toBe(false);
    views.push(unavailable);
    for (const view of views) {
      expect(view).not.toHaveProperty('hookSecret');
      expect(JSON.stringify(view)).not.toContain(secret);
      expect(JSON.stringify(view)).not.toContain(rotated);
      expect(JSON.stringify(view)).not.toContain('{"v":');
    }
  });

  test('provider validation errors redact the hook secret on create and credential PATCH', async () => {
    const { db } = createConnectorTestDb();
    const secret = 'hook-secret-in-provider-error';
    let throws = false;
    const registry = new ConnectorRegistry([
      {
        ...clickupManifest,
        async validate() {
          if (throws) throw new Error(`provider echoed ${secret}`);
          return { ok: false, code: 'AUTH_FAILED', message: `provider echoed ${secret}` };
        },
      },
    ]);
    const connectorService = new ConnectorService(db, null, registry);
    await runInTenantScope(db, connectorTenantContext(TENANT_A), async () => {
      const created = await connectorService.create({
        provider: 'clickup',
        name: 'Redaction',
        credentials: { token: TOKEN },
        hookSecret: secret,
      });
      expect(created.lastError).toContain('provider echoed');
      expect(JSON.stringify(created)).not.toContain(secret);
      throws = true;
      const updated = await connectorService.update(created.id, { credentials: { token: TOKEN } });
      expect(updated.lastError).toContain('provider echoed');
      expect(JSON.stringify(updated)).not.toContain(secret);
    });
  });

  test('the sanitized connector never returns the secret or its ciphertext', () => {
    const sealed = sealCredentialField(TENANT_A, JSON.stringify({ token: TOKEN })) as string;
    const view = service().sanitizeConnector(row(TENANT_A, sealed));

    expect(view.hasCredentials).toBe(true);
    expect(view.status).toBe('connected');
    expect(view).not.toHaveProperty('credentials');
    expect(JSON.stringify(view)).not.toContain(TOKEN);
    expect(JSON.stringify(view)).not.toContain('{"v":');
  });

  test('an unopenable credential is an error state, not a silent empty string', () => {
    const sealed = sealCredentialField(TENANT_A, JSON.stringify({ token: TOKEN })) as string;
    const view = service().sanitizeConnector(row(TENANT_B, sealed));

    expect(view.hasCredentials).toBe(false);
    expect(view.status).toBe('error');
    expect(view.lastErrorCode).toBe('CREDENTIAL_UNAVAILABLE');
    expect(JSON.stringify(view)).not.toContain(TOKEN);
  });

  test('the flag-off world is the identity function, as documented', () => {
    setTenantSecretMasterKey(null);
    const plain = JSON.stringify({ token: TOKEN });
    expect(sealCredentialField(TENANT_A, plain)).toBe(plain);
    expect(openCredentialField(TENANT_A, plain)).toBe(plain);
    expect(service().sanitizeConnector(row(TENANT_A, plain)).hasCredentials).toBe(true);
  });

  test('the subscription verification secret follows the same codec', () => {
    const sealed = sealCredentialField(TENANT_A, 'clickup-webhook-secret') as string;
    expect(sealed).not.toContain('clickup-webhook-secret');
    expect(openCredentialField(TENANT_A, sealed)).toBe('clickup-webhook-secret');
    expect(openCredentialField(TENANT_B, sealed)).toBeNull();
  });
});
