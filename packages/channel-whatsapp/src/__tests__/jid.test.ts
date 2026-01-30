/**
 * Tests for JID normalization utilities
 */

import { describe, expect, it } from 'bun:test';
import { JID_SUFFIX, extractPhone, fromJid, isGroupJid, isUserJid, normalizeJid, toGroupJid, toJid } from '../jid';

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
    });

    it('parses group JID', () => {
      const result = fromJid('123-456@g.us');
      expect(result.id).toBe('123-456');
      expect(result.isUser).toBe(false);
      expect(result.isGroup).toBe(true);
      expect(result.isBroadcast).toBe(false);
    });

    it('parses broadcast JID', () => {
      const result = fromJid('status@broadcast');
      expect(result.id).toBe('status');
      expect(result.isUser).toBe(false);
      expect(result.isGroup).toBe(false);
      expect(result.isBroadcast).toBe(true);
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
  });

  describe('extractPhone', () => {
    it('extracts phone from user JID', () => {
      expect(extractPhone('1234567890@s.whatsapp.net')).toBe('1234567890');
    });

    it('returns undefined for group JID', () => {
      expect(extractPhone('123-456@g.us')).toBeUndefined();
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
  });
});
