/**
 * Pure helpers + mirror schema for the providers slice. The create/edit schema
 * mirrors the API's `providerBaseSchema` (providers.ts) for the scalar fields;
 * `schemaConfig` is edited as JSON because its shape depends on the provider
 * schema (agno needs { agentId }, claude-code needs { projectPath }, etc.).
 */
import { z } from 'zod';

/** Provider schemas the API accepts (packages/core PROVIDER_SCHEMAS). */
export const PROVIDER_SCHEMAS = ['agno', 'webhook', 'openclaw', 'ag-ui', 'claude-code', 'a2a', 'nats-genie'] as const;

/** Schemas whose provider supports live discovery of agents/teams/workflows. */
export const DISCOVERY_SCHEMAS = new Set<string>(['agno']);

export const providerCreateSchema = z.object({
  name: z.string().min(1).max(255).describe('Unique provider name'),
  schema: z.enum(PROVIDER_SCHEMAS).default('agno').describe('Provider schema type'),
  baseUrl: z.string().url().describe('Base URL for the provider API'),
  apiKey: z.string().optional().describe('API key (stored encrypted)'),
  defaultStream: z.boolean().default(true).describe('Default streaming'),
  defaultTimeout: z.number().int().positive().default(600).describe('Timeout (seconds)'),
  supportsStreaming: z.boolean().default(true).describe('Supports streaming'),
  supportsImages: z.boolean().default(false).describe('Supports images'),
  supportsAudio: z.boolean().default(false).describe('Supports audio'),
  supportsDocuments: z.boolean().default(false).describe('Supports documents'),
  tags: z.array(z.string()).default([]).describe('Tags'),
  description: z.string().optional().describe('Description'),
});
export type ProviderCreateForm = z.infer<typeof providerCreateSchema>;

export const providerEditSchema = providerCreateSchema.partial();

/** True when a provider schema exposes the discovery sub-resources. */
export function supportsDiscovery(schema: string | null | undefined): boolean {
  return schema != null && DISCOVERY_SCHEMAS.has(schema);
}

/** Assemble a provider create/edit body: scalars + parsed schemaConfig JSON. */
export function buildProviderBody(form: Record<string, unknown>, schemaConfig: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    if (v !== undefined && v !== '') body[k] = v;
  }
  if (schemaConfig !== undefined) body.schemaConfig = schemaConfig;
  return body;
}
