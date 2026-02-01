/**
 * Event Bus Listeners
 *
 * Handles instance connection/disconnection and message events.
 * Updates database state and provides debug logging.
 */

import { type EventBus, createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { instances } from '@omni/db';
import { eq } from 'drizzle-orm';
import { clearQrCode } from './qr-store';

const instanceLog = createLogger('instance');
const messageLog = createLogger('message');

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

      instanceLog.info('Disconnected', { instanceId, channel: channelType, willReconnect, reason: reason || 'unknown' });
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
