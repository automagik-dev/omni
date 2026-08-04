/**
 * ScheduledMessageService — platform vs local delivery, cancel, sweep (#889).
 */

import { describe, expect, test } from 'bun:test';
import type { ChannelPlugin } from '@omni/channel-sdk';
import type { Database, ScheduledMessage } from '@omni/db';
import { ScheduledMessageService } from '../scheduled-messages';

const IN_ONE_HOUR = () => new Date(Date.now() + 60 * 60 * 1000);
const noop = () => {};
const noopLogger = { debug: noop, info: noop, warn: noop, error: noop } as never;

interface PluginCalls {
  scheduled?: { instanceId: string; sendAt: Date };
  canceled?: { chatId: string; scheduledId: string };
  sent?: { instanceId: string; to: string; threadId?: string };
}

function makePlugin(
  opts: {
    canSchedule?: boolean;
    maxAheadMs?: number;
    scheduleResult?: string;
    scheduleThrows?: Error;
    sendResult?: { success: boolean; messageId?: string; error?: string };
    sendThrows?: Error;
    cancelThrows?: Error;
  } = {},
  calls?: PluginCalls,
): ChannelPlugin {
  const plugin = {
    id: 'slack',
    capabilities: {
      canScheduleMessage: opts.canSchedule ?? false,
      maxScheduleAheadMs: opts.maxAheadMs,
    },
    sendMessage: async (instanceId: string, message: { to: string; threadId?: string }) => {
      if (calls) calls.sent = { instanceId, to: message.to, threadId: message.threadId };
      if (opts.sendThrows) throw opts.sendThrows;
      return opts.sendResult ?? { success: true, messageId: 'ts-1' };
    },
    cancelScheduledMessage: async (_i: string, chatId: string, scheduledId: string) => {
      if (calls) calls.canceled = { chatId, scheduledId };
      if (opts.cancelThrows) throw opts.cancelThrows;
    },
  } as unknown as ChannelPlugin;

  if (opts.canSchedule) {
    (plugin as { scheduleMessage?: unknown }).scheduleMessage = async (
      instanceId: string,
      _m: unknown,
      sendAt: Date,
    ) => {
      if (calls) calls.scheduled = { instanceId, sendAt };
      if (opts.scheduleThrows) throw opts.scheduleThrows;
      return opts.scheduleResult ?? 'Q123';
    };
  }

  return plugin;
}

/** Minimal Drizzle stand-in covering only the calls this service makes. */
function makeDb(state: { rows: Partial<ScheduledMessage>[] }, capture?: { inserted?: Record<string, unknown> }) {
  const chain = (rows: unknown[]) => {
    const self: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit', 'for']) {
      self[m] = () => self;
    }
    // Drizzle's query builder IS a thenable — every chain step is awaitable and
    // there is no single terminal method (the service awaits after .limit() in
    // one place and after .for() in another). Emulating that requires `then`.
    // biome-ignore lint/suspicious/noThenProperty: mirrors Drizzle's thenable builder
    (self as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(rows);
    return self;
  };

  return {
    select: () => chain(state.rows),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        if (capture) capture.inserted = v;
        return { returning: async () => [{ id: 'sm-1', ...v }] };
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({ returning: async () => [{ id: 'sm-1', ...state.rows[0], ...v }] }),
      }),
    }),
    delete: () => ({ where: () => ({ returning: async () => [] }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ select: () => chain(state.rows) }),
  } as unknown as Database;
}

const TEXT = { type: 'text', text: 'oi' };

