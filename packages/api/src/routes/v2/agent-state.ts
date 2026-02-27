/**
 * Agent State Routes
 *
 * Endpoints for the ephemeral agent state machine.
 *
 *   GET  /agent-state/stream?chatId=:chatId    — SSE stream, all agents in a chat
 *   GET  /agent-state/stream?agentId=:agentId  — SSE stream, one agent across all chats
 *   GET  /agent-state/:agentId/:chatId          — one-shot current state
 *   PUT  /agent-state/:agentId/:chatId          — update state (agent calls this)
 */

import { zValidator } from '@hono/zod-validator';
import { AgentStatusSchema, SetAgentStateSchema } from '@omni/core';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { AppVariables } from '../../types';

export const agentStateRoutes = new Hono<{ Variables: AppVariables }>();

// ──────────────────────────────────────────────────────────────
// Query schemas
// ──────────────────────────────────────────────────────────────

const streamQuerySchema = z
  .object({
    chatId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
  })
  .refine((v) => v.chatId ?? v.agentId, {
    message: 'At least one of chatId or agentId is required',
  });

// ──────────────────────────────────────────────────────────────
// PUT body schema (reuses core SetAgentStateSchema)
// ──────────────────────────────────────────────────────────────

const updateStateSchema = z.object({
  status: AgentStatusSchema,
  statusMeta: SetAgentStateSchema.shape.statusMeta,
  conversationId: z.string().uuid().nullable().optional(),
});

// ──────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────

/**
 * GET /agent-state/stream
 *
 * SSE stream. Emits `agent.state.changed` events whenever any watched
 * agent state changes in NATS KV.
 *
 * Query params (at least one required):
 *   chatId  — stream all agent states for a specific chat
 *   agentId — stream a specific agent's states across all chats
 */
agentStateRoutes.get('/stream', zValidator('query', streamQuerySchema), (c) => {
  const { chatId, agentId } = c.req.valid('query');
  const services = c.get('services');

  return streamSSE(c, async (stream) => {
    // Notify the client which filters are active
    await stream.writeSSE({
      event: 'connected',
      data: JSON.stringify({ chatId: chatId ?? null, agentId: agentId ?? null }),
    });

    // Use AbortController to stop the watcher when the client disconnects
    const controller = new AbortController();

    // Heartbeat every 30 s
    const heartbeatTimer = setInterval(async () => {
      try {
        await stream.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeatTimer);
        controller.abort();
      }
    }, 30_000);

    try {
      const watcher = services.agentState.watchChanges({
        agentId,
        chatId,
        signal: controller.signal,
      });

      for await (const state of watcher) {
        if (controller.signal.aborted) break;

        try {
          await stream.writeSSE({
            event: 'agent.state.changed',
            data: JSON.stringify(state),
          });
        } catch {
          // Client disconnected
          break;
        }
      }
    } catch {
      // Watcher error — let stream close gracefully
    } finally {
      clearInterval(heartbeatTimer);
      controller.abort();
    }
  });
});

/**
 * GET /agent-state/:agentId/:chatId
 *
 * One-shot: return the current state for an (agentId, chatId) pair.
 * Returns 404 if no state exists.
 */
agentStateRoutes.get('/:agentId/:chatId', async (c) => {
  const agentId = c.req.param('agentId');
  const chatId = c.req.param('chatId');
  const services = c.get('services');

  const state = await services.agentState.getState(agentId, chatId);

  if (!state) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `No active state for agent ${agentId} in chat ${chatId}` } },
      404,
    );
  }

  return c.json({ data: state });
});

/**
 * PUT /agent-state/:agentId/:chatId
 *
 * Update agent state. Called by the agent (or dispatcher) to transition
 * the state machine.
 */
agentStateRoutes.put('/:agentId/:chatId', zValidator('json', updateStateSchema), async (c) => {
  const agentId = c.req.param('agentId');
  const chatId = c.req.param('chatId');
  const { status, statusMeta, conversationId } = c.req.valid('json');
  const services = c.get('services');

  const state = await services.agentState.setState(agentId, chatId, status, statusMeta, conversationId ?? null);

  return c.json({ data: state });
});
