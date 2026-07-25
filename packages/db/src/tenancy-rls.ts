/**
 * Row-level-security enforcement contract
 * (wish: omni-full-multitenancy, Group G3; ADR-0003, ADR-0004, ADR-0005).
 *
 * WHY THIS IS NOT A MIGRATION
 * ---------------------------
 * `applyMigrations()` runs on every API boot, and every file listed in
 * `drizzle/meta/_journal.json` runs with it. If the enforcement DDL were
 * journaled, the first boot of a new binary against ANY existing deployment
 * would `FORCE ROW LEVEL SECURITY` on 37 tables whose rows still carry a NULL
 * `tenant_id` — every legacy read would return nothing and every legacy write
 * would be rejected. That is precisely the outcome the wish's mixed-version
 * state machine exists to prevent: enforcement belongs to **state 5**, after
 * states 1-4 have proven zero unresolved ownership.
 *
 * So this module follows the `online-ddl.ts` precedent instead: it is a
 * separate, explicitly invoked phase. Nothing here is in `_journal.json`;
 * nothing here runs unless a human (or a test) calls `applyTenantRlsEnforcement`.
 * The DEFAULT applied state of the database after G3 is byte-for-byte the G2
 * state — no policy, no FORCE, no role change, no behavior change.
 *
 * THE TWO WORLDS
 * --------------
 *   * **legacy** (default): no RLS objects exist. `readEnforcementState()`
 *     reports `legacy`. Every pre-existing code path, test, and deployment
 *     behaves exactly as it did at G2.
 *   * **enforced** (opt-in): policies + FORCE are installed, the runtime role
 *     is a non-owning `NOBYPASSRLS` identity, and every tenant-scoped query
 *     must arrive inside a transaction that has set `app.tenant_id`.
 *
 * The state is read from the catalog rather than from a flag column, so it
 * cannot drift from reality and needs no new migration to track.
 *
 * FAIL-CLOSED SHAPE
 * -----------------
 * The predicate calls `omni_current_tenant_id()`, which RAISES when
 * `app.tenant_id` is unset or empty and lets PostgreSQL's own `uuid` cast raise
 * when it is malformed. A missing context is therefore an ERROR, not an empty
 * result set — a much louder and less spoofable failure than "zero rows".
 *
 * THE AUTH-PLANE COLLISION
 * ------------------------
 * `auth-bootstrap.ts` reads `tenant_memberships` and `tenant_key_lineage`
 * BEFORE any tenant context exists — that read is what establishes the context
 * in the first place. A plain tenant-equality policy on those two tables would
 * deadlock authentication against itself.
 *
 * The fix is NOT `BYPASSRLS`. It is a second, narrower predicate: the isolated
 * auth plane connects as its own role, that role is a member of the marker role
 * `omni_auth_plane`, and the SELECT policy on exactly those two tables admits
 * members of that marker. The runtime role is not a member and never becomes
 * one, so a tenant-scoped path still cannot read them without context. The
 * exemption covers SELECT only: the auth plane cannot write through it.
 */

import { sql } from 'drizzle-orm';
import type { Database } from './client';
import { TENANT_TABLES } from './tenancy-ownership';

// ---------------------------------------------------------------------------
// Role naming
// ---------------------------------------------------------------------------

/**
 * The identities ADR-0004 implies. Today's deployment has ONE non-superuser
 * role that owns the `public` schema and holds `CREATE` — it is simultaneously
 * the migrator and the runtime. Enforcement mode splits that into three, plus
 * the isolated auth plane of ADR-0003.
 */
export interface TenancyRoleNames {
  /** Owns the schema and every tenant table; runs migrations. Never serves traffic. */
  readonly ddl: string;
  /** Serves traffic. Owns nothing, creates nothing, NOBYPASSRLS. */
  readonly runtime: string;
  /** ADR-0003 isolated auth plane. SELECT-only on the credential index. */
  readonly authPlane: string;
  /**
   * NOLOGIN marker whose membership the two pre-context tenant-plane policies
   * admit. Separated from `authPlane` so the admission is a reviewable grant
   * rather than a hardcoded role name comparison.
   */
  readonly authPlaneMarker: string;
}

export const DEFAULT_ROLE_NAMES: TenancyRoleNames = {
  ddl: 'omni_ddl',
  runtime: 'omni_runtime',
  authPlane: 'omni_auth_plane_role',
  authPlaneMarker: 'omni_auth_plane',
};

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

function assertSafeIdent(label: string, value: string): void {
  if (!SAFE_IDENT.test(value) || value.length > 63) {
    throw new Error(`tenancy-rls: unsafe ${label} identifier: ${JSON.stringify(value)}`);
  }
}

// ---------------------------------------------------------------------------
// Table coverage
// ---------------------------------------------------------------------------

