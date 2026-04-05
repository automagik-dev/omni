/**
 * Context Resolution
 *
 * Resolves conversation context (instance, chat, message) through a priority chain:
 *   1. Explicit CLI flags (--instance, --to, --message)
 *   2. Environment variables (OMNI_INSTANCE, OMNI_CHAT, OMNI_MESSAGE)
 *   3. PG-backed context (stored per API key via /context endpoint)
 *   4. Config defaults (defaultInstance from ~/.omni/config.json)
 *   5. Error — no context available
 */

import { getClient } from './client.js';
import { loadConfig } from './config.js';

export interface ResolvedContext {
  instanceId: string | null;
  chatId: string | null;
  messageId: string | null;
  source: 'flags' | 'env' | 'api' | 'config' | 'none';
}

/**
 * Resolve the current conversation context.
 *
 * @param flags - Explicit CLI flags passed by the user
 * @returns Resolved context with source indicator
 */
export async function resolveContext(flags?: {
  instance?: string;
  chat?: string;
  message?: string;
}): Promise<ResolvedContext> {
  // 1. Explicit CLI flags take highest priority
  if (flags?.instance || flags?.chat || flags?.message) {
    return {
      instanceId: flags.instance ?? null,
      chatId: flags.chat ?? null,
      messageId: flags.message ?? null,
      source: 'flags',
    };
  }

  // 2. Environment variables (set by turn-based dispatcher)
  const envInstance = process.env.OMNI_INSTANCE;
  const envChat = process.env.OMNI_CHAT;
  const envMessage = process.env.OMNI_MESSAGE;

  if (envInstance || envChat || envMessage) {
    return {
      instanceId: envInstance ?? null,
      chatId: envChat ?? null,
      messageId: envMessage ?? null,
      source: 'env',
    };
  }

  // 3. PG-backed context (per API key)
  try {
    const client = getClient();
    const ctx = await client.context.get();

    if (ctx.instanceId || ctx.chatId || ctx.messageId) {
      return {
        instanceId: ctx.instanceId,
        chatId: ctx.chatId,
        messageId: ctx.messageId,
        source: 'api',
      };
    }
  } catch {
    // Context endpoint may not be available — fall through
  }

  // 4. Config defaults
  const config = loadConfig();
  if (config.defaultInstance) {
    return {
      instanceId: config.defaultInstance,
      chatId: null,
      messageId: null,
      source: 'config',
    };
  }

  // 5. No context available
  return {
    instanceId: null,
    chatId: null,
    messageId: null,
    source: 'none',
  };
}

/**
 * Resolve instance ID with context fallback.
 * Returns the instance ID or exits with error if none available.
 */
export async function resolveInstanceFromContext(explicitInstance?: string): Promise<string> {
  if (explicitInstance) return explicitInstance;

  const ctx = await resolveContext();
  if (ctx.instanceId) return ctx.instanceId;

  // Import here to avoid circular dependency
  const output = await import('./output.js');
  return output.error('No instance specified. Use --instance, set OMNI_INSTANCE, or run: omni open <contact>');
}
