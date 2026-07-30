/**
 * Ownership-write fence protocol machinery (wish: omni-full-multitenancy, G6;
 * ADR-0007). REPO-LOCAL protocol only — G8 owns the executable state machine and
 * G8C persists the secure-floor marker + fence atomically; G6 owns the fence
 * PROTOCOL machinery exercised on a disposable cluster.
 *
 * WISH "Backfill and reconciliation": before final reconciliation, enter an
 * ownership-write fence — legacy writers are drained or rejected by epoch, the
 * high-water WAL/LSN is recorded, post-snapshot writes are replayed/compensated,
 * and a final atomic reconciliation proves no gap before constraints/RLS activate.
 *
 * What G6 CAN express repo-locally and does here:
 *   * the writer-epoch CHECK a writer consults, and rejection of a stale epoch;
 *   * fence activation that captures the WAL/LSN high-water mark and binds the
 *     epoch that subsequent ledger writes must carry;
 *   * a post-snapshot replay/compensation driver that selects EXACTLY the ledger
 *     delta beyond a snapshot LSN and replays it;
 *   * a final atomic reconciliation that proves no gap under the fence.
 *
 * What G6 CANNOT express and therefore only DEFINES as an interface (stop-blocked
 * on G5): producer-side epoch enforcement in the async plane. Rejecting an old
 * PRODUCER requires the converted producers G5/G8A own (ADR-0008); the interface
 * below names that boundary rather than faking enforcement.
 *
 * The ledger `writer_epoch` and `wal_lsn_high_water` columns are the durable
 * substrate — no schema change is introduced.
 */

import { checksum } from './checksum';
import type { ToolingSql } from './db';

export class WriterEpochError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WriterEpochError';
  }
}

/** A writer at `writerEpoch` is compatible with a fence at `fenceEpoch` iff >=. */
export function checkWriterEpoch(writerEpoch: number, fenceEpoch: number): { allowed: boolean; reason?: string } {
  if (writerEpoch >= fenceEpoch) return { allowed: true };
  return {
    allowed: false,
    reason: `writer epoch ${writerEpoch} is below the fence epoch ${fenceEpoch}; incompatible writer rejected`,
  };
}

/** Throw `WriterEpochError` when a writer's epoch is below the fence. */
export function assertWriterAllowed(writerEpoch: number, fenceEpoch: number): void {
  const check = checkWriterEpoch(writerEpoch, fenceEpoch);
  if (!check.allowed) throw new WriterEpochError(check.reason ?? 'writer epoch below fence');
}

/** Capture the current WAL/LSN — the high-water mark primitive. */
export async function captureHighWaterMark(sql: ToolingSql): Promise<string> {
  const rows = await sql<{ lsn: string }[]>`SELECT pg_current_wal_insert_lsn()::text AS lsn`;
  const lsn = rows[0]?.lsn;
  if (!lsn) throw new Error('captureHighWaterMark: no LSN returned');
  return lsn;
}

export interface FenceActivation {
  readonly epoch: number;
  readonly highWaterLsn: string;
  /** A stable id binding this activation to its epoch + HWM (audit). */
  readonly activationId: string;
}

/**
 * Activate the fence at `epoch`: capture the high-water LSN and return the
 * activation record. Subsequent ledger writes MUST carry `writerEpoch = epoch`
 * (the backfill engine's `writerEpoch` config), which `finalReconciliationUnderFence`
 * verifies. Persisting the activation atomically with a secure-floor marker is
 * G8C's job; here it is an in-memory record over the ledger's durable fields.
 */
export async function activateFence(sql: ToolingSql, epoch: number): Promise<FenceActivation> {
  if (!Number.isInteger(epoch) || epoch < 0) throw new WriterEpochError(`invalid fence epoch ${epoch}`);
  const highWaterLsn = await captureHighWaterMark(sql);
  return { epoch, highWaterLsn, activationId: checksum({ epoch, highWaterLsn }) };
}

