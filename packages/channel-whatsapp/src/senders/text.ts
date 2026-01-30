/**
 * Text message sender
 */

import type { AnyMessageContent, WASocket } from '@whiskeysockets/baileys';

/**
 * Build text message content
 */
export function buildTextContent(text: string): AnyMessageContent {
  return { text };
}

/**
 * Send a text message
 */
export async function sendTextMessage(
  sock: WASocket,
  jid: string,
  text: string,
  replyToId?: string,
): Promise<string | undefined> {
  const content = buildTextContent(text);

  const result = await sock.sendMessage(
    jid,
    content,
    replyToId ? { quoted: { key: { id: replyToId, remoteJid: jid } } as never } : undefined,
  );

  return result?.key?.id ?? undefined;
}
