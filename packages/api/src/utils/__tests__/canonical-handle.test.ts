/**
 * Unit tests for channel-handle canonicalization (identity anti-fragmentation).
 * Pure functions — no database required.
 */

import { describe, expect, test } from 'bun:test';
import { canonicalizeHandle, isPersonlessChannel, isWhatsAppFamily } from '../canonical-handle';

describe('canonicalizeHandle — WhatsApp phone forms collapse to one key', () => {
  test('bare digits and the @s.whatsapp.net JID map to the SAME canonical key', () => {
    const bare = canonicalizeHandle('whatsapp-baileys', '5511999990000');
    const suffixed = canonicalizeHandle('whatsapp-baileys', '5511999990000@s.whatsapp.net');

    expect(bare.platformUserId).toBe('5511999990000@s.whatsapp.net');
    expect(suffixed.platformUserId).toBe('5511999990000@s.whatsapp.net');
    expect(bare.platformUserId).toBe(suffixed.platformUserId);
    expect(bare.phone).toBe('+5511999990000');
    expect(suffixed.phone).toBe('+5511999990000');
  });

  test('device-suffixed JID strips the :NN and matches the bare form', () => {
    const device = canonicalizeHandle('whatsapp-baileys', '5511999990000:3@s.whatsapp.net');
    expect(device.platformUserId).toBe('5511999990000@s.whatsapp.net');
    expect(device.phone).toBe('+5511999990000');
  });

  test('a leading + is normalized away', () => {
    const plus = canonicalizeHandle('whatsapp-baileys', '+5511999990000');
    expect(plus.platformUserId).toBe('5511999990000@s.whatsapp.net');
    expect(plus.phone).toBe('+5511999990000');
  });

  test('canonicalization is idempotent', () => {
    const once = canonicalizeHandle('whatsapp-baileys', '5511999990000');
    const twice = canonicalizeHandle('whatsapp-baileys', once.platformUserId);
    expect(twice.platformUserId).toBe(once.platformUserId);
    expect(twice.phone).toBe(once.phone);
  });
});

describe('canonicalizeHandle — Twilio / Gupshup / Hermes phone extraction', () => {
  test('Twilio whatsapp:+E164 strips the prefix and yields a phone', () => {
    const twilio = canonicalizeHandle('twilio-whatsapp', 'whatsapp:+5511999990000');
    expect(twilio.platformUserId).toBe('5511999990000@s.whatsapp.net');
    expect(twilio.phone).toBe('+5511999990000');
  });

  test('Twilio prefix is case-insensitive', () => {
    const twilio = canonicalizeHandle('twilio-whatsapp', 'WhatsApp:+5511999990000');
    expect(twilio.phone).toBe('+5511999990000');
  });

  test('Gupshup / Hermes bare wa_id digits yield a phone and the canonical JID', () => {
    for (const channel of ['gupshup', 'hermes'] as const) {
      const c = canonicalizeHandle(channel, '5511999990000');
      expect(c.platformUserId).toBe('5511999990000@s.whatsapp.net');
      expect(c.phone).toBe('+5511999990000');
    }
  });

  test('a Twilio sender canonicalizes to the SAME +E164 phone a Baileys sender does', () => {
    const twilio = canonicalizeHandle('twilio-whatsapp', 'whatsapp:+5511999990000');
    const baileys = canonicalizeHandle('whatsapp-baileys', '5511999990000@s.whatsapp.net');
    expect(twilio.phone).toBe(baileys.phone); // -> links to one person by phone
  });
});

describe('canonicalizeHandle — LID and group forms stay distinct', () => {
  test('@lid is preserved as its own canonical form and derives NO phone', () => {
    const lid = canonicalizeHandle('whatsapp-baileys', '54958418317348@lid');
    expect(lid.platformUserId).toBe('54958418317348@lid');
    expect(lid.phone).toBeUndefined();
  });

  test('a device-suffixed @lid strips the :NN but stays a LID', () => {
    const lid = canonicalizeHandle('whatsapp-baileys', '54958418317348:2@lid');
    expect(lid.platformUserId).toBe('54958418317348@lid');
    expect(lid.phone).toBeUndefined();
  });

  test('a LID is NOT collapsed into a phone handle', () => {
    const lid = canonicalizeHandle('whatsapp-baileys', '54958418317348@lid');
    const phone = canonicalizeHandle('whatsapp-baileys', '54958418317348');
    expect(lid.platformUserId).not.toBe(phone.platformUserId);
  });

  test('@g.us group JIDs are preserved and derive no phone', () => {
    const group = canonicalizeHandle('whatsapp-baileys', '120363123456789012@g.us');
    expect(group.platformUserId).toBe('120363123456789012@g.us');
    expect(group.phone).toBeUndefined();
  });
});

describe('canonicalizeHandle — non-WhatsApp channels are untouched', () => {
  test('Discord / Slack / Telegram ids pass through unchanged', () => {
    for (const channel of ['discord', 'slack', 'telegram'] as const) {
      const c = canonicalizeHandle(channel, 'U0123ABCD');
      expect(c.platformUserId).toBe('U0123ABCD');
      expect(c.phone).toBeUndefined();
    }
  });

  test('an empty handle is returned unchanged', () => {
    expect(canonicalizeHandle('whatsapp-baileys', '').platformUserId).toBe('');
  });

  test('an unrecognized WhatsApp-family handle is left untouched with no phone', () => {
    const weird = canonicalizeHandle('whatsapp-baileys', 'not-a-number@s.whatsapp.net');
    expect(weird.platformUserId).toBe('not-a-number@s.whatsapp.net');
    expect(weird.phone).toBeUndefined();
  });
});

describe('channel classification helpers', () => {
  test('isWhatsAppFamily covers every WhatsApp transport', () => {
    for (const channel of ['whatsapp-baileys', 'whatsapp-business', 'twilio-whatsapp', 'gupshup', 'hermes'] as const) {
      expect(isWhatsAppFamily(channel)).toBe(true);
    }
    expect(isWhatsAppFamily('discord')).toBe(false);
    expect(isWhatsAppFamily('internal')).toBe(false);
  });

  test('isPersonlessChannel flags internal and a2a only', () => {
    expect(isPersonlessChannel('internal')).toBe(true);
    expect(isPersonlessChannel('a2a')).toBe(true);
    expect(isPersonlessChannel('whatsapp-baileys')).toBe(false);
    expect(isPersonlessChannel('discord')).toBe(false);
  });
});
