#!/usr/bin/env bun
import { and, eq, like } from '../packages/db/node_modules/drizzle-orm';
import { getDb, messages } from '../packages/db/src/index';

const db = getDb();

const _oldInstanceId = '3704fdcc-d97e-4320-b2f0-308b59249c22';
const _raphaelExternalId = '553496835777@s.whatsapp.net';

// Search for Excel document in Raphael's chat
const docs = await db
  .select()
  .from(messages)
  .where(and(eq(messages.messageType, 'document'), like(messages.mediaMimeType, '%spreadsheet%')));

console.log(`\n📄 Found ${docs.length} Excel document(s) total\n`);

// Filter for Raphael's chat in old instance
const raphaelDocs = docs.filter((d) => {
  // Get chat from message to check instance
  return d.textContent?.includes('Nova árvore de categorização');
});

if (raphaelDocs.length === 0) {
  console.log('❌ Excel document "Nova árvore de categorização 1.xlsx" NOT found in old instance');
  console.log('\nThis is expected before reconnection.');
} else {
  console.log('✅ Excel document found!');
  for (const doc of raphaelDocs) {
    console.log(`\n  Date: ${doc.platformTimestamp}`);
    console.log(`  Text: ${doc.textContent}`);
    console.log(`  MIME: ${doc.mediaMimeType}`);
    console.log(`  mediaUrl: ${doc.mediaUrl || 'NULL'}`);
    console.log(`  mediaLocalPath: ${doc.mediaLocalPath || 'NULL'}`);
  }
}
