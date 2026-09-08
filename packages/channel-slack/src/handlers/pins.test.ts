/**
 * Tests for the pin_added / pin_removed handlers (#889)
 */

import { describe, expect, it, mock } from 'bun:test';
import type { Logger } from '@omni/channel-sdk';
import type { App } from '@slack/bolt';
import { setupPinHandlers } from './pins';

function makeLogger(): Logger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => makeLogger()),
  } as unknown as Logger;
}

/** Minimal Bolt app double that records event registrations. */
function makeApp() {
  const listeners = new Map<string, (args: { event: unknown }) => Promise<void>>();
  const app = {
    event: mock((name: string, listener: (args: { event: unknown }) => Promise<void>) => {
      listeners.set(name, listener);
    }),
  };
  return { app: app as unknown as App, listeners };
}

type PinCall = {
  instanceId: string;
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
    'inst-1',
    {
      onPin: async (instanceId, messageId, chatId, userId, action) => {
        calls.push({ instanceId, messageId, chatId, userId, action });
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
        instanceId: 'inst-1',
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
