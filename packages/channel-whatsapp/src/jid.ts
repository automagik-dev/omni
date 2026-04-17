/**
 * JID (Jabber ID) normalization utilities for WhatsApp
 *
 * WhatsApp uses JIDs in the format:
 * - Users: {phone}@s.whatsapp.net
 * - Groups: {groupId}@g.us
 * - Broadcast: {broadcastId}@broadcast
 * - LID (Linked Device): {lidId}@lid
 * - Newsletter: {newsletterId}@newsletter
 * - Status: status@broadcast
 */

import { computeWaid } from './senders/contact';

/**
 * WhatsApp JID suffixes
 */
export const JID_SUFFIX = {
  USER: '@s.whatsapp.net',
  GROUP: '@g.us',
  BROADCAST: '@broadcast',
  LID: '@lid',
  NEWSLETTER: '@newsletter',
} as const;

/**
 * Convert a phone number or identifier to a user JID.
 *
 * Identity-aware: if the input already contains `@`, it passes through unchanged.
 * If it's a phone number, tries LID resolution first via `lidCache`, falling back
 * to `@s.whatsapp.net`.
 *
 * @param identifier - Phone number or partial JID
 * @param lidCache - Optional phone→LID cache for LID-first resolution
 * @returns Full WhatsApp JID
 *
 * @example
 * toJid('+1234567890') // '1234567890@s.whatsapp.net'
 * toJid('1234567890@s.whatsapp.net') // '1234567890@s.whatsapp.net' (unchanged)
 * toJid('100000001@lid') // '100000001@lid' (unchanged)
 * toJid('5511999', lidCache) // LID JID if mapping exists, else '5511999@s.whatsapp.net'
 */
export function toJid(identifier: string, lidCache?: Map<string, string>): string {
  // Already a full JID — passthrough
  if (identifier.includes('@')) {
    return identifier;
  }

  // Clean phone number: remove all non-digits, normalize BR 9th digit
  const cleaned = identifier.replace(/\D/g, '');
  const normalized = computeWaid(cleaned);
  const phoneJid = `${normalized}${JID_SUFFIX.USER}`;

  // Try LID resolution: phone→LID lookup
  if (lidCache) {
    const lidJid = lidCache.get(phoneJid);
    if (lidJid) return lidJid;
  }

  return phoneJid;
}

/**
 * Convert a group identifier to a group JID
 *
 * @param groupId - Group ID or partial JID
 * @returns Full WhatsApp group JID
 *
 * @example
 * toGroupJid('123456789-1234567890') // '123456789-1234567890@g.us'
 * toGroupJid('123456789-1234567890@g.us') // unchanged
 */
export function toGroupJid(groupId: string): string {
  if (groupId.endsWith(JID_SUFFIX.GROUP)) {
    return groupId;
  }
  return `${groupId}${JID_SUFFIX.GROUP}`;
}

/**
 * Parse a JID to extract the phone/ID and determine type
 *
 * @param jid - Full WhatsApp JID
 * @returns Parsed JID information including isLid flag
 *
 * @example
 * fromJid('1234567890@s.whatsapp.net') // { id: '1234567890', isGroup: false, isUser: true, isBroadcast: false, isLid: false }
 * fromJid('123-456@g.us') // { id: '123-456', isGroup: true, isUser: false, isBroadcast: false, isLid: false }
 * fromJid('100000001@lid') // { id: '100000001', isGroup: false, isUser: false, isBroadcast: false, isLid: true }
 */
export function fromJid(jid: string): {
  id: string;
  isGroup: boolean;
  isUser: boolean;
  isBroadcast: boolean;
  isLid: boolean;
} {
  const isGroup = jid.endsWith(JID_SUFFIX.GROUP);
  const isBroadcast = jid.endsWith(JID_SUFFIX.BROADCAST);
  const isUser = jid.endsWith(JID_SUFFIX.USER);
  const isLid = jid.endsWith(JID_SUFFIX.LID);

  // Extract ID (everything before the @)
  const id = jid.split('@')[0] || '';

  return { id, isGroup, isUser, isBroadcast, isLid };
}

/**
 * Check if a JID is a group JID
 */
export function isGroupJid(jid: string): boolean {
  return jid.endsWith(JID_SUFFIX.GROUP);
}

/**
 * Check if a JID is a user JID (@s.whatsapp.net)
 */
export function isUserJid(jid: string): boolean {
  return jid.endsWith(JID_SUFFIX.USER);
}

/**
 * Check if a JID is a broadcast JID
 */
export function isBroadcastJid(jid: string): boolean {
  return jid.endsWith(JID_SUFFIX.BROADCAST);
}

/**
 * Check if a JID is a newsletter JID
 */
export function isNewsletterJid(jid: string): boolean {
  return jid.endsWith(JID_SUFFIX.NEWSLETTER);
}

/**
 * Check if a JID is a canonical user JID (either phone or LID — not group/broadcast/newsletter)
 */
export function isCanonicalJid(jid: string): boolean {
  return isUserJid(jid) || isLidJid(jid);
}

/**
 * Extract phone number from a user JID
 *
 * @param jid - User JID
 * @returns Phone number or undefined if not a user JID
 */
