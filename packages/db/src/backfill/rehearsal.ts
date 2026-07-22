/**
 * Rehearsal-cluster DDL ordering driver (wish: omni-full-multitenancy, G6).
 *
 * Runs ONLY on the disposable rehearsal cluster — never a journaled migration,
 * never outside the rehearsal — to demonstrate the ordering production would
 * later follow under the state machine (ADR-0007):
 *
 *   replace preserved global natural-key uniques with the tenant-aware partials
 *     -> backfill (root + clone + derived) to zero unresolved
 *     -> VALIDATE the NOT VALID composite foreign keys
 *     -> ownership enforcement-ready.
 *
 * Why the index swap comes first: G2 (migration 0041) deliberately PRESERVED
 * every pre-existing global unique so a pre-tenant binary keeps writing, and
 * ADDED a tenant-aware PARTIAL replacement alongside each
 * (`TenantUniqueIndexSpec.preservedGlobalIndex` names the one it replaces).
 * Person cloning intentionally creates rows that share a natural identifier
 * (same phone/JID) across DIFFERENT tenants — which the tenant-aware partial
 * unique permits and the old GLOBAL unique forbids. So the global uniques must be
 * dropped in favour of their already-present tenant-aware replacements before the
 * clone step, exactly as the fenced transformation does in production.
 *
 * This consumes the frozen `tenancy-ownership` spec (read-only) and issues DDL
 * against the rehearsal cluster; it is not importable by any runtime path.
 */

import { TENANT_UNIQUE_INDEXES, allIndexStatements } from '../tenancy-ownership';
import type { ToolingSql } from './db';

/**
 * Drop each preserved global unique index in favour of the tenant-aware partial
 * replacement 0041 already created. Idempotent (`IF EXISTS`). Returns the list
 * of indexes it dropped, for the rehearsal receipt.
 */
export async function replacePreservedGlobalUniques(sql: ToolingSql): Promise<string[]> {
  const dropped: string[] = [];
  for (const spec of TENANT_UNIQUE_INDEXES) {
    // The tenant-aware replacement must already exist before we drop the global.
    await sql.unsafe(`DROP INDEX IF EXISTS "${spec.preservedGlobalIndex.replace(/"/g, '""')}"`);
    dropped.push(spec.preservedGlobalIndex);
  }
  return dropped;
}

/**
 * Confirm every tenant-aware partial unique index 0041 promised is actually
 * present on the cluster before we drop the globals — so the swap never leaves a
 * table with NO uniqueness protection.
 */
export async function assertTenantUniquesPresent(sql: ToolingSql): Promise<void> {
  const expected = allIndexStatements()
    .map((s) => s.statement.name)
    .filter((name) => TENANT_UNIQUE_INDEXES.some((u) => u.name === name));
  for (const name of expected) {
    const rows = await sql<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = ${name}) AS present`;
    if (!rows[0]?.present) {
      throw new Error(`rehearsal precondition failed: tenant-aware unique ${name} is missing`);
    }
  }
}
