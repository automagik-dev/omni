import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

const INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const CHAT_JID = '5511999999999@s.whatsapp.net';
const STORED_REPLY_ID = 'STORED-QUOTED-ID';
const STORED_RAW_PAYLOAD = { key: { id: STORED_REPLY_ID, remoteJid: CHAT_JID, fromMe: false } };

type MountOptions = {
  tts?: { synthesize: ReturnType<typeof mock> };
};

function mountMessagesRoutes(
  sendMessage: ReturnType<typeof mock>,
  options: MountOptions = {},
): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel: 'whatsapp-baileys' })),
      },
      chats: {
        findByExternalIdSmart: mock(async () => ({ id: 'chat-row', externalId: CHAT_JID })),
      },
      messages: {
        getByExternalId: mock(async (_chatId: string, externalId: string) =>
          externalId === STORED_REPLY_ID
            ? { isFromMe: false, rawPayload: STORED_RAW_PAYLOAD, textContent: 'stored text' }
            : null,
        ),
      },
      ...(options.tts ? { tts: options.tts } : {}),
    } as never);
    // No sendTyping on the mock plugin: the TTS route skips the presence wait.
    c.set('channelRegistry', {
      get: mock(() => ({
        capabilities: { canSendMedia: true },
        sendMessage,
      })),
    } as never);
    c.set('apiKey', {
      id: 'test',
      name: 'test',
      scopes: ['*'],
      instanceIds: null,
      expiresAt: null,
    } as never);
    await next();
  });
  app.route('/messages', messagesRoutes);
  return app;
}

function okSend(messageId = 'MEDIA-MSG-ID') {
  return mock(async (_instanceId: string, _message: unknown) => ({ success: true, messageId, timestamp: 123 }));
}

type SentMessage = Record<string, unknown> & { metadata: Record<string, unknown> };

function sentMessage(sendMessage: ReturnType<typeof mock>): SentMessage {
  return sendMessage.mock.calls[0]?.[1] as SentMessage;
}

function post(app: Hono<{ Variables: AppVariables }>, path: string, body: Record<string, unknown>) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const voiceNoteBody = {
  instanceId: INSTANCE_ID,
  to: CHAT_JID,
  type: 'audio',
  base64: Buffer.from('ogg-opus-bytes').toString('base64'),
  filename: 'voice.ogg',
  voiceNote: true,
};

function ttsService() {
  return {
    synthesize: mock(async () => ({
      buffer: Buffer.from('tts-ogg'),
      mimeType: 'audio/ogg; codecs=opus',
      durationMs: 0,
      sizeKb: 1,
    })),
  };
}

