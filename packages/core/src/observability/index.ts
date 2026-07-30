/**
 * Observability sink (wish: omni-full-multitenancy, Group G5; ADR-0008).
 *
 * Redacted tenant fields for audit logs and traces. The metric-label counterpart
 * (bounded/redacted tenant buckets) lives in ../metrics/tenant-labels.
 */

export * from './tenant-observability';
