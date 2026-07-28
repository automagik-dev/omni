/**
 * Tenant-bound secret sealing (G5; ADR-0008). Credential/session-secret
 * encryption with a per-tenant key + tenant-as-AAD binding.
 */

export * from './tenant-secret-box';
