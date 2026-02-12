/**
 * Provider module exports
 *
 * Provides clients for executing AI agents (Agno, Webhook, OpenClaw)
 * and the unified AgentProvider abstraction for multi-provider dispatch.
 */

// Types — generic client interface
export {
  type ProviderRequest,
  type ProviderFile,
  type ProviderResponse,
  type ProviderMetrics,
  type StreamChunk,
  type AgnoAgent,
  type AgnoTeam,
  type AgnoWorkflow,
  type IAgentClient,
  type AgentDiscoveryEntry,
  type AgentHealthResult,
  type AgnoClientConfig,
  ProviderError,
  type ProviderErrorCode,
} from './types';

// Types — unified AgentProvider abstraction
export type {
  IAgentProvider,
  AgentTrigger,
  AgentTriggerType,
  AgentTriggerResult,
  WebhookProviderConfig,
  WebhookPayload,
  WebhookResponse,
} from './types';

// Agno Client
export { AgnoClient, createAgnoClient } from './agno-client';

// AgentProvider implementations
export { AgnoAgentProvider } from './agno-provider';
export { WebhookAgentProvider } from './webhook-provider';
export { OpenClawAgentProvider, OpenClawClient, createOpenClawProvider } from './openclaw';
export type { OpenClawClientConfig, OpenClawProviderConfig } from './openclaw';

// Factory
export {
  type ProviderClientConfig,
  type ProviderClient,
  createProviderClient,
  isProviderSchemaSupported,
  getSupportedProviderSchemas,
} from './factory';
