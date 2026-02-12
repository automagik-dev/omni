/**
 * Event Bus Listeners
 *
 * Handles instance connection/disconnection and message events.
 * Updates database state and provides debug logging.
 */

import { type EventBus, createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { chatIdMappings, chats, instances } from '@omni/db';
import { and, eq } from 'drizzle-orm';
import { clearQrCode } from './qr-store';

const instanceLog = createLogger('instance');
const messageLog = createLogger('message');
const lidLog = createLogger('lid-mapping');

/**
 * Set up event listener for connection events
 * - Clears QR codes on connect
 * - Updates database with connection info (isActive, ownerIdentifier, profile)
 * - Handles disconnection (only marks inactive on explicit logout)
 */
export async function setupConnectionListener(eventBus: EventBus, db?: Database): Promise<void> {
  try {
    await eventBus.subscribe('instance.connected', async (event) => {
      const { instanceId, channelType, profileName, profilePicUrl, ownerIdentifier } = event.payload;

      // Clear QR code
      clearQrCode(instanceId);

      // Update database with connection info
      if (db) {
        try {
          await db
            .update(instances)
            .set({
              isActive: true,
              ownerIdentifier: ownerIdentifier || null,
              profileName: profileName || null,
              profilePicUrl: profilePicUrl || null,
              updatedAt: new Date(),
            })
            .where(eq(instances.id, instanceId));
        } catch (dbError) {
          instanceLog.error('Failed to update database', { instanceId, error: String(dbError) });
        }
      }

      instanceLog.info('Connected', { instanceId, channel: channelType, profileName: profileName || 'unknown' });
    });

    // Handle disconnection events
    await eventBus.subscribe('instance.disconnected', async (event) => {
      const { instanceId, channelType, willReconnect, reason } = event.payload;

      // Only mark inactive if EXPLICITLY logged out by WhatsApp
      // Normal disconnects (graceful shutdown, network issues) should NOT mark inactive
      // so the instance can auto-reconnect on next startup
      const isLoggedOut = reason?.toLowerCase().includes('logged out');

      if (db && isLoggedOut) {
        try {
          await db
            .update(instances)
            .set({
              isActive: false,
              updatedAt: new Date(),
            })
            .where(eq(instances.id, instanceId));
          instanceLog.info('Marked inactive (logged out)', { instanceId });
        } catch (dbError) {
          instanceLog.error('Failed to update database', { instanceId, error: String(dbError) });
        }
      }

      instanceLog.info('Disconnected', {
        instanceId,
        channel: channelType,
        willReconnect,
        reason: reason || 'unknown',
      });
    });
  } catch (error) {
    instanceLog.warn('Failed to set up connection listener', { error: String(error) });
  }
}

/**
 * Set up event listener for message.received events
 * Logs full message payload for debugging
 *
 * Set DEBUG_PAYLOADS=true to see full raw Baileys payloads
 */
export async function setupMessageListener(eventBus: EventBus): Promise<void> {
  try {
    await eventBus.subscribe('message.received', async (event) => {
      const { externalId, chatId, from, content, rawPayload } = event.payload;
      const _instanceId = event.metadata.instanceId;
      messageLog.info('Received', { from, chatId, externalId });
      messageLog.debug('Payload', { content: JSON.stringify(content) });

      // DEBUG: Show full raw Baileys payload
      if (process.env.DEBUG_PAYLOADS === 'true' && rawPayload) {
        messageLog.debug('Raw payload', { rawPayload });
      }
    });
    messageLog.info('Listening for message.received events');
  } catch (error) {
    messageLog.warn('Failed to set up message listener', { error: String(error) });
  }
}

/**
 * Set up event listener for custom.lid-mapping.batch events
 * Persists LID→phone JID mappings discovered during contacts sync to chatIdMappings table
 */
export async function setupLidMappingListener(eventBus: EventBus, db?: Database): Promise<void> {
  if (!db) return;

  try {
    await eventBus.subscribePattern('custom.lid-mapping.batch', async (event) => {
      const instanceId = event.metadata.instanceId;
      const mappings = (event.payload as { mappings: { lidJid: string; phoneJid: string }[] }).mappings;
      if (!instanceId || !mappings?.length) return;

      let persisted = 0;
      for (const { lidJid, phoneJid } of mappings) {
        try {
          await db
            .insert(chatIdMappings)
            .values({ instanceId, lidId: lidJid, phoneId: phoneJid, discoveredFrom: 'contacts_sync' })
            .onConflictDoUpdate({
              target: [chatIdMappings.instanceId, chatIdMappings.lidId],
              set: { phoneId: phoneJid, discoveredAt: new Date() },
            });
          persisted++;
        } catch {
          // Skip individual failures
        }
      }

      lidLog.info('LID mappings persisted', { instanceId, total: mappings.length, persisted });
    });
    lidLog.info('Listening for custom.lid-mapping.batch events');
  } catch (error) {
    lidLog.warn('Failed to set up LID mapping listener', { error: String(error) });
  }
}

const contactsLog = createLogger('contacts-sync');

/** Update a single chat name if it's missing or stale */
async function updateChatName(db: Database, instanceId: string, jid: string, name: string): Promise<boolean> {
  // Primary: exact externalId match
  let [chat] = await db
    .select({ id: chats.id, name: chats.name })
    .from(chats)
    .where(and(eq(chats.instanceId, instanceId), eq(chats.externalId, jid)))
    .limit(1);

  // Secondary: if jid is a phone JID, check if a LID chat maps to it
  if (!chat && jid.endsWith('@s.whatsapp.net')) {
    const [mapping] = await db
      .select({ lidId: chatIdMappings.lidId })
      .from(chatIdMappings)
      .where(and(eq(chatIdMappings.instanceId, instanceId), eq(chatIdMappings.phoneId, jid)))
      .limit(1);
    if (mapping) {
      [chat] = await db
        .select({ id: chats.id, name: chats.name })
        .from(chats)
        .where(and(eq(chats.instanceId, instanceId), eq(chats.externalId, mapping.lidId)))
        .limit(1);
    }
  }

  if (!chat) return false;

  const hasStaleJidName = chat.name?.endsWith('@s.whatsapp.net') || chat.name?.endsWith('@lid');
  if (!chat.name || hasStaleJidName) {
    await db.update(chats).set({ name, updatedAt: new Date() }).where(eq(chats.id, chat.id));
    return true;
  }
  return false;
}

/**
 * Set up event listener for custom.contacts.names events
 * Persists contact names to DM chats that are missing names
 */
export async function setupContactNamesListener(eventBus: EventBus, db?: Database): Promise<void> {
  if (!db) return;

  try {
    await eventBus.subscribePattern('custom.contacts.names', async (event) => {
      const instanceId = event.metadata.instanceId;
      const names = (event.payload as { names: { jid: string; name: string }[] }).names;
      if (!instanceId || !names?.length) return;

      let updated = 0;
      for (const { jid, name } of names) {
        try {
          if (await updateChatName(db, instanceId, jid, name)) updated++;
        } catch {
          // Skip individual failures
        }
      }

      contactsLog.info('Contact names persisted to chats', { instanceId, total: names.length, updated });
    });
    contactsLog.info('Listening for custom.contacts.names events');
  } catch (error) {
    contactsLog.warn('Failed to set up contact names listener', { error: String(error) });
  }
}

const unreadLog = createLogger('chat-unread');

/**
 * Listen for chat.unread-updated events from channel plugins.
 * WhatsApp provides native unread counts — use them as source of truth
 * instead of manually incrementing/decrementing.
 */
export async function setupChatUnreadListener(eventBus: EventBus, db?: Database): Promise<void> {
  if (!db) return;

  try {
    await eventBus.subscribePattern('custom.chat.unread-updated', async (event) => {
      const instanceId = event.metadata.instanceId;
      const { chatId, unreadCount } = event.payload as { chatId: string; unreadCount: number };
      if (!instanceId || !chatId) return;

      try {
        const result = await db
          .update(chats)
          .set({ unreadCount, updatedAt: new Date() })
          .where(and(eq(chats.instanceId, instanceId), eq(chats.externalId, chatId)))
          .returning({ id: chats.id });

        if (result.length > 0) {
          unreadLog.debug('Synced unread count from platform', { instanceId, chatId, unreadCount });
        }
      } catch (error) {
        unreadLog.warn('Failed to sync unread count', { instanceId, chatId, error: String(error) });
      }
    });
    unreadLog.info('Listening for custom.chat.unread-updated events');
  } catch (error) {
    unreadLog.warn('Failed to set up chat unread listener', { error: String(error) });
  }
}
