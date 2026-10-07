import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { PluginContext } from '@omni/channel-sdk';
import { EvolutionConfigSchema } from '@omni/core';
import { EvolutionClient, canonicalJid } from '../client';
import { EvolutionPlugin } from '../plugin';
import { normalizeEvolution } from '../webhook';

const config = {
  baseUrl: 'https://evolution.example.com',
  instanceName: 'vendor',
  apiKey: 'instance-key-123456789',
  webhookToken: 'independent-webhook-token-123456789012345',
};
const inbound = {
  event: 'messages.upsert',
  instance: 'vendor',
  apikey: 'must-not-persist',
  data: {
    key: { id: 'in-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
    message: { conversation: 'Olá' },
    messageTimestamp: 1780000000,
    pushName: 'Contato',
  },
};
let fetchMock: ReturnType<typeof spyOn>;
let oldOrigins: string | undefined;
beforeEach(() => {
  oldOrigins = process.env.OMNI_EVOLUTION_ALLOWED_ORIGINS;
  process.env.OMNI_EVOLUTION_ALLOWED_ORIGINS = config.baseUrl;
  fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async () =>
    Response.json({
      key: { id: 'sent-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: true },
    })) as unknown as typeof fetch);
});
afterEach(() => {
  fetchMock.mockRestore();
  if (oldOrigins === undefined) Reflect.deleteProperty(process.env, 'OMNI_EVOLUTION_ALLOWED_ORIGINS');
  else process.env.OMNI_EVOLUTION_ALLOWED_ORIGINS = oldOrigins;
});

function harness() {
  const published: Array<{ type: string; payload: unknown }> = [];
  const keys = new Map<string, string>();
  const stored = new Map<string, unknown>();
  const context = {
    eventBus: {
      publish: async (type: string, payload: unknown) => {
        published.push({ type, payload });
        return { id: 'evt', sequence: 1, stream: 'test' };
      },
    },
    logger: {
      info() {},
      debug() {},
      warn() {},
      error() {},
      child() {
        return this;
      },
    },
    storage: {
      get: async (k: string) => stored.get(k) ?? null,
      set: async (k: string, v: unknown) => {
        stored.set(k, v);
      },
    },
    config: {
      env: 'development',
      apiBaseUrl: 'https://example.com',
      webhookBaseUrl: 'https://example.com',
      mediaStorage: { type: 'local', basePath: '/test' },
    },
    db: { execute: async () => [], getDrizzle: () => null },
    ingressClaim: {
      claim: async (p: { idempotencyKey: string }) => {
        if (keys.has(p.idempotencyKey)) return null;
        const id = crypto.randomUUID();
        keys.set(p.idempotencyKey, id);
        return id;
      },
      release: async (id: string) => {
        for (const [k, v] of keys) if (v === id) keys.delete(k);
      },
    },
  } as unknown as PluginContext;
  return { context, published };
}
const req = (body: unknown, token = config.webhookToken) =>
  new Request('https://omni.example/api/v2/channels/evolution-api/local/webhook', {
    method: 'POST',
    headers: { 'x-webhook-token': token },
    body: JSON.stringify(body),
  });
