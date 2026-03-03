#!/usr/bin/env bun
/**
 * Backfill script: Create a Conversation for every Chat that lacks one
 *
 * Chats created before the conversations table was introduced will have
 * conversationId = NULL. This script:
 *
 *   1. Finds all chats where conversationId IS NULL
 *   2. Creates one Conversation per Chat
 *   3. Updates chats.conversationId to point at the new Conversation
 *
 * Usage:
 *   cd packages/db && bun run scripts/backfill-conversations.ts [--dry-run]
 *
 * Or from root:
 *   bun run packages/db/scripts/backfill-conversations.ts --dry-run
 */

import { eq, isNull } from 'drizzle-orm';
import { chats, conversations, createDb } from '../src';

const db = createDb();
const isDryRun = process.argv.includes('--dry-run');

async function backfillConversations() {
  console.log(`\nBackfill Conversations ${isDryRun ? '(DRY RUN)' : ''}\n`);

  // Find chats with no conversationId
  const orphanChats = await db
    .select({ id: chats.id, name: chats.name, createdAt: chats.createdAt, updatedAt: chats.updatedAt })
    .from(chats)
    .where(isNull(chats.conversationId));

  console.log(`Found ${orphanChats.length} chats without a conversationId\n`);

  if (orphanChats.length === 0) {
    console.log('All chats already have a conversation assigned\n');
    return;
  }

  let created = 0;

  for (const chat of orphanChats) {
    if (isDryRun) {
      console.log(`  Would create conversation for chat ${chat.id} ("${chat.name ?? 'untitled'}")`);
      created++;
      continue;
    }

    // Create Conversation + link Chat atomically
    try {
      await db.transaction(async (tx) => {
        const [conv] = await tx
          .insert(conversations)
          .values({
            title: chat.name ?? null,
            createdAt: chat.createdAt,
            updatedAt: chat.updatedAt,
          })
          .returning({ id: conversations.id });

        if (!conv) throw new Error('insert failed');

        await tx.update(chats).set({ conversationId: conv.id }).where(eq(chats.id, chat.id));
      });
    } catch (err) {
      console.error(`  Failed to create conversation for chat ${chat.id}: ${err}`);
      continue;
    }

    created++;

    // Progress logging every 100
    if (created % 100 === 0) {
      console.log(`  Progress: ${created}/${orphanChats.length}`);
    }
  }

  console.log('\nResults:');
  console.log(`  Conversations created: ${created}`);
  console.log(`  Total chats processed: ${orphanChats.length}`);

  if (isDryRun) {
    console.log('\nRun without --dry-run to apply changes');
  } else {
    console.log('\nBackfill complete');
  }
}

backfillConversations()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