describe('POST /messages/send/media', () => {
  test('infers MIME type from filename and forwards caption for persistence', async () => {
    const sendMessage = mock(async (_instanceId: string, _message: unknown) => ({
      success: true,
      messageId: 'MEDIA-MSG-ID',
      timestamp: 123,
    }));
    const app = mountMessagesRoutes(sendMessage);

    const res = await app.request('/messages/send/media', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instanceId: '11111111-1111-4111-8111-111111111111',
        to: '5511999999999@s.whatsapp.net',
        type: 'image',
        base64: Buffer.from('image-bytes').toString('base64'),
        filename: 'photo.png',
        caption: 'caption test',
      }),
    });

    expect(res.status).toBe(201);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[1]).toMatchObject({
      to: '5511999999999@s.whatsapp.net',
      content: {
        type: 'image',
        caption: 'caption test',
        filename: 'photo.png',
        mimeType: 'image/png',
      },
      metadata: {
        base64: Buffer.from('image-bytes').toString('base64'),
      },
    });
  });

  test('carries voice-note audio as BOTH base64 and audioBuffer so every channel can read it', async () => {
    const sendMessage = mock(async (_instanceId: string, _message: unknown) => ({
      success: true,
      messageId: 'VOICE-MSG-ID',
      timestamp: 123,
    }));
    const app = mountMessagesRoutes(sendMessage);
    const audio = Buffer.from('ogg-opus-bytes');

    const res = await app.request('/messages/send/media', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instanceId: '11111111-1111-4111-8111-111111111111',
        to: '5511999999999@s.whatsapp.net',
        type: 'audio',
        base64: audio.toString('base64'),
        filename: 'voice.ogg',
        voiceNote: true,
      }),
    });

    expect(res.status).toBe(201);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const message = sendMessage.mock.calls[0]?.[1] as { metadata?: Record<string, unknown> };
    expect(message).toMatchObject({
      content: {
        type: 'audio',
        filename: 'voice.ogg',
        mimeType: 'audio/ogg; codecs=opus',
      },
      metadata: {
        ptt: true,
      },
    });
    // Slack/Discord/Telegram plugins only read `metadata.base64`; dropping it
    // made voice notes fail there with 'Media URL or base64 required'.
    expect(message.metadata?.base64).toBe(audio.toString('base64'));
    // WhatsApp still gets the buffer it prefers (audioBuffer > base64 > URL).
    expect(Buffer.isBuffer(message.metadata?.audioBuffer)).toBe(true);
    expect((message.metadata?.audioBuffer as Buffer).equals(audio)).toBe(true);
  });

  describe('replyTo (additive)', () => {
    test('no new input: a media send without replyTo carries no replyTo and no reply metadata', async () => {
      const sendMessage = okSend();
      const app = mountMessagesRoutes(sendMessage);

      const res = await post(app, '/messages/send/media', voiceNoteBody);

      expect(res.status).toBe(201);
      const message = sentMessage(sendMessage);
      expect(Object.keys(message).sort()).toEqual(['content', 'metadata', 'threadId', 'to']);
      expect(Object.keys(message.metadata).sort()).toEqual(['audioBuffer', 'base64', 'ptt']);
    });

    test('a voice-note send with replyTo quotes the stored message (top-level replyTo + reply metadata)', async () => {
      const sendMessage = okSend();
      const app = mountMessagesRoutes(sendMessage);

      const res = await post(app, '/messages/send/media', { ...voiceNoteBody, replyTo: STORED_REPLY_ID });

      expect(res.status).toBe(201);
      const message = sentMessage(sendMessage);
      expect(message.replyTo).toBe(STORED_REPLY_ID);
      expect(message.metadata).toMatchObject({
        ptt: true,
        replyToFromMe: false,
        replyToRawPayload: STORED_RAW_PAYLOAD,
        replyToText: 'stored text',
      });
    });

    test('replyToKey is ignored when the replied-to row is stored', async () => {
      const sendMessage = okSend();
      const app = mountMessagesRoutes(sendMessage);

      await post(app, '/messages/send/media', {
        ...voiceNoteBody,
        replyTo: STORED_REPLY_ID,
        replyToKey: { fromMe: true, participant: '5511000000000@s.whatsapp.net' },
      });

      const { metadata } = sentMessage(sendMessage);
      expect(metadata.replyToFromMe).toBe(false);
      expect(metadata.replyToRawPayload).toEqual(STORED_RAW_PAYLOAD);
      expect(metadata).not.toHaveProperty('replyToParticipant');
    });

    test('replyToKey fills fromMe and participant only when the row is missing', async () => {
      const sendMessage = okSend();
      const app = mountMessagesRoutes(sendMessage);

      await post(app, '/messages/send/media', {
        ...voiceNoteBody,
        replyTo: 'NOT-STORED-YET',
        replyToKey: { fromMe: true, participant: '100000000000001@lid' },
      });

      const message = sentMessage(sendMessage);
      expect(message.replyTo).toBe('NOT-STORED-YET');
      expect(message.metadata.replyToFromMe).toBe(true);
      expect(message.metadata.replyToParticipant).toBe('100000000000001@lid');
      expect(message.metadata).not.toHaveProperty('replyToRawPayload');
    });
  });
});

describe('POST /messages/send/tts', () => {
  const ttsBody = { instanceId: INSTANCE_ID, to: CHAT_JID, text: 'hello there' };

  test('no new input: a TTS send without replyTo carries no replyTo and no reply metadata', async () => {
    const sendMessage = okSend('TTS-MSG-ID');
    const app = mountMessagesRoutes(sendMessage, { tts: ttsService() });

    const res = await post(app, '/messages/send/tts', ttsBody);

    expect(res.status).toBe(201);
    const message = sentMessage(sendMessage);
    expect(Object.keys(message).sort()).toEqual(['content', 'metadata', 'to']);
    expect(Object.keys(message.metadata).sort()).toEqual(['audioBuffer', 'base64', 'ptt']);
  });

  test('a TTS send with replyTo quotes the stored message', async () => {
    const sendMessage = okSend('TTS-MSG-ID');
    const app = mountMessagesRoutes(sendMessage, { tts: ttsService() });

    const res = await post(app, '/messages/send/tts', { ...ttsBody, replyTo: STORED_REPLY_ID });

    expect(res.status).toBe(201);
    const message = sentMessage(sendMessage);
    expect(message.replyTo).toBe(STORED_REPLY_ID);
    expect(message.metadata).toMatchObject({
      ptt: true,
      replyToFromMe: false,
      replyToRawPayload: STORED_RAW_PAYLOAD,
    });
  });

  test('a TTS send uses replyToKey when the replied-to row is missing', async () => {
    const sendMessage = okSend('TTS-MSG-ID');
    const app = mountMessagesRoutes(sendMessage, { tts: ttsService() });

    await post(app, '/messages/send/tts', { ...ttsBody, replyTo: 'NOT-STORED-YET', replyToKey: { fromMe: true } });

    const { metadata } = sentMessage(sendMessage);
    expect(metadata.replyToFromMe).toBe(true);
    expect(metadata).not.toHaveProperty('replyToParticipant');
  });
});
