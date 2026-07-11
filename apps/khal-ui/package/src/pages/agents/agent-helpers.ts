/**
 * Pure helpers and mirror schemas for the agents-automation vertical.
 *
 * The Zod schemas here mirror the API's real create/update schemas
 * (packages/api/src/routes/v2/agents.ts) so {@link SchemaForm} renders native
 * controls for the scalar fields; the free-form object fields (metadata,
 * agentCard) are edited through {@link JsonEditor} instead, because they have no
 * fixed shape. Kept DOM-free so the mappings are unit-testable.
 */
import { z } from 'zod';
import type { AgentRow } from '../../api/ext';

/** Agent provider systems the API accepts (agents.ts createAgentSchema). */
export const AGENT_PROVIDERS = ['claude', 'agno', 'openai', 'gemini', 'custom', 'omni-internal'] as const;
/** Agent roles the API accepts. */
export const AGENT_TYPES = ['assistant', 'workflow', 'team', 'tool'] as const;

/**
 * Scalar create form — mirrors `createAgentSchema` minus the two free-form
 * object fields (metadata, agentCard), which are edited as JSON alongside.
 */
export const agentCreateSchema = z.object({
  name: z.string().min(1).max(255).describe('Display name'),
  provider: z.enum(AGENT_PROVIDERS).describe('AI system powering the agent'),
  model: z.string().max(120).optional().describe('Model identifier'),
  agentType: z.enum(AGENT_TYPES).default('assistant').describe('Role of the agent'),
  capabilities: z.array(z.string()).default([]).describe('Declared capabilities'),
  ownerId: z.string().uuid().optional().describe('Owner person UUID'),
  agentProviderId: z.string().uuid().optional().describe('Linked provider UUID'),
  configPath: z.string().optional().describe('Path to agent config file'),
  isInternal: z.boolean().default(false).describe('Internal system agent'),
  isActive: z.boolean().default(true).describe('Active'),
});
export type AgentCreateForm = z.infer<typeof agentCreateSchema>;

/** Edit form — every field optional (PATCH is partial). */
export const agentEditSchema = agentCreateSchema.partial();

/** @khal-os/ui Badge variants, keyed by provider for a stable colour per system. */
export function providerBadgeVariant(provider: string | null | undefined): 'green' | 'blue' | 'amber' | 'gray' {
  switch (provider) {
    case 'claude':
      return 'amber';
    case 'agno':
      return 'green';
    case 'openai':
    case 'gemini':
      return 'blue';
    default:
      return 'gray';
  }
}

/** Human label for an agent's role. */
export function agentTypeLabel(agentType: string | null | undefined): string {
  switch (agentType) {
    case 'assistant':
      return 'Assistant';
    case 'workflow':
      return 'Workflow';
    case 'team':
      return 'Team';
    case 'tool':
      return 'Tool';
    default:
      return agentType ?? 'unknown';
  }
}

/** Split an agent create/edit form into the API body: scalars + parsed JSON blobs. */
export function buildAgentBody(
  form: Record<string, unknown>,
  metadata: unknown,
  agentCard: unknown,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    if (v !== undefined && v !== '') body[k] = v;
  }
  if (metadata !== undefined) body.metadata = metadata;
  if (agentCard !== undefined) body.agentCard = agentCard;
  return body;
}

/** Capabilities as a clean array, tolerant of the row being partial. */
export function agentCapabilities(agent: Pick<AgentRow, 'capabilities'> | null | undefined): string[] {
  const caps = agent?.capabilities;
  return Array.isArray(caps) ? caps.filter((c): c is string => typeof c === 'string') : [];
}
