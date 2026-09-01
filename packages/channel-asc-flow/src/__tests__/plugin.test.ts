/**
 * Inbound parsing, the outbound turn sequence, and handoff.
 */

import { afterEach, describe, expect, it } from 'bun:test';

import { parseInboundTurn } from '../handlers/webhook';
import { AscFlowPlugin, normalizeBaseUrl } from '../plugin';
import { decodeAscEmoji, encodeAscEmoji } from '../utils/emoji';
import {
  BASE_URL,
  HANDOFF_SERVICO,
  MockEventBus,
  type RecordedCall,
  connectPlugin,
  createContext,
  instanceId,
  jsonResponse,
  stubPlatform,
} from './helpers';

let plugin: AscFlowPlugin;
let eventBus: MockEventBus;
let calls: RecordedCall[];
let restore: () => void;

/** Platform calls in order, `/authuser` filtered out. */
const sequence = (): string[] => calls.filter((c) => c.path !== '/authuser').map((c) => c.path);
const of = (path: string) => calls.filter((c) => c.path === path);
/** The body the next `api_rest` poll would receive. */
const ready = (cod: string) => plugin.takeReadyTurn(instanceId, cod);

async function boot(overrides: Record<string, () => Response> = {}): Promise<void> {
  const stub = stubPlatform(overrides);
  calls = stub.calls;
  restore = stub.restore;
  eventBus = new MockEventBus();
  plugin = new AscFlowPlugin();
  await plugin.initialize(createContext(eventBus));
  await connectPlugin(plugin);
  calls.length = 0; // drop the connect-time /authuser
}

afterEach(async () => {
  await plugin?.destroy();
  restore?.();
});

describe('normalizeBaseUrl', () => {
  it('appends /rest/v2 only when it is missing', () => {
    expect(normalizeBaseUrl('https://asc.test')).toBe('https://asc.test/rest/v2');
    expect(normalizeBaseUrl('https://asc.test/')).toBe('https://asc.test/rest/v2');
    expect(normalizeBaseUrl('https://asc.test/rest/v2')).toBe('https://asc.test/rest/v2');
  });
});

describe('parseInboundTurn', () => {
  it('reads the canonical field names', () => {
    expect(parseInboundTurn({ codAtendimento: 42, chatInput: ' oi ', phone: '5551999' })).toEqual({
      codAtendimento: '42',
      text: 'oi',
      phone: '5551999',
    });
  });

  it('accepts the snake_case aliases the client flows use', () => {
    expect(parseInboundTurn({ cod_atendimento: '42', message: 'oi', telefone: '5551' })?.codAtendimento).toBe('42');
  });

  // The platform transcodes emoji: a 🗑️ arrives as `##1f5d1-fe0f##`. Left raw
  // it defeated the session cleaner's trash reset (measured on the live number
  // 01/09) and the agent read the marker as prose.
  it('decodes the platform emoji markers back to characters', () => {
    expect(parseInboundTurn({ codAtendimento: '1', chatInput: '##1f5d1-fe0f##' })?.text).toBe('🗑️');
    expect(parseInboundTurn({ codAtendimento: '1', chatInput: '##1f44d##' })?.text).toBe('👍');
    expect(parseInboundTurn({ codAtendimento: '1', chatInput: 'oi ##1f44d## tudo bem' })?.text).toBe('oi 👍 tudo bem');
  });

  it('keeps text that only looks like a marker', () => {
    expect(parseInboundTurn({ codAtendimento: '1', chatInput: 'preço ## 10 ##' })?.text).toBe('preço ## 10 ##');
    expect(parseInboundTurn({ codAtendimento: '1', chatInput: '##zzzz##' })?.text).toBe('##zzzz##');
  });

  it('carries a messageId when the flow supplies one', () => {
    expect(parseInboundTurn({ codAtendimento: '1', chatInput: 'x', messageId: 'm1' })?.messageId).toBe('m1');
    expect(parseInboundTurn({ codAtendimento: '1', chatInput: 'x' })?.messageId).toBeUndefined();
  });

  it('rejects a turn missing either mandatory field', () => {
    expect(parseInboundTurn({ chatInput: 'oi' })).toBeNull();
    expect(parseInboundTurn({ codAtendimento: '42' })).toBeNull();
    expect(parseInboundTurn({ codAtendimento: '42', chatInput: '   ' })).toBeNull();
  });
});

