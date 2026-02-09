/**
 * Grammy Bot client wrapper
 *
 * Creates and manages grammy Bot instances for Telegram connections.
 */

import { createLogger } from '@omni/core';
import { Bot } from 'grammy';

const log = createLogger('telegram:client');

/** Active bot instances keyed by instance ID */
const bots = new Map<string, Bot>();

/**
 * Create a new grammy Bot instance
 */
export function createBot(instanceId: string, token: string): Bot {
  if (bots.has(instanceId)) {
    log.warn('Bot already exists for instance, destroying old one', { instanceId });
    destroyBot(instanceId);
  }

  const bot = new Bot(token);
  bots.set(instanceId, bot);

  log.info('Created grammy Bot', { instanceId });
  return bot;
}

/**
 * Get an existing bot instance
 */
export function getBot(instanceId: string): Bot | undefined {
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
export function getBotInfo(instanceId: string): Bot['botInfo'] | undefined {
  const bot = bots.get(instanceId);
  return bot?.botInfo;
}
