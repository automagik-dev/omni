/**
 * Shared helpers for idempotent provider + agent setup.
 *
 * Used by:
 *   - `omni connect` (NATS-Genie specialization)
 *   - `omni setup agent` (generalized compound setup, issue #440)
 *
 * These helpers implement "find-or-create" semantics so operators can re-run
 * setup without colliding on unique constraints.
 */

import type { ProviderSchema } from '@omni/core';
import type { OmniClient } from '@omni/sdk';
import * as output from '../output.js';

/** AgentSystem values accepted by the agents.create endpoint. */
export type AgentSystem = 'claude' | 'agno' | 'openai' | 'gemini' | 'custom' | 'omni-internal';

/**
 * Map a provider schema to the agent record's `provider` field (AgentSystem).
 * Schemas with no dedicated AgentSystem fall back to 'custom'.
 */
export function schemaToAgentProvider(schema: ProviderSchema | string): AgentSystem {
  switch (schema) {
    case 'agno':
      return 'agno';
    case 'claude-code':
      return 'claude';
    default:
      return 'custom';
  }
}

/** Arguments for find-or-create provider. */
export interface FindOrCreateProviderArgs {
  name: string;
  schema: ProviderSchema | string;
  baseUrl: string;
  apiKey?: string;
  schemaConfig?: Record<string, unknown>;
}

/**
 * Find or create a provider by (name, schema). Returns the provider id or null
 * on unrecoverable failure. Mirrors the idempotent pattern used historically
 * in `connect.ts` — try create, fall back to a list+filter lookup.
 */
export async function findOrCreateProvider(client: OmniClient, args: FindOrCreateProviderArgs): Promise<string | null> {
  try {
    const provider = await client.providers.create({
      name: args.name,
      schema: args.schema as ProviderSchema,
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      schemaConfig: args.schemaConfig,
    });
    return provider.id;
  } catch {
    try {
      const providers = await client.providers.list();
      const existing = providers.find((p) => p.name === args.name && p.schema === args.schema);
      if (existing) {
        output.info(`Using existing provider: ${existing.id}`);
        return existing.id;
      }
    } catch {
      // fall through
    }
    output.error('Failed to create provider. Check API connection.');
    return null;
  }
}

/** Arguments for find-or-create agent. */
export interface FindOrCreateAgentArgs {
  name: string;
  providerId: string;
  agentProvider: AgentSystem;
  agentType?: 'assistant' | 'workflow' | 'team' | 'tool';
  model?: string;
  capabilities?: string[];
  isInternal?: boolean;
  isActive?: boolean;
}

/**
 * Find or create an agent record by (name, agentProviderId). Returns the
 * agent id or null on unrecoverable failure.
 */
export async function findOrCreateAgent(client: OmniClient, args: FindOrCreateAgentArgs): Promise<string | null> {
  try {
    const agent = await client.agents.create({
      name: args.name,
      agentProviderId: args.providerId,
      agentType: args.agentType ?? 'assistant',
      provider: args.agentProvider,
      model: args.model,
      capabilities: args.capabilities ?? [],
      isInternal: args.isInternal ?? false,
      isActive: args.isActive ?? true,
    });
    return agent.id;
  } catch {
    try {
      const { items } = await client.agents.list();
      const existing = items.find(
        (a) => a.name === args.name && (a as Record<string, unknown>).agentProviderId === args.providerId,
      );
      if (existing) {
        output.info(`Using existing agent: ${existing.id}`);
        return existing.id;
      }
    } catch {
      // fall through
    }
    output.error('Failed to create agent record. Check API connection.');
    return null;
  }
}
