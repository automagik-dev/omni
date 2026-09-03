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

/**
 * The opt-in destination: `/transferirHumano` → the ASC's own internal queue.
 * The DEFAULT is `flow`, which never calls it (see the `handoff mode` block).
 */
const SERVICE = { ascFlowHandoffMode: 'service' } as const;

/** Platform calls in order, `/authuser` filtered out. */
const sequence = (): string[] => calls.filter((c) => c.path !== '/authuser').map((c) => c.path);
const of = (path: string) => calls.filter((c) => c.path === path);
/** The body the next `api_rest` poll would receive. */
const ready = (cod: string) => plugin.takeReadyTurn(instanceId, cod);

async function boot(
  overrides: Record<string, () => Response> = {},
  credentials: Record<string, unknown> = {},
): Promise<void> {
  const stub = stubPlatform(overrides);
  calls = stub.calls;
  restore = stub.restore;
  eventBus = new MockEventBus();
  plugin = new AscFlowPlugin();
  await plugin.initialize(createContext(eventBus));
  await connectPlugin(plugin, credentials);
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
    await boot({}, SERVICE);
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

  it('answers the turn with hand_off "nao" when the platform refuses the transfer', async () => {
    await boot(
      { '/transferirHumano': () => jsonResponse({ cod_error: 10, msg: 'Atendimento já finalizado!' }, 401) },
      SERVICE,
    );
    const result = await send({ type: 'text', text: 'Vou te transferir.' }, { isHandoff: true, handoffQueue: 'VQ_X' });

    // The transfer failing must never cost the beneficiary the answer.
    expect(result.success).toBe(true);
    expect(ready('42')).toEqual({
      pronto: 1,
      resposta: 'Vou te transferir.',
      hand_off: 'nao',
      bolhas: ['Vou te transferir.'],
    });
    // A business 401 is not re-authenticated: exactly one attempt, no retry.
    expect(of('/transferirHumano')).toHaveLength(1);
    expect(of('/authuser')).toHaveLength(0);
  });

  it('answers the turn with hand_off "nao" when the transfer 500s', async () => {
    await boot({ '/transferirHumano': () => jsonResponse({ msg: 'boom' }, 500) }, SERVICE);
    const result = await send({ type: 'text', text: 'Vou te transferir.' }, { isHandoff: true });

    expect(result.success).toBe(true);
    expect(ready('42')).toMatchObject({ hand_off: 'nao', resposta: 'Vou te transferir.' });
  });

  describe('handoff validation (service mode)', () => {
    // Measured on the live branch: `Number()` turns each of these into NaN
    // (→ `null` on the wire) or a silent 0 — a service that does not exist.
    for (const bad of ['fila-x', '', '12abc', '-3', 0, -1, 1.5, Number.NaN, {}, []] as unknown[]) {
      it(`refuses the handoff when cod_servico is ${JSON.stringify(bad) ?? String(bad)}`, async () => {
        await boot({}, SERVICE);
        const result = await send(
          { type: 'text', text: 'Vou te transferir.' },
          { isHandoff: true, handoffServico: bad, handoffQueue: 'VQ_X', handoffReason: 'fora do escopo' },
        );

        expect(result.success).toBe(true);
        expect(of('/transferirHumano')).toHaveLength(0);
        // No lie to the flow, and no orphan Genesys fields.
        expect(ready('42')).toEqual({
          pronto: 1,
          resposta: 'Vou te transferir.',
          hand_off: 'nao',
          bolhas: ['Vou te transferir.'],
        });
      });
    }

    it('accepts a numeric string cod_servico override', async () => {
      await boot({}, SERVICE);
      await send({ type: 'text', text: 'ok' }, { isHandoff: true, handoffServico: ' 77 ' });

      expect(of('/transferirHumano')[0]?.body).toMatchObject({ cod_servico: 77 });
      expect(ready('42')).toMatchObject({ hand_off: 'sim' });
    });

    it('clamps cod_prioridade to the 0|1 domain', async () => {
      await boot({}, SERVICE);
      await send({ type: 'text', text: 'ok' }, { isHandoff: true, handoffPriority: 9 });
      expect(of('/transferirHumano')[0]?.body).toMatchObject({ cod_prioridade: 0 });

      calls.length = 0;
      await send({ type: 'text', text: 'ok' }, { isHandoff: true, handoffPriority: 1 });
      expect(of('/transferirHumano')[0]?.body).toMatchObject({ cod_prioridade: 1 });
    });

    it('reads the dialect POST /messages/send/handoff actually forwards', async () => {
      await boot({}, SERVICE);
      // That route has no per-channel keys: it sends `handoffFields` +
      // `motivoHandoff`. Without this the REST caller could never fill fila_vq.
      await send(
        { type: 'text', text: 'Vou te transferir.' },
        {
          isHandoff: true,
          handoffFields: { fila_vq: 'VQ_AGENDAMENTO', cod_servico: 131, cod_prioridade: 1 },
          motivoHandoff: 'fora do escopo',
        },
      );

      expect(of('/transferirHumano')[0]?.body).toMatchObject({ cod_servico: 131, cod_prioridade: 1 });
      expect(ready('42')).toMatchObject({
        hand_off: 'sim',
        fila_vq: 'VQ_AGENDAMENTO',
        motivo_transf_vq: 'fora do escopo',
      });
    });

    it('omits fila_vq when the value is not a queue code', async () => {
      await boot({}, SERVICE);
      await send({ type: 'text', text: 'ok' }, { isHandoff: true, handoffQueue: 'fila com espaço' });

      expect(ready('42')?.fila_vq).toBeUndefined();
    });

    it('keeps fila_vq when it matches the accepted shape', async () => {
      await boot({}, SERVICE);
      await send({ type: 'text', text: 'ok' }, { isHandoff: true, handoffQueue: 'VQ_AGEND.01-a' });

      expect(ready('42')?.fila_vq).toBe('VQ_AGEND.01-a');
    });

    it('collapses and truncates motivo_transf_vq, and omits an empty one', async () => {
      await boot({}, SERVICE);
      await send({ type: 'text', text: 'ok' }, { isHandoff: true, handoffReason: `${'a '.repeat(300)}` });
      expect(ready('42')?.motivo_transf_vq).toHaveLength(255);

      await send({ type: 'text', text: 'ok' }, { isHandoff: true, handoffReason: '  fora \n do  escopo ' });
      expect(ready('42')?.motivo_transf_vq).toBe('fora do escopo');

      await send({ type: 'text', text: 'ok' }, { isHandoff: true, handoffReason: '   \n ' });
      expect(ready('42')?.motivo_transf_vq).toBeUndefined();
    });
  });

  /**
   * The two destinations are EXCLUSIVE. Measured on atendimento 22286567
   * (flow #225, 03/09): `/transferirHumano` was accepted, the atendimento left
   * "Automático" — and the flow stopped polling, so it never read
   * `hand_off:"sim"` and never reached the `genesys_mobile_service` node.
   * Hapvida's destination is Genesys/WDE, so `flow` is the default.
   */
  describe('handoff mode flow (default)', () => {
    it('never calls transferirHumano and carries the Genesys fields in the body', async () => {
      await boot();
      await send(
        { type: 'text', text: 'Vou te transferir.' },
        { isHandoff: true, handoffQueue: 'VQ_AGENDAMENTO', handoffReason: 'fora do escopo' },
      );

      expect(of('/transferirHumano')).toHaveLength(0);
      expect(ready('42')).toEqual({
        pronto: 1,
        resposta: 'Vou te transferir.',
        hand_off: 'sim',
        bolhas: ['Vou te transferir.'],
        fila_vq: 'VQ_AGENDAMENTO',
        motivo_transf_vq: 'fora do escopo',
      });
    });

    it('hands off with no fila_vq — flow #225 hardcodes u_cod_transf', async () => {
      await boot();
      await send({ type: 'text', text: 'ok' }, { isHandoff: true, handoffReason: 'fora do escopo' });

      expect(of('/transferirHumano')).toHaveLength(0);
      expect(ready('42')).toMatchObject({ hand_off: 'sim', motivo_transf_vq: 'fora do escopo' });
      expect(ready('42')?.fila_vq).toBeUndefined();
    });

    it('REFUSES the handoff when fila_vq is present and malformed', async () => {
      // Unlike service mode, there is no ASC queue holding the atendimento:
      // fila_vq IS the routing key, so omitting it would strand the transfer.
      await boot();
      const result = await send(
        { type: 'text', text: 'Vou te transferir.' },
        {
          isHandoff: true,
          handoffQueue: 'fila com espaço',
        },
      );

      expect(result.success).toBe(true);
      expect(of('/transferirHumano')).toHaveLength(0);
      expect(ready('42')).toEqual({
        pronto: 1,
        resposta: 'Vou te transferir.',
        hand_off: 'nao',
        bolhas: ['Vou te transferir.'],
      });
    });

    it('ignores cod_servico entirely — nothing is dialed', async () => {
      await boot();
      await send({ type: 'text', text: 'ok' }, { isHandoff: true, handoffServico: 'lixo', handoffQueue: 'VQ_X' });

      expect(of('/transferirHumano')).toHaveLength(0);
      expect(ready('42')).toMatchObject({ hand_off: 'sim', fila_vq: 'VQ_X' });
    });
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
