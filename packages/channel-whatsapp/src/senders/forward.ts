/**
 * Forward message sender
 *
 * Handles forwarding existing messages to new recipients.
 */

import type { WASocket } from '@whiskeysockets/baileys';

/**
 * Forward a message to a new recipient
 *
 * @param sock - WhatsApp socket
 * @param toJid - Recipient JID to forward to
 * @param messageId - External message ID to forward
 * @param fromJid - Chat JID where the message is from
 * @returns The new message ID
 */
export async function forwardMessage(
  sock: WASocket,
  toJid: string,
  messageId: string,
  fromJid: string,
): Promise<string | undefined> {
  // First, we need to get the original message to forward it
  // Baileys uses relayMessage or sendMessage with forward flag

  const result = await sock.sendMessage(toJid, {
    forward: {
      key: {
        remoteJid: fromJid,
        id: messageId,
      },
    },
  });

  return result?.key?.id ?? undefined;
}