/**
 * G1 control-plane tables that carry a `tenant_id` and therefore hold tenant
 * data. The wish requires RLS on these in addition to the 29 manifest tables.
 */
export const G1_TENANT_PLANE_TABLES: readonly string[] = [
  'tenant_memberships',
  'tenant_key_lineage',
  'tenant_audit_logs',
  'tenant_provider_config',
  'tenant_settings',
  'tenant_setting_change_history',
  'tenant_plugin_storage',
  'tenant_payload_storage_overrides',
];

/**
 * The two tables `auth-bootstrap.ts` must read before a tenant context exists.
 * Their SELECT policy carries the auth-plane marker disjunct; their write
 * policies do not.
 */
export const AUTH_PLANE_READABLE_TABLES: readonly string[] = ['tenant_memberships', 'tenant_key_lineage'];

/**
 * Tables that carry a `tenant_id` column but are deliberately NOT tenant-RLS
 * tables. Every entry needs a control-plane justification, per the wish.
 *
 * These are not "forgotten" — they are unreachable from the runtime role at
 * all, because `runtimeGrantStatements()` grants it nothing on them. Putting a
 * tenant-equality policy on them would be weaker, not stronger: it would imply
 * the runtime may read them with the right context, which it may not.
 */
export interface RlsExclusion {
  readonly table: string;
  readonly justification: string;
}

export const RLS_EXCLUSIONS: readonly RlsExclusion[] = [
  {
    table: 'auth_credentials',
    justification:
      'ADR-0003 auth plane. The credential index must never be reachable from a tenant-scoped path at all, ' +
      'with or without context; the runtime role receives zero privileges on it, which is strictly stronger ' +
      'than a tenant-equality policy. Only the auth-plane role may SELECT it.',
  },
  {
    table: 'tenant_migration_ledger',
    justification:
      'G2 migration/DDL control plane. Written by the backfill tooling under the DDL identity outside any ' +
      'tenant transaction; its rows are ownership DECISIONS about tenants rather than tenant data. Runtime ' +
      'role receives no privileges on it.',
  },
  {
    table: 'tenant_migration_ledger_history',
    justification:
      'Append-only mirror of the migration ledger; same control-plane justification. The runtime role is ' +
      'additionally REVOKEd UPDATE/DELETE on it (G2 review carry-forward finding 6).',
  },
];

/** Every table that receives ENABLE + FORCE ROW LEVEL SECURITY. */
export const RLS_TENANT_TABLES: readonly string[] = [...TENANT_TABLES, ...G1_TENANT_PLANE_TABLES];

/** Control-plane tables the runtime role must not be able to touch at all. */
export const RUNTIME_DENIED_TABLES: readonly string[] = [
  'auth_credentials',
  'platform_api_keys',
  'principals',
  'tenants',
  'tenant_role_policies',
  'platform_audit_logs',
  'platform_provider_catalog',
  'platform_settings',
  'platform_setting_change_history',
  'platform_plugin_storage',
  'platform_payload_storage_config',
  'tenant_migration_ledger',
  'tenant_migration_ledger_history',
];

// ---------------------------------------------------------------------------
// Policy naming
// ---------------------------------------------------------------------------

export type PolicyCommand = 'select' | 'insert' | 'update' | 'delete';

export const POLICY_COMMANDS: readonly PolicyCommand[] = ['select', 'insert', 'update', 'delete'];

export function policyName(table: string, command: PolicyCommand): string {
  return `${table}_tenant_${command}`;
}

export const TENANT_CONTEXT_FUNCTION = 'omni_current_tenant_id';
export const AUTH_PLANE_FUNCTION = 'omni_is_auth_plane';
export const AUTH_PLANE_ROW_FUNCTION = 'omni_auth_plane_row_visible';

/** The transaction-local GUC every tenant transaction sets. */
export const TENANT_SETTING = 'app.tenant_id';

// ---------------------------------------------------------------------------
// DDL generation
// ---------------------------------------------------------------------------

/**
 * The fail-closed context reader.
 *
 * `current_setting(..., true)` returns NULL rather than erroring for a GUC that
 * was never set in this session, which is what makes "unset" detectable at all.
 * Both the unset and the empty case RAISE `insufficient_privilege` (42501); a
 * malformed value falls through to the `uuid` cast and raises `invalid_text_
 * representation` (22P02). No branch returns NULL, so no branch can silently
 * turn the policy into `NULL = tenant_id` (which evaluates to "not true" and
 * would look like a clean empty result instead of a denial).
 *
 * `search_path` is pinned even though the function is SECURITY INVOKER: a
 * caller-controlled `search_path` must never be able to shadow `current_setting`.
 */