async function connected() {
  fetchMock.mockResolvedValue(Response.json({ instance: { instanceName: 'vendor', state: 'open' } }));
  const h = harness();
  const plugin = new EvolutionPlugin();
  await plugin.initialize(h.context);
  await plugin.connect('local', { instanceId: 'local', credentials: {}, options: { evolutionConfig: config } });
  return { plugin, ...h };
}
describe('Evolution API transport contract', () => {
  test('text endpoint, API key, encoded instance and canonical routing', async () => {
    const sent = await new EvolutionClient({ ...config, instanceName: 'name/with spaces' }).send({
      to: '+5511999999999',
      content: { type: 'text', text: 'Olá' },
    });
    expect(sent.messageId).toBe('sent-1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://evolution.example.com/message/sendText/name%2Fwith%20spaces');
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>).apikey).toBe(config.apiKey);
    expect(JSON.parse(init.body as string)).toEqual({ number: '5511999999999', text: 'Olá' });
  });
  test('rejects unapproved origins and invalid configuration before any network', () => {
    for (const baseUrl of [
      'http://evolution.example.com',
      'https://user:secret@evolution.example.com',
      'https://evolution.example.com/path',
      'https://evil.example.com',
      'https://evolution.example.com?token=secret',
    ])
      expect(() => new EvolutionClient({ ...config, baseUrl })).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(EvolutionConfigSchema.safeParse({ ...config, webhookToken: 'short' }).success).toBe(false);
  });
  test('preserves LID and group identities and rejects unsupported send content', async () => {
    expect(canonicalJid('123456789@lid')).toBe('123456789@lid');
    expect(canonicalJid('120363001-1@g.us')).toBe('120363001-1@g.us');
    expect(canonicalJid('5511999999999:2@s.whatsapp.net')).toBe('5511999999999@s.whatsapp.net');
    const client = new EvolutionClient(config);
    await expect(client.send({ to: 'abc', content: { type: 'text', text: 'Hello' } })).rejects.toThrow();
    await expect(
      client.send({ to: '5511999999999', replyTo: 'old', content: { type: 'text', text: 'Hello' } }),
    ).rejects.toThrow('not implemented');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('media uses vendor media endpoint and preserves document name', async () => {
    await new EvolutionClient(config).send({
      to: '5511999999999',
      content: {
        type: 'document',
        mediaUrl: 'https://files.example.com/test.pdf',
        filename: 'test.pdf',
        mimeType: 'application/pdf',
        caption: 'Arquivo',
      },
    });
    expect(fetchMock.mock.calls[0][0]).toEndWith('/message/sendMedia/vendor');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      mediatype: 'document',
      fileName: 'test.pdf',
      media: 'https://files.example.com/test.pdf',
      caption: 'Arquivo',
    });
  });
  test('status verifies configured instance identity', async () => {
    fetchMock.mockResolvedValue(Response.json({ instance: { instanceName: 'other', state: 'open' } }));
    await expect(new EvolutionClient(config).status()).rejects.toThrow('another instance');
  });
  test('ambiguous send outcome and HTTP 500 cannot invite duplicate sends', async () => {
    const h = await connected();
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect(
      await h.plugin.sendMessage('local', { to: '5511999999999', content: { type: 'text', text: 'Hello' } }),
    ).toMatchObject({ success: false, error: 'EVOLUTION_DELIVERY_UNKNOWN', retryable: false });
    fetchMock.mockResolvedValueOnce(new Response('error', { status: 500 }));
    expect(
      await h.plugin.sendMessage('local', { to: '5511999999999', content: { type: 'text', text: 'Hello' } }),
    ).toMatchObject({ retryable: false });
    fetchMock.mockResolvedValueOnce(
      Response.json({ key: { id: 'sent-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: true } }),
    );
    const pub = spyOn(h.context.eventBus, 'publish').mockRejectedValueOnce(new Error('journal down'));
    expect(
      await h.plugin.sendMessage('local', { to: '5511999999999', content: { type: 'text', text: 'Hello' } }),
    ).toMatchObject({ success: false, error: 'EVOLUTION_DELIVERY_UNKNOWN', retryable: false });
    pub.mockRestore();
    await h.plugin.destroy();
  });
});
describe('Evolution webhook lifecycle', () => {
  test('independent token, instance matching, bounded body and retry-safe ingress', async () => {
    const h = await connected();
    expect((await h.plugin.handleWebhook(req(inbound, config.apiKey))).status).toBe(401);
    expect((await h.plugin.handleWebhook(req({ ...inbound, instance: 'other' }))).status).toBe(400);
    expect((await h.plugin.handleWebhook(req({ ...inbound, extra: 'x'.repeat(3 * 1024 * 1024) }))).status).toBe(413);
    const pub = spyOn(h.context.eventBus, 'publish').mockRejectedValueOnce(new Error('offline'));
    expect((await h.plugin.handleWebhook(req(inbound))).status).toBe(503);
    pub.mockRestore();
    expect((await h.plugin.handleWebhook(req(inbound))).status).toBe(200);
    expect((await h.plugin.handleWebhook(req(inbound))).status).toBe(200);
    expect(h.published.filter((e) => e.type === 'message.received')).toHaveLength(1);
    expect(JSON.stringify(h.published)).not.toContain('must-not-persist');
    await h.plugin.disconnect('local');
    expect((await h.plugin.handleWebhook(req(inbound))).status).toBe(404);
    await h.plugin.destroy();
    expect(
      fetchMock.mock.calls.every(
        (call: unknown[]) => !String(call[0]).includes('logout') && !String(call[0]).includes('delete'),
      ),
    ).toBe(true);
  });
  test('own-message echo is sent, not received; historical messages do not trigger realtime agents', () => {
    expect(
      normalizeEvolution(
        { ...inbound, data: { ...inbound.data, key: { ...inbound.data.key, fromMe: true } } },
        'vendor',
      )[0],
    ).toMatchObject({ type: 'message', fromMe: true });
    expect(normalizeEvolution({ ...inbound, event: 'messages.set' }, 'vendor')).toEqual([]);
  });
  test('real receipt shape maps recipient delivery/read, ignores server acceptance', () => {
    for (const [status, expected] of [
      ['DELIVERY_ACK', 'delivered'],
      ['READ', 'read'],
      ['PLAYED', 'read'],
      ['ERROR', 'failed'],
    ]) {
      expect(
        normalizeEvolution(
          {
            event: 'messages.update',
            instance: 'vendor',
            data: { keyId: 'one', remoteJid: '5511999999999@s.whatsapp.net', fromMe: true, status },
          },
          'vendor',
        )[0],
      ).toMatchObject({ type: 'receipt', status: expected, id: 'one' });
    }
    expect(
      normalizeEvolution(
        {
          event: 'messages.update',
          instance: 'vendor',
          data: { keyId: 'one', remoteJid: '5511999999999@s.whatsapp.net', fromMe: true, status: 'SERVER_ACK' },
        },
        'vendor',
      ),
    ).toEqual([]);
  });
  test('group participant and LID stay distinct; encrypted media URL is never exposed', () => {
    const event = normalizeEvolution(
      {
        ...inbound,
        data: {
          ...inbound.data,
          key: { ...inbound.data.key, remoteJid: '120363001@g.us', participant: '123456789@lid' },
          message: {
            imageMessage: { url: 'https://mmg.whatsapp.net/encrypted', caption: 'Foto', mimetype: 'image/jpeg' },
          },
        },
      },
      'vendor',
    )[0];
    expect(event).toMatchObject({
      chatId: '120363001@g.us',
      from: '123456789@lid',
      content: { type: 'image', text: 'Foto', mediaUrl: undefined },
    });
  });
  test('QR and connection webhooks update local status', async () => {
    const h = await connected();
    expect(
      (
        await h.plugin.handleWebhook(
          req({
            event: 'qrcode.updated',
            instance: 'vendor',
            data: { qrcode: { instance: 'vendor', code: 'qr-content' } },
          }),
        )
      ).status,
    ).toBe(200);
    expect((await h.plugin.getStatus('local')).state).toBe('qr');
    expect(
      (
        await h.plugin.handleWebhook(
          req({
            event: 'connection.update',
            instance: 'vendor',
            data: { state: 'open', wuid: '5511999999999@s.whatsapp.net' },
          }),
        )
      ).status,
    ).toBe(200);
    expect((await h.plugin.getStatus('local')).state).toBe('connected');
    expect(
      (await h.plugin.handleWebhook(req({ event: 'connection.update', instance: 'vendor', data: { state: 'close' } })))
        .status,
    ).toBe(200);
    expect((await h.plugin.getStatus('local')).state).toBe('disconnected');
    await h.plugin.destroy();
  });
});

test('GET failures can retry while POST 5xx and invalid accepted responses remain unknown', async () => {
  const client = new EvolutionClient(config);
  fetchMock.mockImplementation(async () => new Response('error', { status: 503 }));
  await expect(client.request('instance/connectionState')).rejects.toMatchObject({ retryable: true });
  await expect(client.send({ to: '5511999999999', content: { type: 'text', text: 'Hello' } })).rejects.toMatchObject({
    channelCode: 'EVOLUTION_DELIVERY_UNKNOWN',
    retryable: false,
  });
  for (const response of [
    new Response('invalid'),
    Response.json({ key: { id: 'accepted', remoteJid: 'unsupported@broadcast', fromMe: true } }),
  ]) {
    fetchMock.mockImplementation(async () => response);
    await expect(client.send({ to: '5511999999999', content: { type: 'text', text: 'Hello' } })).rejects.toMatchObject({
      channelCode: 'EVOLUTION_DELIVERY_UNKNOWN',
      retryable: false,
    });
  }
});
test('malformed batch siblings cannot discard valid messages or bypass instance binding', () => {
  const invalid: number[] = [];
  expect(
    normalizeEvolution(
      { ...inbound, data: [{ ...inbound.data, key: { ...inbound.data.key, remoteJid: 'bad' } }, inbound.data] },
      'vendor',
      (index) => invalid.push(index),
    ),
  ).toHaveLength(1);
  expect(invalid).toEqual([0]);
  expect(() => normalizeEvolution({ ...inbound, instance: 'other', data: [inbound.data] }, 'vendor')).toThrow();
});
