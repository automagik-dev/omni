/**
 * Phone number normalization for Meta WhatsApp Cloud.
 *
 * Meta expects digits-only E.164 (no `+`). Inbound `from` is always
 * digits-only already. Outbound senders strip `+` and any non-digits.
 */

/**
 * Normalize an arbitrary phone string to Meta wire format (digits only).
 *
 * Accepts:
 *   - "+5511999998888"
 *   - "55 11 99999-8888"
 *   - "5511999998888"
 *   - "5511999998888@s.whatsapp.net" (WhatsApp JID — strips suffix)
 *
 * Returns digits only. Empty string if input has no digits.
 */
export function toMetaPhone(input: string): string {
  if (!input) return '';
  // Drop WhatsApp JID suffix if present.
  const withoutJid = input.includes('@') ? (input.split('@')[0] ?? '') : input;
  return withoutJid.replace(/\D/g, '');
}

/**
 * Format a Meta phone (digits-only) back to canonical E.164 with leading `+`.
 *
 * Used when emitting events that the rest of Omni expects in E.164 form.
 */
export function toE164(metaPhone: string): string {
  const digits = metaPhone.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

/**
 * Compare two phone identifiers ignoring `+`, whitespace, JID suffix, etc.
 */
export function phonesEqual(a: string, b: string): boolean {
  return toMetaPhone(a) === toMetaPhone(b);
}
