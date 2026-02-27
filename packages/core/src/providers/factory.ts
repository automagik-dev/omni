/**
 * Provider Client Factory
 *
 * Creates provider clients based on schema type.
 * Only Agno is created here — Webhook and OpenClaw use their own constructors.
 */

import type { ProviderSchema } from '../types/agent';
import { createAgnoClient } from './agno-client';
import { type ClaudeCodeConfig, createClaudeCodeClient } from './claude-code-client';
import { type IAgentClient, ProviderError } from './types';

/**
 * Configuration for creating a provider client
 */
export interface ProviderClientConfig {
  schema: ProviderSchema;
  baseUrl: string;
  apiKey: string;
  defaultTimeoutMs?: number;
  /** Schema-specific config (required for claude-code) */
  schemaConfig?: Record<string, unknown>;
}

/**
 * Union type of all supported provider clients
 */
export type ProviderClient = IAgentClient;

/**
 * Create a provider client based on the schema type
 *
 * @throws ProviderError if schema is not supported
 */
export function createProviderClient(config: ProviderClientConfig): ProviderClient {
  switch (config.schema) {
    case 'agno':
      return createAgnoClient({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        defaultTimeoutMs: config.defaultTimeoutMs,
      });

    case 'webhook':
      // Webhook providers are created via WebhookAgentProvider directly,
      // not through the legacy createProviderClient factory.
      throw new ProviderError(
        'Webhook providers should be created via WebhookAgentProvider, not createProviderClient',
        'NOT_FOUND',
        400,
        { schema: 'webhook', hint: 'Use new WebhookAgentProvider(id, name, config) instead' },
      );

    case 'openclaw':
      // OpenClaw providers are created via OpenClawAgentProvider + OpenClawClient,
      // not through the legacy createProviderClient factory.
      throw new ProviderError(
        'OpenClaw providers should be created via OpenClawAgentProvider, not createProviderClient',
        'NOT_FOUND',
        400,
        { schema: 'openclaw', hint: 'Use createOpenClawProvider(id, name, clientConfig, providerConfig) instead' },
      );

    case 'ag-ui':
      throw new ProviderError('AG-UI provider not yet implemented', 'NOT_FOUND', 501, { schema: 'ag-ui' });

    case 'claude-code': {
      const ccConfig = config.schemaConfig as ClaudeCodeConfig | undefined;
      if (!ccConfig?.projectPath) {
        throw new ProviderError('Claude Code provider requires schemaConfig.projectPath', 'INVALID_RESPONSE', 400, {
          schema: 'claude-code',
        });
      }
      return createClaudeCodeClient({
        ...ccConfig,
        apiKey: ccConfig.apiKey ?? config.apiKey,
      });
    }

    default:
      throw new ProviderError(`Unknown provider schema: ${config.schema}`, 'NOT_FOUND', 400, {
        schema: config.schema,
      });
  }
}

/**
 * Check if a provider schema is currently supported
 */
export function isProviderSchemaSupported(schema: ProviderSchema): boolean {
  return schema === 'agno' || schema === 'webhook' || schema === 'openclaw' || schema === 'claude-code';
}

/**
 * Get list of currently supported provider schemas
 */
export function getSupportedProviderSchemas(): ProviderSchema[] {
  return ['agno', 'webhook', 'openclaw', 'claude-code'];
}
