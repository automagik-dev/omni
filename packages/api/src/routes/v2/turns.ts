/**
 * Turn Routes
 *
 * POST /v2/turns/close — close the open turn for this API key's active context.
 * Emits NATS `omni.turn.done` event. Idempotent: closing an already-closed turn returns success.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { publishTurnDone } from '../../services/turn-events';
import type { AppVariables } from '../../types';

export const turnsRoutes = new Hono<{ Variables: AppVariables }>();

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Resolve the open turn via three-tier fallback:
 *   1. API key → turn (scoped key path)
 *   2. Explicit turnId body param (when key doesn't match)
 *   3. Instance + chat context → latest open turn
 */
async function resolveOpenTurn(
  services: AppVariables['services'],
  keyId: string,
  turnId: string | undefined,
  headerInstanceId: string | undefined,
  headerChatId: string | undefined,
) {
  // Tier 1: scoped API key → turn
  const byKey = await services.turns.getOpenByApiKey(keyId);
  if (byKey) return byKey;

  // Tier 2: explicit turnId body param
  if (turnId) {
    const candidate = await services.turns.getById(turnId);
    if (candidate && candidate.status === 'open') return candidate;
  }

  // Tier 3: instance + chat from headers or key context columns
  let instanceId = headerInstanceId;
  let chatId = headerChatId;
  if (!instanceId || !chatId) {
    const fullKey = await services.apiKeys.getById(keyId);
    if (fullKey) {
      instanceId = instanceId ?? fullKey.contextInstanceId ?? undefined;
      chatId = chatId ?? fullKey.contextChatId ?? undefined;
    }
  }
  if (instanceId && chatId) {
    return services.turns.getOpen(instanceId, chatId);
  }

  return null;
}

// ============================================================================
// SCHEMAS
// ============================================================================

const closeTurnSchema = z.object({
  action: z.enum(['message', 'react', 'skip']).describe('How the turn was closed'),
  reason: z.string().optional().describe('Close reason (for skip action)'),
  turnId: z
    .string()
    .uuid()
    .optional()
    .describe('Explicit turn ID to close (fallback when API key has no associated turn)'),
});

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /turns/close — Close the open turn for this API key's context.
 *
 * Resolves instance + chat from:
 *   1. Request body (explicit instanceId + chatId)
 *   2. API key context columns (contextInstanceId + contextChatId)
 *   3. Env-var-style: OMNI_INSTANCE/OMNI_CHAT headers
 *
 * Idempotent: if no open turn exists, returns success with `alreadyClosed: true`.
 */
turnsRoutes.post('/close', zValidator('json', closeTurnSchema), async (c) => {
  const keyData = c.get('apiKey');
  if (!keyData) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'API key required' } }, 401);
  }

  const body = c.req.valid('json');
  const services = c.get('services');

  // Resolve the open turn via three-tier fallback
  const openTurn = await resolveOpenTurn(
    services,
    keyData.id,
    body.turnId,
    c.req.header('x-omni-instance'),
    c.req.header('x-omni-chat'),
  );

  if (!openTurn) {
    // Idempotent: no open turn = already closed
    return c.json({
      data: {
        alreadyClosed: true,
        message: 'No open turn found',
      },
    });
  }

  // Close the turn
  const closed = await services.turns.close(openTurn.id, {
    action: body.action,
    reason: body.reason,
  });

  if (!closed) {
    // Race condition: turn was closed between getOpenByApiKey and close
    return c.json({
      data: {
        alreadyClosed: true,
        message: 'Turn was closed concurrently',
      },
    });
  }

  // Calculate duration
  const durationMs = closed.closedAt
    ? closed.closedAt.getTime() - closed.startedAt.getTime()
    : Date.now() - closed.startedAt.getTime();

  // Publish NATS turn.done event
  publishTurnDone(closed.instanceId, closed.chatId, {
    turnId: closed.id,
    action: body.action,
    messageId: body.action === 'message' ? closed.messageId : undefined,
    emoji: body.action === 'react' ? undefined : undefined,
    reason: body.reason,
    duration: durationMs,
    nudgeCount: closed.nudgeCount,
    messagesSent: closed.messagesSent,
  });

  return c.json({
    data: {
      turnId: closed.id,
      action: body.action,
      duration: durationMs,
      nudgeCount: closed.nudgeCount,
      messagesSent: closed.messagesSent,
      closedAt: closed.closedAt?.toISOString(),
    },
  });
});
