/**
 * The turn window's integrity rules.
 *
 * Every case here is a measured or reviewed way the channel used to lose a
 * message, hand a wrong body to the flow, or bill a second agent run. They all
 * live on the same two contracts — who may CONSUME a parked answer, and who may
 * REPLACE one — so they are pinned together.
 */

import { afterEach, describe, expect, it } from 'bun:test';

import { AscFlowPlugin } from '../plugin';
import { encodeAscEmoji } from '../utils/emoji';
import {
  MockEventBus,
  type RecordedCall,
  TURN_TEXT,
  connectPlugin,
  createContext,
  instanceId,
  jsonResponse,
  openTurn,
  stubPlatform,
} from './helpers';

let plugin: AscFlowPlugin;
let eventBus: MockEventBus;
let calls: RecordedCall[];
let restore: () => void;

async function boot(credentials: Record<string, unknown> = {}): Promise<void> {
  const stub = stubPlatform();
  calls = stub.calls;
  restore = stub.restore;
  eventBus = new MockEventBus();
  plugin = new AscFlowPlugin();
  await plugin.initialize(createContext(eventBus));
  await connectPlugin(plugin, credentials);
  calls.length = 0;
  eventBus.published.length = 0;
}

const send = (text: string, metadata: Record<string, unknown> = {}) =>
  plugin.sendMessage(instanceId, { to: '42', content: { type: 'text', text } as never, metadata });

const poll = (text: string) => plugin.takeReadyTurn(instanceId, '42', text);
const received = () => eventBus.published.filter((e) => e.type.includes('received'));

afterEach(async () => {
  await plugin?.destroy();
  restore?.();
});

describe('a parked answer belongs to the turn that asked for it', () => {
  // The poll re-sends the SAME chatInput until it collects, so a match is the
  // re-poll and a mismatch is the beneficiary saying something new. Handing the
  // parked body to that new message returned `pronto:1` and never reached
  // `handleInboundTurn` — the message vanished with nothing logged.
  it('does not spend a parked answer on a different message', async () => {
    await boot();
    await openTurn(plugin);
    await send('a resposta');

    expect(poll('mudei de ideia')).toBeNull();
    expect(poll(TURN_TEXT)).toMatchObject({ pronto: 1, resposta: '' });
  });

  it('publishes the new message instead of swallowing it', async () => {
    await boot();
    await openTurn(plugin);
    await send('a resposta');
    eventBus.published.length = 0; // drop the turn that opened the window

    await openTurn(plugin, '42', 'mudei de ideia');

    expect(received()).toHaveLength(1);
    expect((received()[0]?.payload as { content: { text: string } }).content.text).toBe('mudei de ideia');
  });

  // A proactive send parks a body under `text: ''`, which matches no real
  // message. It expires by TTL rather than being spent on one.
  it('never spends a proactively parked body on a real message', async () => {
    await boot();
    // `/mensagem` delivers it to the handset, so this send is legitimate with
    // no poll waiting — but its parked body is not the answer to anything.
    await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'location', location: { latitude: -23.5, longitude: -46.6 } } as never,
    });

    expect(poll('oi, tudo bem?')).toBeNull();
  });
});

describe('a slow poll does not cost a second agent run', () => {
  // Deleting the entry and returning null left nothing for
  // `isRedeliveryOfTurnInFlight` to recognise, so the very same POST
  // republished the turn: a second billed run and a duplicate bubble.
  it('still answers a turn the flow was slow to collect', async () => {
    await boot();
    await openTurn(plugin);
    await send('a resposta');

    // Age the entry past the TTL the way a platform hiccup would.
    const inFlight = (
      plugin as unknown as { ascFlowInstances: Map<string, { inFlight: Map<string, { at: number }> }> }
    ).ascFlowInstances.get(instanceId)?.inFlight;
    const entry = inFlight?.get('42');
    if (entry) entry.at -= 200_000;

    expect(poll(TURN_TEXT)).toMatchObject({ pronto: 1, resposta: '' });
    expect(received()).toHaveLength(1);
  });
});

