#!/usr/bin/env bun
/**
 * Migration Script: Events → Chats + Messages
 *
 * Backfills existing omni_events into the unified chats/messages tables.
 * This is a one-time migration to populate the new schema from existing data.
 *
 * Usage:
 *   cd packages/api && bun run scripts/migrate-events-to-messages.ts [--dry-run] [--limit N]
 *
 * @see unified-messages wish
 */

import { createDb, getDefaultDatabaseUrl } from '@omni/db';
import {
  type ChannelType,
  type ChatType,
  type MessageType,
  chatParticipants,
  chats,
  messages,
  omniEvents,
} from '@omni/db';
import { and, asc, eq, sql } from 'drizzle-orm';

// Configuration
const DATABASE_URL = process.env.DATABASE_URL ?? getDefaultDatabaseUrl();
const BATCH_SIZE = 100;

// Parse CLI arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex !== -1 ? Number.parseInt(args[limitIndex + 1], 10) : undefined;

console.log('='.repeat(60));
console.log('Unified Messages Migration');
console.log('='.repeat(60));
console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
console.log(`Limit: ${limit ?? 'None'}`);
console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
console.log('');

// Create database connection
const db = createDb({ url: DATABASE_URL });

// Stats
const stats = {
  eventsProcessed: 0,
  chatsCreated: 0,
  chatsFound: 0,
  messagesCreated: 0,
  messagesSkipped: 0,
  participantsCreated: 0,
  errors: 0,
};

/**
 * Map content type to message type
 */
function mapContentType(contentType: string | null): MessageType {
  switch (contentType) {
    case 'audio':
      return 'audio';
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'document':
      return 'document';
    case 'sticker':
      return 'sticker';
    case 'contact':
      return 'contact';
    case 'location':
      return 'location';
    default:
      return 'text';
  }
}

/**
 * Infer chat type from chat ID
 */
function inferChatType(chatId: string | null): ChatType {
  if (!chatId) return 'dm';
  if (chatId.includes('@g.us') || chatId.includes('@broadcast')) return 'group';
  if (chatId.includes('@newsletter')) return 'channel';
  return 'dm';
}

/**
 * Find or create a chat
 */
async function findOrCreateChat(
  instanceId: string,
  externalId: string,
  channel: ChannelType,
  chatType: ChatType,
): Promise<{ id: string; created: boolean }> {
  // Check if chat already exists
  const [existing] = await db
    .select({ id: chats.id })
    .from(chats)
    .where(and(eq(chats.instanceId, instanceId), eq(chats.externalId, externalId)))
    .limit(1);

  if (existing) {
    stats.chatsFound++;
    return { id: existing.id, created: false };
  }

  if (dryRun) {
    stats.chatsCreated++;
    return { id: 'dry-run-id', created: true };
  }

  // Create chat
  const [created] = await db
    .insert(chats)
    .values({
      instanceId,
      externalId,
      channel,
      chatType,
    })
    .returning({ id: chats.id });

  stats.chatsCreated++;
  return { id: created.id, created: true };
}

/**
 * Find or create a participant
 */
async function findOrCreateParticipant(
  chatId: string,
  platformUserId: string,
  displayName?: string,
): Promise<{ id: string; created: boolean }> {
  if (dryRun) {
    stats.participantsCreated++;
    return { id: 'dry-run-id', created: true };
  }

  // Check if participant already exists
  const [existing] = await db
    .select({ id: chatParticipants.id })
    .from(chatParticipants)
    .where(and(eq(chatParticipants.chatId, chatId), eq(chatParticipants.platformUserId, platformUserId)))
    .limit(1);

  if (existing) {
    return { id: existing.id, created: false };
  }

  // Create participant
  const [created] = await db
    .insert(chatParticipants)
    .values({
      chatId,
      platformUserId,
      displayName,
    })
    .returning({ id: chatParticipants.id });

  stats.participantsCreated++;
  return { id: created.id, created: true };
}

/**
 * Check if message already exists
 */
async function messageExists(chatId: string, externalId: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.externalId, externalId)))
    .limit(1);

  return !!existing;
}

/**
 * Create a message from an event
 */
async function createMessageFromEvent(
  chatId: string,
  event: {
    id: string;
    externalId: string | null;
    eventType: string | null;
    direction: string | null;
    contentType: string | null;
    textContent: string | null;
    mediaUrl: string | null;
    mediaMimeType: string | null;
    personId: string | null;
    platformIdentityId: string | null;
    replyToExternalId: string | null;
    rawPayload: unknown;
    receivedAt: Date | null;
  },
): Promise<void> {
  if (!event.externalId) {
    stats.messagesSkipped++;
    return;
  }

  // Check if message already exists
  if (!dryRun && (await messageExists(chatId, event.externalId))) {
    stats.messagesSkipped++;
    return;
  }

  if (dryRun) {
    stats.messagesCreated++;
    return;
  }

  // Extract sender info from raw payload
  const rawPayload = event.rawPayload as Record<string, unknown> | null;
  const from = rawPayload?.from as string | undefined;
  const pushName = rawPayload?.pushName as string | undefined;

  // Create message
  await db.insert(messages).values({
    chatId,
    externalId: event.externalId,
    source: 'realtime', // Events are always from real-time
    messageType: mapContentType(event.contentType),
    textContent: event.textContent,
    platformTimestamp: event.receivedAt ?? new Date(),
    // Sender info
    senderPersonId: event.personId,
    senderPlatformIdentityId: event.platformIdentityId,
    senderPlatformUserId: from,
    senderDisplayName: pushName,
    isFromMe: event.direction === 'outbound',
    // Media
    hasMedia: !!(event.mediaUrl || event.mediaMimeType),
    mediaMimeType: event.mediaMimeType,
    mediaUrl: event.mediaUrl,
    // Reply
    replyToExternalId: event.replyToExternalId,
    // Raw data
    rawPayload: rawPayload,
    // Event links
    originalEventId: event.id,
    latestEventId: event.id,
  });

  stats.messagesCreated++;
}

