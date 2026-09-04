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

const body = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;

/** The agent answering: this is what resumes the flow and closes the turn. */
const answerTurn = (cod: string) =>
  plugin.sendMessage(instanceId, { to: cod, content: { type: 'text', text: 'resposta' } as never });

afterEach(async () => {
  await plugin?.destroy();
  restore?.();
});

describe('handleWebhook', () => {
  it('accepts a turn, publishes it, and answers pronto:0', async () => {
    await boot();
    const response = await post({ codAtendimento: '42', chatInput: 'oi', phone: '5551999' });

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ pronto: 0 });
    expect(received()).toHaveLength(1);
  });

  it('hands the agent answer back on the NEXT poll, then treats the turn as over', async () => {
    await boot();
    expect(await body(await post({ codAtendimento: '42', chatInput: 'oi' }))).toEqual({ pronto: 0 });

    await answerTurn('42');

    expect(await body(await post({ codAtendimento: '42', chatInput: 'oi' }))).toEqual({
      pronto: 1,
      resposta: 'resposta',
      hand_off: 'nao',
      bolhas: ['resposta'],
    });
    // Answer collected: the same text now opens a brand-new turn.
    expect(await body(await post({ codAtendimento: '42', chatInput: 'oi' }))).toEqual({ pronto: 0 });
    expect(received()).toHaveLength(2);
  });

  it('returns hand_off:sim in the body when the turn hands off', async () => {
    await boot();
    await post({ codAtendimento: '42', chatInput: 'oi' });
    await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'text', text: 'Vou te transferir.' } as never,
      metadata: { isHandoff: true, handoffQueue: 'VQ_AGENDAMENTO', handoffReason: 'fora do escopo' },
    });

    expect(await body(await post({ codAtendimento: '42', chatInput: 'oi' }))).toMatchObject({
      pronto: 1,
      hand_off: 'sim',
      fila_vq: 'VQ_AGENDAMENTO',
      motivo_transf_vq: 'fora do escopo',
    });
  });

  it('pushes every bubble but the last, and returns the last one in resposta', async () => {
    const stub = stubPlatform();
    restore = stub.restore;
    eventBus = new MockEventBus();
    plugin = new AscFlowPlugin();
    await plugin.initialize(createContext(eventBus));
    await connectPlugin(plugin);

    await post({ codAtendimento: '42', chatInput: 'oi' });
    await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'text', text: 'um\n\ndois\n\ntres' } as never,
    });

    expect(stub.calls.filter((c) => c.path === '/callbackFlowMsg').map((c) => c.body.msg_usuario)).toEqual([
      'um',
      'dois',
    ]);
    expect(await body(await post({ codAtendimento: '42', chatInput: 'oi' }))).toMatchObject({
      resposta: 'tres',
      bolhas: ['um', 'dois', 'tres'],
    });
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
    for (const payload of ['not json', '[]', '{}', { codAtendimento: '42' }]) {
      const response = await post(payload);
      expect(response.status).toBe(200);
      expect(await body(response)).toEqual({ pronto: 0 });
    }
    expect(received()).toHaveLength(0);
  });

  // The route is mounted auth-exempt, so this token is the only lock once it is
  // configured: a MISSING one must be refused exactly like a wrong one, or the
  // check is bypassed by simply not sending it.
  it('rejects a wrong verify token — and a missing one just the same', async () => {
    await boot({ webhookVerifyToken: 'secret' });

    expect((await post({ codAtendimento: '1', chatInput: 'x' }, '?token=wrong')).status).toBe(401);
    expect((await post({ codAtendimento: '1', chatInput: 'x' }, '', { 'x-webhook-token': 'wrong' })).status).toBe(401);
    expect((await post({ codAtendimento: '1', chatInput: 'x' })).status).toBe(401);
    expect((await post({ codAtendimento: '1', chatInput: 'x' }, '?token=secret')).status).toBe(200);
    expect((await post({ codAtendimento: '1', chatInput: 'x' }, '', { 'x-webhook-token': 'secret' })).status).toBe(200);
  });

  it('stays open when no verify token is configured', async () => {
    await boot();

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
      const response = await post({ codAtendimento: '42', chatInput: 'oi', phone: '5551999' });
      expect(response.status).toBe(200);
      expect(await body(response)).toEqual({ pronto: 0 });
    }

    expect(received()).toHaveLength(1);
  });

  it('keeps repeated text once the turn was answered — "1" twice is two real answers', async () => {
    await boot();
    await post({ codAtendimento: '42', chatInput: '1' });
    // The agent answers; the next poll collects it and closes the window.
    await answerTurn('42');
    await post({ codAtendimento: '42', chatInput: '1' });
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

  // The deadlock measured on atendimento 22289496: the chat carried a stale
  // `agentPaused`, the dispatcher skipped the agent, no `sendMessage` ever ran,
  // and every re-poll was dropped as "turn still in flight" — forever.
  it('releases the flow when NOTHING ever answers the turn', async () => {
    await boot();
    expect(await body(await post({ codAtendimento: '42', chatInput: 'oi' }))).toEqual({ pronto: 0 });
    // Re-polls keep being deduped while the agent could still be running.
    expect(await body(await post({ codAtendimento: '42', chatInput: 'oi' }))).toEqual({ pronto: 0 });
    expect(received()).toHaveLength(1);

    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      // Past the window with no answer parked: the poll gets an empty ready
      // body instead of another `pronto:0`, so `async_condition` fires.
      expect(await body(await post({ codAtendimento: '42', chatInput: 'oi' }))).toEqual({
        pronto: 1,
        resposta: '',
        hand_off: 'nao',
        bolhas: [],
      });
    } finally {
      Date.now = realNow;
    }

    // The turn is over — no republish happened while releasing it, and the next
    // message opens a genuinely new one.
    expect(received()).toHaveLength(1);
    expect(await body(await post({ codAtendimento: '42', chatInput: 'oi' }))).toEqual({ pronto: 0 });
    expect(received()).toHaveLength(2);
  });

  it('rejects non-POST methods', async () => {
    await boot();
    const response = await plugin.handleWebhook(new Request(url(), { method: 'GET' }));
    expect(response.status).toBe(405);
  });
});
