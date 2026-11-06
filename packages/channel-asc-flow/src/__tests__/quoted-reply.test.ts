/**
 * WhatsApp "Reply" on one of our bubbles (omni#1617).
 *
 * The flow body carries only the typed text; the platform record says what it
 * quoted (`id_mensagem_resposta`). The row shapes follow what production
 * returns; every name, date and id below is made up.
 */

import { afterEach, describe, expect, it } from 'bun:test';

import { AscFlowPlugin } from '../plugin';
import { type AscAtendimentoMessage, quotedReplyOf } from '../utils/atendimento';
import { MockEventBus, connectPlugin, createContext, instanceId, jsonResponse, stubPlatform } from './helpers';

const COD = '900001';
const BOLHA = 'Dr(a). *Exemplo Silva*, *Teleconsulta*\n##1f4c5## Hoje, *01/01*: 10:00 (é o único horário nesse dia)';
const MENU = 'Podemos confirmar o agendamento?\nConfirmar\nAlterar\n\n';

const rows = (): AscAtendimentoMessage[] => [
  { id_mensagem: '1001', boleano_entrante: '0', tip_msg: 'TEXTO', descricao_msg: BOLHA },
  { id_mensagem: '1002', boleano_entrante: '0', tip_msg: '15', descricao_msg: MENU },
  { id_mensagem: '1003', boleano_entrante: '1', tip_msg: 'TEXTO', descricao_msg: 'oi' },
  // "Quero essa opção" quoting the option bubble
  {
    id_mensagem: '2001',
    boleano_entrante: '1',
    tip_msg: 'TEXTO',
    descricao_msg: 'Quero essa opção',
    id_mensagem_resposta: '1001',
  },
  // a tap on "Confirmar": the platform links it to the interactive message
  {
    id_mensagem: '2002',
    boleano_entrante: '1',
    tip_msg: 'TEXTO',
    descricao_msg: 'Confirmar',
    id_mensagem_resposta: '1002',
  },
  // a reply to the beneficiary's own message
  { id_mensagem: '2003', boleano_entrante: '1', tip_msg: 'TEXTO', descricao_msg: 'isso', id_mensagem_resposta: '1003' },
  {
    id_mensagem: '2004',
    boleano_entrante: '1',
    tip_msg: 'TEXTO',
    descricao_msg: 'sem citação',
    id_mensagem_resposta: null,
  },
  // a reply to a row the atendimento no longer lists
  { id_mensagem: '2005', boleano_entrante: '1', tip_msg: 'TEXTO', descricao_msg: 'esse', id_mensagem_resposta: '999' },
];

describe('quotedReplyOf', () => {
  it('returns our text bubble with the emoji decoded', () => {
    expect(quotedReplyOf(rows(), '2001')).toEqual({
      outcome: 'quoted',
      bubble: {
        externalId: '1001',
        text: 'Dr(a). *Exemplo Silva*, *Teleconsulta*\n📅 Hoje, *01/01*: 10:00 (é o único horário nesse dia)',
      },
    });
  });

  it('names every way the turn is not a quote of ours', () => {
    expect(quotedReplyOf(rows(), '2002')).toEqual({ outcome: 'tap' });
    expect(quotedReplyOf(rows(), '2003')).toEqual({ outcome: 'own' });
    expect(quotedReplyOf(rows(), '2004')).toEqual({ outcome: 'none' });
    expect(quotedReplyOf(rows(), '2005')).toEqual({ outcome: 'row-missing' });
    expect(quotedReplyOf(rows(), '404')).toEqual({ outcome: 'row-missing' });
  });
});