export function extractPhone(jid: string): string | undefined {
  if (!isUserJid(jid)) {
    return undefined;
  }
  return jid.replace(JID_SUFFIX.USER, '');
}

/**
 * Extract LID number from a LID JID
 *
 * @param jid - LID JID
 * @returns LID number or undefined if not a LID JID
 */
export function extractLid(jid: string): string | undefined {
  if (!isLidJid(jid)) {
    return undefined;
  }
  return jid.replace(JID_SUFFIX.LID, '');
}

/**
 * Check if a JID is a LID (Linked Device ID) JID
 */
export function isLidJid(jid: string): boolean {
  return jid.endsWith(JID_SUFFIX.LID);
}

/**
 * Resolve a JID to its canonical form under the LID-first model.
 *
 * The same human can be addressed by Baileys under two JIDs — `<lid>@lid`
 * and `<phone>@s.whatsapp.net`. To stop debounce/session keys from
 * fragmenting we collapse both forms onto the LID whenever a mapping is
 * known. The LID is preferred because it is the default modern addressing
 * mode, so most messages already arrive in canonical form and only the
 * occasional phone-addressed message gets remapped.
 *
 * Resolution rules:
 * - Empty / nullish JID         → ''
 * - Group / broadcast / newsletter → unchanged (no canonicalization needed)
 * - `@lid` JID                  → unchanged (already canonical)
 * - `@s.whatsapp.net` JID       → upgrade to LID via `remoteJidAlt` first,
 *                                 then via the bidirectional cache; fall
 *                                 back to the original phone JID when no
 *                                 mapping exists yet (best effort).
 *
 * @param jid - The JID to canonicalize (may be `@lid` or `@s.whatsapp.net`)
 * @param remoteJidAlt - Alt JID from `msg.key.remoteJidAlt` / `participantAlt`
 * @param lidCache - Bidirectional LID↔phone cache for this instance
 */
export function resolveCanonicalJid(
  jid: string | undefined | null,
  remoteJidAlt: string | undefined | null,
  lidCache?: Map<string, string>,
): string {
  if (!jid) return '';

  // Non-user JIDs (group / broadcast / newsletter) — already canonical.
  if (!isCanonicalJid(jid)) return jid;

  // Already a LID — canonical under LID-first.
  if (isLidJid(jid)) return jid;

  // Phone-addressed: try to upgrade to LID. Prefer the alt JID from the
  // message key (most authoritative — it came directly from Baileys).
  if (remoteJidAlt && isLidJid(remoteJidAlt)) {
    return remoteJidAlt;
  }

  // Fall back to the bidirectional cache (phone→LID direction).
  if (lidCache) {
    const lidJid = lidCache.get(jid);
    if (lidJid && isLidJid(lidJid)) return lidJid;
  }

  // No mapping yet — keep the phone JID. A later message from the same
  // human will populate the cache and subsequent ones will canonicalize.
  return jid;
}

/**
 * Resolve a phone JID to its LID equivalent when a mapping exists.
 * Used by the send pipeline to target LID JIDs.
 *
 * @param phoneJid - Phone-based JID (@s.whatsapp.net)
 * @param lidCache - Map of phone JID → LID JID (reverse direction)
 * @returns LID JID if mapping exists, otherwise the original phone JID
 */
export function resolveToLidJid(phoneJid: string, lidCache?: Map<string, string>): string {
  if (!phoneJid) return '';

  // If already a LID, return as-is
  if (isLidJid(phoneJid)) return phoneJid;

  // Try phone→LID lookup
  if (lidCache) {
    const lidJid = lidCache.get(phoneJid);
    if (lidJid) return lidJid;
  }

  // No mapping — return original phone JID (graceful fallback)
  return phoneJid;
}

/**
 * Legacy: Resolve a JID to a phone-based JID when possible.
 * Kept for rollback path behind `lidFirstEnabled` flag.
 *
 * @deprecated Use resolveCanonicalJid() for LID-first model
 */
export function resolveToPhoneJidLegacy(
  jid: string | undefined | null,
  remoteJidAlt: string | undefined | null,
  lidCache?: Map<string, string>,
): string {
  if (!jid) return '';

  // Already a phone-based JID — nothing to do
  if (!isLidJid(jid)) return jid;

  // Try remoteJidAlt first (most reliable — comes directly from the message)
  if (remoteJidAlt && isUserJid(remoteJidAlt)) {
    return remoteJidAlt;
  }

  // Try the in-memory LID cache
  if (lidCache) {
    const cached = lidCache.get(jid);
    if (cached) return cached;
  }

  // Unresolvable — return original @lid JID
  return jid;
}

/**
 * Resolve a JID to a phone-based JID when possible.
 *
 * @deprecated Renamed to resolveToPhoneJidLegacy. Use resolveCanonicalJid() for LID-first model.
 */
export const resolveToPhoneJid = resolveToPhoneJidLegacy;

/**
 * Normalize a JID to its canonical form
 * Handles edge cases like leading zeros, country codes, etc.
 */
export function normalizeJid(jid: string): string {
  // If it's already a properly formatted JID, return as-is
  if (jid.includes('@')) {
    return jid;
  }

  // Clean and convert to user JID
  return toJid(jid);
}
