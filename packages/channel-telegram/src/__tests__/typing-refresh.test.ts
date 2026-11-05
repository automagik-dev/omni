/** Exercise the real Telegram typing lifecycle with a transport that can hang. */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import * as client from '../client';
import type { TelegramBotLike } from '../grammy-shim';
import { TelegramPlugin } from '../plugin';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('Telegram typing requests', () => {
  let plugin: TelegramPlugin;
  let sequence = 0;
  const restores: Array<() => void> = [];
  const timeouts = new Map<number, { fn: () => void; ms: number }>();
  const intervals = new Map<number, () => void>();
  const sendChatAction = mock(async (_chat: string, _action: string, _other?: unknown, _signal?: AbortSignal) => {});

  beforeEach(() => {
    plugin = new TelegramPlugin();
    Object.assign(plugin, { logger: { info() {}, debug() {}, warn() {}, error() {} } });
    timeouts.clear();
    intervals.clear();
    sendChatAction.mockReset();
    sendChatAction.mockResolvedValue(undefined);
    const bot = { api: { sendChatAction } } as unknown as TelegramBotLike;
    const getBot = spyOn(client, 'getBot').mockReturnValue(bot);
    const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms: number) => {
      const id = ++sequence;
      timeouts.set(id, { fn, ms });
      return id;
    }) as unknown as typeof setTimeout);
    const interval = spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void) => {
      const id = ++sequence;
      intervals.set(id, fn);
      return id;
    }) as unknown as typeof setInterval);
    const clearTimeoutSpy = spyOn(globalThis, 'clearTimeout').mockImplementation((id) => {
      timeouts.delete(Number(id));
    });
    const clearIntervalSpy = spyOn(globalThis, 'clearInterval').mockImplementation((id) => {
      intervals.delete(Number(id));
    });
    restores.push(
      () => getBot.mockRestore(),
      () => timeout.mockRestore(),
      () => interval.mockRestore(),
      () => clearTimeoutSpy.mockRestore(),
      () => clearIntervalSpy.mockRestore(),
    );
  });

  afterEach(async () => {
    try {
      await plugin.destroy();
    } finally {
      for (const restore of restores.splice(0).reverse()) restore();
    }
  });

  function fireTimeout(ms: number) {
    const timer = [...timeouts].find(([, value]) => value.ms === ms);
    if (!timer) throw new Error(`No pending ${ms}ms timeout`);
    timeouts.delete(timer[0]);
    timer[1].fn();
  }

  test('sends and refreshes typing, honors duration, and stops on zero', async () => {
    await plugin.sendTyping('instance', 'chat', 30000);
    expect(sendChatAction).toHaveBeenCalledTimes(1);
    expect(intervals.size).toBe(1);
    expect([...timeouts.values()].map((timer) => timer.ms)).toEqual([30000]);
    for (const fn of intervals.values()) fn();
    await turn();
    expect(sendChatAction).toHaveBeenCalledTimes(2);
    await plugin.sendTyping('instance', 'chat', 0);
    expect(intervals.size).toBe(0);
    expect(timeouts.size).toBe(0);
  });

  test('a never-resolving initial action aborts and settles after three seconds', async () => {
    sendChatAction.mockImplementation(() => new Promise<void>(() => {}));
    const pending = plugin.sendTyping('instance', 'chat', 30000);
    await turn();
    const signal = sendChatAction.mock.calls[0]?.[3];
    expect(signal?.aborted).toBe(false);
    fireTimeout(3000);
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(intervals.size).toBe(0);
    expect(timeouts.size).toBe(0);
  });

  test('a never-resolving refresh has the same three-second deadline', async () => {
    await plugin.sendTyping('instance', 'chat', 30000);
    sendChatAction.mockImplementation(() => new Promise<void>(() => {}));
    for (const fn of intervals.values()) fn();
    await turn();
    const signal = sendChatAction.mock.calls[1]?.[3];
    fireTimeout(3000);
    await turn();
    expect(signal?.aborted).toBe(true);
    expect(intervals.size).toBe(0);
    expect(timeouts.size).toBe(0);
  });

  test('stop cancels a pending action; late completion cannot restart typing', async () => {
    let resolve = () => {};
    sendChatAction.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const pending = plugin.sendTyping('instance', 'chat', 30000);
    await turn();
    await plugin.sendTyping('instance', 'chat', 0);
    await pending;
    resolve();
    await turn();
    expect(intervals.size).toBe(0);
    expect(timeouts.size).toBe(0);
  });

  test('replacing a pending action does not let its cancellation clear the new refresh', async () => {
    sendChatAction.mockImplementationOnce(() => new Promise<void>(() => {}));
    const old = plugin.sendTyping('instance', 'chat', 30000);
    await turn();
    await plugin.sendTyping('instance', 'chat', 30000);
    await old;
    expect(intervals.size).toBe(1);
    expect(sendChatAction).toHaveBeenCalledTimes(2);
    expect(sendChatAction.mock.calls[0]?.[3]?.aborted).toBe(true);
    expect(sendChatAction.mock.calls[1]?.[3]?.aborted).toBe(false);
  });

  test('default failsafe and destroy cancel every chat without leaked timers', async () => {
    await plugin.sendTyping('instance', 'chat');
    fireTimeout(60000);
    expect(intervals.size).toBe(0);
    await plugin.sendTyping('instance', 'one');
    await plugin.sendTyping('instance', 'two');
    expect(intervals.size).toBe(2);
    await plugin.destroy();
    expect(intervals.size).toBe(0);
    expect(timeouts.size).toBe(0);
  });

  test('missing bots and rejected requests leave no refresh or deadline', async () => {
    spyOn(client, 'getBot').mockReturnValueOnce(undefined);
    await plugin.sendTyping('instance', 'missing', 30000);
    expect(sendChatAction).not.toHaveBeenCalled();
    expect(intervals.size).toBe(0);
    sendChatAction.mockRejectedValueOnce(new Error('offline'));
    await plugin.sendTyping('instance', 'failed', 30000);
    expect(intervals.size).toBe(0);
    expect(timeouts.size).toBe(0);
  });
});
