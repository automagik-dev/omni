/**
 * Turn Routes
 *
 * Agent routes:
 *   POST /v2/turns/close — close the open turn for this API key's active context.
 *
 * Admin routes (require turns:admin scope or master key):
 *   GET    /v2/turns           — list turns with filters
 *   GET    /v2/turns/stats     — aggregate metrics
 *   GET    /v2/turns/:id       — single turn details
 *   POST   /v2/turns/:id/close — admin force-close
 *   POST   /v2/turns/close-all — bulk close all open turns
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { ApiKeyService } from '../../services/api-keys';
import { publishTurnDone } from '../../services/turn-events';
import type { AppVariables } from '../../types';

export const turnsRoutes = new Hono<{ Variables: AppVariables }>();

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Guard: reject requests from scoped (non-admin) keys.
 * Returns an error response if the key lacks turns:admin or * scope, null otherwise.
 */
function requireAdmin(c: {
  get: (key: 'apiKey') => AppVariables['apiKey'];
  json: (data: unknown, status: number) => Response;
}) {
  const keyData = c.get('apiKey');
  if (!keyData) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'API key required' } }, 401);
  }
  if (!ApiKeyService.scopeAllows(keyData.scopes, 'turns:admin')) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Master key or turns:admin scope required' } }, 403);
  }
  return null;
}

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

// ============================================================================
// ADMIN ROUTES
// ============================================================================

const listQuerySchema = z.object({
  status: z.enum(['open', 'done', 'timeout']).optional(),
  instanceId: z.string().uuid().optional(),
  chatId: z.string().optional(),
  agentId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const adminForceCloseSchema = z.object({
  reason: z.string().optional(),
});

const bulkCloseSchema = z.object({
  confirm: z.boolean(),
  reason: z.string().optional(),
});

/**
 * GET /turns — List turns with optional filters and pagination.
 */
turnsRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const query = c.req.valid('query');
  const services = c.get('services');

  const { items, total } = await services.turns.list({
    status: query.status,
    instanceId: query.instanceId,
    chatId: query.chatId,
    agentId: query.agentId,
    limit: query.limit,
    offset: query.offset,
  });

  return c.json({
    data: {
      items: items.map((t) => ({
        id: t.id,
        instanceId: t.instanceId,
        chatId: t.chatId,
        messageId: t.messageId,
        agentId: t.agentId,
        apiKeyId: t.apiKeyId,
        status: t.status,
        action: t.action,
        nudgeCount: t.nudgeCount,
        messagesSent: t.messagesSent,
        startedAt: t.startedAt.toISOString(),
        lastActivityAt: t.lastActivityAt.toISOString(),
        closedAt: t.closedAt?.toISOString() ?? null,
        closedReason: t.closedReason,
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    },
  });
});

/**
 * GET /turns/stats — Aggregate turn metrics.
 */
turnsRoutes.get('/stats', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const services = c.get('services');
  const stats = await services.turns.stats();

  return c.json({ data: stats });
});

/**
 * GET /turns/:id — Single turn details.
 */
turnsRoutes.get('/:id', async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const services = c.get('services');
  const turn = await services.turns.getById(c.req.param('id'));

  if (!turn) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Turn not found' } }, 404);
  }

  return c.json({
    data: {
      id: turn.id,
      instanceId: turn.instanceId,
      chatId: turn.chatId,
      messageId: turn.messageId,
      agentId: turn.agentId,
      apiKeyId: turn.apiKeyId,
      status: turn.status,
      action: turn.action,
      nudgeCount: turn.nudgeCount,
      messagesSent: turn.messagesSent,
      startedAt: turn.startedAt.toISOString(),
      lastActivityAt: turn.lastActivityAt.toISOString(),
      closedAt: turn.closedAt?.toISOString() ?? null,
      closedReason: turn.closedReason,
      metadata: turn.metadata,
    },
  });
});

/**
 * POST /turns/:id/close — Admin force-close a single turn.
 */
turnsRoutes.post('/:id/close', zValidator('json', adminForceCloseSchema), async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const services = c.get('services');
  const body = c.req.valid('json');
  const turnId = c.req.param('id');

  const closed = await services.turns.forceClose(turnId, body.reason);

  if (!closed) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Turn not found or already closed' } }, 404);
  }

  // Publish NATS turn.done event (same as agent close path)
  const durationMs = closed.closedAt
    ? closed.closedAt.getTime() - closed.startedAt.getTime()
    : Date.now() - closed.startedAt.getTime();
  publishTurnDone(closed.instanceId, closed.chatId, {
    turnId: closed.id,
    action: 'skip',
    reason: body.reason ?? 'admin force-close',
    duration: durationMs,
    nudgeCount: closed.nudgeCount,
    messagesSent: closed.messagesSent,
  });

  return c.json({
    data: {
      turnId: closed.id,
      status: closed.status,
      closedAt: closed.closedAt?.toISOString() ?? null,
    },
  });
});

/**
 * POST /turns/close-all — Bulk close all open turns.
 * Requires { confirm: true } in body.
 */
turnsRoutes.post('/close-all', zValidator('json', bulkCloseSchema), async (c) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const body = c.req.valid('json');

  if (!body.confirm) {
    return c.json(
      { error: { code: 'CONFIRMATION_REQUIRED', message: 'Set confirm: true to bulk-close all open turns' } },
      400,
    );
  }

  const services = c.get('services');
  const closedCount = await services.turns.bulkClose(body.reason);

  // Note: bulk close does not publish individual turn.done events because
  // bulkClose returns only the count, not full turn rows needed for event payloads.
  // This is intentional for admin emergency operations — downstream systems should
  // treat bulk close as a reset, not as N individual turn completions.

  return c.json({
    data: {
      closedCount,
      message: `Closed ${closedCount} open turn(s)`,
    },
  });
});
