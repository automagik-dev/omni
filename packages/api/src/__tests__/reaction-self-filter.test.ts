/**
 * Tests for the agent-dispatcher self-filter fix (#336).
 *
 * The shouldProcessMessage function in agent-dispatcher.ts has a self-filter
 * that compares payload.from against metadata.platformIdentityId. This fails
 * for WhatsApp because payload.from is a JID while platformIdentityId is a UUID.
 *
 * The fix adds a JID-based check using rawPayload.isFromMe + ownerIdentifier
 * comparison via extractPhoneFromJid. These tests verify the logic.
 */

import { describe, expect, it } from 'bun:test';
import { extractPhoneFromJid } from '../services/message-context';

describe('Reaction self-filter logic (#336)', () => {
  describe('extractPhoneFromJid', () => {
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

  describe('self-filter matching logic', () => {
    // This mirrors the logic in shouldProcessMessage in agent-dispatcher.ts:
    //   rawPayload.isFromMe === true &&
    //   ownerIdentifier &&
    //   extractPhoneFromJid(from) === extractPhoneFromJid(ownerIdentifier)

    function wouldFilterMessage(from: string, ownerIdentifier: string | null, isFromMe: boolean): boolean {
      if (!isFromMe) return false;
      if (!ownerIdentifier) return false;
      return extractPhoneFromJid(from) === extractPhoneFromJid(ownerIdentifier);
    }

    it('filters bot reaction echo (isFromMe + JID match)', () => {
      // Bot's own reaction echoes back with the owner's JID and isFromMe=true
      expect(wouldFilterMessage('5511960008976@s.whatsapp.net', '5511960008976@s.whatsapp.net', true)).toBe(true);
    });

    it('filters LID-based reaction echo', () => {
      // Same owner, but sender uses LID format
      expect(wouldFilterMessage('63750317031625@lid', '63750317031625@lid', true)).toBe(true);
    });

    it('does NOT filter incoming message from contact', () => {
      // Contact sends a message — different JID, isFromMe=false
      expect(wouldFilterMessage('5599888887777@s.whatsapp.net', '5511960008976@s.whatsapp.net', false)).toBe(false);
    });

    it('does NOT filter owner-typed message from phone (isFromMe but different from)', () => {
      // Owner types to a contact — would not have isFromMe in rawPayload for the
      // contact's perspective. In practice, fromMe messages from the phone are
      // filtered at the channel level by sentMessageIds, not here.
      expect(wouldFilterMessage('5599888887777@s.whatsapp.net', '5511960008976@s.whatsapp.net', true)).toBe(false);
    });

    it('does NOT filter when ownerIdentifier is null', () => {
      // Instance without ownerIdentifier (e.g. not yet connected)
      expect(wouldFilterMessage('5511960008976@s.whatsapp.net', null, true)).toBe(false);
    });

    it('does NOT filter user reactions (isFromMe=false)', () => {
      // A user reacts to a message — should be dispatched to the agent
      expect(wouldFilterMessage('5511960008976@s.whatsapp.net', '5511960008976@s.whatsapp.net', false)).toBe(false);
    });

    it('matches device-suffixed JID against plain ownerIdentifier', () => {
      // Device suffix in from but not in ownerIdentifier
      expect(wouldFilterMessage('5511960008976:4@s.whatsapp.net', '5511960008976@s.whatsapp.net', true)).toBe(true);
    });
  });
});
