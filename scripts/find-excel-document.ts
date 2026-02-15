#!/usr/bin/env bun
/**
 * Find Excel document from Raphael's chat with complete chat and message details
 */
import { eq, like, or, sql } from '../packages/db/node_modules/drizzle-orm';
import { chats, getDb, messages } from '../packages/db/src/index';

const db = getDb();

console.log('\n🔍 Searching for Excel documents across all chats:\n');

// Search for document messages (Excel, Word, PDF, etc.)
const documentMessages = (await db
  .select({
    messageId: messages.id,
    chatId: messages.chatId,
    chatName: chats.name,
    chatExternalId: chats.externalId,
    externalId: messages.externalId,
    messageType: messages.messageType,
    textContent: messages.textContent,
    platformTimestamp: messages.platformTimestamp,
    senderDisplayName: messages.senderDisplayName,
    mediaMimeType: messages.mediaMimeType,
    mediaUrl: messages.mediaUrl,
    mediaLocalPath: messages.mediaLocalPath,
    hasMedia: messages.hasMedia,
  })
  .from(messages)
  .leftJoin(chats, eq(messages.chatId, chats.id))
  .where(
    or(
      eq(messages.messageType, 'document'),
      like(messages.mediaMimeType, '%application%'),
      like(messages.mediaMimeType, '%spreadsheet%'),
      like(messages.mediaMimeType, '%excel%'),
    ),
  )
  .orderBy(sql`${messages.platformTimestamp} DESC`)
  .limit(50)) as Array<{
  messageId: string;
  chatId: string;
  chatName: string | null;
  chatExternalId: string;
  externalId: string;
  messageType: string;
  textContent: string | null;
  platformTimestamp: Date;
  senderDisplayName: string | null;
  mediaMimeType: string | null;
  mediaUrl: string | null;
  mediaLocalPath: string | null;
  hasMedia: boolean;
}>;

if (documentMessages.length === 0) {
  console.log('❌ No document messages found in database\n');
  process.exit(1);
}

console.log(`✅ Found ${documentMessages.length} document message(s):\n`);
console.log('─'.repeat(120));
console.log(`${'Chat Name'.padEnd(30)} | ${'Sender'.padEnd(20)} | ${'Date'.padEnd(20)} | Type`);
console.log('─'.repeat(120));

for (const msg of documentMessages) {
  const chatDisplay = (msg.chatName || 'Unknown').substring(0, 28).padEnd(30);
  const sender = (msg.senderDisplayName || 'Unknown').substring(0, 18).padEnd(20);
  const date = msg.platformTimestamp.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const mimeType = msg.mediaMimeType || 'unknown';

  console.log(`${chatDisplay} | ${sender} | ${date.padEnd(20)} | ${mimeType}`);

  // Show text content if available (often contains filename)
  if (msg.textContent) {
    console.log(`  📄 Text: ${msg.textContent.substring(0, 80)}`);
  }

  // Show media details
  if (msg.mediaLocalPath) {
    console.log(`  💾 Local: ${msg.mediaLocalPath}`);
  }
  if (msg.mediaUrl) {
    console.log(`  🔗 URL: ${msg.mediaUrl.substring(0, 80)}`);
  }

  console.log(`  🆔 Chat: ${msg.chatExternalId}`);
  console.log(`  📨 Message ID: ${msg.externalId}`);
  console.log();
}

// Now specifically search for Raphael's chats
console.log("\n🔍 Checking specifically for Raphael Rosa's chats:\n");

const raphaelChats = (await db
  .select({
    id: chats.id,
    name: chats.name,
    externalId: chats.externalId,
    messageCount: chats.messageCount,
    lastMessageAt: chats.lastMessageAt,
  })
  .from(chats)
  .where(
    or(
      like(chats.name, '%Raphael%'),
      like(chats.name, '%Rosa%'),
      eq(chats.externalId, '553496835777@s.whatsapp.net'),
      eq(chats.externalId, '63750317031625@lid'),
    ),
  )
  .orderBy(sql`${chats.lastMessageAt} DESC NULLS LAST`)) as Array<{
  id: string;
  name: string | null;
  externalId: string;
  messageCount: number;
  lastMessageAt: Date | null;
}>;

for (const chat of raphaelChats) {
  console.log(`📱 ${chat.name} (${chat.externalId})`);
  console.log(`   Messages: ${chat.messageCount}, Last: ${chat.lastMessageAt?.toLocaleString() || 'never'}`);

  // Check for documents in this chat
  const docsInChat = documentMessages.filter((m) => m.chatExternalId === chat.externalId);
  if (docsInChat.length > 0) {
    console.log(`   ✅ Found ${docsInChat.length} document(s) in this chat`);
  } else {
    console.log('   ❌ No documents found in this chat');
  }
  console.log();
}

process.exit(0);
