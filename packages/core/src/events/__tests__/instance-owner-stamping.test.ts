/**
 * Producer-side tenant derivation for PLUGIN-ORIGINATED publishes
 * (wish: omni-full-multitenancy, Group G5; ADR-0008).
 *
 * THE GAP THIS CLOSES
 * -------------------
 * Leg A gave every publish a versioned envelope and wired
 * `setEnvelopeTenantResolver` to the per-request tenant scope. That covers
 * request-originated publishes. It does NOT cover the dominant traffic path:
 * `BaseChannelPlugin.publishEventInternal` emits `message.received`,
 * `instance.connected`, `reaction.received` and friends from a socket callback
 * with no request and no scope, so `resolveAmbientTenantId()` returned null and
 * every such envelope classified `legacy`. The consumers legs A–E converted
 * therefore never entered the tenant world for real channel traffic.
 *
 * ADR-0008 names the derivation: "Publishers derive tenant from authenticated/
 * loaded resources, never caller claims", and `envelope.ts`'s own subject
 * rationale already says it — "Instances carry their tenant (G2,
 * `instances.tenant_id`), so the tenant is derivable at PUBLISH time from the
 * loaded instance". This seam is that derivation: a resolver the API layer
 * registers, mapping an instanceId to the tenant its PERSISTED `instances` row
 * carries. It is not a caller claim and not an ambient inheritance.
 *
 * PRECEDENCE, and why it is in this order:
 *   1. an EXPLICIT `metadata.tenantId` — a worker/consumer republish that
 *      already derived the tenant from its own loaded resource;
 *   2. the REQUEST scope — the authenticated caller's tenant, which the edge
 *      already validated;
 *   3. the INSTANCE OWNER registry — the plugin/worker case, where neither of
 *      the above exists.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  CURRENT_ENVELOPE_VERSION,
  classifyEnvelope,
  resolveInstanceOwnerTenantId,
  resolvePublishTenantId,
  setEnvelopeInstanceTenantResolver,
  setEnvelopeTenantResolver,
} from '../envelope';

const TENANT_OWNER = '11111111-1111-4111-8111-111111111ee1';
const TENANT_REQUEST = '22222222-2222-4222-8222-222222222ee2';
const TENANT_EXPLICIT = '33333333-3333-4333-8333-333333333ee3';
const INSTANCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaee1';

describe('producer-side instance-owner tenant derivation', () => {
  beforeEach(() => {
    setEnvelopeTenantResolver(null);
    setEnvelopeInstanceTenantResolver(null);
  });

  test('with nothing registered, a plugin publish stamps nothing (flag-off is byte-identical)', () => {
    expect(resolveInstanceOwnerTenantId(INSTANCE)).toBeNull();
    expect(resolvePublishTenantId(undefined, INSTANCE)).toBeNull();
  });

  test('a registered owner resolver supplies the tenant for a scope-less plugin publish', () => {
    setEnvelopeInstanceTenantResolver((instanceId) => (instanceId === INSTANCE ? TENANT_OWNER : null));

    expect(resolveInstanceOwnerTenantId(INSTANCE)).toBe(TENANT_OWNER);
    expect(resolvePublishTenantId(undefined, INSTANCE)).toBe(TENANT_OWNER);

    // An instance the registry does not know stays legacy rather than borrowing
    // some other instance's tenant.
    expect(resolvePublishTenantId(undefined, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbee9')).toBeNull();
    // And a publish with no instance at all has nothing to derive from.
    expect(resolvePublishTenantId(undefined, undefined)).toBeNull();
  });

  test('an explicit metadata tenant wins over both resolvers', () => {
    setEnvelopeTenantResolver(() => TENANT_REQUEST);
    setEnvelopeInstanceTenantResolver(() => TENANT_OWNER);

    expect(resolvePublishTenantId(TENANT_EXPLICIT, INSTANCE)).toBe(TENANT_EXPLICIT);
  });

  test('the request scope wins over the owner registry', () => {
    setEnvelopeTenantResolver(() => TENANT_REQUEST);
    setEnvelopeInstanceTenantResolver(() => TENANT_OWNER);

    expect(resolvePublishTenantId(undefined, INSTANCE)).toBe(TENANT_REQUEST);
  });

  test('a malformed owner tenant is refused, not stamped', () => {
    setEnvelopeInstanceTenantResolver(() => 'not-a-uuid');
    expect(resolveInstanceOwnerTenantId(INSTANCE)).toBeNull();
    expect(resolvePublishTenantId(undefined, INSTANCE)).toBeNull();

    // An explicit non-UUID claim is likewise refused and falls through — a
    // producer must never be able to stamp a value a consumer would then trust.
    setEnvelopeInstanceTenantResolver(() => TENANT_OWNER);
    expect(resolvePublishTenantId('../../etc/passwd', INSTANCE)).toBe(TENANT_OWNER);
  });

  test('a throwing resolver degrades to legacy rather than failing the publish', () => {
    setEnvelopeInstanceTenantResolver(() => {
      throw new Error('registry exploded');
    });
    expect(resolveInstanceOwnerTenantId(INSTANCE)).toBeNull();
  });

  test('a stamped plugin envelope classifies as `tenant` end-to-end', () => {
    setEnvelopeInstanceTenantResolver(() => TENANT_OWNER);
    const tenantId = resolvePublishTenantId(undefined, INSTANCE);
    expect(tenantId).not.toBeNull();

    const classification = classifyEnvelope({
      correlationId: 'c',
      traceId: 't',
      instanceId: INSTANCE,
      ...(tenantId ? { envelopeVersion: CURRENT_ENVELOPE_VERSION, tenantId } : {}),
    });
    expect(classification).toEqual({
      world: 'tenant',
      tenantId: TENANT_OWNER,
      envelopeVersion: CURRENT_ENVELOPE_VERSION,
    });
  });
});
