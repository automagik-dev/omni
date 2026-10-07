import { afterAll, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import type { AppVariables } from '../../../types';
import { decodeZapiUpload, messagesRoutes } from '../messages';

function mountMessagesRoutes(
  sendMessage: ReturnType<typeof mock>,
  channel = 'whatsapp-baileys',
): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  app.use('*', async (c, next) => {
    c.set('db', {} as never);
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel })),
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
        replyTo: 'quoted-message',
      }),
    });

    expect(res.status).toBe(201);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[1]).toMatchObject({
      to: '5511999999999@s.whatsapp.net',
      replyTo: 'quoted-message',
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
});

const mediaDirectory = mkdtempSync(join(tmpdir(), 'omni-zapi-upload-'));
const previousMediaPath = process.env.MEDIA_STORAGE_PATH;
afterAll(() => {
  rmSync(mediaDirectory, { recursive: true, force: true });
  if (previousMediaPath === undefined) Reflect.deleteProperty(process.env, 'MEDIA_STORAGE_PATH');
  else process.env.MEDIA_STORAGE_PATH = previousMediaPath;
});
test('Z-API upload stores bytes and forwards the persistent reference before sending', async () => {
  process.env.MEDIA_STORAGE_PATH = mediaDirectory;
  const bytes = Buffer.from('uploaded-image');
  const sendMessage = mock(async (_id: string, message: { content: { localPath: string } }) => {
    expect(readFileSync(join(mediaDirectory, message.content.localPath))).toEqual(bytes);
    return { success: true, messageId: 'stored-image', timestamp: 123 };
  });
  const app = mountMessagesRoutes(sendMessage, 'zapi-web');
  const response = await app.request('/messages/send/media', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      instanceId: '11111111-1111-4111-8111-111111111111',
      to: '5511999999999',
      type: 'image',
      base64: bytes.toString('base64'),
      mimeType: 'image/png',
    }),
  });
  expect(response.status).toBe(201);
  expect(sendMessage).toHaveBeenCalledTimes(1);
});
test('Z-API upload rejects invalid/noncanonical encoding and oversized media', () => {
  for (const encoded of ['', 'invalid!', 'Zh==', Buffer.alloc(16 * 1024 * 1024 + 1).toString('base64')]) {
    expect(() => decodeZapiUpload(encoded)).toThrow('Invalid media encoding or size');
  }
});

test('rejected Z-API uploads are removed while unknown sends retain reconciliation bytes', async () => {
  process.env.MEDIA_STORAGE_PATH = mediaDirectory;
  for (const code of ['ZAPI_HTTP_400', 'ZAPI_DELIVERY_UNKNOWN']) {
    let reference = '';
    const sendMessage = mock(async (_id: string, message: { content: { localPath: string } }) => {
      reference = message.content.localPath;
      return { success: false, error: code, errorCode: code, retryable: false, timestamp: 123 };
    });
    const app = mountMessagesRoutes(sendMessage, 'zapi-web');
    const response = await app.request('/messages/send/media', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instanceId: '11111111-1111-4111-8111-111111111111',
        to: '5511999999999',
        type: 'image',
        base64: Buffer.from('bytes').toString('base64'),
        mimeType: 'image/png',
      }),
    });
    expect(response.status).toBe(500);
    expect(reference).not.toBe('');
    expect(existsSync(join(mediaDirectory, reference))).toBe(code === 'ZAPI_DELIVERY_UNKNOWN');
  }
});
