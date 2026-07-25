/**
 * Isolated auth-bootstrap tests (wish: omni-full-multitenancy, Group G1; ADR-0003).
 *
 * A hand-rolled fake `Database` returns configured rows per table so the
 * resolution + fail-closed logic is exercised without a live DB. Proves the
 * minimal immutable context on success and fail-closed on every hostile state.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { authCredentials, platformApiKeys, principals, tenantKeyLineage, tenantMemberships, tenants } from '@omni/db';
import { AuthBootstrapService } from '../auth-bootstrap';

interface Rows {
  authCredentials?: unknown[];
  tenants?: unknown[];
  tenantKeyLineage?: unknown[];
  platformApiKeys?: unknown[];
  principals?: unknown[];
  tenantMemberships?: unknown[];
}

function makeDb(rows: Rows, opts: { throwOnCredential?: boolean } = {}): Database {
  const map = new Map<unknown, unknown[]>([
    [authCredentials, rows.authCredentials ?? []],
    [tenants, rows.tenants ?? []],
    [tenantKeyLineage, rows.tenantKeyLineage ?? []],
    [platformApiKeys, rows.platformApiKeys ?? []],
    [principals, rows.principals ?? []],
    [tenantMemberships, rows.tenantMemberships ?? []],
  ]);
  return {
    select() {
      let current: unknown[] = [];
      let table: unknown;
      const chain = {
        from(t: unknown) {
          table = t;
          current = map.get(t) ?? [];
          return chain;
        },
        where() {
          return chain;
        },
        for() {
          return chain;
        },
        limit() {
          if (opts.throwOnCredential && table === authCredentials) {
            return Promise.reject(new Error('db down'));
          }
          return Promise.resolve(current);
        },
      };
      return chain;
    },
  } as unknown as Database;
}

const activeTenant = {
  id: 'tenant-1',
  status: 'active',
  policyVersion: 3,
  revocationEpoch: 7,
  maxKeyTtlSeconds: 3600,
  maxKeyRateLimit: 100,
  maxKeyBudget: 1000,
};

const tenantCredential = {
  id: 'cred-1',
  credentialClass: 'tenant',
  keyHash: 'hash-1',
  keyPrefix: 'pfx',
  tenantId: 'tenant-1',
  principalId: 'prin-1',
  membershipId: 'mem-1',
  actorRole: 'tenant-admin',
  scopes: ['tenant:read', 'tenant:write'],
  status: 'active',
  tenantKeyLineageId: 'lin-1',
  platformApiKeyId: null,
  policySnapshotVersion: 3,
  revocationEpochSnapshot: 7,
  expiresAt: null,
  revokedAt: null,
};

const activeLineage = {
  id: 'lin-1',
  tenantId: 'tenant-1',
  principalId: 'prin-1',
  membershipId: 'mem-1',
  actorRole: 'tenant-admin',
  keyPrefix: 'pfx',
  scopes: ['tenant:read', 'tenant:write'],
  status: 'active',
  ancestorRevoked: false,
  revocationEpoch: 7,
  expiresAt: null,
  resourceConstraints: { instanceIds: ['instance-1'] },
  rateLimit: 50,
  budget: 500,
  depth: 1,
  rootKeyId: 'root-1',
};
const activePrincipal = { id: 'prin-1', status: 'active' };
const activeMembership = {
  id: 'mem-1',
  tenantId: 'tenant-1',
  principalId: 'prin-1',
  status: 'active',
  role: 'tenant-admin',
};

function tenantRows(overrides: Partial<Record<keyof Rows, unknown[]>> = {}): Rows {
  return {
    authCredentials: [tenantCredential],
    tenants: [activeTenant],
    tenantKeyLineage: [activeLineage],
    principals: [activePrincipal],
    tenantMemberships: [activeMembership],
    ...overrides,
  };
}

describe('AuthBootstrapService — has no enumeration surface', () => {
  test('exposes only lookup methods (no list/enumerate)', () => {
    const svc = new AuthBootstrapService(makeDb({}));
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(svc));
    expect(proto).toContain('lookupBySecretHash');
    expect(proto).toContain('lookupBySecret');
    expect(proto).not.toContain('list');
    expect(proto).not.toContain('listCredentials');
    expect(proto).not.toContain('all');
  });
});

describe('AuthBootstrapService — active tenant success', () => {
  test('returns a minimal, frozen, immutable tenant context', async () => {
    const svc = new AuthBootstrapService(makeDb(tenantRows()));
    const result = await svc.lookupBySecretHash('hash-1', 'req-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = result.context;
    expect(ctx.credentialClass).toBe('tenant');
    expect(ctx.requestId).toBe('req-1');
    expect(ctx.credentialId).toBe('cred-1');
    if (ctx.credentialClass !== 'tenant') return;
    expect(ctx.tenantId).toBe('tenant-1');
    expect(ctx.actorRole).toBe('tenant-admin');
    expect(ctx.membershipId).toBe('mem-1');
    expect(ctx.policyVersion).toBe(3);
    expect(ctx.revocationEpoch).toBe(7);
    expect(ctx.resourceConstraints).toEqual({ instanceIds: ['instance-1'] });
    expect(ctx.rateLimit).toBe(50);
    expect(ctx.budget).toBe(500);
    expect(ctx.delegationDepth).toBe(1);
    expect(ctx.rootKeyId).toBe('root-1');
    // Immutable: the whole context and its scopes array are frozen.
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.scopes)).toBe(true);
    expect(() => {
      (ctx as { tenantId: string }).tenantId = 'tenant-evil';
    }).toThrow();
    expect(ctx.tenantId).toBe('tenant-1');
  });
});

describe('AuthBootstrapService — fail closed', () => {
  test('unknown hash → not_found (uniform, non-enumerating)', async () => {
    const svc = new AuthBootstrapService(makeDb({ authCredentials: [] }));
    const r = await svc.lookupBySecretHash('nope', 'req');
    expect(r).toEqual({ ok: false, reason: 'not_found' });
  });

  test('auth-plane error fails closed', async () => {
    const svc = new AuthBootstrapService(makeDb(tenantRows(), { throwOnCredential: true }));
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r).toEqual({ ok: false, reason: 'auth_plane_error' });
  });

  test('revoked credential', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ authCredentials: [{ ...tenantCredential, status: 'revoked' }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('credential_revoked');
  });

  test('expired credential (past expiry)', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ authCredentials: [{ ...tenantCredential, expiresAt: new Date('2000-01-01') }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('credential_expired');
  });

  test('suspended tenant', async () => {
    const svc = new AuthBootstrapService(makeDb(tenantRows({ tenants: [{ ...activeTenant, status: 'suspended' }] })));
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('tenant_inactive');
  });

  test('stale policy epoch', async () => {
    const svc = new AuthBootstrapService(makeDb(tenantRows({ tenants: [{ ...activeTenant, policyVersion: 99 }] })));
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stale_policy_epoch');
  });

  test('stale revocation epoch (e.g. after tenant-wide revoke)', async () => {
    const svc = new AuthBootstrapService(makeDb(tenantRows({ tenants: [{ ...activeTenant, revocationEpoch: 999 }] })));
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('stale_revocation_epoch');
  });

  test('revoked lineage key', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ tenantKeyLineage: [{ ...activeLineage, status: 'revoked' }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('credential_revoked');
  });

  test('ancestor-revoked lineage', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ tenantKeyLineage: [{ ...activeLineage, ancestorRevoked: true }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('ancestor_revoked');
  });

  test('disabled principal', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ principals: [{ ...activePrincipal, status: 'disabled' }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('principal_disabled');
  });

  test('disabled membership', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ tenantMemberships: [{ ...activeMembership, status: 'disabled' }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('membership_disabled');
  });

  test('membership role mismatch is an invalid role binding', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ tenantMemberships: [{ ...activeMembership, role: 'tenant-viewer' }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_role_binding');
  });

  test('membership from a different tenant is an invalid class binding', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ tenantMemberships: [{ ...activeMembership, tenantId: 'tenant-2' }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_class_binding');
  });

  test('membership for a different principal is an invalid class binding', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ tenantMemberships: [{ ...activeMembership, principalId: 'prin-2' }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_class_binding');
  });

  test('malformed tenant credential (missing tenant binding)', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ authCredentials: [{ ...tenantCredential, tenantId: null }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_class_binding');
  });

  test('a tenant credential carrying `*` is rejected as an invalid binding', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ authCredentials: [{ ...tenantCredential, scopes: ['*'] }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_class_binding');
  });

  test('a tenant credential carrying a platform namespace is rejected as an invalid binding', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ authCredentials: [{ ...tenantCredential, scopes: ['platform:tenants:read'] }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_class_binding');
  });

  test('lineage belonging to another tenant is rejected', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ tenantKeyLineage: [{ ...activeLineage, tenantId: 'tenant-2' }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_class_binding');
  });

  test('auth-index authority that drifts from lineage fails closed', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ tenantKeyLineage: [{ ...activeLineage, scopes: ['tenant:read'] }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_class_binding');
  });

  test('auth-index role that drifts from lineage fails closed', async () => {
    const svc = new AuthBootstrapService(
      makeDb(tenantRows({ tenantKeyLineage: [{ ...activeLineage, actorRole: 'tenant-viewer' }] })),
    );
    const r = await svc.lookupBySecretHash('hash-1', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_role_binding');
  });
});

describe('AuthBootstrapService — platform class', () => {
  const platformCredential = {
    id: 'cred-p',
    credentialClass: 'platform',
    keyHash: 'hash-p',
    keyPrefix: 'pfx',
    tenantId: null,
    principalId: 'prin-p',
    membershipId: null,
    actorRole: null,
    scopes: ['platform:tenants:write'],
    status: 'active',
    tenantKeyLineageId: null,
    platformApiKeyId: 'pk-1',
    policySnapshotVersion: 1,
    revocationEpochSnapshot: 0,
    expiresAt: null,
    revokedAt: null,
  };
  const activePlatformKey = {
    id: 'pk-1',
    principalId: 'prin-p',
    keyHash: 'hash-p',
    scopes: ['platform:tenants:write'],
    status: 'active',
    expiresAt: null,
    revokedAt: null,
  };

  test('resolves a frozen platform context with no tenant authority', async () => {
    const svc = new AuthBootstrapService(
      makeDb({
        authCredentials: [platformCredential],
        platformApiKeys: [activePlatformKey],
        principals: [{ id: 'prin-p', status: 'active' }],
      }),
    );
    const r = await svc.lookupBySecretHash('hash-p', 'req-p');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.context.credentialClass).toBe('platform');
    if (r.context.credentialClass !== 'platform') return;
    expect(r.context.platformApiKeyId).toBe('pk-1');
    expect(r.context.targetTenantId).toBeNull();
    expect(Object.isFrozen(r.context)).toBe(true);
  });

  test('platform credential leaking a tenant binding is rejected', async () => {
    const svc = new AuthBootstrapService(
      makeDb({ authCredentials: [{ ...platformCredential, tenantId: 'tenant-1' }] }),
    );
    const r = await svc.lookupBySecretHash('hash-p', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_class_binding');
  });

  test('platform credential leaking a tenant membership binding is rejected', async () => {
    const svc = new AuthBootstrapService(
      makeDb({
        authCredentials: [{ ...platformCredential, membershipId: 'mem-tenant' }],
        platformApiKeys: [activePlatformKey],
        principals: [{ id: 'prin-p', status: 'active' }],
      }),
    );
    const r = await svc.lookupBySecretHash('hash-p', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_class_binding');
  });

  test('revoked platform source key fails closed even when the auth-index row is stale-active', async () => {
    const svc = new AuthBootstrapService(
      makeDb({
        authCredentials: [platformCredential],
        platformApiKeys: [{ ...activePlatformKey, status: 'revoked', revokedAt: new Date() }],
        principals: [{ id: 'prin-p', status: 'active' }],
      }),
    );
    const r = await svc.lookupBySecretHash('hash-p', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('credential_revoked');
  });

  test('platform source/auth-index scope drift fails closed', async () => {
    const svc = new AuthBootstrapService(
      makeDb({
        authCredentials: [platformCredential],
        platformApiKeys: [{ ...activePlatformKey, scopes: ['platform:tenants:read'] }],
        principals: [{ id: 'prin-p', status: 'active' }],
      }),
    );
    const r = await svc.lookupBySecretHash('hash-p', 'req');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_class_binding');
  });
});
