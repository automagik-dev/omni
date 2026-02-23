#!/usr/bin/env bun
/**
 * fix-drizzle-journal.ts — Fix migration journal after consolidation
 *
 * Run this ONCE on existing databases that had the old 9-migration layout
 * (0000_cute_white_tiger through 0008_fixed_mockingbird). It replaces the
 * stale journal entries with the single consolidated migration so that
 * the API's auto-migrate on startup doesn't crash with "relation already exists".
 *
 * Safe to run multiple times (idempotent). Does NOT touch your data — only
 * rewrites the `drizzle.__drizzle_migrations` journal table.
 *
 * Usage:
 *   DATABASE_URL=postgres://... bun scripts/fix-drizzle-journal.ts
 *   # or if .env has DATABASE_URL:
 *   bun scripts/fix-drizzle-journal.ts
 *
 * What it does:
 *   1. Connects to the database
 *   2. Checks if the old migrations exist in the journal
 *   3. Deletes all old journal entries
 *   4. Inserts the consolidated migration entry (0000_closed_patriot)
 *   5. Verifies the fix
 *
 * After running this, the API will start cleanly with auto-migrate.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPostgresClient } from '../packages/db/src/client';

// Consolidated migration metadata
const MIGRATION_SQL_PATH = resolve(import.meta.dirname, '../packages/db/drizzle/0000_closed_patriot.sql');
const MIGRATION_TAG = '0000_closed_patriot';
const MIGRATION_WHEN = 1771856815384; // from _journal.json

// Compute hash exactly as Drizzle does: SHA256(file_content_as_string).hex()
const sqlContent = readFileSync(MIGRATION_SQL_PATH).toString();
const MIGRATION_HASH = createHash('sha256').update(sqlContent).digest('hex');

async function main() {
  console.log('Omni — Drizzle migration journal fix');
  console.log('=====================================\n');

  const sql = createPostgresClient({ maxConnections: 1, connectTimeout: 5 });

  try {
    // 1. Check if journal table exists
    const tableCheck = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
      ) as exists
    `;

    if (!tableCheck[0]?.exists) {
      console.log('No migration journal found (drizzle.__drizzle_migrations does not exist).');
      console.log('This is a fresh database — the API will auto-migrate on startup. Nothing to fix.');
      await sql.end();
      process.exit(0);
    }

    // 2. Read current journal entries
    const entries = await sql`
      SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id
    `;

    console.log(`Current journal: ${entries.length} entries`);
    for (const e of entries) {
      console.log(`  id=${e.id} hash=${String(e.hash).slice(0, 16)}... created_at=${e.created_at}`);
    }

    // 3. Check if already fixed
    if (entries.length === 1 && entries[0].hash === MIGRATION_HASH) {
      console.log('\nJournal is already up to date (consolidated migration present). Nothing to do.');
      await sql.end();
      process.exit(0);
    }

    // 4. Check if tables exist (safety check — don't run on empty DB)
    const tableExists = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'access_rules'
      ) as exists
    `;

    if (!tableExists[0]?.exists) {
      console.log('\nWARNING: Tables do not exist yet. This database appears empty.');
      console.log('The API will auto-migrate on startup. No journal fix needed.');
      await sql.end();
      process.exit(0);
    }

    // 5. Replace journal entries in a transaction
    console.log('\nFixing journal...');
    await sql.begin(async (tx) => {
      // Delete all existing entries
      const deleted = await tx`DELETE FROM drizzle.__drizzle_migrations`;
      console.log(`  Deleted ${deleted.count} old entries`);

      // Insert consolidated migration entry
      await tx`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${MIGRATION_HASH}, ${MIGRATION_WHEN})
      `;
      console.log(`  Inserted: ${MIGRATION_TAG} (hash=${MIGRATION_HASH.slice(0, 16)}...)`);
    });

    // 6. Verify
    const verify = await sql`
      SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id
    `;

    console.log(`\nVerification: ${verify.length} entry`);
    const ok = verify.length === 1 && verify[0].hash === MIGRATION_HASH;
    console.log(`  hash match: ${ok ? 'YES' : 'NO'}`);

    if (ok) {
      console.log('\nDone! Journal fixed. The API will start cleanly with auto-migrate.');
      console.log('Restart your API: omni restart (or pm2 restart omni-v2-api)');
    } else {
      console.error('\nERROR: Verification failed. Check the database manually.');
      await sql.end();
      process.exit(1);
    }

    await sql.end();
  } catch (err) {
    console.error('\nERROR:', err instanceof Error ? err.message : err);
    try {
      await sql.end();
    } catch {
      // ignore cleanup errors
    }
    process.exit(1);
  }
}

main();
