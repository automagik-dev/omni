/**
 * Inbound parsing, the outbound turn sequence, and handoff.
 */

import { afterEach, describe, expect, it } from 'bun:test';

import { parseInboundTurn } from '../handlers/webhook';
import { AscFlowPlugin, normalizeBaseUrl } from '../plugin';
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

  it('splits paragraphs into bubbles with typing between them, then resumes the flow', async () => {
    await boot();
    const result = await send({ type: 'text', text: 'um\n\ndois\n\ntres' });

    expect(result.success).toBe(true);
    expect(sequence()).toEqual([
      '/callbackFlowMsg',
      '/sendIndicador',
      '/callbackFlowMsg',
      '/sendIndicador',
      '/callbackFlowMsg',
      '/callbackFlow',
    ]);
    expect(of('/callbackFlowMsg').map((c) => c.body.msg_usuario)).toEqual(['um', 'dois', 'tres']);
    expect(of('/callbackFlow')[0]?.body.flow_variaveis).toMatchObject({ hand_off: 'nao' });
  });

  it('sends the LAST bubble through /mensagem when the turn carries options', async () => {
    await boot();
    await send({
      type: 'text',
      text: 'Achei estes horários:\n\n1. seg 01/09 08:30\n2. seg 01/09 09:00',
      buttons: [{ text: 'seg 01/09 08:30' }, { text: 'seg 01/09 09:00' }],
    });

    expect(sequence()).toEqual(['/callbackFlowMsg', '/sendIndicador', '/mensagem', '/callbackFlow']);
    const mensagem = of('/mensagem')[0]?.body;
    expect(mensagem).toMatchObject({
      cod: 42,
      entrante: 0,
      bolFlow: true,
      forcar_botoes: true,
      ura_opcoes: { '1': 'seg 01/09 08:30', '2': 'seg 01/09 09:00' },
    });
    expect(mensagem?.mensagem).toContain('1. seg 01/09 08:30');
  });

  it('degrades to plain bubbles when the options do not fit the component', async () => {
    await boot();
    await send({
      type: 'text',
      text: 'Escolha:',
      buttons: Array.from({ length: 11 }, (_, i) => ({ text: `Opção ${i + 1}` })),
    });

    expect(sequence()).toEqual(['/callbackFlowMsg', '/callbackFlow']);
  });

  it('transfers to the configured queue LAST when the turn hands off', async () => {
    await boot();
    await send(
      { type: 'text', text: 'Vou te transferir.' },
      { isHandoff: true, handoffQueue: 'VQ_AGENDAMENTO', handoffReason: 'fora do escopo' },
    );

    expect(sequence()).toEqual(['/callbackFlowMsg', '/callbackFlow', '/transferirHumano']);
    expect(of('/callbackFlow')[0]?.body.flow_variaveis).toMatchObject({
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

    expect(of('/callbackFlow')[0]?.body.flow_variaveis).toEqual({ resposta: 'ok', hand_off: 'nao' });
    expect(of('/transferirHumano')).toHaveLength(0);
  });

  it('retries callbackFlow as a list when the platform refuses the object form', async () => {
    let attempts = 0;
    await boot({
      '/callbackFlow': () => {
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ cod_error: 3, msg: 'formato inválido' })
          : jsonResponse({ cod_error: 0 });
      },
    });
    await send({ type: 'text', text: 'ok' });

    expect(of('/callbackFlow')).toHaveLength(2);
    expect(of('/callbackFlow')[1]?.body.flow_variaveis).toEqual([
      { nome: 'resposta', valor: 'ok' },
      { nome: 'hand_off', valor: 'nao' },
    ]);
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

  it('reports failure when the platform refuses a bubble on business grounds', async () => {
    await boot({
      '/callbackFlowMsg': () => jsonResponse({ cod_error: 10, msg: 'Atendimento já finalizado!' }, 401),
    });
    const result = await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'text', text: 'oi' } as never,
    });

    expect(result).toMatchObject({ success: false, retryable: false });
    // The flow must NOT be resumed after a refused bubble.
    expect(of('/callbackFlow')).toHaveLength(0);
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
});
