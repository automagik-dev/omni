/**
 * Typed writer over G2's `tenant_migration_ledger` (Group G6).
 *
 * The ledger schema (migration 0041) is the CONTRACT: a conjunctive row carrying
 * source identity, target tenant, decision rule, pre-image + checksum, an inverse
 * OR compensating action, the WAL/LSN high-water mark, writer epoch, status,
 * ambiguity/quarantine state, the reconciliation receipt, and attempt/checkpoint
 * data. This module records that row and nothing but that row; it never issues a
 * table rewrite (the engine does), which is what lets the ledger-before-rewrite
 * ordering be asserted in one place.
 *
 * `tenant_migration_ledger` is the platform migration plane, NOT one of the RLS
 * tenant tables, so literal SQL against it is intentional and outside the
 * db-access guard's tenant-table denylist.
 *
 * Off the runtime import graph — imported by direct path from G6 tooling only.
 */

import type { ToolingSql } from './db';
import { DEFAULT_REDACTION_POLICY } from './redaction';

export type LedgerStatus = 'planned' | 'applied' | 'compensated' | 'failed' | 'quarantined';
export type LedgerAmbiguity = 'none' | 'ambiguous' | 'quarantined';

/** A structured, replayable inverse — restore named columns to prior values. */
export interface RestoreColumnsInverse {
  readonly type: 'restore-columns';
  readonly table: string;
  readonly primaryKey: Record<string, unknown>;
  /** column -> value to restore (typically `{ tenant_id: null }`). */
  readonly columns: Record<string, unknown>;
}

/** A structured inverse that deletes a row the migration created (clone fan-out). */
export interface DeleteRowInverse {
  readonly type: 'delete-row';
  readonly table: string;
  readonly primaryKey: Record<string, unknown>;
}

export type InverseAction = RestoreColumnsInverse | DeleteRowInverse;

/** Explicit compensating action when a decision performed no invertible rewrite. */
export interface CompensatingAction {
  readonly type: string;
  readonly note: string;
  readonly [key: string]: unknown;
}

export interface PlannedLedgerEntry {
  readonly sourceTable: string;
  readonly sourcePrimaryKey: Record<string, unknown>;
  /** Non-null for an assignment; MUST be null when ambiguityState !== 'none'. */
  readonly targetTenantId: string | null;
  readonly decisionRule: string;
  readonly preImageRedacted: unknown;
  readonly preImageChecksum: string;
  readonly inverseAction: InverseAction | null;
  readonly compensatingAction: CompensatingAction | null;
  readonly writerEpoch: number;
  readonly ambiguityState: LedgerAmbiguity;
  readonly status: Extract<LedgerStatus, 'planned' | 'quarantined'>;
  readonly checkpoint?: unknown;
  readonly redactionPolicy?: string;
}

/** The current WAL/LSN, captured at plan time for the high-water field. */
export async function currentWalLsn(sql: ToolingSql): Promise<string> {
  const rows = await sql<{ lsn: string }[]>`SELECT pg_current_wal_insert_lsn()::text AS lsn`;
  const row = rows[0];
  if (!row) throw new Error('currentWalLsn: no row returned');
  return row.lsn;
}

export interface RecordedLedgerRow {
  readonly id: string;
  readonly status: LedgerStatus;
  readonly targetTenantId: string | null;
}

/**
 * Look up an existing ledger row for a source row, by the UNIQUE
 * (source_table, source_primary_key). Used by the engine to make apply/resume
 * idempotent: an already-`applied`/`quarantined` row is never re-acted upon.
 */
export async function findBySource(
  sql: ToolingSql,
  sourceTable: string,
  sourcePrimaryKey: Record<string, unknown>,
): Promise<RecordedLedgerRow | null> {
  const rows = await sql<{ id: string; status: LedgerStatus; target_tenant_id: string | null }[]>`
    SELECT id, status, target_tenant_id
    FROM tenant_migration_ledger
    WHERE source_table = ${sourceTable} AND source_primary_key = ${sql.json(sourcePrimaryKey as never)}
  `;
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, status: row.status, targetTenantId: row.target_tenant_id };
}

/**
 * Insert a `planned` (or `quarantined`) ledger row and return it. Idempotent:
 * on the UNIQUE(source_table, source_primary_key) conflict it returns the
 * existing row untouched, so a resumed run does not duplicate or clobber a
 * prior decision. Its own statement — durable BEFORE any table rewrite.
 */
