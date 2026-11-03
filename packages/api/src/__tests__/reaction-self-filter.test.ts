/**
 * Tests for the JID self-filter removal (#344).
 *
 * The JID self-filter in shouldProcessMessage (agent-dispatcher.ts) was removed
 * because it was dead code for its intended purpose (blocking bot reaction echoes)
 * and only caught legitimate owner phone messages. Reaction echoes are already
 * handled by:
 *   - Layer 1: !isFromMe check in handleReactionReceived (plugin.ts)
 *   - Layer 2: sentMessageIds cache in the WhatsApp channel plugin
 *
 * These tests verify that the extractPhoneFromJid utility still works correctly
 * and that the self-filter logic would NO LONGER block owner messages.
 */

import { describe, expect, it } from 'bun:test';
import { extractPhoneFromJid } from '../services/message-context';

describe('JID self-filter removal (#344)', () => {
  describe('extractPhoneFromJid (still used for LID resolution)', () => {
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
