/**
 * The HTTP surface of the inbound route.
 */

import { afterEach, describe, expect, it } from 'bun:test';

import { AscFlowPlugin } from '../plugin';
import { MockEventBus, connectPlugin, createContext, instanceId, stubPlatform } from './helpers';

let plugin: AscFlowPlugin;
let eventBus: MockEventBus;
let restore: () => void;

const url = (suffix = '') => `http://localhost/api/v2/channels/asc-flow/${instanceId}/webhook${suffix}`;

async function boot(extraCredentials: Record<string, unknown> = {}): Promise<void> {
  const stub = stubPlatform();
  restore = stub.restore;
  eventBus = new MockEventBus();
  plugin = new AscFlowPlugin();
  await plugin.initialize(createContext(eventBus));
  await connectPlugin(plugin, extraCredentials);
}

const post = (body: unknown, suffix = '', headers: Record<string, string> = {}) =>
  plugin.handleWebhook(
    new Request(url(suffix), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

const received = () => eventBus.published.filter((e) => e.type.includes('received'));

/** The agent answering: this is what resumes the flow and closes the turn. */
const answerTurn = (cod: string) =>
  plugin.sendMessage(instanceId, { to: cod, content: { type: 'text', text: 'resposta' } as never });

afterEach(async () => {
  await plugin?.destroy();
  restore?.();
});

describe('handleWebhook', () => {
  it('accepts a turn and publishes it', async () => {
    await boot();
    const response = await post({ codAtendimento: '42', chatInput: 'oi', phone: '5551999' });

    expect(response.status).toBe(200);
    expect(received()).toHaveLength(1);
  });

  it('404s for an unknown instance', async () => {
    await boot();
    const response = await plugin.handleWebhook(
      new Request('http://localhost/api/v2/channels/asc-flow/nope/webhook', { method: 'POST', body: '{}' }),
    );
    expect(response.status).toBe(404);
  });

  it('acks unprocessable bodies with 200 so the flow does not re-deliver them', async () => {
    await boot();
    for (const body of ['not json', '[]', '{}', { codAtendimento: '42' }]) {
      expect((await post(body)).status).toBe(200);
    }
    expect(received()).toHaveLength(0);
  });

  it('rejects a mismatching verify token but allows a request that carries none', async () => {
    await boot({ webhookVerifyToken: 'secret' });

    expect((await post({ codAtendimento: '1', chatInput: 'x' }, '?token=wrong')).status).toBe(401);
    expect((await post({ codAtendimento: '1', chatInput: 'x' }, '', { 'x-webhook-token': 'wrong' })).status).toBe(401);
    expect((await post({ codAtendimento: '1', chatInput: 'x' }, '?token=secret')).status).toBe(200);
    expect((await post({ codAtendimento: '1', chatInput: 'x' })).status).toBe(200);
  });

  it('drops a redelivery that repeats a messageId', async () => {
    await boot();
    await post({ codAtendimento: '42', chatInput: 'oi', messageId: 'm-1' });
    await post({ codAtendimento: '42', chatInput: 'oi', messageId: 'm-1' });

    expect(received()).toHaveLength(1);
  });

  it('gives messageId precedence over the in-flight window', async () => {
    await boot();
    // Same cod and same text inside the window, but the flow says these are two
    // distinct messages — the id wins and both are published.
    await post({ codAtendimento: '42', chatInput: 'oi', messageId: 'm-1' });
    await post({ codAtendimento: '42', chatInput: 'oi', messageId: 'm-2' });

    expect(received()).toHaveLength(2);
  });

  it('collapses a burst of async re-polls into ONE message.received', async () => {
    await boot();
    // The flow's api_rest node re-calls every ~2s while it waits for
    // callbackFlow — measured at ~22 calls for a single user message.
    for (let i = 0; i < 20; i++) {
      expect((await post({ codAtendimento: '42', chatInput: 'oi', phone: '5551999' })).status).toBe(200);
    }

    expect(received()).toHaveLength(1);
  });

  it('keeps repeated text once the turn was answered — "1" twice is two real answers', async () => {
    await boot();
    await post({ codAtendimento: '42', chatInput: '1' });
    // The agent answers: sendMessage resumes the flow and closes the window.
    await answerTurn('42');
    await post({ codAtendimento: '42', chatInput: '1' });

    expect(received()).toHaveLength(2);
  });

  it('does not let one atendimento shadow another in the same burst', async () => {
    await boot();
    await post({ codAtendimento: '42', chatInput: 'oi' });
    await post({ codAtendimento: '43', chatInput: 'oi' });
    await post({ codAtendimento: '42', chatInput: 'oi' });
    await post({ codAtendimento: '43', chatInput: 'oi' });

    expect(received()).toHaveLength(2);
  });

  it('rejects non-POST methods', async () => {
    await boot();
    const response = await plugin.handleWebhook(new Request(url(), { method: 'GET' }));
    expect(response.status).toBe(405);
  });
});
