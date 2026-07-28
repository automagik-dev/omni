/**
 * Structured inverse / compensation executor (Group G6).
 *
 * The ledger records a machine-readable `inverse_action` for every rewrite. This
 * module replays it: a `restore-columns` inverse puts the named columns back to
 * their pre-image values (typically `tenant_id -> NULL`), and a `delete-row`
 * inverse removes a row the migration created (the person clone fan-out). Proving
 * apply -> invert -> byte-identical restore by checksum is what the ledger's
 * reversibility guarantee means in practice, and the post-snapshot fence replay
 * (see `fence.ts`) drives the same executor.
 *
 * Identifiers come from the ledger entry (themselves sourced from the frozen
 * spec); values are bound parameters. No literal tenant-table name appears here.
 */

import type { ToolingSql } from './db';
import type { InverseAction } from './ledger';

const q = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

/** Execute one structured inverse action against the cluster. */
export async function applyInverse(sql: ToolingSql, inverse: InverseAction): Promise<void> {
  if (inverse.type === 'restore-columns') {
    const setCols = Object.keys(inverse.columns);
    if (setCols.length === 0) return;
    const params: unknown[] = [];
    const sets = setCols.map((col) => `${q(col)} = $${params.push(inverse.columns[col]) && params.length}`);
    const where = Object.keys(inverse.primaryKey).map(
      (col) => `${q(col)} = $${params.push(inverse.primaryKey[col]) && params.length}`,
    );
    await sql.unsafe(
      `UPDATE ${q(inverse.table)} SET ${sets.join(', ')} WHERE ${where.join(' AND ')}`,
      params as never[],
    );
    return;
  }

  // delete-row
  const params: unknown[] = [];
  const where = Object.keys(inverse.primaryKey).map(
    (col) => `${q(col)} = $${params.push(inverse.primaryKey[col]) && params.length}`,
  );
  await sql.unsafe(`DELETE FROM ${q(inverse.table)} WHERE ${where.join(' AND ')}`, params as never[]);
}
