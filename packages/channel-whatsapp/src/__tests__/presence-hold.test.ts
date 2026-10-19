/**
 * Server-held presence (opt-in, POST /messages/send/presence hold=true).
 *
 * Time is driven with bun:test fake timers — no test here waits on the wall
 * clock. Sends use `outboundPacing: 'immediate'` so the humanized delay never
 * parks a send behind a (frozen) fake timer.
 */

import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test';
import type { OutgoingMessage } from '@omni/channel-sdk';
import { ERROR_CODES, OmniError } from '@omni/core';
import { WhatsAppPlugin } from '../plugin';

const INSTANCE_ID = 'hold-instance';
const PHONE = '5511888888888';
const PHONE_JID = '5511888888888@s.whatsapp.net';
const OTHER_JID = '5511777777777@s.whatsapp.net';

type Call = [kind: 'presence' | 'send', state: string, jid: string];

type HoldInternals = {
  sockets: Map<string, unknown>;
  eventBus: { publish: (type: string, payload: unknown) => Promise<void> };
  logger: Record<string, unknown>;
  presenceHolds: Map<string, unknown>;
  preprocessOutgoing: (instanceId: string, jid: string, message: OutgoingMessage) => Promise<OutgoingMessage>;
};

function createMockSocket(calls: Call[], lidFor?: Record<string, string>) {
  return {
    user: { id: '5511999999999@s.whatsapp.net' },
    sendPresenceUpdate: mock(async (state: string, jid: string) => {
      calls.push(['presence', state, jid]);
    }),
    sendMessage: mock(async (jid: string) => {
      calls.push(['send', 'message', jid]);
      return { key: { id: `MSG-${calls.length}` }, message: { conversation: 'x' } };
    }),
    ev: { removeAllListeners: mock(() => {}) },
    end: mock(() => {}),
    ...(lidFor
      ? { signalRepository: { lidMapping: { getLIDForPN: mock(async (pn: string) => lidFor[pn] ?? null) } } }
      : {}),
  };
}

function createPlugin(lidFor?: Record<string, string>) {
  const plugin = new WhatsAppPlugin();
  const internals = plugin as unknown as HoldInternals;
  const calls: Call[] = [];
  const sock = createMockSocket(calls, lidFor);
  internals.sockets = new Map([[INSTANCE_ID, sock]]);
  internals.eventBus = { publish: mock(async () => {}) };
  internals.logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };
  return { plugin, internals, calls, sock };
}

function presences(calls: Call[], state?: string, jid?: string): Call[] {
  return calls.filter((c) => c[0] === 'presence' && (!state || c[1] === state) && (!jid || c[2] === jid));
}

const immediateText = (to: string): OutgoingMessage => ({
  to,
  content: { type: 'text', text: 'reply' },
  metadata: { outboundPacing: 'immediate' },
});

async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  // let refresh promises settle
  await Promise.resolve();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/**
 * Plugin whose composing/recording frames stay in flight until the test
 * releases them (in call order); 'paused' frames resolve at once. The call is
 * recorded when the frame is released, i.e. the order the frames "go out".
 * Once the test calls stopDeferring(), later frames (refreshes) go out at once.
 */
function createDeferredPlugin() {
  const ctx = createPlugin();
  const pending: Array<{ state: string; jid: string; resolve: () => void; reject: (e: Error) => void }> = [];
  let deferring = true;
  const stopDeferring = () => {
    deferring = false;
  };
  ctx.sock.sendPresenceUpdate.mockImplementation(async (state: string, jid: string) => {
    if (state === 'paused' || !deferring) {
      ctx.calls.push(['presence', state, jid]);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      pending.push({
        state,
        jid,
        resolve: () => {
          ctx.calls.push(['presence', state, jid]);
          resolve();
        },
        reject,
      });
    });
  });
  return { ...ctx, pending, stopDeferring };
}

const immediateReaction = (to: string): OutgoingMessage => ({
  to,
  content: { type: 'reaction', targetMessageId: '3EB0HELDTARGET', emoji: '👍' },
  metadata: { outboundPacing: 'immediate' },
});

