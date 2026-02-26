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

  // Handle replies to bot messages (same phone number extraction for LID compatibility).
  // channel-whatsapp stamps contextInfo.participant as rawPayload.quotedParticipant — read
  // from the top-level key, not from the non-existent rawPayload.quotedMessage.participant path.
  const quotedParticipant = rawPayload.quotedParticipant as string | undefined;
  const isReplyToBot = quotedParticipant
    ? quotedParticipant === ownerJid || extractPhoneFromJid(quotedParticipant) === ownerPhone
    : false;

  return { isDirectMessage, mentionsBot, isReplyToBot, text };
}
