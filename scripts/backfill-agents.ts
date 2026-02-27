#!/usr/bin/env bun
/**
 * Backfill Agent Rows
 *
 * Creates one Agent row per Instance that has agentProviderId set.
 * Idempotent — safe to re-run (uses onConflictDoNothing).
 *
 * Usage:
 *   bun scripts/backfill-agents.ts --dry-run    # Preview changes
 *   bun scripts/backfill-agents.ts              # Apply changes
 */

import { AgentService } from '../packages/api/src/services/agents';
import { closeDb, getDb } from '../packages/db/src/index';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`Agent Backfill ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
  console.log('='.repeat(60));

  const db = getDb();
  const service = new AgentService(db, null);

  const { found, inserted } = await service.backfillFromInstances(DRY_RUN);

  console.log(`\nInstances with agentProviderId: ${found}`);

  if (DRY_RUN) {
    console.log(`Would create: ${found} agent rows (dry run — nothing written)`);
  } else {
    console.log(`Inserted:     ${inserted} new agent rows`);
    console.log(`Skipped:      ${found - inserted} (already existed)`);
  }

  console.log('\nDone!');
  closeDb();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
