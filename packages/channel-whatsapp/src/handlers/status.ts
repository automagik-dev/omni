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
 * Emit plugin event for a status update
 */
async function emitStatusEvent(plugin: WhatsAppPlugin, instanceId: string, statusUpdate: StatusUpdate): Promise<void> {
  const { status, messageId, chatId } = statusUpdate;

  if (status === 'delivered') {
    await plugin.handleMessageDelivered(instanceId, messageId, chatId);
  } else if (status === 'read' || status === 'played') {
    await plugin.handleMessageRead(instanceId, messageId, chatId);
  }
}

/**
 * Handle a single message update
 */
async function handleUpdate(
  plugin: WhatsAppPlugin,
  instanceId: string,
  update: WAMessageUpdate,
  onStatusUpdate?: (update: StatusUpdate) => void,
): Promise<void> {
  const statusUpdate = processStatusUpdate(update);
  if (!statusUpdate) return;

  await emitStatusEvent(plugin, instanceId, statusUpdate);

  if (onStatusUpdate) {
    onStatusUpdate(statusUpdate);
  }
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
      await handleUpdate(plugin, instanceId, update, onStatusUpdate);
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
