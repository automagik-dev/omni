import { describe, expect, test } from 'bun:test';
import { normalizeE164Phone, normalizeTwilioWhatsAppAddress, toTwilioWhatsAppAddress } from '../utils/identity';

describe('Twilio WhatsApp identity utilities', () => {
  test('normalizes plain E.164 to Twilio WhatsApp address', () => {
    expect(toTwilioWhatsAppAddress('+15551234567')).toBe('whatsapp:+15551234567');
  });

  test('adds + when phone is numeric', () => {
    expect(toTwilioWhatsAppAddress('15551234567')).toBe('whatsapp:+15551234567');
  });

  test('preserves already-prefixed Twilio WhatsApp address', () => {
    expect(normalizeTwilioWhatsAppAddress('whatsapp:+15551234567')).toBe('whatsapp:+15551234567');
  });

  test('normalizes WhatsApp JID-like IDs for outbound fallback', () => {
    expect(normalizeE164Phone('15551234567@s.whatsapp.net')).toBe('+15551234567');
  });

  test('strips Baileys device suffix from WhatsApp JID-like IDs', () => {
    expect(normalizeE164Phone('15551234567:31@s.whatsapp.net')).toBe('+15551234567');
  });
});
