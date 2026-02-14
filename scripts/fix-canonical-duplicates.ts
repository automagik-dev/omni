#!/usr/bin/env bun
/**
 * Consolidate duplicate canonical chats before adding unique constraint
 * This finds chats with duplicate (instance_id, canonical_id) and merges them
 */
import { eq, sql } from '../packages/db/node_modules/drizzle-orm';
import { chats, getDb, messages } from '../packages/db/src/index';

const db = getDb();

async function consolidateCanonicalDuplicates() {
  console.log('🔍 Finding duplicate canonical chats...');

  // Find groups of chats with same (instance_id, canonical_id)
  const duplicates = (await db.execute(sql`
    SELECT
      instance_id,
      canonical_id,
      array_agg(id ORDER BY last_message_at DESC NULLS LAST, created_at DESC) as chat_ids,
      count(*) as count
    FROM chats
    WHERE canonical_id IS NOT NULL
    GROUP BY instance_id, canonical_id
    HAVING count(*) > 1
  `)) as Array<{
    instance_id: string;
    canonical_id: string;
    chat_ids: string[];
    count: number;
  }>;

  if (duplicates.length === 0) {
    console.log('✅ No duplicate canonical chats found!');
    return;
  }

  console.log(`⚠️  Found ${duplicates.length} groups of duplicate chats`);

  for (const group of duplicates) {
    const chatIds = group.chat_ids;
    const keeper = chatIds[0]; // Most recent chat (sorted by last_message_at DESC)
    const toMerge = chatIds.slice(1);

    console.log(`\n📦 Merging ${toMerge.length} duplicate(s) into ${keeper} (canonical: ${group.canonical_id})`);

    // Migrate messages from duplicates to keeper
    for (const dupId of toMerge) {
      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(eq(messages.chatId, dupId));

      const messageCount = Number(result?.count ?? 0);

      if (messageCount > 0) {
        console.log(`  ↳ Migrating ${messageCount} messages from ${dupId} to ${keeper}`);

        // Move messages, skipping those with duplicate external_ids
        // (some messages may exist in both chats)
        await db.execute(sql`
          UPDATE messages
          SET chat_id = ${keeper}
          WHERE chat_id = ${dupId}
          AND external_id NOT IN (
            SELECT external_id
            FROM messages
            WHERE chat_id = ${keeper}
          )
        `);

        // Delete messages that couldn't be moved (duplicates)
        const [remaining] = await db
          .select({ count: sql<number>`count(*)` })
          .from(messages)
          .where(eq(messages.chatId, dupId));

        if (Number(remaining?.count ?? 0) > 0) {
          console.log(`  ↳ Deleting ${remaining?.count} duplicate messages from ${dupId}`);
          await db.delete(messages).where(eq(messages.chatId, dupId));
        }
      }

      // Delete the duplicate chat
      console.log(`  ↳ Deleting duplicate chat ${dupId}`);
      await db.delete(chats).where(eq(chats.id, dupId));
    }

    // Recalculate keeper's message count
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.chatId, keeper));

    const totalCount = Number(result?.count ?? 0);

    console.log(`  ✓ Keeper now has ${totalCount} messages`);
    await db.update(chats).set({ messageCount: totalCount }).where(eq(chats.id, keeper));
  }

  console.log('\n✅ All duplicates consolidated!');
}

// Run the consolidation
consolidateCanonicalDuplicates()
  .then(() => {
    console.log('\n🎉 Migration complete!');
    console.log('You can now run `make db-push` to add the unique constraint.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
