/**
 * Fix DM chat names - V2 with message lookup fallback
 *
 * Fixes DM chats where:
 * 1. Chat name is set to sender's name instead of recipient
 * 2. Participant displayName is missing but exists in messages
 *
 * Usage: bun run src/scripts/fix-dm-chat-names-v2.ts
 */

import { createDb } from '@omni/db';
import { chatParticipants, chats, messages } from '@omni/db';
import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';

const db = createDb();

async function fixDmChatNames() {
  console.log('🔍 Finding DM chats with potentially wrong names...\n');

  // Find all DM chats with names
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
      .where(eq(chatParticipants.chatId, chat.id));

    if (participants.length === 0) {
      console.log(`⏭️  ${chat.currentName} - no participants, skipping`);
      skipped++;
      continue;
    }

    // Try to find correct name from participants first
    let correctName: string | null = null;
    const participantsWithNames = participants.filter((p) => p.displayName);

    if (participantsWithNames.length > 0) {
      // Standard fix: find participant whose name is NOT the current chat name
      const otherPerson = participantsWithNames.find((p) => p.displayName !== chat.currentName);
      if (otherPerson?.displayName) {
        correctName = otherPerson.displayName;
      }
    }

    // Fallback: look at recent messages if no name found in participants
    if (!correctName) {
      const recentMessages = await db
        .select({
          senderPlatformUserId: messages.senderPlatformUserId,
          senderDisplayName: messages.senderDisplayName,
          isFromMe: messages.isFromMe,
        })
        .from(messages)
        .where(and(eq(messages.chatId, chat.id), isNotNull(messages.senderDisplayName), ne(messages.isFromMe, true)))
        .orderBy(desc(messages.platformTimestamp))
        .limit(10);

      // Find a name from messages that isn't the current chat name
      const otherPersonMessage = recentMessages.find(
        (m) => m.senderDisplayName && m.senderDisplayName !== chat.currentName,
      );

      if (otherPersonMessage?.senderDisplayName) {
        correctName = otherPersonMessage.senderDisplayName;
        console.log(`💡 Found name from messages: "${correctName}"`);
      }
    }

    // Check if we found a different name
    if (!correctName) {
      console.log(`⏭️  ${chat.currentName} - no alternative name found, skipping`);
      skipped++;
      continue;
    }

    if (correctName === chat.currentName) {
      console.log(`✅ ${chat.currentName} - already correct`);
      skipped++;
      continue;
    }

    // Update the chat name
    console.log(`🔧 Fixing: "${chat.currentName}" → "${correctName}"`);
    await db.update(chats).set({ name: correctName }).where(eq(chats.id, chat.id));

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
