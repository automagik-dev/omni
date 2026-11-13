/**
 * A turn the agent answers in several sends: direct sends first (`POST /messages/send`), its reply last.
 *
 * Every `/callbackFlowMsg` after the first one of a turn WAKES the ASC flow, which calls the webhook again (measured on
 * the Odonto HML, 13/11/2026: a turn of N bubbles brought N-1 extra calls, on every turn of atendimento 24505190). A
 * normal turn survives that because its pushes all land BEFORE the held call is answered. The opening that sent its
 * bubbles one by one answered the held call on its FIRST send, so the answer reached the ASC while the next push was
 * waking the flow, and the atendimento never reached the agent again (5 of 9 openings in the HML, 0 of 11 that went in
 * one send). The held call must answer once, after the turn's last send.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { AscFlowPlugin } from '../plugin';
import { MockEventBus, connectPlugin, createContext, instanceId, stubPlatform } from './helpers';

let plugin: AscFlowPlugin;
let restore: () => void;
/** Every platform call in the order it finished, plus `ANSWER` when the held webhook call returned. */
let order: string[];

const env = { hold: process.env.ASC_FLOW_HOLD_MS, settle: process.env.ASC_FLOW_TURN_SETTLE_MS };

beforeEach(async () => {
  const stub = stubPlatform();
  const fake = globalThis.fetch;
  // Each platform call takes a beat, as the real one does (0.17 to 0.31 s measured on the opening's sends).
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const response = await fake(input, init);
    order.push(new URL(String(input)).pathname.replace('/rest/v2', ''));
    return response;
  }) as typeof fetch;
  restore = () => {
    globalThis.fetch = fake;
    stub.restore();
  };
  order = [];
  process.env.ASC_FLOW_HOLD_MS = '5000';
  process.env.ASC_FLOW_TURN_SETTLE_MS = '2000';
  plugin = new AscFlowPlugin();
  await plugin.initialize(createContext(new MockEventBus()));
  await connectPlugin(plugin);
  order.length = 0;
});

afterEach(async () => {
  await plugin?.destroy();
  restore?.();
  process.env.ASC_FLOW_HOLD_MS = env.hold;
  process.env.ASC_FLOW_TURN_SETTLE_MS = env.settle;
});

type Window = { correlationId?: string };
const windowOf = (cod: string): Window | undefined =>
  (plugin as unknown as { ascFlowInstances: Map<string, { inFlight: Map<string, Window> }> }).ascFlowInstances
    .get(instanceId)
    ?.inFlight.get(cod);

