/**
 * Context Resolution
 *
 * Resolves conversation context (instance, chat, message) through a priority chain:
 *   1. Explicit CLI flags (--instance, --to, --message)
 *   2. Environment variables (OMNI_INSTANCE, OMNI_CHAT, OMNI_MESSAGE)
 *   3. PG-backed context (stored per API key via /context endpoint)
 *   4. Config defaults (defaultInstance from ~/.omni/config.json)
 *   5. Error — no context available
 *
 * Each field is resolved independently so that a single flag (e.g. --message)
 * does not nullify other fields available from lower-priority sources.
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
 * Each field (instanceId, chatId, messageId) is resolved independently through
 * the priority chain: CLI flags > env vars > PG context > config defaults.
 * This prevents a single flag (e.g. --message) from nullifying other fields
 * that are available from lower-priority sources (e.g. OMNI_INSTANCE env var).
 *
 * @param flags - Explicit CLI flags passed by the user
 * @returns Resolved context with source indicator
 */
export async function resolveContext(flags?: {
  instance?: string;
  chat?: string;
  message?: string;
}): Promise<ResolvedContext> {
  // Gather values from each layer — resolve per-field with cascading priority

  // Layer 1: CLI flags
  const flagInstance = flags?.instance;
  const flagChat = flags?.chat;
  const flagMessage = flags?.message;

  // Layer 2: Environment variables (set by turn-based dispatcher)
  const envInstance = process.env.OMNI_INSTANCE;
  const envChat = process.env.OMNI_CHAT;
  const envMessage = process.env.OMNI_MESSAGE;

  // Layer 3: PG-backed context (per API key)
  let apiInstance: string | undefined;
  let apiChat: string | undefined;
  let apiMessage: string | undefined;
  try {
    const client = getClient();
    const ctx = await client.context.get();
    apiInstance = ctx.instanceId ?? undefined;
    apiChat = ctx.chatId ?? undefined;
    apiMessage = ctx.messageId ?? undefined;
  } catch {
    // Context endpoint may not be available — skip
  }

  // Layer 4: Config defaults
  const config = loadConfig();
  const configInstance = config.defaultInstance;

  // Resolve each field independently: first non-undefined value wins
  const instanceId = flagInstance ?? envInstance ?? apiInstance ?? configInstance ?? null;
  const chatId = flagChat ?? envChat ?? apiChat ?? null;
  const messageId = flagMessage ?? envMessage ?? apiMessage ?? null;

  // Determine source label from highest-priority layer that contributed
  const source: ResolvedContext['source'] =
    flagInstance || flagChat || flagMessage
      ? 'flags'
      : envInstance || envChat || envMessage
        ? 'env'
        : apiInstance || apiChat || apiMessage
          ? 'api'
          : configInstance
            ? 'config'
            : 'none';

  return { instanceId, chatId, messageId, source };
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

/**
 * Resolve the message ID for --reply.
 *
 * Priority:
 *   1. Explicit message ID passed via --reply <id>
 *   2. OMNI_MESSAGE env var (set by turn-based dispatcher)
 *   3. messageId from resolved context (PG-backed)
 *   4. null — no reply target available
 */
export async function resolveReplyTo(explicitMessageId?: string): Promise<string | null> {
  if (explicitMessageId) return explicitMessageId;

  const envMessage = process.env.OMNI_MESSAGE;
  if (envMessage) return envMessage;

  try {
    const client = getClient();
    const ctx = await client.context.get();
    if (ctx.messageId) return ctx.messageId;
  } catch {
    // Context endpoint may not be available
  }

  return null;
}