export async function recordPlanned(sql: ToolingSql, entry: PlannedLedgerEntry): Promise<RecordedLedgerRow> {
  const existing = await findBySource(sql, entry.sourceTable, entry.sourcePrimaryKey);
  if (existing) return existing;

  const lsn = await currentWalLsn(sql);
  const rows = await sql<{ id: string; status: LedgerStatus; target_tenant_id: string | null }[]>`
    INSERT INTO tenant_migration_ledger (
      source_table, source_primary_key, target_tenant_id, decision_rule,
      pre_image_redacted, pre_image_checksum,
      inverse_action, compensating_action,
      wal_lsn_high_water, writer_epoch, status, ambiguity_state,
      attempt_count, checkpoint, redaction_policy
    ) VALUES (
      ${entry.sourceTable}, ${sql.json(entry.sourcePrimaryKey as never)}, ${entry.targetTenantId}, ${entry.decisionRule},
      ${sql.json(entry.preImageRedacted as never)}, ${entry.preImageChecksum},
      ${entry.inverseAction ? sql.json(entry.inverseAction as never) : null},
      ${entry.compensatingAction ? sql.json(entry.compensatingAction as never) : null},
      ${lsn}::pg_lsn, ${entry.writerEpoch}, ${entry.status}, ${entry.ambiguityState},
      0, ${entry.checkpoint ? sql.json(entry.checkpoint as never) : null},
      ${entry.redactionPolicy ?? DEFAULT_REDACTION_POLICY}
    )
    ON CONFLICT (source_table, source_primary_key) DO NOTHING
    RETURNING id, status, target_tenant_id
  `;
  const inserted = rows[0];
  if (inserted) {
    return { id: inserted.id, status: inserted.status, targetTenantId: inserted.target_tenant_id };
  }
  // Lost a race to a concurrent insert — read the winner back.
  const winner = await findBySource(sql, entry.sourceTable, entry.sourcePrimaryKey);
  if (!winner) throw new Error('recordPlanned: conflict but no row found on re-read');
  return winner;
}

/**
 * Advance a planned row to `applied`, recording the post-image and the
 * reconciliation receipt. Increments `attempt_count`. Idempotent to re-invoke.
 */
export async function markApplied(
  sql: ToolingSql,
  ledgerId: string,
  args: { postImageRedacted: unknown; postImageChecksum: string; reconciliationReceipt: unknown },
): Promise<void> {
  // Advance the high-water mark to the CURRENT WAL position: the decision is
  // durable through here now that the row rewrite has committed. This makes the
  // high-water the post-rewrite position, so a snapshot taken between batches
  // cleanly separates applied decisions before it from those after it (fence.ts
  // postSnapshotDelta).
  await sql`
    UPDATE tenant_migration_ledger
    SET status = 'applied',
        post_image_redacted = ${sql.json(args.postImageRedacted as never)},
        post_image_checksum = ${args.postImageChecksum},
        reconciliation_receipt = ${sql.json(args.reconciliationReceipt as never)},
        wal_lsn_high_water = pg_current_wal_insert_lsn(),
        attempt_count = attempt_count + 1,
        updated_at = now()
    WHERE id = ${ledgerId}
  `;
}

/** Mark a row `compensated` after its inverse ran — used by the fence replay. */
export async function markCompensated(sql: ToolingSql, ledgerId: string): Promise<void> {
  await sql`
    UPDATE tenant_migration_ledger
    SET status = 'compensated', attempt_count = attempt_count + 1, updated_at = now()
    WHERE id = ${ledgerId}
  `;
}

/** Bump attempt_count and persist a resume checkpoint on a planned row. */
export async function recordAttempt(sql: ToolingSql, ledgerId: string, checkpoint: unknown): Promise<void> {
  await sql`
    UPDATE tenant_migration_ledger
    SET attempt_count = attempt_count + 1, checkpoint = ${sql.json(checkpoint as never)}, updated_at = now()
    WHERE id = ${ledgerId}
  `;
}

/** Count ledger rows by status for a set of source tables (reconciliation). */
export async function statusCounts(sql: ToolingSql, sourceTables: readonly string[]): Promise<Record<string, number>> {
  const rows = await sql<{ status: LedgerStatus; n: string }[]>`
    SELECT status, count(*)::text AS n
    FROM tenant_migration_ledger
    WHERE source_table = ANY(${sql.array(sourceTables as string[])})
    GROUP BY status
  `;
  const out: Record<string, number> = {};
  for (const row of rows) out[row.status] = Number(row.n);
  return out;
}
