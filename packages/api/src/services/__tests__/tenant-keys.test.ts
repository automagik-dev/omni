/**
 * Transactional tenant child-key creation tests
 * (wish: omni-full-multitenancy, Group G1; ADR-0006).
 *
 * A fake transactional DB captures the rows written so we can prove the
 * service enforces delegation ceilings at the write boundary and never writes
 * a `*` scope or crosses tenants.
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import {
  authCredentials,
  platformApiKeys,
  platformAuditLogs,
  principals,
  tenantAuditLogs,
  tenantKeyLineage,
  tenantMemberships,
  tenants,
} from '@omni/db';
import { TenantKeyService } from '../tenant-keys';

interface Captured {
  lineageInserts: Record<string, unknown>[];
  credentialInserts: Record<string, unknown>[];
  auditInserts: Record<string, unknown>[];
  updates: { table: unknown; values: Record<string, unknown> }[];
  selections: unknown[];
}

function rowAsRows(row: Record<string, unknown> | null | undefined): Record<string, unknown>[] {
  return row ? [row] : [];
}

function makeTxDb(
  parent: Record<string, unknown> | null,
  tenant: Record<string, unknown> | null,
  subjects: {
    principal?: Record<string, unknown> | null;
    membership?: Record<string, unknown> | null;
    parentCredential?: Record<string, unknown> | null;
    platformKey?: Record<string, unknown> | null;
    platformPrincipal?: Record<string, unknown> | null;
    actorLineage?: Record<string, unknown> | null;
  } = {},
): {
  db: Database;
  captured: Captured;
} {
  const captured: Captured = {
    lineageInserts: [],
    credentialInserts: [],
    auditInserts: [],
    updates: [],
    selections: [],
  };
  const defaultParentCredential =
    parent && tenant
      ? {
          id: 'cred-1',
          credentialClass: 'tenant',
          tenantId: parent.tenantId,
          principalId: parent.principalId,
          membershipId: parent.membershipId,
          actorRole: parent.actorRole,
          keyPrefix: parent.keyPrefix,
          scopes: parent.scopes,
          status: 'active',
          tenantKeyLineageId: parent.id,
          platformApiKeyId: null,
          policySnapshotVersion: tenant.policyVersion,
          revocationEpochSnapshot: tenant.revocationEpoch,
          expiresAt: parent.expiresAt,
          revokedAt: null,
        }
      : null;
  const parentCredential =
    subjects.parentCredential === undefined ? defaultParentCredential : subjects.parentCredential;
  let lineageReadCount = 0;
  let principalReadCount = 0;
  const rowsByTable = new Map<unknown, Record<string, unknown> | null | undefined>([
    [tenantKeyLineage, parent],
    [tenants, tenant],
    [tenantMemberships, subjects.membership === undefined ? activeMembership : subjects.membership],
    [authCredentials, parentCredential],
    [platformApiKeys, subjects.platformKey === undefined ? activePlatformKey : subjects.platformKey],
  ]);
  const platformPrincipal =
    subjects.platformPrincipal === undefined ? activePlatformPrincipal : subjects.platformPrincipal;
  const tenantPrincipal = subjects.principal === undefined ? activePrincipal : subjects.principal;
  const rowsFor = (t: unknown): unknown[] => {
    if (t === tenantKeyLineage && subjects.actorLineage !== undefined) {
      const row = lineageReadCount++ === 0 ? parent : subjects.actorLineage;
      return rowAsRows(row);
    }
    if (t === principals) {
      const usePlatformPrincipal = parentCredential?.credentialClass === 'platform' && principalReadCount++ === 0;
      return rowAsRows(usePlatformPrincipal ? platformPrincipal : tenantPrincipal);
    }
    return rowAsRows(rowsByTable.get(t));
  };

  const tx = {
    select() {
      let current: unknown[] = [];
      // `limit()` returns a native Promise (awaitable) augmented with `.for()`
      // so both `await ...limit(1)` and `...limit(1).for('update')` resolve the
      // configured rows — without defining a lint-flagged `then` property.
      const chain = {
        from(t: unknown) {
          captured.selections.push(t);
          current = rowsFor(t);
          return chain;
        },
        where() {
          return chain;
        },
        limit() {
          return Object.assign(Promise.resolve(current), { for: () => Promise.resolve(current) });
        },
      };
      return chain;
    },
    insert(t: unknown) {
      return {
        values(v: Record<string, unknown>) {
          if (t === tenantKeyLineage) captured.lineageInserts.push(v);
          if (t === authCredentials) captured.credentialInserts.push(v);
          if (t === tenantAuditLogs || t === platformAuditLogs) captured.auditInserts.push(v);
          const p = Promise.resolve([{ ...v, id: (v.id as string) ?? 'generated-id' }]);
          return Object.assign(p, {
            returning: () => Promise.resolve([{ ...v, id: (v.id as string) ?? 'generated-id' }]),
          });
        },
      };
    },
    update(t: unknown) {
      return {
        set(values: Record<string, unknown>) {
          captured.updates.push({ table: t, values });
          return { where: async () => [] };
        },
      };
    },
  };

  const db = {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
  return { db, captured };
}

const activeTenant = {
  id: 'tenant-1',
  status: 'active',
  policyVersion: 2,
  revocationEpoch: 5,
  maxKeyTtlSeconds: 3_600,
  maxKeyRateLimit: 100,
  maxKeyBudget: 1_000,
};
const activePrincipal = { id: 'prin-1', status: 'active' };
const activePlatformPrincipal = { id: 'platform-principal-1', status: 'active' };
const activeMembership = {
  id: 'mem-1',
  tenantId: 'tenant-1',
  principalId: 'prin-1',
  role: 'tenant-admin',
  status: 'active',
};
const parentKey = {
  id: 'parent-1',
  tenantId: 'tenant-1',
  principalId: 'prin-1',
  membershipId: 'mem-1',
  actorRole: 'tenant-admin',
  keyPrefix: 'parent-prefix',
  scopes: ['tenant:read', 'tenant:write', 'keys:delegate'],
  resourceConstraints: {},
  depth: 0,
  rootKeyId: 'parent-1',
  expiresAt: new Date('2099-01-01T00:00:00Z'),
  rateLimit: 100,
  budget: 1_000,
  status: 'active',
  revocationEpoch: 5,
  ancestorRevoked: false,
};
const activeParentCredential = {
  id: 'cred-1',
  credentialClass: 'tenant',
  tenantId: 'tenant-1',
  principalId: 'prin-1',
  membershipId: 'mem-1',
  actorRole: 'tenant-admin',
  keyPrefix: 'parent-prefix',
  scopes: ['tenant:read', 'tenant:write', 'keys:delegate'],
  status: 'active',
  tenantKeyLineageId: 'parent-1',
  platformApiKeyId: null,
  policySnapshotVersion: 2,
  revocationEpochSnapshot: 5,
  expiresAt: new Date('2099-01-01T00:00:00Z'),
  revokedAt: null,
};

const tenantActor = {
  credentialClass: 'tenant' as const,
  requestId: 'req-1',
  principalId: 'prin-1',
  credentialId: 'cred-1',
  tenantId: 'tenant-1',
  actorRole: 'tenant-admin' as const,
  scopes: ['tenant:read', 'tenant:write', 'keys:delegate'],
  membershipId: 'mem-1',
  resourceConstraints: {},
  expiresAt: new Date('2099-01-01T00:00:00Z'),
  rateLimit: 100,
  budget: 1_000,
  delegationDepth: 0,
  rootKeyId: 'parent-1',
  policyVersion: 2,
  revocationEpoch: 5,
  tenantKeyLineageId: 'parent-1',
};

const platformActor = {
  credentialClass: 'platform' as const,
  requestId: 'req-1',
  principalId: 'platform-principal-1',
  credentialId: 'platform-credential-1',
  scopes: ['platform:tenants:write'],
  platformApiKeyId: 'platform-key-1',
  platformAction: 'tenant_key.issue_root',
  targetTenantId: 'tenant-1',
};

const activePlatformCredential = {
  id: 'platform-credential-1',
  credentialClass: 'platform',
  tenantId: null,
  principalId: 'platform-principal-1',
  membershipId: null,
  actorRole: null,
  keyHash: 'platform-hash',
  keyPrefix: 'platform-prefix',
  scopes: ['platform:tenants:write'],
  status: 'active',
  tenantKeyLineageId: null,
  platformApiKeyId: 'platform-key-1',
  policySnapshotVersion: 1,
  revocationEpochSnapshot: 0,
  expiresAt: null,
  revokedAt: null,
};
const activePlatformKey = {
  id: 'platform-key-1',
  principalId: 'platform-principal-1',
  keyHash: 'platform-hash',
  keyPrefix: 'platform-prefix',
  scopes: ['platform:tenants:write'],
  status: 'active',
  expiresAt: null,
  revokedAt: null,
};

function validRootOptions() {
  return {
    actor: platformActor,
    tenantId: 'tenant-1',
    actorRole: 'tenant-admin' as const,
    name: 'root',
    reason: 'approved root credential issuance',
    scopes: ['tenant:read'],
    principalId: 'prin-1',
    membershipId: 'mem-1',
    expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
    rateLimit: 50,
    budget: 500,
  };
}

describe('TenantKeyService.createChildKey', () => {
  test('creates a bounded child, fixed to the parent tenant, snapshotting epochs', async () => {
    const { db, captured } = makeTxDb(parentKey, activeTenant);
    const svc = new TenantKeyService(db);
    const result = await svc.createChildKey({
      actor: tenantActor,
      parentKeyId: 'parent-1',
      name: 'child',
      reason: 'approved child credential delegation',
      request: { scopes: ['tenant:read'] },
    });
    expect(result.status).toBe('created');
    const lineage = captured.lineageInserts[0];
    if (!lineage) throw new Error('expected a lineage insert');
    expect(lineage.tenantId).toBe('tenant-1'); // §1
    expect(lineage.parentKeyId).toBe('parent-1'); // §7
    expect(lineage.rootKeyId).toBe('parent-1'); // §7
    expect(lineage.depth).toBe(1); // §6
    expect(lineage.scopes).toEqual(['tenant:read']); // §2
    // The credential index row is written in the SAME transaction with class=tenant.
    const cred = captured.credentialInserts[0];
    if (!cred) throw new Error('expected a credential insert');
    expect(cred.credentialClass).toBe('tenant');
    expect(cred.policySnapshotVersion).toBe(2);
    expect(cred.revocationEpochSnapshot).toBe(5);
    expect(cred.scopes).not.toContain('*');
    expect(captured.auditInserts).toContainEqual(
      expect.objectContaining({ action: 'tenant_key.create_child', targetId: expect.any(String) }),
    );
  });

  test('denies a `*` request and writes nothing', async () => {
    const { db, captured } = makeTxDb(parentKey, activeTenant);
    const svc = new TenantKeyService(db);
    const result = await svc.createChildKey({
      actor: tenantActor,
      parentKeyId: 'parent-1',
      name: 'evil',
      reason: 'malicious delegation attempt',
      request: { scopes: ['*'] },
    });
    expect(result.status).toBe('denied');
    if (result.status === 'denied') expect(result.violations.join(' ')).toContain('platform/wildcard');
    expect(captured.lineageInserts).toHaveLength(0);
    expect(captured.credentialInserts).toHaveLength(0);
  });

  test('denies scope escalation beyond parent', async () => {
    const { db, captured } = makeTxDb(parentKey, activeTenant);
    const svc = new TenantKeyService(db);
    const result = await svc.createChildKey({
      actor: tenantActor,
      parentKeyId: 'parent-1',
      name: 'wide',
      reason: 'scope escalation attempt',
      request: { scopes: ['tenant:admin'] },
    });
    expect(result.status).toBe('denied');
    expect(captured.credentialInserts).toHaveLength(0);
  });

  test('denies delegation for a suspended tenant', async () => {
    const { db } = makeTxDb(parentKey, { ...activeTenant, status: 'suspended' });
    const svc = new TenantKeyService(db);
    const result = await svc.createChildKey({
      actor: tenantActor,
      parentKeyId: 'parent-1',
      name: 'child',
      reason: 'approved child credential delegation',
      request: { scopes: ['tenant:read'] },
    });
    expect(result.status).toBe('denied');
  });

  test('unknown parent → parent_not_found', async () => {
    const { db } = makeTxDb(null, activeTenant);
    const svc = new TenantKeyService(db);
    const result = await svc.createChildKey({
      actor: tenantActor,
      parentKeyId: 'missing',
      name: 'child',
      reason: 'approved child credential delegation',
      request: { scopes: ['tenant:read'] },
    });
    expect(result.status).toBe('parent_not_found');
  });

  test('denies delegation from a stale parent auth-index epoch', async () => {
    const { db, captured } = makeTxDb(parentKey, activeTenant, {
      parentCredential: { ...activeParentCredential, revocationEpochSnapshot: 4 },
    });
    const result = await new TenantKeyService(db).createChildKey({
      actor: tenantActor,
      parentKeyId: 'parent-1',
      name: 'stale-child',
      reason: 'stale delegation attempt',
      request: { scopes: ['tenant:read'] },
    });
    expect(result).toEqual({ status: 'denied', violations: ['parent revocation epoch is stale'] });
    expect(captured.lineageInserts).toHaveLength(0);
    expect(captured.credentialInserts).toHaveLength(0);
  });

  test('denies a child whose requested role exceeds the bound membership role', async () => {
    const { db, captured } = makeTxDb(parentKey, activeTenant, {
      principal: activePrincipal,
      membership: { ...activeMembership, role: 'tenant-viewer' },
    });
    const result = await new TenantKeyService(db).createChildKey({
      actor: tenantActor,
      parentKeyId: 'parent-1',
      name: 'escalated-child',
      reason: 'role escalation attempt',
      request: { role: 'tenant-admin', scopes: ['tenant:read'] },
    });
    expect(result).toEqual({ status: 'denied', violations: ['membership role does not match issued role'] });
    expect(captured.lineageInserts).toHaveLength(0);
    expect(captured.credentialInserts).toHaveLength(0);
  });

  test('denies child creation when the authenticated actor does not possess the parent credential', async () => {
    const { db, captured } = makeTxDb(parentKey, activeTenant);
    const result = await new TenantKeyService(db).createChildKey({
      actor: { ...tenantActor, credentialId: 'other-credential' },
      parentKeyId: 'parent-1',
      name: 'unauthorized-child',
      reason: 'unauthorized delegation attempt',
      request: { scopes: ['tenant:read'] },
    });
    expect(result).toEqual({ status: 'denied', violations: ['tenant actor credential binding is invalid'] });
    expect(captured.lineageInserts).toHaveLength(0);
  });

  test('a cross-tenant parent id is non-enumerating and never reaches delegation evaluation', async () => {
    const crossTenantParent = { ...parentKey, tenantId: 'tenant-other' };
    const crossTenant = { ...activeTenant, id: 'tenant-other' };
    const { db, captured } = makeTxDb(crossTenantParent, crossTenant);
    const result = await new TenantKeyService(db).createChildKey({
      actor: tenantActor,
      parentKeyId: 'parent-1',
      name: 'cross-tenant-child',
      reason: 'cross tenant attempt',
      request: { scopes: ['tenant:read'] },
    });

    expect(result).toEqual({ status: 'parent_not_found' });
    expect(captured.lineageInserts).toHaveLength(0);
    expect(captured.credentialInserts).toHaveLength(0);
    expect(captured.auditInserts).toHaveLength(0);
  });

  test('denies delegation when the live parent lacks keys:delegate', async () => {
    const parentWithoutDelegate = { ...parentKey, scopes: ['tenant:read', 'tenant:write'] };
    const credentialWithoutDelegate = { ...activeParentCredential, scopes: ['tenant:read', 'tenant:write'] };
    const { db, captured } = makeTxDb(parentWithoutDelegate, activeTenant, {
      parentCredential: credentialWithoutDelegate,
    });
    const result = await new TenantKeyService(db).createChildKey({
      actor: { ...tenantActor, scopes: ['tenant:read', 'tenant:write'] },
      parentKeyId: 'parent-1',
      name: 'unauthorized-child',
      reason: 'unauthorized delegation attempt',
      request: { scopes: ['tenant:read'] },
    });
    expect(result).toEqual({ status: 'denied', violations: ['tenant actor lacks keys:delegate capability'] });
    expect(captured.lineageInserts).toHaveLength(0);
  });
});

describe('TenantKeyService.issueRootKey', () => {
  test('rejects a revoked canonical platform source before writing a root credential', async () => {
    const { db, captured } = makeTxDb(null, activeTenant, {
      parentCredential: activePlatformCredential,
      platformKey: { ...activePlatformKey, status: 'revoked', revokedAt: new Date() },
    });

    await expect(new TenantKeyService(db).issueRootKey(validRootOptions())).rejects.toThrow(
      'platform actor source key is revoked',
    );
    expect(captured.lineageInserts).toHaveLength(0);
    expect(captured.credentialInserts).toHaveLength(0);
    expect(captured.auditInserts).toHaveLength(0);
  });

  test('creates a root key without storing its secret hash in tenant-visible lineage', async () => {
    const { db, captured } = makeTxDb(null, activeTenant, { parentCredential: activePlatformCredential });
    const issued = await new TenantKeyService(db).issueRootKey(validRootOptions());
    expect(issued.lineage.depth).toBe(0);
    expect(captured.lineageInserts[0]).not.toHaveProperty('keyHash');
    expect(captured.credentialInserts[0]).toHaveProperty('keyHash');
    expect(captured.auditInserts).toContainEqual(
      expect.objectContaining({ action: 'tenant_key.issue_root', reason: 'approved root credential issuance' }),
    );
  });

  test('rejects platform scope and writes nothing', async () => {
    const { db, captured } = makeTxDb(null, activeTenant, { parentCredential: activePlatformCredential });
    await expect(
      new TenantKeyService(db).issueRootKey({ ...validRootOptions(), scopes: ['platform:tenants:write'] }),
    ).rejects.toThrow('platform/wildcard');
    expect(captured.lineageInserts).toHaveLength(0);
    expect(captured.credentialInserts).toHaveLength(0);
  });

  test('rejects scopes outside the root role ceiling', async () => {
    const { db, captured } = makeTxDb(null, activeTenant, { parentCredential: activePlatformCredential });
    await expect(
      new TenantKeyService(db).issueRootKey({
        ...validRootOptions(),
        actorRole: 'tenant-viewer',
        scopes: ['tenant:write'],
      }),
    ).rejects.toThrow('role ceiling');
    expect(captured.lineageInserts).toHaveLength(0);
  });

  test('rejects malformed limits and expiry', async () => {
    const { db, captured } = makeTxDb(null, activeTenant, { parentCredential: activePlatformCredential });
    await expect(
      new TenantKeyService(db).issueRootKey({
        ...validRootOptions(),
        rateLimit: -1,
        budget: 0,
        expiresAt: new Date('2000-01-01T00:00:00Z'),
      }),
    ).rejects.toThrow('invalid root key request');
    expect(captured.lineageInserts).toHaveLength(0);
  });

  test('rejects a root key whose issued role exceeds the bound membership role', async () => {
    const { db, captured } = makeTxDb(null, activeTenant, {
      principal: activePrincipal,
      membership: { ...activeMembership, role: 'tenant-viewer' },
      parentCredential: activePlatformCredential,
    });
    await expect(
      new TenantKeyService(db).issueRootKey({ ...validRootOptions(), name: 'escalated-root' }),
    ).rejects.toThrow('membership role does not match issued role');
    expect(captured.lineageInserts).toHaveLength(0);
    expect(captured.credentialInserts).toHaveLength(0);
  });

  test('a cross-tenant membership id is indistinguishable from an unknown membership', async () => {
    const { db, captured } = makeTxDb(null, activeTenant, {
      principal: activePrincipal,
      membership: { ...activeMembership, id: 'membership-other', tenantId: 'tenant-other' },
      parentCredential: activePlatformCredential,
    });

    await expect(
      new TenantKeyService(db).issueRootKey({
        ...validRootOptions(),
        membershipId: 'membership-other',
        name: 'cross-tenant-subject-root',
      }),
    ).rejects.toThrow('invalid root key subject: membership not found');
    expect(captured.lineageInserts).toHaveLength(0);
    expect(captured.credentialInserts).toHaveLength(0);
    expect(captured.auditInserts).toHaveLength(0);
    expect(captured.selections.filter((table) => table === principals)).toHaveLength(1);
  });

  test('rejects a root key above the locked tenant policy ceilings', async () => {
    const { db, captured } = makeTxDb(null, activeTenant, { parentCredential: activePlatformCredential });
    await expect(
      new TenantKeyService(db).issueRootKey({
        ...validRootOptions(),
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1_000),
        rateLimit: 101,
        budget: 1_001,
      }),
    ).rejects.toThrow('exceeds tenant policy');
    expect(captured.lineageInserts).toHaveLength(0);
  });

  test('rejects a platform actor not bound to the target tenant', async () => {
    const { db, captured } = makeTxDb(null, activeTenant, { parentCredential: activePlatformCredential });
    await expect(
      new TenantKeyService(db).issueRootKey({
        ...validRootOptions(),
        actor: { ...platformActor, targetTenantId: 'tenant-other' },
      }),
    ).rejects.toThrow('target tenant binding');
    expect(captured.lineageInserts).toHaveLength(0);
  });
});

describe('TenantKeyService.revokeKey', () => {
  test('rejects a disabled acting principal before revoking another key', async () => {
    const actorLineage = { ...parentKey, id: 'actor-lineage-1', rootKeyId: 'actor-lineage-1' };
    const actorCredential = {
      ...activeParentCredential,
      id: 'actor-credential-1',
      tenantKeyLineageId: 'actor-lineage-1',
    };
    const { db, captured } = makeTxDb({ ...parentKey, id: 'target-key-1' }, activeTenant, {
      actorLineage,
      parentCredential: actorCredential,
      principal: { ...activePrincipal, status: 'disabled' },
    });

    await expect(
      new TenantKeyService(db).revokeKey({
        actor: {
          ...tenantActor,
          credentialId: 'actor-credential-1',
          tenantKeyLineageId: 'actor-lineage-1',
          rootKeyId: 'actor-lineage-1',
        },
        lineageId: 'target-key-1',
        reason: 'approved target credential revocation',
      }),
    ).rejects.toThrow('tenant actor principal is not active');
    expect(captured.updates).toHaveLength(0);
    expect(captured.auditInserts).toHaveLength(0);
  });

  test('atomically revokes only the key lineage and descendants, then audits the reason', async () => {
    const { db, captured } = makeTxDb(parentKey, activeTenant);
    const result = await new TenantKeyService(db).revokeKey({
      actor: tenantActor,
      lineageId: 'parent-1',
      reason: 'operator-requested credential rotation',
    });

    expect(result).toEqual({ status: 'revoked', lineageId: 'parent-1', tenantId: 'tenant-1' });
    expect(captured.updates).toContainEqual({
      table: tenantKeyLineage,
      values: { ancestorRevoked: true },
    });
    expect(captured.updates.some((u) => u.table === authCredentials && u.values.status === 'revoked')).toBe(true);
    expect(captured.updates.some((u) => u.table === tenants)).toBe(false);
    expect(captured.auditInserts).toContainEqual(
      expect.objectContaining({
        action: 'tenant_key.revoke',
        targetId: 'parent-1',
        metadata: expect.objectContaining({ reason: 'operator-requested credential rotation' }),
      }),
    );
  });

  test('rejects a missing reason before opening a transaction', async () => {
    const { db } = makeTxDb(parentKey, activeTenant);
    await expect(
      new TenantKeyService(db).revokeKey({
        actor: tenantActor,
        lineageId: 'parent-1',
        reason: ' ',
      }),
    ).rejects.toThrow('reason is required');
  });

  test('a cross-tenant revocation target is non-enumerating and never mutated', async () => {
    const { db, captured } = makeTxDb(parentKey, activeTenant);
    const result = await new TenantKeyService(db).revokeKey({
      actor: { ...tenantActor, tenantId: 'tenant-other' },
      lineageId: 'parent-1',
      reason: 'cross tenant attempt',
    });

    expect(result).toEqual({ status: 'not_found' });
    expect(captured.updates).toHaveLength(0);
    expect(captured.auditInserts).toHaveLength(0);
  });
});