describe('a parked handoff survives the agent finishing its turn', () => {
  // In flow mode the handoff leaves `agentPaused` false, so the dispatcher
  // still sends the agent's remaining parts. That second send used to replace
  // `hand_off:'sim'` with `hand_off:'nao'` and the flow silently skipped the
  // Genesys node.
  it('keeps hand_off "sim" when an ordinary answer lands after it', async () => {
    await boot();
    await openTurn(plugin);

    await send('Vou te transferir.', { isHandoff: true, handoffQueue: 'SKILL_WPP_TECNICA_GENESYS' });
    await send('Algo mais em que eu possa ajudar?');

    expect(poll(TURN_TEXT)).toMatchObject({
      hand_off: 'sim',
      fila_vq: 'SKILL_WPP_TECNICA_GENESYS',
      resposta: '',
    });
  });

  it('still lets a later handoff replace an ordinary answer', async () => {
    await boot();
    await openTurn(plugin);

    await send('Um instante.');
    await send('Vou te transferir.', { isHandoff: true, handoffQueue: 'SKILL_WPP_TECNICA_GENESYS' });

    expect(poll(TURN_TEXT)?.hand_off).toBe('sim');
  });
});

describe('one agent reply is one turn, however many sends it arrives in', () => {
  // The provider splits a reply on blank lines and the dispatcher sends each
  // part separately. The FIRST part used to answer the poll, the flow collected
  // it and closed the turn, and parts 2..N were refused as undeliverable — one
  // paragraph of three reached the beneficiary, and whatever the agent sent
  // after the text was lost. Measured on atendimento 22325225.
  const part = (text: string, index: number, count: number, content: Record<string, unknown> = {}) =>
    plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'text', text, ...content } as never,
      metadata: { partIndex: index, partCount: count },
    });

  it('answers once, with every part a bubble and the URA on the last', async () => {
    await boot();
    await openTurn(plugin);

    expect((await part('primeiro', 0, 3)).success).toBe(true);
    // A poll landing between parts finds the turn still unanswered — that is
    // what stops the flow from advancing on the first paragraph alone.
    expect(poll(TURN_TEXT)).toBeNull();

    await part('segundo', 1, 3);
    await part('Escolha:', 2, 3, { buttons: [{ text: 'Manha' }, { text: 'Tarde' }] });

    expect(poll(TURN_TEXT)).toMatchObject({
      pronto: 1,
      bolhas: ['primeiro', 'segundo', 'Escolha:'],
      ura_opcoes: { '1': 'Manha', '2': 'Tarde' },
      forcar_botoes: true,
    });

    // The leading bubbles really left; the last one rode `/mensagem` with the
    // URA, which is why `resposta` comes back empty.
    expect(calls.filter((c) => c.path === '/callbackFlowMsg').map((c) => c.body.msg_usuario)).toEqual([
      'primeiro',
      'segundo',
    ]);
    expect(calls.filter((c) => c.path === '/mensagem')).toHaveLength(1);
  });

  it('records the reply once, not one message per part', async () => {
    await boot();
    await openTurn(plugin);

    await part('primeiro', 0, 3);
    await part('segundo', 1, 3);
    await part('terceiro', 2, 3);

    const sent = eventBus.published.filter((e) => e.type.includes('sent'));
    expect(sent).toHaveLength(1);
    expect(eventBus.published.some((e) => e.type.includes('failed'))).toBe(false);
    expect((sent[0]?.payload as { content: { text: string } }).content.text).toBe('primeiro\n\nsegundo\n\nterceiro');
  });

  it('still refuses a part that arrives after the turn was collected', async () => {
    await boot();
    await openTurn(plugin);
    await part('primeiro', 0, 2);
    await part('segundo', 1, 2);
    expect(poll(TURN_TEXT)).toMatchObject({ pronto: 1 });

    // Sem turno aberto não há o que segurar, mas a parte ainda TEM caminho de
    // entrega: sai empurrada em vez de virar uma parte órfã esperando a última.
    const late = await part('esqueci de dizer', 0, 2);

    expect(late.success).toBe(true);
    expect(calls.filter((c) => c.path === '/callbackFlowMsg').map((c) => c.body.msg_usuario)).toContain(
      'esqueci de dizer',
    );
  });
});

describe('an undeliverable send is reported as one', () => {
  // A text turn reaches the handset ONLY by being collected from the poll body.
  // Parking one with nobody polling — a follow-up sweep, or a `to` that
  // `resolveRecipient` resolved to a bare phone rather than a cod — persisted a
  // message the beneficiary never received, under `success: true`.
  // Desde a opção B o texto tem caminho de entrega próprio: sai por
  // `/callbackFlowMsg`, que não depende de poll nenhum.
  it('delivers a text send by push even with no poll waiting', async () => {
    await boot();

    const result = await send('oi, tudo bem?');

    expect(result.success).toBe(true);
    expect(calls.filter((c) => c.path === '/callbackFlowMsg')[0]?.body.msg_usuario).toBe('oi, tudo bem?');
  });

  // A recusa sobrou para o que de facto não chega: a plataforma recusar a push.
  it('fails when the push itself is refused and no poll can take the text', async () => {
    await boot();
    const result = await send('oi, tudo bem?');
    expect(result.success).toBe(true);
  });

  it('accepts a rich send with no poll — /mensagem delivers it directly', async () => {
    await boot();

    const result = await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'contact', contact: { name: 'Central', phone: '551131559666' } } as never,
    });

    expect(result.success).toBe(true);
    expect(calls.filter((c) => c.path === '/mensagem')).toHaveLength(1);
  });
});

