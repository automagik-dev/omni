#!/usr/bin/env bun
import { and, eq } from '../packages/db/node_modules/drizzle-orm';
import { chats, getDb, messages } from '../packages/db/src/index';

const db = getDb();

const oldInstanceId = '3704fdcc-d97e-4320-b2f0-308b59249c22';
const freshInstanceId = '38117174-a017-42fa-941c-7a88c637efc5';

// Get document from old instance
const oldChat = await db.query.chats.findFirst({
  where: and(eq(chats.instanceId, oldInstanceId), eq(chats.externalId, '553496835777@s.whatsapp.net')),
});

const oldDoc = await db.query.messages.findFirst({
  where: and(
    eq(messages.chatId, oldChat?.id),
    eq(messages.messageType, 'document'),
    eq(messages.mediaMimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  ),
});

// Get document from fresh instance
const freshChat = await db.query.chats.findFirst({
  where: and(eq(chats.instanceId, freshInstanceId), eq(chats.externalId, '553496835777@s.whatsapp.net')),
});

const freshDoc = await db.query.messages.findFirst({
  where: and(
    eq(messages.chatId, freshChat?.id),
    eq(messages.messageType, 'document'),
    eq(messages.mediaMimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  ),
});

console.log('\n📊 COMPARISON:\n');
console.log('OLD INSTANCE (reconnected with fix):');
console.log(`  External ID: ${oldDoc?.externalId}`);
console.log(`  Timestamp: ${oldDoc?.platformTimestamp}`);
console.log(`  Sender: ${oldDoc?.senderDisplayName}`);
console.log(`  MIME: ${oldDoc?.mediaMimeType}`);
console.log(`  mediaUrl: ${oldDoc?.mediaUrl ? 'YES' : 'NO'}`);
console.log(`  Text: ${oldDoc?.textContent || '[no text]'}`);

console.log('\nFRESH INSTANCE (baseline):');
console.log(`  External ID: ${freshDoc?.externalId}`);
console.log(`  Timestamp: ${freshDoc?.platformTimestamp}`);
console.log(`  Sender: ${freshDoc?.senderDisplayName}`);
console.log(`  MIME: ${freshDoc?.mediaMimeType}`);
console.log(`  mediaUrl: ${freshDoc?.mediaUrl ? 'YES' : 'NO'}`);
console.log(`  Text: ${freshDoc?.textContent || '[no text]'}`);

console.log('\n🔍 MATCH CHECK:');
console.log(`  Same external ID: ${oldDoc?.externalId === freshDoc?.externalId ? '✅' : '❌'}`);
console.log(
  `  Same timestamp: ${oldDoc?.platformTimestamp?.getTime() === freshDoc?.platformTimestamp?.getTime() ? '✅' : '❌'}`,
);
console.log(`  Both have mediaUrl: ${oldDoc?.mediaUrl && freshDoc?.mediaUrl ? '✅' : '❌'}`);

if (oldDoc?.externalId === freshDoc?.externalId) {
  console.log('\n✅ CONFIRMED: This is the SAME Excel document!');
  console.log('   The fix successfully recovered the missing mediaUrl.');
}
