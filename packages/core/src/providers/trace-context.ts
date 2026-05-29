import { createHash } from 'node:crypto';
import type { TraceContext } from './types';

interface KhalHeaderContext {
  khalSessionId?: string;
  userId?: string;
  messageId?: string;
  omni?: {
    instanceId?: string;
    chatId?: string;
    channel?: string;
  };
}

const W3C_TRACE_ID = /^[0-9a-f]{32}$/i;
const W3C_SPAN_ID = /^[0-9a-f]{16}$/i;

function isNonZeroHex(value: string): boolean {
  return value.length > 0 && !/^0+$/.test(value);
}

function hashHex(value: string, length: 16 | 32): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function normalizeTraceId(value: string): string {
  const lower = value.toLowerCase();
  if (W3C_TRACE_ID.test(lower) && isNonZeroHex(lower)) {
    return lower;
  }
  return hashHex(lower, 32);
}

function normalizeSpanId(value: string): string {
  const lower = value.toLowerCase();
  if (W3C_SPAN_ID.test(lower) && isNonZeroHex(lower)) {
    return lower;
  }
  return hashHex(lower, 16);
}

/** Build a W3C trace context from Omni's legacy trace id when no span context is available. */
export function createTraceContextFromTraceId(traceId?: string, spanSeed = 'provider'): TraceContext | undefined {
  if (!traceId) return undefined;

  return {
    traceId: normalizeTraceId(traceId),
    spanId: normalizeSpanId(`${traceId}:${spanSeed}`),
    traceFlags: 1,
  };
}

/** Format a W3C traceparent value from a backend-agnostic trace context. */
function formatTraceparent(ctx: TraceContext): string {
  const traceFlags = (ctx.traceFlags ?? 1) & 0xff;
  const paddedFlagsHex = traceFlags.toString(16).padStart(2, '0');
  return `00-${normalizeTraceId(ctx.traceId)}-${normalizeSpanId(ctx.spanId)}-${paddedFlagsHex}`;
}

/** Headers expected by HTTP/NATS providers for cross-process trace stitching. */
export function buildTraceHeaders(ctx?: TraceContext, khal?: KhalHeaderContext): Record<string, string> {
  const traceHeaders: Record<string, string> = {};

  if (ctx) {
    traceHeaders.traceparent = formatTraceparent(ctx);
    traceHeaders['x-trace-id'] = normalizeTraceId(ctx.traceId);
    traceHeaders['x-span-id'] = normalizeSpanId(ctx.spanId);

    const tracestate = ctx.tracestate ?? ctx.traceState;
    if (tracestate) {
      traceHeaders.tracestate = tracestate;
    }

    if (ctx.parentSpanId) {
      traceHeaders['x-parent-span-id'] = normalizeSpanId(ctx.parentSpanId);
    }
  }

  if (khal?.khalSessionId) {
    traceHeaders['x-khal-session-id'] = khal.khalSessionId;
  }
  if (khal?.userId) {
    traceHeaders['x-khal-user-id'] = khal.userId;
  }
  if (khal?.messageId) {
    traceHeaders['x-khal-message-id'] = khal.messageId;
  }
  if (khal?.omni?.instanceId) {
    traceHeaders['x-omni-instance-id'] = khal.omni.instanceId;
  }
  if (khal?.omni?.chatId) {
    traceHeaders['x-omni-chat-id'] = khal.omni.chatId;
  }
  if (khal?.omni?.channel) {
    traceHeaders['x-omni-channel'] = khal.omni.channel;
  }

  return traceHeaders;
}