/**
 * Process a single event into chat/message
 */
async function processEvent(event: {
  id: string;
  externalId: string | null;
  instanceId: string | null;
  channel: string | null;
  chatId: string | null;
  eventType: string | null;
  direction: string | null;
  contentType: string | null;
  textContent: string | null;
  mediaUrl: string | null;
  mediaMimeType: string | null;
  personId: string | null;
  platformIdentityId: string | null;
  replyToExternalId: string | null;
  rawPayload: unknown;
  receivedAt: Date | null;
}): Promise<void> {
  // Skip events without instanceId or chatId
  if (!event.instanceId || !event.chatId) {
    stats.eventsProcessed++;
    return;
  }

  // Skip non-message events
  if (!event.eventType?.startsWith('message.')) {
    stats.eventsProcessed++;
    return;
  }

  // Find or create chat
  const chat = await findOrCreateChat(
    event.instanceId,
    event.chatId,
    event.channel as ChannelType,
    inferChatType(event.chatId),
  );

  // Create participant if we have sender info
  const rawPayload = event.rawPayload as Record<string, unknown> | null;
  const from = rawPayload?.from as string | undefined;
  if (from && !dryRun) {
    await findOrCreateParticipant(chat.id, from, rawPayload?.pushName as string | undefined);
  }

  // Create message
  await createMessageFromEvent(chat.id, event);

  stats.eventsProcessed++;
}

/**
 * Fetch a batch of events from the database
 */
async function fetchEventBatch(batchSize: number, offset: number) {
  return db
    .select({
      id: omniEvents.id,
      externalId: omniEvents.externalId,
      instanceId: omniEvents.instanceId,
      channel: omniEvents.channel,
      chatId: omniEvents.chatId,
      eventType: omniEvents.eventType,
      direction: omniEvents.direction,
      contentType: omniEvents.contentType,
      textContent: omniEvents.textContent,
      mediaUrl: omniEvents.mediaUrl,
      mediaMimeType: omniEvents.mediaMimeType,
      personId: omniEvents.personId,
      platformIdentityId: omniEvents.platformIdentityId,
      replyToExternalId: omniEvents.replyToExternalId,
      rawPayload: omniEvents.rawPayload,
      receivedAt: omniEvents.receivedAt,
    })
    .from(omniEvents)
    .orderBy(asc(omniEvents.receivedAt))
    .limit(batchSize)
    .offset(offset);
}

/**
 * Print progress update
 */
function printProgress(processed: number, total: number): void {
  const pct = Math.round((processed / total) * 100);
  const chatsTotal = stats.chatsCreated + stats.chatsFound;
  process.stdout.write(
    `\rProgress: ${processed}/${total} (${pct}%) - Chats: ${chatsTotal}, Messages: ${stats.messagesCreated}`,
  );
}

/**
 * Main migration function
 */
async function migrate(): Promise<void> {
  console.log('Starting migration...\n');

  // Count total events
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(omniEvents);
  const totalEvents = Number(count);
  console.log(`Total events in database: ${totalEvents}`);

  if (totalEvents === 0) {
    console.log('No events to migrate.');
    return;
  }

  const eventsToProcess = limit ? Math.min(limit, totalEvents) : totalEvents;
  console.log(`Events to process: ${eventsToProcess}\n`);

  // Process in batches
  let offset = 0;
  let processed = 0;

  while (processed < eventsToProcess) {
    const batchSize = Math.min(BATCH_SIZE, eventsToProcess - processed);
    const events = await fetchEventBatch(batchSize, offset);

    if (events.length === 0) break;

    // Process each event
    for (const event of events) {
      try {
        await processEvent(event);
      } catch (error) {
        stats.errors++;
        console.error(`Error processing event ${event.id}:`, error);
      }
    }

    offset += batchSize;
    processed += events.length;
    printProgress(processed, eventsToProcess);
  }

  console.log('\n');
}

/**
 * Print final statistics
 */
function printStats(): void {
  console.log('='.repeat(60));
  console.log('Migration Statistics');
  console.log('='.repeat(60));
  console.log(`Events processed:    ${stats.eventsProcessed}`);
  console.log(`Chats created:       ${stats.chatsCreated}`);
  console.log(`Chats found:         ${stats.chatsFound}`);
  console.log(`Messages created:    ${stats.messagesCreated}`);
  console.log(`Messages skipped:    ${stats.messagesSkipped}`);
  console.log(`Participants:        ${stats.participantsCreated}`);
  console.log(`Errors:              ${stats.errors}`);
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('\nThis was a DRY RUN. No changes were made.');
    console.log('Run without --dry-run to apply changes.');
  }
}

// Run migration
migrate()
  .then(() => {
    printStats();
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
