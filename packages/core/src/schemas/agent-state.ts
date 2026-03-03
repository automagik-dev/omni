/**
 * Agent Chat State schemas
 *
 * Ephemeral state machine for what an agent is doing in a chat.
 * Stored in NATS KV (not PostgreSQL) and streamed to clients via SSE.
 */

import { z } from 'zod';

/**
 * Agent status enum — follows the state machine:
 *
 *   idle → thinking → typing → sending → idle
 *               ↓
 *         running_task ──→ thinking  (loop)
 *               ↓
 *            waiting ──→ thinking    (when unblocked)
 *              ↓
 *            error ──→ idle
 */
export const AgentStatusSchema = z.enum(['idle', 'thinking', 'typing', 'sending', 'running_task', 'waiting', 'error']);

export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * Per-status metadata — open and expandable, all fields optional
 */
export const AgentStatusMetaSchema = z
  .object({
    // thinking
    model: z.string().optional(),
    tokensIn: z.number().optional(),

    // typing
    partialText: z.string().optional(),
    wordCount: z.number().optional(),

    // sending
    partsTotal: z.number().optional(),
    partsSent: z.number().optional(),

    // running_task
    taskId: z.string().uuid().optional(),
    taskType: z.string().optional(),
    taskTitle: z.string().optional(),
    progress: z.number().min(0).max(100).optional(),

    // waiting
    waitingFor: z.enum(['user_input', 'tool_result', 'external_api', 'sub_agent']).optional(),

    // error
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
    recoverable: z.boolean().optional(),
  })
  .optional();

export type AgentStatusMeta = z.infer<typeof AgentStatusMetaSchema>;

/**
 * Agent chat state — one record per (agentId, chatId) pair.
 *
 * NATS KV key pattern: `agent-state:{agentId}:{chatId}`
 */
export const AgentChatStateSchema = z.object({
  agentId: z.string().uuid(),
  chatId: z.string().uuid(),
  conversationId: z.string().uuid().nullable(),
  status: AgentStatusSchema,
  statusMeta: AgentStatusMetaSchema,
  updatedAt: z.number(), // unix ms
});

export type AgentChatState = z.infer<typeof AgentChatStateSchema>;

/**
 * Input for setting agent state (omits server-derived fields)
 */
export const SetAgentStateSchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  status: AgentStatusSchema,
  statusMeta: AgentStatusMetaSchema,
});

export type SetAgentStateInput = z.infer<typeof SetAgentStateSchema>;

/**
 * NATS KV bucket name for agent state
 */
export const AGENT_STATE_KV_BUCKET = 'agent-state';

/**
 * Build the KV key for an (agentId, chatId) pair
 */
export function agentStateKey(agentId: string, chatId: string): string {
  return `${agentId}:${chatId}`;
}
