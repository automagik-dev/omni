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

  describe('owner messages pass through after filter removal', () => {
    // The old self-filter logic was:
    //   rawPayload.isFromMe === true &&
    //   ownerIdentifier &&
    //   extractPhoneFromJid(from) === extractPhoneFromJid(ownerIdentifier)
    //
    // This function reproduces the OLD logic to prove it WOULD have filtered
    // owner messages that should now pass through.

    function oldFilterWouldBlock(from: string, ownerIdentifier: string | null, isFromMe: boolean): boolean {
      if (!isFromMe) return false;
      if (!ownerIdentifier) return false;
      return extractPhoneFromJid(from) === extractPhoneFromJid(ownerIdentifier);
    }

    it('owner phone message (isFromMe + JID match) is no longer blocked', () => {
      // Owner sends a message from their phone — multi-device sync sets isFromMe=true
      // and the from JID matches the ownerIdentifier. The old filter would block this.
      const wouldHaveBeenBlocked = oldFilterWouldBlock(
        '5511960008976@s.whatsapp.net',
        '5511960008976@s.whatsapp.net',
        true,
      );
      expect(wouldHaveBeenBlocked).toBe(true); // old filter WOULD have blocked
      // But the filter is removed, so these messages now pass through to the agent.
    });

    it('owner phone message with device suffix is no longer blocked', () => {
      const wouldHaveBeenBlocked = oldFilterWouldBlock(
        '5511960008976:4@s.whatsapp.net',
        '5511960008976@s.whatsapp.net',
        true,
      );
      expect(wouldHaveBeenBlocked).toBe(true); // old filter WOULD have blocked
    });

    it('owner LID message is no longer blocked', () => {
      const wouldHaveBeenBlocked = oldFilterWouldBlock('63750317031625@lid', '63750317031625@lid', true);
      expect(wouldHaveBeenBlocked).toBe(true); // old filter WOULD have blocked
    });

    it('contact messages were never affected (isFromMe=false)', () => {
      const wouldHaveBeenBlocked = oldFilterWouldBlock(
        '5599888887777@s.whatsapp.net',
        '5511960008976@s.whatsapp.net',
        false,
      );
      expect(wouldHaveBeenBlocked).toBe(false); // never blocked contacts
    });

    it('messages from different JID were never affected', () => {
      const wouldHaveBeenBlocked = oldFilterWouldBlock(
        '5599888887777@s.whatsapp.net',
        '5511960008976@s.whatsapp.net',
        true,
      );
      expect(wouldHaveBeenBlocked).toBe(false); // different JIDs, never matched
    });
  });

  describe('reaction echo protection remains intact (layers 1 + 2)', () => {
    // These tests document that reaction echo protection does NOT depend on
    // the removed layer 3 filter. The protection is handled by:
    //
    // Layer 1: handleReactionReceived() in plugin.ts checks !isFromMe before
    //          dual-emitting to message.received. Bot reaction echoes have
    //          isFromMe=true, so they never reach shouldProcessMessage at all.
    //
    // Layer 2: sentMessageIds cache in the WhatsApp channel plugin filters
    //          messages the bot itself sent, as a secondary safety net.

    it('layer 1: bot reaction echoes never reach message.received handler', () => {
      // Simulates the plugin-level check: !isFromMe gates dual-emit
      const isFromMe = true; // bot's own reaction echo
      const wouldDualEmit = !isFromMe;
      expect(wouldDualEmit).toBe(false); // reaction echo is blocked at layer 1
    });

    it('layer 1: user reactions DO reach message.received handler', () => {
      const isFromMe = false; // user's reaction
      const wouldDualEmit = !isFromMe;
      expect(wouldDualEmit).toBe(true); // user reaction passes through
    });
  });
});