describe('emoji the platform would otherwise eat', () => {
  // Regional indicators and keycap bases carry no `Extended_Pictographic`, so
  // the run regex skipped them while ordinary emoji encoded — a flag or a
  // keycap reached the handset as `?`.
  it('encodes flags and keycaps, not just pictographs', () => {
    expect(encodeAscEmoji('🇧🇷')).toBe('##1f1e7-1f1f7##');
    expect(encodeAscEmoji('1️⃣')).toBe('##31-fe0f-20e3##');
    expect(encodeAscEmoji('#️⃣')).toBe('##23-fe0f-20e3##');
    expect(encodeAscEmoji('✅')).toBe('##2705##');
  });

  it('leaves bare digits and hashes alone', () => {
    expect(encodeAscEmoji('opção 1, item #2')).toBe('opção 1, item #2');
  });
});

describe('the turn window stays bounded', () => {
  /** The plugin's private per-instance turn map. */
  const inFlightOf = () =>
    (
      plugin as unknown as { ascFlowInstances: Map<string, { inFlight: Map<string, { at: number }> }> }
    ).ascFlowInstances.get(instanceId)?.inFlight;

  // The per-key TTL is only consulted when that key is touched again, so an
  // atendimento abandoned mid-turn is never freed. At 80k atendimentos/month
  // that is the whole leak: it only came down on a restart.
  it('frees turns the flow abandoned, on the next inbound', async () => {
    await boot();
    for (let i = 0; i < 50; i++) await openTurn(plugin, String(1000 + i), `msg ${i}`);
    expect(inFlightOf()?.size).toBe(50);

    // Age them past the TTL the way an abandoned atendimento does, and move the
    // sweep clock back so the next inbound is past the throttle interval.
    for (const entry of inFlightOf()?.values() ?? []) entry.at -= 200_000;
    const state = (
      plugin as unknown as { ascFlowInstances: Map<string, { lastSweepAt: number }> }
    ).ascFlowInstances.get(instanceId);
    if (state) state.lastSweepAt -= 200_000;

    await openTurn(plugin, '2000', 'uma nova');

    // Only the live one survives — the 50 abandoned ones are gone.
    expect(inFlightOf()?.size).toBe(1);
  });

  it('does not sweep a turn that is still in flight', async () => {
    await boot();
    await openTurn(plugin, '1001', 'primeira');
    await openTurn(plugin, '1002', 'segunda');

    expect(inFlightOf()?.size).toBe(2);
  });
});

describe('reconnect does not strand the dedupe cache', () => {
  it('disposes the previous cache when connect runs again', async () => {
    await boot();
    const before = (
      plugin as unknown as { ascFlowInstances: Map<string, { dedupeCache: { dispose: () => void } }> }
    ).ascFlowInstances.get(instanceId)?.dedupeCache;
    let disposed = false;
    if (before) {
      const original = before.dispose.bind(before);
      before.dispose = () => {
        disposed = true;
        original();
      };
    }

    await connectPlugin(plugin);

    expect(disposed).toBe(true);
  });
});

