#!/usr/bin/env bun
import { and, eq, gte } from '../packages/db/node_modules/drizzle-orm';
import { getDb, messages } from '../packages/db/src/index';

const db = getDb();

const feb14Start = new Date('2026-02-14T00:00:00Z');
const _feb15Start = new Date('2026-02-15T00:00:00Z');

const msgs = await db
  .select()
  .from(messages)
  .where(
    and(
      eq(
        messages.chatId,
        (
          await db.query.chats.findFirst({
            where: (chats, { eq }) => eq(chats.externalId, '553496835777@s.whatsapp.net'),
          })
        )?.id || 'none',
      ),
      gte(messages.platformTimestamp, feb14Start),
    ),
  )
  .orderBy(messages.platformTimestamp);

console.log(`\n📅 All messages from Raphael's chat on/after Feb 14:\n`);

for (const msg of msgs) {
  const time = new Date(msg.platformTimestamp).toLocaleString();
  console.log(`${time} | ${msg.messageType.padEnd(10)} | ${msg.senderDisplayName || 'Unknown'}`);
  if (msg.textContent) console.log(`  Text: ${msg.textContent.substring(0, 80)}`);
  if (msg.mediaUrl) console.log(`  Media: ${msg.mediaUrl}`);
  if (msg.messageType === 'document') {
    console.log('  ⚠️ DOCUMENT FOUND!');
    console.log(`     MIME: ${msg.mediaMimeType}`);
    console.log(`     URL: ${msg.mediaUrl || 'MISSING'}`);
    console.log(`     Local: ${msg.mediaLocalPath || 'MISSING'}`);
  }
  console.log();
}
