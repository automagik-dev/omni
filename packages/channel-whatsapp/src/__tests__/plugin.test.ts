/**
 * Tests for WhatsApp plugin
 */

import { describe, expect, it } from 'bun:test';
import { WHATSAPP_CAPABILITIES } from '../capabilities';
import { WhatsAppPlugin } from '../plugin';

describe('WhatsAppPlugin', () => {
  describe('metadata', () => {
    it('has correct id', () => {
      const plugin = new WhatsAppPlugin();
      expect(plugin.id).toBe('whatsapp-baileys');
    });

    it('has correct name', () => {
      const plugin = new WhatsAppPlugin();
      expect(plugin.name).toBe('WhatsApp (Baileys)');
    });

    it('has version', () => {
      const plugin = new WhatsAppPlugin();
      expect(plugin.version).toBe('1.0.0');
    });

    it('has capabilities', () => {
      const plugin = new WhatsAppPlugin();
      expect(plugin.capabilities).toBe(WHATSAPP_CAPABILITIES);
    });
  });

  describe('capabilities', () => {
    it('supports text messaging', () => {
      expect(WHATSAPP_CAPABILITIES.canSendText).toBe(true);
    });

    it('supports media', () => {
      expect(WHATSAPP_CAPABILITIES.canSendMedia).toBe(true);
    });

    it('supports reactions', () => {
      expect(WHATSAPP_CAPABILITIES.canSendReaction).toBe(true);
    });

    it('supports typing indicators', () => {
      expect(WHATSAPP_CAPABILITIES.canSendTyping).toBe(true);
    });

    it('supports read receipts', () => {
      expect(WHATSAPP_CAPABILITIES.canReceiveReadReceipts).toBe(true);
    });

    it('supports delivery receipts', () => {
      expect(WHATSAPP_CAPABILITIES.canReceiveDeliveryReceipts).toBe(true);
    });

    it('does not support message editing', () => {
      expect(WHATSAPP_CAPABILITIES.canEditMessage).toBe(false);
    });

    it('supports message deletion', () => {
      expect(WHATSAPP_CAPABILITIES.canDeleteMessage).toBe(true);
    });

    it('supports reply/quote', () => {
      expect(WHATSAPP_CAPABILITIES.canReplyToMessage).toBe(true);
    });

    it('supports contacts', () => {
      expect(WHATSAPP_CAPABILITIES.canSendContact).toBe(true);
    });

    it('supports location', () => {
      expect(WHATSAPP_CAPABILITIES.canSendLocation).toBe(true);
    });

    it('supports stickers', () => {
      expect(WHATSAPP_CAPABILITIES.canSendSticker).toBe(true);
    });

    it('defers group handling', () => {
      expect(WHATSAPP_CAPABILITIES.canHandleGroups).toBe(false);
    });

    it('has correct max message length', () => {
      expect(WHATSAPP_CAPABILITIES.maxMessageLength).toBe(65536);
    });

    it('has supported media types', () => {
      expect(WHATSAPP_CAPABILITIES.supportedMediaTypes.length).toBe(4);
    });

    it('has correct max file size', () => {
      expect(WHATSAPP_CAPABILITIES.maxFileSize).toBe(100 * 1024 * 1024);
    });
  });
});
