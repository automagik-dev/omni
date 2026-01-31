/**
 * Token-based authentication for Discord plugin
 *
 * Uses PluginStorage (key-value interface) to persist bot tokens.
 * Keys are namespaced per instance to support multiple bots.
 */

import type { PluginStorage } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';

const log = createLogger('discord:auth');

/**
 * Token data stored in PluginStorage
 */
interface TokenData {
  token: string;
  storedAt: number;
}

/**
 * Load bot token from storage
 *
 * @param storage - PluginStorage instance from plugin context
 * @param instanceId - Instance identifier for namespacing
 * @returns The bot token or null if not found
 */
export async function loadToken(storage: PluginStorage, instanceId: string): Promise<string | null> {
  const key = `${instanceId}:token`;
  const data = await storage.get<TokenData>(key);

  if (data?.token) {
    log.debug('Loaded token from storage', { instanceId });
    return data.token;
  }

  return null;
}

/**
 * Save bot token to storage
 *
 * @param storage - PluginStorage instance
 * @param instanceId - Instance identifier
 * @param token - Bot token to store
 */
export async function saveToken(storage: PluginStorage, instanceId: string, token: string): Promise<void> {
  const key = `${instanceId}:token`;
  const data: TokenData = {
    token,
    storedAt: Date.now(),
  };

  await storage.set(key, data);
  log.debug('Saved token to storage', { instanceId });
}

/**
 * Clear bot token from storage
 *
 * @param storage - PluginStorage instance
 * @param instanceId - Instance identifier
 */
export async function clearToken(storage: PluginStorage, instanceId: string): Promise<void> {
  const key = `${instanceId}:token`;
  await storage.delete(key);
  log.debug('Cleared token from storage', { instanceId });
}

/**
 * Check if a token exists in storage
 *
 * @param storage - PluginStorage instance
 * @param instanceId - Instance identifier
 * @returns true if token exists
 */
export async function hasToken(storage: PluginStorage, instanceId: string): Promise<boolean> {
  const token = await loadToken(storage, instanceId);
  return token !== null;
}
