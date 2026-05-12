/**
 * WhatsApp Cloud (Meta) webhook handler.
 *
 * Implements the two halves of the Meta webhook contract:
 *
 *  1. **GET /webhook** — Meta sends a challenge with `hub.mode=subscribe`,
 *     `hub.verify_token=<token>`, `hub.challenge=<nonce>`. We respond with
 *     the challenge nonce verbatim (plain text 200) iff the token matches
 *     our `META_VERIFY_TOKEN` env var.
 *
 *  2. **POST /webhook** — Meta delivers events signed with HMAC-SHA256 over
 *     the raw body in `X-Hub-Signature-256`. We:
 *       a. read the raw body (single-use stream — must precede JSON parse).
 *       b. verify the signature with `META_APP_SECRET`. On failure → 401.
 *       c. parse + validate JSON via `MetaWebhookPayloadSchema`.
 *       d. walk `entry[].changes[]`:
 *           - `field === 'messages'`: resolve instance by
 *             `value.metadata.phone_number_id` and emit
 *             `message.received` (with `wamid` dedupe) + `message.*`
 *             status events.
 *           - `field === 'message_template_status_update'`: emit
 *             `template.status_changed`.
 *       e. ALWAYS respond 200/204 — Meta de-activates the app after
 *          repeated non-2xx. Unknown phone_number_ids are logged + 200, NOT
 *          4xx'd.
 *
 * Reference: docs/architecture/plugin-system.md + TalkFlow
 * `meta_webhook_routes.py` (Python original).
 */

import {
  MetaTemplateStatusUpdateSchema,
  MetaWebhookPayloadSchema,
  type MetaInboundMessage,
  type MetaWebhookPayload,
  type MetaWebhookStatusEntry,
} from '@omni/core/schemas';

import type { WhatsAppCloudPlugin } from '../plugin';
import {
  emitMessageReceivedFromMeta,
  emitStatusEvent,
  emitTemplateStatusChanged,
} from '../plugin-inbound-helpers';
import { verifyMetaSignature } from '../utils/signature';

// Meta caps webhook bodies at 1 MB. We accept up to 2 MB to be safe.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Handle the GET verification challenge that Meta sends when an app
 * subscribes/re-validates the webhook URL.
 */
export function handleVerifyChallenge(request: Request, verifyToken: string): Response {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (mode === 'subscribe' && verifyToken && token === verifyToken && challenge !== null) {
    return new Response(challenge, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response('Verification failed', { status: 403 });
}

/**
 * Main orchestrator. Dispatches GET → `handleVerifyChallenge`, otherwise
 * processes a signed POST.
 */
export async function handleMetaWebhook(
  request: Request,
  plugin: WhatsAppCloudPlugin,
  appSecret: string,
  verifyToken: string,
): Promise<Response> {
  if (request.method === 'GET') {
    return handleVerifyChallenge(request, verifyToken);
  }

  const logger = plugin.getLogger();

  // 1. Read the raw body exactly once. HMAC must be computed over the bytes
  // Meta sent — any JSON.parse → JSON.stringify round-trip would change
  // whitespace/key order and break the digest.
  let body: string;
  try {
    body = await request.text();
  } catch (err) {
    logger.warn('[whatsapp-cloud] failed to read webhook body', { err: String(err) });
    // Meta retries on 5xx but not 2xx — we already failed to read so reply 200
    // to suppress retries that would just fail the same way.
    return new Response('OK', { status: 200 });
  }

  if (body.length > MAX_BODY_BYTES) {
    logger.warn('[whatsapp-cloud] oversized webhook body rejected', { size: body.length });
    return new Response('OK', { status: 200 });
  }

  // 2. Verify the X-Hub-Signature-256 HMAC. Header lookup is
  // case-insensitive per spec — Request.headers handles that for us.
  const signature = request.headers.get('x-hub-signature-256');
  const valid = await verifyMetaSignature(body, signature, appSecret);
  if (!valid) {
    logger.warn('[whatsapp-cloud] invalid X-Hub-Signature-256 — rejecting webhook', {
      hasHeader: signature !== null,
    });
    return new Response('Unauthorized', { status: 401 });
  }

  // 3. Parse + validate the payload envelope.
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    logger.warn('[whatsapp-cloud] webhook body is not valid JSON');
    return new Response('OK', { status: 200 });
  }

  const validated = MetaWebhookPayloadSchema.safeParse(parsedJson);
  if (!validated.success) {
    logger.warn('[whatsapp-cloud] webhook payload failed schema validation', {
      issues: validated.error.issues.slice(0, 5),
    });
    return new Response('OK', { status: 200 });
  }

  await processValidatedPayload(plugin, validated.data);

  // Meta requires a fast 2xx. 200 with empty body is the canonical ack.
  return new Response('OK', { status: 200 });
}

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────

async function processValidatedPayload(
  plugin: WhatsAppCloudPlugin,
  payload: MetaWebhookPayload,
): Promise<void> {
  const logger = plugin.getLogger();

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      await processChange(plugin, change, logger);
    }
  }
}

