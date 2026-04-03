/**
 * Gupshup webhook handler
 *
 * Parses inbound Gupshup webhook payloads, deduplicates, sanitizes,
 * and emits the appropriate Omni events.
 *
 * Gupshup sends two event types:
 * - "message"       → inbound message from a WhatsApp user
 * - "message-event" → delivery/read receipt for an outbound message
 *
 * Webhook verification: query param `?token=X` is compared against
 * instance `webhookVerifyToken`. Mismatch returns 401.
 */

import { createDownloadGuard, sanitizeMessage } from '@omni/channel-sdk';
import type { DedupeCache } from '@omni/channel-sdk';

import type { GupshupPlugin } from '../plugin';
import type {
  GupshupContact,
  GupshupContactContent,
  GupshupInboundPayload,
  GupshupInteractiveContent,
  GupshupLocationContent,
  GupshupMediaContent,
  GupshupMessageEventPayload,
  GupshupMessagePayload,
  GupshupTextContent,
} from '../types';
import { extractUserId } from '../utils/identity';

// Download guard for Gupshup CDN media (filemanager.gupshup.io — public URLs)
const _downloadGuard = createDownloadGuard({ maxSizeBytes: 100 * 1024 * 1024 }); // 100MB

/**
 * Verify the webhook token from the request query param.
 * Returns true if valid, false if mismatch (caller should return 401).
 */
export function verifyWebhookToken(request: Request, expectedToken: string): boolean {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  return token === expectedToken;
}

/**
 * Handle an inbound Gupshup webhook POST request.
 *
 * - Verifies token
 * - Parses body
 * - Routes to message or receipt handler
 */
export async function handleGupshupWebhook(
  request: Request,
  plugin: GupshupPlugin,
  instanceId: string,
  webhookVerifyToken: string,
  dedupeCache: DedupeCache,
): Promise<Response> {
  // Token verification
  if (!verifyWebhookToken(request, webhookVerifyToken)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  let payload: GupshupInboundPayload;
  try {
    payload = JSON.parse(body) as GupshupInboundPayload;
  } catch {
    return new Response('Bad Request: invalid JSON', { status: 400 });
  }

  if (payload.type === 'message') {
    await handleInboundMessage(plugin, instanceId, payload.payload as GupshupMessagePayload, dedupeCache);
  } else if (payload.type === 'message-event') {
    await handleMessageEvent(plugin, instanceId, payload.payload as GupshupMessageEventPayload);
  }

  return new Response('OK', { status: 200 });
}

// ─────────────────────────────────────────────────────────────
// Inbound message
// ─────────────────────────────────────────────────────────────

async function handleInboundMessage(
  plugin: GupshupPlugin,
  instanceId: string,
  msg: GupshupMessagePayload,
  dedupeCache: DedupeCache,
): Promise<void> {
  const sourcePhone = extractUserId(msg.source);

  // Dedup key: ${sourcePhone}:${messageId}
  const dedupeKey = `${sourcePhone}:${msg.id}`;
  if (dedupeCache.isDuplicate(instanceId, dedupeKey, 'gupshup', plugin.getLogger() as import('@omni/core').Logger)) {
    return;
  }

  const content = extractContent(msg);
  if (!content) return;

  // Sanitize text content
  if (content.text) {
    const sanitized = sanitizeMessage(content.text, plugin.getLogger() as import('@omni/core').Logger, {
      instanceId,
      messageId: msg.id,
    });
    if (!sanitized.ok) return;
    content.text = sanitized.text;
  }

  const platformTimestamp = msg.payload && 'timestamp' in msg.payload ? undefined : undefined;

  await plugin.handleMessageReceived({
    instanceId,
    externalId: msg.id,
    chatId: sourcePhone,
    from: sourcePhone,
    content,
    rawPayload: msg as unknown as Record<string, unknown>,
    platformTimestamp,
  });
}

// ─────────────────────────────────────────────────────────────
// Delivery/read receipts
// ─────────────────────────────────────────────────────────────

async function handleMessageEvent(
  plugin: GupshupPlugin,
  instanceId: string,
  event: GupshupMessageEventPayload,
): Promise<void> {
  if (event.type === 'delivered') {
    await plugin.handleMessageDelivered({ instanceId, externalId: event.id, to: event.destination });
  } else if (event.type === 'read') {
    await plugin.handleMessageRead({ instanceId, externalId: event.id, to: event.destination });
  }
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
}

function extractContent(msg: GupshupMessagePayload): ExtractedContent | null {
  switch (msg.type) {
    case 'text':
      return extractText(msg.payload as GupshupTextContent);
    case 'image':
      return extractMedia(msg.payload as GupshupMediaContent, 'image', 'image/*');
    case 'audio':
      return extractMedia(msg.payload as GupshupMediaContent, 'audio', 'audio/*');
    case 'video':
      return extractMedia(msg.payload as GupshupMediaContent, 'video', 'video/*');
    case 'document':
      return extractMedia(msg.payload as GupshupMediaContent, 'document', 'application/octet-stream');
    case 'location':
      return extractLocation(msg.payload as GupshupLocationContent);
    case 'contact':
      return extractContact(msg.payload as GupshupContactContent);
    case 'interactive':
      return extractInteractive(msg.payload as GupshupInteractiveContent);
    default:
      return null;
  }
}

function extractText(payload: GupshupTextContent): ExtractedContent {
  return { type: 'text', text: payload.text };
}

function extractMedia(payload: GupshupMediaContent, type: string, defaultMime: string): ExtractedContent {
  // Validate the CDN URL is from Gupshup (filemanager.gupshup.io) or any HTTPS URL
  const url = payload.url;
  if (!url || !url.startsWith('https://')) {
    return { type, mediaUrl: url, mimeType: payload.contentType ?? defaultMime, caption: payload.caption };
  }
  // Size check is performed at download time via checkResponse/checkSize
  return {
    type,
    mediaUrl: url,
    mimeType: payload.contentType ?? defaultMime,
    caption: payload.caption,
    filename: payload.filename,
  };
}

function extractLocation(payload: GupshupLocationContent): ExtractedContent {
  const parts: string[] = [];
  if (payload.name) parts.push(payload.name);
  if (payload.address) parts.push(payload.address);
  return {
    type: 'location',
    text: parts.join(', ') || `${payload.latitude},${payload.longitude}`,
  };
}

function extractContact(payload: GupshupContactContent): ExtractedContent {
  const first = payload.contacts?.[0] as GupshupContact | undefined;
  const name = first?.name?.formatted_name ?? 'Unknown';
  const phone = first?.phones?.[0]?.phone ?? '';
  return { type: 'contact', text: `${name}: ${phone}` };
}

function extractInteractive(payload: GupshupInteractiveContent): ExtractedContent {
  if (payload.button_reply) {
    return { type: 'text', text: payload.button_reply.title };
  }
  if (payload.list_reply) {
    return { type: 'text', text: payload.list_reply.title };
  }
  return { type: 'text', text: '' };
}
