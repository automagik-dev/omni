/**
 * Zenvia webhook handler.
 *
 * Contract:
 *   - The route is PER-INSTANCE: `/api/v2/channels/zenvia/:instanceId/webhook`
 *     (mounted by `@omni/api`, same pattern as Gupshup/Hermes/ASC). This URL
 *     is registered as the `webhook.url` of the instance's Zenvia
 *     subscriptions (`POST /v2/subscriptions`).
 *   - Authenticity: Zenvia signs nothing, but a subscription can carry fixed
 *     `webhook.headers`. When `webhookVerifyToken` is configured on the
 *     instance, every POST must carry it as `x-webhook-token` (a missing or
 *     wrong token is a 401). Without it, authenticity rests on the
 *     unguessable instance id in the path.
 *   - Events handled:
 *       MESSAGE (direction IN)  → message.received
 *       MESSAGE_STATUS          → message.delivered / read / failed
 *     Everything else (MESSAGE direction OUT, CONVERSATION_STATUS, CONTACT,
 *     …) is acknowledged and ignored — see the package README for why
 *     conversation-status tracking is not wired yet.
 *   - ALWAYS respond 200 to authenticated requests — a permanent 4xx would
 *     only make Zenvia re-deliver the same unprocessable payload.
 */

import { timingSafeEqual } from 'node:crypto';

import type { ZenviaPlugin } from '../plugin';
import { ZenviaEventEnvelopeSchema, ZenviaMessageEventSchema, ZenviaMessageStatusEventSchema } from '../types';

// Webhook events are small JSON documents (media arrives by URL, never inline).
const MAX_BODY_BYTES = 1024 * 1024;

const TOKEN_HEADER = 'x-webhook-token';

function tokensMatch(supplied: string | null, expected: string): boolean {
  if (supplied === null) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Full HTTP entry point used by `plugin.handleWebhook`: authenticates, reads
 * and validates the POST body and dispatches by event type.
 */
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

/** Validate one subscription event and hand it to the plugin. */
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

  // OUT events echo messages sent from this number (by Omni or by people in
  // Zenvia's own inbox) — only what the contact sent is inbound.
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
