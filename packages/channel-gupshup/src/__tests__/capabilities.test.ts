/**
 * Gupshup capabilities — unit tests
 *
 * Verifies that GUPSHUP_CAPABILITIES declares the correct values
 * for all required fields.
 */

import { describe, expect, it } from 'bun:test';
import { GUPSHUP_CAPABILITIES } from '../capabilities';

describe('GUPSHUP_CAPABILITIES', () => {
  describe('supported features (true)', () => {
    it('canSendText', () => expect(GUPSHUP_CAPABILITIES.canSendText).toBe(true));
    it('canSendMedia', () => expect(GUPSHUP_CAPABILITIES.canSendMedia).toBe(true));
    it('canSendContact', () => expect(GUPSHUP_CAPABILITIES.canSendContact).toBe(true));
    it('canSendLocation', () => expect(GUPSHUP_CAPABILITIES.canSendLocation).toBe(true));
    it('canSendButtons', () => expect(GUPSHUP_CAPABILITIES.canSendButtons).toBe(true));
    it('canReceiveReadReceipts', () => expect(GUPSHUP_CAPABILITIES.canReceiveReadReceipts).toBe(true));
    it('canReceiveDeliveryReceipts', () => expect(GUPSHUP_CAPABILITIES.canReceiveDeliveryReceipts).toBe(true));
    it('canHandleDMs', () => expect(GUPSHUP_CAPABILITIES.canHandleDMs).toBe(true));
    it('canReplyToMessage', () => expect(GUPSHUP_CAPABILITIES.canReplyToMessage).toBe(true));
  });

  describe('unsupported features (false)', () => {
    it('canSendReaction', () => expect(GUPSHUP_CAPABILITIES.canSendReaction).toBe(false));
    it('canSendTyping', () => expect(GUPSHUP_CAPABILITIES.canSendTyping).toBe(false));
    it('canHandleGroups', () => expect(GUPSHUP_CAPABILITIES.canHandleGroups).toBe(false));
    it('canStreamResponse', () => expect(GUPSHUP_CAPABILITIES.canStreamResponse).toBe(false));
    it('canSendSticker', () => expect(GUPSHUP_CAPABILITIES.canSendSticker).toBe(false));
    it('canEditMessage', () => expect(GUPSHUP_CAPABILITIES.canEditMessage).toBe(false));
    it('canDeleteMessage', () => expect(GUPSHUP_CAPABILITIES.canDeleteMessage).toBe(false));
    it('canForwardMessage', () => expect(GUPSHUP_CAPABILITIES.canForwardMessage).toBe(false));
    it('canHandleBroadcast', () => expect(GUPSHUP_CAPABILITIES.canHandleBroadcast).toBe(false));
  });

  describe('limits', () => {
    it('maxMessageLength is 4096', () => expect(GUPSHUP_CAPABILITIES.maxMessageLength).toBe(4096));
    it('maxFileSize is 100MB', () => expect(GUPSHUP_CAPABILITIES.maxFileSize).toBe(100 * 1024 * 1024));
    it('supportedMediaTypes covers image, audio, video, application', () => {
      const mimeTypes = GUPSHUP_CAPABILITIES.supportedMediaTypes.map((m) => m.mimeType);
      expect(mimeTypes).toContain('image/*');
      expect(mimeTypes).toContain('audio/*');
      expect(mimeTypes).toContain('video/*');
      expect(mimeTypes).toContain('application/*');
    });
  });
});
