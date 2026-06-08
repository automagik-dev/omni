/**
 * Gupshup webhook handler
 *
 * Parses inbound Gupshup native format payloads and emits Omni events.
 *
 * Wire format: Content-Type is application/x-www-form-urlencoded but the body
 * is raw JSON — JSON.parse(await request.text()) is the correct parse strategy.
 *
 * Message-bearing event_types (`user_input`, `async_response`,
 * `click_to_chat_advertise`) are dispatched to processInboundMessage. Known
 * non-message events (status, billing, opt-in/out, etc.) are acknowledged with
 * 200 and discarded at DEBUG. Unknown event_types that pass schema validation
 * fail-open (processed + WARN) so Gupshup format drift surfaces in logs
 * instead of silently dropping messages (see incident 2026-04-22 #503).
 *
 * Webhook verification: query param `?token=X` is compared against instance
 * `webhookVerifyToken`. If not set, skip token check.
 */

import { createInboundDedupeCache, sanitizeMessage } from '@omni/channel-sdk';
import type { DedupeCache } from '@omni/channel-sdk';
import { z } from 'zod';

import { type GupshupWebhookHandled, recordGupshupWebhookReceived, seenEventTypes } from '../observability';
import type { GupshupPlugin } from '../plugin';
import type { GupshupNativeInboundWebhook, GupshupNativeMessageObj } from '../types';

// ─────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────

