/**
 * Tests for JID normalization utilities
 */

import { describe, expect, it } from 'bun:test';
import {
  JID_SUFFIX,
  extractLid,
  extractPhone,
  fromJid,
  isBroadcastJid,
  isCanonicalJid,
  isGroupJid,
  isLidJid,
  isNewsletterJid,
  isUserJid,
  normalizeJid,
  resolveCanonicalJid,
  resolveToLidJid,
  resolveToPhoneJid,
  resolveToPhoneJidLegacy,
  toGroupJid,
  toJid,
} from '../jid';

describe('JID Utilities', () => {
  describe('toJid', () => {
    it('converts phone number to user JID', () => {
      expect(toJid('1234567890')).toBe('1234567890@s.whatsapp.net');
    });

    it('handles phone number with country code', () => {
      expect(toJid('+15551234567')).toBe('15551234567@s.whatsapp.net');
    });

    it('strips non-digit characters', () => {
      expect(toJid('+1 (555) 123-4567')).toBe('15551234567@s.whatsapp.net');
    });

    it('returns full JID unchanged', () => {
      expect(toJid('1234567890@s.whatsapp.net')).toBe('1234567890@s.whatsapp.net');
    });

    it('returns group JID unchanged', () => {
      expect(toJid('123-456@g.us')).toBe('123-456@g.us');
    });

    it('returns LID JID unchanged (passthrough)', () => {
      expect(toJid('100000001@lid')).toBe('100000001@lid');
    });

    it('resolves phone to LID when lidCache has mapping', () => {
      const lidCache = new Map([['5511999@s.whatsapp.net', '100000001@lid']]);
      expect(toJid('5511999', lidCache)).toBe('100000001@lid');
    });

    it('falls back to phone JID when lidCache has no mapping', () => {
      const lidCache = new Map<string, string>();
      expect(toJid('5511999', lidCache)).toBe('5511999@s.whatsapp.net');
    });

    it('falls back to phone JID when no lidCache provided', () => {
      expect(toJid('5511999')).toBe('5511999@s.whatsapp.net');
    });
  });

  describe('toGroupJid', () => {
    it('converts group ID to group JID', () => {
      expect(toGroupJid('123456789-1234567890')).toBe('123456789-1234567890@g.us');
    });

    it('returns full group JID unchanged', () => {
      expect(toGroupJid('123456789-1234567890@g.us')).toBe('123456789-1234567890@g.us');
    });
  });

  describe('fromJid', () => {
    it('parses user JID', () => {
      const result = fromJid('1234567890@s.whatsapp.net');
      expect(result.id).toBe('1234567890');
      expect(result.isUser).toBe(true);
      expect(result.isGroup).toBe(false);
      expect(result.isBroadcast).toBe(false);
      expect(result.isLid).toBe(false);
    });

    it('parses group JID', () => {
      const result = fromJid('123-456@g.us');
      expect(result.id).toBe('123-456');
      expect(result.isUser).toBe(false);
      expect(result.isGroup).toBe(true);
      expect(result.isBroadcast).toBe(false);
      expect(result.isLid).toBe(false);
    });

    it('parses broadcast JID', () => {
      const result = fromJid('status@broadcast');
      expect(result.id).toBe('status');
      expect(result.isUser).toBe(false);
      expect(result.isGroup).toBe(false);
      expect(result.isBroadcast).toBe(true);
      expect(result.isLid).toBe(false);
    });

    it('parses LID JID', () => {
      const result = fromJid('100000001@lid');
      expect(result.id).toBe('100000001');
      expect(result.isUser).toBe(false);
      expect(result.isGroup).toBe(false);
      expect(result.isBroadcast).toBe(false);
      expect(result.isLid).toBe(true);
    });
  });

  describe('isGroupJid', () => {
    it('returns true for group JIDs', () => {
      expect(isGroupJid('123-456@g.us')).toBe(true);
    });

    it('returns false for user JIDs', () => {
      expect(isGroupJid('1234567890@s.whatsapp.net')).toBe(false);
    });
  });

  describe('isUserJid', () => {
    it('returns true for user JIDs', () => {
      expect(isUserJid('1234567890@s.whatsapp.net')).toBe(true);
    });

    it('returns false for group JIDs', () => {
      expect(isUserJid('123-456@g.us')).toBe(false);
    });

    it('returns false for LID JIDs', () => {
      expect(isUserJid('100000001@lid')).toBe(false);
    });
  });

  describe('isLidJid', () => {
    it('returns true for LID JIDs', () => {
      expect(isLidJid('100000001@lid')).toBe(true);
    });

    it('returns false for user JIDs', () => {
      expect(isLidJid('1234567890@s.whatsapp.net')).toBe(false);
    });

    it('returns false for group JIDs', () => {
      expect(isLidJid('123-456@g.us')).toBe(false);
    });
  });

  describe('isBroadcastJid', () => {
    it('returns true for broadcast JIDs', () => {
      expect(isBroadcastJid('status@broadcast')).toBe(true);
    });

    it('returns false for user JIDs', () => {
      expect(isBroadcastJid('1234567890@s.whatsapp.net')).toBe(false);
    });
  });

  describe('isNewsletterJid', () => {
    it('returns true for newsletter JIDs', () => {
      expect(isNewsletterJid('abc123@newsletter')).toBe(true);
    });

    it('returns false for user JIDs', () => {
      expect(isNewsletterJid('1234567890@s.whatsapp.net')).toBe(false);
    });
  });

  describe('isCanonicalJid', () => {
    it('returns true for LID JIDs', () => {
      expect(isCanonicalJid('100000001@lid')).toBe(true);
    });

    it('returns true for user JIDs', () => {
      expect(isCanonicalJid('5511999@s.whatsapp.net')).toBe(true);
    });

    it('returns false for group JIDs', () => {
      expect(isCanonicalJid('123-456@g.us')).toBe(false);
    });

    it('returns false for broadcast JIDs', () => {
      expect(isCanonicalJid('status@broadcast')).toBe(false);
    });

    it('returns false for newsletter JIDs', () => {
      expect(isCanonicalJid('abc123@newsletter')).toBe(false);
    });
  });

  describe('extractPhone', () => {
    it('extracts phone from user JID', () => {
      expect(extractPhone('1234567890@s.whatsapp.net')).toBe('1234567890');
    });

    it('returns undefined for group JID', () => {
      expect(extractPhone('123-456@g.us')).toBeUndefined();
    });

    it('returns undefined for LID JID', () => {
      expect(extractPhone('100000001@lid')).toBeUndefined();
    });
  });

  describe('extractLid', () => {
    it('extracts LID from LID JID', () => {
      expect(extractLid('100000001@lid')).toBe('100000001');
    });

    it('returns undefined for user JID', () => {
      expect(extractLid('1234567890@s.whatsapp.net')).toBeUndefined();
    });

    it('returns undefined for group JID', () => {
      expect(extractLid('123-456@g.us')).toBeUndefined();
    });
  });

  describe('resolveCanonicalJid', () => {
    it('returns LID JID unchanged (already canonical)', () => {
      expect(resolveCanonicalJid('100000001@lid', null, undefined)).toBe('100000001@lid');
    });

    it('returns phone JID unchanged when no mapping is available', () => {
      expect(resolveCanonicalJid('5511999@s.whatsapp.net', null, undefined)).toBe('5511999@s.whatsapp.net');
    });

    it('returns LID JID unchanged even when remoteJidAlt is a phone JID', () => {
      expect(resolveCanonicalJid('100000001@lid', '5511999@s.whatsapp.net', undefined)).toBe('100000001@lid');
    });

    it('upgrades phone JID to LID via remoteJidAlt when alt is a LID', () => {
      expect(resolveCanonicalJid('5511999@s.whatsapp.net', '100000001@lid', undefined)).toBe('100000001@lid');
    });

    it('upgrades phone JID to LID via the bidirectional cache', () => {
      const cache = new Map([
        ['100000001@lid', '5511999@s.whatsapp.net'],
        ['5511999@s.whatsapp.net', '100000001@lid'],
      ]);
      expect(resolveCanonicalJid('5511999@s.whatsapp.net', null, cache)).toBe('100000001@lid');
    });

    it('prefers remoteJidAlt over the cache when both are present', () => {
      const cache = new Map([['5511999@s.whatsapp.net', '999999999@lid']]);
      expect(resolveCanonicalJid('5511999@s.whatsapp.net', '100000001@lid', cache)).toBe('100000001@lid');
    });

    it('returns empty string for null/undefined jid', () => {
      expect(resolveCanonicalJid(null, null, undefined)).toBe('');
      expect(resolveCanonicalJid(undefined, null, undefined)).toBe('');
    });

    it('returns group JID unchanged', () => {
      const cache = new Map([['100000001@lid', '5511999@s.whatsapp.net']]);
      expect(resolveCanonicalJid('123-456@g.us', '100000001@lid', cache)).toBe('123-456@g.us');
    });

    it('returns broadcast JID unchanged', () => {
      expect(resolveCanonicalJid('status@broadcast', null, undefined)).toBe('status@broadcast');
    });

    it('returns newsletter JID unchanged', () => {
      expect(resolveCanonicalJid('abc123@newsletter', null, undefined)).toBe('abc123@newsletter');
    });

    it('ignores cache entries that point to non-LID JIDs', () => {
      // Defensive: if the cache lookup yields something that isn't a LID, fall back to phone JID
      const cache = new Map([['5511999@s.whatsapp.net', '5599888@s.whatsapp.net']]);
      expect(resolveCanonicalJid('5511999@s.whatsapp.net', null, cache)).toBe('5511999@s.whatsapp.net');
    });
  });

  describe('resolveToLidJid', () => {
    it('returns LID JID when mapping exists', () => {
      const cache = new Map([['5511999@s.whatsapp.net', '100000001@lid']]);
      expect(resolveToLidJid('5511999@s.whatsapp.net', cache)).toBe('100000001@lid');
    });

    it('returns phone JID unchanged when no mapping exists', () => {
      const cache = new Map<string, string>();
      expect(resolveToLidJid('5511999@s.whatsapp.net', cache)).toBe('5511999@s.whatsapp.net');
    });

    it('returns phone JID unchanged when no cache provided', () => {
      expect(resolveToLidJid('5511999@s.whatsapp.net')).toBe('5511999@s.whatsapp.net');
    });

    it('returns LID JID unchanged (already LID)', () => {
      expect(resolveToLidJid('100000001@lid')).toBe('100000001@lid');
    });

    it('returns empty string for empty input', () => {
      expect(resolveToLidJid('')).toBe('');
    });
  });

  describe('resolveToPhoneJid (legacy)', () => {
    it('resolves LID to phone via remoteJidAlt', () => {
      expect(resolveToPhoneJid('100000001@lid', '5511999@s.whatsapp.net')).toBe('5511999@s.whatsapp.net');
    });

    it('resolves LID to phone via cache', () => {
      const cache = new Map([['100000001@lid', '5511999@s.whatsapp.net']]);
      expect(resolveToPhoneJid('100000001@lid', null, cache)).toBe('5511999@s.whatsapp.net');
    });

    it('returns phone JID unchanged', () => {
      expect(resolveToPhoneJid('5511999@s.whatsapp.net', null)).toBe('5511999@s.whatsapp.net');
    });

    it('returns original LID when unresolvable', () => {
      expect(resolveToPhoneJid('100000001@lid', null)).toBe('100000001@lid');
    });

    it('is the same as resolveToPhoneJidLegacy', () => {
      expect(resolveToPhoneJid).toBe(resolveToPhoneJidLegacy);
    });
  });

  describe('normalizeJid', () => {
    it('normalizes phone number to JID', () => {
      expect(normalizeJid('+15551234567')).toBe('15551234567@s.whatsapp.net');
    });

    it('returns full JID unchanged', () => {
      expect(normalizeJid('1234567890@s.whatsapp.net')).toBe('1234567890@s.whatsapp.net');
    });
  });

  describe('JID_SUFFIX', () => {
    it('has correct user suffix', () => {
      expect(JID_SUFFIX.USER).toBe('@s.whatsapp.net');
    });

    it('has correct group suffix', () => {
      expect(JID_SUFFIX.GROUP).toBe('@g.us');
    });

    it('has correct broadcast suffix', () => {
      expect(JID_SUFFIX.BROADCAST).toBe('@broadcast');
    });

    it('has correct LID suffix', () => {
      expect(JID_SUFFIX.LID).toBe('@lid');
    });

    it('has correct newsletter suffix', () => {
      expect(JID_SUFFIX.NEWSLETTER).toBe('@newsletter');
    });
  });
});
