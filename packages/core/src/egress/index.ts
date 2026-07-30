/**
 * Tenant-egress broker module (wish: omni-full-multitenancy, Group G5; ADR-0009).
 *
 * The single audited chokepoint for tenant-controlled outbound HTTP, plus the
 * default-deny SSRF policy engine it enforces. The architecture guard that fails
 * the build on direct `fetch`/socket use from a tenant-controlled path outside
 * this broker lives beside it in `egress-access-guard.ts` (not re-exported from
 * the package root — it is a dev/test tool, like the db-access guard).
 */

export * from './policy';
export * from './broker';
