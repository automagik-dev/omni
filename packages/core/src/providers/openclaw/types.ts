/**
 * OpenClaw Gateway WebSocket Protocol Types
 *
 * Adapted from genie-os reference implementation for server-side use.
 * Only includes types needed for Omni dispatch (chat.send, events, connect).
 */

// === Frame Types ===

export interface ReqFrame {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface ResFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message: string; code?: string };
}

export interface EventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: number;
}

export type Frame = ReqFrame | ResFrame | EventFrame;

// === Chat Types ===

export type ChatEventState = 'delta' | 'final' | 'error' | 'aborted';

export interface ChatEvent {
  state: ChatEventState;
  sessionKey: string;
  runId?: string;
  message?: ChatMessage;
  errorMessage?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentBlock[];
  timestamp?: number;
  thinking?: string;
  thinkingLevel?: string | null;
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  thinking?: string;
  source?: { type: string; media_type: string; data: string };
}

// === Connect Types ===

export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    version: string;
    platform: string;
    mode: string;
  };
  /** Gateway accepts 'operator' or 'node' only */
  role: 'operator' | 'node';
  scopes: string[];
  caps?: string[];
  auth?: {
    token?: string;
  };
  locale?: string;
  userAgent?: string;
}

export interface HelloPayload {
  type: 'hello-ok';
  protocol: number;
  policy?: {
    tickIntervalMs?: number;
  };
  snapshot?: {
    sessionDefaults?: {
      defaultAgentId?: string;
    };
  };
}

// === Chat Send Types ===

export interface ChatSendParams {
  sessionKey: string;
  message: string;
  deliver?: boolean;
  idempotencyKey?: string;
}

export interface ChatSendResult {
  runId: string;
  status: 'started' | 'in_flight';
}

// === Connection State ===

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// === Event Listener ===

export type EventListener = (event: EventFrame) => void;

// === Omni-specific Configuration ===

/**
 * Configuration for creating an OpenClawClient (WS connection parameters).
 */
export interface OpenClawClientConfig {
  /** WebSocket URL (ws:// or wss://) */
  url: string;
  /** Gateway authentication token */
  token: string;
  /** Provider DB ID for logging and metrics */
  providerId: string;
  /** Optional origin header for connection */
  origin?: string;
}

/**
 * Configuration for OpenClawAgentProvider (per-instance dispatch config).
 */
export interface OpenClawProviderConfig {
  /** Default agent ID for session key construction */
  defaultAgentId: string;
  /** Response accumulation timeout in ms (default: 120000) */
  agentTimeoutMs?: number;
  /** Timeout for chat.send acknowledgement in ms (default: 10000) */
  sendAckTimeoutMs?: number;
  /** Whether to prefix messages with sender name (default: true) */
  prefixSenderName?: boolean;
}