export function contextFunctionStatements(): string[] {
  return [
    `CREATE OR REPLACE FUNCTION ${TENANT_CONTEXT_FUNCTION}() RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $omni$
DECLARE
  raw text;
BEGIN
  raw := current_setting('${TENANT_SETTING}', true);
  IF raw IS NULL OR raw = '' THEN
    RAISE EXCEPTION 'omni: ${TENANT_SETTING} is not set for this transaction'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN raw::uuid;
END;
$omni$;`,
    // Membership test for the marker role. Written against pg_roles rather than
    // the two-argument pg_has_role(name, text) so that a cluster where the
    // marker role has not been provisioned yet returns FALSE instead of
    // raising "role does not exist" — absent marker means no exemption.
    `CREATE OR REPLACE FUNCTION ${AUTH_PLANE_FUNCTION}(marker text) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $omni$
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles r
    WHERE r.rolname = marker
      AND pg_catalog.pg_has_role(current_user, r.oid, 'USAGE')
  );
$omni$;`,
    // The pre-context predicate, as ONE function rather than an SQL `OR`.
    //
    // This is not stylistic. `omni_current_tenant_id()` RAISES when no context
    // is set, and PostgreSQL does not promise left-to-right evaluation of `OR`
    // — it may evaluate the tenant-equality side first and the RAISE escapes
    // before the auth-plane side is ever considered, which breaks
    // authentication outright. Putting the branch inside plpgsql makes the
    // ordering a language guarantee instead of a planner accident.
    `CREATE OR REPLACE FUNCTION ${AUTH_PLANE_ROW_FUNCTION}(row_tenant uuid, marker text) RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $omni$
BEGIN
  -- Schema-qualified because search_path is pinned to pg_catalog: an
  -- unqualified name would not resolve to the helpers in the public schema.
  IF public.${AUTH_PLANE_FUNCTION}(marker) THEN
    RETURN true;
  END IF;
  RETURN row_tenant = public.${TENANT_CONTEXT_FUNCTION}();
END;
$omni$;`,
  ];
}

/** Rollback counterpart of the context-function DDL; operator tooling surface. @public */
export function dropContextFunctionStatements(): string[] {
  return [
    `DROP FUNCTION IF EXISTS ${AUTH_PLANE_ROW_FUNCTION}(uuid, text);`,
    `DROP FUNCTION IF EXISTS ${AUTH_PLANE_FUNCTION}(text);`,
    `DROP FUNCTION IF EXISTS ${TENANT_CONTEXT_FUNCTION}();`,
  ];
}

/** `tenant_id = omni_current_tenant_id()`, plus the auth-plane disjunct where earned. */
function predicate(table: string, command: PolicyCommand, marker: string): string {
  const equality = `"tenant_id" = ${TENANT_CONTEXT_FUNCTION}()`;
  const authPlaneRead = command === 'select' && AUTH_PLANE_READABLE_TABLES.includes(table);
  return authPlaneRead ? `(${AUTH_PLANE_ROW_FUNCTION}("tenant_id", '${marker}'))` : `(${equality})`;
}

/**
 * Policy DDL for one table.
 *
 * Four explicit per-command policies rather than one `FOR ALL`, because the
 * wish specifies the shape per command ("`INSERT`/`UPDATE` policies use
 * `WITH CHECK`; `SELECT`/`DELETE` use tenant equality") and because a
 * per-command policy is directly assertable against `pg_policies` — a `FOR ALL`
 * policy would make "does UPDATE have a WITH CHECK" an inference rather than a
 * fact.
 *
 * UPDATE gets BOTH: `USING` decides which rows are visible to update, and
 * `WITH CHECK` decides what they may become — without the latter, an in-tenant
 * row could be re-tenanted by setting `tenant_id` to another tenant.
 */
export function tablePolicyStatements(table: string, roles: TenancyRoleNames = DEFAULT_ROLE_NAMES): string[] {
  assertSafeIdent('table', table);
  assertSafeIdent('marker role', roles.authPlaneMarker);
  const marker = roles.authPlaneMarker;
  return [
    `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`,
    // FORCE is what binds the table OWNER too. Without it the DDL role — which
    // owns every tenant table — would read across tenants by default, and the
    // "owner cannot bypass" property in the wish would be untestable.
    `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS "${policyName(table, 'select')}" ON "${table}";`,
    `CREATE POLICY "${policyName(table, 'select')}" ON "${table}"
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ${predicate(table, 'select', marker)};`,
    `DROP POLICY IF EXISTS "${policyName(table, 'insert')}" ON "${table}";`,
    `CREATE POLICY "${policyName(table, 'insert')}" ON "${table}"
  AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK ${predicate(table, 'insert', marker)};`,
    `DROP POLICY IF EXISTS "${policyName(table, 'update')}" ON "${table}";`,
    `CREATE POLICY "${policyName(table, 'update')}" ON "${table}"
  AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING ${predicate(table, 'update', marker)}
  WITH CHECK ${predicate(table, 'update', marker)};`,
    `DROP POLICY IF EXISTS "${policyName(table, 'delete')}" ON "${table}";`,
    `CREATE POLICY "${policyName(table, 'delete')}" ON "${table}"
  AS PERMISSIVE FOR DELETE TO PUBLIC
  USING ${predicate(table, 'delete', marker)};`,
  ];
}

