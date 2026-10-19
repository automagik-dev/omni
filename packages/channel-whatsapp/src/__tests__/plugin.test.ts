/**
 * Tests for WhatsApp plugin
 */

import { afterEach, describe, expect, it, jest, mock } from 'bun:test';
import type { OutgoingMessage } from '@omni/channel-sdk';
import { WHATSAPP_CAPABILITIES } from '../capabilities';
import { setupMessageHandlers } from '../handlers/messages';
import { WhatsAppPlugin } from '../plugin';
import { ErrorCode, WhatsAppError } from '../utils/errors';

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

    it('resolves a rejecting reaction send to the structured failure result instead of throwing', async () => {
      await withHumanDelayDisabled(async () => {
        const plugin = new WhatsAppPlugin();
        const sendMessage = mock(() => Promise.reject(new WhatsAppError(ErrorCode.SEND_FAILED, 'reaction rejected')));
        const publish = mock(async (_type: string, _payload: unknown) => {});
        const mockSocket = { sendMessage, user: { id: '5511999999999@s.whatsapp.net' } };
        (plugin as any).sockets = new Map([[INSTANCE_ID, mockSocket]]);
        (plugin as any).eventBus = { publish };
        (plugin as any).logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };

        const pending = plugin.sendMessage(INSTANCE_ID, {
          to: GROUP_JID,
          content: { type: 'reaction', targetMessageId: MESSAGE_ID, emoji: '👍' },
          metadata: { fromMe: false, targetParticipant: PARTICIPANT },
        } as any);

        await expect(pending).resolves.toMatchObject({
          success: false,
          error: 'reaction rejected',
          errorCode: ErrorCode.SEND_FAILED,
          retryable: false,
        });
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(publish.mock.calls.map((call) => call[0])).toContain('message.failed');
      });
    });

    it('returns the normal success result for a successful reaction send', async () => {
      await withHumanDelayDisabled(async () => {
        const plugin = new WhatsAppPlugin();
        const sendMessage = mock(() => Promise.resolve({ key: { id: 'REACTION-OK-ID' } }));
        const mockSocket = { sendMessage, user: { id: '5511999999999@s.whatsapp.net' } };
        (plugin as any).sockets = new Map([[INSTANCE_ID, mockSocket]]);
        (plugin as any).logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };

        const result = await plugin.sendMessage(INSTANCE_ID, {
          to: GROUP_JID,
          content: { type: 'reaction', targetMessageId: MESSAGE_ID, emoji: '👍' },
          metadata: { fromMe: false, targetParticipant: PARTICIPANT },
        } as any);

        expect(result.success).toBe(true);
        expect(result.errorCode).toBeUndefined();
        expect(typeof result.timestamp).toBe('number');
        expect(sendMessage).toHaveBeenCalledTimes(1);
      });
    });

    async function quotedKeyFor(metadata: Record<string, unknown>) {
      let quoted: unknown;
      await withHumanDelayDisabled(async () => {
        const plugin = new WhatsAppPlugin();
        const sendMessage = mock((_jid: string, _content: unknown, _options?: { quoted?: unknown }) =>
          Promise.resolve({ key: { id: 'SENT-ID' }, message: {} }),
        );
        const mockSocket = {
          sendMessage,
          sendPresenceUpdate: mock(async () => {}),
          user: { id: '5511999999999@s.whatsapp.net' },
        };
        (plugin as any).sockets = new Map([[INSTANCE_ID, mockSocket]]);
        (plugin as any).eventBus = { publish: mock(async () => {}) };
        (plugin as any).logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };

        const result = await plugin.sendMessage(INSTANCE_ID, {
          to: GROUP_JID,
          content: { type: 'text', text: 'reply' },
          replyTo: 'QUOTED-ID',
          metadata,
        } as any);
        expect(result.success).toBe(true);
        quoted = sendMessage.mock.calls[0]?.[2]?.quoted;
      });
      return quoted as { key?: Record<string, unknown> };
    }

    it('no new input: the no-row fallback quoted key stays fromMe=false without participant', async () => {
      const quoted = await quotedKeyFor({});
      expect(quoted.key).toEqual({ id: 'QUOTED-ID', remoteJid: GROUP_JID, fromMe: false });
    });

    it('replyToKey fromMe and participant reach the fallback quoted key when the row is missing', async () => {
      const quoted = await quotedKeyFor({ replyToFromMe: true, replyToParticipant: PARTICIPANT });
      expect(quoted.key).toEqual({ id: 'QUOTED-ID', remoteJid: GROUP_JID, fromMe: true, participant: PARTICIPANT });
    });

    it('no new input: a stored rawPayload is still quoted as-is', async () => {
      const rawPayload = {
        key: { id: 'QUOTED-ID', remoteJid: GROUP_JID, fromMe: false },
        message: { conversation: 'x' },
      };
      const quoted = await quotedKeyFor({ replyToFromMe: false, replyToRawPayload: rawPayload });
      expect(quoted).toBe(rawPayload);
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

  describe('outbound pacing', () => {
    const INSTANCE_ID = 'pacing-instance';
    const DM_JID = '5511888888888@s.whatsapp.net';

    type PacingInternals = {
      sockets: Map<string, unknown>;
      eventBus: { publish: (type: string, payload: unknown) => Promise<void> };
      logger: Record<string, unknown>;
      humanDelay: (instanceId: string) => Promise<void>;
      simulateTyping: (instanceId: string, jid: string, text: string) => Promise<void>;
    };

    function createPacingPlugin() {
      const plugin = new WhatsAppPlugin();
      const internals = plugin as unknown as PacingInternals;
      const sendMessage = mock(async () => ({ key: { id: 'PACED-MSG-ID' }, message: { conversation: 'x' } }));
      internals.sockets = new Map([
        [
          INSTANCE_ID,
          { sendMessage, sendPresenceUpdate: mock(async () => {}), user: { id: '5511999999999@s.whatsapp.net' } },
        ],
      ]);
      internals.eventBus = { publish: mock(async () => {}) };
      internals.logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };
      const humanDelay = mock(async (_instanceId: string) => {});
      const simulateTyping = mock(async (_instanceId: string, _jid: string, _text: string) => {});
      internals.humanDelay = humanDelay;
      internals.simulateTyping = simulateTyping;
      return { plugin, sendMessage, humanDelay, simulateTyping };
    }

    const textMessage = (metadata?: Record<string, unknown>): OutgoingMessage => ({
      to: DM_JID,
      content: { type: 'text', text: 'hello there' },
      ...(metadata ? { metadata } : {}),
    });

    const mediaMessage = (metadata: Record<string, unknown> = {}): OutgoingMessage => ({
      to: DM_JID,
      content: { type: 'image', caption: 'caption test', filename: 'test.png', mimeType: 'image/png' },
      metadata: { base64: Buffer.from('image-bytes').toString('base64'), ...metadata },
    });

    const reactionMessage = (metadata?: Record<string, unknown>): OutgoingMessage => ({
      to: DM_JID,
      content: { type: 'reaction', targetMessageId: '3EB0REACTTARGET', emoji: '👍' },
      ...(metadata ? { metadata } : {}),
    });

    it('no pacing metadata: text still runs humanDelay then simulateTyping (unchanged)', async () => {
      const { plugin, sendMessage, humanDelay, simulateTyping } = createPacingPlugin();

      const result = await plugin.sendMessage(INSTANCE_ID, textMessage());

      expect(result.success).toBe(true);
      expect(humanDelay).toHaveBeenCalledTimes(1);
      expect(humanDelay.mock.calls[0]).toEqual([INSTANCE_ID]);
      expect(simulateTyping).toHaveBeenCalledTimes(1);
      expect(simulateTyping.mock.calls[0]).toEqual([INSTANCE_ID, DM_JID, 'hello there']);
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it("explicit 'humanized' behaves like no metadata", async () => {
      const { plugin, humanDelay, simulateTyping } = createPacingPlugin();

      await plugin.sendMessage(INSTANCE_ID, textMessage({ outboundPacing: 'humanized' }));

      expect(humanDelay).toHaveBeenCalledTimes(1);
      expect(simulateTyping).toHaveBeenCalledTimes(1);
    });

    it('immediate: text skips both humanDelay and simulateTyping but still sends', async () => {
      const { plugin, sendMessage, humanDelay, simulateTyping } = createPacingPlugin();

      const result = await plugin.sendMessage(INSTANCE_ID, textMessage({ outboundPacing: 'immediate' }));

      expect(result.success).toBe(true);
      expect(humanDelay).not.toHaveBeenCalled();
      expect(simulateTyping).not.toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('no pacing metadata: media still runs humanDelay and simulateTyping (caption)', async () => {
      const { plugin, humanDelay, simulateTyping } = createPacingPlugin();

      await plugin.sendMessage(INSTANCE_ID, mediaMessage());

      expect(humanDelay).toHaveBeenCalledTimes(1);
      expect(simulateTyping).toHaveBeenCalledTimes(1);
      expect(simulateTyping.mock.calls[0]).toEqual([INSTANCE_ID, DM_JID, 'caption test']);
    });

    it('immediate: media skips both humanDelay and simulateTyping but still sends', async () => {
      const { plugin, sendMessage, humanDelay, simulateTyping } = createPacingPlugin();

      const result = await plugin.sendMessage(INSTANCE_ID, mediaMessage({ outboundPacing: 'immediate' }));

      expect(result.success).toBe(true);
      expect(humanDelay).not.toHaveBeenCalled();
      expect(simulateTyping).not.toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('no pacing metadata: reaction still runs humanDelay', async () => {
      const { plugin, humanDelay } = createPacingPlugin();

      const result = await plugin.sendMessage(INSTANCE_ID, reactionMessage());

      expect(result.success).toBe(true);
      expect(humanDelay).toHaveBeenCalledTimes(1);
    });

    it('immediate: reaction skips humanDelay but still sends', async () => {
      const { plugin, sendMessage, humanDelay, simulateTyping } = createPacingPlugin();

      const result = await plugin.sendMessage(INSTANCE_ID, reactionMessage({ outboundPacing: 'immediate' }));

      expect(result.success).toBe(true);
      expect(humanDelay).not.toHaveBeenCalled();
      expect(simulateTyping).not.toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    describe('an immediate send still counts as the last action for humanDelay', () => {
      const ENV_KEYS = ['WHATSAPP_HUMAN_DELAY_MIN_MS', 'WHATSAPP_HUMAN_DELAY_MAX_MS'] as const;
      const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

      afterEach(() => {
        jest.useRealTimers();
        for (const k of ENV_KEYS) {
          if (savedEnv[k] === undefined) Reflect.deleteProperty(process.env, k);
          else process.env[k] = savedEnv[k];
        }
      });

      /** Real humanDelay (fixed 1000ms window) on a fake clock; records the clock at each socket send. */
      function createSpacingPlugin() {
        process.env.WHATSAPP_HUMAN_DELAY_MIN_MS = '1000';
        process.env.WHATSAPP_HUMAN_DELAY_MAX_MS = '1000';
        jest.useFakeTimers();
        const plugin = new WhatsAppPlugin();
        const internals = plugin as unknown as PacingInternals;
        const sentAt: number[] = [];
        const sendMessage = mock(async () => {
          sentAt.push(Date.now());
          return { key: { id: `SPACED-${sentAt.length}` }, message: { conversation: 'x' } };
        });
        internals.sockets = new Map([
          [
            INSTANCE_ID,
            { sendMessage, sendPresenceUpdate: mock(async () => {}), user: { id: '5511999999999@s.whatsapp.net' } },
          ],
        ]);
        internals.eventBus = { publish: mock(async () => {}) };
        internals.logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };
        return { plugin, sentAt };
      }

      /** Drive the fake clock in 100ms steps until the send settles. */
      async function settle<T>(promise: Promise<T>): Promise<T> {
        let done = false;
        const tracked = promise.finally(() => {
          done = true;
        });
        for (let i = 0; i < 50 && !done; i++) {
          for (let j = 0; j < 20; j++) await Promise.resolve();
          if (!done) jest.advanceTimersByTime(100);
        }
        return tracked;
      }

      // Image without caption: preprocessOutgoing runs no typing simulation and no dynamic import.
      const imageNoCaption = (metadata: Record<string, unknown> = {}): OutgoingMessage => {
        const m = mediaMessage(metadata);
        return { ...m, content: { ...m.content, caption: undefined } };
      };

      it('immediate send, then humanized send: the humanized one waits the humanDelay window', async () => {
        const { plugin, sentAt } = createSpacingPlugin();

        await settle(plugin.sendMessage(INSTANCE_ID, imageNoCaption({ outboundPacing: 'immediate' })));
        await settle(plugin.sendMessage(INSTANCE_ID, imageNoCaption()));

        expect(sentAt).toHaveLength(2);
        expect((sentAt[1] ?? 0) - (sentAt[0] ?? 0)).toBeGreaterThanOrEqual(1000);
      });

      it('immediate reaction, then humanized send: the humanized one waits the humanDelay window', async () => {
        const { plugin, sentAt } = createSpacingPlugin();

        await settle(plugin.sendMessage(INSTANCE_ID, reactionMessage({ outboundPacing: 'immediate' })));
        await settle(plugin.sendMessage(INSTANCE_ID, imageNoCaption()));

        expect(sentAt).toHaveLength(2);
        expect((sentAt[1] ?? 0) - (sentAt[0] ?? 0)).toBeGreaterThanOrEqual(1000);
      });
    });
  });

  describe('inbound quotes and reaction targets (opt-in inboundReplyContext)', () => {
    const INSTANCE_ID = 'inbound-instance';
    const CHAT = '5511888888888@s.whatsapp.net';
    const OTHER = '5511888888888@s.whatsapp.net';

    function createPluginWithEventBus({ inboundReplyContext = true }: { inboundReplyContext?: boolean } = {}) {
      const plugin = new WhatsAppPlugin();
      if (inboundReplyContext) (plugin as any).inboundReplyContextInstances.add(INSTANCE_ID);
      const publish = mock(async (_type: string, _payload: unknown) => {});
      (plugin as any).sockets = new Map([[INSTANCE_ID, { user: { id: '5511999999999:3@s.whatsapp.net' } }]]);
      (plugin as any).eventBus = { publish };
      (plugin as any).logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };
      return { plugin, publish };
    }

    function published(publish: ReturnType<typeof mock>, type: string): Record<string, unknown> {
      const call = publish.mock.calls.find(([t]) => t === type);
      expect(call).toBeDefined();
      return call?.[1] as Record<string, unknown>;
    }

    const QUOTED_REPLY = {
      key: { id: 'REPLY-1', remoteJid: CHAT, fromMe: false },
      message: {
        extendedTextMessage: {
          text: 'reply',
          contextInfo: { stanzaId: 'QUOTED-1', participant: OTHER, quotedMessage: { conversation: 'original' } },
        },
      },
    };

    async function receiveQuotedReply(plugin: WhatsAppPlugin) {
      await plugin.handleMessageReceived(
        INSTANCE_ID,
        'REPLY-1',
        CHAT,
        '5511888888888',
        { type: 'text', text: 'reply' },
        'QUOTED-1',
        QUOTED_REPLY as any,
        false,
      );
    }

    function expectTodayQuoteFields(payload: Record<string, unknown>) {
      expect(payload.replyToId).toBe('QUOTED-1');
      expect((payload.rawPayload as Record<string, unknown>).quotedMessage).toEqual({
        stanzaId: 'QUOTED-1',
        participant: OTHER,
        type: 'text',
        conversation: 'original',
        pushName: undefined,
      });
    }

    it('flag off (default): an inbound reply has today replyToId and rawPayload.quotedMessage and no replyTo key', async () => {
      const { plugin, publish } = createPluginWithEventBus({ inboundReplyContext: false });

      await receiveQuotedReply(plugin);

      const payload = published(publish, 'message.received');
      expectTodayQuoteFields(payload);
      expect('replyTo' in payload).toBe(false);
    });

    it('flag on: an inbound reply also carries the typed replyTo', async () => {
      const { plugin, publish } = createPluginWithEventBus();

      await receiveQuotedReply(plugin);

      const payload = published(publish, 'message.received');
      expectTodayQuoteFields(payload);
      expect(payload.replyTo).toEqual({
        externalId: 'QUOTED-1',
        chatId: CHAT,
        participant: OTHER,
        fromMe: false,
        type: 'text',
        text: 'original',
      });
    });

    it('flag off: the payload equals the flag-on payload minus replyTo', async () => {
      const off = createPluginWithEventBus({ inboundReplyContext: false });
      const on = createPluginWithEventBus();
      await receiveQuotedReply(off.plugin);
      await receiveQuotedReply(on.plugin);

      const { replyTo: _typed, ...onWithoutReplyTo } = published(on.publish, 'message.received');
      const offPayload = published(off.publish, 'message.received');
      expect(Object.keys(offPayload).sort()).toEqual(Object.keys(onWithoutReplyTo).sort());
      expect(offPayload.replyToId).toBe(onWithoutReplyTo.replyToId);
      expect(offPayload.rawPayload).toEqual(onWithoutReplyTo.rawPayload);
    });

    it('flag off: a reaction through the socket handler emits no target key', async () => {
      const { plugin, publish } = createPluginWithEventBus({ inboundReplyContext: false });
      const listeners = new Map<string, (arg: unknown) => Promise<void>>();
      const sock = {
        ev: { on: (event: string, listener: (arg: unknown) => Promise<void>) => listeners.set(event, listener) },
        presenceSubscribe: mock(async () => {}),
        user: { id: '5511999999999:3@s.whatsapp.net' },
      };
      setupMessageHandlers(sock as any, plugin, INSTANCE_ID);

      await listeners.get('messages.reaction')?.([
        {
          key: { id: 'MSG-1', remoteJid: CHAT, fromMe: true },
          reaction: { key: { id: 'R-1', remoteJid: CHAT, fromMe: false }, text: '👍' },
        },
      ]);
      await listeners.get('messages.reaction')?.([
        {
          key: { id: 'MSG-1', remoteJid: CHAT, fromMe: true },
          reaction: { key: { id: 'R-2', remoteJid: CHAT, fromMe: false }, text: '' },
        },
      ]);

      const received = published(publish, 'reaction.received');
      const removed = published(publish, 'reaction.removed');
      expect('target' in received).toBe(false);
      expect('target' in removed).toBe(false);
      expect(received).toEqual({
        messageId: 'MSG-1',
        chatId: CHAT,
        from: '5511888888888',
        emoji: '👍',
        rawPayload: { externalId: 'R-1', isFromMe: false },
      });
    });

    it('no new input: a message without a quote has no replyTo key', async () => {
      const { plugin, publish } = createPluginWithEventBus();
      const msg = { key: { id: 'PLAIN-1', remoteJid: CHAT, fromMe: false }, message: { conversation: 'hi' } };

      await plugin.handleMessageReceived(
        INSTANCE_ID,
        'PLAIN-1',
        CHAT,
        '5511888888888',
        { type: 'text', text: 'hi' },
        undefined,
        msg as any,
        false,
      );

      const payload = published(publish, 'message.received');
      expect(payload).not.toHaveProperty('replyTo');
      expect(payload.replyToId).toBeUndefined();
      expect(payload.rawPayload).not.toHaveProperty('quotedMessage');
    });

    it('no new input: reaction events without a target carry no target key', async () => {
      const { plugin, publish } = createPluginWithEventBus();

      await plugin.handleReactionReceived(INSTANCE_ID, 'R-1', CHAT, '5511888888888', '👍', 'MSG-1', false);
      await plugin.handleReactionReceived(INSTANCE_ID, 'R-2', CHAT, '5511888888888', '', 'MSG-1', false);

      expect(published(publish, 'reaction.received')).toEqual({
        messageId: 'MSG-1',
        chatId: CHAT,
        from: '5511888888888',
        emoji: '👍',
        rawPayload: { externalId: 'R-1', isFromMe: false },
      });
      expect(published(publish, 'reaction.removed')).toEqual({
        messageId: 'MSG-1',
        chatId: CHAT,
        from: '5511888888888',
        emoji: '',
        rawPayload: { externalId: 'R-2', isFromMe: false },
      });
    });

    it('reaction.received and reaction.removed carry the supplied target', async () => {
      const { plugin, publish } = createPluginWithEventBus();
      const target = { fromMe: true, participant: '100000000000001@lid' };

      await plugin.handleReactionReceived(INSTANCE_ID, 'R-1', CHAT, '5511888888888', '✅', 'MSG-1', false, target);
      await plugin.handleReactionReceived(INSTANCE_ID, 'R-2', CHAT, '5511888888888', '', 'MSG-1', false, {
        fromMe: false,
      });

      const received = published(publish, 'reaction.received');
      expect(received.target).toEqual(target);
      expect(received.rawPayload).toEqual({ externalId: 'R-1', isFromMe: false });
      expect(published(publish, 'reaction.removed').target).toEqual({ fromMe: false });
    });
  });
});
