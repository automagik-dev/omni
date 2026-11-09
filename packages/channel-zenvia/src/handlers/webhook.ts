import { timingSafeEqual } from 'node:crypto';

import type { ZenviaPlugin } from '../plugin';
import { ZenviaEventEnvelopeSchema, ZenviaMessageEventSchema, ZenviaMessageStatusEventSchema } from '../types';

const MAX_BODY_BYTES = 1024 * 1024;

const TOKEN_HEADER = 'x-webhook-token';

function tokensMatch(supplied: string | null, expected: string): boolean {
  if (supplied === null) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleZenviaWebhookRequest(
  request: Request,
  plugin: ZenviaPlugin,
  instanceId: string,
  verifyToken: string | undefined,
): Promise<Response> {
  const logger = plugin.getLogger();

  if (verifyToken && !tokensMatch(request.headers.get(TOKEN_HEADER), verifyToken)) {
    logger.warn('[zenvia] webhook token missing or mismatched — rejecting', { instanceId });
    return new Response('Unauthorized', { status: 401 });
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    logger.warn('[zenvia] oversized webhook body rejected before reading it', { instanceId, size: declaredLength });
    return new Response('OK', { status: 200 });
  }

  let body: string;
  try {
    body = await request.text();
  } catch (err) {
    logger.warn('[zenvia] failed to read webhook body', { instanceId, err: String(err) });
    return new Response('OK', { status: 200 });
  }

  if (body.length > MAX_BODY_BYTES) {
    logger.warn('[zenvia] oversized webhook body rejected', { instanceId, size: body.length });
    return new Response('OK', { status: 200 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    logger.warn('[zenvia] webhook body is not valid JSON', { instanceId });
    return new Response('OK', { status: 200 });
  }

  await handleZenviaEvent(plugin, instanceId, parsedJson);
  return new Response('OK', { status: 200 });
}

export async function handleZenviaEvent(plugin: ZenviaPlugin, instanceId: string, payload: unknown): Promise<void> {
  const logger = plugin.getLogger();

  const envelope = ZenviaEventEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    logger.warn('[zenvia] webhook payload has no event type', { instanceId });
    return;
  }

  switch (envelope.data.type) {
    case 'MESSAGE':
      await dispatchMessageEvent(plugin, instanceId, payload);
      return;
    case 'MESSAGE_STATUS':
      await dispatchStatusEvent(plugin, instanceId, payload);
      return;
    default:
      logger.debug('[zenvia] ignoring unsupported webhook event', { instanceId, type: envelope.data.type });
  }
}

async function dispatchMessageEvent(plugin: ZenviaPlugin, instanceId: string, payload: unknown): Promise<void> {
  const logger = plugin.getLogger();
  const parsed = ZenviaMessageEventSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn('[zenvia] MESSAGE event failed schema validation', {
      instanceId,
      issues: parsed.error.issues.slice(0, 5),
    });
    return;
  }

  const direction = parsed.data.direction ?? parsed.data.message.direction;
  if (direction !== 'IN') {
    logger.debug('[zenvia] ignoring outbound MESSAGE echo', { instanceId, messageId: parsed.data.message.id });
    return;
  }

  try {
    await plugin.handleInboundMessage(instanceId, parsed.data.message);
  } catch (err) {
    logger.warn('[zenvia] failed to emit inbound message', { instanceId, err: String(err) });
  }
}

async function dispatchStatusEvent(plugin: ZenviaPlugin, instanceId: string, payload: unknown): Promise<void> {
  const logger = plugin.getLogger();
  const parsed = ZenviaMessageStatusEventSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn('[zenvia] MESSAGE_STATUS event failed schema validation', {
      instanceId,
      issues: parsed.error.issues.slice(0, 5),
    });
    return;
  }

  try {
    await plugin.handleStatusUpdate(instanceId, parsed.data);
  } catch (err) {
    logger.warn('[zenvia] failed to emit status event', { instanceId, err: String(err) });
  }
}
