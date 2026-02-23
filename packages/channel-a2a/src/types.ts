/**
 * A2A protocol type definitions
 *
 * Based on the Google DeepMind Agent-to-Agent (A2A) protocol.
 * @see https://google.github.io/A2A/
 */

// ─── Task State ───────────────────────────────────────────────

export type A2ATaskState = 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'input-required';

// ─── Message Parts ────────────────────────────────────────────

export type A2ATextPart = { type: 'text'; text: string };
export type A2ADataPart = { type: 'data'; data: Record<string, unknown> };
export type A2AFilePart = { type: 'file'; file: { name?: string; mimeType?: string; uri?: string } };
export type A2APart = A2ATextPart | A2ADataPart | A2AFilePart;

// ─── Message ──────────────────────────────────────────────────

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: A2APart[];
  messageId?: string;
  taskId?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
}

// ─── Artifact ─────────────────────────────────────────────────

export interface A2AArtifact {
  artifactId?: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  index?: number;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

// ─── Task ─────────────────────────────────────────────────────

export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
  timestamp?: string;
}

export interface A2ATask {
  id: string;
  contextId?: string;
  status: A2ATaskStatus;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
}

// ─── JSON-RPC ─────────────────────────────────────────────────

export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── Method Params ────────────────────────────────────────────

export interface MessageSendParams {
  message: A2AMessage;
  configuration?: {
    acceptedOutputModes?: string[];
    historyLength?: number;
    blocking?: boolean;
  };
  taskId?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
}

// ─── SSE Events ───────────────────────────────────────────────

export interface TaskStatusUpdateEvent {
  type: 'taskStatusUpdateEvent';
  taskId: string;
  contextId?: string;
  status: A2ATaskStatus;
  final: boolean;
}

export interface TaskArtifactUpdateEvent {
  type: 'taskArtifactUpdateEvent';
  taskId: string;
  contextId?: string;
  artifact: A2AArtifact;
}

export type A2ASSEEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

// ─── Agent Card ───────────────────────────────────────────────

export interface A2ASkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface A2AAgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
}

export interface A2AAgentCard {
  name: string;
  description?: string;
  url: string;
  version: string;
  capabilities: A2AAgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2ASkill[];
  iconUrl?: string;
  documentationUrl?: string;
}
