/**
 * WhatsApp "Reply" on one of our bubbles (omni#1617).
 *
 * The flow body carries only the typed text; the platform record says what it
 * quoted (`id_mensagem_resposta`). Shapes below are the rows measured on
 * production atendimentos 23906969 and 23946532 (06/11/2026), texts shortened.
 */

import { afterEach, describe, expect, it } from 'bun:test';

import { AscFlowPlugin } from '../plugin';
import { quotedBubbleOf } from '../utils/atendimento';
import { MockEventBus, connectPlugin, createContext, instanceId, jsonResponse, stubPlatform } from './helpers';

const BOLHA = 'Dr(a). *Lucas Naves*, *Teleconsulta*\n##1f4c5## Hoje, *28/10*: 14:15 (é o único horário nesse dia)';
const MENU = 'Podemos confirmar o agendamento?\nConfirmar\nAlterar\n\n';

const rows = () => [
  { id_mensagem: '145132791', boleano_entrante: '0', tip_msg: 'TEXTO', descricao_msg: BOLHA },
  { id_mensagem: '145133000', boleano_entrante: '0', tip_msg: '15', descricao_msg: MENU },
  { id_mensagem: '145133100', boleano_entrante: '1', tip_msg: 'TEXTO', descricao_msg: 'oi' },
  // "Quero essa opção" quoting the option bubble
  {
    id_mensagem: '145142185',
    boleano_entrante: '1',
    tip_msg: 'TEXTO',
    descricao_msg: 'Quero essa opção',
    id_mensagem_resposta: '145132791',
  },
  // a tap on "Confirmar": the platform links it to the interactive message
  {
    id_mensagem: '145142300',
    boleano_entrante: '1',
    tip_msg: 'TEXTO',
    descricao_msg: 'Confirmar',
    id_mensagem_resposta: '145133000',
  },
  // a reply to the beneficiary's own message
  {
    id_mensagem: '145142400',
    boleano_entrante: '1',
    tip_msg: 'TEXTO',
    descricao_msg: 'isso',
    id_mensagem_resposta: '145133100',
  },
  {
    id_mensagem: '145142500',
    boleano_entrante: '1',
    tip_msg: 'TEXTO',
    descricao_msg: 'sem citação',
    id_mensagem_resposta: null,
  },
];

describe('quotedBubbleOf', () => {
  it('returns our text bubble with the emoji decoded', () => {
    expect(quotedBubbleOf(rows(), '145142185')).toEqual({
      externalId: '145132791',
      text: 'Dr(a). *Lucas Naves*, *Teleconsulta*\n📅 Hoje, *28/10*: 14:15 (é o único horário nesse dia)',
    });
  });

  it('ignores a tap: the quoted row is the interactive message, not a text bubble', () => {
    expect(quotedBubbleOf(rows(), '145142300')).toBeNull();
  });

  it("ignores a reply to the beneficiary's own message, a turn without reply and an unknown id", () => {
    for (const id of ['145142400', '145142500', '999']) expect(quotedBubbleOf(rows(), id)).toBeNull();
  });
});

describe('inbound turn with a quoted reply', () => {
  let plugin: AscFlowPlugin;
  let eventBus: MockEventBus;
  let restore: (() => void) | undefined;

  const env = { hold: process.env.ASC_FLOW_HOLD_MS, lookup: process.env.ASC_FLOW_QUOTE_LOOKUP_MS };

  afterEach(async () => {
    await plugin?.destroy();
    restore?.();
    // The suite shares one process: leave both knobs as the helpers set them.
    process.env.ASC_FLOW_HOLD_MS = env.hold;
    if (env.lookup === undefined) Reflect.deleteProperty(process.env, 'ASC_FLOW_QUOTE_LOOKUP_MS');
    else process.env.ASC_FLOW_QUOTE_LOOKUP_MS = env.lookup;
  });

  /** Connect a plugin whose `GET /atendimento` answers with `atendimento`. */
  async function boot(atendimento: () => Response | Promise<Response>): Promise<void> {
    restore = stubPlatform({ '/atendimento': atendimento as () => Response }).restore;
    eventBus = new MockEventBus();
    plugin = new AscFlowPlugin();
    await plugin.initialize(createContext(eventBus));
    await connectPlugin(plugin);
  }

  /** Post one typed turn and return the single `message.received` payload it published. */
  async function received(chatInput: string, messageId: string): Promise<Record<string, unknown>> {
    await plugin.handleWebhook(
      new Request(`http://localhost/api/v2/channels/asc-flow/${instanceId}/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codAtendimento: '23946532', chatInput, messageId }),
      }),
    );
    const events = eventBus.published.filter((e) => e.type.includes('received'));
    expect(events).toHaveLength(1);
    return events[0]?.payload as Record<string, unknown>;
  }

  it('carries the quoted bubble as the typed quote, never as replyToId', async () => {
    await boot(() => jsonResponse({ mensagens: rows() }));
    const payload = await received('Quero essa opção', '145142185');
    expect(payload.replyTo).toEqual({
      externalId: '145132791',
      chatId: '23946532',
      fromMe: true,
      type: 'text',
      text: expect.stringContaining('📅 Hoje'),
    });
    // The dispatcher answers "in reply to" replyToId: our answer must not quote our own bubble.
    expect(payload.replyToId).toBeUndefined();
    expect((payload.content as { text: string }).text).toBe('Quero essa opção');
  });

  it('sends a tap without a quote', async () => {
    await boot(() => jsonResponse({ mensagens: rows() }));
    expect((await received('Confirmar', '145142300')).replyTo).toBeUndefined();
  });

  it('fails open: the turn goes out without the quote when the record answers an error', async () => {
    await boot(() => new Response('boom', { status: 500 }));
    const payload = await received('Quero essa opção', '145142185');
    expect(payload.replyTo).toBeUndefined();
    expect((payload.content as { text: string }).text).toBe('Quero essa opção');
  });

  it('stops waiting at the lookup deadline and sends the turn without the quote', async () => {
    process.env.ASC_FLOW_QUOTE_LOOKUP_MS = '50';
    const late = () => new Promise<Response>((r) => setTimeout(() => r(jsonResponse({ mensagens: rows() })), 2_000));
    await boot(late);
    const started = Date.now();
    const payload = await received('Quero essa opção', '145142185');
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(payload.replyTo).toBeUndefined();
    expect((payload.content as { text: string }).text).toBe('Quero essa opção');
  });

  it('holds only what is left of the budget after the lookup', async () => {
    process.env.ASC_FLOW_HOLD_MS = '1000';
    process.env.ASC_FLOW_QUOTE_LOOKUP_MS = '300';
    const late = () => new Promise<Response>((r) => setTimeout(() => r(jsonResponse({ mensagens: rows() })), 2_000));
    await boot(late);
    const holds: number[] = [];
    plugin.waitForTurn = async (_instance, _cod, _text, holdMs) => {
      holds.push(holdMs);
      return null;
    };
    await received('Quero essa opção', '145142185');
    expect(holds).toHaveLength(1);
    expect(holds[0]).toBeGreaterThan(0);
    expect(holds[0]).toBeLessThanOrEqual(700);
  });
});