const GupshupNativeWebhookSchema = z
  .object({
    sender: z.string().max(32),
    botname: z.string().max(128),
    channel: z.string().max(32),
    isGroup: z.boolean().optional(),
    destination: z.union([z.string().max(32), z.number()]),
    event_type: z.string().max(64),
    message: z.string().max(4096).optional(),
    postbackText: z.string().max(4096).nullable().optional(),
    senderobj: z.object({
      channelid: z.string().max(32),
      display: z.string().max(256).optional(),
      channeltype: z.string().max(32).optional(),
    }),
    contextobj: z
      .object({
        senderName: z.string().max(256).optional(),
        botname: z.string().max(128).optional(),
        channeltype: z.string().max(32).optional(),
        contexttype: z.string().max(32).optional(),
        contextid: z.string().max(32).optional(),
        preventReply: z.boolean().optional(),
        cc: z.string().max(8).optional(),
        dc: z.string().max(32).optional(),
      })
      .passthrough()
      .optional(),
    messageobj: z
      .object({
        id: z.string().max(512), // wamids are base64, can be long
        type: z.string().max(32),
        from: z.string().max(32),
        timestamp: z.number().int().positive(),
        text: z.string().max(65536).optional(), // WhatsApp max message length
        url: z.string().max(2048).optional(),
        contentType: z.string().max(128).optional(),
        fileName: z.string().max(256).optional(),
        mediaId: z.string().max(128).optional(),
        latitude: z.string().max(32).optional(),
        longitude: z.string().max(32).optional(),
        address: z.string().max(512).optional(),
        name: z.string().max(256).optional(),
        replyContext: z
          .object({
            id: z.string().max(512),
            internalId: z.string().max(128).optional(),
          })
          .optional(),
        raw: z
          .object({
            payload: z.record(z.unknown()).optional(),
            sender: z
              .object({ name: z.string().max(256).optional() })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    messageHeader: z
      .object({
        event_type: z.string().max(64).optional(),
        nsTraceId: z.string().max(128).optional(),
        project_id: z.string().max(64).optional(),
      })
      .passthrough()
      .optional(),
    source: z.string().max(64).optional(),
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────
// Simplified payload (HV-Entry-Flow "Payload Data Clean-up", 2026-06)
// The Entry-Flow may send a slimmed-down shape instead of the native one:
//   { sender: { id, name }, message: { text, timestamp }, event: { project_id } }
// We accept it and normalize to the native shape so the rest of the handler —
// and every downstream consumer — stays unchanged. Old + new both work.
// ─────────────────────────────────────────────────────────────

export const GupshupSimplifiedWebhookSchema = z
  .object({
    sender: z.object({
      id: z.string().min(1).max(32),
      name: z.string().max(256).optional(),
    }),
    message: z.object({
      id: z.string().max(512).optional(),
      text: z.string().max(65536).optional(),
      timestamp: z.union([z.string(), z.number()]).optional(),
    }),
    event: z
      .object({ project_id: z.string().max(64).optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** messageobj.timestamp is unix *seconds* (int); accept seconds or millis from the source. */
function toUnixSeconds(ts: string | number | undefined): number {
  const n = typeof ts === 'number' ? ts : Number.parseInt(String(ts ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return Math.floor(Date.now() / 1000);
  // Math.floor guarantees an integer even when a float timestamp is passed in.
  return Math.floor(n > 1e12 ? n / 1000 : n);
}

/** Map the simplified Entry-Flow payload onto the native inbound webhook shape. */
export function normalizeSimplifiedWebhook(
  p: z.infer<typeof GupshupSimplifiedWebhookSchema>,
): GupshupNativeInboundWebhook {
  const phone = p.sender.id;
  const text = p.message?.text;
  const tsSeconds = toUnixSeconds(p.message?.timestamp);
  // No native message id in the simplified payload — prefer one if present, else
  // synthesize a stable id (phone+ts+len) so retries of the same message still
  // dedupe. Distinct messages within the same second would collide (rare).
  const id = p.message?.id ?? `gs-simplified-${phone}-${tsSeconds}-${text ? text.length : 0}`;
  return {
    source: 'gupshup-hv-entry-flow-simplified',
    sender: phone,
    channel: 'whatsapp',
    destination: '',
    botname: '',
    event_type: 'user_input',
    message: text,
    postbackText: null,
    senderobj: { channelid: phone, display: p.sender.name, channeltype: 'whatsapp' },
    messageobj: {
      id,
      type: 'text',
      from: phone,
      timestamp: tsSeconds,
      text,
      raw: { sender: { name: p.sender.name } },
    },
    messageHeader: { event_type: 'user_input', project_id: p.event?.project_id },
  };
}

/** Try the simplified schema; return a normalized native webhook, or null if it doesn't match. */
export function parseSimplifiedWebhook(parsed: unknown): GupshupNativeInboundWebhook | null {
  const r = GupshupSimplifiedWebhookSchema.safeParse(parsed);
  return r.success ? normalizeSimplifiedWebhook(r.data) : null;
}

/**
 * Resolve the parsed body into a native inbound webhook: native schema first,
 * then the simplified HV-Entry-Flow fallback. Returns null when neither matches
 * (already logged + drop metric recorded — the caller just acks with 200).
 */
function resolveInboundWebhook(
  parsed: unknown,
  instanceId: string,
  logger: import('@omni/core').Logger,
): GupshupNativeInboundWebhook | null {
  const result = GupshupNativeWebhookSchema.safeParse(parsed);
  if (result.success) {
    return result.data as unknown as GupshupNativeInboundWebhook;
  }
  const simplified = parseSimplifiedWebhook(parsed);
  if (simplified) {
    logger.info('[gupshup] simplified Entry-Flow payload normalized', {
      instanceId,
      sender: simplified.sender,
    });
    return simplified;
  }
  logger.warn('[gupshup] webhook payload unrecognized shape (acking anyway)', {
    instanceId,
    errors: result.error.issues,
    parsed,
  });
  // Fail-open: always ack so Gupshup doesn't retry.
  const parsedEventType =
    parsed !== null && typeof parsed === 'object' && 'event_type' in parsed
      ? String((parsed as { event_type: unknown }).event_type ?? 'unparsed')
      : 'unparsed';
  recordGupshupWebhookReceived(logger, {
    instanceId,
    event_type: parsedEventType,
    handled: 'dropped_unrecognized_shape',
  });
  return null;
}

// Download guard for media (100MB limit)
const _downloadGuard = createInboundDedupeCache;

// Known event_type values that carry a user message in messageobj.
// Unknown values still fall through to processInboundMessage (schema validation
// is the real gate) but are logged at WARN so format drift is visible.
const KNOWN_MESSAGE_EVENT_TYPES = new Set<string>([
  'user_input', // legacy — pre-2026-04-22 format
  'async_response', // current — post-2026-04-22 17:58 BRT cutover
  'click_to_chat_advertise', // ad click → message from FB/IG ad
]);

// Known event_type values that are NOT messages (status/billing/etc.)
const KNOWN_NON_MESSAGE_EVENT_TYPES = new Set<string>([
  'message_event', // delivery/read receipts
  'billing_event',
  'opt_in',
  'opt_out',
  'template_event',
  'system_event',
  'account_event',
]);

// ─────────────────────────────────────────────────────────────
// Payload extraction — handles multiple Gupshup envelope formats
// ─────────────────────────────────────────────────────────────

const GUPSHUP_PAYLOAD_PREFIX = '{"gupshupPayload":"';
const GUPSHUP_PAYLOAD_SUFFIX = '"}';

/**
 * Gupshup Request Builder sends the payload as an unescaped JSON string inside
 * a wrapper object: {"gupshupPayload":"{...unescaped json...}"}
 * This makes the outer body invalid JSON. Detect and strip the wrapper by
 * string matching instead of JSON.parse.
 */
function extractGupshupPayloadWrapper(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith(GUPSHUP_PAYLOAD_PREFIX)) return null;
  if (!trimmed.endsWith(GUPSHUP_PAYLOAD_SUFFIX)) return null;
  return trimmed.slice(GUPSHUP_PAYLOAD_PREFIX.length, -GUPSHUP_PAYLOAD_SUFFIX.length);
}

function extractPayload(body: string, instanceId: string, logger: import('@omni/core').Logger): unknown {
  // Handle Gupshup Request Builder wrapper BEFORE JSON.parse — the body is invalid JSON
  // because the gupshupPayload value contains unescaped quotes.
  const unwrapped = extractGupshupPayloadWrapper(body);
  if (unwrapped !== null) {
    logger.debug('[gupshup] unwrapping gupshupPayload envelope (unescaped)', { instanceId });
    try {
      return JSON.parse(unwrapped);
    } catch {
      logger.warn('[gupshup] gupshupPayload inner value is not valid JSON', {
        instanceId,
        bodyPreview: unwrapped.slice(0, 200),
      });
      return null;
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    logger.warn('[gupshup] body is not valid JSON', { instanceId, bodyPreview: body.slice(0, 200) });
    return null;
  }

  // Double-encoded: entire payload is a JSON string
  if (typeof parsed === 'string') {
    logger.debug('[gupshup] unwrapping double-encoded webhook body', { instanceId });
    try {
      parsed = JSON.parse(parsed);
    } catch {
      logger.warn('[gupshup] double-encoded body is not valid JSON', { instanceId });
      return null;
    }
  }

  // Request Builder wrapper with properly escaped value: { gupshupPayload: "<json string>" }
  if (parsed !== null && typeof parsed === 'object' && 'gupshupPayload' in (parsed as object)) {
    const wrapper = parsed as Record<string, unknown>;
    logger.debug('[gupshup] unwrapping gupshupPayload envelope (escaped)', { instanceId });
    const inner = wrapper.gupshupPayload;
    if (typeof inner === 'string') {
      try {
        return JSON.parse(inner);
      } catch {
        logger.warn('[gupshup] gupshupPayload value is not valid JSON', { instanceId });
        return null;
      }
    }
    return inner;
  }

  return parsed;
}

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────

/**
 * Handle an inbound Gupshup webhook POST request.
 */
export async function handleGupshupWebhook(
  request: Request,
  plugin: GupshupPlugin,
  instanceId: string,
  webhookVerifyToken: string | undefined,
  dedupeCache: DedupeCache,
): Promise<Response> {
  const logger = plugin.getLogger();
  // Token verification — only if configured
  if (webhookVerifyToken) {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (token !== webhookVerifyToken) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    // Always ack — even if we can't read the body
    return new Response('OK', { status: 200 });
  }

  // Reject oversized payloads (>256KB) — protects against memory exhaustion
  if (body.length > 256 * 1024) {
    logger.warn('[gupshup] oversized webhook body rejected', { instanceId, size: body.length });
    return new Response('OK', { status: 200 });
  }

  logger.info('[gupshup] raw webhook received', {
    instanceId,
    contentType: request.headers.get('content-type'),
    body,
  });

  // Extract the actual Gupshup payload — handles multiple envelope formats:
  // 1. Raw JSON object (native webhook)
  // 2. Double-encoded: JSON string wrapping a JSON object
  // 3. Request Builder wrapper: { gupshupPayload: "<json string>" }
  const parsed = extractPayload(body, instanceId, logger);

  if (!parsed) {
    // Can't parse at all — ack and move on, we already logged the raw body
    recordGupshupWebhookReceived(logger, {
      instanceId,
      event_type: 'unparsed',
      handled: 'dropped_unrecognized_shape',
    });
    return new Response('OK', { status: 200 });
  }

  // Native schema first, then the simplified HV-Entry-Flow fallback.
  // resolveInboundWebhook logs + records the drop metric when neither matches.
  const webhook = resolveInboundWebhook(parsed, instanceId, logger);
  if (!webhook) {
    return new Response('OK', { status: 200 });
  }

  // First-seen WARN — fires once per process per event_type value. Would have
  // caught the 2026-04-22 async_response cutover at webhook #1.
  if (seenEventTypes.markIfFirst(webhook.event_type)) {
    logger.warn('[gupshup] first time seeing this event_type', {
      instanceId,
      event_type: webhook.event_type,
      knownMessage: KNOWN_MESSAGE_EVENT_TYPES.has(webhook.event_type),
      knownNonMessage: KNOWN_NON_MESSAGE_EVENT_TYPES.has(webhook.event_type),
    });
  }

  if (KNOWN_NON_MESSAGE_EVENT_TYPES.has(webhook.event_type)) {
    logger.debug('[gupshup] known non-message event ignored', {
      instanceId,
      event_type: webhook.event_type,
    });
    recordGupshupWebhookReceived(logger, {
      instanceId,
      event_type: webhook.event_type,
      handled: 'dropped_known_non_message',
    });
    return new Response('OK', { status: 200 });
  }

  const knownMessageEvent = KNOWN_MESSAGE_EVENT_TYPES.has(webhook.event_type);
  if (!knownMessageEvent) {
    // Unknown event_type that passed schema validation (has valid messageobj).
    // Fail-open: process it + WARN so operators notice format drift early.
    logger.warn('[gupshup] unknown event_type with valid messageobj — processing anyway', {
      instanceId,
      event_type: webhook.event_type,
      messageHeaderEventType: webhook.messageHeader?.event_type,
      messageType: webhook.messageobj?.type,
      sender: webhook.sender,
    });
  }

  const processed = await processInboundMessage(plugin, instanceId, webhook, dedupeCache, {
    khalSessionId: request.headers.get('x-khal-session-id')?.trim() || undefined,
  });

  // Unknown event_type wins the label — the alerting signal is format drift
  // detection, independent of whether the downstream extraction succeeded.
  let handled: GupshupWebhookHandled;
  if (!knownMessageEvent) {
    handled = 'dropped_unknown_fail_open';
  } else if (!processed) {
    handled = 'dropped_empty_content';
  } else {
    handled = 'processed';
  }

  recordGupshupWebhookReceived(logger, {
    instanceId,
    event_type: webhook.event_type,
    handled,
  });

  return new Response('OK', { status: 200 });
}

// ─────────────────────────────────────────────────────────────
// Inbound message
// ─────────────────────────────────────────────────────────────

async function processInboundMessage(
  plugin: GupshupPlugin,
  instanceId: string,
  webhook: GupshupNativeInboundWebhook,
  dedupeCache: DedupeCache,
  options: { khalSessionId?: string } = {},
): Promise<boolean> {
  const msg = webhook.messageobj;
  const from = webhook.sender;

  // Dedupe by sender phone + message ID
  const dedupeKey = `${from.trim()}:${msg.id}`;
  if (dedupeCache.isDuplicate(instanceId, dedupeKey, 'gupshup', plugin.getLogger() as import('@omni/core').Logger)) {
    return false;
  }

  const content = extractContent(msg);
  if (!content) return false;

  // Sanitize text
  if (content.text) {
    const sanitized = sanitizeMessage(content.text, plugin.getLogger() as import('@omni/core').Logger, {
      instanceId,
      messageId: msg.id,
    });
    if (!sanitized.ok) return false;
    content.text = sanitized.text;
  }

  const platformTimestamp = msg.timestamp * 1000;
  const replyTo = msg.replyContext?.id;

  // Normalize sender name to standard pushName key so message-persistence
  // and agent-dispatcher can find it without knowing Gupshup-specific fields.
  const senderName =
    webhook.senderobj?.display ??
    webhook.contextobj?.senderName ??
    (webhook.messageobj?.raw?.sender as { name?: string } | undefined)?.name;
  const threadId = webhook.contextobj?.contextid;
  const khalSessionHeaders = options.khalSessionId ? { 'x-khal-session-id': options.khalSessionId } : undefined;

  await plugin.handleMessageReceived({
    instanceId,
    externalId: msg.id,
    chatId: from,
    from,
    content,
    rawPayload: {
      ...webhook,
      pushName: senderName,
      ...(threadId ? { threadId } : {}),
      ...(options.khalSessionId ? { khalSessionId: options.khalSessionId } : {}),
      ...(khalSessionHeaders ? { headers: khalSessionHeaders } : {}),
    } as unknown as Record<string, unknown>,
    platformTimestamp,
    replyTo,
  });
  return true;
}

// ─────────────────────────────────────────────────────────────
// Content extraction
// ─────────────────────────────────────────────────────────────

interface ExtractedContent {
  type: string;
  text?: string;
  mediaUrl?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
}

const MEDIA_TYPES: Record<string, string> = {
  audio: 'audio',
  image: 'image',
  video: 'video',
  sticker: 'sticker',
  file: 'document', // Gupshup 'file' = WA 'document'
};

function extractLocationContent(msg: GupshupNativeMessageObj): ExtractedContent | null {
  if (!msg.latitude || !msg.longitude) return null;
  const lat = Number.parseFloat(msg.latitude);
  const lng = Number.parseFloat(msg.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  const parts = [msg.name, msg.address].filter(Boolean).join(', ');
  return {
    type: 'location',
    text: parts || `${lat},${lng}`,
    location: { latitude: lat, longitude: lng, name: msg.name, address: msg.address },
  };
}

type ContactPayload = {
  name?: { formatted_name?: string; first_name?: string; last_name?: string };
  phones?: Array<{ phone: string }>;
};

function extractContactContent(msg: GupshupNativeMessageObj): ExtractedContent {
  const raw = msg.raw?.payload as { contacts?: ContactPayload[] } | undefined;
  const first = raw?.contacts?.[0];
  if (!first) return { type: 'text', text: 'Contact shared' };
  const name =
    first.name?.formatted_name ??
    [first.name?.first_name, first.name?.last_name].filter(Boolean).join(' ') ??
    'Unknown';
  const phone = first.phones?.[0]?.phone ?? '';
  return { type: 'text', text: `Contact: ${name}: ${phone}` };
}

function extractContent(msg: GupshupNativeMessageObj): ExtractedContent | null {
  if (msg.type === 'text') return msg.text ? { type: 'text', text: msg.text } : null;
  if (msg.type === 'location') return extractLocationContent(msg);
  if (msg.type === 'contacts') return extractContactContent(msg);

  const omniType = MEDIA_TYPES[msg.type];
  if (omniType) {
    if (!msg.url) return null;
    return {
      type: omniType,
      mediaUrl: msg.url,
      mimeType: msg.contentType,
      filename: msg.type === 'file' ? msg.fileName : undefined,
    };
  }

  return null;
}
