/**
 * A2A protocol v1 type definitions.
 *
 * The public JSON model uses camelCase field names and ProtoJSON enum values.
 * @see https://a2a-protocol.org/latest/specification/
 */

// ─── Task State ───────────────────────────────────────────────

export type A2ATaskState =
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_REJECTED'
  | 'TASK_STATE_AUTH_REQUIRED'
  // Legacy v0.3 compatibility.
  | 'submitted'
  | 'working'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'input-required';

// ─── Message Parts ────────────────────────────────────────────

export type A2ATextPart = { text: string; mediaType?: string; metadata?: Record<string, unknown> };
export type A2ADataPart = { data: unknown; mediaType?: string; metadata?: Record<string, unknown> };
export type A2AFileUrlPart = {
  url: string;
  filename?: string;
  mediaType?: string;
  metadata?: Record<string, unknown>;
};
export type A2AFileRawPart = {
  raw: string;
  filename?: string;
  mediaType?: string;
  metadata?: Record<string, unknown>;
};
export type A2APart = A2ATextPart | A2ADataPart | A2AFileUrlPart | A2AFileRawPart;

// ─── Message ──────────────────────────────────────────────────

export interface A2AMessage {
  role: 'ROLE_USER' | 'ROLE_AGENT';
  parts: A2APart[];
  messageId?: string;
  taskId?: string;
  contextId?: string;
  extensions?: string[];
  metadata?: Record<string, unknown>;
}

// ─── Artifact ─────────────────────────────────────────────────

export interface A2AArtifact {
  artifactId?: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
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
  createdAt?: string;
  lastModified?: string;
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
  tenant?: string;
  message: A2AMessage;
  configuration?: {
    acceptedOutputModes?: string[];
    pushNotificationConfig?: unknown;
    historyLength?: number;
    returnImmediately?: boolean;
    /** Legacy v0.3 compatibility. */
    blocking?: boolean;
  };
  taskId?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
}

// ─── SSE Events ───────────────────────────────────────────────

export interface TaskStatusUpdateEvent {
  taskId: string;
  contextId: string;
  status: A2ATaskStatus;
  metadata?: Record<string, unknown>;
}

export interface TaskArtifactUpdateEvent {
  taskId: string;
  contextId: string;
  artifact: A2AArtifact;
  index?: number;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

export interface A2AStreamResponse {
  task?: A2ATask;
  message?: A2AMessage;
  taskStatusUpdate?: TaskStatusUpdateEvent;
  taskArtifactUpdate?: TaskArtifactUpdateEvent;
}

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

export interface A2AAgentInterface {
  url: string;
  protocolBinding: 'JSONRPC' | 'HTTP+JSON' | string;
  protocolVersion: string;
  tenant?: string;
}

export interface A2AAgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  extendedAgentCard?: boolean;
  extensions?: Array<Record<string, unknown>>;
}

export type A2ASecurityScheme =
  | {
      httpAuthSecurityScheme: {
        description?: string;
        scheme: string;
        bearerFormat?: string;
      };
    }
  | {
      apiKeySecurityScheme: {
        description?: string;
        location: 'query' | 'header' | 'cookie' | string;
        name: string;
      };
    }
  | Record<string, unknown>;

export interface A2ASecurityRequirement {
  schemes: Record<string, { list: string[] }>;
}

export interface A2AAgentCard {
  name: string;
  description?: string;
  version: string;
  supportedInterfaces: A2AAgentInterface[];
  capabilities: A2AAgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2ASkill[];
  provider?: {
    organization?: string;
    url?: string;
  };
  securitySchemes?: Record<string, A2ASecurityScheme>;
  securityRequirements?: A2ASecurityRequirement[];
  iconUrl?: string;
  documentationUrl?: string;
}
