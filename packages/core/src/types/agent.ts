/**
 * Agent provider type definitions
 */

export const AGENT_TYPES = ['agent', 'team', 'workflow'] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export const PROVIDER_SCHEMAS = ['agno', 'webhook', 'openclaw', 'ag-ui', 'claude-code'] as const;
export type ProviderSchema = (typeof PROVIDER_SCHEMAS)[number];

export const JOB_STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Agent provider configuration
 */
export interface AgentProviderConfig {
  id: string;
  name: string;
  schema: ProviderSchema;
  baseUrl: string;
  apiKey?: string;
  schemaConfig?: AgnoConfig | OpenClawConfig | Record<string, unknown>;
  defaultStream: boolean;
  defaultTimeout: number;
  capabilities: AgentCapabilities;
}

export interface AgentCapabilities {
  supportsStreaming: boolean;
  supportsImages: boolean;
  supportsAudio: boolean;
  supportsDocuments: boolean;
}

export interface AgnoConfig {
  agentId: string;
  teamId?: string;
  timeout?: number;
}

export interface OpenClawConfig {
  /** Default agent ID (e.g. 'sofia') */
  defaultAgentId: string;
  /** Agent timeout in seconds (default: 120) */
  agentTimeoutMs?: number;
  /** Origin header for WS connection */
  origin?: string;
}

/**
 * Agent request/response types
 */
export interface AgentRequest {
  messages: AgentMessage[];
  stream?: boolean;
  timeout?: number;
  metadata?: Record<string, unknown>;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: AgentAttachment[];
}

export interface AgentAttachment {
  type: 'image' | 'audio' | 'document';
  url?: string;
  base64?: string;
  mimeType: string;
  filename?: string;
}

export interface AgentResponse {
  content: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  finishReason?: 'stop' | 'length' | 'error';
  latencyMs: number;
}
