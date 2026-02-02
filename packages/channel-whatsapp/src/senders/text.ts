/**
 * Text message sender
 */

import type { AnyMessageContent, WASocket } from '@whiskeysockets/baileys';

/**
 * Convert phone number to WhatsApp JID format
 * Handles both raw numbers and already-formatted JIDs
 */
function toWhatsAppJid(phoneOrJid: string): string {
  // Already a JID
  if (phoneOrJid.includes('@')) {
    return phoneOrJid;
  }
  // Strip any non-numeric characters and add suffix
  const cleaned = phoneOrJid.replace(/\D/g, '');
  return `${cleaned}@s.whatsapp.net`;
}

/**
 * Build text message content with optional mentions
 *
 * @param text - Message text
 * @param mentions - Array of phone numbers/JIDs to mention
 */
export function buildTextContent(text: string, mentions?: string[]): AnyMessageContent {
  if (mentions && mentions.length > 0) {
    // Convert mentions to JID format
    const mentionJids = mentions.map(toWhatsAppJid);
    return { text, mentions: mentionJids };
  }
  return { text };
}

/**
 * Send a text message
 *
 * @param sock - WhatsApp socket
 * @param jid - Recipient JID
 * @param text - Message text
 * @param replyToId - Optional message ID to reply to
 * @param mentions - Optional array of phone numbers/JIDs to mention
 */
export async function sendTextMessage(
  sock: WASocket,
  jid: string,
  text: string,
  replyToId?: string,
  mentions?: string[],
): Promise<string | undefined> {
  const content = buildTextContent(text, mentions);

  const result = await sock.sendMessage(
    jid,
    content,
    replyToId ? { quoted: { key: { id: replyToId, remoteJid: jid } } as never } : undefined,
  );

  return result?.key?.id ?? undefined;
}
