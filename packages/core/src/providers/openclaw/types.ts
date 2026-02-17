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

// === Agent Event Types ===

export type AgentEventStream = 'lifecycle' | 'tool' | 'assistant' | 'thinking' | 'error';

export interface AgentEventPayload {
  runId: string;
  seq: number;
  stream: AgentEventStream;
  ts: number;
  data: Record<string, unknown>;
  sessionKey?: string;
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
  /** Device identity for device-token auth (required for operator scopes) */
  device?: {
    id: string;
    publicKey: string;
    signature: string;
    signedAt: number;
    nonce: string;
  };
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
  /** Required by OpenClaw gateway — UUID for deduplication */
  idempotencyKey: string;
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
  /** Gateway authentication token (shared secret — used only when no device credentials) */
  token: string;
  /** Provider DB ID for logging and metrics */
  providerId: string;
  /** Optional origin header for connection */
  origin?: string;
  /**
   * Device credentials for operator scope auth.
   * When set, the client connects as a registered device and sends the device token
   * instead of the gateway shared secret. This grants operator.read + operator.write scopes.
   * Without device credentials, the gateway strips all declared scopes for shared-token connections.
   */
  device?: {
    /** Device ID (SHA256 hex of the raw Ed25519 public key) */
    id: string;
    /** Ed25519 public key (base64url, raw 32-byte key) */
    publicKey: string;
    /** Ed25519 private key (base64url, raw 32-byte key) */
    privateKey: string;
    /** Device token issued by the gateway (base64url, stored in paired.json) */
    token: string;
  };
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
