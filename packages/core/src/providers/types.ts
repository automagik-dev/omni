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
 *
 * **Breaking Change (Semantic)**: The `userId` field now represents the internal
 * Person UUID instead of platform-specific IDs. Use `platform.id` to access the
 * platform-specific identifier (phone number, Discord ID, etc.).
 *
 * All new fields (platform, sender, chat) are optional for backward compatibility.
 */
export interface ProviderRequest {
  /** The message/prompt to send */
  message: string;
  /** Agent/team/workflow ID to run */
  agentId: string;
  /** Agent type — the client uses this to route internally (default: 'agent') */
  agentType?: 'agent' | 'team' | 'workflow';
  /** Whether to stream the response (default: false for sync) */
  stream?: boolean;
  /** Session ID for conversation continuity (typically chatId) */
  sessionId?: string;
  /** User ID for the requester - NOW ALWAYS Person UUID (internal identity) */
  userId: string;

  /** Platform context for backward compat and provider flexibility */
  platform?: {
    /** Platform-specific ID (phone number, Discord ID, etc.) */
    id: string;
    /** Channel type ('whatsapp', 'discord', etc.) */
    channel: ChannelType;
    /** Instance UUID */
    instanceId: string;
    /** Human-readable instance name */
    instanceName?: string;
  };

  /** Sender metadata */
  sender?: {
    /** Person display name or platform username */
    displayName?: string;
    /** Profile picture URL */
    avatarUrl?: string;
    /** Platform-specific username/handle */
    platformUsername?: string;
  };

  /** Chat metadata */
  chat?: {
    /** Chat type */
    type: 'dm' | 'group' | 'channel';
    /** Platform chat ID */
    id: string;
    /** Group/channel name (null for DMs) */
    name?: string;
    /** For group chats */
    participantCount?: number;
  };

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
 * Unified streaming delta format for provider triggerStream implementations.
 */
export type StreamDelta =
  | { phase: 'thinking'; thinking: string; thinkingElapsedMs: number }
  | { phase: 'content'; content: string; thinking?: string; thinkingDurationMs?: number }
  | { phase: 'final'; content: string; thinking?: string; thinkingDurationMs?: number }
  | { phase: 'error'; error: string };

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
 * Generic agent client interface
 *
 * All provider clients (Agno, future Claude Code, etc.) implement this
 * minimal contract. The client routes internally based on request.agentType.
 */
export interface IAgentClient {
  /** Run an agent synchronously — routes by request.agentType internally */
  run(request: ProviderRequest): Promise<ProviderResponse>;

  /** Stream an agent response — routes by request.agentType internally */
  stream(request: ProviderRequest): AsyncGenerator<StreamChunk>;

  /** Optional: discover available agents from the provider */
  discover?(): Promise<AgentDiscoveryEntry[]>;

  /** Health check */
  checkHealth(): Promise<AgentHealthResult>;

  /** Optional: delete a session (clear conversation history) */
  deleteSession?(sessionId: string): Promise<void>;
}

/**
 * Entry returned by IAgentClient.discover()
 */
export interface AgentDiscoveryEntry {
  id: string;
  name: string;
  /** Provider-specific type (e.g. 'agent', 'team', 'workflow' for Agno) */
  type?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Health check result
 */
export interface AgentHealthResult {
  healthy: boolean;
  latencyMs: number;
  error?: string;
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

  /** Optional: Process a trigger as a stream of provider deltas */
  triggerStream?(context: AgentTrigger): AsyncGenerator<StreamDelta>;

  /** Health check */
  checkHealth(): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;

  /** Optional: Gracefully dispose resources (WS connections, timers, etc.) */
  dispose?(): Promise<void>;

  /** Optional: Reset/clear a session by session key.
   *  chatId is provided so providers that build their own key format (e.g. OpenClaw)
   *  can reconstruct the correct session key. */
  resetSession?(sessionKey: string, chatId?: string): Promise<void>;
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
