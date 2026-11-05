/**
 * Tests for phone extraction from WhatsApp JIDs and LIDs.
 */

import { describe, expect, it } from 'bun:test';
import { extractPhoneFromJid } from '../services/message-context';

describe('extractPhoneFromJid', () => {
  describe('phone and LID resolution', () => {
    it('extracts phone from standard WhatsApp JID', () => {
      expect(extractPhoneFromJid('5511960008976@s.whatsapp.net')).toBe('5511960008976');
    });

    it('extracts phone from LID JID', () => {
      expect(extractPhoneFromJid('63750317031625@lid')).toBe('63750317031625');
    });

    it('extracts phone from device-suffixed JID', () => {
      expect(extractPhoneFromJid('5511960008976:4@s.whatsapp.net')).toBe('5511960008976');
    });

    it('handles plain number (no @)', () => {
      expect(extractPhoneFromJid('5511960008976')).toBe('5511960008976');
    });
  });
});
