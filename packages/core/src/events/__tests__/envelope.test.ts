/**
 * Versioned tenant-aware envelope — classification and stamping
 * (wish: omni-full-multitenancy, Group G5; ADR-0008).
 *
 * These are the RED-before-implement probes for the consumer-validation contract
 * ADR-0008 assigns to G5:
 *
 *   * every tenant-context publish carries a versioned envelope with a trusted
 *     `tenantId`;
 *   * consumers validate version + tenant BEFORE processing; an unknown version
 *     or a missing/ambiguous tenant is quarantined, never processed globally;
 *   * a truly legacy envelope (no version marker, no tenant) is processed exactly
 *     as today — the dual-world contract — and is NOT quarantined.
 */

import { describe, expect, test } from 'bun:test';
import { CURRENT_ENVELOPE_VERSION, KNOWN_ENVELOPE_VERSIONS, classifyEnvelope, stampTenantEnvelope } from '../envelope';
import type { EventMetadata } from '../types';

const TENANT = '11111111-1111-4111-8111-11111111111a';

function meta(overrides: Partial<EventMetadata> = {}): EventMetadata {
  return { correlationId: 'corr-1', ...overrides };
}

describe('envelope classification (consumer validation)', () => {
  test('a legacy envelope — no version, no tenant — is processed, not quarantined (dual world)', () => {
    expect(classifyEnvelope(meta())).toEqual({ world: 'legacy' });
  });

  test('a current-version envelope with a valid tenant is a tenant-context message', () => {
    const result = classifyEnvelope(meta({ envelopeVersion: CURRENT_ENVELOPE_VERSION, tenantId: TENANT }));
    expect(result).toEqual({ world: 'tenant', tenantId: TENANT, envelopeVersion: CURRENT_ENVELOPE_VERSION });
  });

  test('an UNKNOWN envelope version is quarantined — no global processing fallback', () => {
    const future = Math.max(...KNOWN_ENVELOPE_VERSIONS) + 99;
    const result = classifyEnvelope(meta({ envelopeVersion: future, tenantId: TENANT }));
    expect(result).toEqual({ world: 'quarantine', reason: 'unknown_version' });
  });

  test('a versioned envelope with NO tenant is quarantined (missing/ambiguous tenant)', () => {
    const result = classifyEnvelope(meta({ envelopeVersion: CURRENT_ENVELOPE_VERSION }));
    expect(result).toEqual({ world: 'quarantine', reason: 'missing_tenant' });
  });

  test('a versioned envelope with a non-UUID tenant is quarantined', () => {
    const result = classifyEnvelope(meta({ envelopeVersion: CURRENT_ENVELOPE_VERSION, tenantId: 'not-a-uuid' }));
    expect(result).toEqual({ world: 'quarantine', reason: 'invalid_tenant' });
  });

  test('a tenant claim WITHOUT the version marker is malformed and quarantined', () => {
    // An envelope asserting a tenant but omitting the version contract is not a
    // legacy envelope (those carry no tenant) — it is a forged/corrupt one.
    const result = classifyEnvelope(meta({ tenantId: TENANT }));
    expect(result).toEqual({ world: 'quarantine', reason: 'malformed_envelope' });
  });

  test('an empty-string tenant on a versioned envelope is missing, not invalid', () => {
    const result = classifyEnvelope(meta({ envelopeVersion: CURRENT_ENVELOPE_VERSION, tenantId: '' }));
    expect(result).toEqual({ world: 'quarantine', reason: 'missing_tenant' });
  });
});

describe('envelope stamping (trusted producer)', () => {
  test('stamping sets both the version and the trusted tenant, preserving other metadata', () => {
    const stamped = stampTenantEnvelope(meta({ instanceId: 'inst-1', source: 'omni-api' }), TENANT);
    expect(stamped.envelopeVersion).toBe(CURRENT_ENVELOPE_VERSION);
    expect(stamped.tenantId).toBe(TENANT);
    expect(stamped.instanceId).toBe('inst-1');
    expect(stamped.source).toBe('omni-api');
  });

  test('a stamped envelope classifies as a tenant-context message — the round trip', () => {
    const stamped = stampTenantEnvelope(meta(), TENANT);
    expect(classifyEnvelope(stamped)).toEqual({
      world: 'tenant',
      tenantId: TENANT,
      envelopeVersion: CURRENT_ENVELOPE_VERSION,
    });
  });

  test('stamping refuses a non-UUID tenant — a producer cannot stamp a claim it did not derive', () => {
    expect(() => stampTenantEnvelope(meta(), 'tenant-a')).toThrow();
  });

  test('stamping does NOT mutate the input metadata', () => {
    const input = meta({ instanceId: 'inst-1' });
    stampTenantEnvelope(input, TENANT);
    expect(input.tenantId).toBeUndefined();
    expect(input.envelopeVersion).toBeUndefined();
  });
});
