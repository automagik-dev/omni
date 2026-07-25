/**
 * Transactional tenant control-plane boundary tests
 * (wish: omni-full-multitenancy, Group G1; ADR-0005/0006).
 */

import { describe, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { authCredentials, platformApiKeys, platformAuditLogs, principals, tenantMemberships, tenants } from '@omni/db';
import { type PlatformActor, TenantControlPlaneService } from '../tenant-control-plane';

interface Capture {
  locks: unknown[];
  inserts: { table: unknown; values: Record<string, unknown> }[];
  updates: { table: unknown; values: Record<string, unknown> }[];
}

function rowAsRows(row: Record<string, unknown> | null | undefined): Record<string, unknown>[] {
  return row ? [row] : [];
}

function makeDb(initial: {
  tenant?: Record<string, unknown>;
  membership?: Record<string, unknown>;
  authCredential?: Record<string, unknown> | null;
  platformKey?: Record<string, unknown> | null;
  principal?: Record<string, unknown> | null;
}): {
  db: Database;
  captured: Capture;
} {
  const captured: Capture = { locks: [], inserts: [], updates: [] };
  const rowsByTable = new Map<unknown, Record<string, unknown> | null | undefined>([
    [tenants, initial.tenant],
    [tenantMemberships, initial.membership],
    [authCredentials, initial.authCredential === undefined ? activePlatformCredential : initial.authCredential],
    [platformApiKeys, initial.platformKey === undefined ? activePlatformKey : initial.platformKey],
    [principals, initial.principal === undefined ? activePlatformPrincipal : initial.principal],
  ]);
  const rowsFor = (table: unknown): Record<string, unknown>[] => rowAsRows(rowsByTable.get(table));

  const tx = {
    select() {
      let table: unknown;
      let rows: Record<string, unknown>[] = [];
      const chain = {
        from(nextTable: unknown) {
          table = nextTable;
          rows = rowsFor(nextTable);
          return chain;
        },
        where() {
          return chain;
        },
        orderBy() {
          return chain;
        },
        limit() {
          return Object.assign(Promise.resolve(rows), {
            for: () => {
              captured.locks.push(table);
              return Promise.resolve(rows);
            },
          });
        },
      };
      return chain;
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          captured.inserts.push({ table, values });
          const row = { ...values, id: (values.id as string | undefined) ?? 'generated-id' };
          return Object.assign(Promise.resolve([row]), { returning: () => Promise.resolve([row]) });
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          captured.updates.push({ table, values });
          const base = rowsFor(table)[0] ?? {};
          const row = { ...base, ...values };
          const whereResult = Object.assign(Promise.resolve([]), { returning: () => Promise.resolve([row]) });
          return { where: () => whereResult };
        },
      };
    },
  };

  return {
    db: { transaction: async (fn: (transaction: unknown) => Promise<unknown>) => fn(tx) } as unknown as Database,
    captured,
  };
}

