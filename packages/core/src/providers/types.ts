/**
 * Provider types for agent execution
 *
 * These types define the interface for executing AI agents (Agno, OpenAI, etc.)
 * and the unified AgentProvider abstraction for multi-provider dispatch.
 */

import type { OmniEvent } from '../events/types';
import type { ProviderSchema } from '../types/agent';
import type { ChannelType } from '../types/channel';

/**
 * Request to run an agent/team/workflow
 */
export interface ProviderRequest {
  /** The message/prompt to send */
  message: string;
  /** Whether to stream the response (default: false for sync) */
  stream?: boolean;
  /** Session ID for conversation continuity (typically chatId) */
  sessionId?: string;
  /** User ID for the requester (typically personId or senderId) */
  userId?: string;
  /** Optional file attachments */
  files?: ProviderFile[];
  /** Request timeout in milliseconds */
  timeoutMs?: number;
}

export interface ProviderFile {
  path: string;
  mimeType: string;
  filename?: string;
}

/**
 * Synchronous response from an agent run
 */
export interface ProviderResponse {
  /** The response content/text */
  content: string;
  /** Unique run identifier */
  runId: string;
  /** Session ID for continuity */
  sessionId: string;
  /** Completion status */
  status: 'completed' | 'failed';
  /** Optional token/timing metrics */
  metrics?: ProviderMetrics;
}

export interface ProviderMetrics {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

/**
 * Streaming chunk from an agent run
 */
export interface StreamChunk {
  /** SSE event type */
  event: string;
  /** Content delta (may be partial) */
  content?: string;
  /** Whether this is the final chunk */
  isComplete: boolean;
  /** Run ID (available on start and complete events) */
  runId?: string;
  /** Session ID (available on start event) */
  sessionId?: string;
  /** Full content (available on complete event) */
  fullContent?: string;
}

/**
 * Agent entity from Agno
 */
export interface AgnoAgent {
  agent_id: string;
  name: string;
  model?: {
    provider?: string;
    name?: string;
  };
  description?: string;
  instructions?: string[];
}

/**
 * Team entity from Agno
 */
export interface AgnoTeam {
  team_id: string;
  name: string;
  description?: string;
  mode?: string;
  members?: Array<{
    agent_id: string;
    role?: string;
  }>;
}

/**
 * Workflow entity from Agno
 */
export interface AgnoWorkflow {
  workflow_id: string;
  name: string;
  description?: string;
}

/**
 * Agno client interface
 */
export interface IAgnoClient {
  /** List available agents */
  listAgents(): Promise<AgnoAgent[]>;

  /** List available teams */
  listTeams(): Promise<AgnoTeam[]>;

  /** List available workflows */
  listWorkflows(): Promise<AgnoWorkflow[]>;

  /** Run an agent synchronously */
  runAgent(agentId: string, request: ProviderRequest): Promise<ProviderResponse>;

  /** Run a team synchronously */
  runTeam(teamId: string, request: ProviderRequest): Promise<ProviderResponse>;

  /** Run a workflow synchronously */
  runWorkflow(workflowId: string, request: ProviderRequest): Promise<ProviderResponse>;

  /** Stream an agent response */
  streamAgent(agentId: string, request: ProviderRequest): AsyncGenerator<StreamChunk>;

  /** Stream a team response */
  streamTeam(teamId: string, request: ProviderRequest): AsyncGenerator<StreamChunk>;

  /** Stream a workflow response */
  streamWorkflow(workflowId: string, request: ProviderRequest): AsyncGenerator<StreamChunk>;

  /** Health check */
  checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;
}

/**
 * Configuration for creating an Agno client
 */
export interface AgnoClientConfig {
  /** Base URL of the Agno API */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Default timeout in milliseconds (default: 60000) */
  defaultTimeoutMs?: number;
}

/**
 * Error thrown by provider clients
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: ProviderErrorCode,
    public readonly statusCode?: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type ProviderErrorCode =
  | 'AUTHENTICATION_FAILED'
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'STREAM_ERROR';

// ============================================================================
// AgentProvider — unified provider abstraction for multi-provider dispatch
// ============================================================================

/** The type of trigger that activated the agent */
export type AgentTriggerType = 'mention' | 'reaction' | 'dm' | 'reply' | 'name_match' | 'command';

/**
 * Unified agent provider interface
 *
 * All agent providers (Agno, OpenClaw webhook, Claude SDK, etc.)
 * implement this interface for the agent dispatcher.
 */
export interface IAgentProvider {
  readonly id: string;
  readonly name: string;
  readonly schema: ProviderSchema;
  readonly mode: 'round-trip' | 'fire-and-forget';

  /** Check if this provider can handle a given trigger */
  canHandle(trigger: AgentTrigger): boolean;

  /** Process a trigger and return response (null = fire-and-forget, no response) */
  trigger(context: AgentTrigger): Promise<AgentTriggerResult | null>;

  /** Health check */
  checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;
}

/**
 * Trigger context passed to an agent provider
 */
export interface AgentTrigger {
  /** End-to-end trace ID */
  traceId: string;
  /** What type of trigger activated this */
  type: AgentTriggerType;
  /** The original event */
  event: OmniEvent;
  /** Source channel information */
  source: {
    channelType: ChannelType;
    instanceId: string;
    chatId: string;
    messageId: string;
  };
  /** Sender information */
  sender: {
    platformUserId: string;
    personId?: string;
    displayName?: string;
  };
  /** Trigger content */
  content: {
    /** Message text (for message triggers) */
    text?: string;
    /** Emoji (for reaction triggers) */
    emoji?: string;
    /** Referenced message ID (for reply triggers) */
    referencedMessageId?: string;
  };
  /** Session ID computed from instance's session strategy */
  sessionId: string;
}

/**
 * Result from an agent provider trigger
 */
export interface AgentTriggerResult {
  /** Response parts to send back (empty array = no response needed) */
  parts: string[];
  /** Provider metadata */
  metadata: {
    runId: string;
    providerId: string;
    durationMs: number;
    cost?: {
      inputTokens?: number;
      outputTokens?: number;
    };
  };
}

/**
 * Configuration for a webhook-based agent provider
 */
export interface WebhookProviderConfig {
  /** URL to POST trigger events to */
  webhookUrl: string;
  /** API key for webhook authentication */
  apiKey?: string;
  /** Mode: round-trip waits for response, fire-and-forget returns immediately */
  mode: 'round-trip' | 'fire-and-forget';
  /** Timeout for round-trip mode in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Number of retries on 5xx errors (default: 1) */
  retries?: number;
}

/**
 * Payload sent to webhook providers
 */
export interface WebhookPayload {
  event: {
    id: string;
    type: string;
    timestamp: number;
  };
  instance: {
    id: string;
    channelType: string;
    name?: string;
  };
  chat: { id: string };
  sender: {
    id: string;
    name?: string;
    personId?: string;
  };
  content: {
    text?: string;
    emoji?: string;
  };
  traceId: string;
  /** The endpoint to call back for sending responses */
  replyEndpoint: string;
}

/**
 * Response format from webhook providers (round-trip mode)
 */
export interface WebhookResponse {
  /** Single text reply */
  reply?: string;
  /** Pre-split response parts */
  parts?: string[];
  /** Provider metadata */
  metadata?: Record<string, unknown>;
}
