/**
 * One chat resolution for `/chats/:id/*`, shared by the scope lock and the
 * `chats.ts` routes, so that both always name the same chat.
 *
 * `:id` is either a chat row's UUID or a platform-native id (WhatsApp JID,
 * Telegram numeric id, ...). A native id is looked up with
 * `findByExternalIdSmart` on one instance: the explicit `instanceId` the route
 * takes from its JSON body (`explicitChatInstance`), else the key's context or
 * active instance.
 *
 * The lock resolves the row first for a key with an instance lock and hands it
 * to the route through `c.set('resolvedChat', ...)`; the route then reads that
 * row instead of resolving again.
 */

import { ERROR_CODES, NotFoundError, OmniError } from '@omni/core';
import type { Chat } from '@omni/db';
import { apiKeys } from '@omni/db/schema';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { ApiKeyService } from '../services/api-keys';
import type { ApiKeyData, AppVariables } from '../types';
import { isJsonContentType } from './json-body';

type ChatContext = Context<{ Variables: AppVariables }>;

/** Standard UUID v1-v5 pattern (same as app.ts and messages.ts). */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isChatUuid(raw: string): boolean {
  return UUID_REGEX.test(raw);
}

/**
 * Verify the API key's legacy `instanceIds` restriction covers the instance.
 */
export function checkInstanceAccess(apiKey: ApiKeyData | undefined, instanceId: string): void {
  if (apiKey && !ApiKeyService.instanceAllowed(apiKey.instanceIds, instanceId)) {
    throw new OmniError({
      code: ERROR_CODES.VALIDATION,
      message: 'API key does not have access to this instance',
      context: { instanceId },
      recoverable: false,
    });
  }
}

/**
 * Resolve the active instance for an API key. Reads `contextInstanceId` first
 * (set via POST /context) then falls back to `activeInstanceId` (set via
 * POST /context/use). Returns null when neither is set — callers MUST NOT
 * guess across the API key's authorized instances.
 */
export async function getActiveInstanceId(c: ChatContext): Promise<string | null> {
  const keyData = c.get('apiKey');
  if (!keyData) return null;
  const db = c.get('db');
  const [row] = await db
    .select({
      activeInstanceId: apiKeys.activeInstanceId,
      contextInstanceId: apiKeys.contextInstanceId,
    })
    .from(apiKeys)
    .where(eq(apiKeys.id, keyData.id))
    .limit(1);
  return row?.contextInstanceId ?? row?.activeInstanceId ?? null;
}

/**
 * The `chats.ts` `:id` routes that take an explicit `instanceId` in their JSON
 * body and resolve a native id on it. A route added there that reads
 * `instanceId` for its resolution belongs in this list.
 */
const EXPLICIT_INSTANCE_ROUTES: ReadonlySet<string> = new Set([
  'POST archive',
  'POST unarchive',
  'POST pin',
  'POST unpin',
  'POST mute',
  'POST unmute',
  'POST read',
  'POST disappearing',
]);

const CHAT_ACTION_PATH = /^(?:\/api\/v2)?\/chats\/[^/]+\/([^/]+)\/?$/;

/**
 * The `instanceId` a `chats.ts` route takes from its JSON body for the chat
 * lookup, or undefined when the route takes none. The lock calls it to look
 * the chat up on the instance the route will act on; the route itself uses
 * its validated body, which reads the same bytes (`isJsonContentType`).
 */
export async function explicitChatInstance(c: ChatContext): Promise<string | undefined> {
  const action = CHAT_ACTION_PATH.exec(c.req.path)?.[1];
  if (!action || !EXPLICIT_INSTANCE_ROUTES.has(`${c.req.method.toUpperCase()} ${action}`)) return undefined;
  if (!isJsonContentType(c.req.header('content-type'))) return undefined;
  let body: unknown;
  try {
    // Hono caches the parsed body, so the route's validator and this read share one parse.
    body = await c.req.json();
  } catch {
    return undefined;
  }
  if (!body || typeof body !== 'object') return undefined;
  const instanceId = (body as Record<string, unknown>).instanceId;
  return typeof instanceId === 'string' && instanceId.length > 0 ? instanceId : undefined;
}

/** The row the lock already resolved for this `raw`, if any. */
function handedChat(c: ChatContext, raw: string): Chat | null {
  const handed = c.get('resolvedChat');
  return handed && handed.raw === raw ? handed.chat : null;
}

/**
 * Resolve `raw` to its chat row, or null when there is none.
 *
 * - The row the lock handed over for the same `raw` wins (no second lookup).
 * - A UUID is read by row (hidden chats included; the route decides on those).
 * - Anything else is looked up with `findByExternalIdSmart` on
 *   `explicitInstanceId`, else the key's context or active instance; null when
 *   neither is set. The key's `instanceIds` are checked BEFORE the lookup so a
 *   caller cannot tell whether a chat exists on an instance it cannot reach.
 */
export async function resolveChatRow(c: ChatContext, raw: string, explicitInstanceId?: string): Promise<Chat | null> {
  const handed = handedChat(c, raw);
  if (handed) return handed;

  const services = c.get('services');
  if (isChatUuid(raw)) {
    try {
      return await services.chats.getById(raw, { includeHidden: true });
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  const instanceId = explicitInstanceId ?? (await getActiveInstanceId(c));
  if (!instanceId) return null;
  checkInstanceAccess(c.get('apiKey'), instanceId);
  return services.chats.findByExternalIdSmart(instanceId, raw);
}

/**
 * Resolve a `:id` URL param to a chat's internal UUID.
 *
 * - The row the lock handed over for the same `raw` wins.
 * - A UUID is returned unchanged; the route's service call 404s when no chat
 *   has it.
 * - Anything else is looked up as in `resolveChatRow`.
 *
 * Returns null when a native id has no instance to look it up on, or no chat
 * with that id exists on it.
 *
 * History: before this helper every `chatsRoutes.<verb>('/:id*')` passed the
 * raw param to a UUID column and a JID (`120363...@g.us`) made postgres-js
 * throw "invalid input syntax for type uuid" (500).
 */
export async function resolveChatIdParam(
  c: ChatContext,
  raw: string,
  explicitInstanceId?: string,
): Promise<string | null> {
  const handed = handedChat(c, raw);
  if (handed) return handed.id;
  if (isChatUuid(raw)) return raw;
  const chat = await resolveChatRow(c, raw, explicitInstanceId);
  return chat?.id ?? null;
}
