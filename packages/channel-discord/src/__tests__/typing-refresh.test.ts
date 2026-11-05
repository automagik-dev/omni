/** Exercise the real plugin with delayed Discord lookups and typing requests. */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { DiscordPlugin } from '../plugin';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve = () => {};
  let reject = (_error: Error) => {};
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('Discord typing lifecycle', () => {
  let plugin: DiscordPlugin;
  let sequence = 0;
  const restores: Array<() => void> = [];
  const timeouts = new Map<number, { fn: () => void; ms: number }>();
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  const sendTyping = mock(async () => {});
  const channel = { sendTyping };
  const fetch = mock(async (_id: string): Promise<typeof channel | null> => channel);

  beforeEach(() => {
    plugin = new DiscordPlugin();
    Object.assign(plugin, {
      logger: { info() {}, debug() {}, warn() {}, error() {} },
      getClient: () => ({ channels: { fetch } }),
    });
    timeouts.clear();
    intervals.clear();
    sendTyping.mockReset();
    sendTyping.mockResolvedValue(undefined);
    fetch.mockReset();
    fetch.mockResolvedValue(channel);
    const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms: number) => {
      const id = ++sequence;
      timeouts.set(id, { fn, ms });
      return id;
    }) as unknown as typeof setTimeout);
    const interval = spyOn(globalThis, 'setInterval').mockImplementation(((fn: () => void, ms: number) => {
      const id = ++sequence;
      intervals.set(id, { fn, ms });
      return id;
    }) as unknown as typeof setInterval);
    const clearTimeoutSpy = spyOn(globalThis, 'clearTimeout').mockImplementation((id) => {
      timeouts.delete(Number(id));
    });
    const clearIntervalSpy = spyOn(globalThis, 'clearInterval').mockImplementation((id) => {
      intervals.delete(Number(id));
    });
    restores.push(
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

  test('sends and refreshes every eight seconds; stop clears both timers', async () => {
    await plugin.sendTyping('instance', 'chat', 30000);
    expect(sendTyping).toHaveBeenCalledTimes(1);
    expect([...intervals.values()].map((timer) => timer.ms)).toEqual([8000]);
    expect([...timeouts.values()].map((timer) => timer.ms)).toEqual([30000]);
    for (const timer of intervals.values()) timer.fn();
    await turn();
    expect(sendTyping).toHaveBeenCalledTimes(2);
    await plugin.sendTyping('instance', 'chat', 0);
    expect(intervals.size).toBe(0);
    expect(timeouts.size).toBe(0);
  });

  test('stop during the first lookup prevents the late typing request', async () => {
    const lookup = deferred();
    fetch.mockImplementationOnce(async () => {
      await lookup.promise;
      return channel;
    });
    const pending = plugin.sendTyping('instance', 'chat', 30000);
    expect(intervals.size).toBe(1);
    await plugin.sendTyping('instance', 'chat', 0);
    lookup.resolve();
    await pending;
    expect(sendTyping).not.toHaveBeenCalled();
    expect(intervals.size).toBe(0);
    expect(timeouts.size).toBe(0);
  });

  test('stop during the first typing request cannot resurrect a refresh', async () => {
    const request = deferred();
    sendTyping.mockReturnValueOnce(request.promise);
    const pending = plugin.sendTyping('instance', 'chat', 30000);
    await turn();
    expect(sendTyping).toHaveBeenCalledTimes(1);
    await plugin.sendTyping('instance', 'chat', 0);
    request.resolve();
    await pending;
    expect(intervals.size).toBe(0);
    expect(timeouts.size).toBe(0);
  });

  for (const outcome of ['resolve', 'reject'] as const) {
    test(`a late ${outcome} from a replaced request leaves its successor intact`, async () => {
      const request = deferred();
      sendTyping.mockReturnValueOnce(request.promise);
      const pending = plugin.sendTyping('instance', 'chat', 30000);
      await turn();
      await plugin.sendTyping('instance', 'chat', 30000);
      if (outcome === 'resolve') request.resolve();
      else request.reject(new Error('old request failed'));
      await pending;
      expect(intervals.size).toBe(1);
      expect(timeouts.size).toBe(1);
      for (const timer of intervals.values()) timer.fn();
      await turn();
      expect(sendTyping).toHaveBeenCalledTimes(3);
    });
  }

  test('an expired lifecycle refuses a late lookup and stale refresh callbacks', async () => {
    const lookup = deferred();
    fetch.mockImplementationOnce(async () => {
      await lookup.promise;
      return channel;
    });
    const pending = plugin.sendTyping('instance', 'chat');
    const refresh = [...intervals.values()][0];
    const failsafe = [...timeouts.values()][0];
    expect(failsafe?.ms).toBe(60000);
    failsafe?.fn();
    lookup.resolve();
    await pending;
    refresh?.fn();
    await turn();
    expect(sendTyping).not.toHaveBeenCalled();
    expect(intervals.size).toBe(0);
  });

  test('initial and refresh failures clear their own lifecycle', async () => {
    fetch.mockRejectedValueOnce(new Error('lookup failed'));
    await plugin.sendTyping('instance', 'chat');
    expect(intervals.size).toBe(0);
    expect(timeouts.size).toBe(0);
    await plugin.sendTyping('instance', 'chat');
    sendTyping.mockRejectedValueOnce(new Error('typing failed'));
    for (const timer of intervals.values()) timer.fn();
    await turn();
    expect(intervals.size).toBe(0);
    expect(timeouts.size).toBe(0);
  });

  test('concurrent chats stay independent and destroy prevents late sends', async () => {
    await plugin.sendTyping('instance', 'one');
    await plugin.sendTyping('instance', 'two');
    expect(intervals.size).toBe(2);
    await plugin.sendTyping('instance', 'one', 0);
    expect(intervals.size).toBe(1);
    const lookup = deferred();
    fetch.mockImplementationOnce(async () => {
      await lookup.promise;
      return channel;
    });
    const pending = plugin.sendTyping('instance', 'three');
    await plugin.destroy();
    lookup.resolve();
    await pending;
    expect(sendTyping).toHaveBeenCalledTimes(2);
    expect(intervals.size).toBe(0);
    expect(timeouts.size).toBe(0);
  });
});
