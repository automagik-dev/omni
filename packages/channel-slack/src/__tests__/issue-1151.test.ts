/**
 * #1151 — human messages carrying bot_id, zombie socket watchdog, reconnect backfill.
 */

import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { PluginContext } from '@omni/channel-sdk';
import type { BoltConnection, SlackSocketClient } from '../connection/bolt-client';
import { isSocketOpen, isSocketStale } from '../connection/bolt-client';
import { shouldSkipMessage } from '../handlers/messages';
import { SlackPlugin } from '../plugin';

const BOT_USER = 'U0BOT';
const OWN_BOT_ID = 'B0OWN';
const HUMAN = 'U0HUMAN';

describe('shouldSkipMessage — bot_id rule (#1151)', () => {
  it('keeps a human message posted through another app (user + foreign bot_id)', () => {
    expect(shouldSkipMessage({ user: HUMAN, bot_id: 'B0BA3170D0U', text: '<@U0BOT> hi' }, [BOT_USER], OWN_BOT_ID)).toBe(
      false,
    );
  });

  it('skips a bot_id message with no human user', () => {
    expect(shouldSkipMessage({ bot_id: 'B0OTHER' }, [BOT_USER], OWN_BOT_ID)).toBe(true);
    expect(shouldSkipMessage({ subtype: 'bot_message', bot_id: 'B0OTHER' }, [BOT_USER], OWN_BOT_ID)).toBe(true);
  });

  it("skips this instance's own bot_id even when user is set", () => {
    expect(shouldSkipMessage({ user: HUMAN, bot_id: OWN_BOT_ID }, [BOT_USER], OWN_BOT_ID)).toBe(true);
  });

  it('still skips edits/deletes and self user ids', () => {
    expect(shouldSkipMessage({ user: HUMAN, subtype: 'message_changed' }, [BOT_USER])).toBe(true);
    expect(shouldSkipMessage({ user: BOT_USER }, [BOT_USER])).toBe(true);
  });
});

describe('socket liveness watchdog (#1151)', () => {
  const socketConn = (lastSocketActivityAt?: number): BoltConnection =>
    ({
      mode: 'socket',
      socketClient: Object.assign(new EventEmitter(), {
        websocket: { isActive: () => true },
      }) as unknown as SlackSocketClient,
      lastSocketActivityAt,
      socketStaleAfterMs: 1000,
    }) as unknown as BoltConnection;

  it('an open socket with recent activity is open', () => {
    expect(isSocketOpen(socketConn(Date.now()))).toBe(true);
  });

  it('an open socket silent past the threshold is treated as not open', () => {
    const conn = socketConn(Date.now() - 5000);
    expect(isSocketStale(conn)).toBe(true);
    expect(isSocketOpen(conn)).toBe(false);
  });

  it('no activity recorded yet is not stale', () => {
    expect(isSocketStale(socketConn(undefined))).toBe(false);
  });
});

const noop = () => {};
const noopLogger = { debug: noop, info: noop, warn: noop, error: noop, child: () => noopLogger };

async function makePlugin(): Promise<SlackPlugin> {
  const plugin = new SlackPlugin();
  await plugin.initialize({
    eventBus: { publish: async () => {}, subscribe: () => {} },
    storage: {},
    logger: noopLogger,
    config: {},
    db: {},
  } as unknown as PluginContext);
  return plugin;
}

describe('reconnect backfill from Slack (#1151)', () => {
  it('fetches history + thread replies newer than last seen ts and dispatches them in order', async () => {
    const plugin = await makePlugin();
    const internals = plugin as unknown as {
      recordSeen(instanceId: string, msg: Record<string, unknown>): void;
      inboundHandlers: Map<string, (msg: Record<string, unknown>) => Promise<void>>;
    };
    const dispatched: Record<string, unknown>[] = [];
    internals.inboundHandlers.set('inst', async (msg) => {
      dispatched.push(msg);
    });
    internals.recordSeen('inst', { channel: 'C1', ts: '100.000' });
    internals.recordSeen('inst', { channel: 'C1', ts: '90.000', thread_ts: '50.000' });

    const historyCalls: Record<string, unknown>[] = [];
    const repliesCalls: Record<string, unknown>[] = [];
    const connection = {
      actingClient: {
        conversations: {
          history: async (args: Record<string, unknown>) => {
            historyCalls.push(args);
            return {
              messages: [
                { ts: '120.000', user: HUMAN, bot_id: 'B0BA3170D0U', text: 'parent' },
                { ts: '100.000', user: HUMAN, text: 'already seen' },
              ],
            };
          },
          replies: async (args: Record<string, unknown>) => {
            repliesCalls.push(args);
            if (args.ts === '50.000') {
              return {
                messages: [
                  { ts: '50.000', user: HUMAN },
                  { ts: '110.000', user: HUMAN, thread_ts: '50.000' },
                ],
              };
            }
            return { messages: [] };
          },
        },
      },
    } as unknown as BoltConnection;

    const recovered = await plugin.backfillMissedMessages('inst', connection);

    expect(historyCalls).toEqual([{ channel: 'C1', oldest: '100.000', limit: 200 }]);
    expect(repliesCalls.map((c) => c.ts)).toEqual(['50.000']);
    expect(recovered).toBe(2);
    expect(dispatched.map((m) => m.ts)).toEqual(['110.000', '120.000']);
    expect(dispatched.every((m) => m.channel === 'C1')).toBe(true);
  });

  it('is a no-op when nothing has been seen yet', async () => {
    const plugin = await makePlugin();
    expect(await plugin.backfillMissedMessages('none', {} as BoltConnection)).toBe(0);
  });
});
