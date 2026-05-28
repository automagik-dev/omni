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

/** Format a W3C traceparent value from a backend-agnostic trace context. */
export function formatTraceparent(ctx: TraceContext): string {
  const traceFlags = (ctx.traceFlags ?? 1) & 0xff;
  const flagsHex = traceFlags.toString(16);
  const paddedFlagsHex = flagsHex.length === 1 ? `0${flagsHex}` : flagsHex;
  return `00-${ctx.traceId}-${ctx.spanId}-${paddedFlagsHex}`;
}

/** Headers expected by HTTP/NATS providers for cross-process trace stitching. */
export function buildTraceHeaders(ctx?: TraceContext, khal?: KhalHeaderContext): Record<string, string> {
  const traceHeaders: Record<string, string> = {};

  if (ctx) {
    traceHeaders.traceparent = formatTraceparent(ctx);
    traceHeaders['x-trace-id'] = ctx.traceId;
    traceHeaders['x-span-id'] = ctx.spanId;

    const tracestate = ctx.tracestate ?? ctx.traceState;
    if (tracestate) {
      traceHeaders.tracestate = tracestate;
    }

    if (ctx.parentSpanId) {
      traceHeaders['x-parent-span-id'] = ctx.parentSpanId;
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
