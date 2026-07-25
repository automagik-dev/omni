/**
 * Credential-class exposure on `POST /auth/validate`
 * (wish: omni-full-multitenancy, Group G4; WISH "Compatibility").
 *
 * The WISH requires that a caller can discover, from an authenticated surface,
 * WHICH WORLD it is in: credential class, tenant id and slug, role, scopes,
 * resource constraints, and expiry. `route-ownership.ts` already declares this
 * route `control-plane` on exactly that basis ("Returns ONLY facts about the
 * caller's own authenticated context … and never a secret, hash, or key
 * material"). Until now that declaration described an intention; this suite is
 * where it becomes a checked property.
 *
 * TWO WORLDS, ONE ROUTE
 * ---------------------
 * The exposure is keyed on the presence of a tenant auth context, not on the
 * feature flag. A legacy credential never has one, so its response body is
 * byte-for-byte what it was before G4 — asserted here by exact object equality
 * rather than by "contains", because an additive field is exactly the kind of
 * change that a `toMatchObject` assertion would wave through.
 *
 * WHAT MUST NEVER APPEAR
 * ----------------------
 * The last test walks the whole serialized response looking for the plaintext
 * secret, its digest, and any key whose NAME suggests key material. That is a
 * deliberately dumb, structural check: it keeps holding when someone later adds
 * a field to the context, which a hand-listed allowlist of fields would not.
 */

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { type TenantAuthContext, freezeContext } from '../../../tenancy/auth-context';
import type { ApiKeyData, AppVariables } from '../../../types';
import { authRoutes } from '../auth';

const CREDENTIAL_ID = '99999999-9999-4999-8999-999999999992';
const TENANT_ID = '11111111-1111-4111-8111-11111111111a';
const EXPIRES_AT = new Date('2026-09-01T00:00:00.000Z');

/**
 * The secret and digest that must never appear in any response body. Both are
 * synthetic: the digest is SHA-256 of the empty string, computed at runtime so
 * no high-entropy hex literal sits in the source for secret scanners to flag.
 */
const PLAINTEXT_SECRET = 'omni_sk_thisIsTheCallersPlaintextSecretValue';
const SECRET_DIGEST = createHash('sha256').update('').digest('hex');

function legacyApiKey(): ApiKeyData {
  return {
    id: '12345678-1234-4123-8123-123456789012',
    name: 'ops-key',
    scopes: ['messages:read'],
    instanceIds: null,
    expiresAt: null,
    profile: null,
    chatAllowlist: [],
    instanceAllowlist: [],
    outboundRecipientAllowlist: [],
    profileOverrides: null,
  };
}

function tenantContext(overrides: Partial<TenantAuthContext> = {}): TenantAuthContext {
  return freezeContext({
    credentialClass: 'tenant',
    requestId: 'req-1',
    principalId: '33333333-3333-4333-8333-333333333331',
    credentialId: CREDENTIAL_ID,
    tenantId: TENANT_ID,
    tenantSlug: 'tenant-a',
    actorRole: 'tenant-operator',
    scopes: ['messages:read', 'chats:read'],
    membershipId: '44444444-4444-4444-8444-444444444441',
    resourceConstraints: { instanceAllowlist: ['55555555-5555-4555-8555-55555555555a'] },
    expiresAt: EXPIRES_AT,
    rateLimit: 100,
    budget: 1000,
    delegationDepth: 1,
    rootKeyId: 'root-1',
    policyVersion: 1,
    revocationEpoch: 0,
    tenantKeyLineageId: 'lin-1',
    ...overrides,
  }) as TenantAuthContext;
}

/** Mount the real route with the variables the middleware chain would have set. */
function mount(vars: { apiKey?: ApiKeyData; authContext?: TenantAuthContext }) {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    if (vars.apiKey) c.set('apiKey', vars.apiKey);
    if (vars.authContext) c.set('authContext', vars.authContext);
    await next();
  });
  app.route('/auth', authRoutes);
  return app;
}

const validate = (app: Hono<{ Variables: AppVariables }>) => app.request('/auth/validate', { method: 'POST' });

