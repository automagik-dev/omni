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
    /** Thread/topic identifier (e.g. Telegram forum topic, Slack thread) */
    threadId?: string;
  };

  /** External/platform message ID (for reply-to and reactions) */
  messageId?: string;

  /** External ID of the message being replied to */
  replyToMessageId?: string;

  /** Optional file attachments */
  files?: ProviderFile[];
  /** Request timeout in milliseconds */
  timeoutMs?: number;
  /** Dynamic URL params to append to HTTP MCP server URLs (e.g. { chat_id: "123" }) */
  mcpUrlParams?: Record<string, string>;

  /** Environment variables to expose to provider subprocesses/SDK runtimes. */
  env?: Record<string, string>;

  /** Canonical Omni execution context propagated across local CLIs and remote protocols. */
  executionContext?: OmniExecutionContext;
}

export interface ProviderFile {
  /** Local file path (mutually exclusive with url) */
  path?: string;
  /** Remote URL to fetch the file from (mutually exclusive with path) */
  url?: string;
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
 *
 * agno 2.5+ returns `id` at the top level. `agent_id` is kept optional for
 * backward compatibility with pre-2.5 deployments.
 */
export interface AgnoAgent {
  id: string;
  /** @deprecated pre-agno-2.5 field; use `id` */
  agent_id?: string;
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
 *
 * agno 2.5+ returns `id` at the top level. `team_id` is kept optional for
 * backward compatibility with pre-2.5 deployments.
 */
export interface AgnoTeam {
  id: string;
  /** @deprecated pre-agno-2.5 field; use `id` */
  team_id?: string;
  name: string;
  description?: string;
  mode?: string;
  members?: Array<{
    agent_id: string;
    id?: string;
    role?: string;
  }>;
}

/**
 * Workflow entity from Agno
 *
 * agno 2.5+ returns `id` at the top level. `workflow_id` is kept optional for
 * backward compatibility with pre-2.5 deployments.
 */
export interface AgnoWorkflow {
  id: string;
  /** @deprecated pre-agno-2.5 field; use `id` */
  workflow_id?: string;
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
 * Distributed trace context for cross-process propagation.
 *
 * Aligns with W3C Trace Context (`traceparent` HTTP header) so providers can
 * propagate trace identity across HTTP/NATS/gRPC boundaries without coupling
 * to any specific OpenTelemetry SDK. Producers receive this from the dispatcher
 * and inject it on outbound calls so cross-process traces stitch correctly.
 *
 * Backend-agnostic: the trace identifier itself is a 16-byte hex string per
 * W3C; how it's exported (OTLP, Zipkin, vendor-native) is the host's concern,
 * configured via standard `OTEL_*` env vars.
 */
export interface TraceContext {
  /** W3C trace-id — 32 hex chars (16 bytes). */
  traceId: string;
  /** W3C span-id of the current span — 16 hex chars (8 bytes). */
  spanId: string;
  /** Optional parent span-id for nested propagation. */
  parentSpanId?: string;
  /** W3C trace flags (1 = sampled, 0 = not). Default 1 when unset. */
  traceFlags?: number;
}

/**
 * Optional observability hooks on a provider.
 *
 * Providers that want to participate in distributed tracing (propagate the
 * W3C `traceparent` on outbound HTTP/NATS calls, emit OTel spans for internal
 * operations, expose a health probe for silent-failure detection) implement
 * this interface. Providers without an `observability` field fall back to
 * default no-op behavior — no behavior change for legacy providers.
 *
 * **Backend-neutral by design.** Emitted spans flow through whatever OTel SDK
 * the host configured via standard `OTEL_EXPORTER_OTLP_ENDPOINT` /
 * `OTEL_SERVICE_NAME` / `OTEL_RESOURCE_ATTRIBUTES`. No vendor SDK is coupled
 * here.
 */
export interface ProviderObservability {
  /**
   * Receive a trace context from the dispatcher when triggering this provider.
   *
   * The provider SHOULD propagate it on any outbound calls it makes:
   * - HTTP requests: inject `traceparent` header
   * - NATS publishes: inject `traceparent` AND custom
   *   `x-trace-id`/`x-span-id`/`x-parent-span-id` headers (forward-compat
   *   with khal-os o11y consumer)
   * - Subprocess spawns: pass through env vars if the child reads them
   */
  propagateTrace(ctx: TraceContext): void;

  /**
   * Health probe — does the provider currently process inbound work?
   *
   * Used by silent-failure detection: e.g. a NATS bridge that has lost its
   * consumer subscription should report `{ healthy: false }` even if the
   * outer process is alive. Optional `lastProcessedAt` and `backlog` enrich
   * alerting context.
   */
  heartbeat(): Promise<{ healthy: boolean; lastProcessedAt?: Date; backlog?: number }>;
}

export interface OmniCustomerContext {
  externalUserId?: string;
  customerId?: string;
  organizationId?: string;
  tenantId?: string;
}

export interface OmniExecutionContext {
  identity: {
    /** Canonical requester ID: internal person UUID when available, otherwise platform user ID. */
    userId: string;
    /** Omni internal person UUID, when identity graph resolution succeeded. */
    personId?: string;
    /** Platform-specific sender ID, such as WhatsApp JID, Discord user ID, Telegram user ID. */
    platformUserId: string;
    displayName?: string;
  };
  source: {
    channel: ChannelType;
    instanceId: string;
    chatId: string;
    threadId?: string;
    messageId: string;
  };
  session: {
    id: string;
    strategy?: 'per_user' | 'per_chat' | 'per_thread' | string;
  };
  trace: {
    id: string;
  };
  customer?: OmniCustomerContext;
}

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
  readonly mode: 'round-trip' | 'fire-and-forget' | 'turn-based';

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
   *  can reconstruct the correct session key.
   *  instanceId is provided for providers that scope persistence by instance. */
  resetSession?(sessionKey: string, chatId?: string, instanceId?: string): Promise<void>;

  /**
   * Optional observability hooks. See {@link ProviderObservability}.
   *
   * Providers that don't implement this fall back to no-op tracing — the
   * dispatcher checks for the field's presence and skips propagation calls
   * when absent. Backend-neutral: emitted spans use whatever OTel SDK the
   * host configured via OTEL_* env vars; no vendor coupling here.
   */
  observability?: ProviderObservability;
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
    /** Thread/topic identifier (e.g. Telegram forum topic, Slack thread) */
    threadId?: string;
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
    /** File attachments (media with paths) */
    files?: ProviderFile[];
  };
  /** Session ID computed from instance's session strategy */
  sessionId: string;
  /** Session strategy used to compute sessionId. */
  sessionStrategy?: 'per_user' | 'per_chat' | 'per_thread' | string;
  /** Optional customer/account identifiers resolved from person metadata. */
  customer?: OmniCustomerContext;
  /** Recent message history for context (optional, formatted as "[Name - time] message") */
  contextMessages?: string[];
  /**
   * Optional abort signal — when aborted, the provider should stop the running stream
   * as soon as possible. Set by the dispatcher when stream-recovery fires on reconnect.
   */
  abortSignal?: AbortSignal;
  /**
   * Environment variables for turn-based agents.
   * Set by the dispatcher when provider.mode is 'turn-based'.
   * Includes OMNI_INSTANCE, OMNI_CHAT, OMNI_MESSAGE, OMNI_TURN_ID.
   */
  env?: Record<string, string>;
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
  executionContext?: OmniExecutionContext;
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
