/**
 * Event Persistence Handler
 *
 * Subscribes to message events and persists them to the omni_events table.
 * This provides the data backing for the /events API endpoints.
 */

import type { EventBus, MessageReceivedPayload, MessageSentPayload } from '@omni/core';
import { createLogger } from '@omni/core';
import type { Database, NewOmniEvent } from '@omni/db';
import { type ChannelType, type ContentType, channelTypes, contentTypes, omniEvents } from '@omni/db';
import { eq } from 'drizzle-orm';
import { deepSanitize, sanitizeText } from '../utils/utf8';

const log = createLogger('event-persistence');

/**
 * Safely map channel type - defaults to 'discord' if unknown
 * (all events should have a valid channel type from metadata)
 */
function mapChannelType(channelType: string | undefined): ChannelType {
  if (channelType && (channelTypes as readonly string[]).includes(channelType)) {
    return channelType as ChannelType;
  }
  // Default fallback - should rarely happen as metadata should have channelType
  return 'discord';
}

/**
 * Safely map content type - returns null if not in the DB's supported list
 */
function mapContentType(contentType: string | undefined): ContentType | null {
  if (contentType && (contentTypes as readonly string[]).includes(contentType)) {
    return contentType as ContentType;
  }
  // Return null for unsupported types (poll, poll_update, etc.)
  return null;
}

/** Shared consumer options for event persistence */
const CONSUMER_OPTIONS = {
  queue: 'event-persistence',
  maxRetries: 3,
  retryDelayMs: 1000,
  startFrom: 'first' as const,
  concurrency: 10,
};

/**
 * Set up event persistence - subscribes to message events and writes to omni_events
 */
