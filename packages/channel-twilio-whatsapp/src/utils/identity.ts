/**
 * Twilio WhatsApp address utilities.
 *
 * Twilio expects channel addresses in the form `whatsapp:+15551234567`.
 */

const WHATSAPP_PREFIX = 'whatsapp:';

export function stripTwilioWhatsAppPrefix(value: string): string {
  return value.trim().startsWith(WHATSAPP_PREFIX) ? value.trim().slice(WHATSAPP_PREFIX.length) : value.trim();
}

export function normalizeE164Phone(value: string): string {
  const withoutPrefix = stripTwilioWhatsAppPrefix(value);
  const withoutJid = withoutPrefix.split('@')[0] ?? withoutPrefix;
  const withoutDevice = withoutJid.split(':')[0] ?? withoutJid;
  const digits = withoutDevice.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  return `+${digits}`;
}

export function toTwilioWhatsAppAddress(value: string): string {
  return `${WHATSAPP_PREFIX}${normalizeE164Phone(value)}`;
}

export function normalizeTwilioWhatsAppAddress(value: string): string {
  return toTwilioWhatsAppAddress(value);
}
