import { describe, expect, it, mock } from 'bun:test';
import {
  AgentDispatchLimiter,
  AgentDispatchQueueFullError,
  AgentDispatchQueueTimeoutError,
  loadAgentDispatchLimiterConfig,
} from '../agent-dispatch-limiter';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function logger() {
  return {
    debug: mock((_message: string, _fields?: Record<string, unknown>) => {}),
    info: mock((_message: string, _fields?: Record<string, unknown>) => {}),
    warn: mock((_message: string, _fields?: Record<string, unknown>) => {}),
  };
}

async function flushStartedRuns() {
  await Promise.resolve();
}

const CTX = { instanceId: 'inst-1', chatId: 'chat-1', traceId: 'trace-1' };

describe('loadAgentDispatchLimiterConfig', () => {
  it('uses safe defaults when env is empty', () => {
    expect(loadAgentDispatchLimiterConfig({})).toEqual({
      defaultConcurrency: 8,
      maxQueueDepth: 100,
      maxQueueWaitMs: 600_000,
      perChatConcurrency: 1,
    });
  });

  it('parses positive integer env overrides', () => {
    expect(
      loadAgentDispatchLimiterConfig({
        OMNI_AGENT_DISPATCH_CONCURRENCY_DEFAULT: '12',
        OMNI_AGENT_DISPATCH_QUEUE_MAX_DEPTH: '50',
        OMNI_AGENT_DISPATCH_QUEUE_MAX_WAIT_MS: '30000',
        OMNI_AGENT_DISPATCH_PER_CHAT_CONCURRENCY: '2',
      }),
    ).toEqual({
      defaultConcurrency: 12,
      maxQueueDepth: 50,
      maxQueueWaitMs: 30_000,
      perChatConcurrency: 2,
    });
  });

  it('falls back and warns on invalid env values', () => {
    const log = logger();
    const cfg = loadAgentDispatchLimiterConfig({ OMNI_AGENT_DISPATCH_CONCURRENCY_DEFAULT: '0' }, log);
    expect(cfg.defaultConcurrency).toBe(8);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe('AgentDispatchLimiter', () => {
  it('runs immediately under capacity', async () => {
    const limiter = new AgentDispatchLimiter(
      { defaultConcurrency: 1, maxQueueDepth: 10, maxQueueWaitMs: 1000, perChatConcurrency: 1 },
      logger(),
    );
    const run = mock(async () => 'ok');

    await expect(limiter.run(CTX, run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
    expect(limiter.getSnapshot('inst-1')).toMatchObject({ activeCount: 0, queueDepth: 0 });
  });

  it('enqueues when global capacity is full and starts after completion', async () => {
    const limiter = new AgentDispatchLimiter(
      { defaultConcurrency: 1, maxQueueDepth: 10, maxQueueWaitMs: 1000, perChatConcurrency: 1 },
      logger(),
    );
    const first = deferred();
    const secondRun = mock(async () => 'second');

    const firstPromise = limiter.run(CTX, async () => first.promise);
    const secondPromise = limiter.run({ ...CTX, chatId: 'chat-2' }, secondRun);

    expect(secondRun).toHaveBeenCalledTimes(0);
    expect(limiter.getSnapshot('inst-1')).toMatchObject({ activeCount: 1, queueDepth: 1 });

    first.resolve();
    await firstPromise;
    await expect(secondPromise).resolves.toBe('second');
    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  it('serializes dispatches for the same chat by default', async () => {
    const limiter = new AgentDispatchLimiter(
      { defaultConcurrency: 2, maxQueueDepth: 10, maxQueueWaitMs: 1000, perChatConcurrency: 1 },
      logger(),
    );
    const first = deferred();
    const secondRun = mock(async () => 'second');

    const firstPromise = limiter.run(CTX, async () => first.promise);
    const secondPromise = limiter.run(CTX, secondRun);

    expect(secondRun).toHaveBeenCalledTimes(0);
    expect(limiter.getSnapshot('inst-1')).toMatchObject({ activeCount: 1, queueDepth: 1 });

    first.resolve();
    await firstPromise;
    await expect(secondPromise).resolves.toBe('second');
    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  it('allows different chats to run concurrently up to global capacity', async () => {
    const limiter = new AgentDispatchLimiter(
      { defaultConcurrency: 2, maxQueueDepth: 10, maxQueueWaitMs: 1000, perChatConcurrency: 1 },
      logger(),
    );
    const first = deferred();
    const second = deferred();
    const firstRun = mock(async () => first.promise);
    const secondRun = mock(async () => second.promise);

    const firstPromise = limiter.run(CTX, firstRun);
    const secondPromise = limiter.run({ ...CTX, chatId: 'chat-2' }, secondRun);
    await flushStartedRuns();

    expect(firstRun).toHaveBeenCalledTimes(1);
    expect(secondRun).toHaveBeenCalledTimes(1);
    expect(limiter.getSnapshot('inst-1')).toMatchObject({ activeCount: 2, queueDepth: 0 });

    first.resolve();
    second.resolve();
    await firstPromise;
    await secondPromise;
  });

  it('throws AgentDispatchQueueFullError when pending depth exceeds max', async () => {
    const limiter = new AgentDispatchLimiter(
      { defaultConcurrency: 1, maxQueueDepth: 1, maxQueueWaitMs: 1000, perChatConcurrency: 1 },
      logger(),
    );
    const first = deferred();

    const firstPromise = limiter.run(CTX, async () => first.promise);
    const queuedPromise = limiter.run({ ...CTX, chatId: 'chat-2' }, async () => 'queued');

    await expect(limiter.run({ ...CTX, chatId: 'chat-3' }, async () => 'full')).rejects.toBeInstanceOf(
      AgentDispatchQueueFullError,
    );

    first.resolve();
    await firstPromise;
    await queuedPromise;
  });

  it('throws AgentDispatchQueueTimeoutError when queued longer than max wait', async () => {
    const limiter = new AgentDispatchLimiter(
      { defaultConcurrency: 1, maxQueueDepth: 10, maxQueueWaitMs: 5, perChatConcurrency: 1 },
      logger(),
    );
    const first = deferred();

    const firstPromise = limiter.run(CTX, async () => first.promise);
    const timedOut = limiter.run({ ...CTX, chatId: 'chat-2' }, async () => 'too-late');

    await expect(timedOut).rejects.toBeInstanceOf(AgentDispatchQueueTimeoutError);
    first.resolve();
    await firstPromise;
  });

  it('releases counters when callback throws', async () => {
    const limiter = new AgentDispatchLimiter(
      { defaultConcurrency: 1, maxQueueDepth: 10, maxQueueWaitMs: 1000, perChatConcurrency: 1 },
      logger(),
    );

    await expect(
      limiter.run(CTX, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(limiter.getSnapshot('inst-1')).toMatchObject({ activeCount: 0, queueDepth: 0 });
  });

  it('does not deadlock behind a busy chat at the front of the queue', async () => {
    const limiter = new AgentDispatchLimiter(
      { defaultConcurrency: 2, maxQueueDepth: 10, maxQueueWaitMs: 1000, perChatConcurrency: 1 },
      logger(),
    );
    const first = deferred();
    const blocker = deferred();
    const sameChatRun = mock(async () => 'same-chat');
    const otherChatRun = mock(async () => blocker.promise);

    const firstPromise = limiter.run(CTX, async () => first.promise);
    const sameChatPromise = limiter.run(CTX, sameChatRun);
    const otherChatPromise = limiter.run({ ...CTX, chatId: 'chat-2' }, otherChatRun);
    await flushStartedRuns();

    expect(sameChatRun).toHaveBeenCalledTimes(0);
    expect(otherChatRun).toHaveBeenCalledTimes(1);
    expect(limiter.getSnapshot('inst-1')).toMatchObject({ activeCount: 2, queueDepth: 1 });

    blocker.resolve();
    await otherChatPromise;
    expect(sameChatRun).toHaveBeenCalledTimes(0);

    first.resolve();
    await firstPromise;
    await expect(sameChatPromise).resolves.toBe('same-chat');
  });
});
