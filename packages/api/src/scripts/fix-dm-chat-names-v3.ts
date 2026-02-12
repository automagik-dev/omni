/**
 * Fix DM chat names - V3 with correct user identification
 *
 * Key insight: For DM chats, externalId is the OTHER person's platform ID.
 * The chat should be named after the person whose ID matches the externalId.
 *
 * Usage: bun run src/scripts/fix-dm-chat-names-v3.ts
 */

import { createDb } from '@omni/db';
import { chatParticipants, chats, messages } from '@omni/db';
import { and, desc, eq, isNotNull } from 'drizzle-orm';

const db = createDb();

function normalizePlatformId(id: string): string {
  // Remove @s.whatsapp.net, @g.us, @lid suffixes
  return id.replace(/@s\.whatsapp\.net|@g\.us|@lid/, '');
}

async function fixDmChatNames() {
  console.log('🔍 Finding DM chats with potentially wrong names...\n');

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
    const normalizedExternalId = normalizePlatformId(chat.externalId);

    // Get all participants
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

    // Find the participant whose ID matches the chat's externalId
    // This is the OTHER person (not the user)
    const otherPerson = participants.find((p) => {
      const normalizedParticipantId = normalizePlatformId(p.platformUserId);
      return normalizedParticipantId === normalizedExternalId;
    });

    if (!otherPerson) {
      console.log(`⏭️  ${chat.currentName} - no participant matches externalId, skipping`);
      skipped++;
      continue;
    }

    // Try to get name from participant first
    let correctName = otherPerson.displayName;

    // If participant has no name, look in messages
    if (!correctName) {
      const recentMessages = await db
        .select({
          senderPlatformUserId: messages.senderPlatformUserId,
          senderDisplayName: messages.senderDisplayName,
        })
        .from(messages)
        .where(and(eq(messages.chatId, chat.id), isNotNull(messages.senderDisplayName)))
        .orderBy(desc(messages.platformTimestamp))
        .limit(10);

      // Find message from the other person
      const messageFromOther = recentMessages.find((m) => {
        const normalizedSenderId = normalizePlatformId(m.senderPlatformUserId ?? '');
        return normalizedSenderId === normalizedExternalId;
      });

      if (messageFromOther?.senderDisplayName) {
        correctName = messageFromOther.senderDisplayName;
        console.log(`💡 Found name from messages: "${correctName}"`);
      }
    }

    if (!correctName) {
      console.log(`⏭️  ${chat.currentName} - no name found for other person, skipping`);
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
