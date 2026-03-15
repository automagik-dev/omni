/**
 * A2A JSON-RPC Request Handler
 *
 * Handles incoming A2A protocol requests:
 * - message/send  → fire-and-forget, returns task with state 'submitted'
 * - message/stream → SSE stream, yields artifact + status events as agent responds
 * - tasks/get      → stub (returns not-found)
 * - tasks/cancel   → stub (returns not-found)
 */

import { generateCorrelationId } from '@omni/core';
import type { EventBus } from '@omni/core/events';
import { z } from 'zod';
import type { A2AChannelPlugin } from './plugin';
import type { A2AStreamStore } from './stream-store';
import type { A2AMessage, A2ATask, JSONRPCRequest, JSONRPCResponse, MessageSendParams } from './types';

// ─── A2A Input Validation Schemas ─────────────────────────────

const A2AMessagePartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('data'), data: z.record(z.unknown()) }),
  z.object({
    type: z.literal('file'),
    file: z.object({
      name: z.string().optional(),
      mimeType: z.string().optional(),
      uri: z.string().optional(),
    }),
  }),
]);

const MessageSendParamsSchema = z.object({
  message: z.object({
    role: z.enum(['user', 'agent']),
    parts: z.array(A2AMessagePartSchema),
    messageId: z.string().optional(),
    taskId: z.string().optional(),
    contextId: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  configuration: z
    .object({
      acceptedOutputModes: z.array(z.string()).optional(),
      historyLength: z.number().int().optional(),
      blocking: z.boolean().optional(),
    })
    .optional(),
  taskId: z.string().optional(),
  contextId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ─── JSON-RPC Error Codes ─────────────────────────────────────

const RPC_PARSE_ERROR = -32700;
const RPC_INVALID_REQUEST = -32600;
const RPC_METHOD_NOT_FOUND = -32601;
const RPC_INVALID_PARAMS = -32602;

// ─── Helper: text content from A2A message ────────────────────

function extractText(message: A2AMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Main handler ────────────────────────────────────────────

export interface A2AHandlerContext {
  instanceId: string;
  eventBus: EventBus;
  streamStore: A2AStreamStore;
  channelType: 'a2a';
  plugin: A2AChannelPlugin;
}

/**
 * Handle a POST request to the A2A endpoint for the given instance.
 * Returns a JSON response (message/send) or SSE stream (message/stream).
 */
export async function handleA2ARequest(request: Request, ctx: A2AHandlerContext): Promise<Response> {
  const t0 = Date.now(); // T0: request arrival time (synthetic — A2A has no platform timestamp)
  let rpcReq: JSONRPCRequest;

  try {
    rpcReq = (await request.json()) as JSONRPCRequest;
  } catch {
    return jsonResponse(jsonRpcError(null, RPC_PARSE_ERROR, 'Parse error'), 400);
  }

  if (typeof rpcReq !== 'object' || rpcReq === null) {
    return jsonResponse(jsonRpcError(null, RPC_INVALID_REQUEST, 'Invalid JSON-RPC request'), 400);
  }

  if (rpcReq.jsonrpc !== '2.0' || !rpcReq.method) {
    return jsonResponse(jsonRpcError(rpcReq.id ?? null, RPC_INVALID_REQUEST, 'Invalid JSON-RPC request'), 400);
  }

  const { id, method, params } = rpcReq;

  switch (method) {
    case 'message/send':
      return handleMessageSend(id, params as Record<string, unknown> | undefined, ctx, t0);

    case 'message/stream':
      return handleMessageStream(id, params as Record<string, unknown> | undefined, ctx, t0);

    case 'tasks/get':
    case 'tasks/cancel':
    case 'tasks/resubscribe':
    case 'tasks/pushNotificationConfig/set':
    case 'tasks/pushNotificationConfig/get':
      return jsonResponse(jsonRpcError(id, RPC_METHOD_NOT_FOUND, `Method '${method}' not yet implemented`), 501);

    default:
      return jsonResponse(jsonRpcError(id, RPC_METHOD_NOT_FOUND, `Unknown method: ${method}`), 404);
  }
}

// ─── message/send ─────────────────────────────────────────────

async function handleMessageSend(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
  ctx: A2AHandlerContext,
  t0: number,
): Promise<Response> {
  const parseResult = MessageSendParamsSchema.safeParse(params);
  if (!parseResult.success) {
    return jsonResponse(jsonRpcError(id, RPC_INVALID_PARAMS, `Invalid params: ${parseResult.error.message}`), 400);
  }
  const sendParams = parseResult.data as MessageSendParams;

  const text = extractText(sendParams.message);
  if (!text.trim()) {
    return jsonResponse(jsonRpcError(id, RPC_INVALID_PARAMS, 'Only text parts are currently supported'), 400);
  }

  const taskId = generateCorrelationId('a2a');
  const contextId = sendParams.contextId ?? taskId;

  // Journey timing: capture T0 (request arrival) and T1 (plugin received)
  const timings = ctx.plugin.inboundTimings(t0);

  try {
    const correlationId = await emitMessageReceived(sendParams.message, taskId, contextId, ctx, timings);
    // Journey timing: capture T2 (event published)
    if (timings) ctx.plugin.recordT2(correlationId, timings);
  } catch {
    return jsonResponse(jsonRpcError(id, -32603, 'Internal error'), 500);
  }

  // Return a terminal state so A2A clients don't attempt to poll tasks/get.
  // Omni processes messages asynchronously via event bus — the actual response
  // will arrive via streaming or webhook, not via task polling.
  const task: A2ATask = {
    id: taskId,
    contextId,
    status: { state: 'completed', timestamp: new Date().toISOString() },
  };

  return jsonResponse(jsonRpc(id, { task }));
}

// ─── message/stream ───────────────────────────────────────────

async function handleMessageStream(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
  ctx: A2AHandlerContext,
  t0: number,
): Promise<Response> {
  const parseResult = MessageSendParamsSchema.safeParse(params);
  if (!parseResult.success) {
    return jsonResponse(jsonRpcError(id, RPC_INVALID_PARAMS, `Invalid params: ${parseResult.error.message}`), 400);
  }
  const sendParams = parseResult.data as MessageSendParams;

  const text = extractText(sendParams.message);
  if (!text.trim()) {
    return jsonResponse(jsonRpcError(id, RPC_INVALID_PARAMS, 'Only text parts are currently supported'), 400);
  }

  const taskId = generateCorrelationId('a2a');
  const contextId = sendParams.contextId ?? taskId;

  // Create pending SSE stream BEFORE emitting event so the dispatcher can write to it
  const sseStream = ctx.streamStore.createPendingStream(ctx.instanceId, taskId);

  // Journey timing: capture T0 (request arrival) and T1 (plugin received)
  const timings = ctx.plugin.inboundTimings(t0);

  // Emit message.received to trigger the dispatcher
  try {
    const correlationId = await emitMessageReceived(sendParams.message, taskId, contextId, ctx, timings);
    // Journey timing: capture T2 (event published)
    if (timings) ctx.plugin.recordT2(correlationId, timings);
  } catch {
    ctx.streamStore.closeStream(ctx.instanceId, taskId, 'failed');
    return jsonResponse(jsonRpcError(id, -32603, 'Internal error'), 500);
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

// ─── Event emission ───────────────────────────────────────────

async function emitMessageReceived(
  message: A2AMessage,
  taskId: string,
  contextId: string,
  ctx: A2AHandlerContext,
  timings?: Record<string, number>,
): Promise<string> {
  const text = extractText(message);
  const correlationId = generateCorrelationId('evt');

  await ctx.eventBus.publish(
    'message.received',
    {
      externalId: taskId,
      chatId: taskId, // taskId as chatId → dispatcher uses for sendResponseParts routing
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
