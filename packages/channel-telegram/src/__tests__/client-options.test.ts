/** Real bot construction and its installed transformer; no Telegram requests. */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { Api, ApiClientOptions } from 'grammy';
import { createBot, destroyBot } from '../client';

// Narrow structural boundary avoids grammY's legacy abort-controller/generic-result types.
type Call = (method: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>;
type Transform = (prev: Call, method: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>;

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('Telegram API deadlines', () => {
  let id: string;
  let api: Api;
  let transform: Transform;
  let sequence = 0;
  const restores: Array<() => void> = [];
  const timers = new Map<number, { fn: () => void; ms: number }>();

  beforeEach(async () => {
    id = crypto.randomUUID();
    const bot = await createBot(id, '123456:local-test-token');
    api = bot.api as unknown as Api;
    const installed = api.config.installedTransformers();
    if (!installed[0]) throw new Error('Missing API deadline transformer');
    transform = installed[0] as unknown as Transform;
    const stop = spyOn(bot, 'stop').mockImplementation(() => {});
    timers.clear();
    const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms: number) => {
      const timer = ++sequence;
      timers.set(timer, { fn, ms });
      return timer;
    }) as unknown as typeof setTimeout);
    const clear = spyOn(globalThis, 'clearTimeout').mockImplementation((timer) => {
      timers.delete(Number(timer));
    });
    restores.push(
      () => stop.mockRestore(),
      () => timeout.mockRestore(),
      () => clear.mockRestore(),
    );
  });

  afterEach(() => {
    try {
      destroyBot(id);
      expect(timers.size).toBe(0);
    } finally {
      for (const restore of restores.splice(0).reverse()) restore();
    }
  });

  function fireDeadline() {
    const timer = [...timers.entries()].find(([, value]) => value.ms === 45000);
    if (!timer) throw new Error('Missing short-call deadline');
    timer[1].fn();
  }

  test('the underlying client keeps a 500s upload budget and uses the global agent fallback', () => {
    const options = (api as unknown as { options: { timeoutSeconds: number; baseFetchConfig: { agent: unknown } } })
      .options;
    expect(options.timeoutSeconds).toBe(500);
    expect(options.baseFetchConfig.agent).toBe(false);
  });

  for (const method of ['getUpdates', 'sendMessage', 'sendChatAction'] as const) {
    test(`${method} aborts and settles at 45s even if the transport hangs`, async () => {
      let requestSignal: AbortSignal | undefined;
      const prev: Call = async (_method, _payload, signal) => {
        requestSignal = signal;
        return new Promise<never>(() => {});
      };
      const pending = transform(prev, method, { chat_id: 1, text: 'test', action: 'typing', timeout: 30 });
      expect([...timers.values()].map((timer) => timer.ms)).toEqual([45000]);
      expect(requestSignal?.aborted).toBe(false);
      fireDeadline();
      await expect(pending).rejects.toThrow('timed out after 45 seconds');
      expect(requestSignal?.aborted).toBe(true);
    });
  }

  test('short calls clear their deadline and caller listener on success and failure', async () => {
    for (const fails of [false, true]) {
      const controller = new AbortController();
      const remove = spyOn(controller.signal, 'removeEventListener');
      try {
        const prev: Call = async () => {
          if (fails) throw new Error('request failed');
          return { ok: true, result: true };
        };
        const result = transform(prev, 'getMe', {}, controller.signal);
        if (fails) await expect(result).rejects.toThrow('request failed');
        else expect(await result).toEqual({ ok: true, result: true });
        expect(timers.size).toBe(0);
        expect(remove).toHaveBeenCalledTimes(1);
      } finally {
        remove.mockRestore();
      }
    }
  });

  test('caller cancellation reaches short requests and clears the deadline', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const prev: Call = async (_method, _payload, signal) => {
      requestSignal = signal;
      return new Promise<never>((_, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    };
    const pending = transform(prev, 'getUpdates', { timeout: 30 }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(requestSignal?.aborted).toBe(true);
  });

  test('a pre-aborted caller signal remains aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const prev: Call = async (_method, _payload, signal) => {
      expect(signal?.aborted).toBe(true);
      throw new Error('cancelled');
    };
    await expect(transform(prev, 'getMe', {}, controller.signal)).rejects.toThrow('cancelled');
  });

  test('buffer/base64 uploads and nested albums have no short deadline, independent of short calls', async () => {
    const { InputFile } = await import('grammy');
    for (const nested of [false, true]) {
      const controller = new AbortController();
      const file = new InputFile(Buffer.from('bWVkaWE=', 'base64'), 'clip.mp4');
      const payload = nested
        ? { chat_id: 1, media: [{ type: 'video' as const, media: file }] }
        : { chat_id: 1, photo: file };
      let finish = () => {};
      const prev: Call = async (_method, actualPayload, signal) => {
        expect(actualPayload).toBe(payload);
        expect(signal).toBe(controller.signal);
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { ok: true, result: true };
      };
      const upload = transform(prev, nested ? 'sendMediaGroup' : 'sendPhoto', payload, controller.signal);
      expect(timers.size).toBe(0);
      const hanging: Call = async () => new Promise<never>(() => {});
      const short = transform(hanging, 'getUpdates', { timeout: 30 });
      fireDeadline();
      await expect(short).rejects.toThrow('timed out after 45 seconds');
      expect(controller.signal.aborted).toBe(false);
      finish();
      await expect(upload).resolves.toEqual({ ok: true, result: true });
    }
  });

  test('real grammY multipart requests retain their 500s timeout', async () => {
    const { Api, InputFile } = await import('grammy');
    const options = (api as unknown as { options: ApiClientOptions }).options;
    for (const nested of [false, true]) {
      let requestAborted = () => false;
      const fetch = (async (_url: unknown, init: { headers: Record<string, string>; signal: AbortSignal }) => {
        expect(init.headers['content-type']).toStartWith('multipart/form-data');
        requestAborted = () => init.signal.aborted;
        return new Promise<never>(() => {});
      }) as unknown as ApiClientOptions['fetch'];
      const uploadApi = new Api('123456:local-test-token', { ...options, fetch });
      uploadApi.config.use(...api.config.installedTransformers());
      const file = new InputFile(Buffer.from('bWVkaWE=', 'base64'), 'clip.mp4');
      const pending = nested
        ? uploadApi.raw.sendMediaGroup({ chat_id: 1, media: [{ type: 'video', media: file }] })
        : uploadApi.raw.sendPhoto({ chat_id: 1, photo: file });
      expect([...timers.values()].map((timer) => timer.ms)).toEqual([500000]);
      expect(requestAborted()).toBe(false);
      const deadline = [...timers.values()][0];
      if (!deadline) throw new Error('Missing upload deadline');
      deadline.fn();
      await expect(pending).rejects.toMatchObject({
        error: { message: expect.stringContaining('timed out after 500 seconds') },
      });
      expect(requestAborted()).toBe(true);
      expect(timers.size).toBe(0);
    }
  });

  test('real grammY short requests cancel at 45s and clear their underlying timeout', async () => {
    const { Api } = await import('grammy');
    const options = (api as unknown as { options: ApiClientOptions }).options;
    let requestAborted = () => false;
    const fetch = (async (_url: unknown, init: { signal: AbortSignal }) => {
      requestAborted = () => init.signal.aborted;
      return new Promise<never>((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }) as unknown as ApiClientOptions['fetch'];
    const shortApi = new Api('123456:local-test-token', { ...options, fetch });
    shortApi.config.use(...api.config.installedTransformers());
    const pending = shortApi.raw.getUpdates({ timeout: 30 });
    expect([...timers.values()].map((timer) => timer.ms)).toEqual([45000, 500000]);
    fireDeadline();
    await expect(pending).rejects.toThrow('timed out after 45 seconds');
    await turn();
    expect(requestAborted()).toBe(true);
    expect(timers.size).toBe(0);
  });

  test('URL media uses the short deadline', async () => {
    const prev: Call = async () => new Promise<never>(() => {});
    const pending = transform(prev, 'sendPhoto', { chat_id: 1, photo: 'https://example.test/media.jpg' });
    fireDeadline();
    await expect(pending).rejects.toThrow('timed out after 45 seconds');
    await turn();
  });
});
