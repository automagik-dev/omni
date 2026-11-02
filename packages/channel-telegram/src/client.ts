/**
 * Grammy Bot client wrapper
 *
 * Creates and manages grammy Bot instances for Telegram connections.
 */

import { createLogger } from '@omni/core';
import type { TelegramBotLike } from './grammy-shim';

const log = createLogger('telegram:client');

/** Active bot instances keyed by instance ID */
const bots = new Map<string, TelegramBotLike>();

/**
 * Create a new grammy Bot instance
 */
export async function createBot(instanceId: string, token: string): Promise<TelegramBotLike> {
  if (bots.has(instanceId)) {
    log.warn('Bot already exists for instance, destroying old one', { instanceId });
    destroyBot(instanceId);
  }

  // Lazy-load grammy to keep modules importable in tests without loading grammy.
  const { Bot, InputFile } = await import('grammy');
  const bot = new Bot(token, {
    client: {
      // Keep grammY's long upload budget for multipart media.
      timeoutSeconds: 500,
      // node-fetch falls back to the global keep-alive agent, which retires idle sockets.
      baseFetchConfig: { agent: false },
    },
  });

  function hasUpload(value: unknown): boolean {
    return (
      value instanceof InputFile ||
      (typeof value === 'object' && value !== null && Object.values(value).some(hasUpload))
    );
  }

  bot.api.config.use(async (prev, method, payload, signal) => {
    if (hasUpload(payload)) return prev(method, payload, signal);

    // Short calls, including the 30s getUpdates long poll, have a 45s deadline.
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Telegram ${method} timed out after 45 seconds`));
        controller.abort();
      }, 45000);
    });
    try {
      // grammY's Node types use abort-controller; its runtime also accepts native signals.
      const requestSignal = controller.signal as unknown as NonNullable<typeof signal>;
      return await Promise.race([prev(method, payload, requestSignal), deadline]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  });
  const wrapped = bot as unknown as TelegramBotLike;
  bots.set(instanceId, wrapped);

  log.info('Created grammy Bot', { instanceId });
  return wrapped;
}

/**
 * Get an existing bot instance
 */
export function getBot(instanceId: string): TelegramBotLike | undefined {
  return bots.get(instanceId);
}

/**
 * Destroy a bot instance and clean up
 */
export function destroyBot(instanceId: string): void {
  const bot = bots.get(instanceId);
  if (bot) {
    bot.stop();
    bots.delete(instanceId);
    log.info('Destroyed grammy Bot', { instanceId });
  }
}

/**
 * Check if a bot instance exists and is initialized
 */
export function isBotReady(instanceId: string): boolean {
  return bots.has(instanceId);
}

/**
 * Get bot info (requires bot.init() to have been called)
 */
export function getBotInfo(instanceId: string): TelegramBotLike['botInfo'] | undefined {
  const bot = bots.get(instanceId);
  return bot?.botInfo;
}
