#!/usr/bin/env bun
import { sql } from '../packages/db/node_modules/drizzle-orm';
import { getDb } from '../packages/db/src/index';

const db = getDb();

const result = (await db.execute(sql`
  SELECT
    c.id,
    c.name,
    c.external_id,
    c.canonical_id,
    c.message_count,
    COUNT(m.id) as actual_messages,
    c.message_count - COUNT(m.id) as difference,
    c.last_message_at
  FROM chats c
  LEFT JOIN messages m ON c.id = m.chat_id
  WHERE c.name ILIKE '%raphael%' OR c.name ILIKE '%rosa%'
  GROUP BY c.id
  ORDER BY c.last_message_at DESC NULLS LAST
  LIMIT 10
`)) as Array<{
  id: string;
  name: string | null;
  external_id: string;
  canonical_id: string | null;
  message_count: number;
  actual_messages: number;
  difference: number;
  last_message_at: Date | null;
}>;

console.log('\n📊 Raphael Rosa Chats - Message Count Verification:\n');
console.log('Status | Name                  | Count | Actual | Diff | External ID');
console.log('-'.repeat(95));

let allMatch = true;
for (const row of result) {
  const status = row.difference === 0 ? '✅' : '❌';
  if (row.difference !== 0) allMatch = false;

  const name = (row.name || 'Unknown').padEnd(20);
  const count = String(row.message_count).padStart(5);
  const actual = String(row.actual_messages).padStart(6);
  const diff = String(row.difference).padStart(4);
  const extId = row.external_id.substring(0, 25);

  console.log(`${status}     | ${name} | ${count} | ${actual} | ${diff} | ${extId}`);
}

console.log('-'.repeat(95));
console.log(`\nTotal chats found: ${result.length}`);
console.log(`All counts match: ${allMatch ? '✅ YES' : '❌ NO'}\n`);

// Also check for duplicate canonical_ids
const duplicates = (await db.execute(sql`
  SELECT
    instance_id,
    canonical_id,
    COUNT(*) as chat_count,
    array_agg(id) as chat_ids
  FROM chats
  WHERE canonical_id IS NOT NULL
    AND (name ILIKE '%raphael%' OR name ILIKE '%rosa%')
  GROUP BY instance_id, canonical_id
  HAVING COUNT(*) > 1
`)) as Array<{
  instance_id: string;
  canonical_id: string;
  chat_count: number;
  chat_ids: string[];
}>;

if (duplicates.length > 0) {
  console.log('⚠️  Duplicate canonical_ids found:');
  for (const dup of duplicates) {
    console.log(`  - ${dup.canonical_id}: ${dup.chat_count} chats`);
  }
} else {
  console.log('✅ No duplicate canonical_ids found for Raphael\n');
}

process.exit(allMatch ? 0 : 1);