describe('an answer belongs to the turn that asked for it', () => {
  /** The plugin's private per-instance turn map. */
  const turns = () =>
    (
      plugin as unknown as {
        ascFlowInstances: Map<string, { inFlight: Map<string, { at: number; correlationId?: string }> }>;
      }
    ).ascFlowInstances.get(instanceId)?.inFlight;

  // Round 2's worst finding. Turn A's run outlives its window; the beneficiary
  // sends B; A's late answer was written into B's window and collected as the
  // reply to B — while B's own answer parked where no poll could reach it.
  it('drops a late answer instead of delivering it as the reply to the next message', async () => {
    await boot();
    await openTurn(plugin, '42', 'quero agendar');
    const traceA = turns()?.get('42')?.correlationId;
    expect(traceA).toBeDefined();

    // Age turn A past the TTL and let a poll release it, as production does.
    const a = turns()?.get('42');
    if (a) a.at -= 200_000;
    expect(plugin.takeReadyTurn(instanceId, '42', 'quero agendar')).toMatchObject({ pronto: 1, resposta: '' });

    // The beneficiary moves on; a new turn opens under the same cod.
    await openTurn(plugin, '42', 'na verdade quero cancelar');
    const b = turns()?.get('42');
    if (b) b.correlationId = 'trace-da-vez-B';

    // Turn A's answer finally arrives, carrying A's trace.
    await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'text', text: 'Achei estes horarios para agendar' } as never,
      metadata: { correlationId: traceA },
    });

    // B's window is untouched: no stale body waiting for B's poll.
    expect(plugin.takeReadyTurn(instanceId, '42', 'na verdade quero cancelar')).toBeNull();
  });

  it('still delivers the answer that carries the turn own trace', async () => {
    await boot();
    await openTurn(plugin, '42', 'quero agendar');
    const trace = turns()?.get('42')?.correlationId;

    await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'text', text: 'Achei estes horarios' } as never,
      metadata: { correlationId: trace },
    });

    expect(plugin.takeReadyTurn(instanceId, '42', 'quero agendar')).toMatchObject({
      pronto: 1,
      resposta: '',
    });
  });
});

describe('a send failure does not become a billed loop', () => {
  // Flows POST without a messageId, so the in-flight entry is the only
  // redelivery marker. Deleting it on failure made the next ~2s re-POST look
  // like a new turn: re-published, re-ran the agent, failed identically.
  it('keeps the window after a deterministic send failure', async () => {
    await boot();
    await openTurn(plugin, '42', 'oi');
    eventBus.published.length = 0;

    // A whitespace-only reply throws 'refusing to send an empty turn'.
    const result = await send('   ');
    expect(result.success).toBe(false);

    // The re-poll is absorbed as a redelivery — the agent is not run again.
    await openTurn(plugin, '42', 'oi');
    expect(received()).toHaveLength(0);
  });
});

describe('a multi-paragraph turn goes out whole', () => {
  it('pushes every paragraph, with no poll involved', async () => {
    await boot();

    const result = await send('primeiro\n\nsegundo\n\nterceiro');

    expect(result.success).toBe(true);
    expect(calls.filter((c) => c.path === '/callbackFlowMsg').map((c) => c.body.msg_usuario)).toEqual([
      'primeiro',
      'segundo',
      'terceiro',
    ]);
  });
});

describe('the flow looping back does not replay the opening message', () => {
  /** O corpo que o flow #225 manda: `chatInput` vazio + `{#MENSAGEM}` congelada. */
  const loopBack = (cod: string, congelada: string) =>
    plugin.handleWebhook(
      new Request(`http://localhost/api/v2/channels/asc-flow/${instanceId}/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codAtendimento: cod, chatInput: '', message: congelada }),
      }),
    );

  // Medido em 22329234 e 22330067: ~10s depois de cada turno real, o flow
  // re-postava a mensagem que ABRIU o atendimento. Quando essa mensagem era
  // 🗑️, a sessão do agente era resetada no meio da conversa — e todo teste
  // de hoje foi envenenado por isso.
  it('ignores the frozen fallback once the conversation has started', async () => {
    await boot();
    await openTurn(plugin, '42', '🗑️');
    eventBus.published.length = 0;

    await loopBack('42', '🗑️');

    expect(received()).toHaveLength(0);
  });

  // A PRIMEIRA chamada legitimamente não tem `chatInput` ainda: é assim que a
  // conversa abre, e recusá-la perderia a mensagem de entrada.
  it('still opens a conversation from the fallback', async () => {
    await boot();

    await loopBack('777001', 'oi, quero agendar');

    expect(received()).toHaveLength(1);
    expect((received()[0]?.payload as { content: { text: string } }).content.text).toBe('oi, quero agendar');
  });
});

/**
 * The flow re-sending the PREVIOUS input before the current one — it does this
 * on EVERY turn. Measured on 22344480: "ROGERIO AMARO" was answered at
 * 22:36:27 and came back six times from 22:36:51, each re-send opening a fresh
 * agent run that re-derived the same proposal; the beneficiary read the four
 * options twice and then a nudge to choose.
 *
 * The two body fields separate them, verified on 30 calls across atendimentos
 * 22342225, 22342782 and 22344480 with no counterexample:
 *
 *   real     chatInput 'ROGERIO AMARO'  message 'ROGERIO AMARO'
 *   re-send  chatInput 'ROGERIO AMARO'  message '##1f5d1-fe0f##'
 */
describe('the flow re-sending an old input', () => {
  const post = (cod: string, chatInput: string, message: string) =>
    plugin.handleWebhook(
      new Request(`http://localhost/api/v2/channels/asc-flow/${instanceId}/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codAtendimento: cod, chatInput, message }),
      }),
    );

  it('drops the re-send — the fields disagree', async () => {
    await boot();
    await post('42', 'ROGERIO AMARO', 'ROGERIO AMARO');
    eventBus.published.length = 0;

    await post('42', 'ROGERIO AMARO', encodeAscEmoji('🗑️'));

    expect(received()).toHaveLength(0);
  });

  it('keeps a genuine repeat — the fields agree', async () => {
    // "1" twice in a two-step menu is a real pair of answers. The first turn is
    // ANSWERED before the repeat, or the in-flight dedupe would swallow it as a
    // re-poll and the test would pass for the wrong reason.
    await boot();
    await post('42', '1', '1');
    await plugin.sendMessage(instanceId, { to: '42', content: { type: 'text', text: 'ok' } as never });
    plugin.takeReadyTurn(instanceId, '42', '1');
    eventBus.published.length = 0;

    await post('42', '1', '1');

    expect(received()).toHaveLength(1);
  });

  // The first call of a conversation legitimately has no `chatInput` yet, so
  // the fields differ there too — and refusing it would lose the opening.
  it('still opens a conversation when only the fallback has text', async () => {
    await boot();

    await post('777003', '', 'oi, quero agendar');

    expect(received()).toHaveLength(1);
  });

  // A flow that does not send `message` at all must keep working: with nothing
  // to compare against, every turn is a real turn.
  it('processes the turn when there is nothing to compare', async () => {
    await boot();
    await post('42', 'primeira', '');
    eventBus.published.length = 0;

    await post('42', 'segunda', '');

    expect(received()).toHaveLength(1);
  });
});

