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
    expect(poll(TURN_TEXT)).toMatchObject({ pronto: 1, resposta: 'a resposta' });
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
    if (entry) entry.at -= 120_000;

    expect(poll(TURN_TEXT)).toMatchObject({ pronto: 1, resposta: 'a resposta' });
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
      resposta: 'Vou te transferir.',
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

describe('an undeliverable send is reported as one', () => {
  // A text turn reaches the handset ONLY by being collected from the poll body.
  // Parking one with nobody polling — a follow-up sweep, or a `to` that
  // `resolveRecipient` resolved to a bare phone rather than a cod — persisted a
  // message the beneficiary never received, under `success: true`.
  it('fails a text send when no poll is waiting', async () => {
    await boot();

    const result = await send('oi, tudo bem?');

    expect(result.success).toBe(false);
    expect(result.error).toContain('no ASC flow turn is polling');
    expect(result.retryable).toBe(false);
    expect(eventBus.published.some((e) => e.type.includes('sent'))).toBe(false);
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
