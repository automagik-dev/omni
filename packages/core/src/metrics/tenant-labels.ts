/**
 * Bounded, redacted tenant labels for metrics
 * (wish: omni-full-multitenancy, Group G5; ADR-0008; WISH "Async and storage
 * enforcement": "metrics avoid unbounded tenant labels unless explicitly
 * controlled").
 *
 * A raw tenant UUID is the wrong value for a Prometheus label, for two
 * independent reasons:
 *
 *   1. Unbounded cardinality. One time series per tenant, retained forever, is
 *      a metrics-backend DoS as tenants accrue — the exact "unbounded tenant
 *      labels" the WISH forbids.
 *   2. Tenant-inventory disclosure. `/metrics` is an operator surface; a raw
 *      tenant id there enumerates every tenant that has ever been active.
 *
 * `boundedTenantLabel` fixes both by construction. It maps a tenant id to one
 * of a FIXED number of opaque buckets via a non-reversible hash, so:
 *   - the number of distinct label values can never exceed the bucket count —
 *     cardinality is bounded regardless of how many tenants exist or the order
 *     they arrive — and
 *   - the label is a short hash-derived token, never the tenant id itself, so
 *     `/metrics` carries no tenant identifier.
 *
 * Metrics deliberately do NOT identify individual tenants; that is the job of
 * audit logs and traces (see ../observability), which carry the full tenant id
 * and actor credential id under access control. Metrics get bounded, redacted
 * buckets only.
 */

import { createHash } from 'node:crypto';

/**
 * Default number of tenant label buckets. This is the ceiling on distinct
 * tenant-label cardinality per metric.
 */
export const DEFAULT_TENANT_LABEL_BUCKETS = 128;

/**
 * The label used when no tenant context is present (legacy / flag-off work).
 * Such work was never labelled per tenant before G5 and still is not — this is
 * one shared bucket, so behaviour is byte-identical to the unlabelled past.
 */
export const TENANTLESS_LABEL = 'none';

let bucketCount = DEFAULT_TENANT_LABEL_BUCKETS;

/**
 * Configure the number of tenant label buckets — the "explicitly controlled"
 * knob the WISH allows. An operator picks the cardinality ceiling up front; it
 * can never be exceeded at runtime. Must be a positive integer.
 */
export function configureTenantLabelBuckets(count: number): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`tenant-labels: bucket count must be a positive integer, got ${count}`);
  }
  bucketCount = count;
}

/**
 * The active bucket ceiling — the maximum distinct *tenant* label cardinality.
 * Note: the true label cardinality ceiling is `bucketCount + 1` whenever
 * tenantless `'none'` work is also present, since `TENANTLESS_LABEL` is a
 * separate value outside the `t<bucket>` space.
 */
export function tenantLabelBucketCount(): number {
  return bucketCount;
}

/**
 * Map a tenant id to a bounded, redacted metric label.
 *
 * - No tenant → {@link TENANTLESS_LABEL} (legacy/flag-off work is undistinguished).
 * - A tenant id → `t<bucket>` where `bucket = sha256(tenantId) mod bucketCount`.
 *   The output alphabet is `t` + digits; there are at most `bucketCount`
 *   distinct values; the tenant id is not recoverable from it.
 */
export function boundedTenantLabel(tenantId: string | null | undefined): string {
  if (!tenantId) return TENANTLESS_LABEL;
  const digest = createHash('sha256').update(tenantId).digest();
  // Read 4 bytes as an unsigned int, mod the bucket ceiling. 4 bytes gives ample
  // headroom over any sane bucket count and keeps the distribution uniform.
  const bucket = digest.readUInt32BE(0) % bucketCount;
  return `t${bucket}`;
}

/** Reset the bucket configuration to the default. For tests only. */
export function resetTenantLabelConfig(): void {
  bucketCount = DEFAULT_TENANT_LABEL_BUCKETS;
}
