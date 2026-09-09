/**
 * ASC Brazil webhook handler.
 *
 * Contract:
 *   - The route is PER-INSTANCE: `/api/v2/channels/asc/:instanceId/webhook`
 *     (mounted by `@omni/api`, same pattern as Gupshup/Hermes). ASC does not
 *     document a payload signature (no X-Hub-Signature-256) — authenticity
 *     rests on the unguessable instance id in the path, plus an OPTIONAL
 *     verify-token check when `webhookVerifyToken` (ASC's `chave`) is
 *     configured on the instance.
 *   - GET — Meta-style verification challenge: echo `hub.challenge` verbatim.
 *     When a verify token is configured, `hub.verify_token` must match.
 *   - POST — payloads are OFFICIAL Meta Cloud API webhooks
 *     (`entry[].changes[].value` with messages/statuses/contacts), validated
 *     with the shared `MetaWebhookPayloadSchema` from @omni/core. When a
 *     verify token is configured AND the request carries one
 *     (`?token=` query or `x-webhook-token` header), it must match; requests
 *     without a token are accepted (ASC does not document echoing the chave
 *     on deliveries).
 *   - ALWAYS respond 200 to processable-shaped requests — a permanent 4xx
 *     would just make the gateway re-deliver the same unprocessable payload.
 */

import { type MetaWebhookPayload, MetaWebhookPayloadSchema } from '@omni/core/schemas';

import type { AscPlugin } from '../plugin';

// Meta caps webhook bodies at 1 MB; 2 MB is generous headroom for the proxy.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Handle the GET verification challenge (Meta-style `hub.challenge` echo). */
export function handleVerifyChallenge(request: Request, verifyToken: string | undefined): Response {
  const url = new URL(request.url);
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (challenge === null) {
    return new Response('Missing hub.challenge', { status: 400 });
  }
  if (verifyToken && token !== verifyToken) {
    return new Response('Verification failed', { status: 403 });
  }
  return new Response(challenge, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Full HTTP entry point used by `plugin.handleWebhook`: dispatches GET to
 * the challenge echo, otherwise reads + validates the POST body and
 * delegates to `handleAscWebhook`. Unprocessable POSTs are logged and acked
 * with 200.
 */
export async function handleAscWebhookRequest(
  request: Request,
  plugin: AscPlugin,
  instanceId: string,
  verifyToken: string | undefined,
): Promise<Response> {
  if (request.method === 'GET') {
    return handleVerifyChallenge(request, verifyToken);
  }

  const logger = plugin.getLogger();

  // Optional token check — only rejects when a token is configured AND the
  // request carries a mismatching one. See the module doc for the rationale.
  if (verifyToken) {
    const url = new URL(request.url);
    const supplied = url.searchParams.get('token') ?? request.headers.get('x-webhook-token');
    if (supplied !== null && supplied !== verifyToken) {
      logger.warn('[asc] webhook token mismatch — rejecting', { instanceId });
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body: string;
  try {
    body = await request.text();
  } catch (err) {
    logger.warn('[asc] failed to read webhook body', { instanceId, err: String(err) });
    return new Response('OK', { status: 200 });
  }

  if (body.length > MAX_BODY_BYTES) {
    logger.warn('[asc] oversized webhook body rejected', { instanceId, size: body.length });
    return new Response('OK', { status: 200 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    logger.warn('[asc] webhook body is not valid JSON', { instanceId });
    return new Response('OK', { status: 200 });
  }

  const validated = MetaWebhookPayloadSchema.safeParse(parsedJson);
  if (!validated.success) {
    logger.warn('[asc] webhook payload failed schema validation', {
      instanceId,
      issues: validated.error.issues.slice(0, 5),
    });
    return new Response('OK', { status: 200 });
  }

  await handleAscWebhook(plugin, instanceId, validated.data);
  return new Response('OK', { status: 200 });
}

/**
 * Process a parsed Meta-format webhook payload for one instance. Unlike the
 * whatsapp-business sibling there is NO phone_number_id → instance
 * resolution: the instance is already fixed by the route path.
 */
export async function handleAscWebhook(
  plugin: AscPlugin,
  instanceId: string,
  payload: MetaWebhookPayload,
): Promise<void> {
  const logger = plugin.getLogger();

  const state = plugin.getInstanceState(instanceId);
  if (!state) {
    logger.warn('[asc] webhook for unknown/disconnected instance — dropping', { instanceId });
    return;
  }

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') {
        logger.debug('[asc] ignoring unsupported webhook field', { instanceId, field: change.field });
        continue;
      }
      await processMessagesChange(plugin, instanceId, change.value as Record<string, unknown>, state.dedupeCache);
    }
  }
}

type WebhookLogger = ReturnType<AscPlugin['getLogger']>;
type InboundDedupeCache = Parameters<AscPlugin['handleInboundMessage']>[3];

/** Process one `field: 'messages'` change value — inbound messages + statuses. */
async function processMessagesChange(
  plugin: AscPlugin,
  instanceId: string,
  value: Record<string, unknown>,
  dedupeCache: InboundDedupeCache,
): Promise<void> {
  const logger = plugin.getLogger();
  const messages = Array.isArray(value.messages) ? value.messages : [];
  const statuses = Array.isArray(value.statuses) ? value.statuses : [];
  const contacts = Array.isArray(value.contacts)
    ? (value.contacts as Array<{ profile?: { name?: string }; wa_id?: string }>)
    : undefined;

  await emitInboundMessages(plugin, instanceId, messages, contacts, dedupeCache, logger);
  await emitStatusUpdates(plugin, instanceId, statuses, logger);
}

async function emitInboundMessages(
  plugin: AscPlugin,
  instanceId: string,
  messages: unknown[],
  contacts: Parameters<AscPlugin['handleInboundMessage']>[2],
  dedupeCache: InboundDedupeCache,
  logger: WebhookLogger,
): Promise<void> {
  for (const msg of messages) {
    try {
      // Already validated by MetaWebhookPayloadSchema — re-narrow the
      // discriminators before the cast, mirroring whatsapp-business.
      const m = msg as { id?: string; type?: string };
      if (!m.id || !m.type) continue;
      await plugin.handleInboundMessage(
        instanceId,
        msg as Parameters<AscPlugin['handleInboundMessage']>[1],
        contacts,
        dedupeCache,
      );
    } catch (err) {
      logger.warn('[asc] failed to emit inbound message', { instanceId, err: String(err) });
    }
  }
}

async function emitStatusUpdates(
  plugin: AscPlugin,
  instanceId: string,
  statuses: unknown[],
  logger: WebhookLogger,
): Promise<void> {
  for (const status of statuses) {
    try {
      const s = status as { id?: string; status?: string };
      if (!s.id || !s.status) continue;
      await plugin.handleStatusUpdate(instanceId, status as Parameters<AscPlugin['handleStatusUpdate']>[1]);
    } catch (err) {
      logger.warn('[asc] failed to emit status event', { instanceId, err: String(err) });
    }
  }
}