const tenant = {
  id: 'tenant-1',
  slug: 'acme',
  displayName: 'Acme',
  status: 'active',
  policyVersion: 1,
  revocationEpoch: 3,
  suspendedAt: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdByPrincipalId: null,
};
const membership = {
  id: 'membership-1',
  tenantId: 'tenant-1',
  principalId: 'principal-1',
  role: 'tenant-admin',
  status: 'active',
  invitedByPrincipalId: null,
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const activePlatformPrincipal = {
  id: 'platform-principal-1',
  type: 'service',
  subject: 'platform-service',
  displayName: 'Platform Service',
  status: 'active',
  disabledAt: null,
};
const activePlatformKey = {
  id: 'platform-key-1',
  principalId: 'platform-principal-1',
  keyHash: 'platform-hash',
  keyPrefix: 'platform-prefix',
  scopes: ['*'],
  status: 'active',
  expiresAt: null,
  revokedAt: null,
};
const activePlatformCredential = {
  id: 'platform-credential-1',
  credentialClass: 'platform',
  keyHash: 'platform-hash',
  keyPrefix: 'platform-prefix',
  tenantId: null,
  principalId: 'platform-principal-1',
  membershipId: null,
  actorRole: null,
  scopes: ['*'],
  status: 'active',
  tenantKeyLineageId: null,
  platformApiKeyId: 'platform-key-1',
  expiresAt: null,
  revokedAt: null,
};

function actor(action: string, targetTenantId: string | null = 'tenant-1'): PlatformActor {
  return {
    credentialClass: 'platform',
    principalId: 'platform-principal-1',
    credentialId: 'platform-credential-1',
    scopes: ['*'],
    platformApiKeyId: 'platform-key-1',
    requestId: 'request-1',
    platformAction: action,
    targetTenantId,
  };
}

describe('TenantControlPlaneService membership mutation boundary', () => {
  test('rejects a revoked canonical platform source before any lifecycle write', async () => {
    const { db, captured } = makeDb({
      tenant,
      platformKey: { ...activePlatformKey, status: 'revoked', revokedAt: new Date() },
    });

    await expect(
      new TenantControlPlaneService(db).suspendTenant('tenant-1', 'security suspension', actor('tenant.suspend')),
    ).rejects.toThrow('platform actor source key is revoked');
    expect(captured.updates).toHaveLength(0);
    expect(captured.inserts).toHaveLength(0);
  });

  test('attach locks the tenant and denies a suspended tenant before inserting', async () => {
    const { db, captured } = makeDb({ tenant: { ...tenant, status: 'suspended' } });
    const result = await new TenantControlPlaneService(db).attachMembership(
      {
        tenantId: 'tenant-1',
        principalId: 'principal-1',
        role: 'tenant-admin',
        invitedByPrincipalId: 'platform-principal-1',
      },
      actor('membership.attach'),
      'approved onboarding',
    );

    expect(result).toEqual({ status: 'conflict', message: 'tenant is suspended' });
    expect(captured.locks).toContain(tenants);
    expect(captured.inserts.some((entry) => entry.table === tenantMemberships)).toBe(false);
  });

  test('disable locks tenant before membership, bumps epoch, and appends an audit event', async () => {
    const { db, captured } = makeDb({ tenant, membership });
    const result = await new TenantControlPlaneService(db).setMembershipStatus(
      'membership-1',
      'disabled',
      'offboarding approved',
      actor('membership.status'),
    );

    expect(result.status).toBe('ok');
    expect(captured.locks).toEqual([authCredentials, platformApiKeys, principals, tenants, tenantMemberships]);
    expect(captured.updates.some((entry) => entry.table === tenants && 'revocationEpoch' in entry.values)).toBe(true);
    expect(captured.inserts).toContainEqual(
      expect.objectContaining({
        table: platformAuditLogs,
        values: expect.objectContaining({ action: 'membership.status', reason: 'offboarding approved' }),
      }),
    );
  });

  test('role mutation is denied while the tenant is suspended', async () => {
    const { db, captured } = makeDb({ tenant: { ...tenant, status: 'suspended' }, membership });
    const result = await new TenantControlPlaneService(db).setMembershipRole(
      'membership-1',
      'tenant-viewer',
      'least privilege',
      actor('membership.role'),
    );

    expect(result).toEqual({ status: 'conflict', message: 'tenant is suspended' });
    expect(captured.updates.some((entry) => entry.table === tenantMemberships)).toBe(false);
  });

  test('audit rejects a route/service action-binding mismatch', async () => {
    const { db, captured } = makeDb({ tenant, membership });
    await expect(
      new TenantControlPlaneService(db).setMembershipStatus(
        'membership-1',
        'disabled',
        'offboarding approved',
        actor('tenant.suspend'),
      ),
    ).rejects.toThrow('platform action binding mismatch');
    expect(captured.locks).toHaveLength(0);
    expect(captured.updates).toHaveLength(0);
    expect(captured.inserts).toHaveLength(0);
  });

  test('rejects a null target before touching the database', async () => {
    const { db, captured } = makeDb({ tenant, membership });
    await expect(
      new TenantControlPlaneService(db).setMembershipStatus(
        'membership-1',
        'disabled',
        'offboarding approved',
        actor('membership.status', null),
      ),
    ).rejects.toThrow('platform target tenant binding mismatch');
    expect(captured.locks).toHaveLength(0);
    expect(captured.updates).toHaveLength(0);
    expect(captured.inserts).toHaveLength(0);
  });

  test('a cross-tenant membership id is non-enumerating and never locks or mutates the target tenant', async () => {
    const { db, captured } = makeDb({ tenant, membership });
    const result = await new TenantControlPlaneService(db).setMembershipStatus(
      'membership-1',
      'disabled',
      'cross tenant attempt',
      actor('membership.status', 'tenant-other'),
    );

    expect(result).toEqual({ status: 'not_found' });
    expect(captured.locks).toEqual([authCredentials, platformApiKeys, principals]);
    expect(captured.updates).toHaveLength(0);
    expect(captured.inserts).toHaveLength(0);
  });
});
