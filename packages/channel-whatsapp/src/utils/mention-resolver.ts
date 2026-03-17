/**
 * Mention resolver for WhatsApp @name syntax (GH#209)
 *
 * Parses @name patterns from message text, resolves them against
 * a name→JID lookup map, and replaces with @phone format for WhatsApp rendering.
 *
 * WhatsApp renders inline mentions where `@phone_number` appears in text,
 * paired with a `mentionedJid` array of full JIDs. This resolver bridges
 * the gap between human-readable @name syntax and WhatsApp's JID format.
 */

export interface MentionResolution {
  /** Text with @name replaced by @phone for WhatsApp rendering */
  text: string;
  /** Resolved mention objects for metadata */
  mentions: Array<{ id: string; type: 'user' }>;
}

/**
 * Regex to match @name patterns in text.
 *
 * - Must be preceded by start-of-string or whitespace (prevents matching email/JID formats)
 * - Captures alphanumeric names starting with a letter (supports accented characters)
 * - Stops at whitespace or punctuation
 */
const MENTION_PATTERN = /(?<=^|\s)@([a-zA-ZÀ-ÿ]\w*)/g;

/**
 * Resolve @name mentions in text against a name→JID lookup map.
 *
 * For each @name found:
 * - If name matches a contact (exact or prefix, case-insensitive), replaces with @phone and adds to mentions
 * - If no match, leaves @name as literal text (no error)
 *
 * @param text - Message text potentially containing @name patterns
 * @param nameToJid - Map of lowercase name → JID (e.g., "cezar" → "5511999990001@s.whatsapp.net")
 * @returns Resolution with updated text and mention array
 */
export function resolveMentions(text: string, nameToJid: Map<string, string>): MentionResolution {
  if (!text || nameToJid.size === 0) {
    return { text, mentions: [] };
  }

  const mentions: Array<{ id: string; type: 'user' }> = [];

  const resolvedText = text.replace(MENTION_PATTERN, (fullMatch, name: string) => {
    const jid = findJidByName(nameToJid, name);
    if (!jid) return fullMatch; // No match — leave as literal text

    const phone = jid.split('@')[0] || '';
    mentions.push({ id: phone, type: 'user' });
    return `@${phone}`;
  });

  return { text: resolvedText, mentions };
}

/**
 * Find a JID by name in the lookup map.
 * Tries exact match first (case-insensitive), then prefix match.
 */
function findJidByName(nameToJid: Map<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();

  // Exact match
  const exact = nameToJid.get(lower);
  if (exact) return exact;

  // Prefix match — find the first entry whose key starts with the queried name
  for (const [key, jid] of nameToJid) {
    if (key.startsWith(lower)) return jid;
  }

  return undefined;
}
