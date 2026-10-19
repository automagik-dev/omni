/**
 * A late handoff is never dropped.
 *
 * Production, 2026-10-15 (flow mode, synchronous node): 14 of 46 accepted
 * handoffs never left the bot. The agent's turn missed the 40s hold, the poll
 * returned `pronto:0`, and the answer carrying `hand_off: "sim"` was then either
 * discarded as a late answer (the beneficiary had typed again) or parked for a
 * text the flow never re-sent. The beneficiary read the invite; the flow kept
 * the bot.
 *
 * Ordinary late answers keep being dropped (see turn-integrity.test.ts): only a
 * handoff is carried, because it belongs to the atendimento, not to a message.
 */

import { afterEach, describe, expect, it } from 'bun:test';

import { AscFlowPlugin } from '../plugin';
import {
  MockEventBus,
  OK_BODY,
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

async function boot(overrides: Record<string, () => Response> = {}): Promise<void> {
  const stub = stubPlatform(overrides);
  calls = stub.calls;
  restore = stub.restore;
  eventBus = new MockEventBus();
  plugin = new AscFlowPlugin();
  await plugin.initialize(createContext(eventBus));
  await connectPlugin(plugin, {});
  calls.length = 0;
  eventBus.published.length = 0;
}

afterEach(async () => {
  await plugin?.destroy();
  restore?.();
});

const HANDOFF = { isHandoff: true, handoffQueue: 'VQ_WPP_PF_NTX_AGENDAR_CONSULTAS_HV' };

type Entry = { at: number; text: string; correlationId?: string; ready?: unknown };
const turns = () =>
  (plugin as unknown as { ascFlowInstances: Map<string, { inFlight: Map<string, Entry> }> }).ascFlowInstances.get(
    instanceId,
  )?.inFlight;

const send = (text: string, metadata: Record<string, unknown> = {}) =>
  plugin.sendMessage(instanceId, { to: '42', content: { type: 'text', text } as never, metadata });

describe('a late handoff rides the turn now in flight', () => {
  it('carries a handoff whose own turn already closed into the newer turn', async () => {
    await boot();
    await openTurn(plugin, '42', 'Chamar especialista');
    const traceA = turns()?.get('42')?.correlationId;

    // Turn A missed the hold and was released empty, as production does.
    const a = turns()?.get('42');
    if (a) a.at -= 200_000;
    expect(plugin.takeReadyTurn(instanceId, '42', 'Chamar especialista')).toMatchObject({ resposta: '' });

    // The beneficiary typed again; turn B opened under the same cod.
    await openTurn(plugin, '42', 'Ok');
    const b = turns()?.get('42');
    if (b) b.correlationId = 'trace-B';

    // A's handoff finally arrives with A's trace.
    await send('Convidamos um especialista neste topico para entrar nesta conversa.', {
      ...HANDOFF,
      correlationId: traceA,
    });

    expect(plugin.takeReadyTurn(instanceId, '42', 'Ok')).toMatchObject({
      hand_off: 'sim',
      fila_vq: 'VQ_WPP_PF_NTX_AGENDAR_CONSULTAS_HV',
    });
  });

  it('pushes the newer turn ordinary answer as a bubble instead of losing it', async () => {
    // B's own answer fails to reach the handset, so it only lives in the parked
    // body; the late handoff takes that body over and must push it out.
    let attempt = 0;
    await boot({
      '/callbackFlowMsg': () =>
        ++attempt === 1 ? jsonResponse({ cod_error: 1, sucesso: 0 }, 500) : jsonResponse(OK_BODY),
    });
    await openTurn(plugin, '42', 'Chamar especialista');
    const traceA = turns()?.get('42')?.correlationId;
    const a = turns()?.get('42');
    if (a) a.at -= 200_000;
    plugin.takeReadyTurn(instanceId, '42', 'Chamar especialista');

    await openTurn(plugin, '42', 'Ok');
    const b = turns()?.get('42');
    if (b) b.correlationId = 'trace-B';
    await send('Seguimos por aqui.', { correlationId: 'trace-B' });
    calls.length = 0;

    await send('Convidamos um especialista.', { ...HANDOFF, correlationId: traceA });

    expect(plugin.takeReadyTurn(instanceId, '42', 'Ok')?.hand_off).toBe('sim');
    expect(calls.some((c) => c.path === '/callbackFlowMsg' && c.body.msg_usuario === 'Seguimos por aqui.')).toBe(true);
  });

  it('does not push again an ordinary answer that already reached the handset', async () => {
    await boot();
    await openTurn(plugin, '42', 'Chamar especialista');
    const traceA = turns()?.get('42')?.correlationId;
    const a = turns()?.get('42');
    if (a) a.at -= 200_000;
    plugin.takeReadyTurn(instanceId, '42', 'Chamar especialista');

    await openTurn(plugin, '42', 'Ok');
    const b = turns()?.get('42');
    if (b) b.correlationId = 'trace-B';
    await send('Seguimos por aqui.', { correlationId: 'trace-B' });
    calls.length = 0;

    await send('Convidamos um especialista.', { ...HANDOFF, correlationId: traceA });

    expect(calls.some((c) => c.body.msg_usuario === 'Seguimos por aqui.')).toBe(false);
  });

  it('keeps a newer parked handoff over an older late one', async () => {
    await boot();
    await openTurn(plugin, '42', 'Chamar especialista');
    const traceA = turns()?.get('42')?.correlationId;
    const a = turns()?.get('42');
    if (a) a.at -= 200_000;
    plugin.takeReadyTurn(instanceId, '42', 'Chamar especialista');

    await openTurn(plugin, '42', 'quero falar com alguem');
    const b = turns()?.get('42');
    if (b) b.correlationId = 'trace-B';
    await send('Convidamos (B).', { ...HANDOFF, handoffQueue: 'FILA_B', correlationId: 'trace-B' });

    await send('Convidamos (A).', { ...HANDOFF, correlationId: traceA });

    expect(plugin.takeReadyTurn(instanceId, '42', 'quero falar com alguem')?.fila_vq).toBe('FILA_B');
  });
});

describe('a parked handoff is collected by the next poll, whatever its text', () => {
  it('delivers a parked handoff on a newer input', async () => {
    await boot();
    await openTurn(plugin);
    await send('Convidamos um especialista.', HANDOFF);

    // The synchronous node only calls again on the beneficiary's next message.
    expect(plugin.takeReadyTurn(instanceId, '42', 'alguem vai me atender?')).toMatchObject({
      hand_off: 'sim',
    });
    expect(turns()?.has('42')).toBe(false);
  });

  it('remembers the text it answered, so a re-send of it reads as a replay', async () => {
    await boot();
    await openTurn(plugin);
    await send('Convidamos um especialista.', HANDOFF);

    plugin.takeReadyTurn(instanceId, '42', 'alguem vai me atender?');

    const answered = (
      plugin as unknown as {
        ascFlowInstances: Map<string, { lastAnswered: Map<string, string> }>;
      }
    ).ascFlowInstances.get(instanceId)?.lastAnswered;
    expect(answered?.get('42')).toBe('alguem vai me atender?');
  });

  it('still never spends an ORDINARY parked answer on a different message', async () => {
    await boot();
    await openTurn(plugin);
    await send('a resposta');

    expect(plugin.takeReadyTurn(instanceId, '42', 'mudei de ideia')).toBeNull();
    expect(plugin.takeReadyTurn(instanceId, '42', TURN_TEXT)).toMatchObject({ pronto: 1 });
  });
});

describe('a parked handoff outlives the ordinary turn TTL', () => {
  it('survives the sweep past 150s and is still collected', async () => {
    await boot();
    await openTurn(plugin);
    await send('Convidamos um especialista.', HANDOFF);
    const entry = turns()?.get('42');
    if (entry) entry.at -= 10 * 60_000; // 10 minutes of silence

    const p = plugin as unknown as {
      ascFlowInstances: Map<string, { lastSweepAt: number }>;
      sweepInFlight: (id: string, state: unknown) => void;
    };
    const state = p.ascFlowInstances.get(instanceId);
    if (state) state.lastSweepAt = 0;
    p.sweepInFlight(instanceId, state);

    expect(plugin.takeReadyTurn(instanceId, '42', 'oi?')?.hand_off).toBe('sim');
  });

  it('an ordinary parked answer is still swept after the TTL', async () => {
    await boot();
    await openTurn(plugin);
    await send('a resposta');
    const entry = turns()?.get('42');
    if (entry) entry.at -= 10 * 60_000;

    const p = plugin as unknown as {
      ascFlowInstances: Map<string, { lastSweepAt: number }>;
      sweepInFlight: (id: string, state: unknown) => void;
    };
    const state = p.ascFlowInstances.get(instanceId);
    if (state) state.lastSweepAt = 0;
    p.sweepInFlight(instanceId, state);

    expect(turns()?.has('42')).toBe(false);
  });
});