/** The flow's first call of an atendimento: no `chatInput` yet, the opening message in `message`. Held. */
function openingCall(): { answered: () => boolean; body: Promise<Record<string, unknown>> } {
  let answered = false;
  // This test's own log: a call held past its test must not mark the next one's.
  const log = order;
  const body = plugin
    .handleWebhook(
      new Request(`http://localhost/api/v2/channels/asc-flow/${instanceId}/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codAtendimento: '42', chatInput: '', message: 'Olá' }),
      }),
    )
    .then(async (response) => {
      answered = true;
      log.push('ANSWER');
      return (await response.json()) as Record<string, unknown>;
    });
  return { answered: () => answered, body };
}

async function opened(): Promise<string | undefined> {
  for (let i = 0; i < 100 && !windowOf('42')?.correlationId; i++) await Bun.sleep(5);
  return windowOf('42')?.correlationId;
}

const direct = (text: string, buttons?: Array<Record<string, string>>) =>
  plugin.sendMessage(instanceId, {
    to: '42',
    content: { type: 'text', text, ...(buttons ? { buttons } : {}) } as never,
  });

const reply = (text: string, correlationId: string | undefined) =>
  plugin.sendMessage(instanceId, {
    to: '42',
    content: { type: 'text', text } as never,
    metadata: { correlationId, partIndex: 0, partCount: 1 },
  });

describe('a turn answered in several sends answers the held call once, after the last', () => {
  it('holds the call through the direct sends and answers it after the reply', async () => {
    const call = openingCall();
    const trace = await opened();

    await direct('Olá! Sou a Eugenia.');
    await direct('Seu protocolo é 123.');
    await direct('Aviso de privacidade.', [{ text: 'Ver a política', url: 'https://example.com/politica' }]);
    await Bun.sleep(600); // past two ticks of the hold: the old code had answered on the first send

    expect(call.answered()).toBe(false);

    await reply('Para começar, qual é o seu CPF?', trace);
    const body = await call.body;

    expect(body).toMatchObject({ pronto: 1, resposta: '', hand_off: 'nao' });
    expect(order.lastIndexOf('/callbackFlowMsg')).toBeLessThan(order.indexOf('ANSWER'));
    expect(order.lastIndexOf('/sendMsgInterativaAvancado')).toBeLessThan(order.indexOf('ANSWER'));
  });

  it('answers with the direct sends when no reply comes, once the turn has settled', async () => {
    process.env.ASC_FLOW_TURN_SETTLE_MS = '300';
    const call = openingCall();
    await opened();

    await direct('Olá! Sou a Eugenia.');
    await direct('Seu protocolo é 123.');
    const lastSend = Date.now();
    const body = await call.body;

    expect(body).toMatchObject({ pronto: 1, resposta: '' });
    expect(Date.now() - lastSend).toBeGreaterThanOrEqual(300);
  });

  it('never settles while a send is still delivering', async () => {
    process.env.ASC_FLOW_TURN_SETTLE_MS = '100';
    const call = openingCall();
    const trace = await opened();
    await direct('Olá! Sou a Eugenia.');
    // The reply starts inside the settle window, and its twelve bubbles (~0.5 s of pushes) outlast it and two ticks of
    // the hold: an answer let out between them would reach the flow mid-burst.
    const bubbles = Array.from({ length: 12 }, (_, i) => `Bolha ${i + 1}.`);
    await reply(bubbles.join('\n\n'), trace);
    await call.body;

    expect(order.lastIndexOf('/callbackFlowMsg')).toBeLessThan(order.indexOf('ANSWER'));
  });

  // A reply that finishes while ANOTHER send is still pushing (a caller sending directly at the same time) must wait
  // for it too: the answer would otherwise reach the flow between that send's pushes. Review of #1720.
  it('holds a finished reply while an overlapping direct send is still pushing', async () => {
    const call = openingCall();
    const trace = await opened();

    const bubbles = Array.from({ length: 12 }, (_, i) => `Bolha ${i + 1}.`);
    const long = direct(bubbles.join('\n\n')); // ~0.5 s of pushes
    await Bun.sleep(60);
    await reply('Para começar, qual é o seu CPF?', trace);
    await long;
    await call.body;

    expect(order.lastIndexOf('/callbackFlowMsg')).toBeLessThan(order.indexOf('ANSWER'));
  });

  it('still answers at once when a direct send hands off', async () => {
    const call = openingCall();
    await opened();

    await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'text', text: 'Vamos chamar um especialista.' } as never,
      metadata: { isHandoff: true, handoffQueue: 'FILA', motivoHandoff: 'pedido' },
    });
    const started = Date.now();
    const body = await call.body;

    expect(body).toMatchObject({ pronto: 1, hand_off: 'sim' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('a call the flow makes on its own while the turn is held is a poll, not the answer', async () => {
    const call = openingCall();
    const trace = await opened();
    await direct('Olá! Sou a Eugenia.');

    // A push wakes the flow: at the opening it calls with no input at all.
    const loop = await plugin.handleWebhook(
      new Request(`http://localhost/api/v2/channels/asc-flow/${instanceId}/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codAtendimento: '42', chatInput: '', message: '' }),
      }),
    );
    expect(await loop.json()).toEqual({ pronto: 0 });

    await reply('Para começar, qual é o seu CPF?', trace);
    expect(await call.body).toMatchObject({ pronto: 1 });
  });
});
