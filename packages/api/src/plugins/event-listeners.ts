/**
 * Event Bus Listeners
 *
 * Handles instance connection/disconnection and message events.
 * Updates database state and provides debug logging.
 */

import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import { instances } from '@omni/db';
import { eq } from 'drizzle-orm';
import { clearQrCode } from './qr-store';

/**
 * Set up event listener for connection events
 * - Clears QR codes on connect
 * - Updates database with connection info (isActive, ownerIdentifier, profile)
 * - Handles disconnection (only marks inactive on explicit logout)
 */
export async function setupConnectionListener(eventBus: EventBus, db?: Database): Promise<void> {
  try {
    await eventBus.subscribe('instance.connected', async (event) => {
      const { instanceId, profileName, profilePicUrl, ownerIdentifier } = event.payload;

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
          console.error(`[Instance] Failed to update database for ${instanceId}:`, dbError);
        }
      }

      console.log(`[Instance] Connected: ${instanceId} (profile: ${profileName || 'unknown'})`);
    });

    // Handle disconnection events
    await eventBus.subscribe('instance.disconnected', async (event) => {
      const { instanceId, willReconnect, reason } = event.payload;

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
          console.log(`[Instance] Marked inactive (logged out): ${instanceId}`);
        } catch (dbError) {
          console.error(`[Instance] Failed to update database for ${instanceId}:`, dbError);
        }
      }

      console.log(`[Instance] Disconnected: ${instanceId} (willReconnect: ${willReconnect}, reason: ${reason || 'unknown'})`);
    });
  } catch (error) {
    console.warn('[Instance] Failed to set up connection listener:', error);
  }
}

/**
 * Set up event listener for message.received events
 * Logs full message payload for debugging
 */
export async function setupMessageListener(eventBus: EventBus): Promise<void> {
  try {
    await eventBus.subscribe('message.received', async (event) => {
      const { externalId, chatId, from, content } = event.payload;
      const instanceId = event.metadata.instanceId;
      console.log(`[Message] from=${from} chat=${chatId} id=${externalId}`);
      console.log(`  payload: ${JSON.stringify(content)}`);
    });
    console.log('[Message Listener] Listening for message.received events');
  } catch (error) {
    console.warn('[Message Listener] Failed to set up message listener:', error);
  }
}