async function processChange(
  plugin: WhatsAppCloudPlugin,
  change: MetaWebhookPayload['entry'][number]['changes'][number],
  logger: ReturnType<WhatsAppCloudPlugin['getLogger']>,
): Promise<void> {
  if (change.field === 'message_template_status_update') {
    const parsed = MetaTemplateStatusUpdateSchema.safeParse(change.value);
    if (!parsed.success) {
      logger.warn('[whatsapp-cloud] template_status_update payload invalid', {
        issues: parsed.error.issues.slice(0, 3),
      });
      return;
    }
    // Template status updates don't carry phone_number_id — they're scoped
    // to a WABA, not a phone. We emit per-instance for all instances that
    // own this template's WABA. Without a templateId lookup we fan out to
    // every connected instance and let consumers filter by metaTemplateId.
    const instanceIds = plugin.getConnectedInstanceIds();
    if (instanceIds.length === 0) {
      logger.debug('[whatsapp-cloud] template status update arrived with no connected instances', {
        metaTemplateId: parsed.data.message_template_id,
      });
      return;
    }
    await Promise.all(
      instanceIds.map((instanceId) =>
        emitTemplateStatusChanged(plugin, instanceId, parsed.data).catch((err) => {
          logger.warn('[whatsapp-cloud] failed to emit template.status_changed', {
            instanceId,
            err: String(err),
          });
        }),
      ),
    );
    return;
  }

  if (change.field !== 'messages') {
    logger.debug('[whatsapp-cloud] ignoring unsupported webhook field', { field: change.field });
    return;
  }

  // `messages` field — value matches MetaWebhookValueSchema.
  const value = change.value as Record<string, unknown>;
  const metadata = value.metadata as { phone_number_id?: string } | undefined;
  const phoneNumberId = metadata?.phone_number_id;

  if (!phoneNumberId) {
    logger.warn('[whatsapp-cloud] webhook change missing metadata.phone_number_id');
    return;
  }

  const resolved = plugin.findInstanceByPhoneNumberId(phoneNumberId);
  if (!resolved) {
    // Unknown phone_number_id — log + ack 200 (NOT 4xx). Meta will disable
    // the app after repeated 4xx, so silent drop is correct here.
    logger.warn('[whatsapp-cloud] no instance for phone_number_id — dropping change', {
      phoneNumberId,
    });
    return;
  }

  const [instanceId, state] = resolved;

  const messages = Array.isArray(value.messages) ? (value.messages as unknown[]) : [];
  const statuses = Array.isArray(value.statuses) ? (value.statuses as unknown[]) : [];
  const contacts = Array.isArray(value.contacts)
    ? (value.contacts as Array<{ profile?: { name?: string }; wa_id?: string }>)
    : undefined;

  // --- Inbound messages ---
  for (const msg of messages) {
    try {
      // Already passed MetaWebhookPayloadSchema (which embeds the
      // discriminated MetaInboundMessage union), but we re-narrow via a
      // runtime check for the discriminator before casting.
      const m = msg as { id?: string; type?: string };
      if (!m.id || !m.type) continue;
      await emitMessageReceivedFromMeta(
        plugin,
        instanceId,
        msg as MetaInboundMessage,
        contacts,
        state.dedupeCache,
      );
    } catch (err) {
      logger.warn('[whatsapp-cloud] failed to emit inbound message', {
        instanceId,
        err: String(err),
      });
    }
  }

  // --- Status updates (sent/delivered/read/failed) ---
  for (const status of statuses) {
    try {
      const s = status as { id?: string; status?: string };
      if (!s.id || !s.status) continue;
      await emitStatusEvent(plugin, instanceId, status as MetaWebhookStatusEntry);
    } catch (err) {
      logger.warn('[whatsapp-cloud] failed to emit status event', {
        instanceId,
        err: String(err),
      });
    }
  }
}