describe('connect', () => {
  it('authenticates against the platform and reports connected', async () => {
    const stub = stubPlatform();
    restore = stub.restore;
    plugin = new AscFlowPlugin();
    await plugin.initialize(createContext(new MockEventBus()));
    await connectPlugin(plugin);

    expect(stub.calls[0]?.path).toBe('/authuser');
    expect(stub.calls[0]?.body).toEqual({ login: 'test-login', chave: 'test-chave' });
    expect(plugin.getConnectedInstances()).toContain(instanceId);
  });

  it('refuses to connect without a login or chave', async () => {
    const stub = stubPlatform();
    restore = stub.restore;
    plugin = new AscFlowPlugin();
    await plugin.initialize(createContext(new MockEventBus()));

    expect(
      plugin.connect(instanceId, { instanceId, credentials: { ascFlowBaseUrl: BASE_URL, ascFlowLogin: 'x' } }),
    ).rejects.toThrow('ascFlowChave is required');
  });
});

describe('inbound', () => {
  it('raises typing and publishes the turn with cod_atendimento as the chat id', async () => {
    await boot();
    await plugin.handleInboundTurn(instanceId, { codAtendimento: '42', text: 'oi', phone: '5551999' });

    expect(of('/sendIndicador')[0]?.body).toEqual({ cod: 42, tipo: 1 });

    const received = eventBus.published.find((e) => e.type.includes('received'));
    expect(received).toBeDefined();
    expect(received?.payload).toMatchObject({ chatId: '42', from: '5551999' });
  });

  it('falls back to the cod as the sender when the flow sends no phone', async () => {
    await boot();
    await plugin.handleInboundTurn(instanceId, { codAtendimento: '42', text: 'oi', phone: '' });

    expect(eventBus.published.find((e) => e.type.includes('received'))?.payload).toMatchObject({ from: '42' });
  });
});

