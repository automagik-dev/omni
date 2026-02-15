#!/usr/bin/env bun
/**
 * Recalculate message_count for all chats
 * Fixes existing data from before the transaction fix
 */
import { eq, sql } from '../packages/db/node_modules/drizzle-orm';
import { chats, getDb } from '../packages/db/src/index';

const db = getDb();

async function fixMessageCounts() {
  console.log('🔧 Recalculating message counts for all chats...\n');

  // Find all chats with potential mismatches
  const allChats = (await db.execute(sql`
    SELECT
      c.id,
      c.name,
      c.message_count as stored_count,
      COUNT(m.id) as actual_count
    FROM chats c
    LEFT JOIN messages m ON c.id = m.chat_id
    GROUP BY c.id
    HAVING c.message_count != COUNT(m.id)
    ORDER BY c.name
  `)) as Array<{
    id: string;
    name: string | null;
    stored_count: number;
    actual_count: number;
  }>;

  if (allChats.length === 0) {
    console.log('✅ All message counts are accurate! No fixes needed.\n');
    return;
  }

  console.log(`Found ${allChats.length} chats with incorrect counts:\n`);

  let fixed = 0;
  for (const chat of allChats) {
    const actual = Number(chat.actual_count);
    const diff = chat.stored_count - actual;

    console.log(
      `  ${chat.name || 'Unknown'}: ${chat.stored_count} → ${actual} (${diff > 0 ? '-' : '+'}${Math.abs(diff)})`,
    );

    await db.update(chats).set({ messageCount: actual }).where(eq(chats.id, chat.id));

    fixed++;
  }

  console.log(`\n✅ Fixed ${fixed} chat(s)\n`);
}

fixMessageCounts()
  .then(() => {
    console.log('🎉 Count recalculation complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });
