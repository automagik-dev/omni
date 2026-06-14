import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

function mountMessagesRoutes(sendMessage: ReturnType<typeof mock>): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel: 'whatsapp-baileys' })),
      },
    } as never);
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

  test('forwards WhatsApp voice-note audio as audioBuffer instead of base64', async () => {
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
    expect(message.metadata?.base64).toBeUndefined();
    expect(Buffer.isBuffer(message.metadata?.audioBuffer)).toBe(true);
    expect((message.metadata?.audioBuffer as Buffer).equals(audio)).toBe(true);
  });
});
