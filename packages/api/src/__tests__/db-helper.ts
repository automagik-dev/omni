/**
 * Test helper: skip database-dependent tests when PostgreSQL is unavailable.
 *
 * Usage:
 *   import { describeWithDb, getTestDb, TEST_DATABASE_URL } from './db-helper';
 *
 *   describeWithDb('My Tests', () => {
 *     let db: Database;
 *     beforeAll(() => { db = getTestDb(); });
 *     test('...', () => { ... });
 *   });
 */

import { describe } from 'bun:test';
import { type Database, createDb } from '@omni/db';
import { sql } from 'drizzle-orm';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:8432/omni';

let _db: Database | null = null;

async function probe(): Promise<boolean> {
  try {
    const db = createDb({ url: TEST_DATABASE_URL, connectTimeout: 2 });
    await db.execute(sql`SELECT 1`);
    _db = db;
    return true;
  } catch {
    return false;
  }
}

/** Whether the test database is reachable. Resolved at import time. */
export const DB_AVAILABLE = await probe();

/** Get a cached database connection (only call if DB_AVAILABLE is true). */
export function getTestDb(): Database {
  if (!_db) _db = createDb({ url: TEST_DATABASE_URL });
  return _db;
}

/** Use instead of `describe` for tests that need PostgreSQL. Skips cleanly when DB is down. */
export const describeWithDb = DB_AVAILABLE ? describe : describe.skip;
