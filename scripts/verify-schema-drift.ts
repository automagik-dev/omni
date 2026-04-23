#!/usr/bin/env bun
/**
 * Schema drift audit.
 *
 * Runs `verifyCriticalColumns` against the configured DATABASE_URL and prints
 * a drift summary. Exits 0 when the live DB matches expectations, 1 otherwise,
 * so CI / operators can gate deploys on the result.
 *
 * Usage:
 *   DATABASE_URL=postgres://... bun run db:verify-drift
 */

import { API_CRITICAL_COLUMNS, closeDb, createDb, formatDriftReport, verifyCriticalColumns } from '@omni/db';

async function main(): Promise<number> {
  const db = createDb();
  try {
    const report = await verifyCriticalColumns(db, API_CRITICAL_COLUMNS);
    if (report.ok) {
      console.log('Schema drift check: OK');
      for (const expectation of API_CRITICAL_COLUMNS) {
        console.log(`  ${expectation.table}: ${expectation.columns.join(', ')}`);
      }
      return 0;
    }
    console.error(formatDriftReport(report));
    return 1;
  } finally {
    await closeDb();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('verify-schema-drift failed:', err);
    process.exit(2);
  });
