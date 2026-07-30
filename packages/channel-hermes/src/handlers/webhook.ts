/**
 * Hermes (Mutant) webhook handler.
 *
 * Contract:
 *   - The route is PER-INSTANCE: `POST /api/v2/channels/hermes/:instanceId/webhook`
 *     (mounted by `@omni/api`, same pattern as Gupshup). Hermes offers NO
 *     signature mechanism — authenticity rests on the unguessable instance id
 *     in the path PLUS a `media_id` cross-check: the payload's `media_id`
 *     (line UUID) must equal the instance's configured `hermesMediaId`.
 *     A mismatch is warn-logged and ignored — still 200 at the route level.
 *   - Bodies are `HermesWebhookPayloadSchema` envelopes wrapping Cloud-API
 *     inbound messages (`messages[]` + `contacts[]`, `message_type: "IN"`) or
 *     status entries (`statuses[]`, ids = Hermes send UUIDs).
 *   - ALWAYS respond 200 — Hermes retries on non-2xx and a permanent 4xx
 *     would just re-deliver the same unprocessable payload.
 */

import { type HermesWebhookPayload, HermesWebhookPayloadSchema } from '@omni/core/schemas';

import type { HermesPlugin } from '../plugin';

// Hermes payloads are small (media rides as URLs); 2 MB is generous headroom.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Full HTTP entry point used by `plugin.handleWebhook`: reads + validates the
 * body, then delegates to `handleHermesWebhook`. Always resolves to a 200
 * (unprocessable payloads are logged and dropped).
 */
export async function handleHermesWebhookRequest(
  request: Request,
  plugin: HermesPlugin,
  instanceId: string,
): Promise<Response> {
  const logger = plugin.getLogger();

  let body: string;
  try {
    body = await request.text();
  } catch (err) {
    logger.warn('[hermes] failed to read webhook body', { instanceId, err: String(err) });
    return new Response('OK', { status: 200 });
  }

  if (body.length > MAX_BODY_BYTES) {
    logger.warn('[hermes] oversized webhook body rejected', { instanceId, size: body.length });
    return new Response('OK', { status: 200 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    logger.warn('[hermes] webhook body is not valid JSON', { instanceId });
    return new Response('OK', { status: 200 });
  }

  const validated = HermesWebhookPayloadSchema.safeParse(parsedJson);
  if (!validated.success) {
    logger.warn('[hermes] webhook payload failed schema validation', {
      instanceId,
      issues: validated.error.issues.slice(0, 5),
    });
    return new Response('OK', { status: 200 });
  }

  await handleHermesWebhook(plugin, instanceId, validated.data);
  return new Response('OK', { status: 200 });
}

/**
 * Process a parsed Hermes webhook payload for one instance.
 *
 * Cross-checks `payload.media_id` against the instance's configured line
 * UUID before touching anything — a mismatch means the POST was aimed at
 * the wrong instance (or forged) and is dropped with a warning.
 */
export async function handleHermesWebhook(
  plugin: HermesPlugin,
  instanceId: string,
  payload: HermesWebhookPayload,
): Promise<void> {
  const logger = plugin.getLogger();

  const state = plugin.getInstanceState(instanceId);
  if (!state) {
    logger.warn('[hermes] webhook for unknown/disconnected instance — dropping', { instanceId });
    return;
  }

  if (payload.media_id !== state.config.mediaId) {
    logger.warn('[hermes] webhook media_id does not match instance line UUID — ignoring payload', {
      instanceId,
      payloadMediaId: payload.media_id,
      expectedMediaId: state.config.mediaId,
    });
    return;
  }

  for (const msg of payload.messages ?? []) {
    try {
      await plugin.handleInboundMessage(instanceId, msg, payload.contacts, state.dedupeCache);
    } catch (err) {
      logger.warn('[hermes] failed to emit inbound message', { instanceId, err: String(err) });
    }
  }

  for (const status of payload.statuses ?? []) {
    try {
      await plugin.handleStatusUpdate(instanceId, status);
    } catch (err) {
      logger.warn('[hermes] failed to emit status event', { instanceId, err: String(err) });
    }
  }
}
