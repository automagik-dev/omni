/**
 * Bounded/redacted tenant metric label tests
 * (wish: omni-full-multitenancy, Group G5; ADR-0008).
 *
 * The load-bearing probe is the cardinality one: it feeds far more distinct
 * tenants than the bucket ceiling and proves the number of distinct label
 * values never exceeds it. That is the "metrics avoid unbounded tenant labels"
 * guarantee the WISH requires, checked mechanically rather than asserted.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  DEFAULT_TENANT_LABEL_BUCKETS,
  TENANTLESS_LABEL,
  boundedTenantLabel,
  configureTenantLabelBuckets,
  resetTenantLabelConfig,
  tenantLabelBucketCount,
} from '../tenant-labels';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uuidFrom(n: number): string {
  // Deterministic synthetic UUIDs — no Math.random / Date needed, and the test
  // stays reproducible run to run.
  const hex = n.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

describe('boundedTenantLabel', () => {
  afterEach(() => resetTenantLabelConfig());

  test('no tenant context maps to the tenantless label (legacy/flag-off is undistinguished)', () => {
    expect(boundedTenantLabel(undefined)).toBe(TENANTLESS_LABEL);
    expect(boundedTenantLabel(null)).toBe(TENANTLESS_LABEL);
    expect(boundedTenantLabel('')).toBe(TENANTLESS_LABEL);
  });

  test('the label is never the raw tenant id (no tenant-inventory leak)', () => {
    const tenantId = uuidFrom(1);
    const label = boundedTenantLabel(tenantId);
    expect(label).not.toBe(tenantId);
    expect(label).not.toContain(tenantId);
    // Redacted form is a short opaque bucket token, not a UUID.
    expect(UUID.test(label)).toBe(false);
    expect(label).toMatch(/^t\d+$/);
  });

  test('the same tenant is stable; the label survives repeated calls', () => {
    const tenantId = uuidFrom(42);
    expect(boundedTenantLabel(tenantId)).toBe(boundedTenantLabel(tenantId));
  });

  test('CARDINALITY IS BOUNDED: 20k distinct tenants collapse to at most bucketCount labels', () => {
    const labels = new Set<string>();
    for (let i = 1; i <= 20_000; i++) labels.add(boundedTenantLabel(uuidFrom(i)));
    expect(labels.size).toBeLessThanOrEqual(tenantLabelBucketCount());
    expect(tenantLabelBucketCount()).toBe(DEFAULT_TENANT_LABEL_BUCKETS);
    // Sanity: with 20k tenants across 128 buckets, essentially every bucket is
    // used, so the ceiling is a real ceiling and not accidentally slack.
    expect(labels.size).toBeGreaterThan(DEFAULT_TENANT_LABEL_BUCKETS / 2);
  });

  test('the ceiling is explicitly controllable and enforced after reconfiguration', () => {
    configureTenantLabelBuckets(4);
    expect(tenantLabelBucketCount()).toBe(4);
    const labels = new Set<string>();
    for (let i = 1; i <= 5_000; i++) labels.add(boundedTenantLabel(uuidFrom(i)));
    expect(labels.size).toBeLessThanOrEqual(4);
  });

  test('a non-positive or non-integer bucket ceiling is rejected', () => {
    expect(() => configureTenantLabelBuckets(0)).toThrow();
    expect(() => configureTenantLabelBuckets(-1)).toThrow();
    expect(() => configureTenantLabelBuckets(2.5)).toThrow();
  });
});
