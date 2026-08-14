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

  describe('passkey pairing', () => {
    const instanceId = 'passkey-instance';

    it('keeps the challenge and submits the WebAuthn response on the same socket', async () => {
      const plugin = new WhatsAppPlugin();
      const sendPasskeyResponse = mock(async () => {});
      (plugin as any).sockets = new Map([[instanceId, { sendPasskeyResponse }]]);

      await plugin.handlePasskeyUpdate(instanceId, {
        state: 'request',
        publicKey: { challenge: 'AQID', rpId: 'whatsapp.com' },
      });
      expect(plugin.getPasskeyState(instanceId)).toMatchObject({
        state: 'request',
        publicKey: { challenge: 'AQID', rpId: 'whatsapp.com' },
      });

      const credential = {
        id: 'AQID',
        rawId: 'AQID',
        type: 'public-key' as const,
        response: {
          clientDataJSON: 'AQID',
          authenticatorData: 'AQID',
          signature: 'AQID',
          userHandle: null,
        },
      };
      await plugin.submitPasskeyResponse(instanceId, credential);

      expect(sendPasskeyResponse).toHaveBeenCalledWith(credential);
      expect(plugin.getPasskeyState(instanceId)?.state).toBe('confirming');
    });

    it('auto-confirms the handoff when WhatsApp says no comparison is required', async () => {
      const plugin = new WhatsAppPlugin();
      const sendPasskeyConfirmation = mock(async () => {});
      (plugin as any).sockets = new Map([[instanceId, { sendPasskeyConfirmation }]]);

      await plugin.handlePasskeyUpdate(instanceId, {
        state: 'confirmation',
        code: '1234-5678',
        skipHandoffUX: true,
      });

      expect(sendPasskeyConfirmation).toHaveBeenCalledTimes(1);
      expect(plugin.getPasskeyState(instanceId)?.state).toBe('confirming');
    });
  });

  describe('editMessage', () => {
    const BOT_JID = '5511999999999@s.whatsapp.net';
    const INSTANCE_ID = 'test-instance';
    const MESSAGE_ID = '3EB0A1B2C3D4E5F6';
    const NEW_TEXT = 'edited message text';

    type CallArgs = [jid: string, msg: any];

    function createPluginWithMockSocket() {
      const plugin = new WhatsAppPlugin();
      const sendMessage = mock((_jid: string, _msg: Record<string, unknown>) => Promise.resolve(undefined));
      const mockSocket = {
        sendMessage,
        user: { id: BOT_JID },
      };
      (plugin as any).sockets = new Map([[INSTANCE_ID, mockSocket]]);
      (plugin as any).lastActionTime = new Map([[INSTANCE_ID, Date.now()]]);
      (plugin as any).logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };
      return { plugin, sendMessage };
    }

    function getCallArgs(
      sendMessage: ReturnType<typeof createPluginWithMockSocket>['sendMessage'],
      index = 0,
    ): CallArgs {
      return sendMessage.mock.calls[index] as unknown as CallArgs;
    }

    it('includes participant in edit key for group chats', async () => {
      const { plugin, sendMessage } = createPluginWithMockSocket();
      const groupJid = '120363000000000000@g.us';

      await plugin.editMessage(INSTANCE_ID, groupJid, MESSAGE_ID, NEW_TEXT);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      const [jid, msg] = getCallArgs(sendMessage);
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
      const [jid, msg] = getCallArgs(sendMessage);
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

      const [, msg] = getCallArgs(sendMessage);
      expect(msg.edit.participant).toBe(BOT_JID);
      expect(msg.edit.fromMe).toBe(true);
    });

    it('does NOT set participant when fromMe=false in group', async () => {
      const { plugin, sendMessage } = createPluginWithMockSocket();
      const groupJid = '120363000000000000@g.us';

      await plugin.editMessage(INSTANCE_ID, groupJid, MESSAGE_ID, NEW_TEXT, false);

      const [, msg] = getCallArgs(sendMessage);
      expect(msg.edit.participant).toBeUndefined();
      expect(msg.edit.fromMe).toBe(false);
    });

    it('throws WhatsAppError when Baileys sendMessage fails', async () => {
      const plugin = new WhatsAppPlugin();
      const sendMessage = mock(() => Promise.reject(new Error('Connection closed')));
      const mockSocket = { sendMessage, user: { id: BOT_JID } };
      (plugin as any).sockets = new Map([[INSTANCE_ID, mockSocket]]);
      (plugin as any).lastActionTime = new Map([[INSTANCE_ID, Date.now()]]);
      (plugin as any).logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };

      const dmJid = '5511888888888@s.whatsapp.net';
      await expect(plugin.editMessage(INSTANCE_ID, dmJid, MESSAGE_ID, NEW_TEXT)).rejects.toThrow(WhatsAppError);
    });

    it('logs the result key on successful edit', async () => {
      const plugin = new WhatsAppPlugin();
      const resultKey = { id: 'RESULT_KEY_123', remoteJid: '5511888888888@s.whatsapp.net', fromMe: true };
      const sendMessage = mock(() => Promise.resolve({ key: resultKey, status: 1 }));
      const mockSocket = { sendMessage, user: { id: BOT_JID } };
      (plugin as any).sockets = new Map([[INSTANCE_ID, mockSocket]]);
      (plugin as any).lastActionTime = new Map([[INSTANCE_ID, Date.now()]]);
      const logInfo = mock();
      (plugin as any).logger = { info: logInfo, debug: mock(), warn: mock(), error: mock() };

      const dmJid = '5511888888888@s.whatsapp.net';
      await plugin.editMessage(INSTANCE_ID, dmJid, MESSAGE_ID, NEW_TEXT);

      expect(logInfo).toHaveBeenCalledTimes(1);
      const logArgs = logInfo.mock.calls[0]!;
      expect(logArgs[0]).toBe('Message edited');
      expect(logArgs[1].resultKeyId).toBe('RESULT_KEY_123');
    });

    it('logs error details when Baileys edit fails', async () => {
      const plugin = new WhatsAppPlugin();
      const sendMessage = mock(() => Promise.reject(new Error('rate limit exceeded')));
      const mockSocket = { sendMessage, user: { id: BOT_JID } };
      (plugin as any).sockets = new Map([[INSTANCE_ID, mockSocket]]);
      (plugin as any).lastActionTime = new Map([[INSTANCE_ID, Date.now()]]);
      const logError = mock();
      (plugin as any).logger = { info: mock(), debug: mock(), warn: mock(), error: logError };

      const dmJid = '5511888888888@s.whatsapp.net';
      try {
        await plugin.editMessage(INSTANCE_ID, dmJid, MESSAGE_ID, NEW_TEXT);
      } catch {
        // expected
      }

      expect(logError).toHaveBeenCalledTimes(1);
      const logArgs = logError.mock.calls[0]!;
      expect(logArgs[0]).toBe('Failed to edit message via Baileys');
      expect(logArgs[1].error).toBe('rate limit exceeded');
    });
  });

  describe('reactions', () => {
    const INSTANCE_ID = 'test-instance';
    const GROUP_JID = '120363424772797713@g.us';
    const MESSAGE_ID = '3AAFEE9E6DB2E7864DE2';
    const PARTICIPANT = '178035101794451@lid';

    async function withHumanDelayDisabled(run: () => Promise<void>) {
      const previous = process.env.WHATSAPP_HUMAN_DELAY_ENABLED;
      const previousTyping = process.env.WHATSAPP_TYPING_SIMULATION_ENABLED;
      process.env.WHATSAPP_HUMAN_DELAY_ENABLED = 'false';
      process.env.WHATSAPP_TYPING_SIMULATION_ENABLED = 'false';
      try {
        await run();
      } finally {
        if (previous === undefined) Reflect.deleteProperty(process.env, 'WHATSAPP_HUMAN_DELAY_ENABLED');
        else process.env.WHATSAPP_HUMAN_DELAY_ENABLED = previous;
        if (previousTyping === undefined) Reflect.deleteProperty(process.env, 'WHATSAPP_TYPING_SIMULATION_ENABLED');
        else process.env.WHATSAPP_TYPING_SIMULATION_ENABLED = previousTyping;
      }
    }

    it('passes target participant into Baileys reaction key for group messages', async () => {
      await withHumanDelayDisabled(async () => {
        const plugin = new WhatsAppPlugin();
        const sendMessage = mock(() => Promise.resolve({ key: { id: 'REACTION-MSG-ID' } }));
        const mockSocket = { sendMessage, user: { id: '5511999999999@s.whatsapp.net' } };
        (plugin as any).sockets = new Map([[INSTANCE_ID, mockSocket]]);
        (plugin as any).logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };

        const result = await plugin.sendMessage(INSTANCE_ID, {
          to: GROUP_JID,
          content: {
            type: 'reaction',
            targetMessageId: MESSAGE_ID,
            emoji: '👍',
          },
          metadata: {
            fromMe: false,
            targetParticipant: PARTICIPANT,
          },
        } as any);

        expect(result.success).toBe(true);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        const [jid, content] = sendMessage.mock.calls[0]! as unknown as [
          string,
          { react: { key: { id: string; remoteJid: string; fromMe: boolean; participant?: string } } },
        ];
        expect(jid).toBe(GROUP_JID);
        expect(content.react.key).toEqual({
          remoteJid: GROUP_JID,
          id: MESSAGE_ID,
          fromMe: false,
          participant: PARTICIPANT,
        });
      });
    });

    it('emits caption and media metadata for sent media messages', async () => {
      await withHumanDelayDisabled(async () => {
        const plugin = new WhatsAppPlugin();
        const sendMessage = mock(() => Promise.resolve({ key: { id: 'MEDIA-MSG-ID' }, message: { imageMessage: {} } }));
        const publish = mock(async (_type: string, _payload: unknown) => {});
        const mockSocket = {
          sendMessage,
          sendPresenceUpdate: mock(async () => {}),
          user: { id: '5511999999999@s.whatsapp.net' },
        };
        (plugin as any).sockets = new Map([[INSTANCE_ID, mockSocket]]);
        (plugin as any).eventBus = { publish };
        (plugin as any).logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };

        const result = await plugin.sendMessage(INSTANCE_ID, {
          to: '5511888888888@s.whatsapp.net',
          content: {
            type: 'image',
            caption: 'caption test',
            filename: 'test.png',
            mimeType: 'image/png',
          },
          metadata: {
            base64: Buffer.from('image-bytes').toString('base64'),
          },
        } as any);

        expect(result.success).toBe(true);
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish.mock.calls[0]?.[0]).toBe('message.sent');
        expect(publish.mock.calls[0]?.[1]).toEqual({
          externalId: 'MEDIA-MSG-ID',
          chatId: '5511888888888@s.whatsapp.net',
          to: '5511888888888@s.whatsapp.net',
          content: {
            type: 'image',
            text: 'caption test',
            caption: 'caption test',
            mediaUrl: undefined,
            localPath: undefined,
            mimeType: 'image/png',
            filename: 'test.png',
            isVoiceNote: false,
          },
          replyToId: undefined,
          rawPayload: {
            externalId: 'MEDIA-MSG-ID',
            isFromMe: true,
            to: '5511888888888@s.whatsapp.net',
            caption: 'caption test',
            filename: 'test.png',
            mimeType: 'image/png',
            mediaSource: 'base64',
          },
          senderAgentId: undefined,
        });
      });
    });
  });
});
