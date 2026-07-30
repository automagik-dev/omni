/**
 * Post-backfill VALIDATE ordering driver (wish: omni-full-multitenancy, G6).
 *
 * WISH "Backfill and reconciliation": require ZERO unresolved tenant-owned rows
 * before composite FKs are validated and ownership is made non-null; use the
 * `NOT VALID` constraints G2 introduced, validate online, then enforce.
 *
 * This driver runs ONLY on the disposable rehearsal cluster (the boundary
 * forbids `NOT NULL`/`VALIDATE CONSTRAINT` in any journaled migration). It
 * demonstrates the exact ordering production would follow under the state
 * machine:
 *
 *   zero reconciliation  ->  VALIDATE the NOT VALID composite FKs  ->  enforcement-ready
 *
 * and FAILS CLOSED: if reconciliation is non-zero it refuses to validate, so the
 * rehearsal proves the gate cannot be skipped.
 */

import type { ToolingSql } from './db';
import { type ReconciliationReport, assertZeroUnresolved } from './reconciliation';

export interface ValidateOrderingResult {
  validated: string[];
  enforcementReady: boolean;
}

/** Names of the composite foreign keys G2 added `NOT VALID`, still unvalidated. */
export async function notValidCompositeFks(sql: ToolingSql): Promise<{ table: string; constraint: string }[]> {
  const rows = await sql<{ table: string; constraint: string }[]>`
    SELECT conrelid::regclass::text AS table, conname AS constraint
    FROM pg_constraint
    WHERE contype = 'f' AND NOT convalidated
    ORDER BY conname`;
  return rows.map((r) => ({ table: r.table, constraint: r.constraint }));
}

/**
 * Drive the ordering: assert zero reconciliation (fail closed), then VALIDATE
 * every NOT VALID composite FK. Returns the validated constraints and the
 * enforcement-ready flag. Never touches a journaled migration.
 */
export async function driveValidateOrdering(
  sql: ToolingSql,
  report: ReconciliationReport,
): Promise<ValidateOrderingResult> {
  // Gate 1 — zero reconciliation. Throws (fails closed) if any row is unresolved
  // or any cross-tenant FK violation exists.
  assertZeroUnresolved(report);

  // Gate 2 — VALIDATE the NOT VALID composite FKs, now that ownership is clean.
  const pending = await notValidCompositeFks(sql);
  const validated: string[] = [];
  for (const { table, constraint } of pending) {
    await sql.unsafe(`ALTER TABLE ${table} VALIDATE CONSTRAINT "${constraint.replace(/"/g, '""')}"`);
    validated.push(constraint);
  }

  return { validated, enforcementReady: true };
}
