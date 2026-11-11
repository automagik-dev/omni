/**
 * Coexistence: one number on the WhatsApp Business app and the Cloud API.
 *
 * Meta mirrors the app into three webhook fields (see handlers/webhook.ts):
 *   - smb_message_echoes: a message the business sent from the app
 *   - history:            past chats shared once at onboarding
 *   - smb_app_state_sync: the app's address book
 *
 * This module holds the pure pieces the plugin uses to record them.
 */

import type { MetaStateSyncItem } from '@omni/core/schemas';

/**
 * Top-level rawPayload key that tells the agent dispatcher never to dispatch
 * this message. rawPayload is persisted, so the marker survives agent-replay.
 */
const NO_AGENT_DISPATCH = 'noAgentDispatch';

function unixSeconds(timestamp: string): number | undefined {
  const seconds = Number.parseInt(timestamp, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/**
 * Own-device evidence for an echo, the same keys a Baileys phone-sent message
 * carries (`isFromMe`, `key.fromMe`, `key.id`, `upsertType: 'notify'`). An API
 * send never produces this: it emits `message.sent`. `key.remoteJid` is left
 * out on purpose: the self-chat command checks require it, and an echo is
 * always addressed to a customer.
 */
export function echoEvidence(wamid: string, timestamp: string): Record<string, unknown> {
  return {
    isFromMe: true,
    key: { id: wamid, fromMe: true },
    upsertType: 'notify',
    messageTimestamp: unixSeconds(timestamp),
    coexistence: 'smb_message_echoes',
    [NO_AGENT_DISPATCH]: true,
  };
}

/**
 * Evidence for a shared-history message. `messageTimestamp` is required:
 * message-persistence drops a history-sync message without one.
 */
export function historyEvidence(
  wamid: string,
  fromMe: boolean,
  timestamp: string,
  status: string | undefined,
): Record<string, unknown> {
  return {
    isFromMe: fromMe,
    key: { id: wamid, fromMe },
    isHistorySync: true,
    messageTimestamp: unixSeconds(timestamp),
    ...(status ? { historyStatus: status } : {}),
    coexistence: 'history',
    [NO_AGENT_DISPATCH]: true,
  };
}

/** A contact as the contacts sync job reads it (`fetchContacts` → sync-worker). */
export interface CoexistenceContact {
  platformUserId: string;
  name?: string;
  phone?: string;
  isGroup: false;
  metadata?: Record<string, unknown>;
}

export const CONTACT_KEY_PREFIX = 'coexistence-contact:';

export function contactStorageKey(instanceId: string, phone: string): string {
  return `${CONTACT_KEY_PREFIX}${instanceId}:${phone}`;
}

/**
 * Map one smb_app_state_sync contact to the sync shape. Null when it has no
 * phone number: WhatsApp Business identities here are keyed by phone, and a
 * user known only by business-scoped user id is not supported yet.
 */
export function toCoexistenceContact(item: MetaStateSyncItem): CoexistenceContact | null {
  const contact = item.contact;
  const phone = contact?.phone_number?.replace(/\D/g, '');
  if (!contact || !phone) return null;
  const name = contact.full_name || contact.first_name || undefined;
  const metadata: Record<string, unknown> = {};
  if (contact.user_id) metadata.userId = contact.user_id;
  if (contact.username) metadata.username = contact.username;
  return {
    platformUserId: phone,
    name,
    phone: `+${phone}`,
    isGroup: false,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}
