#!/usr/bin/env bun
import { eq } from '../packages/db/node_modules/drizzle-orm';
import { chats, getDb, messages } from '../packages/db/src/index';

const db = getDb();

const instanceId = '38117174-a017-42fa-941c-7a88c637efc5';

// Get all chats for this instance
const instanceChats = await db.select().from(chats).where(eq(chats.instanceId, instanceId));

console.log(`\n📱 New instance has ${instanceChats.length} chats\n`);

// Find Raphael's chat
const raphaelChat = instanceChats.find(
  (c) => c.externalId === '553496835777@s.whatsapp.net' || c.name?.toLowerCase().includes('raphael'),
);

if (!raphaelChat) {
  console.log('❌ No Raphael chat found yet\n');
  process.exit(0);
}

console.log(`✅ Found Raphael's chat: ${raphaelChat.name} (${raphaelChat.externalId})`);
console.log(`   Message count: ${raphaelChat.messageCount}\n`);

// Check for documents
const docs = await db.select().from(messages).where(eq(messages.chatId, raphaelChat.id));

const documentMsgs = docs.filter((m) => m.messageType === 'document');

console.log(`📄 Documents in this chat: ${documentMsgs.length}\n`);

for (const doc of documentMsgs) {
  console.log(`  ${new Date(doc.platformTimestamp).toLocaleString()}`);
  console.log(`  Type: ${doc.mediaMimeType}`);
  console.log(`  Text: ${doc.textContent || '[no text]'}`);
  console.log(`  Media URL: ${doc.mediaUrl || 'MISSING'}`);
  console.log(`  Local Path: ${doc.mediaLocalPath || 'MISSING'}`);
  console.log();
}
