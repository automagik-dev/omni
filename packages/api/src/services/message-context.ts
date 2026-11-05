import type { Instance } from '@omni/db';
import type { MessageContext } from './agent-runner';

/**
 * Extract the numeric phone identifier from WhatsApp JIDs, including device-suffixed variants.
 * Examples:
 * - 551151986804:4@s.whatsapp.net -> 551151986804
 * - 551151986804@s.whatsapp.net -> 551151986804
 * - 551151986804@lid -> 551151986804
 */
export function extractPhoneFromJid(jid: string): string {
  return jid.replace(/:.*$/, '').replace(/@.*$/, '').replace(/^@/, '');
}

/**
 * Check if a chat is a self-chat (user messaging themselves).
 * Compares chatId against the instance's ownerIdentifier (connected account JID).
 * Normalizes JIDs by stripping device suffix (e.g., ":0" in "5511999@s.whatsapp.net:0").
 */
export function isSelfChat(chatId: string, ownerIdentifier: string | null | undefined): boolean {
  if (!ownerIdentifier) return false;
  return extractPhoneFromJid(chatId) === extractPhoneFromJid(ownerIdentifier);
}

/** Build message context for WhatsApp / default channels */
export function buildWhatsAppMessageContext(
  rawPayload: Record<string, unknown>,
  chatId: string,
  instance: Instance,
  text: string,
): MessageContext {
  const isDirectMessage =
    !chatId.includes('@g.us') &&
    !chatId.includes('@broadcast') &&
    !chatId.includes('@newsletter') &&
    !(rawPayload.isGroup as boolean);

  const mentionedJids = (rawPayload.mentionedJids as string[]) ?? [];
  const ownerJid = instance.ownerIdentifier ?? '';

  // Baileys LID addressing: mentionedJids may use @lid format while ownerIdentifier
  // is phone-jid format (e.g. 5511...@s.whatsapp.net), causing direct JID match to fail.
  // Extract the phone number part from both formats for comparison.
  const ownerPhone = extractPhoneFromJid(ownerJid);

  const jidMatchesOwner = mentionedJids.some((jid) => {
    const mentionPhone = extractPhoneFromJid(jid);
    return jid === ownerJid || mentionPhone === ownerPhone;
  });

  const mentionsBot = jidMatchesOwner || rawPayload.isMention === true || rawPayload.isMentioningInstance === true;

  // Handle replies to bot messages (same phone number extraction for LID compatibility)
  const quotedParticipant = (rawPayload.quotedMessage as Record<string, unknown>)?.participant as string | undefined;
  const isReplyToBot = quotedParticipant
    ? quotedParticipant === ownerJid || extractPhoneFromJid(quotedParticipant) === ownerPhone
    : false;

  return { isDirectMessage, mentionsBot, isReplyToBot, text };
}
