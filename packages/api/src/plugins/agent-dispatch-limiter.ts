const DEFAULT_AGENT_DISPATCH_CONCURRENCY = 8;
const DEFAULT_AGENT_DISPATCH_QUEUE_MAX_DEPTH = 100;
const DEFAULT_AGENT_DISPATCH_QUEUE_MAX_WAIT_MS = 60_000;
const DEFAULT_AGENT_DISPATCH_PER_CHAT_CONCURRENCY = 1;

interface LoggerLike {
  debug: (message: string, fields?: Record<string, unknown>) => void;
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
}

export interface AgentDispatchLimiterConfig {
  defaultConcurrency: number;
  maxQueueDepth: number;
  maxQueueWaitMs: number;
  perChatConcurrency: number;
}

export interface AgentDispatchContext {
  instanceId: string;
  chatId: string;
  traceId?: string;
}

export interface AgentDispatchQueueSnapshot {
  [key: string]: unknown;
  instanceId: string;
  chatId: string;
  traceId?: string;
  activeCount: number;
  queueDepth: number;
  maxConcurrency: number;
  maxQueueDepth: number;
  waitMs?: number;
}

interface InstanceQueue {
  instanceId: string;
  activeCount: number;
  pending: QueueItem<unknown>[];
}

interface QueueItem<T> {
  context: AgentDispatchContext;
  enqueuedAt: number;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  timeout: ReturnType<typeof setTimeout> | null;
}

export class AgentDispatchQueueFullError extends Error {
  constructor(public readonly snapshot: AgentDispatchQueueSnapshot) {
    super(
      `Agent dispatch queue full for instance ${snapshot.instanceId}: ${snapshot.queueDepth}/${snapshot.maxQueueDepth} pending`,
    );
    this.name = 'AgentDispatchQueueFullError';
  }
}

export class AgentDispatchQueueTimeoutError extends Error {
  constructor(public readonly snapshot: AgentDispatchQueueSnapshot) {
    super(
      `Agent dispatch queue timed out for instance ${snapshot.instanceId} chat ${snapshot.chatId} after ${snapshot.waitMs ?? 0}ms`,
    );
    this.name = 'AgentDispatchQueueTimeoutError';
  }
}

function parsePositiveInt(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
  logger?: Pick<LoggerLike, 'warn'>,
): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger?.warn('Invalid agent dispatch limiter env value, using default', { key, value: raw, fallback });
    return fallback;
  }
  return parsed;
}

export function loadAgentDispatchLimiterConfig(
  env: Record<string, string | undefined> = process.env,
  logger?: Pick<LoggerLike, 'warn'>,
): AgentDispatchLimiterConfig {
  return {
    defaultConcurrency: parsePositiveInt(
      env,
      'OMNI_AGENT_DISPATCH_CONCURRENCY_DEFAULT',
      DEFAULT_AGENT_DISPATCH_CONCURRENCY,
      logger,
    ),
    maxQueueDepth: parsePositiveInt(
      env,
      'OMNI_AGENT_DISPATCH_QUEUE_MAX_DEPTH',
      DEFAULT_AGENT_DISPATCH_QUEUE_MAX_DEPTH,
      logger,
    ),
    maxQueueWaitMs: parsePositiveInt(
      env,
      'OMNI_AGENT_DISPATCH_QUEUE_MAX_WAIT_MS',
      DEFAULT_AGENT_DISPATCH_QUEUE_MAX_WAIT_MS,
      logger,
    ),
    perChatConcurrency: parsePositiveInt(
      env,
      'OMNI_AGENT_DISPATCH_PER_CHAT_CONCURRENCY',
      DEFAULT_AGENT_DISPATCH_PER_CHAT_CONCURRENCY,
      logger,
    ),
  };
}

export class AgentDispatchLimiter {
  private readonly queues = new Map<string, InstanceQueue>();
  private readonly chatActiveCounts = new Map<string, number>();

  constructor(
    private readonly config: AgentDispatchLimiterConfig,
    private readonly logger?: LoggerLike,
  ) {}

