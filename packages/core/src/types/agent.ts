/**
 * Agent provider type definitions
 */

export const AGENT_TYPES = ['agent', 'team', 'workflow'] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export const PROVIDER_SCHEMAS = ['agnoos', 'agno', 'a2a', 'openai', 'anthropic', 'webhook', 'custom'] as const;
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
  schemaConfig?: OpenAIConfig | AnthropicConfig | AgnoOSConfig | A2AConfig | CustomConfig;
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

export interface OpenAIConfig {
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AnthropicConfig {
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
}

export interface AgnoOSConfig {
  agentId: string;
  teamId?: string;
  timeout?: number;
}

export interface A2AConfig {
  agentUrl: string;
  capabilities?: string[];
  timeout?: number;
}

export interface CustomConfig {
  [key: string]: unknown;
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
