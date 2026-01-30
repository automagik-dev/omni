/**
 * Read receipts for WhatsApp
 *
 * Handles marking messages as read and tracking read/delivery status.
 */

import type { WAMessageKey, WASocket } from '@whiskeysockets/baileys';

/**
 * Mark a single message as read
 *
 * @param sock - Baileys socket
 * @param jid - Chat JID
 * @param messageId - Message ID to mark as read
 */
export async function markMessageAsRead(sock: WASocket, jid: string, messageId: string): Promise<void> {
  const keys: WAMessageKey[] = [
    {
      remoteJid: jid,
      id: messageId,
      fromMe: false,
    },
  ];

  await sock.readMessages(keys);
}

/**
 * Mark multiple messages as read
 *
 * @param sock - Baileys socket
 * @param jid - Chat JID
 * @param messageIds - Array of message IDs to mark as read
 */
export async function markMessagesAsRead(sock: WASocket, jid: string, messageIds: string[]): Promise<void> {
  const keys: WAMessageKey[] = messageIds.map((id) => ({
    remoteJid: jid,
    id,
    fromMe: false,
  }));

  await sock.readMessages(keys);
}

/**
 * Mark all messages in a chat as read
 *
 * Note: This marks all unread messages, which may be many.
 * Use with caution for chats with large histories.
 *
 * @param sock - Baileys socket
 * @param jid - Chat JID
 */
export async function markChatAsRead(sock: WASocket, jid: string): Promise<void> {
  // Send read status for the chat using presence update
  // This will mark all unread messages in the chat
  await sock.sendPresenceUpdate('available', jid);
  await sock.readMessages([{ remoteJid: jid, id: 'all', fromMe: false }]);
}

/**
 * Message status types
 */
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'played';

/**
 * Map Baileys status code to MessageStatus
 *
 * Status codes from Baileys:
 * 0 = ERROR
 * 1 = PENDING
 * 2 = SERVER_ACK (sent to server)
 * 3 = DELIVERY_ACK (delivered to recipient)
 * 4 = READ (read by recipient)
 * 5 = PLAYED (voice note played)
 */
export function mapStatusCode(code: number): MessageStatus {
  switch (code) {
    case 1:
      return 'pending';
    case 2:
      return 'sent';
    case 3:
      return 'delivered';
    case 4:
      return 'read';
    case 5:
      return 'played';
    default:
      return 'pending';
  }
}

/**
 * Check if a status indicates successful delivery
 */
export function isDelivered(status: MessageStatus): boolean {
  return status === 'delivered' || status === 'read' || status === 'played';
}

/**
 * Check if a status indicates the message was read
 */
export function isRead(status: MessageStatus): boolean {
  return status === 'read' || status === 'played';
}

/**
 * Receipt tracker for managing message receipts
 */
export class ReceiptTracker {
  private receipts = new Map<string, { status: MessageStatus; timestamp: number }>();

  /**
   * Update receipt status for a message
   */
  update(messageId: string, status: MessageStatus): void {
    this.receipts.set(messageId, {
      status,
      timestamp: Date.now(),
    });
  }

  /**
   * Get receipt status for a message
   */
  get(messageId: string): MessageStatus | undefined {
    return this.receipts.get(messageId)?.status;
  }

  /**
   * Check if a message has been delivered
   */
  isDelivered(messageId: string): boolean {
    const status = this.get(messageId);
    return status ? isDelivered(status) : false;
  }

  /**
   * Check if a message has been read
   */
  isRead(messageId: string): boolean {
    const status = this.get(messageId);
    return status ? isRead(status) : false;
  }

  /**
   * Clear old receipts (older than specified age in ms)
   */
  cleanup(maxAge = 24 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, receipt] of this.receipts.entries()) {
      if (now - receipt.timestamp > maxAge) {
        this.receipts.delete(id);
      }
    }
  }

  /**
   * Clear all receipts
   */
  clear(): void {
    this.receipts.clear();
  }
}

/**
 * Create a receipt tracker
 */
export function createReceiptTracker(): ReceiptTracker {
  return new ReceiptTracker();
}
