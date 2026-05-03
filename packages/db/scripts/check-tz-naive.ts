#!/usr/bin/env bun
/**
 * Build-time guard against TZ-naive timestamps.
 *
 * Fails CI if any `timestamp(...)` declaration in src/schema.ts is missing
 * `withTimezone: true`. Background: PG `timestamp without time zone` strips
 * the offset on write — a session-TZ value from `defaultNow()` and a UTC value
 * from JS `new Date()` then diverge by the session offset, producing the
 * 3h false-stale bug fixed in migration 0036.
 *
 * Usage:
 *   bun run packages/db/scripts/check-tz-naive.ts
 *   (also wired into package.json `lint:tz` script)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, '..', 'src', 'schema.ts');
const source = readFileSync(schemaPath, 'utf-8');

const violations: { line: number; text: string }[] = [];

source.split('\n').forEach((text, i) => {
  // Match `timestamp('name')` with no second argument.
  // The schema convention is to always pass `{ withTimezone: true }` as opts.
  const match = text.match(/timestamp\('[^']+'\)(?!\s*,)/);
  if (match) {
    violations.push({ line: i + 1, text: text.trim() });
  }
});

if (violations.length > 0) {
  console.error('\n❌ TZ-naive timestamp(s) found in schema.ts:\n');
  for (const v of violations) {
    console.error(`  schema.ts:${v.line}`);
    console.error(`    ${v.text}`);
  }
  console.error(
    '\nAll timestamp columns must use `{ withTimezone: true }` to avoid the\n' +
      'session-TZ vs UTC strip bug (see migration 0036_timestamptz_migration.sql).\n',
  );
  process.exit(1);
}

console.log('✅ All timestamp columns use { withTimezone: true }');
