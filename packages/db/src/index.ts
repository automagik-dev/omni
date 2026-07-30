/**
 * @omni/db - Database package
 *
 * Provides Drizzle ORM schema and client for PostgreSQL.
 */

// Schema exports
export * from './schema';

// Drizzle operator re-exports — consumers outside api/db must import these from
// here so they share this package's drizzle-orm instance (bun's isolated
// installs dual-instance the ORM for packages with a different peer set, and
// the two instances' SQL/Column types are not assignable to each other).
export { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

// Client exports
export { createDb, createDbHandle, createPostgresClient, getDb, closeDb, getDefaultDatabaseUrl } from './client';
export type { Database, DbConfig } from './client';

// Migration exports
export { applyMigrations, assertOnlineDdlPreflight, BLOCKING_INDEX_OVERRIDE_ENV_VAR } from './migrate';
export type { ApplyMigrationsOptions } from './migrate';

// Online (CONCURRENTLY) index phase for G2 — explicitly invoked, never on boot.
export {
  DEFAULT_LARGE_TABLE_ROWS,
  ONLINE_DDL_COMMAND,
  applyOnlineTenantDdl,
  checkOnlineDdlPreflight,
  onlineDdlPreflightMessage,
} from './online-ddl';
export type { OnlineDdlBlocker, OnlineDdlPreflight, OnlineDdlReport, OnlineDdlStep } from './online-ddl';

// Tenant RLS enforcement (G3) — explicitly invoked, never journaled.
export {
  AUTH_PLANE_READABLE_TABLES,
  DEFAULT_ROLE_NAMES,
  G1_TENANT_PLANE_TABLES,
  RLS_EXCLUSIONS,
  RLS_TENANT_TABLES,
  RUNTIME_DENIED_TABLES,
  TENANT_SETTING,
  applyTenantRlsEnforcement,
  readEnforcementState,
  revertTenantRlsEnforcement,
} from './tenancy-rls';
export type { EnforcementState, EnforcementStateReport, TenancyRoleNames } from './tenancy-rls';
export { AUTH_PLANE_TABLES, applyTenancyRoles, readRoleAttributes, roleAttributeViolations } from './tenancy-roles';
export type { RoleAttributes, TenancyRolePasswords } from './tenancy-roles';
export {
  ENFORCEMENT_ENV_VAR,
  EnforcementStartupError,
  assertEnforcedRuntimeIdentity,
  resolveEnforcedBootIdentities,
  scrubDdlCredential,
  resolveEnforcementMode,
} from './tenancy-startup';
export type { DbEnforcementMode, EnforcedBootIdentities, RuntimeIdentityReport } from './tenancy-startup';

// Schema drift verification
export {
  verifyCriticalColumns,
  formatDriftReport,
  API_CRITICAL_COLUMNS,
} from './verify-schema';
export type { ColumnExpectation, ColumnDrift, DriftReport } from './verify-schema';
