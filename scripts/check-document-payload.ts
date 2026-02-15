#!/usr/bin/env bun
import { and, eq, like } from '../packages/db/node_modules/drizzle-orm';
import { getDb, messages } from '../packages/db/src/index';

const db = getDb();

// Search for any document messages from Raphael
const docs = await db
  .select()
  .from(messages)
  .where(and(eq(messages.messageType, 'document'), like(messages.senderDisplayName, '%Raphael%')))
  .limit(10);

console.log(`Found ${docs.length} document messages from Raphael`);

for (const doc of docs) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Message ID: ${doc.externalId}`);
  console.log(`Date: ${doc.platformTimestamp}`);
  console.log(`Sender: ${doc.senderDisplayName}`);
  console.log(`Text: ${doc.textContent}`);
  console.log(`MIME: ${doc.mediaMimeType}`);
  console.log(`Media URL: ${doc.mediaUrl}`);
  console.log(`Local Path: ${doc.mediaLocalPath}`);

  // Check raw payload for document URL
  if (doc.rawPayload && typeof doc.rawPayload === 'object') {
    const payload = doc.rawPayload as Record<string, unknown>;
    const msg = (payload.message || {}) as Record<string, unknown>;
    const documentMessage = msg.documentMessage as Record<string, unknown> | undefined;
    if (documentMessage) {
      console.log('\nDocument Message in Payload:');
      console.log(`  fileName: ${documentMessage.fileName}`);
      console.log(`  url: ${documentMessage.url}`);
      console.log(`  directPath: ${documentMessage.directPath}`);
      console.log(`  mimetype: ${documentMessage.mimetype}`);
      console.log(`  fileLength: ${documentMessage.fileLength}`);
    }
  }
}
