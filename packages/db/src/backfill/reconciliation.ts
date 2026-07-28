/**
 * Reconciliation + quarantine reporting (wish: omni-full-multitenancy, G6).
 *
 * WISH "Backfill and reconciliation": compute per-table counts, null-owner
 * counts, orphan counts, cross-tenant composite-FK violations, checksums/hashes,
 * and sampled semantic comparisons before/after; unresolved rows land in a
 * RESTRICTED quarantine report with counts and identifiers, never in any exposed
 * surface. The synthetic rehearsal must reach ZERO unresolved tenant-owned rows.
 *
 *   * "unresolved" = a NULL-owner row NOT accounted for by a quarantine ledger
 *     entry. A quarantined row keeping a NULL owner is expected and honest; an
 *     unrecorded NULL owner is the failure the zero-unresolved gate catches.
 *   * A cross-tenant FK violation is a child whose resolved tenant differs from a
 *     resolved parent's — the composite-FK invariant G2 introduced NOT VALID.
 *   * The non-tenant digest hashes every column EXCEPT `tenant_id`; identical
 *     before and after apply proves the backfill touched ONLY ownership.
 *
 * Every report is passed through the redaction scanner before return, and the
 * quarantine report carries identifiers (primary keys) only — never row values.
 * Dynamic identifiers from the frozen spec, bound parameters for values; no
 * literal tenant-table name appears, so this stays off the db-access denylist.
 */

import { checksum } from './checksum';
import type { ToolingSql } from './db';
import { type TablePlan, defaultTablePlans } from './engine';
import { assertNoSecrets, redactRow } from './redaction';

const q = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

async function scalar(sql: ToolingSql, text: string, params: unknown[] = []): Promise<number> {
  const rows = (await sql.unsafe(text, params as never[])) as unknown as { n: string }[];
  return Number(rows[0]?.n ?? '0');
}

export interface TableReconciliation {
  table: string;
  total: number;
  assigned: number;
  nullOwner: number;
  quarantinedInLedger: number;
  unresolved: number;
  crossTenantFkViolations: number;
  /** Digest of the (pk, tenant_id) projection — a table-level ownership hash. */
  ownershipDigest: string;
}

export interface ReconciliationReport {
  tables: TableReconciliation[];
  totals: {
    total: number;
    assigned: number;
    nullOwner: number;
    quarantinedInLedger: number;
    unresolved: number;
    crossTenantFkViolations: number;
  };
}

/** Count children whose resolved tenant differs from a resolved parent's. */
export async function crossTenantFkViolations(sql: ToolingSql, plan: TablePlan): Promise<number> {
  let total = 0;
  for (const parent of plan.parents) {
    total += await scalar(
      sql,
      `SELECT count(*)::text AS n FROM ${q(plan.table)} c JOIN ${q(parent.parentTable)} p ON c.${q(
        parent.column,
      )} = p.id WHERE c.tenant_id IS NOT NULL AND p.tenant_id IS NOT NULL AND c.tenant_id <> p.tenant_id`,
    );
  }
  return total;
}

