/**
 * POST /messages/send — instance `messageFormatMode` threading (#894).
 *
 * Channel plugins read `metadata.messageFormatMode` and default to 'convert'
 * (markdown → channel syntax) when it is absent. The agent-responder and
 * agent-dispatcher paths resolve the mode from the instance row, but the
 * direct send route never did — so an instance configured with
 * `messageFormatMode: 'passthrough'` still had its text converted on direct
 * API sends ("*bold*" arriving as italic on WhatsApp Cloud).
 */

import { describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { messagesRoutes } from '../messages';

const INSTANCE_ID = '44444444-4444-4444-8444-444444444444';

function mountMessagesRoutes(
  instanceOverrides: Record<string, unknown> = {},
  ttsDurationMs = 20,
): {
  app: Hono<{ Variables: AppVariables }>;
  sendMessage: ReturnType<typeof mock>;
  sendTyping: ReturnType<typeof mock>;
  synthesize: ReturnType<typeof mock>;
} {
  const sendMessage = mock(async (_instanceId: string, _message: unknown) => ({
    success: true,
    messageId: 'SENT-MSG-ID',
    timestamp: 123,
  }));
  const sendTyping = mock(async (_instanceId: string, _chatId: string, _duration?: number) => {});
  const synthesize = mock(async () => ({
    buffer: Buffer.from('ogg-bytes'),
    mimeType: 'audio/ogg; codecs=opus',
    durationMs: ttsDurationMs,
    sizeKb: 1,
  }));

  const app = new Hono<{ Variables: AppVariables }>();
  // Same error mapping as the real app (OmniError FORBIDDEN -> 403).
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', {
      instances: {
        getById: mock(async (id: string) => ({ id, channel: 'whatsapp-business', ...instanceOverrides })),
      },
      persons: {
        getIdentityForChannel: mock(async () => null),
      },
      chats: {
        findByExternalIdSmart: mock(async () => null),
      },
      tts: { synthesize },
    } as never);
    c.set('channelRegistry', {
      get: mock(() => ({
        capabilities: { canSendText: true, canSendMedia: true, canSendReaction: true },
        sendMessage,
        sendTyping,
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
  return { app, sendMessage, sendTyping, synthesize };
}

async function postSend(app: Hono<{ Variables: AppVariables }>, body: Record<string, unknown> = {}) {
  return app.request('/messages/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: INSTANCE_ID, to: '5511999998888', text: '*bold*', ...body }),
  });
}

describe('POST /messages/send — messageFormatMode from the instance row', () => {
  test('threads passthrough into metadata so the plugin skips conversion', async () => {
    const { app, sendMessage } = mountMessagesRoutes({ messageFormatMode: 'passthrough' });

    const res = await postSend(app);

    expect(res.status).toBe(201);
    const [, message] = sendMessage.mock.calls[0] as [string, { metadata?: Record<string, unknown> }];
    expect(message.metadata?.messageFormatMode).toBe('passthrough');
  });

  test('threads an explicit convert mode too', async () => {
    const { app, sendMessage } = mountMessagesRoutes({ messageFormatMode: 'convert' });

    await postSend(app);

    const [, message] = sendMessage.mock.calls[0] as [string, { metadata?: Record<string, unknown> }];
    expect(message.metadata?.messageFormatMode).toBe('convert');
  });

  test('omits the key when the instance has no mode set (plugin defaults to convert)', async () => {
    const { app, sendMessage } = mountMessagesRoutes({ messageFormatMode: null });

    await postSend(app);

    const [, message] = sendMessage.mock.calls[0] as [string, { metadata?: Record<string, unknown> }];
    expect('messageFormatMode' in (message.metadata ?? {})).toBe(false);
  });

  test('still applies on interactive (buttons) bodies — same route, same metadata', async () => {
    const { app, sendMessage } = mountMessagesRoutes({ messageFormatMode: 'passthrough' });

    const res = await postSend(app, { buttons: [{ text: 'Yes', data: 'opt_yes' }] });

    expect(res.status).toBe(201);
    const [, message] = sendMessage.mock.calls[0] as [
      string,
      { content: { buttons?: unknown }; metadata?: Record<string, unknown> },
    ];
    expect(message.content.buttons).toEqual([{ text: 'Yes', data: 'opt_yes' }]);
    expect(message.metadata?.messageFormatMode).toBe('passthrough');
  });
});

type SentMessage = [string, { metadata?: Record<string, unknown> }];

async function postJson(app: Hono<{ Variables: AppVariables }>, path: string, body: Record<string, unknown>) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: INSTANCE_ID, to: '5511999998888', ...body }),
  });
}

