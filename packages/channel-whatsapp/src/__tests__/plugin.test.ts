/**
 * Tests for WhatsApp plugin
 */

import { describe, expect, it, mock } from 'bun:test';
import { WHATSAPP_CAPABILITIES } from '../capabilities';
import { WhatsAppPlugin } from '../plugin';
import { WhatsAppError } from '../utils/errors';

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

    it('supports message editing', () => {
      expect(WHATSAPP_CAPABILITIES.canEditMessage).toBe(true);
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

    it('supports group handling', () => {
      expect(WHATSAPP_CAPABILITIES.canHandleGroups).toBe(true);
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

  describe('editMessage', () => {
    const BOT_JID = '5511999999999@s.whatsapp.net';
    const INSTANCE_ID = 'test-instance';
    const MESSAGE_ID = '3EB0A1B2C3D4E5F6';
    const NEW_TEXT = 'edited message text';

    function createPluginWithMockSocket() {
      const plugin = new WhatsAppPlugin();
      const sendMessage = mock(() => Promise.resolve(undefined));
      const mockSocket = {
        sendMessage,
        user: { id: BOT_JID },
      };
      // Inject mock socket and logger via private member access
      (plugin as any).sockets = new Map([[INSTANCE_ID, mockSocket]]);
      (plugin as any).lastActionTime = new Map([[INSTANCE_ID, Date.now()]]);
      (plugin as any).logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };
      return { plugin, sendMessage };
    }

    it('includes participant in edit key for group chats', async () => {
      const { plugin, sendMessage } = createPluginWithMockSocket();
      const groupJid = '120363000000000000@g.us';

      await plugin.editMessage(INSTANCE_ID, groupJid, MESSAGE_ID, NEW_TEXT);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      const [jid, msg] = sendMessage.mock.calls[0]!;
      expect(jid).toBe(groupJid);
      expect(msg.edit.participant).toBe(BOT_JID);
      expect(msg.edit.remoteJid).toBe(groupJid);
      expect(msg.edit.id).toBe(MESSAGE_ID);
      expect(msg.edit.fromMe).toBe(true);
      expect(msg.text).toBe(NEW_TEXT);
    });

    it('does NOT include participant in edit key for DM chats', async () => {
      const { plugin, sendMessage } = createPluginWithMockSocket();
      const dmJid = '5511888888888@s.whatsapp.net';

      await plugin.editMessage(INSTANCE_ID, dmJid, MESSAGE_ID, NEW_TEXT);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      const [jid, msg] = sendMessage.mock.calls[0]!;
      expect(jid).toBe(dmJid);
      expect(msg.edit.participant).toBeUndefined();
      expect(msg.edit.remoteJid).toBe(dmJid);
      expect(msg.edit.id).toBe(MESSAGE_ID);
      expect(msg.edit.fromMe).toBe(true);
    });

    it('uses bot own JID as participant when fromMe=true in group', async () => {
      const { plugin, sendMessage } = createPluginWithMockSocket();
      const groupJid = '120363000000000000@g.us';

      await plugin.editMessage(INSTANCE_ID, groupJid, MESSAGE_ID, NEW_TEXT, true);

      const [, msg] = sendMessage.mock.calls[0];
      expect(msg.edit.participant).toBe(BOT_JID);
      expect(msg.edit.fromMe).toBe(true);
    });

    it('does NOT set participant when fromMe=false in group', async () => {
      const { plugin, sendMessage } = createPluginWithMockSocket();
      const groupJid = '120363000000000000@g.us';

      await plugin.editMessage(INSTANCE_ID, groupJid, MESSAGE_ID, NEW_TEXT, false);

      const [, msg] = sendMessage.mock.calls[0];
      expect(msg.edit.participant).toBeUndefined();
      expect(msg.edit.fromMe).toBe(false);
    });
  });
});
