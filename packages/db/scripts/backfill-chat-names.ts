#!/usr/bin/env bun
/**
 * Backfill script: Fix DM chat names that show raw JIDs instead of contact names
 *
 * DM chats can end up with a raw JID (e.g., "225671238410292@lid") as their name
 * when WhatsApp doesn't provide a displayName at chat creation time. This script:
 *
 *   1. Finds DM chats where name IS NULL or is a raw JID (ends with @lid / @s.whatsapp.net)
 *   2. Looks up the participant display name for each chat
 *   3. Updates the chat name from the participant's displayName
 *   4. Clears JID-as-name values that have no participant match (so they show as empty)
 *
 * Usage:
 *   cd packages/db && bun run scripts/backfill-chat-names.ts [--dry-run]
 *
 * Or from root:
 *   bun run packages/db/scripts/backfill-chat-names.ts --dry-run
 */

import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { chatParticipants, chats, createDb } from '../src';

const db = createDb();
const isDryRun = process.argv.includes('--dry-run');

/** Returns true if the name is a raw JID (not a human-readable name) */
function isJidName(name: string | null | undefined): boolean {
  if (!name) return true;
  return name.endsWith('@lid') || name.endsWith('@s.whatsapp.net') || name.endsWith('@g.us');
}

async function backfillChatNames() {
  console.log(`\n📛 Backfill Chat Names ${isDryRun ? '(DRY RUN)' : ''}\n`);

  // Find DM chats with null or JID-as-name
  const targetChats = await db
    .select({ id: chats.id, name: chats.name, externalId: chats.externalId, instanceId: chats.instanceId })
    .from(chats)
    .where(
      and(
        eq(chats.chatType, 'dm'),
        isNull(chats.deletedAt),
        or(
          isNull(chats.name),
          sql`${chats.name} LIKE '%@lid'`,
          sql`${chats.name} LIKE '%@s.whatsapp.net'`,
          sql`${chats.name} LIKE '%@g.us'`,
        ),
      ),
    );

  console.log(`Found ${targetChats.length} DM chats with missing or JID names\n`);

  if (targetChats.length === 0) {
    console.log('✅ All DM chats already have proper names\n');
    return;
  }

  // Fetch all participants for these chats
  const chatIds = targetChats.map((c) => c.id);
  const participants = await db
    .select({ chatId: chatParticipants.chatId, displayName: chatParticipants.displayName })
    .from(chatParticipants)
    .where(and(inArray(chatParticipants.chatId, chatIds), sql`${chatParticipants.displayName} IS NOT NULL`));

  // Build chatId → first non-null displayName map
  const nameMap = new Map<string, string>();
  for (const p of participants) {
    if (p.displayName && !nameMap.has(p.chatId)) {
      nameMap.set(p.chatId, p.displayName);
    }
  }

  let updated = 0;
  let cleared = 0;
  let skipped = 0;

  for (const chat of targetChats) {
    const participantName = nameMap.get(chat.id);

    if (participantName) {
      if (isDryRun) {
        console.log(`  Would set "${chat.name ?? 'NULL'}" → "${participantName}" (${chat.externalId})`);
      } else {
        await db.update(chats).set({ name: participantName, updatedAt: new Date() }).where(eq(chats.id, chat.id));
      }
      updated++;
    } else if (chat.name && isJidName(chat.name)) {
      // JID-as-name, no participant → clear it so the UI shows a placeholder
      if (isDryRun) {
        console.log(`  Would clear JID name "${chat.name}" → NULL (${chat.externalId}, no participant found)`);
      } else {
        await db.update(chats).set({ name: null, updatedAt: new Date() }).where(eq(chats.id, chat.id));
      }
      cleared++;
    } else {
      skipped++;
    }
  }

  console.log('\n📊 Results:');
  console.log(`   Updated (from participant): ${updated}`);
  console.log(`   Cleared (JID removed):      ${cleared}`);
  console.log(`   Skipped (no action):        ${skipped}`);

  if (isDryRun) {
    console.log('\n💡 Run without --dry-run to apply changes');
  } else {
    console.log('\n✅ Backfill complete');
  }
}

backfillChatNames()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
