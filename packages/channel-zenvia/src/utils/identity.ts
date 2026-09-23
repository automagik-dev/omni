/**
 * Phone number normalization for the Zenvia WhatsApp channel.
 *
 * Zenvia identifies WhatsApp recipients by the digits-only E.164 number
 * (no `+`), and inbound `from` values arrive in the same form.
 */

/**
 * Normalize an arbitrary phone string to Zenvia wire format (digits only).
 *
 * Accepts "+5511999998888", "55 11 99999-8888", "5511999998888" and
 * WhatsApp JIDs ("5511999998888@s.whatsapp.net" — suffix stripped).
 * Returns digits only; empty string if the input has no digits.
 */
export function toZenviaPhone(input: string): string {
  if (!input) return '';
  const withoutJid = input.includes('@') ? (input.split('@')[0] ?? '') : input;
  return withoutJid.replace(/\D/g, '');
}
