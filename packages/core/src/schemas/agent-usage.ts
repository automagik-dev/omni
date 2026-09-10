/**
 * Cost/usage stamped on the journal row of the event that woke an agent (#1064).
 *
 * Lives in `omni_events.metadata.agentUsage` (JSONB) — no dedicated columns:
 * cost-per-event is a `(metadata->'agentUsage'->>'costUsd')::numeric`
 * aggregation, grouped by whatever the row already carries (event_type,
 * agent_id, chat_uuid). Every field but `providerId`/`runId` is optional
 * because providers expose different surfaces: claude-code reports cost and
 * model, Agno reports tokens and model, webhook providers report nothing.
 */

import { z } from 'zod';

export const AgentUsageSchema = z.object({
  providerId: z.string(),
  runId: z.string(),
  costUsd: z.number().nonnegative().optional(),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  model: z.string().min(1).optional(),
});

export type AgentUsage = z.infer<typeof AgentUsageSchema>;

/** Metadata key under which {@link AgentUsage} is stored in `omni_events.metadata`. */
export const AGENT_USAGE_METADATA_KEY = 'agentUsage';

/**
 * Build the stamp from a provider result's `metadata`. Returns null when the
 * provider exposed no usage at all — nothing is stamped rather than a row of
 * zeros that would skew averages.
 */
export function agentUsageFromResult(metadata: {
  providerId: string;
  runId: string;
  cost?: { inputTokens?: number; outputTokens?: number; costUsd?: number; model?: string };
}): AgentUsage | null {
  const cost = metadata.cost;
  if (!cost) return null;
  const parsed = AgentUsageSchema.safeParse({
    providerId: metadata.providerId,
    runId: metadata.runId,
    costUsd: cost.costUsd,
    tokensIn: cost.inputTokens,
    tokensOut: cost.outputTokens,
    model: cost.model,
  });
  if (!parsed.success) return null;
  const { providerId: _p, runId: _r, ...fields } = parsed.data;
  return Object.values(fields).some((v) => v !== undefined) ? parsed.data : null;
}