describe('POST /messages/send — outboundPacing (request > instance > humanized)', () => {
  test("instance 'immediate' with no request field threads outboundPacing 'immediate'", async () => {
    const { app, sendMessage } = mountMessagesRoutes({ outboundPacing: 'immediate' });

    const res = await postSend(app);

    expect(res.status).toBe(201);
    const [, message] = sendMessage.mock.calls[0] as SentMessage;
    expect(message.metadata?.outboundPacing).toBe('immediate');
  });

  test("request 'humanized' over instance 'immediate' leaves the key absent", async () => {
    const { app, sendMessage } = mountMessagesRoutes({ outboundPacing: 'immediate' });

    await postSend(app, { pacing: 'humanized' });

    const [, message] = sendMessage.mock.calls[0] as SentMessage;
    expect('outboundPacing' in (message.metadata ?? {})).toBe(false);
  });

  test("request 'immediate' on a humanized instance without outboundPacingOverride is 403 and nothing is sent", async () => {
    const { app, sendMessage } = mountMessagesRoutes({ outboundPacing: 'humanized' });

    const res = await postSend(app, { pacing: 'immediate' });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('outboundPacingOverride');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("request 'immediate' on an instance with no pacing columns (pre-migration shape) is 403", async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postSend(app, { pacing: 'immediate' });

    expect(res.status).toBe(403);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("request 'immediate' on a humanized instance with outboundPacingOverride threads the key", async () => {
    const { app, sendMessage } = mountMessagesRoutes({ outboundPacing: 'humanized', outboundPacingOverride: true });

    const res = await postSend(app, { pacing: 'immediate' });

    expect(res.status).toBe(201);
    const [, message] = sendMessage.mock.calls[0] as SentMessage;
    expect(message.metadata?.outboundPacing).toBe('immediate');
  });

  test("request 'immediate' on an immediate instance is honoured without the override", async () => {
    const { app, sendMessage } = mountMessagesRoutes({ outboundPacing: 'immediate', outboundPacingOverride: false });

    const res = await postSend(app, { pacing: 'immediate' });

    expect(res.status).toBe(201);
    const [, message] = sendMessage.mock.calls[0] as SentMessage;
    expect(message.metadata?.outboundPacing).toBe('immediate');
  });

  test("request 'humanized' is honoured on an immediate instance, override or not", async () => {
    const { app, sendMessage } = mountMessagesRoutes({ outboundPacing: 'immediate', outboundPacingOverride: true });

    const res = await postSend(app, { pacing: 'humanized' });

    expect(res.status).toBe(201);
    const [, message] = sendMessage.mock.calls[0] as SentMessage;
    expect('outboundPacing' in (message.metadata ?? {})).toBe(false);
  });

  test('outboundPacingOverride alone (no request field) keeps the humanized instance humanized', async () => {
    const { app, sendMessage } = mountMessagesRoutes({ outboundPacing: 'humanized', outboundPacingOverride: true });

    await postSend(app);

    const [, message] = sendMessage.mock.calls[0] as SentMessage;
    expect(message.metadata).toEqual({});
  });

  test('neither set: metadata keeps its previous shape (no outboundPacing key)', async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    await postSend(app);

    const [, message] = sendMessage.mock.calls[0] as SentMessage;
    expect(message.metadata).toEqual({});
  });

  test('rejects an unknown pacing value', async () => {
    const { app, sendMessage } = mountMessagesRoutes();

    const res = await postSend(app, { pacing: 'turbo' });

    expect(res.status).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('POST /messages/send/media and /send/reaction — outboundPacing', () => {
  test('media (voice note): instance immediate threads the key; humanized keeps the old shape', async () => {
    const base64 = Buffer.from('voice').toString('base64');
    const immediate = mountMessagesRoutes({ outboundPacing: 'immediate' });
    await postJson(immediate.app, '/messages/send/media', { type: 'audio', base64, voiceNote: true });
    const [, paced] = immediate.sendMessage.mock.calls[0] as SentMessage;
    expect(paced.metadata?.outboundPacing).toBe('immediate');
    expect(paced.metadata?.ptt).toBe(true);

    const humanized = mountMessagesRoutes();
    await postJson(humanized.app, '/messages/send/media', { type: 'image', base64 });
    const [, plain] = humanized.sendMessage.mock.calls[0] as SentMessage;
    expect(plain.metadata).toEqual({ base64, ptt: undefined });
  });

  test("media: request 'humanized' overrides an immediate instance", async () => {
    const { app, sendMessage } = mountMessagesRoutes({ outboundPacing: 'immediate' });

    await postJson(app, '/messages/send/media', {
      type: 'image',
      base64: Buffer.from('img').toString('base64'),
      pacing: 'humanized',
    });

    const [, message] = sendMessage.mock.calls[0] as SentMessage;
    expect('outboundPacing' in (message.metadata ?? {})).toBe(false);
  });

  test("media and reaction: request 'immediate' on a humanized instance without the override is 403", async () => {
    const media = mountMessagesRoutes();
    const mediaRes = await postJson(media.app, '/messages/send/media', {
      type: 'image',
      base64: Buffer.from('img').toString('base64'),
      pacing: 'immediate',
    });
    expect(mediaRes.status).toBe(403);
    expect(media.sendMessage).not.toHaveBeenCalled();

    const reaction = mountMessagesRoutes();
    const reactionRes = await postJson(reaction.app, '/messages/send/reaction', {
      messageId: '3EB0REACTTARGET',
      emoji: '👍',
      pacing: 'immediate',
    });
    expect(reactionRes.status).toBe(403);
    expect(reaction.sendMessage).not.toHaveBeenCalled();
  });

  test('reaction: immediate adds the key, humanized passes the target metadata through unchanged', async () => {
    const immediate = mountMessagesRoutes({ outboundPacingOverride: true });
    await postJson(immediate.app, '/messages/send/reaction', {
      messageId: '3EB0REACTTARGET',
      emoji: '👍',
      pacing: 'immediate',
    });
    const [, paced] = immediate.sendMessage.mock.calls[0] as SentMessage;
    expect(paced.metadata).toEqual({ outboundPacing: 'immediate' });

    const humanized = mountMessagesRoutes();
    await postJson(humanized.app, '/messages/send/reaction', { messageId: '3EB0REACTTARGET', emoji: '👍' });
    const [, plain] = humanized.sendMessage.mock.calls[0] as SentMessage;
    expect(plain.metadata).toEqual({});
  });
});

describe('POST /messages/send/tts — presence wait under outboundPacing', () => {
  test('immediate with no presenceDelay: presence duration (and wait) is 0', async () => {
    const { app, sendMessage, sendTyping } = mountMessagesRoutes({ outboundPacing: 'immediate' }, 20);

    const res = await postJson(app, '/messages/send/tts', { text: 'oi' });

    expect(res.status).toBe(201);
    expect(sendTyping.mock.calls[0]).toEqual([INSTANCE_ID, '5511999998888', 0]);
    const [, message] = sendMessage.mock.calls[0] as SentMessage;
    expect(message.metadata?.outboundPacing).toBe('immediate');
  });

  test('humanized with no presenceDelay: presence duration matches the audio length', async () => {
    const { app, sendMessage, sendTyping } = mountMessagesRoutes({}, 20);

    const res = await postJson(app, '/messages/send/tts', { text: 'oi' });

    expect(res.status).toBe(201);
    expect(sendTyping.mock.calls[0]).toEqual([INSTANCE_ID, '5511999998888', 20]);
    const [, message] = sendMessage.mock.calls[0] as SentMessage;
    expect('outboundPacing' in (message.metadata ?? {})).toBe(false);
  });

  test("request 'immediate' on a humanized instance without the override is 403 before any synthesis", async () => {
    const { app, sendMessage, sendTyping, synthesize } = mountMessagesRoutes({}, 20);

    const res = await postJson(app, '/messages/send/tts', { text: 'oi', pacing: 'immediate' });

    expect(res.status).toBe(403);
    expect(synthesize).not.toHaveBeenCalled();
    expect(sendTyping).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test('immediate keeps an explicit presenceDelay', async () => {
    const { app, sendTyping } = mountMessagesRoutes({ outboundPacingOverride: true }, 20);

    await postJson(app, '/messages/send/tts', { text: 'oi', pacing: 'immediate', presenceDelay: 15 });

    expect(sendTyping.mock.calls[0]).toEqual([INSTANCE_ID, '5511999998888', 15]);
  });
});