describe('inbound turn with a quoted reply', () => {
  let plugin: AscFlowPlugin;
  let eventBus: MockEventBus;
  let restore: (() => void) | undefined;
  let atendimentoReads = 0;

  const env = { hold: process.env.ASC_FLOW_HOLD_MS, lookup: process.env.ASC_FLOW_QUOTE_LOOKUP_MS };

  afterEach(async () => {
    await plugin?.destroy();
    restore?.();
    restore = undefined;
    // The suite shares one process: leave both knobs as the helpers set them.
    process.env.ASC_FLOW_HOLD_MS = env.hold;
    if (env.lookup === undefined) Reflect.deleteProperty(process.env, 'ASC_FLOW_QUOTE_LOOKUP_MS');
    else process.env.ASC_FLOW_QUOTE_LOOKUP_MS = env.lookup;
  });

  /** Connect a plugin whose `GET /atendimento` answers with `atendimento`. */
  async function boot(atendimento: () => Response | Promise<Response>): Promise<void> {
    atendimentoReads = 0;
    const counted = () => {
      atendimentoReads++;
      return atendimento();
    };
    restore = stubPlatform({ '/atendimento': counted as () => Response }).restore;
    eventBus = new MockEventBus();
    plugin = new AscFlowPlugin();
    await plugin.initialize(createContext(eventBus));
    await connectPlugin(plugin);
  }

  /** Post one typed turn and return the single `message.received` payload it published. */
  async function received(chatInput: string, messageId?: string): Promise<Record<string, unknown>> {
    await plugin.handleWebhook(
      new Request(`http://localhost/api/v2/channels/asc-flow/${instanceId}/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codAtendimento: COD, chatInput, ...(messageId ? { messageId } : {}) }),
      }),
    );
    const events = eventBus.published.filter((e) => e.type.includes('received'));
    expect(events).toHaveLength(1);
    return events[0]?.payload as Record<string, unknown>;
  }

  const outcomeOf = (payload: Record<string, unknown>) =>
    (payload.rawPayload as { ascFlow?: Record<string, unknown> }).ascFlow?.quotedReply;
  const textOf = (payload: Record<string, unknown>) => (payload.content as { text: string }).text;
  const late = () => new Promise<Response>((r) => setTimeout(() => r(jsonResponse({ mensagens: rows() })), 2_000));

  it('carries the quoted bubble as the typed quote, never as replyToId', async () => {
    await boot(() => jsonResponse({ mensagens: rows() }));
    const payload = await received('Quero essa opção', '2001');
    expect(payload.replyTo).toEqual({
      externalId: '1001',
      chatId: COD,
      fromMe: true,
      type: 'text',
      text: expect.stringContaining('📅 Hoje'),
    });
    // The dispatcher answers "in reply to" replyToId: our answer must not quote our own bubble.
    expect(payload.replyToId).toBeUndefined();
    expect(textOf(payload)).toBe('Quero essa opção');
    expect(outcomeOf(payload)).toBe('quoted');
  });

  it('sends a tap without a quote', async () => {
    await boot(() => jsonResponse({ mensagens: rows() }));
    const payload = await received('Confirmar', '2002');
    expect(payload.replyTo).toBeUndefined();
    expect(outcomeOf(payload)).toBe('tap');
  });

  it('survives entries in `mensagens` that are not objects', async () => {
    await boot(() => jsonResponse({ mensagens: [null, 7, 'x', ...rows()] }));
    expect(outcomeOf(await received('Quero essa opção', '2001'))).toBe('quoted');
  });

  it('fails open when the record answers an error', async () => {
    await boot(() => new Response('boom', { status: 500 }));
    const payload = await received('Quero essa opção', '2001');
    expect(payload.replyTo).toBeUndefined();
    expect(textOf(payload)).toBe('Quero essa opção');
    expect(outcomeOf(payload)).toBe('error');
  });

  it('fails open when the read throws', async () => {
    await boot(() => {
      throw new TypeError('socket hang up');
    });
    const payload = await received('Quero essa opção', '2001');
    expect(payload.replyTo).toBeUndefined();
    expect(textOf(payload)).toBe('Quero essa opção');
    expect(outcomeOf(payload)).toBe('error');
  });

  it('aborts the read at the deadline and sends the turn without the quote', async () => {
    process.env.ASC_FLOW_QUOTE_LOOKUP_MS = '50';
    await boot(() => jsonResponse({ mensagens: [] }));
    // A read that only ends when its request is aborted.
    const stubbed = globalThis.fetch;
    let aborted = false;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (!String(input).includes('/atendimento')) return stubbed(input, init);
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(init.signal?.reason);
        });
      });
    }) as typeof fetch;
    const started = Date.now();
    const payload = await received('Quero essa opção', '2001');
    globalThis.fetch = stubbed;
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(aborted).toBe(true);
    expect(payload.replyTo).toBeUndefined();
    expect(textOf(payload)).toBe('Quero essa opção');
    expect(outcomeOf(payload)).toBe('timeout');
  });

  it('never reads when the lookup is turned off', async () => {
    process.env.ASC_FLOW_QUOTE_LOOKUP_MS = '0';
    await boot(() => jsonResponse({ mensagens: rows() }));
    const payload = await received('Quero essa opção', '2001');
    expect(atendimentoReads).toBe(0);
    expect(payload.replyTo).toBeUndefined();
    expect(outcomeOf(payload)).toBe('off');
  });

  it('records a flow body without messageId, which can never be quoted', async () => {
    await boot(() => jsonResponse({ mensagens: rows() }));
    const payload = await received('Quero essa opção');
    expect(atendimentoReads).toBe(0);
    expect(outcomeOf(payload)).toBe('no-message-id');
  });

  it('holds only what is left of the budget after the lookup', async () => {
    process.env.ASC_FLOW_HOLD_MS = '1000';
    process.env.ASC_FLOW_QUOTE_LOOKUP_MS = '300';
    await boot(late);
    const holds: number[] = [];
    plugin.waitForTurn = async (_instance, _cod, _text, holdMs) => {
      holds.push(holdMs);
      return null;
    };
    await received('Quero essa opção', '2001');
    expect(holds).toHaveLength(1);
    expect(holds[0]).toBeGreaterThan(0);
    expect(holds[0]).toBeLessThanOrEqual(700);
  });
});