describe('WhatsAppPlugin.holdPresence', () => {
  const savedEnv = {
    refresh: process.env.WHATSAPP_PRESENCE_REFRESH_MS,
    lifetime: process.env.WHATSAPP_PRESENCE_MAX_LIFETIME_MS,
    maxHolds: process.env.WHATSAPP_PRESENCE_MAX_HOLDS_PER_INSTANCE,
  };

  beforeEach(() => {
    Reflect.deleteProperty(process.env, 'WHATSAPP_PRESENCE_REFRESH_MS');
    Reflect.deleteProperty(process.env, 'WHATSAPP_PRESENCE_MAX_LIFETIME_MS');
    Reflect.deleteProperty(process.env, 'WHATSAPP_PRESENCE_MAX_HOLDS_PER_INSTANCE');
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    if (savedEnv.refresh === undefined) Reflect.deleteProperty(process.env, 'WHATSAPP_PRESENCE_REFRESH_MS');
    else process.env.WHATSAPP_PRESENCE_REFRESH_MS = savedEnv.refresh;
    if (savedEnv.lifetime === undefined) Reflect.deleteProperty(process.env, 'WHATSAPP_PRESENCE_MAX_LIFETIME_MS');
    else process.env.WHATSAPP_PRESENCE_MAX_LIFETIME_MS = savedEnv.lifetime;
    if (savedEnv.maxHolds === undefined)
      Reflect.deleteProperty(process.env, 'WHATSAPP_PRESENCE_MAX_HOLDS_PER_INSTANCE');
    else process.env.WHATSAPP_PRESENCE_MAX_HOLDS_PER_INSTANCE = savedEnv.maxHolds;
  });

  it("'typing' sends composing at once and re-sends it every 10s by default", async () => {
    const { plugin, calls } = createPlugin();

    const result = await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');

    expect(result.lifetimeMs).toBe(60_000);
    expect(presences(calls)).toEqual([['presence', 'composing', PHONE_JID]]);

    await advance(9_999);
    expect(presences(calls, 'composing')).toHaveLength(1);
    await advance(1);
    expect(presences(calls, 'composing')).toHaveLength(2);
    await advance(10_000);
    expect(presences(calls, 'composing')).toHaveLength(3);
  });

  it('clamps a WHATSAPP_PRESENCE_REFRESH_MS below 3000 to a 3000ms cadence', async () => {
    process.env.WHATSAPP_PRESENCE_REFRESH_MS = '500';
    const { plugin, calls } = createPlugin();

    await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
    await advance(2_999);
    expect(presences(calls, 'composing')).toHaveLength(1);
    await advance(1);
    expect(presences(calls, 'composing')).toHaveLength(2);
    await advance(3_000);
    expect(presences(calls, 'composing')).toHaveLength(3);
  });

  it('refreshes at the configured WHATSAPP_PRESENCE_REFRESH_MS cadence', async () => {
    process.env.WHATSAPP_PRESENCE_REFRESH_MS = '4000';
    const { plugin, calls } = createPlugin();

    await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
    await advance(12_000);

    expect(presences(calls, 'composing')).toHaveLength(4);
  });

  it("'recording' maps to Baileys 'recording' for the first send and every refresh", async () => {
    const { plugin, calls } = createPlugin();

    await plugin.holdPresence(INSTANCE_ID, PHONE, 'recording');
    await advance(20_000);

    expect(presences(calls)).toEqual([
      ['presence', 'recording', PHONE_JID],
      ['presence', 'recording', PHONE_JID],
      ['presence', 'recording', PHONE_JID],
    ]);
  });

  it("a send to the held chat clears the hold and sends 'paused' right before the frame", async () => {
    const { plugin, calls, internals } = createPlugin();

    await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
    const sent = await plugin.sendMessage(INSTANCE_ID, immediateText(PHONE));

    expect(sent.success).toBe(true);
    expect(calls.slice(-2)).toEqual([
      ['presence', 'paused', PHONE_JID],
      ['send', 'message', PHONE_JID],
    ]);
    expect(internals.presenceHolds.size).toBe(0);

    await advance(60_000);
    expect(presences(calls, 'composing')).toHaveLength(1);
  });

  it("a send to a different chat emits no 'paused' and leaves the hold running", async () => {
    const { plugin, calls } = createPlugin();

    await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
    await plugin.sendMessage(INSTANCE_ID, immediateText(OTHER_JID));

    expect(presences(calls, 'paused')).toHaveLength(0);
    await advance(10_000);
    expect(presences(calls, 'composing', PHONE_JID)).toHaveLength(2);
  });

  it('a send with no hold active emits no extra presence update', async () => {
    const { plugin, calls } = createPlugin();

    await plugin.sendMessage(INSTANCE_ID, immediateText(PHONE));

    expect(presences(calls)).toHaveLength(0);
  });

  it("an explicit 'paused' hold call stops the hold and sends 'paused'", async () => {
    const { plugin, calls, internals } = createPlugin();

    await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
    const stopped = await plugin.holdPresence(INSTANCE_ID, PHONE, 'paused');

    expect(stopped).toEqual({ expiresAt: null, lifetimeMs: 0 });
    expect(calls.at(-1)).toEqual(['presence', 'paused', PHONE_JID]);
    expect(internals.presenceHolds.size).toBe(0);

    await advance(30_000);
    expect(presences(calls, 'composing')).toHaveLength(1);
  });

  it('stops at the default max lifetime (60s) and refreshes no more', async () => {
    const { plugin, calls, internals } = createPlugin();

    await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
    await advance(59_999);
    expect(internals.presenceHolds.size).toBe(1);
    await advance(1);
    expect(internals.presenceHolds.size).toBe(0);

    const atExpiry = presences(calls, 'composing').length;
    await advance(60_000);
    expect(presences(calls, 'composing')).toHaveLength(atExpiry);
  });

  it('honours an explicit lifetime and caps any lifetime at 300000', async () => {
    const { plugin, internals } = createPlugin();

    const short = await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing', 20_000);
    expect(short.lifetimeMs).toBe(20_000);
    await advance(20_000);
    expect(internals.presenceHolds.size).toBe(0);

    const capped = await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing', 900_000);
    expect(capped.lifetimeMs).toBe(300_000);
    await advance(299_999);
    expect(internals.presenceHolds.size).toBe(1);
    await advance(1);
    expect(internals.presenceHolds.size).toBe(0);
  });

  it('duration 0 means the default max lifetime', async () => {
    const { plugin } = createPlugin();

    const held = await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing', 0);

    expect(held.lifetimeMs).toBe(60_000);
    expect(held.expiresAt).toBe(Date.now() + 60_000);
  });

  it('instance disconnect clears every hold of that instance', async () => {
    const { plugin, calls, internals } = createPlugin();

    await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
    await plugin.holdPresence(INSTANCE_ID, OTHER_JID, 'recording');
    expect(internals.presenceHolds.size).toBe(2);

    await plugin.disconnect(INSTANCE_ID);

    expect(internals.presenceHolds.size).toBe(0);
    const before = presences(calls).length;
    await advance(30_000);
    expect(presences(calls)).toHaveLength(before);
  });

  it('a new hold on the same chat replaces the previous one', async () => {
    const { plugin, calls, internals } = createPlugin();

    await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
    await plugin.holdPresence(INSTANCE_ID, PHONE, 'recording');
    expect(internals.presenceHolds.size).toBe(1);

    await advance(10_000);
    expect(presences(calls, 'composing')).toHaveLength(1);
    expect(presences(calls, 'recording')).toHaveLength(2);
  });

  it('each refresh uses the socket current at fire time', async () => {
    const { plugin, calls, internals } = createPlugin();
    await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');

    const laterCalls: Call[] = [];
    internals.sockets.set(INSTANCE_ID, createMockSocket(laterCalls));
    await advance(10_000);

    expect(presences(calls, 'composing')).toHaveLength(1);
    expect(presences(laterCalls, 'composing')).toEqual([['presence', 'composing', PHONE_JID]]);
  });

  it('targets the LID that sendMessage resolves for the chat', async () => {
    const LID = '178035101794451@lid';
    const { plugin, calls } = createPlugin({ [PHONE_JID]: LID });

    await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
    await plugin.sendMessage(INSTANCE_ID, immediateText(PHONE));

    expect(calls[0]).toEqual(['presence', 'composing', LID]);
    expect(calls.slice(-2)).toEqual([
      ['presence', 'paused', LID],
      ['send', 'message', LID],
    ]);
  });

  describe('concurrent calls on one chat', () => {
    it('two concurrent holds leave one registry entry and one refresh per interval (later call wins)', async () => {
      const { plugin, calls, internals, pending, stopDeferring } = createDeferredPlugin();

      const first = plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
      const second = plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
      await flush();
      expect(pending).toHaveLength(2);
      expect(internals.presenceHolds.size).toBe(1);

      stopDeferring();
      pending[0]?.resolve();
      pending[1]?.resolve();
      const [firstResult, secondResult] = await Promise.all([first, second]);

      expect(firstResult.expiresAt).toBeNull();
      expect(secondResult.expiresAt).toBe(Date.now() + 60_000);
      expect(internals.presenceHolds.size).toBe(1);
      // Two first frames plus one re-assert of the live hold by the superseded call.
      expect(presences(calls, 'composing')).toHaveLength(3);
      expect(presences(calls, 'paused')).toHaveLength(0);

      await advance(10_000);
      expect(presences(calls, 'composing')).toHaveLength(4);
      await advance(10_000);
      expect(presences(calls, 'composing')).toHaveLength(5);
    });

    it('the later call still wins when its frame goes out first', async () => {
      const { plugin, calls, internals, pending, stopDeferring } = createDeferredPlugin();

      const first = plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
      const second = plugin.holdPresence(INSTANCE_ID, PHONE, 'recording');
      await flush();
      stopDeferring();

      pending[1]?.resolve();
      expect((await second).expiresAt).not.toBeNull();
      pending[0]?.resolve();
      expect((await first).expiresAt).toBeNull();

      expect(internals.presenceHolds.size).toBe(1);
      // The stale 'composing' frame landed last, so the superseded call re-asserts 'recording'.
      expect(presences(calls).at(-1)).toEqual(['presence', 'recording', PHONE_JID]);
      expect(presences(calls, 'recording')).toHaveLength(2);
      await advance(10_000);
      expect(presences(calls, 'recording')).toHaveLength(3);
      expect(presences(calls, 'composing')).toHaveLength(1);
    });

    it("'paused' during the first frame's await: no refresh ever and the last update is 'paused'", async () => {
      const { plugin, calls, internals, pending, stopDeferring } = createDeferredPlugin();

      const held = plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
      await flush();
      stopDeferring();
      const stopped = await plugin.holdPresence(INSTANCE_ID, PHONE, 'paused');
      expect(stopped).toEqual({ expiresAt: null, lifetimeMs: 0 });

      pending[0]?.resolve();
      expect((await held).expiresAt).toBeNull();

      expect(internals.presenceHolds.size).toBe(0);
      expect(presences(calls).at(-1)).toEqual(['presence', 'paused', PHONE_JID]);
      await advance(120_000);
      expect(presences(calls, 'composing')).toHaveLength(1);
      expect(presences(calls).at(-1)).toEqual(['presence', 'paused', PHONE_JID]);
    });

    it("a stale first frame settling after 'paused' and a newer hold re-asserts the newer hold", async () => {
      const { plugin, calls, internals, pending, stopDeferring } = createDeferredPlugin();

      const stale = plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
      await flush();
      stopDeferring();
      await plugin.holdPresence(INSTANCE_ID, PHONE, 'paused');
      const newer = await plugin.holdPresence(INSTANCE_ID, PHONE, 'recording');
      expect(newer.expiresAt).not.toBeNull();

      pending[0]?.resolve();
      expect((await stale).expiresAt).toBeNull();

      expect(internals.presenceHolds.size).toBe(1);
      expect(presences(calls).at(-1)).toEqual(['presence', 'recording', PHONE_JID]);
      expect(presences(calls, 'paused')).toHaveLength(1);
      await advance(10_000);
      expect(presences(calls).at(-1)).toEqual(['presence', 'recording', PHONE_JID]);
      expect(presences(calls, 'recording')).toHaveLength(3);
    });

    it("a send during the first frame's await ends the hold and leaves the chat paused", async () => {
      const { plugin, calls, internals, pending, stopDeferring } = createDeferredPlugin();

      const held = plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
      await flush();
      stopDeferring();
      const sent = await plugin.sendMessage(INSTANCE_ID, immediateText(PHONE));
      expect(sent.success).toBe(true);

      pending[0]?.resolve();
      expect((await held).expiresAt).toBeNull();

      expect(internals.presenceHolds.size).toBe(0);
      expect(calls.at(-1)).toEqual(['presence', 'paused', PHONE_JID]);
      await advance(60_000);
      expect(presences(calls, 'composing')).toHaveLength(1);
    });

    it('a failing first frame removes the hold and rethrows', async () => {
      const { plugin, internals, pending } = createDeferredPlugin();

      const held = plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
      await flush();
      pending[0]?.reject(new Error('socket closed'));

      await expect(held).rejects.toThrow('socket closed');
      expect(internals.presenceHolds.size).toBe(0);
    });
  });

  describe('reactions and failed sends', () => {
    it("a reaction to the held chat ends the hold, sending 'paused' before the reaction frame", async () => {
      const { plugin, calls, internals } = createPlugin();

      await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
      const reacted = await plugin.sendMessage(INSTANCE_ID, immediateReaction(PHONE));

      expect(reacted.success).toBe(true);
      expect(calls.slice(-2)).toEqual([
        ['presence', 'paused', PHONE_JID],
        ['send', 'message', PHONE_JID],
      ]);
      expect(internals.presenceHolds.size).toBe(0);
      await advance(60_000);
      expect(presences(calls, 'composing')).toHaveLength(1);
    });

    it('a reaction with no hold active emits no presence update', async () => {
      const { plugin, calls } = createPlugin();

      await plugin.sendMessage(INSTANCE_ID, immediateReaction(PHONE));

      expect(presences(calls)).toHaveLength(0);
    });

    it("a reaction rejected by validation (all-digit emoji) still ends the hold with 'paused'", async () => {
      const { plugin, calls, internals, sock } = createPlugin();
      await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');

      const rejected = await plugin.sendMessage(INSTANCE_ID, {
        ...immediateReaction(PHONE),
        content: { type: 'reaction', targetMessageId: '3EB0HELDTARGET', emoji: '123456789' },
      });

      expect(rejected.success).toBe(false);
      expect(sock.sendMessage).not.toHaveBeenCalled();
      expect(internals.presenceHolds.size).toBe(0);
      expect(calls.at(-1)).toEqual(['presence', 'paused', PHONE_JID]);
      await advance(60_000);
      expect(presences(calls, 'composing')).toHaveLength(1);
    });

    it('a rejected reaction with no hold active emits no presence update', async () => {
      const { plugin, calls } = createPlugin();

      const rejected = await plugin.sendMessage(INSTANCE_ID, {
        ...immediateReaction(PHONE),
        content: { type: 'reaction', targetMessageId: '3EB0HELDTARGET', emoji: '123456789' },
      });

      expect(rejected.success).toBe(false);
      expect(presences(calls)).toHaveLength(0);
    });

    it('a send that fails in preprocessOutgoing still ends the hold', async () => {
      const { plugin, calls, internals } = createPlugin();
      await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
      internals.preprocessOutgoing = async () => {
        throw new Error('ffmpeg exploded');
      };

      const sent = await plugin.sendMessage(INSTANCE_ID, immediateText(PHONE));

      expect(sent.success).toBe(false);
      expect(internals.presenceHolds.size).toBe(0);
      expect(calls.at(-1)).toEqual(['presence', 'paused', PHONE_JID]);
      await advance(60_000);
      expect(presences(calls, 'composing')).toHaveLength(1);
    });

    it("a failed send with no hold active emits no 'paused'", async () => {
      const { plugin, calls, internals } = createPlugin();
      internals.preprocessOutgoing = async () => {
        throw new Error('ffmpeg exploded');
      };

      await plugin.sendMessage(INSTANCE_ID, immediateText(PHONE));

      expect(presences(calls)).toHaveLength(0);
    });
  });

  describe('per-instance hold cap (WHATSAPP_PRESENCE_MAX_HOLDS_PER_INSTANCE)', () => {
    it('refuses a hold on a new chat at the cap with CHANNEL_RATE_LIMITED; replacing a held chat is allowed', async () => {
      process.env.WHATSAPP_PRESENCE_MAX_HOLDS_PER_INSTANCE = '2';
      const { plugin, calls, internals } = createPlugin();

      await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
      await plugin.holdPresence(INSTANCE_ID, OTHER_JID, 'typing');

      const refused = plugin.holdPresence(INSTANCE_ID, '5511666666666@s.whatsapp.net', 'typing');
      await expect(refused).rejects.toBeInstanceOf(OmniError);
      await expect(refused).rejects.toMatchObject({ code: ERROR_CODES.CHANNEL_RATE_LIMITED });
      expect(presences(calls, 'composing', '5511666666666@s.whatsapp.net')).toHaveLength(0);

      const replaced = await plugin.holdPresence(INSTANCE_ID, PHONE, 'recording');
      expect(replaced.expiresAt).not.toBeNull();
      expect(internals.presenceHolds.size).toBe(2);
    });

    it('defaults to 50 holds per instance', async () => {
      const { plugin } = createPlugin();

      for (let i = 0; i < 50; i++) {
        await plugin.holdPresence(INSTANCE_ID, `55110000${String(i).padStart(4, '0')}@s.whatsapp.net`, 'typing');
      }
      await expect(plugin.holdPresence(INSTANCE_ID, PHONE, 'typing')).rejects.toMatchObject({
        code: ERROR_CODES.CHANNEL_RATE_LIMITED,
      });
    });

    it('a stopped hold frees its slot', async () => {
      process.env.WHATSAPP_PRESENCE_MAX_HOLDS_PER_INSTANCE = '1';
      const { plugin } = createPlugin();

      await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');
      await plugin.holdPresence(INSTANCE_ID, PHONE, 'paused');
      const next = await plugin.holdPresence(INSTANCE_ID, OTHER_JID, 'typing');

      expect(next.expiresAt).not.toBeNull();
    });
  });

  describe('legacy sendTyping pending pause (11b)', () => {
    it('still sends composing then paused after the duration when no hold starts', async () => {
      const { plugin, calls } = createPlugin();

      await plugin.sendTyping(INSTANCE_ID, PHONE, 5_000);
      expect(presences(calls)).toEqual([['presence', 'composing', PHONE_JID]]);

      await advance(5_000);
      expect(presences(calls)).toEqual([
        ['presence', 'composing', PHONE_JID],
        ['presence', 'paused', PHONE_JID],
      ]);
    });

    it('is cancelled when a hold starts on that chat, so the hold survives it', async () => {
      const { plugin, calls, internals } = createPlugin();

      await plugin.sendTyping(INSTANCE_ID, PHONE, 5_000);
      await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing');

      await advance(5_000);
      expect(presences(calls, 'paused')).toHaveLength(0);
      expect(internals.presenceHolds.size).toBe(1);
    });

    it('is not cancelled by a hold on a different chat', async () => {
      const { plugin, calls } = createPlugin();

      await plugin.sendTyping(INSTANCE_ID, PHONE, 5_000);
      await plugin.holdPresence(INSTANCE_ID, OTHER_JID, 'typing');

      await advance(5_000);
      expect(presences(calls, 'paused')).toEqual([['presence', 'paused', PHONE_JID]]);
    });
  });

  describe('lifetime expiry', () => {
    it("sends exactly one 'paused' when the lifetime runs out and refreshes no more", async () => {
      const { plugin, calls, internals } = createPlugin();

      await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing', 20_000);
      await advance(19_999);
      expect(presences(calls, 'paused')).toHaveLength(0);

      await advance(1);
      expect(internals.presenceHolds.size).toBe(0);
      expect(presences(calls, 'paused')).toEqual([['presence', 'paused', PHONE_JID]]);

      const composingAtExpiry = presences(calls, 'composing').length;
      await advance(60_000);
      expect(presences(calls, 'paused')).toHaveLength(1);
      expect(presences(calls, 'composing')).toHaveLength(composingAtExpiry);
      expect(calls.at(-1)).toEqual(['presence', 'paused', PHONE_JID]);
    });

    it("a hold replaced before its old lifetime fires sends no stale 'paused'", async () => {
      const { plugin, calls, internals } = createPlugin();

      await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing', 20_000);
      await advance(10_000);
      await plugin.holdPresence(INSTANCE_ID, PHONE, 'recording', 60_000);

      // The first hold's lifetime would have ended at 20s.
      await advance(10_001);
      expect(presences(calls, 'paused')).toHaveLength(0);
      expect(internals.presenceHolds.size).toBe(1);

      // The newer hold's own lifetime (60s from its start) pauses once.
      await advance(49_999);
      expect(internals.presenceHolds.size).toBe(0);
      expect(presences(calls, 'paused')).toHaveLength(1);
    });

    it("a hold ended by 'paused' sends no second 'paused' when its lifetime would have run out", async () => {
      const { plugin, calls } = createPlugin();

      await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing', 20_000);
      await plugin.holdPresence(INSTANCE_ID, PHONE, 'paused');
      await advance(30_000);

      expect(presences(calls, 'paused')).toHaveLength(1);
    });

    it('no socket at expiry: ends the hold without throwing or sending', async () => {
      const { plugin, calls, internals } = createPlugin();

      await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing', 5_000);
      internals.sockets.delete(INSTANCE_ID);

      await advance(5_000);
      await flush();
      expect(internals.presenceHolds.size).toBe(0);
      expect(presences(calls, 'paused')).toHaveLength(0);
    });

    it("a failing 'paused' at expiry is swallowed", async () => {
      const { plugin, internals, sock } = createPlugin();

      await plugin.holdPresence(INSTANCE_ID, PHONE, 'typing', 5_000);
      sock.sendPresenceUpdate.mockImplementation(async () => {
        throw new Error('socket closed');
      });

      await advance(5_000);
      await flush();
      expect(internals.presenceHolds.size).toBe(0);
      expect(sock.sendPresenceUpdate).toHaveBeenLastCalledWith('paused', PHONE_JID);
    });
  });
});
