/**
 * Tests for the pin_added / pin_removed handlers (#889)
 */

import { describe, expect, it, mock } from 'bun:test';
import type { Logger } from '@omni/channel-sdk';
import type { App } from '@slack/bolt';
import type { SlackRoutingFields } from '../connection/app-receiver';
import { setupPinHandlers } from './pins';

/** The workspace envelope Slack wraps a pin event in. */
const TEAM = 'T_WORK';
const envelope: SlackRoutingFields = {
  team_id: TEAM,
  event_context: 'EC-pin',
  event_id: 'Ev-pin-1',
  authorizations: [{ team_id: TEAM, user_id: 'U123ABC456', is_bot: false }],
};

function makeLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => makeLogger()),
  } as unknown as Logger;
}

type PinListener = (args: { event: unknown; body: SlackRoutingFields }) => Promise<void>;

/** Minimal Bolt app double that records event registrations. */
function makeApp() {
  const listeners = new Map<string, PinListener>();
  const app = {
    event: mock((name: string, listener: PinListener) => {
      listeners.set(name, listener);
    }),
  };
  return { app: app as unknown as App, listeners };
}

type PinCall = {
  /** The workspace envelope the handler threaded through, which is what routes the pin. */
  envelope: SlackRoutingFields;
  messageId: string;
  chatId: string;
  userId: string | undefined;
  action: 'pin' | 'unpin';
};

function setup() {
  const { app, listeners } = makeApp();
  const calls: PinCall[] = [];
  setupPinHandlers(
    app,
    'socket:receiver-key',
    {
      onPin: async (env, messageId, chatId, userId, action) => {
        calls.push({ envelope: env, messageId, chatId, userId, action });
      },
    },
    makeLogger(),
  );
  return { listeners, calls };
}

describe('setupPinHandlers', () => {
  it('registers listeners for pin_added and pin_removed', () => {
    const { listeners } = setup();

    expect(listeners.has('pin_added')).toBe(true);
    expect(listeners.has('pin_removed')).toBe(true);
  });

  it('maps pin_added into a pin callback', async () => {
    const { listeners, calls } = setup();

    await listeners.get('pin_added')?.({
      body: envelope,
      event: {
        type: 'pin_added',
        user: 'U123ABC456',
        channel_id: 'C0123ABC456',
        item: {
          type: 'message',
          channel: 'C0123ABC456',
          message: { ts: '1725700000.000100', text: 'pinned text' },
        },
        event_ts: '1725700100.000200',
      },
    });

    expect(calls).toEqual([
      {
        envelope,
        messageId: '1725700000.000100',
        chatId: 'C0123ABC456',
        userId: 'U123ABC456',
        action: 'pin',
      },
    ]);
  });

  it('maps pin_removed into an unpin callback', async () => {
    const { listeners, calls } = setup();

    await listeners.get('pin_removed')?.({
      body: envelope,
      event: {
        type: 'pin_removed',
        user: 'U123ABC456',
        item: {
          type: 'message',
          channel: 'C0123ABC456',
          message: { ts: '1725700000.000100' },
        },
      },
    });

    expect(calls.map((c) => c.action)).toEqual(['unpin']);
  });

  it('falls back to channel_id when the item carries no channel', async () => {
    const { listeners, calls } = setup();

    await listeners.get('pin_added')?.({
      body: envelope,
      event: {
        type: 'pin_added',
        user: 'U123ABC456',
        channel_id: 'C0123ABC456',
        item: { type: 'message', message: { ts: '1725700000.000100' } },
      },
    });

    expect(calls[0]?.chatId).toBe('C0123ABC456');
  });

  it('ignores pinned files — only messages have a row to update', async () => {
    const { listeners, calls } = setup();

    await listeners.get('pin_added')?.({
      body: envelope,
      event: {
        type: 'pin_added',
        user: 'U123ABC456',
        channel_id: 'C0123ABC456',
        item: { type: 'file', file: { id: 'F123' } },
      },
    });

    expect(calls).toEqual([]);
  });

  it('ignores events without a message ts', async () => {
    const { listeners, calls } = setup();

    await listeners.get('pin_added')?.({
      body: envelope,
      event: {
        type: 'pin_added',
        user: 'U123ABC456',
        channel_id: 'C0123ABC456',
        item: { type: 'message', message: {} },
      },
    });

    expect(calls).toEqual([]);
  });
});
