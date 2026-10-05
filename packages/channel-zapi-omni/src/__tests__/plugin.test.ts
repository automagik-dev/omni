import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import type { PluginContext } from '@omni/channel-sdk';
import { ZapiOmniPlugin } from '../index';
const omni = {
  driver: 'omni' as const,
  channelId: 'vendor-channel',
  secretKey: 'secret-key-1234567890',
  signingSecret: 'signing-secret-1234567890',
};
const omniInbound = {
  messageEventType: 'NEW_MESSAGE',
  message: {
    _id: 'omni-1',
    channel_id: omni.channelId,
    created: 1780000000000,
    metadata: { from_me: false },
    sender: { identifier: '5511999999999' },
    recipient: { identifier: '5511888888888' },
    contents: [{ type: 'TEXT', message: 'Olá' }],
    attachments: [],
  },
};
const ok = (body: unknown) => Response.json(body);
let fetchMock: ReturnType<typeof spyOn>;
beforeEach(() => {
  fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async () => ok({})) as unknown as typeof fetch);
});
afterEach(() => fetchMock.mockRestore());
function signed(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const key = 'message.event:0:123';
  const signature = createHmac('sha256', omni.signingSecret)
    .update(`${timestamp}\nmessage.event\n0\n123\n${body}`)
    .digest('hex');
  return new Headers({ 'x-idempotency-key': key, 'x-webhook-signature': `t=${timestamp},v1=${signature}` });
}
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
describe('Z-API official lifecycle', () => {
  test('official plugin verifies signed bodies, rejects a different channel and deduplicates redelivery', async () => {
    fetchMock.mockImplementation(async () =>
      ok({ id: omni.channelId, type: 'META_WHATSAPP', whatsappConnected: true }),
    );
    const h = harness();
    const plugin = new ZapiOmniPlugin();
    await plugin.initialize(h.context);
    await plugin.connect('local', { instanceId: 'local', credentials: {}, options: { zapiConfig: omni } });
    const request = (payload: unknown, sign = true) => {
      const raw = JSON.stringify(payload);
      return new Request('https://example.com/api/v2/channels/zapi-omni/local/webhook', {
        method: 'POST',
        body: raw,
        headers: sign ? signed(raw) : {},
      });
    };
    expect((await plugin.handleWebhook(request(omniInbound, false))).status).toBe(401);
    expect(
      (
        await plugin.handleWebhook(
          request({ ...omniInbound, message: { ...omniInbound.message, channel_id: 'other' } }),
        )
      ).status,
    ).toBe(400);
    expect((await plugin.handleWebhook(request(omniInbound))).status).toBe(200);
    expect((await plugin.handleWebhook(request(omniInbound))).status).toBe(200);
    expect(h.published.filter((e) => e.type === 'message.received')).toHaveLength(1);
    expect(plugin.capabilities.canSendTemplate).toBe(true);
    await plugin.destroy();
  });
});
