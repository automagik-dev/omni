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
// SCHEMAS
// ============================================================================

const closeTurnSchema = z.object({
  action: z.enum(['message', 'react', 'skip']).describe('How the turn was closed'),
  reason: z.string().optional().describe('Close reason (for skip action)'),
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

  // Find the open turn for this API key
  const openTurn = await services.turns.getOpenByApiKey(keyData.id);

  if (!openTurn) {
    // Idempotent: no open turn = already closed
    return c.json({
      data: {
        alreadyClosed: true,
        message: 'No open turn for this API key',
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
