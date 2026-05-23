/**
 * A2A JSON-RPC Request Handler
 *
 * Implements the A2A v1.0 JSON-RPC binding while accepting the previous
 * v0.3-style Omni method names as compatibility aliases.
 */

import { generateCorrelationId } from '@omni/core';
import type { EventBus } from '@omni/core/events';
import { z } from 'zod';
import type { A2AChannelPlugin } from './plugin';
import type { A2AStreamStore } from './stream-store';
import { A2ATaskStore, taskIsTerminal, textPart } from './task-store';
import type { A2AMessage, A2APart, A2ATask, JSONRPCRequest, JSONRPCResponse, MessageSendParams } from './types';

// ─── A2A Input Validation Schemas ─────────────────────────────

const A2APartSchema = z
  .object({
    text: z.string().optional(),
    data: z.unknown().optional(),
    url: z.string().optional(),
    raw: z.string().optional(),
    mediaType: z.string().optional(),
    filename: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
    // Legacy part shape.
    type: z.string().optional(),
    file: z
      .object({
        name: z.string().optional(),
        mimeType: z.string().optional(),
        uri: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

const MessageSendParamsSchema = z.object({
  tenant: z.string().optional(),
  message: z.object({
    role: z.enum(['ROLE_USER', 'ROLE_AGENT', 'user', 'agent']),
    parts: z.array(A2APartSchema).min(1),
    messageId: z.string().optional(),
    taskId: z.string().optional(),
    contextId: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  configuration: z
    .object({
      acceptedOutputModes: z.array(z.string()).optional(),
      pushNotificationConfig: z.unknown().optional(),
      historyLength: z.number().int().optional(),
      returnImmediately: z.boolean().optional(),
      // Legacy v0.3 compatibility.
      blocking: z.boolean().optional(),
    })
    .optional(),
  taskId: z.string().optional(),
  contextId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const GetTaskParamsSchema = z.object({
  tenant: z.string().optional(),
  id: z.string(),
  historyLength: z.number().int().optional(),
});

const ListTasksParamsSchema = z.object({
  tenant: z.string().optional(),
  contextId: z.string().optional(),
  status: z
    .enum([
      'TASK_STATE_SUBMITTED',
      'TASK_STATE_WORKING',
      'TASK_STATE_COMPLETED',
      'TASK_STATE_FAILED',
      'TASK_STATE_CANCELED',
      'TASK_STATE_INPUT_REQUIRED',
      'TASK_STATE_REJECTED',
      'TASK_STATE_AUTH_REQUIRED',
    ])
    .optional(),
  historyLength: z.number().int().optional(),
  statusTimestampAfter: z.string().optional(),
  includeArtifacts: z.boolean().optional(),
  pageSize: z.number().int().optional(),
  pageToken: z.string().optional(),
});

const CancelTaskParamsSchema = z.object({ tenant: z.string().optional(), id: z.string() });
const SubscribeToTaskParamsSchema = z.object({ tenant: z.string().optional(), id: z.string() });

// ─── JSON-RPC Error Codes ─────────────────────────────────────

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;
const RPC_INTERNAL_ERROR = -32603;

const A2A_TASK_NOT_FOUND = -32001;
const A2A_TASK_NOT_CANCELABLE = -32002;
const A2A_PUSH_NOTIFICATION_NOT_SUPPORTED = -32003;
const A2A_UNSUPPORTED_OPERATION = -32004;
const A2A_CONTENT_TYPE_NOT_SUPPORTED = -32005;
const A2A_VERSION_NOT_SUPPORTED = -32009;
const A2A_UNAUTHORIZED = -32010;
const A2A_ERROR_DOMAIN = 'a2a-protocol.org';
const DEFAULT_SEND_WAIT_MS = 30_000;
const SEND_WAIT_POLL_BACKOFF_MS = [100, 250, 500, 1000] as const;
const SEND_WAIT_MS = parseSendWaitMs();

const LEGACY_METHODS = new Set([
  'message/send',
  'message/stream',
  'tasks/get',
  'tasks/cancel',
  'tasks/resubscribe',
  'tasks/pushNotificationConfig/set',
  'tasks/pushNotificationConfig/get',
]);

// ─── Helper: text content from A2A message ────────────────────

function normalizeRole(role: 'ROLE_USER' | 'ROLE_AGENT' | 'user' | 'agent'): A2AMessage['role'] {
  if (role === 'agent') return 'ROLE_AGENT';
  if (role === 'user') return 'ROLE_USER';
  return role;
}

function normalizePart(part: z.infer<typeof A2APartSchema>): A2APart {
  if (typeof part.text === 'string') return textPart(part.text);
  if (part.data !== undefined) return { data: part.data, mediaType: part.mediaType, metadata: part.metadata };
  if (typeof part.url === 'string') {
    return { url: part.url, filename: part.filename, mediaType: part.mediaType, metadata: part.metadata };
  }
  if (typeof part.raw === 'string') {
    return { raw: part.raw, filename: part.filename, mediaType: part.mediaType, metadata: part.metadata };
  }

  if (part.type === 'text' && typeof part.text === 'string') return textPart(part.text);
  if (part.type === 'data') return { data: part.data, mediaType: part.mediaType, metadata: part.metadata };
  if (part.type === 'file' && part.file?.uri) {
    return {
      url: part.file.uri,
      filename: part.file.name,
      mediaType: part.file.mimeType,
      metadata: part.metadata,
    };
  }

  return { data: part, mediaType: 'application/json' };
}

function normalizeMessage(message: z.infer<typeof MessageSendParamsSchema>['message']): A2AMessage {
  return {
    role: normalizeRole(message.role),
    parts: message.parts.map(normalizePart),
    messageId: message.messageId,
    taskId: message.taskId,
    contextId: message.contextId,
    metadata: message.metadata,
  };
}

function extractText(message: A2AMessage): string {
  return message.parts
    .filter((p): p is { text: string } => typeof (p as { text?: unknown }).text === 'string')
    .map((p) => p.text)
    .join('\n');
}

// ─── Helper: JSON-RPC response builders ──────────────────────

function jsonRpc(id: string | number | null, result: unknown): JSONRPCResponse {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): JSONRPCResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

function a2aErrorReason(code: number): string | undefined {
  switch (code) {
    case A2A_TASK_NOT_FOUND:
      return 'TASK_NOT_FOUND';
    case A2A_TASK_NOT_CANCELABLE:
      return 'TASK_NOT_CANCELABLE';
    case A2A_PUSH_NOTIFICATION_NOT_SUPPORTED:
      return 'PUSH_NOTIFICATION_NOT_SUPPORTED';
    case A2A_UNSUPPORTED_OPERATION:
      return 'UNSUPPORTED_OPERATION';
    case A2A_CONTENT_TYPE_NOT_SUPPORTED:
      return 'CONTENT_TYPE_NOT_SUPPORTED';
    case A2A_VERSION_NOT_SUPPORTED:
      return 'VERSION_NOT_SUPPORTED';
    case A2A_UNAUTHORIZED:
      return 'UNAUTHORIZED';
    default:
      return undefined;
  }
}

function a2aErrorInfo(code: number, metadata?: Record<string, string>): unknown[] | undefined {
  const reason = a2aErrorReason(code);
  if (!reason) return undefined;

  return [
    {
      '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
      reason,
      domain: A2A_ERROR_DOMAIN,
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    },
  ];
}

function jsonRpcA2AError(
  id: string | number | null,
  code: number,
  message: string,
  metadata?: Record<string, string>,
): JSONRPCResponse {
  return jsonRpcError(id, code, message, a2aErrorInfo(code, metadata));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function validateVersion(request: Request, method: string): JSONRPCResponse | null {
  const url = new URL(request.url);
  const requested = request.headers.get('A2A-Version') ?? url.searchParams.get('A2A-Version') ?? '';
  if (!requested) return null;

  const isLegacyMethod = LEGACY_METHODS.has(method);
  if (requested === '1.0' && !isLegacyMethod) return null;
  if (requested === '0.3' && isLegacyMethod) return null;

  return jsonRpcA2AError(
    null,
    A2A_VERSION_NOT_SUPPORTED,
    `A2A version '${requested}' is not supported by method '${method}'`,
    { version: requested, method },
  );
}

// ─── Main handler ────────────────────────────────────────────

export interface A2AHandlerContext {
  instanceId: string;
  eventBus: EventBus;
  streamStore: A2AStreamStore;
  taskStore?: A2ATaskStore;
  callerKey?: string;
  channelType: 'a2a';
  plugin: A2AChannelPlugin;
}

function getTaskStore(ctx: A2AHandlerContext): A2ATaskStore {
  ctx.taskStore ??= new A2ATaskStore();
  return ctx.taskStore;
}

function getCallerKey(ctx: A2AHandlerContext): string {
  return typeof ctx.callerKey === 'string' ? ctx.callerKey.trim() : '';
}

function taskOwnedByCaller(task: A2ATask, callerKey: string): boolean {
  return typeof task.metadata?.callerKey === 'string' && task.metadata.callerKey === callerKey;
}

function canAccessTask(ctx: A2AHandlerContext, task: A2ATask): boolean {
  const callerKey = getCallerKey(ctx);
  return callerKey.length > 0 && taskOwnedByCaller(task, callerKey);
}

function requireCallerKey(id: string | number | null, ctx: A2AHandlerContext): string | Response {
  const callerKey = getCallerKey(ctx);
  if (callerKey.length > 0) return callerKey;

  return jsonResponse(jsonRpcA2AError(id, A2A_UNAUTHORIZED, 'Authentication required'), 401);
}

function shouldReturnImmediately(sendParams: MessageSendParams): boolean {
  if (sendParams.configuration?.returnImmediately !== undefined) return sendParams.configuration.returnImmediately;
  if (sendParams.configuration?.blocking !== undefined) return !sendParams.configuration.blocking;
  return false;
}

function parseSendWaitMs(): number {
  const configured = Number.parseInt(process.env.A2A_SEND_WAIT_MS ?? '', 10);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_SEND_WAIT_MS;
}

function taskIsSettled(task: A2ATask): boolean {
  return (
    taskIsTerminal(task) ||
    task.status.state === 'TASK_STATE_INPUT_REQUIRED' ||
    task.status.state === 'TASK_STATE_AUTH_REQUIRED' ||
    task.status.state === 'input-required'
  );
}

async function waitForSettledTask(
  taskStore: A2ATaskStore,
  instanceId: string,
  taskId: string,
  initialTask: A2ATask,
): Promise<A2ATask> {
  const deadline = Date.now() + SEND_WAIT_MS;
  let current = initialTask;
  let pollIndex = 0;

  while (Date.now() < deadline) {
    const latest = await taskStore.getTask(instanceId, taskId);
    if (latest) current = latest;
    if (taskIsSettled(current)) return current;
    const pollMs = SEND_WAIT_POLL_BACKOFF_MS[Math.min(pollIndex, SEND_WAIT_POLL_BACKOFF_MS.length - 1)] ?? 1000;
    pollIndex++;
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }

  return (await taskStore.getTask(instanceId, taskId)) ?? current;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Handle a POST request to the A2A endpoint for the given instance.
 * Returns a JSON response (SendMessage) or SSE stream (SendStreamingMessage).
 */
export async function handleA2ARequest(request: Request, ctx: A2AHandlerContext): Promise<Response> {
  const t0 = Date.now(); // T0: request arrival time (synthetic; A2A has no platform timestamp)
  let rpcReq: JSONRPCRequest;

  try {
    rpcReq = (await request.json()) as JSONRPCRequest;
  } catch {
    return jsonResponse(jsonRpcError(null, RPC_PARSE_ERROR, 'Invalid JSON payload'), 400);
  }

  if (typeof rpcReq !== 'object' || rpcReq === null) {
    return jsonResponse(jsonRpcError(null, RPC_INVALID_REQUEST, 'Request payload validation error'), 400);
  }

  if (rpcReq.jsonrpc !== '2.0' || !rpcReq.method) {
    return jsonResponse(jsonRpcError(rpcReq.id ?? null, RPC_INVALID_REQUEST, 'Request payload validation error'), 400);
  }

  const { id, method, params } = rpcReq;
  ctx.callerKey = request.headers.get('x-omni-api-key-id') ?? undefined;
  const versionError = validateVersion(request, method);
  if (versionError) {
    return jsonResponse({ ...versionError, id }, 400);
  }

  switch (method) {
    case 'SendMessage':
    case 'message/send':
      return handleMessageSend(id, params as Record<string, unknown> | undefined, ctx, t0);

    case 'SendStreamingMessage':
    case 'message/stream':
      return handleMessageStream(id, params as Record<string, unknown> | undefined, ctx, t0);

    case 'GetTask':
    case 'tasks/get':
      return handleGetTask(id, params as Record<string, unknown> | undefined, ctx);

    case 'ListTasks':
      return handleListTasks(id, params as Record<string, unknown> | undefined, ctx);

    case 'CancelTask':
    case 'tasks/cancel':
      return handleCancelTask(id, params as Record<string, unknown> | undefined, ctx);

    case 'SubscribeToTask':
    case 'tasks/resubscribe':
      return handleSubscribeToTask(id, params as Record<string, unknown> | undefined, ctx);

    case 'GetExtendedAgentCard':
      return jsonResponse(
        jsonRpcA2AError(
          id,
          A2A_UNSUPPORTED_OPERATION,
          'GetExtendedAgentCard is exposed through /api/v2/a2a/agents/:agentId/card',
          {
            method,
          },
        ),
        400,
      );

    case 'CreateTaskPushNotificationConfig':
    case 'GetTaskPushNotificationConfig':
    case 'ListTaskPushNotificationConfigs':
    case 'DeleteTaskPushNotificationConfig':
    case 'tasks/pushNotificationConfig/set':
    case 'tasks/pushNotificationConfig/get':
      return jsonResponse(
        jsonRpcA2AError(id, A2A_UNSUPPORTED_OPERATION, `Method '${method}' is not supported`, { method }),
        400,
      );

    default:
      return jsonResponse(jsonRpcError(id, RPC_METHOD_NOT_FOUND, `Method not found: ${method}`), 404);
  }
}

// ─── SendMessage ──────────────────────────────────────────────

async function handleMessageSend(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
  ctx: A2AHandlerContext,
  t0: number,
): Promise<Response> {
  const parsed = parseSendParams(id, params);
  if (parsed instanceof Response) return parsed;

  const { sendParams, message, text } = parsed;
  const callerKey = requireCallerKey(id, ctx);
  if (callerKey instanceof Response) return callerKey;

  if (sendParams.configuration?.pushNotificationConfig !== undefined) {
    return jsonResponse(
      jsonRpcA2AError(id, A2A_PUSH_NOTIFICATION_NOT_SUPPORTED, 'Push notifications are not supported'),
      400,
    );
  }

  const prepared = await prepareTaskForSend(id, ctx, sendParams, message, callerKey);
  if (prepared instanceof Response) return prepared;
  const { taskStore, task, taskId, contextId, normalizedMessage } = prepared;

  const timings = ctx.plugin.inboundTimings(t0);

  try {
    const correlationId = await emitMessageReceived(normalizedMessage, text, taskId, contextId, ctx, timings);
    if (timings) ctx.plugin.recordT2(correlationId, timings);
  } catch {
    await taskStore.updateStatus(ctx.instanceId, taskId, 'TASK_STATE_FAILED');
    return jsonResponse(jsonRpcError(id, RPC_INTERNAL_ERROR, 'Internal error'), 500);
  }

  const responseTask = shouldReturnImmediately(sendParams)
    ? task
    : await waitForSettledTask(taskStore, ctx.instanceId, taskId, task);

  return jsonResponse(jsonRpc(id, { task: trimHistory(responseTask, sendParams.configuration?.historyLength) }));
}

// ─── SendStreamingMessage ─────────────────────────────────────

async function handleMessageStream(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
  ctx: A2AHandlerContext,
  t0: number,
): Promise<Response> {
  const parsed = parseSendParams(id, params);
  if (parsed instanceof Response) return parsed;

  const { sendParams, message, text } = parsed;
  const callerKey = requireCallerKey(id, ctx);
  if (callerKey instanceof Response) return callerKey;

  if (sendParams.configuration?.pushNotificationConfig !== undefined) {
    return jsonResponse(
      jsonRpcA2AError(id, A2A_PUSH_NOTIFICATION_NOT_SUPPORTED, 'Push notifications are not supported'),
      400,
    );
  }

  const prepared = await prepareTaskForSend(id, ctx, sendParams, message, callerKey);
  if (prepared instanceof Response) return prepared;
  const { taskStore, task, taskId, contextId, normalizedMessage } = prepared;

  const sseStream = ctx.streamStore.createPendingStream(ctx.instanceId, taskId, id, contextId);
  ctx.streamStore.writeTask(ctx.instanceId, taskId, task);

  const timings = ctx.plugin.inboundTimings(t0);

  try {
    const correlationId = await emitMessageReceived(normalizedMessage, text, taskId, contextId, ctx, timings);
    if (timings) ctx.plugin.recordT2(correlationId, timings);
  } catch {
    await taskStore.updateStatus(ctx.instanceId, taskId, 'TASK_STATE_FAILED');
    ctx.streamStore.closeStream(ctx.instanceId, taskId, 'TASK_STATE_FAILED');
  }

  return new Response(sseStream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function parseSendParams(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
): { sendParams: MessageSendParams; message: A2AMessage; text: string } | Response {
  const parseResult = MessageSendParamsSchema.safeParse(params);
  if (!parseResult.success) {
    return jsonResponse(jsonRpcError(id, RPC_INVALID_PARAMS, `Invalid params: ${parseResult.error.message}`), 400);
  }

  const raw = parseResult.data;
  const message = normalizeMessage(raw.message);
  const text = extractText(message);
  if (!text.trim()) {
    return jsonResponse(
      jsonRpcA2AError(id, A2A_CONTENT_TYPE_NOT_SUPPORTED, 'Only text parts are currently supported'),
      400,
    );
  }

  return { sendParams: { ...raw, message } as MessageSendParams, message, text };
}

async function prepareTaskForSend(
  id: string | number | null,
  ctx: A2AHandlerContext,
  sendParams: MessageSendParams,
  message: A2AMessage,
  callerKey: string,
): Promise<
  | {
      taskStore: A2ATaskStore;
      task: A2ATask;
      taskId: string;
      contextId: string;
      normalizedMessage: A2AMessage;
    }
  | Response
> {
  const taskId = sendParams.taskId ?? message.taskId ?? generateCorrelationId('a2a');
  const requestedContextId = sendParams.contextId ?? message.contextId ?? taskId;
  const taskStore = getTaskStore(ctx);
  const existingTask = await taskStore.getTask(ctx.instanceId, taskId);
  const contextId = existingTask?.contextId ?? requestedContextId;
  const normalizedMessage = {
    ...message,
    messageId: message.messageId ?? generateCorrelationId('msg'),
    taskId,
    contextId,
  };
  const metadata = { ...(sendParams.metadata ?? {}), callerKey };

  if (existingTask) {
    if (!taskOwnedByCaller(existingTask, callerKey)) {
      return jsonResponse(jsonRpcA2AError(id, A2A_TASK_NOT_FOUND, 'Task not found', { taskId }), 404);
    }

    const task = await taskStore.appendMessage({
      instanceId: ctx.instanceId,
      taskId,
      contextId,
      message: normalizedMessage,
      metadata,
    });

    if (!task) {
      return jsonResponse(jsonRpcError(id, RPC_INTERNAL_ERROR, 'Internal error'), 500);
    }

    return { taskStore, task, taskId, contextId, normalizedMessage };
  }

  const task = await taskStore.createTask({
    instanceId: ctx.instanceId,
    taskId,
    contextId,
    message: normalizedMessage,
    metadata,
  });

  return { taskStore, task, taskId, contextId, normalizedMessage };
}

// ─── Task Methods ─────────────────────────────────────────────

async function handleGetTask(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
  ctx: A2AHandlerContext,
): Promise<Response> {
  const parseResult = GetTaskParamsSchema.safeParse(params);
  if (!parseResult.success) {
    return jsonResponse(jsonRpcError(id, RPC_INVALID_PARAMS, `Invalid params: ${parseResult.error.message}`), 400);
  }
  const callerKey = requireCallerKey(id, ctx);
  if (callerKey instanceof Response) return callerKey;

  const task = await getTaskStore(ctx).getTask(ctx.instanceId, parseResult.data.id);
  if (!task || !canAccessTask(ctx, task)) {
    return jsonResponse(
      jsonRpcA2AError(id, A2A_TASK_NOT_FOUND, 'Task not found', { taskId: parseResult.data.id }),
      404,
    );
  }

  return jsonResponse(jsonRpc(id, { task: trimHistory(task, parseResult.data.historyLength) }));
}

async function handleListTasks(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
  ctx: A2AHandlerContext,
): Promise<Response> {
  const parseResult = ListTasksParamsSchema.safeParse(params ?? {});
  if (!parseResult.success) {
    return jsonResponse(jsonRpcError(id, RPC_INVALID_PARAMS, `Invalid params: ${parseResult.error.message}`), 400);
  }
  const callerKey = requireCallerKey(id, ctx);
  if (callerKey instanceof Response) return callerKey;

  const result = await getTaskStore(ctx).listTasks(ctx.instanceId, {
    ...parseResult.data,
    callerKey,
  });
  return jsonResponse(jsonRpc(id, result));
}

async function handleCancelTask(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
  ctx: A2AHandlerContext,
): Promise<Response> {
  const parseResult = CancelTaskParamsSchema.safeParse(params);
  if (!parseResult.success) {
    return jsonResponse(jsonRpcError(id, RPC_INVALID_PARAMS, `Invalid params: ${parseResult.error.message}`), 400);
  }
  const callerKey = requireCallerKey(id, ctx);
  if (callerKey instanceof Response) return callerKey;

  const taskStore = getTaskStore(ctx);
  const task = await taskStore.getTask(ctx.instanceId, parseResult.data.id);
  if (!task || !canAccessTask(ctx, task)) {
    return jsonResponse(
      jsonRpcA2AError(id, A2A_TASK_NOT_FOUND, 'Task not found', { taskId: parseResult.data.id }),
      404,
    );
  }
  if (taskIsTerminal(task)) {
    return jsonResponse(
      jsonRpcA2AError(id, A2A_TASK_NOT_CANCELABLE, 'Task is already terminal', { taskId: parseResult.data.id }),
      400,
    );
  }

  const canceled = await taskStore.cancelTask(ctx.instanceId, parseResult.data.id);
  ctx.streamStore.closeStream(ctx.instanceId, parseResult.data.id, 'TASK_STATE_CANCELED');
  return jsonResponse(jsonRpc(id, { task: canceled }));
}

async function handleSubscribeToTask(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
  ctx: A2AHandlerContext,
): Promise<Response> {
  const parseResult = SubscribeToTaskParamsSchema.safeParse(params);
  if (!parseResult.success) {
    return jsonResponse(jsonRpcError(id, RPC_INVALID_PARAMS, `Invalid params: ${parseResult.error.message}`), 400);
  }
  const callerKey = requireCallerKey(id, ctx);
  if (callerKey instanceof Response) return callerKey;

  const task = await getTaskStore(ctx).getTask(ctx.instanceId, parseResult.data.id);
  if (!task || !canAccessTask(ctx, task)) {
    return jsonResponse(
      jsonRpcA2AError(id, A2A_TASK_NOT_FOUND, 'Task not found', { taskId: parseResult.data.id }),
      404,
    );
  }
  if (taskIsTerminal(task)) {
    return jsonResponse(
      jsonRpcA2AError(id, A2A_UNSUPPORTED_OPERATION, 'Cannot subscribe to a terminal task', {
        taskId: parseResult.data.id,
      }),
      400,
    );
  }

  const sseStream = ctx.streamStore.createPendingStream(ctx.instanceId, task.id, id, task.contextId ?? task.id);
  ctx.streamStore.writeTask(ctx.instanceId, task.id, task);

  return new Response(sseStream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function trimHistory(task: A2ATask, historyLength?: number): A2ATask {
  if (historyLength === undefined) return task;
  if (historyLength <= 0) return { ...task, history: [] };
  return { ...task, history: task.history?.slice(-historyLength) ?? [] };
}

// ─── Event emission ───────────────────────────────────────────

async function emitMessageReceived(
  message: A2AMessage,
  text: string,
  taskId: string,
  contextId: string,
  ctx: A2AHandlerContext,
  timings?: Record<string, number>,
): Promise<string> {
  const correlationId = generateCorrelationId('evt');

  await ctx.eventBus.publish(
    'message.received',
    {
      externalId: message.messageId ?? taskId,
      chatId: taskId, // taskId as chatId -> dispatcher uses it for sendResponseParts routing
      from: `a2a:${contextId}`,
      content: { type: 'text', text },
      rawPayload: { a2aTaskId: taskId, a2aContextId: contextId, a2aMessage: message },
    },
    {
      correlationId,
      instanceId: ctx.instanceId,
      channelType: ctx.channelType,
      source: 'channel:a2a',
      timings,
    },
  );

  return correlationId;
}
