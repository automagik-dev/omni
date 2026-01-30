/**
 * Reaction message sender
 */

import type { AnyMessageContent, WASocket } from '@whiskeysockets/baileys';

/**
 * Build reaction message content
 *
 * @param targetJid - JID of the chat containing the message
 * @param targetMessageId - ID of the message to react to
 * @param emoji - Reaction emoji (empty string to remove reaction)
 * @param fromMe - Whether the target message was sent by us
 */
export function buildReactionContent(
  targetJid: string,
  targetMessageId: string,
  emoji: string,
  fromMe = true,
): AnyMessageContent {
  return {
    react: {
      text: emoji,
      key: {
        remoteJid: targetJid,
        id: targetMessageId,
        fromMe,
      },
    },
  };
}

/**
 * Send a reaction to a message
 *
 * @param sock - Baileys socket
 * @param jid - Chat JID
 * @param targetMessageId - Message ID to react to
 * @param emoji - Reaction emoji (use empty string to remove)
 * @param fromMe - Whether reacting to our own message
 */
export async function sendReaction(
  sock: WASocket,
  jid: string,
  targetMessageId: string,
  emoji: string,
  fromMe = true,
): Promise<string | undefined> {
  const content = buildReactionContent(jid, targetMessageId, emoji, fromMe);

  const result = await sock.sendMessage(jid, content);

  return result?.key?.id ?? undefined;
}

/**
 * Remove a reaction from a message
 */
export async function removeReaction(
  sock: WASocket,
  jid: string,
  targetMessageId: string,
  fromMe = true,
): Promise<string | undefined> {
  return sendReaction(sock, jid, targetMessageId, '', fromMe);
}
