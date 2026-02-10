/**
 * JID (Jabber ID) normalization utilities for WhatsApp
 *
 * WhatsApp uses JIDs in the format:
 * - Users: {phone}@s.whatsapp.net
 * - Groups: {groupId}@g.us
 * - Broadcast: {broadcastId}@broadcast
 * - Status: status@broadcast
 */

/**
 * WhatsApp JID suffixes
 */
export const JID_SUFFIX = {
  USER: '@s.whatsapp.net',
  GROUP: '@g.us',
  BROADCAST: '@broadcast',
  LID: '@lid',
} as const;

/**
 * Convert a phone number or identifier to a user JID
 *
 * @param identifier - Phone number or partial JID
 * @returns Full WhatsApp user JID
 *
 * @example
 * toJid('+1234567890') // '1234567890@s.whatsapp.net'
 * toJid('1234567890@s.whatsapp.net') // '1234567890@s.whatsapp.net' (unchanged)
 */
export function toJid(identifier: string): string {
  // Already a full JID?
  if (identifier.includes('@')) {
    return identifier;
  }

  // Clean phone number: remove all non-digits
  const cleaned = identifier.replace(/\D/g, '');
  return `${cleaned}${JID_SUFFIX.USER}`;
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
 * @returns Parsed JID information
 *
 * @example
 * fromJid('1234567890@s.whatsapp.net') // { id: '1234567890', isGroup: false, isUser: true }
 * fromJid('123-456@g.us') // { id: '123-456', isGroup: true, isUser: false }
 */
export function fromJid(jid: string): {
  id: string;
  isGroup: boolean;
  isUser: boolean;
  isBroadcast: boolean;
} {
  const isGroup = jid.endsWith(JID_SUFFIX.GROUP);
  const isBroadcast = jid.endsWith(JID_SUFFIX.BROADCAST);
  const isUser = jid.endsWith(JID_SUFFIX.USER);

  // Extract ID (everything before the @)
  const id = jid.split('@')[0] || '';

  return { id, isGroup, isUser, isBroadcast };
}

/**
 * Check if a JID is a group JID
 */
export function isGroupJid(jid: string): boolean {
  return jid.endsWith(JID_SUFFIX.GROUP);
}

/**
 * Check if a JID is a user JID
 */
export function isUserJid(jid: string): boolean {
  return jid.endsWith(JID_SUFFIX.USER);
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
 * Check if a JID is a LID (Linked Device ID) JID
 */
export function isLidJid(jid: string): boolean {
  return jid.endsWith(JID_SUFFIX.LID);
}

/**
 * Resolve a JID to a phone-based JID when possible.
 *
 * Strategy:
 * 1. If it's already a phone JID (@s.whatsapp.net), return as-is
 * 2. If remoteJidAlt is available and is a phone JID, use it
 * 3. If a LID→phone cache entry exists, use it
 * 4. Otherwise return the original JID unchanged
 *
 * @param jid - The JID to resolve (may be @lid or @s.whatsapp.net)
 * @param remoteJidAlt - Alternative JID from msg.key.remoteJidAlt (if available)
 * @param lidCache - Map of LID JID → phone JID for this instance
 * @returns The resolved phone-based JID, or the original if unresolvable
 */
export function resolveToPhoneJid(
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