  run<T>(context: AgentDispatchContext, run: () => Promise<T>): Promise<T> {
    const queue = this.getQueue(context.instanceId);
    if (this.canStart(queue, context)) {
      return new Promise<T>((resolve, reject) => {
        this.startItem(queue, {
          context,
          enqueuedAt: Date.now(),
          run,
          resolve,
          reject,
          timeout: null,
        });
      });
    }

    if (queue.pending.length >= this.config.maxQueueDepth) {
      const snapshot = this.snapshot(queue, context);
      this.logger?.warn('agent_dispatch_queue_full', snapshot);
      return Promise.reject(new AgentDispatchQueueFullError(snapshot));
    }

    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        context,
        enqueuedAt: Date.now(),
        run,
        resolve,
        reject,
        timeout: null,
      };
      item.timeout = setTimeout(() => {
        const idx = queue.pending.indexOf(item as QueueItem<unknown>);
        if (idx < 0) return;
        queue.pending.splice(idx, 1);
        const snapshot = this.snapshot(queue, context, Date.now() - item.enqueuedAt);
        this.logger?.warn('agent_dispatch_queue_timeout', snapshot);
        reject(new AgentDispatchQueueTimeoutError(snapshot));
        this.drain(queue);
      }, this.config.maxQueueWaitMs);
      if (typeof item.timeout === 'object' && item.timeout && 'unref' in item.timeout) {
        item.timeout.unref();
      }

      queue.pending.push(item as QueueItem<unknown>);
      this.logger?.info('agent_dispatch_queue_enqueued', this.snapshot(queue, context));
      this.drain(queue);
    });
  }

  getSnapshot(instanceId: string): {
    activeCount: number;
    queueDepth: number;
    maxConcurrency: number;
    maxQueueDepth: number;
  } {
    const queue = this.getQueue(instanceId);
    return {
      activeCount: queue.activeCount,
      queueDepth: queue.pending.length,
      maxConcurrency: this.config.defaultConcurrency,
      maxQueueDepth: this.config.maxQueueDepth,
    };
  }

  private getQueue(instanceId: string): InstanceQueue {
    let queue = this.queues.get(instanceId);
    if (!queue) {
      queue = { instanceId, activeCount: 0, pending: [] };
      this.queues.set(instanceId, queue);
    }
    return queue;
  }

  private canStart(queue: InstanceQueue, context: AgentDispatchContext): boolean {
    return (
      queue.activeCount < this.config.defaultConcurrency &&
      (this.chatActiveCounts.get(this.chatKey(context)) ?? 0) < this.config.perChatConcurrency
    );
  }

  private startItem<T>(queue: InstanceQueue, item: QueueItem<T>): void {
    if (item.timeout) {
      clearTimeout(item.timeout);
      item.timeout = null;
    }
    const chatKey = this.chatKey(item.context);
    queue.activeCount += 1;
    this.chatActiveCounts.set(chatKey, (this.chatActiveCounts.get(chatKey) ?? 0) + 1);
    const queueWaitMs = Date.now() - item.enqueuedAt;
    this.logger?.info('agent_dispatch_queue_started', this.snapshot(queue, item.context, queueWaitMs));

    Promise.resolve()
      .then(item.run)
      .then(item.resolve, item.reject)
      .finally(() => {
        queue.activeCount = Math.max(0, queue.activeCount - 1);
        const chatActive = (this.chatActiveCounts.get(chatKey) ?? 1) - 1;
        if (chatActive > 0) {
          this.chatActiveCounts.set(chatKey, chatActive);
        } else {
          this.chatActiveCounts.delete(chatKey);
        }
        this.logger?.info(
          'agent_dispatch_queue_finished',
          this.snapshot(queue, item.context, Date.now() - item.enqueuedAt),
        );
        this.drain(queue);
      });
  }

  private drain(queue: InstanceQueue): void {
    let started = true;
    while (started && queue.activeCount < this.config.defaultConcurrency) {
      started = false;
      for (let i = 0; i < queue.pending.length; i += 1) {
        const item = queue.pending[i];
        if (!item || !this.canStart(queue, item.context)) continue;
        queue.pending.splice(i, 1);
        this.startItem(queue, item);
        started = true;
        break;
      }
    }
  }

  private snapshot(queue: InstanceQueue, context: AgentDispatchContext, waitMs?: number): AgentDispatchQueueSnapshot {
    return {
      instanceId: context.instanceId,
      chatId: context.chatId,
      traceId: context.traceId,
      activeCount: queue.activeCount,
      queueDepth: queue.pending.length,
      maxConcurrency: this.config.defaultConcurrency,
      maxQueueDepth: this.config.maxQueueDepth,
      waitMs,
    };
  }

  private chatKey(context: AgentDispatchContext): string {
    return `${context.instanceId}:${context.chatId}`;
  }
}
