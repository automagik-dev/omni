/**
 * Provider Client Factory
 *
 * Creates provider clients based on schema type:
 * - agnoos: AgnoOS AI orchestration platform
 * - a2a: Agent-to-Agent protocol (Google A2A)
 * - openai: OpenAI-compatible API
 * - anthropic: Anthropic Claude API
 * - custom: Custom provider implementation
 */

import type { ProviderSchema } from '../types/agent';
import { createAgnoClient } from './agno-client';
import { type IAgnoClient, ProviderError } from './types';

/**
 * Configuration for creating a provider client
 */
export interface ProviderClientConfig {
  schema: ProviderSchema;
  baseUrl: string;
  apiKey: string;
  defaultTimeoutMs?: number;
}

/**
 * Union type of all supported provider clients
 * Currently only AgnoOS is implemented; others will be added in future wishes
 */
export type ProviderClient = IAgnoClient;

/**
 * Create a provider client based on the schema type
 *
 * @throws ProviderError if schema is not supported
 */
export function createProviderClient(config: ProviderClientConfig): ProviderClient {
  switch (config.schema) {
    case 'agnoos':
    case 'agno':
      return createAgnoClient({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        defaultTimeoutMs: config.defaultTimeoutMs,
      });

    case 'a2a':
      throw new ProviderError('A2A provider not yet implemented', 'NOT_FOUND', 501, { schema: 'a2a' });

    case 'openai':
      throw new ProviderError('OpenAI provider not yet implemented', 'NOT_FOUND', 501, { schema: 'openai' });

    case 'anthropic':
      throw new ProviderError('Anthropic provider not yet implemented', 'NOT_FOUND', 501, { schema: 'anthropic' });

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

    case 'custom':
      throw new ProviderError('Custom provider not yet implemented', 'NOT_FOUND', 501, { schema: 'custom' });

    default:
      throw new ProviderError(`Unknown provider schema: ${config.schema}`, 'NOT_FOUND', 400, { schema: config.schema });
  }
}

/**
 * Check if a provider schema is currently supported
 */
export function isProviderSchemaSupported(schema: ProviderSchema): boolean {
  return schema === 'agnoos' || schema === 'agno' || schema === 'webhook' || schema === 'openclaw';
}

/**
 * Get list of currently supported provider schemas
 */
export function getSupportedProviderSchemas(): ProviderSchema[] {
  return ['agnoos', 'webhook', 'openclaw'];
}
