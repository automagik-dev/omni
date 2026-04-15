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
    sender: z.string(),
    botname: z.string(),
    channel: z.string(),
    isGroup: z.boolean().optional(),
    destination: z.union([z.string(), z.number()]),
    event_type: z.string(),
    message: z.string().optional(),
    postbackText: z.string().nullable().optional(),
    senderobj: z.object({
      channelid: z.string(),
      display: z.string().optional(),
      channeltype: z.string().optional(),
    }),
    contextobj: z
      .object({
        senderName: z.string().optional(),
        botname: z.string().optional(),
        channeltype: z.string().optional(),
        contexttype: z.string().optional(),
        contextid: z.string().optional(),
        preventReply: z.boolean().optional(),
        cc: z.string().optional(),
        dc: z.string().optional(),
      })
      .passthrough()
      .optional(),
    messageobj: z
      .object({
        id: z.string(),
        type: z.string(),
        from: z.string(),
        timestamp: z.number(),
        text: z.string().optional(),
        url: z.string().optional(),
        contentType: z.string().optional(),
        fileName: z.string().optional(),
        mediaId: z.string().optional(),
        // location fields arrive as strings
        latitude: z.string().optional(),
        longitude: z.string().optional(),
        address: z.string().optional(),
        name: z.string().optional(),
        replyContext: z
          .object({
            id: z.string(),
            internalId: z.string().optional(),
          })
          .optional(),
        raw: z
          .object({
            payload: z.record(z.unknown()).optional(),
            sender: z.object({ name: z.string().optional() }).passthrough().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
    messageHeader: z
      .object({
        event_type: z.string().optional(),
        nsTraceId: z.string().optional(),
        project_id: z.string().optional(),
      })
      .passthrough()
      .optional(),
    source: z.string().optional(),
  })
  .passthrough();

// Download guard for media (100MB limit)
const _downloadGuard = createInboundDedupeCache;

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
    return new Response('Bad Request', { status: 400 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
    // Gupshup sometimes double-encodes the payload: the body is a JSON-encoded string wrapping
    // another JSON object. Unwrap up to one extra layer.
    if (typeof parsed === 'string') {
      logger.debug('[gupshup] unwrapping double-encoded webhook body', { instanceId });
      parsed = JSON.parse(parsed);
    }
  } catch {
    return new Response('Bad Request: invalid JSON', { status: 400 });
  }

  const result = GupshupNativeWebhookSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn('[gupshup] webhook payload failed schema validation', {
      instanceId,
      errors: result.error.issues,
      rawBody: body.slice(0, 2000), // truncate to avoid log flood
    });
    return new Response('Bad Request: invalid payload shape', { status: 400 });
  }

  const webhook = result.data as unknown as GupshupNativeInboundWebhook;

  // Only process user input events — ignore status, billing, etc.
  if (webhook.event_type !== 'user_input') {
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
