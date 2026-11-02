/**
 * Test helper: run opted-in DB tests against a guarded disposable PostgreSQL target.
 *
 * Usage:
 *   Opt in with ENABLE_DB_TESTS=true and TEST_DATABASE_URL set to a guard-approved disposable database.
 *   import { describeWithDb, getTestDb } from './db-helper';
 *
 *   describeWithDb('My Tests', () => {
 *     let db: Database;
 *     beforeAll(() => { db = getTestDb(); });
 *     test('...', () => { ... });
 *   });
 */

import { describe } from 'bun:test';
import { type Database, createDb } from '@omni/db';
import { assertPgTestTarget } from '@omni/db/pg-migrated-template';
import { sql } from 'drizzle-orm';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

function guardedTestDatabaseUrl(): string {
  if (!TEST_DATABASE_URL) throw new Error('DB tests require an explicit disposable TEST_DATABASE_URL');
  assertPgTestTarget(TEST_DATABASE_URL);
  return TEST_DATABASE_URL;
}

let _db: Database | null = null;

async function probe(): Promise<boolean> {
  // Configuration errors must fail loudly, rather than look like an unavailable DB.
  const url = guardedTestDatabaseUrl();
  try {
    const db = createDb({ url, connectTimeout: 2 });
    await db.execute(sql`SELECT 1`);
    _db = db;
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the test database is reachable.
 * Requires ENABLE_DB_TESTS=true and a guarded TEST_DATABASE_URL to attempt a connection.
 * Otherwise database-dependent suites remain explicitly opted out.
 */
const DB_AVAILABLE = process.env.ENABLE_DB_TESTS === 'true' ? await probe() : false;

/** Get a cached database connection (only call if DB_AVAILABLE is true). */
export function getTestDb(): Database {
  if (!_db) _db = createDb({ url: guardedTestDatabaseUrl() });
  return _db;
}

/** Use instead of `describe` for tests that need PostgreSQL. Skips cleanly when DB is down. */
export const describeWithDb = DB_AVAILABLE ? describe : describe.skip;
