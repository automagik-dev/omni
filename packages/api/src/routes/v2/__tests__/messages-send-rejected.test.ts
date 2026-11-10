import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

const INSTANCE_ID = '88888888-8888-4888-8888-888888888888';
const CHAT_ID = '99999999-9999-4999-8999-999999999999';

type PluginResult = Record<string, unknown>;

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

function mountSendRoutes(result: PluginResult) {
  const sendMessage = mock(async (_instanceId: string, _message: unknown) => result);

  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: { getById: mock(async (id: string) => ({ id, channel: 'zenvia', agentId: null })) },
      persons: { getIdentityForChannel: mock(async () => null) },
      chats: { findByExternalIdSmart: mock(async () => ({ id: CHAT_ID })) },
      messages: {
        getByExternalId: mock(async () => ({ externalId: 'EXT-1', isFromMe: false, rawPayload: { key: {} } })),
      },
      tts: {
        synthesize: mock(async () => ({ buffer: Buffer.from('ogg'), mimeType: 'audio/ogg', durationMs: 0, sizeKb: 1 })),
      },
    } as never);
    c.set('channelRegistry', {
      get: mock(() => ({
        capabilities: {
          canSendText: true,
          canSendMedia: true,
          canSendReaction: true,
          canSendSticker: true,
          canSendContact: true,
          canSendLocation: true,
          canForwardMessage: true,
          canSendEmbed: true,
        },
        sendMessage,
      })),
    } as never);
    c.set('apiKey', { id: 'test', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null } as never);
    await next();
  });
  app.route('/messages', messagesRoutes);
  return { app, sendMessage };
}

function postJson(app: Hono<{ Variables: AppVariables }>, path: string, body: Record<string, unknown>) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const base = { instanceId: INSTANCE_ID, to: '5511999998888' };

const sendRoutes: Array<{ path: string; body: Record<string, unknown> }> = [
  { path: '/messages/send', body: { ...base, text: 'hello' } },
  { path: '/messages/send/media', body: { ...base, type: 'image', url: 'https://example.com/photo.jpg' } },
  { path: '/messages/send/reaction', body: { ...base, messageId: 'EXT-1', emoji: '👍' } },
  { path: '/messages/send/sticker', body: { ...base, url: 'https://example.com/sticker.webp' } },
  { path: '/messages/send/contact', body: { ...base, contact: { name: 'Ada Lovelace' } } },
  { path: '/messages/send/location', body: { ...base, latitude: -23.55, longitude: -46.63 } },
  { path: '/messages/send/tts', body: { ...base, text: 'hello' } },
  { path: '/messages/send/forward', body: { ...base, messageId: 'EXT-1', fromChatId: '5511888887777' } },
  { path: '/messages/send/embed', body: { ...base, title: 'Title', description: 'Body' } },
];

const rejectedResult = {
  success: false,
  error: 'refused for good',
  errorCode: 'ZENVIA_INVALID_REQUEST',
  retryable: false,
  rejected: true,
  timestamp: 1,
};

describe('send routes answer a definitive channel refusal as 422 CHANNEL_SEND_REJECTED', () => {
  for (const { path, body } of sendRoutes) {
    test(`${path} maps rejected to 422 with recoverable details`, async () => {
      const { app, sendMessage } = mountSendRoutes(rejectedResult);

      const res = await postJson(app, path, body);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(422);
      const parsed = (await res.json()) as ErrorBody;
      expect(parsed.error.code).toBe('CHANNEL_SEND_REJECTED');
      expect(parsed.error.message).toBe('refused for good');
      expect(parsed.error.details).toMatchObject({
        channelType: 'zenvia',
        instanceId: INSTANCE_ID,
        errorCode: 'ZENVIA_INVALID_REQUEST',
        retryable: false,
      });
    });

    test(`${path} keeps an unflagged failure at 502 CHANNEL_SEND_FAILED`, async () => {
      const { app } = mountSendRoutes({ success: false, error: 'upstream timeout', retryable: true, timestamp: 1 });

      const res = await postJson(app, path, body);

      expect(res.status).toBe(502);
      const parsed = (await res.json()) as ErrorBody;
      expect(parsed.error.code).toBe('CHANNEL_SEND_FAILED');
      expect(parsed.error.details).toMatchObject({ retryable: true });
    });
  }

  test('a rejected result that also claims retryable is reported as not retryable', async () => {
    const { app } = mountSendRoutes({ ...rejectedResult, retryable: true });

    const res = await postJson(app, '/messages/send', { ...base, text: 'hello' });

    expect(res.status).toBe(422);
    const parsed = (await res.json()) as ErrorBody;
    expect(parsed.error.code).toBe('CHANNEL_SEND_REJECTED');
    expect(parsed.error.details?.retryable).toBe(false);
  });

  test('/messages/send/media keeps the media type in the error details', async () => {
    for (const result of [rejectedResult, { success: false, error: 'upstream timeout', timestamp: 1 }]) {
      const { app } = mountSendRoutes(result);

      const res = await postJson(app, '/messages/send/media', {
        ...base,
        type: 'image',
        url: 'https://example.com/photo.jpg',
      });

      expect(((await res.json()) as ErrorBody).error.details).toMatchObject({ mediaType: 'image' });
    }
  });

  test('a failure without a channel message falls back to the operation name', async () => {
    const { app } = mountSendRoutes({ success: false, timestamp: 1 });

    const res = await postJson(app, '/messages/send/tts', { ...base, text: 'hello' });

    expect(((await res.json()) as ErrorBody).error.message).toBe('Failed to send TTS voice note');
  });
});
