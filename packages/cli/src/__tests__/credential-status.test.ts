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
import { credentialStatusFields, serverPostureFields } from '../lib/credential-status';

const TENANT_ID = '11111111-1111-4111-8111-11111111111a';

const SERVER_POSTURE = {
  multitenancyEnabled: true,
  controlPlaneMounted: true,
  dbEnforcement: 'enforced' as const,
};

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
        const key = request.headers.get('x-api-key');
        const tenant = key === 'tenant-key';
        return Response.json({
          data: {
            valid: true,
            keyPrefix: 'omni_sk_12345678...',
            keyName: tenant ? 'tenant:tenant-operator' : 'ops-key',
            scopes: ['messages:read'],
            ...(tenant ? { credential: TENANT_CREDENTIAL } : {}),
            // A posture-reporting server sends the block to every
            // authenticated caller; 'old-server-key' simulates one that
            // predates it (issue #982).
            ...(key === 'old-server-key' ? {} : { server: SERVER_POSTURE }),
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

  test('the server posture block arrives intact for any authenticated caller', async () => {
    const client = createOmniClient({ baseUrl, apiKey: 'legacy-key' });
    const result = await client.auth.validate();
    expect(result.server).toEqual(SERVER_POSTURE);
  });

  test('an old server that reports no posture yields an absent field, not defaults', async () => {
    const client = createOmniClient({ baseUrl, apiKey: 'old-server-key' });
    const result = await client.auth.validate();
    expect(result.valid).toBe(true);
    expect(result.server).toBeUndefined();
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

describe('the CLI renders the server tenancy posture (issue #982)', () => {
  const validateWith = (server?: (typeof SERVER_POSTURE & { dbEnforcement: 'legacy' | 'enforced' }) | undefined) => ({
    valid: true,
    keyPrefix: 'p',
    keyName: 'ops-key',
    scopes: ['messages:read'],
    ...(server ? { server } : {}),
  });

  /**
   * All four flag/enforcement combinations, matching the API's
   * `mixedTenancyStateWarning` semantics: the warning field appears exactly in
   * the one advisory-only combination and never in the three coherent ones.
   */
  const COMBINATIONS = [
    { name: 'flag off + legacy (default)', enabled: false, db: 'legacy' as const, warns: false },
    { name: 'flag off + enforced', enabled: false, db: 'enforced' as const, warns: false },
    { name: 'flag on + legacy (mixed)', enabled: true, db: 'legacy' as const, warns: true },
    { name: 'flag on + enforced (finished)', enabled: true, db: 'enforced' as const, warns: false },
  ];

  for (const combo of COMBINATIONS) {
    test(`${combo.name} renders correctly`, () => {
      const fields = serverPostureFields(
        validateWith({
          multitenancyEnabled: combo.enabled,
          controlPlaneMounted: combo.enabled,
          dbEnforcement: combo.db,
        }),
      );

      expect(fields.serverMultitenancy).toBe(combo.enabled ? 'enabled' : 'disabled');
      expect(fields.serverControlPlane).toBe(combo.enabled ? 'mounted' : 'not mounted');
      expect(fields.serverDbEnforcement).toBe(combo.db);

      if (combo.warns) {
        expect(String(fields.tenancyWarning)).toContain('advisory');
      } else {
        expect('tenancyWarning' in fields).toBe(false);
      }
    });
  }

  test('a server that reports no posture adds NOTHING, so old-server output is unchanged', () => {
    // The dual-world invariant extended to versions: `omni status` against a
    // server predating posture reporting must print exactly the fields it
    // prints today — same empty-object contract as the credential projection.
    expect(serverPostureFields(validateWith(undefined))).toEqual({});
  });

  test('posture field names collide with neither the credential projection nor existing status keys', () => {
    const posture = serverPostureFields(validateWith(SERVER_POSTURE));
    const credential = credentialStatusFields({ ...validateWith(SERVER_POSTURE), credential: TENANT_CREDENTIAL });
    // `omni auth status` already prints `server` (the config entry name) and
    // `scopes`; a collision would silently overwrite an existing field.
    const reserved = new Set(['server', 'scopes', 'keyName', 'keyPrefix', 'apiUrl', ...Object.keys(credential)]);
    for (const key of Object.keys(posture)) {
      expect(reserved.has(key)).toBe(false);
    }
  });
});