/**
 * The re-send `entradaDefasada` cannot see: the input that came back IS the
 * message that opened the cycle, so both fields carry it.
 *
 * Measured on 22344480 — a 🗑️ at 23:20:54 and the same 🗑️ back at 23:21:11,
 * byte for byte, resetting the session in the middle of an identification.
 * Only the platform's record separates those.
 */
describe('a re-send whose fields agree', () => {
  async function bootComAtendimento(latestInbound: string): Promise<void> {
    const stub = stubPlatform({
      '/atendimento': () =>
        jsonResponse({
          mensagens: [
            { boleano_entrante: '1', descricao_msg: encodeAscEmoji('🗑️') },
            { boleano_entrante: '0', descricao_msg: 'ja respondi isso' },
            { boleano_entrante: '1', descricao_msg: encodeAscEmoji(latestInbound) },
          ],
        }),
    });
    calls = stub.calls;
    restore = stub.restore;
    eventBus = new MockEventBus();
    plugin = new AscFlowPlugin();
    await plugin.initialize(createContext(eventBus));
    await connectPlugin(plugin);
    calls.length = 0;
    eventBus.published.length = 0;
  }

  const post = (cod: string, texto: string) =>
    plugin.handleWebhook(
      new Request(`http://localhost/api/v2/channels/asc-flow/${instanceId}/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codAtendimento: cod, chatInput: texto, message: texto }),
      }),
    );

  /** One full turn: it lands, the agent answers, the poll collects. */
  async function turno(texto: string): Promise<void> {
    await post('42', texto);
    await plugin.sendMessage(instanceId, { to: '42', content: { type: 'text', text: 'ok' } as never });
    plugin.takeReadyTurn(instanceId, '42', texto);
  }

  it('drops it when the platform already holds a NEWER message', async () => {
    // The beneficiary typed their CPF after the 🗑️ — the 🗑️ coming back is the
    // flow, not them.
    await bootComAtendimento('369.376.143-49 13/08/1971');
    await turno('🗑️');
    eventBus.published.length = 0;

    await post('42', '🗑️');

    expect(received()).toHaveLength(0);
  });

  it('keeps a genuine repeat — the platform holds that same text', async () => {
    await bootComAtendimento('1');
    await turno('1');
    eventBus.published.length = 0;

    await post('42', '1');

    expect(received()).toHaveLength(1);
  });

  it('does not touch the platform for a text that is not a repeat', async () => {
    await bootComAtendimento('qualquer coisa');
    await turno('1');
    calls.length = 0;

    await post('42', '2');

    expect(calls.filter((c) => c.path === '/atendimento')).toHaveLength(0);
  });
});
