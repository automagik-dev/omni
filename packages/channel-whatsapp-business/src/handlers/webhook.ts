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
  type MetaInboundMessage,
  MetaTemplateStatusUpdateSchema,
  type MetaWebhookPayload,
  MetaWebhookPayloadSchema,
  type MetaWebhookStatusEntry,
} from '@omni/core/schemas';

import type { WhatsAppBusinessPlugin } from '../plugin';
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
  plugin: WhatsAppBusinessPlugin,
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
    logger.warn('[whatsapp-business] failed to read webhook body', { err: String(err) });
    // Meta retries on 5xx but not 2xx — we already failed to read so reply 200
    // to suppress retries that would just fail the same way.
    return new Response('OK', { status: 200 });
  }

  if (body.length > MAX_BODY_BYTES) {
    logger.warn('[whatsapp-business] oversized webhook body rejected', { size: body.length });
    return new Response('OK', { status: 200 });
  }

  // 2. Verify the X-Hub-Signature-256 HMAC. Header lookup is
  // case-insensitive per spec — Request.headers handles that for us.
  const signature = request.headers.get('x-hub-signature-256');
  const valid = await verifyMetaSignature(body, signature, appSecret);
  if (!valid) {
    logger.warn('[whatsapp-business] invalid X-Hub-Signature-256 — rejecting webhook', {
      hasHeader: signature !== null,
    });
    return new Response('Unauthorized', { status: 401 });
  }

  // 3. Parse + validate the payload envelope.
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body);
  } catch {
    logger.warn('[whatsapp-business] webhook body is not valid JSON');
    return new Response('OK', { status: 200 });
  }

  const validated = MetaWebhookPayloadSchema.safeParse(parsedJson);
  if (!validated.success) {
    logger.warn('[whatsapp-business] webhook payload failed schema validation', {
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

async function processValidatedPayload(plugin: WhatsAppBusinessPlugin, payload: MetaWebhookPayload): Promise<void> {
  const logger = plugin.getLogger();

  for (const entry of payload.entry) {
    // `entry.id` is the WABA id for WABA-scoped fields (alerts, account_update,
    // phone_number_quality_update, phone_number_name_update). Some fields use
    // it for the App id instead — we only consume it as a WABA hint and the
    // alert resolver tolerates a no-match by short-circuiting.
    for (const change of entry.changes) {
      await processChange(plugin, change, entry.id, logger);
    }
  }
}

/** Meta webhook fields that are scoped to a WABA (no phone_number_id). */
const CHANNEL_ALERT_FIELDS = new Set([
  'account_alerts',
  'account_update',
  'phone_number_quality_update',
  'phone_number_name_update',
]);

type MetaWebhookChange = MetaWebhookPayload['entry'][number]['changes'][number];
type WebhookLogger = ReturnType<WhatsAppBusinessPlugin['getLogger']>;
type InboundContacts = Parameters<WhatsAppBusinessPlugin['handleInboundMessage']>[2];
type InboundDedupeCache = Parameters<WhatsAppBusinessPlugin['handleInboundMessage']>[3];

async function processChange(
  plugin: WhatsAppBusinessPlugin,
  change: MetaWebhookChange,
  entryId: string,
  logger: WebhookLogger,
): Promise<void> {
  // ─── WABA-scoped alerts (no phone_number_id) ───
  if (CHANNEL_ALERT_FIELDS.has(change.field)) {
    await processChannelAlert(plugin, change, entryId, logger);
    return;
  }

  if (change.field === 'message_template_status_update') {
    await processTemplateStatusUpdate(plugin, change, logger);
    return;
  }

  if (change.field !== 'messages') {
    logger.debug('[whatsapp-business] ignoring unsupported webhook field', { field: change.field });
    return;
  }

  await processMessagesChange(plugin, change, logger);
}

async function processChannelAlert(
  plugin: WhatsAppBusinessPlugin,
  change: MetaWebhookChange,
  entryId: string,
  logger: WebhookLogger,
): Promise<void> {
  const value = (change.value ?? {}) as Record<string, unknown>;
  // entry.id IS the WABA id for these fields. Resolve all instances under
  // that WABA — multi-instance customers get one event per instance so
  // dashboards scoped per-instance still fire.
  const matches = plugin.findInstancesByWabaId(entryId);
  if (matches.length === 0) {
    logger.debug('[whatsapp-business] channel alert arrived with no matching WABA', {
      field: change.field,
      wabaId: entryId,
    });
    return;
  }
  const alertType = change.field as Parameters<typeof plugin.handleChannelAlert>[1];
  await Promise.all(
    matches.map(([instanceId]) =>
      plugin.handleChannelAlert(instanceId, alertType, value).catch((err) => {
        logger.warn('[whatsapp-business] failed to emit channel.alert', {
          instanceId,
          field: change.field,
          err: String(err),
        });
      }),
    ),
  );
}

async function processTemplateStatusUpdate(
  plugin: WhatsAppBusinessPlugin,
  change: MetaWebhookChange,
  logger: WebhookLogger,
): Promise<void> {
  const parsed = MetaTemplateStatusUpdateSchema.safeParse(change.value);
  if (!parsed.success) {
    logger.warn('[whatsapp-business] template_status_update payload invalid', {
      issues: parsed.error.issues.slice(0, 3),
    });
    return;
  }
  // Template status updates don't carry phone_number_id — they're scoped
  // to a WABA. The templates service (`templates.ts::handleTemplateStatusUpdate`)
  // resolves the correct local row + instance scope by `(metaTemplateId, wabaId)`
  // and updates the DB before emitting. The webhook handler here delegates
  // to the templates service rather than fanning out to all instances.
  //
  // Lazy import keeps the webhook handler free of a hard dep on the db layer
  // (which the @omni/db workspace dep already provides at runtime).
  const { handleTemplateStatusUpdate } = await import('../templates');
  const { getDb } = await import('@omni/db');
  try {
    await handleTemplateStatusUpdate(getDb(), parsed.data, plugin);
  } catch (err) {
    logger.warn('[whatsapp-business] failed to handle template status update', {
      metaTemplateId: parsed.data.message_template_id,
      err: String(err),
    });
  }
}

async function processMessagesChange(
  plugin: WhatsAppBusinessPlugin,
  change: MetaWebhookChange,
  logger: WebhookLogger,
): Promise<void> {
  // `messages` field — value matches MetaWebhookValueSchema.
  const value = change.value as Record<string, unknown>;
  const metadata = value.metadata as { phone_number_id?: string } | undefined;
  const phoneNumberId = metadata?.phone_number_id;

  if (!phoneNumberId) {
    logger.warn('[whatsapp-business] webhook change missing metadata.phone_number_id');
    return;
  }

  const resolved = plugin.findInstanceByPhoneNumberId(phoneNumberId);
  if (!resolved) {
    // Unknown phone_number_id — log + ack 200 (NOT 4xx). Meta will disable
    // the app after repeated 4xx, so silent drop is correct here.
    logger.warn('[whatsapp-business] no instance for phone_number_id — dropping change', {
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

  await emitInboundMessages(plugin, instanceId, messages, contacts, state.dedupeCache, logger);
  await emitStatusUpdates(plugin, instanceId, statuses, logger);
}

// --- Inbound messages ---
async function emitInboundMessages(
  plugin: WhatsAppBusinessPlugin,
  instanceId: string,
  messages: unknown[],
  contacts: InboundContacts,
  dedupeCache: InboundDedupeCache,
  logger: WebhookLogger,
): Promise<void> {
  for (const msg of messages) {
    try {
      // Already passed MetaWebhookPayloadSchema (which embeds the
      // discriminated MetaInboundMessage union), but we re-narrow via a
      // runtime check for the discriminator before casting.
      const m = msg as { id?: string; type?: string };
      if (!m.id || !m.type) continue;
      await plugin.handleInboundMessage(instanceId, msg as MetaInboundMessage, contacts, dedupeCache);
    } catch (err) {
      logger.warn('[whatsapp-business] failed to emit inbound message', {
        instanceId,
        err: String(err),
      });
    }
  }
}

// --- Status updates (sent/delivered/read/failed) ---
async function emitStatusUpdates(
  plugin: WhatsAppBusinessPlugin,
  instanceId: string,
  statuses: unknown[],
  logger: WebhookLogger,
): Promise<void> {
  for (const status of statuses) {
    try {
      const s = status as { id?: string; status?: string };
      if (!s.id || !s.status) continue;
      await plugin.handleStatusUpdate(instanceId, status as MetaWebhookStatusEntry);
    } catch (err) {
      logger.warn('[whatsapp-business] failed to emit status event', {
        instanceId,
        err: String(err),
      });
    }
  }
}
