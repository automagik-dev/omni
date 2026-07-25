/**
 * Credential-class exposure through the SDK and the CLI
 * (wish: omni-full-multitenancy, Group G4; WISH "Compatibility").
 *
 * The API half of this is proven in
 * `packages/api/src/routes/v2/__tests__/auth-credential-exposure.test.ts`. What
 * is proven here is that the fact SURVIVES THE WHOLE WAY OUT: the SDK does not
 * drop it at its response boundary, and `omni status` / `omni auth status` show
 * it to the operator. An exposure that stops at the HTTP layer is not the
 * deliverable the WISH asks for.
 *
 * The SDK half runs against a real local HTTP server rather than a stubbed
 * fetch, because the specific failure this guards against is a REAL one in
 * `client.ts`: `auth.validate()` ends in `json?.data ?? {…}`, so a shape the
 * client does not know about is silently replaced by a default. Only a genuine
 * round trip can tell whether the field arrived.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createOmniClient } from '@omni/sdk';
import { credentialStatusFields } from '../lib/credential-status';

const TENANT_ID = '11111111-1111-4111-8111-11111111111a';

const TENANT_CREDENTIAL = {
  class: 'tenant' as const,
  tenantId: TENANT_ID,
  tenantSlug: 'tenant-a',
  role: 'tenant-operator',
  scopes: ['messages:read', 'chats:read'],
  constraints: { instanceAllowlist: ['55555555-5555-4555-8555-55555555555a'] },
  expiresAt: '2026-09-01T00:00:00.000Z',
  delegationDepth: 1,
};

describe('the SDK carries the credential block through', () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl = '';

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(request) {
        const { pathname } = new URL(request.url);
        if (pathname !== '/api/v2/auth/validate') return new Response('not found', { status: 404 });
        const tenant = request.headers.get('x-api-key') === 'tenant-key';
        return Response.json({
          data: {
            valid: true,
            keyPrefix: 'omni_sk_12345678...',
            keyName: tenant ? 'tenant:tenant-operator' : 'ops-key',
            scopes: ['messages:read'],
            ...(tenant ? { credential: TENANT_CREDENTIAL } : {}),
          },
        });
      },
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => server.stop(true));

  test('a tenant credential arrives with every field intact', async () => {
    const client = createOmniClient({ baseUrl, apiKey: 'tenant-key' });
    const result = await client.auth.validate();
    expect(result.credential).toEqual(TENANT_CREDENTIAL);
  });

  test('a legacy credential still gets the pre-G4 shape and no credential block', async () => {
    const client = createOmniClient({ baseUrl, apiKey: 'legacy-key' });
    const result = await client.auth.validate();
    expect(result.valid).toBe(true);
    expect(result.keyName).toBe('ops-key');
    expect(result.credential).toBeUndefined();
  });
});

describe('the CLI renders the credential context', () => {
  test('a tenant credential produces the operator-facing fields', () => {
    expect(
      credentialStatusFields({
        valid: true,
        keyPrefix: 'omni_sk_12345678...',
        keyName: 'tenant:tenant-operator',
        scopes: ['messages:read'],
        credential: TENANT_CREDENTIAL,
      }),
    ).toEqual({
      credentialClass: 'tenant',
      tenant: `tenant-a (${TENANT_ID})`,
      role: 'tenant-operator',
      tenantScopes: ['messages:read', 'chats:read'],
      constraints: { instanceAllowlist: ['55555555-5555-4555-8555-55555555555a'] },
      expiresAt: '2026-09-01T00:00:00.000Z',
      delegationDepth: 1,
    });
  });

  test('an unresolved slug falls back to the id alone rather than inventing one', () => {
    const fields = credentialStatusFields({
      valid: true,
      keyPrefix: '',
      keyName: '',
      scopes: [],
      credential: { ...TENANT_CREDENTIAL, tenantSlug: null },
    });
    expect(fields.tenant).toBe(TENANT_ID);
  });

  test('a never-expiring credential says so instead of showing null', () => {
    const fields = credentialStatusFields({
      valid: true,
      keyPrefix: '',
      keyName: '',
      scopes: [],
      credential: { ...TENANT_CREDENTIAL, expiresAt: null },
    });
    expect(fields.expiresAt).toBe('never');
  });

  test('a legacy credential adds NOTHING, so legacy output is unchanged', () => {
    // The dual-world invariant at the CLI layer: `omni status` for a legacy key
    // must print exactly the keys it printed before G4.
    expect(
      credentialStatusFields({ valid: true, keyPrefix: 'p', keyName: 'ops-key', scopes: ['messages:read'] }),
    ).toEqual({});
  });

  test('nothing rendered reads like key material', () => {
    const fields = credentialStatusFields({
      valid: true,
      keyPrefix: '',
      keyName: '',
      scopes: [],
      credential: TENANT_CREDENTIAL,
    });
    for (const key of Object.keys(fields)) {
      expect(key).not.toMatch(/secret|hash|plainText|password|token/i);
    }
  });
});