describe('ScheduledMessageService.schedule', () => {
  test('delegates to the platform and stores the handle when the channel schedules natively', async () => {
    const calls: PluginCalls = {};
    const capture: { inserted?: Record<string, unknown> } = {};
    const svc = new ScheduledMessageService(
      makeDb({ rows: [] }, capture),
      async () => makePlugin({ canSchedule: true }, calls),
      noopLogger,
    );

    const at = IN_ONE_HOUR();
    await svc.schedule({ instanceId: 'i1', chatExternalId: 'C1', content: TEXT, sendAt: at });

    expect(calls.scheduled?.sendAt).toEqual(at);
    expect(capture.inserted?.deliveryMode).toBe('platform');
    expect(capture.inserted?.externalScheduledId).toBe('Q123');
  });

  test('falls to local mode when the channel has no native scheduling', async () => {
    const calls: PluginCalls = {};
    const capture: { inserted?: Record<string, unknown> } = {};
    const svc = new ScheduledMessageService(
      makeDb({ rows: [] }, capture),
      async () => makePlugin({ canSchedule: false }, calls),
      noopLogger,
    );

    await svc.schedule({ instanceId: 'i1', chatExternalId: 'C1', content: TEXT, sendAt: IN_ONE_HOUR() });

    expect(calls.scheduled).toBeUndefined();
    expect(capture.inserted?.deliveryMode).toBe('local');
    expect(capture.inserted?.externalScheduledId).toBeUndefined();
  });

  test('does NOT silently fall back to local when a native schedule call fails', async () => {
    // A channel that advertises native scheduling and then rejects is a real
    // error — swallowing it would strand the message in a mode the caller
    // never asked for.
    const svc = new ScheduledMessageService(
      makeDb({ rows: [] }),
      async () => makePlugin({ canSchedule: true, scheduleThrows: new Error('slack said no') }),
      noopLogger,
    );

    const call = svc.schedule({ instanceId: 'i1', chatExternalId: 'C1', content: TEXT, sendAt: IN_ONE_HOUR() });
    await expect(call).rejects.toThrow(/slack said no/);
  });

  test('rejects a sendAt in the past', async () => {
    const svc = new ScheduledMessageService(makeDb({ rows: [] }), async () => makePlugin(), noopLogger);
    const call = svc.schedule({
      instanceId: 'i1',
      chatExternalId: 'C1',
      content: TEXT,
      sendAt: new Date(Date.now() - 1000),
    });
    await expect(call).rejects.toThrow(/must be in the future/);
  });

  test('rejects a sendAt beyond the platform lead-time limit', async () => {
    const svc = new ScheduledMessageService(
      makeDb({ rows: [] }),
      async () => makePlugin({ canSchedule: true, maxAheadMs: 24 * 60 * 60 * 1000 }),
      noopLogger,
    );
    const call = svc.schedule({
      instanceId: 'i1',
      chatExternalId: 'C1',
      content: TEXT,
      sendAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
    await expect(call).rejects.toThrow(/exceeds what slack accepts natively/);
  });

  test('rejects malformed content up front, in local mode too', async () => {
    // Local mode would otherwise only discover this when the sweeper fires.
    const svc = new ScheduledMessageService(makeDb({ rows: [] }), async () => makePlugin(), noopLogger);
    const call = svc.schedule({
      instanceId: 'i1',
      chatExternalId: 'C1',
      content: { text: 'no type field' },
      sendAt: IN_ONE_HOUR(),
    });
    await expect(call).rejects.toThrow(/without a 'type' discriminant/);
  });
});

describe('ScheduledMessageService.cancel', () => {
  test('asks the platform to drop it, then marks the row canceled', async () => {
    const calls: PluginCalls = {};
    const svc = new ScheduledMessageService(
      makeDb({
        rows: [
          {
            id: 'sm-1',
            status: 'pending',
            deliveryMode: 'platform',
            externalScheduledId: 'Q123',
            chatExternalId: 'C1',
            instanceId: 'i1',
          },
        ],
      }),
      async () => makePlugin({ canSchedule: true }, calls),
      noopLogger,
    );

    const row = await svc.cancel('sm-1');

    expect(calls.canceled).toEqual({ chatId: 'C1', scheduledId: 'Q123' });
    expect(row?.status).toBe('canceled');
  });

  test('still marks canceled when the platform says it is already gone', async () => {
    const svc = new ScheduledMessageService(
      makeDb({
        rows: [
          {
            id: 'sm-1',
            status: 'pending',
            deliveryMode: 'platform',
            externalScheduledId: 'Q123',
            chatExternalId: 'C1',
            instanceId: 'i1',
          },
        ],
      }),
      async () => makePlugin({ canSchedule: true, cancelThrows: new Error('invalid_scheduled_message_id') }),
      noopLogger,
    );

    const row = await svc.cancel('sm-1');
    expect(row?.status).toBe('canceled');
  });

  test('is a no-op on an already-sent row', async () => {
    const svc = new ScheduledMessageService(
      makeDb({ rows: [{ id: 'sm-1', status: 'sent', deliveryMode: 'local', instanceId: 'i1' }] }),
      async () => makePlugin(),
      noopLogger,
    );

    const row = await svc.cancel('sm-1');
    expect(row?.status).toBe('sent');
  });
});

describe('ScheduledMessageService.sweep', () => {
  const dueLocal = {
    id: 'sm-1',
    instanceId: 'i1',
    chatExternalId: 'C1',
    threadExternalId: '111.222',
    isThreadBroadcast: false,
    content: TEXT,
    status: 'pending' as const,
    deliveryMode: 'local' as const,
    attemptCount: 0,
  };

  test('sends a due local message and carries the thread through', async () => {
    const calls: PluginCalls = {};
    const svc = new ScheduledMessageService(
      makeDb({ rows: [dueLocal] }),
      async () => makePlugin({}, calls),
      noopLogger,
    );

    const stats = await svc.sweep();

    expect(stats).toEqual({ scanned: 1, sent: 1, failed: 0 });
    expect(calls.sent?.to).toBe('C1');
    expect(calls.sent?.threadId).toBe('111.222');
  });

  test('keeps a row pending for retry while attempts remain', async () => {
    const svc = new ScheduledMessageService(
      makeDb({ rows: [dueLocal] }),
      async () => makePlugin({ sendThrows: new Error('network down') }),
      noopLogger,
    );

    const stats = await svc.sweep();
    expect(stats).toEqual({ scanned: 1, sent: 0, failed: 1 });
  });

  test('treats an unsuccessful SendResult as a failure, not a send', async () => {
    // sendMessage resolving with success:false must not mark the row sent.
    const svc = new ScheduledMessageService(
      makeDb({ rows: [dueLocal] }),
      async () => makePlugin({ sendResult: { success: false, error: 'channel disconnected' } }),
      noopLogger,
    );

    const stats = await svc.sweep();
    expect(stats.sent).toBe(0);
    expect(stats.failed).toBe(1);
  });

  test('reports nothing to do on an empty queue', async () => {
    const svc = new ScheduledMessageService(makeDb({ rows: [] }), async () => makePlugin(), noopLogger);
    expect(await svc.sweep()).toEqual({ scanned: 0, sent: 0, failed: 0 });
  });
});
