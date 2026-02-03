/**
 * Provider types for agent execution
 *
 * These types define the interface for executing AI agents (Agno, OpenAI, etc.)
 */

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
