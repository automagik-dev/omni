/**
 * Schema drift verification.
 *
 * Queries `information_schema.columns` and compares the live database against a
 * caller-supplied list of critical columns. Used by the API startup path to
 * fail fast when the live DB and the Drizzle schema disagree (issue #407:
 * migration 0018_supreme_puma was marked applied but the gupshup column rename
 * never executed on a deployed database, so every query 500'd).
 */

import { sql } from 'drizzle-orm';
import type { Database } from './client';

export interface ColumnExpectation {
  table: string;
  columns: string[];
}

export interface ColumnDrift {
  table: string;
  missing: string[];
}

export interface DriftReport {
  ok: boolean;
  drift: ColumnDrift[];
}

/**
 * Verify that every column in `expectations` exists on its table.
 *
 * Returns a report instead of throwing so callers can choose to log, exit, or
 * attempt recovery. Only checks `public` schema tables (Drizzle's default).
 */
export async function verifyCriticalColumns(db: Database, expectations: ColumnExpectation[]): Promise<DriftReport> {
  if (expectations.length === 0) {
    return { ok: true, drift: [] };
  }

  const tables = expectations.map((e) => e.table);
  const rows = await db.execute<{ table_name: string; column_name: string }>(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY(${tables})
  `);

  const liveColumns = new Map<string, Set<string>>();
  for (const row of rows as unknown as Array<{ table_name: string; column_name: string }>) {
    const set = liveColumns.get(row.table_name) ?? new Set<string>();
    set.add(row.column_name);
    liveColumns.set(row.table_name, set);
  }

  const drift: ColumnDrift[] = [];
  for (const expectation of expectations) {
    const live = liveColumns.get(expectation.table) ?? new Set<string>();
    const missing = expectation.columns.filter((col) => !live.has(col));
    if (missing.length > 0) {
      drift.push({ table: expectation.table, missing });
    }
  }

  return { ok: drift.length === 0, drift };
}

/**
 * Format a DriftReport as a multi-line operator-facing error message.
 */
export function formatDriftReport(report: DriftReport): string {
  if (report.ok) return 'Schema drift check passed.';
  const lines = [
    'Schema drift detected — live database is missing columns Drizzle expects.',
    'This usually means drizzle-kit push was used against a migrated database,',
    'or a migration was marked applied but its SQL did not execute.',
    '',
  ];
  for (const entry of report.drift) {
    lines.push(`  table "${entry.table}" missing columns: ${entry.missing.join(', ')}`);
  }
  lines.push('');
  lines.push('Run `bun run db:verify-drift` locally against the same DATABASE_URL,');
  lines.push('then apply the reconcile migration (see issue #407).');
  return lines.join('\n');
}

/**
 * Columns the API relies on at startup. Extend this list as new drift risks
 * surface — the goal is a canary for the most load-bearing reads, not a full
 * schema mirror (Drizzle already owns that).
 */
export const API_CRITICAL_COLUMNS: ColumnExpectation[] = [
  {
    table: 'instances',
    columns: ['gupshup_callback_url', 'gupshup_auth_token', 'gupshup_event_id'],
  },
];
