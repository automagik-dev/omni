#!/usr/bin/env bun
import { and, eq } from '../packages/db/node_modules/drizzle-orm';
import { chats, getDb, messages } from '../packages/db/src/index';

const db = getDb();

const oldInstanceId = '3704fdcc-d97e-4320-b2f0-308b59249c22';
const raphaelExternalId = '553496835777@s.whatsapp.net';

// Get Raphael's chat in old instance
const raphaelChat = await db.query.chats.findFirst({
  where: and(eq(chats.instanceId, oldInstanceId), eq(chats.externalId, raphaelExternalId)),
});

if (!raphaelChat) {
  console.log('❌ Raphael chat not found in old instance');
  process.exit(1);
}

console.log(`\n✅ Found Raphael's chat: ${raphaelChat.id}`);
console.log(`   Messages: ${raphaelChat.messageCount}\n`);

// Get all document messages in this chat
const docs = await db
  .select()
  .from(messages)
  .where(and(eq(messages.chatId, raphaelChat.id), eq(messages.messageType, 'document')))
  .orderBy(messages.platformTimestamp);

console.log(`📄 Found ${docs.length} document message(s):\n`);

for (const doc of docs) {
  console.log(`  ${new Date(doc.platformTimestamp).toLocaleString()}`);
  console.log(`  Sender: ${doc.senderDisplayName || 'Unknown'}`);
  console.log(`  Text: ${doc.textContent || '[no text]'}`);
  console.log(`  MIME: ${doc.mediaMimeType}`);
  console.log(`  mediaUrl: ${doc.mediaUrl || 'NULL'}`);
  console.log(`  mediaLocalPath: ${doc.mediaLocalPath || 'NULL'}`);
  console.log(`  hasMedia: ${doc.hasMedia}`);
  console.log();
}

// Check for the specific Excel document
const excel = docs.find((d) => d.textContent?.includes('Nova árvore de categorização'));

if (excel) {
  console.log('✅ EXCEL DOCUMENT FOUND!');
  console.log(`   mediaUrl populated: ${excel.mediaUrl ? 'YES' : 'NO'}`);
  console.log(`   mediaLocalPath populated: ${excel.mediaLocalPath ? 'YES' : 'NO'}`);
} else {
  console.log('❌ Excel "Nova árvore de categorização 1.xlsx" not found');
}