/** Count ledger rows written by a stale writer (epoch below the fence). */
export async function staleEpochWriters(sql: ToolingSql, fenceEpoch: number): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    SELECT count(*)::text AS n FROM tenant_migration_ledger WHERE writer_epoch < ${fenceEpoch}`;
  return Number(rows[0]?.n ?? '0');
}

export interface LedgerDelta {
  readonly id: string;
  readonly sourceTable: string;
  readonly sourcePrimaryKey: unknown;
  readonly status: string;
  readonly walLsn: string;
}

/**
 * The post-snapshot delta: ledger entries whose high-water LSN is strictly
 * beyond `snapshotLsn`. These are exactly the ownership writes that happened
 * after the snapshot and must be replayed/compensated under the fence.
 */
export async function postSnapshotDelta(sql: ToolingSql, snapshotLsn: string): Promise<LedgerDelta[]> {
  const rows = await sql<
    { id: string; source_table: string; source_primary_key: unknown; status: string; wal: string }[]
  >`
    SELECT id, source_table, source_primary_key, status, wal_lsn_high_water::text AS wal
    FROM tenant_migration_ledger
    WHERE wal_lsn_high_water > ${snapshotLsn}::pg_lsn
    ORDER BY wal_lsn_high_water`;
  return rows.map((r) => ({
    id: r.id,
    sourceTable: r.source_table,
    sourcePrimaryKey: r.source_primary_key,
    status: r.status,
    walLsn: r.wal,
  }));
}

export interface FinalReconciliation {
  readonly epoch: number;
  readonly highWaterLsn: string;
  readonly noGap: boolean;
  readonly staleEpochWrites: number;
  readonly plannedNotApplied: number;
  readonly reason: string;
}

/**
 * Final atomic reconciliation under the fence. In ONE transaction, prove there
 * is no gap: no ledger entry was written by a stale-epoch writer, and no decision
 * is stuck `planned` (every decision reached a terminal state). Returns the proof;
 * `noGap` is false with a reason when a gap exists, so the caller fails closed.
 */
export async function finalReconciliationUnderFence(
  sql: ToolingSql,
  activation: FenceActivation,
): Promise<FinalReconciliation> {
  return sql.begin(async (tx) => {
    const staleRows = await tx<{ n: string }[]>`
      SELECT count(*)::text AS n FROM tenant_migration_ledger WHERE writer_epoch < ${activation.epoch}`;
    const stale = Number(staleRows[0]?.n ?? '0');

    const plannedRows = await tx<{ n: string }[]>`
      SELECT count(*)::text AS n FROM tenant_migration_ledger WHERE status = 'planned'`;
    const planned = Number(plannedRows[0]?.n ?? '0');

    const noGap = stale === 0 && planned === 0;
    return {
      epoch: activation.epoch,
      highWaterLsn: activation.highWaterLsn,
      noGap,
      staleEpochWrites: stale,
      plannedNotApplied: planned,
      reason: noGap
        ? 'no gap: every ownership decision is terminal and was written under the fence epoch'
        : `gap under fence: ${stale} stale-epoch write(s), ${planned} decision(s) stuck planned`,
    };
  }) as Promise<FinalReconciliation>;
}

/**
 * PRODUCER-side epoch enforcement in the async plane — DEFINED, NOT enforced by
 * G6. Rejecting an old event PRODUCER (not just a synchronous writer) requires
 * the converted producers and message-context epoch propagation ADR-0008 assigns
 * to G5, and the executable enforcement G8A owns. G6 stops at this interface: an
 * implementation cannot be written without G5's producers, so faking it here
 * would be dishonest. G5/G8A provide the implementation.
 */
export interface ProducerEpochGuard {
  /** Minimum producer/consumer compatibility epoch the plane will accept. */
  readonly minimumAcceptedEpoch: number;
  /**
   * Decide whether a producer at `producerEpoch` may emit under the fence.
   * Implemented by G5/G8A against real converted producers.
   */
  admitProducer(producerEpoch: number): { admitted: boolean; reason?: string };
}

/** The stop-block note recorded when G6 reaches the producer-enforcement boundary. */
export const PRODUCER_ENFORCEMENT_STOP_BLOCK =
  'Producer-side epoch enforcement in the async plane requires G5 converted producers and the ADR-0008 message-context ' +
  'epoch propagation; G6 defines the ProducerEpochGuard interface and stops blocked on its implementation, which is G5/G8A.';
