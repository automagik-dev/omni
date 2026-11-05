/**
 * Paired-agent source grant input (paired-agents slice 2, follow-up 1).
 *
 * The input deliberately has no `tenantId`: a grant's tenant is always its
 * source's tenant, stamped by `insertAgentSourceGrant` in `@omni/db`. `.strict()`
 * rejects a caller that tries to pass one.
 */

import { z } from 'zod';
import { UuidSchema } from './common';

export const AGENT_GRANT_SOURCE_KINDS = ['connector', 'connector_subscription', 'webhook_source', 'agent'] as const;

export const AgentSourceGrantInputSchema = z
  .object({
    agentId: UuidSchema,
    sourceKind: z.enum(AGENT_GRANT_SOURCE_KINDS),
    sourceId: UuidSchema,
    approvedByKeyId: UuidSchema,
  })
  .strict();
export type AgentSourceGrantInput = z.infer<typeof AgentSourceGrantInputSchema>;
