/**
 * Re-download missing media files from WhatsApp CDN
 *
 * Uses raw WAMessage data stored in omni_events to re-download media
 * that wasn't saved locally (e.g., due to access control blocking).
 *
 * Usage:
 *   DRY_RUN=1 bun scripts/redownload-media.ts          # Preview
 *   bun scripts/redownload-media.ts                     # Execute
 *   CONTENT_TYPE=audio bun scripts/redownload-media.ts  # Audio only
 *   INSTANCE_ID=3704fdcc-... bun scripts/redownload-media.ts  # Specific instance
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { downloadMediaMessage } from '../packages/channel-whatsapp/node_modules/@whiskeysockets/baileys';
import type { WAMessage } from '../packages/channel-whatsapp/node_modules/@whiskeysockets/baileys';
import postgres from '../packages/db/node_modules/postgres';

const DRY_RUN = process.env.DRY_RUN === '1';
const CONTENT_TYPE = process.env.CONTENT_TYPE || 'audio';
const INSTANCE_ID = process.env.INSTANCE_ID;
const DAYS_BACK = Number(process.env.DAYS_BACK || '30');
const MEDIA_BASE = join(import.meta.dir, '..', 'data', 'media');

const sql = postgres(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:8432/omni');

function getExtension(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('opus')) return 'ogg';
  return 'bin';
}

async function main() {
  const since = new Date();
  since.setDate(since.getDate() - DAYS_BACK);

  console.log(`\n=== Re-download missing media (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) ===`);
  console.log(`Content type: ${CONTENT_TYPE}`);
  console.log(`Since: ${since.toISOString()}`);
  if (INSTANCE_ID) console.log(`Instance: ${INSTANCE_ID}`);

  const instanceFilter = INSTANCE_ID ? sql`AND e.instance_id = ${INSTANCE_ID}` : sql``;

  const rows = await sql`
    SELECT DISTINCT ON (m.id)
      m.id as message_id,
      m.external_id,
      e.instance_id,
      e.raw_payload,
      m.platform_timestamp
    FROM messages m
    JOIN chats c ON c.id = m.chat_id
    JOIN omni_events e ON e.external_id = m.external_id AND e.instance_id = c.instance_id
    WHERE m.has_media = true
      AND m.message_type = ${CONTENT_TYPE}
      AND m.media_local_path IS NULL
      AND m.platform_timestamp >= ${since.toISOString()}
      AND e.event_type = ${'message.received'}
      AND e.raw_payload IS NOT NULL
      ${instanceFilter}
    ORDER BY m.id, e.received_at DESC
  `;

  console.log(`Found ${rows.length} messages to re-download\n`);

  let downloaded = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const rawPayload = row.raw_payload as Record<string, unknown>;
    const instanceId = row.instance_id as string;
    const externalId = row.external_id as string;
    const messageId = row.message_id as string;
    const ts = row.platform_timestamp as Date;

    // Reconstruct WAMessage from raw_payload
    const waMessage: WAMessage = {
      key: rawPayload.key as WAMessage['key'],
      message: rawPayload.message as WAMessage['message'],
      messageTimestamp: rawPayload.messageTimestamp as number,
    };

    if (!waMessage.message) {
      console.log(`  SKIP ${externalId} - no message content in raw_payload`);
      skipped++;
      continue;
    }

    // Determine file path
    const month = ts ? `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}` : '2026-02';
    const mediaMsg =
      waMessage.message.audioMessage ||
      waMessage.message.pttMessage ||
      waMessage.message.imageMessage ||
      waMessage.message.videoMessage ||
      waMessage.message.documentMessage ||
      waMessage.message.stickerMessage;
    const mimeType = (mediaMsg as { mimetype?: string })?.mimetype || 'audio/ogg';
    const ext = getExtension(mimeType);
    const relativePath = `${instanceId}/${month}/${externalId}.${ext}`;
    const fullPath = join(MEDIA_BASE, relativePath);

    if (DRY_RUN) {
      console.log(`  WOULD download ${externalId} → ${relativePath}`);
      downloaded++;
      continue;
    }

    // Check if file already exists
    try {
      await stat(fullPath);
      console.log(`  EXISTS ${externalId} → ${relativePath}`);
      // Update message with existing path
      await sql`UPDATE messages SET media_local_path = ${relativePath} WHERE id = ${messageId}`;
      downloaded++;
      continue;
    } catch {
      // File doesn't exist, proceed with download
    }

    try {
      const buffer = await downloadMediaMessage(waMessage, 'buffer', {});

      if (!buffer || !(buffer instanceof Buffer) || buffer.length === 0) {
        console.log(`  FAIL ${externalId} - empty buffer`);
        failed++;
        continue;
      }

      // Save file
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, buffer);

      // Update message with local path
      await sql`UPDATE messages SET media_local_path = ${relativePath} WHERE id = ${messageId}`;

      console.log(`  OK ${externalId} → ${relativePath} (${(buffer.length / 1024).toFixed(1)}KB)`);
      downloaded++;
    } catch (error) {
      const errMsg = String(error);
      if (errMsg.includes('404') || errMsg.includes('410')) {
        console.log(`  EXPIRED ${externalId} - media no longer available`);
      } else {
        console.log(`  FAIL ${externalId} - ${errMsg.slice(0, 80)}`);
      }
      failed++;
    }
  }

  console.log('\n=== Results ===');
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${skipped}`);

  await sql.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
