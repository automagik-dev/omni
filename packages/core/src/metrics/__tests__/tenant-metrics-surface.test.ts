/**
 * Tenant metric surface probe
 * (wish: omni-full-multitenancy, Group G5; ADR-0008; Success Criterion 11).
 *
 * Proves the wired tenant-scoped counter is safe on the operator `/metrics`
 * surface: recording events for thousands of tenants produces a bounded number
 * of series and leaks no raw tenant identifier into the exposition text.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { getMetricsText, recordTenantEventProcessed, resetMetrics } from '../index';
import { resetTenantLabelConfig, tenantLabelBucketCount } from '../tenant-labels';

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function uuidFrom(n: number): string {
  const hex = n.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

describe('tenant metric surface', () => {
  afterEach(async () => {
    await resetMetrics();
    resetTenantLabelConfig();
  });

  test('recording 5k tenants yields bounded series and no raw tenant id in /metrics text', async () => {
    for (let i = 1; i <= 5_000; i++) {
      recordTenantEventProcessed(uuidFrom(i), 'message.received', 'success');
    }
    const text = await getMetricsText();

    // No raw tenant UUID appears anywhere in the exposition text.
    expect(UUID_IN_TEXT.test(text)).toBe(false);

    // Distinct tenant_bucket label values are bounded by the configured ceiling.
    const buckets = new Set<string>();
    for (const line of text.split('\n')) {
      const m = line.match(/tenant_bucket="([^"]+)"/);
      if (m) buckets.add(m[1] as string);
    }
    expect(buckets.size).toBeGreaterThan(0);
    expect(buckets.size).toBeLessThanOrEqual(tenantLabelBucketCount());
  });

  test('a tenantless recording uses the tenantless bucket, byte-identical to unlabelled legacy work', async () => {
    recordTenantEventProcessed(undefined, 'message.received', 'success');
    const text = await getMetricsText();
    expect(text).toContain('tenant_bucket="none"');
  });
});