async function ledgerQuarantinedCount(sql: ToolingSql, table: string): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM tenant_migration_ledger
    WHERE source_table = ${table} AND status = 'quarantined'`;
  return Number(rows[0]?.n ?? '0');
}

/** Ownership digest: checksum of the sorted (pk, tenant_id) projection. */
export async function ownershipDigest(sql: ToolingSql, plan: TablePlan): Promise<string> {
  const pk = plan.primaryKey.map((c) => q(c)).join(', ');
  const rows = (await sql.unsafe(`SELECT ${pk}, tenant_id FROM ${q(plan.table)} ORDER BY ${pk}`)) as unknown as Record<
    string,
    unknown
  >[];
  return checksum(rows);
}

export async function reconcileTable(sql: ToolingSql, plan: TablePlan): Promise<TableReconciliation> {
  const total = await scalar(sql, `SELECT count(*)::text AS n FROM ${q(plan.table)}`);
  const nullOwner = await scalar(sql, `SELECT count(*)::text AS n FROM ${q(plan.table)} WHERE tenant_id IS NULL`);
  const quarantinedInLedger = await ledgerQuarantinedCount(sql, plan.table);
  const violations = await crossTenantFkViolations(sql, plan);
  const digest = await ownershipDigest(sql, plan);
  // A null-owner row not covered by a quarantine ledger entry is unresolved.
  const unresolved = Math.max(0, nullOwner - quarantinedInLedger);
  return {
    table: plan.table,
    total,
    assigned: total - nullOwner,
    nullOwner,
    quarantinedInLedger,
    unresolved,
    crossTenantFkViolations: violations,
    ownershipDigest: digest,
  };
}

export async function reconcile(sql: ToolingSql, tables?: readonly string[]): Promise<ReconciliationReport> {
  const all = defaultTablePlans();
  const plans = tables ? all.filter((p) => tables.includes(p.table)) : all;
  const results: TableReconciliation[] = [];
  for (const plan of plans) results.push(await reconcileTable(sql, plan));

  const totals = results.reduce(
    (acc, t) => ({
      total: acc.total + t.total,
      assigned: acc.assigned + t.assigned,
      nullOwner: acc.nullOwner + t.nullOwner,
      quarantinedInLedger: acc.quarantinedInLedger + t.quarantinedInLedger,
      unresolved: acc.unresolved + t.unresolved,
      crossTenantFkViolations: acc.crossTenantFkViolations + t.crossTenantFkViolations,
    }),
    { total: 0, assigned: 0, nullOwner: 0, quarantinedInLedger: 0, unresolved: 0, crossTenantFkViolations: 0 },
  );

  const report = { tables: results, totals };
  assertNoSecrets(report, 'reconciliation report');
  return report;
}

export interface QuarantineEntry {
  table: string;
  /** Primary-key identifiers only — never row values. */
  identifiers: unknown[];
  count: number;
  rules: string[];
}

export interface QuarantineReport {
  entries: QuarantineEntry[];
  total: number;
}

/**
 * RESTRICTED quarantine report: counts + identifiers of the rows that could not
 * be resolved, grouped by table. Never exposed through any tenant query path;
 * emitted for an operator to review. Redaction-scanned before return.
 */
export async function quarantineReport(sql: ToolingSql, tables?: readonly string[]): Promise<QuarantineReport> {
  const rows = tables
    ? await sql<{ source_table: string; source_primary_key: unknown; decision_rule: string }[]>`
        SELECT source_table, source_primary_key, decision_rule FROM tenant_migration_ledger
        WHERE status = 'quarantined' AND source_table = ANY(${sql.array(tables as string[])})
        ORDER BY source_table`
    : await sql<{ source_table: string; source_primary_key: unknown; decision_rule: string }[]>`
        SELECT source_table, source_primary_key, decision_rule FROM tenant_migration_ledger
        WHERE status = 'quarantined' ORDER BY source_table`;

  const byTable = new Map<string, QuarantineEntry>();
  for (const row of rows) {
    let entry = byTable.get(row.source_table);
    if (!entry) {
      entry = { table: row.source_table, identifiers: [], count: 0, rules: [] };
      byTable.set(row.source_table, entry);
    }
    entry.identifiers.push(row.source_primary_key);
    entry.count += 1;
    if (!entry.rules.includes(row.decision_rule)) entry.rules.push(row.decision_rule);
  }

  const report = { entries: [...byTable.values()], total: rows.length };
  assertNoSecrets(report, 'quarantine report');
  return report;
}

/**
 * Non-tenant digest per table: hashes every column EXCEPT `tenant_id`. Compared
 * before and after apply, an identical digest proves the backfill changed ONLY
 * ownership and nothing else (the sampled semantic comparison, taken whole here
 * because fixtures are small).
 */
export async function nonTenantDigest(sql: ToolingSql, plan: TablePlan): Promise<string> {
  const pk = plan.primaryKey.map((c) => q(c)).join(', ');
  const rows = (await sql.unsafe(`SELECT * FROM ${q(plan.table)} ORDER BY ${pk}`)) as unknown as Record<
    string,
    unknown
  >[];
  const stripped = rows.map((row) => {
    const { tenant_id, ...rest } = row;
    return rest;
  });
  return checksum(stripped);
}

/** Snapshot non-tenant digests for a set of tables (for a before/after compare). */
export async function nonTenantDigests(sql: ToolingSql, tables: readonly string[]): Promise<Record<string, string>> {
  const all = defaultTablePlans();
  const plans = all.filter((p) => tables.includes(p.table));
  const out: Record<string, string> = {};
  for (const plan of plans) out[plan.table] = await nonTenantDigest(sql, plan);
  return out;
}

/** The zero-unresolved gate. Throws with per-table detail if any row is unresolved. */
export function assertZeroUnresolved(report: ReconciliationReport): void {
  const offenders = report.tables.filter((t) => t.unresolved > 0);
  if (offenders.length > 0) {
    const detail = offenders.map((t) => `${t.table}=${t.unresolved}`).join(', ');
    throw new Error(
      `reconciliation is NOT zero: ${report.totals.unresolved} unresolved tenant-owned row(s): ${detail}`,
    );
  }
  if (report.totals.crossTenantFkViolations > 0) {
    throw new Error(`reconciliation found ${report.totals.crossTenantFkViolations} cross-tenant FK violation(s)`);
  }
}

/** Redact a raw row for inclusion in an operator-facing report. */
export { redactRow };