describe('outbound turn', () => {
  const send = (content: Record<string, unknown>, metadata: Record<string, unknown> = {}) =>
    plugin.sendMessage(instanceId, { to: '42', content: content as never, metadata });

  it('pushes every bubble but the last, with typing between them', async () => {
    await boot();
    const result = await send({ type: 'text', text: 'um\n\ndois\n\ntres' });

    expect(result.success).toBe(true);
    // The last bubble is NOT pushed — it rides back in `resposta`.
    expect(sequence()).toEqual(['/callbackFlowMsg', '/sendIndicador', '/callbackFlowMsg', '/sendIndicador']);
    expect(of('/callbackFlowMsg').map((c) => c.body.msg_usuario)).toEqual(['um', 'dois']);
    expect(ready('42')).toMatchObject({ pronto: 1, resposta: 'tres', hand_off: 'nao', bolhas: ['um', 'dois', 'tres'] });
  });

  it('carries the URA of the last bubble in the response body', async () => {
    await boot();
    await send({
      type: 'text',
      text: 'Achei estes horários:\n\n1. seg 01/09 08:30\n2. seg 01/09 09:00',
      buttons: [{ text: 'seg 01/09 08:30' }, { text: 'seg 01/09 09:00' }],
    });

    expect(ready('42')).toMatchObject({
      forcar_botoes: true,
      ura_opcoes: { '1': 'seg 01/09 08:30', '2': 'seg 01/09 09:00' },
    });
  });

  it('omits the URA when the options do not fit the component', async () => {
    await boot();
    await send({
      type: 'text',
      text: 'Escolha:',
      buttons: Array.from({ length: 11 }, (_, i) => ({ text: `Opção ${i + 1}` })),
    });

    expect(ready('42')?.ura_opcoes).toBeUndefined();
  });

  it('transfers to the configured queue and reports the handoff in the body', async () => {
    await boot();
    await send(
      { type: 'text', text: 'Vou te transferir.' },
      { isHandoff: true, handoffQueue: 'VQ_AGENDAMENTO', handoffReason: 'fora do escopo' },
    );

    expect(sequence()).toEqual(['/transferirHumano']);
    expect(ready('42')).toMatchObject({
      hand_off: 'sim',
      fila_vq: 'VQ_AGENDAMENTO',
      motivo_transf_vq: 'fora do escopo',
    });
    expect(of('/transferirHumano')[0]?.body).toEqual({
      cod: 42,
      cod_servico: HANDOFF_SERVICO,
      cod_prioridade: 0,
      msgTransferencia: false,
    });
  });

  it('omits the Genesys fields when the turn does not hand off', async () => {
    await boot();
    await send({ type: 'text', text: 'ok' }, { handoffQueue: 'VQ_X' });

    expect(ready('42')).toEqual({ pronto: 1, resposta: 'ok', hand_off: 'nao', bolhas: ['ok'] });
    expect(of('/transferirHumano')).toHaveLength(0);
  });

  it('still resolves the turn when a leading bubble is refused', async () => {
    await boot({
      '/callbackFlowMsg': () => jsonResponse({ cod_error: 10, msg: 'Atendimento já finalizado!' }, 401),
    });
    const result = await send({ type: 'text', text: 'um\n\ndois' });

    // The push is best-effort; `resposta` is the canonical delivery path.
    expect(result.success).toBe(true);
    expect(ready('42')).toMatchObject({ resposta: 'dois' });
  });

  it('fails without sending when the chat id is not a cod_atendimento', async () => {
    await boot();
    const result = await plugin.sendMessage(instanceId, {
      to: '5551999@s.whatsapp.net',
      content: { type: 'text', text: 'oi' } as never,
    });

    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
    expect(eventBus.published.some((e) => e.type.includes('failed'))).toBe(true);
  });

  it('reports failure when the platform refuses the handoff on business grounds', async () => {
    await boot({
      '/transferirHumano': () => jsonResponse({ cod_error: 10, msg: 'Atendimento já finalizado!' }, 401),
    });
    const result = await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'text', text: 'oi' } as never,
      metadata: { isHandoff: true },
    });

    expect(result).toMatchObject({ success: false, retryable: false });
    // A failed turn parks no answer — the flow times the node out instead of
    // advancing on a half-delivered turn.
    expect(plugin.takeReadyTurn(instanceId, '42')).toBeNull();
  });

  it('refuses an empty turn instead of sending a blank bubble', async () => {
    await boot();
    const result = await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'text', text: '   ' } as never,
    });

    expect(result.success).toBe(false);
    expect(calls).toHaveLength(0);
  });

  // The far end is WhatsApp: `**bold**` reaches the handset raw and WhatsApp
  // pairs the asterisks wrong. Measured on the live number 01/09.
  it('converts markdown to WhatsApp syntax before delivering', async () => {
    await boot();
    await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'text', text: 'Bom dia, **Rogerio**. Informe seu **CPF**.' } as never,
    });

    expect(ready('42')).toMatchObject({
      resposta: 'Bom dia, *Rogerio*. Informe seu *CPF*.',
    });
  });

  it('honors passthrough for callers that already formatted the text', async () => {
    await boot();
    await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'text', text: '**cru**' } as never,
      metadata: { messageFormatMode: 'passthrough' },
    });

    expect(ready('42')).toMatchObject({ resposta: '**cru**' });
  });

  // The platform carries emoji only as markers; a raw `✅` reached the handset
  // as `?` (measured 01/09 on the session-cleared confirmation).
  it('encodes emoji as platform markers on the way out', async () => {
    await boot();
    await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'text', text: '✅ Conversa limpa!' } as never,
    });

    expect(ready('42')).toMatchObject({ resposta: '##2705## Conversa limpa!' });
  });

  it('leaves accented text alone — only emoji are transcoded', async () => {
    await boot();
    await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'text', text: 'Sua sessão foi resetada, coração' } as never,
    });

    expect(ready('42')).toMatchObject({ resposta: 'Sua sessão foi resetada, coração' });
  });
});

describe('emoji codec', () => {
  it('round-trips what the platform actually sends', () => {
    for (const emoji of ['🗑️', '✅', '👋', '⚠️', '😊']) {
      expect(decodeAscEmoji(encodeAscEmoji(emoji))).toBe(emoji);
    }
  });

  it('matches the marker the client production flow writes', () => {
    // flow #215 (NDS PPO) ships `Olá! ##1f44b## Seja bem-vindo(a)`.
    expect(encodeAscEmoji('Olá! 👋 Seja bem-vindo(a)')).toBe('Olá! ##1f44b## Seja bem-vindo(a)');
  });
});
