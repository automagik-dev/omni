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
import type { A2AStreamStore } from './stream-store';
import type { A2AMessage, A2ATask, JSONRPCRequest, JSONRPCResponse, MessageSendParams } from './types';

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
}

/**
 * Handle a POST request to the A2A endpoint for the given instance.
 * Returns a JSON response (message/send) or SSE stream (message/stream).
 */
export async function handleA2ARequest(request: Request, ctx: A2AHandlerContext): Promise<Response> {
  let rpcReq: JSONRPCRequest;

  try {
    rpcReq = (await request.json()) as JSONRPCRequest;
  } catch {
    return jsonResponse(jsonRpcError(null, RPC_PARSE_ERROR, 'Parse error'), 400);
  }

  if (rpcReq.jsonrpc !== '2.0' || !rpcReq.method) {
    return jsonResponse(jsonRpcError(rpcReq.id ?? null, RPC_INVALID_REQUEST, 'Invalid JSON-RPC request'), 400);
  }

  const { id, method, params } = rpcReq;

  switch (method) {
    case 'message/send':
      return handleMessageSend(id, params as Record<string, unknown> | undefined, ctx);

    case 'message/stream':
      return handleMessageStream(id, params as Record<string, unknown> | undefined, ctx);

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
): Promise<Response> {
  if (!params?.message) {
    return jsonResponse(jsonRpcError(id, RPC_INVALID_PARAMS, 'Missing params.message'), 400);
  }

  const sendParams = params as unknown as MessageSendParams;
  const taskId = generateCorrelationId('a2a');
  const contextId = sendParams.contextId ?? taskId;

  await emitMessageReceived(sendParams.message, taskId, contextId, ctx);

  const task: A2ATask = {
    id: taskId,
    contextId,
    status: { state: 'submitted', timestamp: new Date().toISOString() },
  };

  return jsonResponse(jsonRpc(id, { task }));
}

// ─── message/stream ───────────────────────────────────────────

async function handleMessageStream(
  id: string | number | null,
  params: Record<string, unknown> | undefined,
  ctx: A2AHandlerContext,
): Promise<Response> {
  if (!params?.message) {
    return jsonResponse(jsonRpcError(id, RPC_INVALID_PARAMS, 'Missing params.message'), 400);
  }

  const sendParams = params as unknown as MessageSendParams;
  const taskId = generateCorrelationId('a2a');
  const contextId = sendParams.contextId ?? taskId;

  // Create pending SSE stream BEFORE emitting event so the dispatcher can write to it
  const sseStream = ctx.streamStore.createPendingStream(ctx.instanceId, taskId);

  // Emit message.received to trigger the dispatcher (fire-and-forget)
  await emitMessageReceived(sendParams.message, taskId, contextId, ctx);

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
): Promise<void> {
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
    },
  );
}