export async function setupEventPersistence(eventBus: EventBus, db: Database): Promise<void> {
  try {
    // Subscribe to message.received
    await eventBus.subscribe(
      'message.received',
      async (event) => {
        const payload = event.payload as MessageReceivedPayload;
        const metadata = event.metadata;

        try {
          const newEvent: NewOmniEvent = {
            externalId: payload.externalId,
            channel: mapChannelType(metadata.channelType),
            instanceId: metadata.instanceId,
            personId: metadata.personId,
            platformIdentityId: metadata.platformIdentityId,
            eventType: 'message.received',
            direction: 'inbound',
            contentType: mapContentType(payload.content.type),
            textContent: sanitizeText(payload.content.text),
            mediaUrl: payload.content.mediaUrl,
            mediaMimeType: payload.content.mimeType,
            chatId: payload.chatId,
            replyToExternalId: payload.replyToId,
            status: 'received',
            receivedAt: new Date(event.timestamp),
            rawPayload: payload.rawPayload ? deepSanitize(payload.rawPayload) : undefined,
            metadata: {
              correlationId: metadata.correlationId,
              from: payload.from,
            },
          };

          await db.insert(omniEvents).values(newEvent);
          log.debug('Persisted message.received', {
            externalId: payload.externalId,
            instanceId: metadata.instanceId,
          });
        } catch (error) {
          log.error('Failed to persist message.received', {
            externalId: payload.externalId,
            error: String(error),
          });
        }
      },
      { ...CONSUMER_OPTIONS, durable: 'event-persistence-received' },
    );

    // Subscribe to message.sent
    await eventBus.subscribe(
      'message.sent',
      async (event) => {
        const payload = event.payload as MessageSentPayload;
        const metadata = event.metadata;

        try {
          const newEvent: NewOmniEvent = {
            externalId: payload.externalId,
            channel: mapChannelType(metadata.channelType),
            instanceId: metadata.instanceId,
            personId: metadata.personId,
            platformIdentityId: metadata.platformIdentityId,
            eventType: 'message.sent',
            direction: 'outbound',
            contentType: mapContentType(payload.content.type),
            textContent: sanitizeText(payload.content.text),
            mediaUrl: payload.content.mediaUrl,
            chatId: payload.chatId,
            replyToExternalId: payload.replyToId,
            status: 'completed',
            receivedAt: new Date(event.timestamp),
            processedAt: new Date(),
            metadata: {
              correlationId: metadata.correlationId,
              to: payload.to,
            },
          };

          await db.insert(omniEvents).values(newEvent);
          log.debug('Persisted message.sent', {
            externalId: payload.externalId,
            instanceId: metadata.instanceId,
          });
        } catch (error) {
          log.error('Failed to persist message.sent', {
            externalId: payload.externalId,
            error: String(error),
          });
        }
      },
      { ...CONSUMER_OPTIONS, durable: 'event-persistence-sent' },
    );

    // Subscribe to message.delivered - update existing event
    await eventBus.subscribe(
      'message.delivered',
      async (event) => {
        const payload = event.payload as { externalId: string; chatId: string; deliveredAt: number };
        const metadata = event.metadata;

        try {
          // Try to update existing event, or create new record
          const updated = await db
            .update(omniEvents)
            .set({
              deliveredAt: new Date(payload.deliveredAt),
              status: 'completed',
            })
            .where(eq(omniEvents.externalId, payload.externalId))
            .returning();

          if (updated.length === 0) {
            // No existing event found, create a new record
            const newEvent: NewOmniEvent = {
              externalId: payload.externalId,
              channel: mapChannelType(metadata.channelType),
              instanceId: metadata.instanceId,
              eventType: 'message.delivered',
              direction: 'outbound',
              chatId: payload.chatId,
              status: 'completed',
              receivedAt: new Date(event.timestamp),
              deliveredAt: new Date(payload.deliveredAt),
            };
            await db.insert(omniEvents).values(newEvent);
          }

          log.debug('Persisted message.delivered', {
            externalId: payload.externalId,
          });
        } catch (error) {
          log.error('Failed to persist message.delivered', {
            externalId: payload.externalId,
            error: String(error),
          });
        }
      },
      { ...CONSUMER_OPTIONS, durable: 'event-persistence-delivered' },
    );

    // Subscribe to message.read - update existing event
    await eventBus.subscribe(
      'message.read',
      async (event) => {
        const payload = event.payload as { externalId: string; chatId: string; readAt: number };
        const metadata = event.metadata;

        try {
          const updated = await db
            .update(omniEvents)
            .set({
              readAt: new Date(payload.readAt),
            })
            .where(eq(omniEvents.externalId, payload.externalId))
            .returning();

          if (updated.length === 0) {
            // No existing event found, create a new record
            const newEvent: NewOmniEvent = {
              externalId: payload.externalId,
              channel: mapChannelType(metadata.channelType),
              instanceId: metadata.instanceId,
              eventType: 'message.read',
              direction: 'outbound',
              chatId: payload.chatId,
              status: 'completed',
              receivedAt: new Date(event.timestamp),
              readAt: new Date(payload.readAt),
            };
            await db.insert(omniEvents).values(newEvent);
          }

          log.debug('Persisted message.read', {
            externalId: payload.externalId,
          });
        } catch (error) {
          log.error('Failed to persist message.read', {
            externalId: payload.externalId,
            error: String(error),
          });
        }
      },
      { ...CONSUMER_OPTIONS, durable: 'event-persistence-read' },
    );

    // Subscribe to message.failed
    await eventBus.subscribe(
      'message.failed',
      async (event) => {
        const payload = event.payload as {
          externalId?: string;
          chatId: string;
          error: string;
          errorCode?: string;
          retryable: boolean;
        };
        const metadata = event.metadata;

        try {
          const newEvent: NewOmniEvent = {
            externalId: payload.externalId,
            channel: mapChannelType(metadata.channelType),
            instanceId: metadata.instanceId,
            personId: metadata.personId,
            eventType: 'message.failed',
            direction: 'outbound',
            chatId: payload.chatId,
            status: 'failed',
            errorMessage: payload.error,
            errorStage: payload.errorCode,
            receivedAt: new Date(event.timestamp),
            metadata: {
              correlationId: metadata.correlationId,
              retryable: payload.retryable,
            },
          };

          await db.insert(omniEvents).values(newEvent);
          log.debug('Persisted message.failed', {
            chatId: payload.chatId,
            error: payload.error,
          });
        } catch (error) {
          log.error('Failed to persist message.failed', {
            chatId: payload.chatId,
            error: String(error),
          });
        }
      },
      { ...CONSUMER_OPTIONS, durable: 'event-persistence-failed' },
    );

    log.info('Event persistence initialized - listening for message events');
  } catch (error) {
    log.error('Failed to set up event persistence', { error: String(error) });
    throw error;
  }
}
