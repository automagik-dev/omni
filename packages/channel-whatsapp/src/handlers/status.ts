/**
 * Message status update handlers
 *
 * Handles delivery and read receipt events from Baileys.
 */

import type { WAMessageUpdate, WASocket } from '@whiskeysockets/baileys';
import type { WhatsAppPlugin } from '../plugin';
import { type MessageStatus, mapStatusCode } from '../receipts';

/**
 * Status update event
 */
export interface StatusUpdate {
  messageId: string;
  chatId: string;
  status: MessageStatus;
  timestamp: number;
}

/**
 * Set up message status handlers
 *
 * Listens for message.update events and emits delivery/read receipts.
 */
export function setupStatusHandlers(
  sock: WASocket,
  plugin: WhatsAppPlugin,
  instanceId: string,
  onStatusUpdate?: (update: StatusUpdate) => void,
): void {
  sock.ev.on('messages.update', async (updates: WAMessageUpdate[]) => {
    for (const update of updates) {
      const { key, update: msgUpdate } = update;

      // Skip if no status update
      if (msgUpdate.status === undefined || msgUpdate.status === null) {
        continue;
      }

      const chatId = key.remoteJid || '';
      const messageId = key.id || '';
      const status = mapStatusCode(msgUpdate.status as number);
      const timestamp = Date.now();

      // Emit appropriate event based on status
      if (status === 'delivered') {
        await plugin.handleMessageDelivered(instanceId, messageId, chatId);
      } else if (status === 'read' || status === 'played') {
        await plugin.handleMessageRead(instanceId, messageId, chatId);
      }

      // Call optional callback
      if (onStatusUpdate) {
        onStatusUpdate({
          messageId,
          chatId,
          status,
          timestamp,
        });
      }
    }
  });
}

/**
 * Process a single status update
 */
export function processStatusUpdate(update: WAMessageUpdate): StatusUpdate | null {
  const { key, update: msgUpdate } = update;

  if (msgUpdate.status === undefined || msgUpdate.status === null) {
    return null;
  }

  return {
    messageId: key.id || '',
    chatId: key.remoteJid || '',
    status: mapStatusCode(msgUpdate.status as number),
    timestamp: Date.now(),
  };
}