/** Every policy statement, in apply order. */
export function policyStatements(roles: TenancyRoleNames = DEFAULT_ROLE_NAMES): string[] {
  return RLS_TENANT_TABLES.flatMap((table) => tablePolicyStatements(table, roles));
}

/** Reverse of {@link policyStatements}. Test-only; enforcement is one-way in production. */
export function dropPolicyStatements(): string[] {
  return RLS_TENANT_TABLES.flatMap((table) => [
    ...POLICY_COMMANDS.map((command) => `DROP POLICY IF EXISTS "${policyName(table, command)}" ON "${table}";`),
    `ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY;`,
    `ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY;`,
  ]);
}

// ---------------------------------------------------------------------------
// Enforcement state (read from the catalog, never from a flag)
// ---------------------------------------------------------------------------

export type EnforcementState = 'legacy' | 'partial' | 'enforced';

export interface EnforcementStateReport {
  readonly state: EnforcementState;
  /** Tables with both ENABLE and FORCE row security. */
  readonly forced: string[];
  /** Tables that should be forced and are not. */
  readonly missing: string[];
  /** Tables missing at least one of the four per-command policies. */
  readonly missingPolicies: string[];
}

/**
 * What state is this database actually in?
 *
 * `legacy` when nothing is enforced, `enforced` when every table is forced AND
 * carries all four policies, `partial` for anything in between — a partial
 * state is a failure, not a milestone: it means some tables are protected and
 * some are not, which is the worst of both worlds and must be reported loudly.
 */
export async function readEnforcementState(db: Database): Promise<EnforcementStateReport> {
  const wanted = RLS_TENANT_TABLES;
  const relRows = (await db.execute(sql`
    SELECT c.relname::text AS relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = ANY(${sql.raw(`ARRAY[${wanted.map((t) => `'${t}'`).join(',')}]::text[]`)})
  `)) as unknown as { relname: string; enabled: boolean; forced: boolean }[];

  const policyRows = (await db.execute(sql`
    SELECT tablename::text AS tablename, count(*)::int AS n
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE '%\\_tenant\\_%'
    GROUP BY tablename
  `)) as unknown as { tablename: string; n: number }[];

  const policyCount = new Map(policyRows.map((r) => [r.tablename, Number(r.n)]));
  const forced: string[] = [];
  const missing: string[] = [];
  const missingPolicies: string[] = [];

  for (const table of wanted) {
    const row = relRows.find((r) => r.relname === table);
    if (row?.enabled && row.forced) forced.push(table);
    else missing.push(table);
    if ((policyCount.get(table) ?? 0) < POLICY_COMMANDS.length) missingPolicies.push(table);
  }

  const state: EnforcementState =
    forced.length === 0 && missingPolicies.length === wanted.length
      ? 'legacy'
      : missing.length === 0 && missingPolicies.length === 0
        ? 'enforced'
        : 'partial';

  return { state, forced, missing, missingPolicies };
}

// ---------------------------------------------------------------------------
// Apply / roll back
// ---------------------------------------------------------------------------

export interface RlsEnforcementReport {
  readonly statements: number;
  readonly tables: readonly string[];
  readonly state: EnforcementStateReport;
}

/**
 * Install the enforcement objects.
 *
 * Explicitly invoked ONLY — by `packages/db/scripts/apply-rls-enforcement.ts`
 * or by a test. Never journaled, never called from `applyMigrations()`, never
 * called from API boot.
 *
 * @param db - target database. NEVER an ambient production connection.
 */
export async function applyTenantRlsEnforcement(
  db: Database,
  roles: TenancyRoleNames = DEFAULT_ROLE_NAMES,
): Promise<RlsEnforcementReport> {
  const statements = [...contextFunctionStatements(), ...policyStatements(roles)];
  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
  return { statements: statements.length, tables: RLS_TENANT_TABLES, state: await readEnforcementState(db) };
}

/** Remove the enforcement objects. Test/rehearsal only — see the module header. */
export async function revertTenantRlsEnforcement(db: Database): Promise<void> {
  for (const statement of [...dropPolicyStatements(), ...dropContextFunctionStatements()]) {
    await db.execute(sql.raw(statement));
  }
}
