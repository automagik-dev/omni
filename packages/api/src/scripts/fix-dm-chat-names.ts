/**
 * Fix DM chat names that are incorrectly set to the sender's name
 * instead of the other person's name.
 *
 * Usage: bun run src/scripts/fix-dm-chat-names.ts
 */

import { createDb } from '@omni/db';
import { chatParticipants, chats } from '@omni/db';
import { and, eq, isNotNull } from 'drizzle-orm';

const db = createDb();

async function fixDmChatNames() {
  console.log('🔍 Finding DM chats with potentially wrong names...\n');

  // Find all DM chats
  const dmChats = await db
    .select({
      id: chats.id,
      instanceId: chats.instanceId,
      externalId: chats.externalId,
      currentName: chats.name,
    })
    .from(chats)
    .where(and(eq(chats.chatType, 'dm'), isNotNull(chats.name)));

  console.log(`Found ${dmChats.length} DM chats with names\n`);

  let fixed = 0;
  let skipped = 0;

  for (const chat of dmChats) {
    // Get all participants for this chat
    const participants = await db
      .select({
        platformUserId: chatParticipants.platformUserId,
        displayName: chatParticipants.displayName,
      })
      .from(chatParticipants)
      .where(and(eq(chatParticipants.chatId, chat.id), isNotNull(chatParticipants.displayName)));

    if (participants.length === 0) {
      console.log(`⏭️  ${chat.currentName} - no participants with names, skipping`);
      skipped++;
      continue;
    }

    // For a DM, the chat should be named after the OTHER person
    // Find a participant whose name is NOT the current chat name
    // (the current name might be the sender's name, which is wrong)
    const otherPerson = participants.find((p) => p.displayName && p.displayName !== chat.currentName);

    if (!otherPerson?.displayName) {
      // If all participants have the same name as the chat, it's probably correct
      console.log(`✅ ${chat.currentName} - already correct`);
      skipped++;
      continue;
    }

    // Update the chat name to the other person's name
    console.log(`🔧 Fixing: "${chat.currentName}" → "${otherPerson.displayName}"`);

    await db.update(chats).set({ name: otherPerson.displayName }).where(eq(chats.id, chat.id));

    fixed++;
  }

  console.log(`\n✅ Fixed ${fixed} chat names`);
  console.log(`⏭️  Skipped ${skipped} chats (already correct or no data)`);
}

fixDmChatNames()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
