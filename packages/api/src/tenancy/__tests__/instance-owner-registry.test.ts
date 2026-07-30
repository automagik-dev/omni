/**
 * The instance→tenant ownership registry that lets a channel plugin's publish
 * stamp a trusted tenant (wish: omni-full-multitenancy, Group G5; ADR-0008).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { resolveInstanceOwnerTenantId, setEnvelopeInstanceTenantResolver } from '@omni/core';
import {
  INSTANCE_OWNER_REGISTRY_MAX_ENTRIES,
  __resetInstanceOwnerRegistry,
  forgetInstanceOwner,
  installInstanceOwnerResolver,
  instanceOwnerRegistrySize,
  lookupInstanceOwner,
  rememberInstanceOwner,
  rememberInstanceOwners,
} from '../instance-owner-registry';

const TENANT_A = '11111111-1111-4111-8111-111111111fa1';
const TENANT_B = '22222222-2222-4222-8222-222222222fb2';
const INSTANCE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaafa1';
const INSTANCE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbfb2';

afterEach(() => {
  __resetInstanceOwnerRegistry();
  setEnvelopeInstanceTenantResolver(null);
});

describe('instance owner registry', () => {
  test('remembers a loaded instance row’s persisted tenant and hands it back', () => {
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: TENANT_A });
    expect(lookupInstanceOwner(INSTANCE_A)).toBe(TENANT_A);
    expect(lookupInstanceOwner(INSTANCE_B)).toBeNull();
  });

  test('a NULL-tenant row (flag-off / pre-backfill) is remembered as ABSENT, never as a tenant', () => {
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: null });
    expect(lookupInstanceOwner(INSTANCE_A)).toBeNull();
    expect(instanceOwnerRegistrySize()).toBe(0);
  });

  test('a malformed tenant is refused — the registry cannot be poisoned into stamping one', () => {
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: 'not-a-uuid' });
    rememberInstanceOwner({ id: INSTANCE_B, tenantId: '' });
    expect(lookupInstanceOwner(INSTANCE_A)).toBeNull();
    expect(lookupInstanceOwner(INSTANCE_B)).toBeNull();
    expect(instanceOwnerRegistrySize()).toBe(0);
  });

  test('re-remembering the same instance under a DIFFERENT tenant is refused', () => {
    // An instance's tenant is its ownership ROOT and does not change. A second,
    // conflicting derivation means something upstream is wrong; silently taking
    // the newer value would let one bad read redirect a live instance's whole
    // event stream into another tenant.
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: TENANT_A });
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: TENANT_B });
    expect(lookupInstanceOwner(INSTANCE_A)).toBe(TENANT_A);
  });

  test('forget removes an entry (instance deleted)', () => {
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: TENANT_A });
    forgetInstanceOwner(INSTANCE_A);
    expect(lookupInstanceOwner(INSTANCE_A)).toBeNull();
  });

  test('bulk remember skips the rows it cannot use and keeps the rest', () => {
    rememberInstanceOwners([
      { id: INSTANCE_A, tenantId: TENANT_A },
      { id: INSTANCE_B, tenantId: null },
    ]);
    expect(lookupInstanceOwner(INSTANCE_A)).toBe(TENANT_A);
    expect(lookupInstanceOwner(INSTANCE_B)).toBeNull();
  });

  test('the registry is BOUNDED — it cannot grow without limit', () => {
    for (let i = 0; i < INSTANCE_OWNER_REGISTRY_MAX_ENTRIES + 50; i++) {
      rememberInstanceOwner({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`, tenantId: TENANT_A });
    }
    expect(instanceOwnerRegistrySize()).toBeLessThanOrEqual(INSTANCE_OWNER_REGISTRY_MAX_ENTRIES);
  });

  test('installing the resolver makes @omni/core’s publish path see the ownership', () => {
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: TENANT_A });
    installInstanceOwnerResolver();
    expect(resolveInstanceOwnerTenantId(INSTANCE_A)).toBe(TENANT_A);
    expect(resolveInstanceOwnerTenantId(INSTANCE_B)).toBeNull();
  });

  test('without installing, @omni/core stamps nothing (dual world)', () => {
    rememberInstanceOwner({ id: INSTANCE_A, tenantId: TENANT_A });
    expect(resolveInstanceOwnerTenantId(INSTANCE_A)).toBeNull();
  });
});