describe('POST /auth/validate — legacy world is untouched', () => {
  test('a legacy credential gets exactly the pre-G4 body, with no credential block', async () => {
    const response = await validate(mount({ apiKey: legacyApiKey() }));
    expect(response.status).toBe(200);
    // Exact equality, not containment: the dual-world invariant is that NOTHING
    // was added here, and only an exact comparison can assert "nothing".
    expect(await response.json()).toEqual({
      data: {
        valid: true,
        keyPrefix: 'omni_sk_12345678...',
        keyName: 'ops-key',
        scopes: ['messages:read'],
      },
    });
  });

  test('the primary key still renames to "primary"', async () => {
    const app = mount({ apiKey: { ...legacyApiKey(), name: '__primary__' } });
    const body = (await (await validate(app)).json()) as { data: { keyName: string } };
    expect(body.data.keyName).toBe('primary');
  });

  test('no credential at all is still a 401 with the unchanged body', async () => {
    const response = await validate(mount({}));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } });
  });
});

describe('POST /auth/validate — tenant world exposes the caller’s own context', () => {
  const tenantApp = () =>
    mount({
      apiKey: { ...legacyApiKey(), id: CREDENTIAL_ID, name: 'tenant:tenant-operator', scopes: ['messages:read'] },
      authContext: tenantContext(),
    });

  test('every field the WISH names is present and correct', async () => {
    const body = (await (await validate(tenantApp())).json()) as {
      data: { credential: Record<string, unknown> };
    };

    expect(body.data.credential).toEqual({
      class: 'tenant',
      tenantId: TENANT_ID,
      tenantSlug: 'tenant-a',
      role: 'tenant-operator',
      scopes: ['messages:read', 'chats:read'],
      constraints: { instanceAllowlist: ['55555555-5555-4555-8555-55555555555a'] },
      expiresAt: EXPIRES_AT.toISOString(),
      delegationDepth: 1,
    });
  });

  test('the legacy fields keep their legacy meaning alongside it', async () => {
    // A tenant caller must not lose the fields the CLI/SDK already read, or the
    // exposure would be a breaking change dressed up as an addition.
    const body = (await (await validate(tenantApp())).json()) as { data: Record<string, unknown> };
    expect(body.data.valid).toBe(true);
    expect(body.data.keyName).toBe('tenant:tenant-operator');
    expect(body.data.scopes).toEqual(['messages:read']);
  });

  test('a never-expiring key reports null rather than omitting the field', async () => {
    const app = mount({ apiKey: legacyApiKey(), authContext: tenantContext({ expiresAt: null }) });
    const body = (await (await validate(app)).json()) as { data: { credential: { expiresAt: unknown } } };
    expect(body.data.credential.expiresAt).toBeNull();
  });

  test('a context without a resolved slug reports null, never a guess', async () => {
    const app = mount({ apiKey: legacyApiKey(), authContext: tenantContext({ tenantSlug: undefined }) });
    const body = (await (await validate(app)).json()) as { data: { credential: { tenantSlug: unknown } } };
    expect(body.data.credential.tenantSlug).toBeNull();
  });
});

describe('POST /auth/validate — no secret, hash, or key material', () => {
  test('nothing in the response resembles the credential’s secret or digest', async () => {
    const app = mount({
      apiKey: { ...legacyApiKey(), id: CREDENTIAL_ID },
      authContext: tenantContext(),
    });
    const raw = await (await validate(app)).text();

    expect(raw).not.toContain(PLAINTEXT_SECRET);
    expect(raw).not.toContain(SECRET_DIGEST);

    // Structural, not enumerated: any FUTURE field whose name reads like key
    // material fails here without anyone having to remember to update a list.
    const forbiddenKey = /secret|hash|keyMaterial|plainText|password|token/i;
    const walk = (value: unknown, path: string): void => {
      if (value === null || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        expect(`${path}.${key}`).not.toMatch(forbiddenKey);
        walk(child, `${path}.${key}`);
      }
    };
    walk(JSON.parse(raw), '$');
  });

  test('the credential id itself is not published', async () => {
    // `keyPrefix` deliberately carries a truncated id for human identification;
    // the full credential id is an auth-plane primary key and stays there.
    const app = mount({ apiKey: { ...legacyApiKey(), id: CREDENTIAL_ID }, authContext: tenantContext() });
    const body = (await (await validate(app)).json()) as { data: { credential: Record<string, unknown> } };
    expect(Object.values(body.data.credential)).not.toContain(CREDENTIAL_ID);
  });
});
