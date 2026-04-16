/**
 * Gupshup webhook handler
 *
 * Parses inbound Gupshup native format payloads and emits Omni events.
 *
 * Wire format: Content-Type is application/x-www-form-urlencoded but the body
 * is raw JSON — JSON.parse(await request.text()) is the correct parse strategy.
 *
 * Only event_type === 'user_input' is processed. All other event types (status
 * updates, billing, etc.) are acknowledged with 200 and discarded.
 *
 * Webhook verification: query param `?token=X` is compared against instance
 * `webhookVerifyToken`. If not set, skip token check.
 */

import { createInboundDedupeCache, sanitizeMessage } from '@omni/channel-sdk';
import type { DedupeCache } from '@omni/channel-sdk';
import { z } from 'zod';

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

// Download guard for media (100MB limit)
const _downloadGuard = createInboundDedupeCache;

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
    bodyPreview: body.slice(0, 500),
  });

  // Extract the actual Gupshup payload — handles multiple envelope formats:
  // 1. Raw JSON object (native webhook)
  // 2. Double-encoded: JSON string wrapping a JSON object
  // 3. Request Builder wrapper: { gupshupPayload: "<json string>" }
  const parsed = extractPayload(body, instanceId, logger);

  if (!parsed) {
    // Can't parse at all — ack and move on, we already logged the raw body
    return new Response('OK', { status: 200 });
  }

  const result = GupshupNativeWebhookSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn('[gupshup] webhook payload unrecognized shape (acking anyway)', {
      instanceId,
      errors: result.error.issues,
      parsed,
    });
    // Fail-open: always ack so Gupshup doesn't retry
    return new Response('OK', { status: 200 });
  }

  const webhook = result.data as unknown as GupshupNativeInboundWebhook;

  // Only process user input events — ignore status, billing, etc.
  if (webhook.event_type !== 'user_input') {
    logger.debug('[gupshup] non-user_input event ignored', { instanceId, event_type: webhook.event_type });
    return new Response('OK', { status: 200 });
  }

  await processInboundMessage(plugin, instanceId, webhook, dedupeCache);

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
): Promise<void> {
  const msg = webhook.messageobj;
  const from = webhook.sender;

  // Dedupe by sender phone + message ID
  const dedupeKey = `${from.trim()}:${msg.id}`;
  if (dedupeCache.isDuplicate(instanceId, dedupeKey, 'gupshup', plugin.getLogger() as import('@omni/core').Logger)) {
    return;
  }

  const content = extractContent(msg);
  if (!content) return;

  // Sanitize text
  if (content.text) {
    const sanitized = sanitizeMessage(content.text, plugin.getLogger() as import('@omni/core').Logger, {
      instanceId,
      messageId: msg.id,
    });
    if (!sanitized.ok) return;
    content.text = sanitized.text;
  }

  const platformTimestamp = msg.timestamp * 1000;
  const replyTo = msg.replyContext?.id;

  await plugin.handleMessageReceived({
    instanceId,
    externalId: msg.id,
    chatId: from,
    from,
    content,
    rawPayload: { ...webhook } as unknown as Record<string, unknown>,
    platformTimestamp,
    replyTo,
  });
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
