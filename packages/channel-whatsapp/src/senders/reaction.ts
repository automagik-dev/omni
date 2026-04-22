/**
 * Reaction message sender
 */

import type { AnyMessageContent, WASocket } from 'baileys';

/**
 * Build reaction message content
 *
 * @param targetJid - JID of the chat containing the message
 * @param targetMessageId - ID of the message to react to
 * @param emoji - Reaction emoji (empty string to remove reaction)
 * @param fromMe - Whether the target message was sent by us
 * @param participant - Group participant JID that authored the target message
 */
export function buildReactionContent(
  targetJid: string,
  targetMessageId: string,
  emoji: string,
  fromMe = true,
  participant?: string,
): AnyMessageContent {
  const key = {
    remoteJid: targetJid,
    id: targetMessageId,
    fromMe,
    ...(participant ? { participant } : {}),
  };

  return {
    react: {
      text: emoji,
      key,
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
 * @param participant - Group participant JID that authored the target message
 */
export async function sendReaction(
  sock: WASocket,
  jid: string,
  targetMessageId: string,
  emoji: string,
  fromMe = true,
  participant?: string,
): Promise<string | undefined> {
  const content = buildReactionContent(jid, targetMessageId, emoji, fromMe, participant);

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
  participant?: string,
): Promise<string | undefined> {
  return sendReaction(sock, jid, targetMessageId, '', fromMe, participant);
}
