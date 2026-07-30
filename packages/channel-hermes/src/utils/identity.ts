/**
 * Phone number normalization for the Hermes (Mutant) gateway.
 *
 * Hermes proxies the WhatsApp Business API and expects digits-only phone
 * identifiers (no `+`), same as Meta wire format. Inbound `from` /
 * `recipient_id` values are already digits-only.
 */

/**
 * Normalize an arbitrary phone string to Hermes wire format (digits only).
 *
 * Accepts "+5511999998888", "55 11 99999-8888", "5511999998888" and
 * WhatsApp JIDs ("5511999998888@s.whatsapp.net" — suffix stripped).
 * Returns digits only; empty string if the input has no digits.
 */
export function toHermesPhone(input: string): string {
  if (!input) return '';
  const withoutJid = input.includes('@') ? (input.split('@')[0] ?? '') : input;
  return withoutJid.replace(/\D/g, '');
}

/** Format a Hermes phone (digits-only) back to canonical E.164 with leading `+`. */
export function toE164(hermesPhone: string): string {
  const digits = hermesPhone.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}
