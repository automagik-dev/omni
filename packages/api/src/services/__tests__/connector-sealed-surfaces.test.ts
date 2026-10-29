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
import { openCredentialField, sealCredentialField } from '../../tenancy/sealed-credentials';
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
