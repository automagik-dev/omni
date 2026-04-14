/**
 * Gupshup webhook handler
 *
 * Parses inbound Meta/WA Business API format payloads from Gupshup,
 * deduplicates, and emits the appropriate Omni events.
 *
 * Webhook verification: query param `?token=X` is compared against
 * instance `webhookVerifyToken`. If not set, skip token check.
 */

import { createDownloadGuard, sanitizeMessage } from '@omni/channel-sdk';
import type { DedupeCache } from '@omni/channel-sdk';
import { z } from 'zod';

import type { GupshupPlugin } from '../plugin';
import type {
  GupshupChange,
  GupshupChangeValue,
  GupshupInboundMessage,
  GupshupInboundWebhook,
  GupshupStatusEvent,
} from '../types';
import { extractUserId } from '../utils/identity';

/**
 * Zod schema for validating top-level inbound webhook payload.
 */
const GupshupInboundWebhookSchema = z.object({
  object: z.string(),
  gs_app_id: z.string().optional(),
  entry: z.array(
    z.object({
      id: z.string().optional(), // Gupshup omits id in set-callback validation requests
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.record(z.unknown()),
        }),
      ),
    }),
  ),
});

// Download guard for media (100MB limit)
const _downloadGuard = createDownloadGuard({ maxSizeBytes: 100 * 1024 * 1024 });

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
  } catch {
    return new Response('Bad Request: invalid JSON', { status: 400 });
  }

  const result = GupshupInboundWebhookSchema.safeParse(parsed);
  if (!result.success) {
    return new Response('Bad Request: invalid payload shape', { status: 400 });
  }

  const webhook = result.data as unknown as GupshupInboundWebhook;

  for (const entry of webhook.entry) {
    for (const change of entry.changes) {
      await processChange(plugin, instanceId, change, dedupeCache);
    }
  }

  return new Response('OK', { status: 200 });
}

// ─────────────────────────────────────────────────────────────
// Change routing
// ─────────────────────────────────────────────────────────────

async function processChange(
  plugin: GupshupPlugin,
  instanceId: string,
  change: GupshupChange,
  dedupeCache: DedupeCache,
): Promise<void> {
  // Ignore non-message fields
  if (change.field === 'billing-event' || change.field === 'account_update') {
    return;
  }

  const value = change.value as GupshupChangeValue;

  if (value.statuses && value.statuses.length > 0) {
    await processStatus(plugin, instanceId, value.statuses[0] as GupshupStatusEvent);
    return;
  }

  if (value.messages && value.messages.length > 0) {
    const contacts = value.contacts ?? [];
    await processInboundMessage(plugin, instanceId, value.messages[0] as GupshupInboundMessage, contacts, dedupeCache);
  }
}

// ─────────────────────────────────────────────────────────────
// Status events
// ─────────────────────────────────────────────────────────────

async function processStatus(plugin: GupshupPlugin, instanceId: string, status: GupshupStatusEvent): Promise<void> {
  // enqueued/sent → ignore
  if (status.status === 'enqueued' || status.status === 'sent') return;

  const to = status.recipient_id ?? status.destination ?? '';
  const externalId = status.id;

  if (status.status === 'delivered') {
    await plugin.handleMessageDelivered({ instanceId, externalId, to });
  } else if (status.status === 'read') {
    await plugin.handleMessageRead({ instanceId, externalId, to });
  } else if (status.status === 'failed') {
    await plugin.handleMessageFailed({ instanceId, externalId, to, reason: 'Delivery failed' });
  }
}

// ─────────────────────────────────────────────────────────────
// Inbound message
// ─────────────────────────────────────────────────────────────

async function processInboundMessage(
  plugin: GupshupPlugin,
  instanceId: string,
  msg: GupshupInboundMessage,
  _contacts: { wa_id: string; profile: { name: string } }[],
  dedupeCache: DedupeCache,
): Promise<void> {
  const from = extractUserId(msg.from);

  // Dedupe key
  const dedupeKey = `${msg.from.trim()}:${msg.id}`;
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

  // Platform timestamp (seconds → milliseconds)
  const platformTimestamp = msg.timestamp ? Number(msg.timestamp) * 1000 : undefined;

  await plugin.handleMessageReceived({
    instanceId,
    externalId: msg.id,
    chatId: from,
    from,
    content,
    rawPayload: msg as unknown as Record<string, unknown>,
    platformTimestamp,
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
}

function extractMediaContent(
  type: string,
  media: { url: string; mime_type: string; caption?: string; filename?: string } | undefined,
): ExtractedContent | null {
  if (!media) return null;
  return { type, mediaUrl: media.url, mimeType: media.mime_type, caption: media.caption, filename: media.filename };
}

function extractLocationContent(loc: {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}): ExtractedContent {
  const parts: string[] = [];
  if (loc.name) parts.push(loc.name);
  if (loc.address) parts.push(loc.address);
  const text = parts.length > 0 ? parts.join(', ') : `${loc.latitude},${loc.longitude}`;
  return { type: 'location', text };
}

function extractContactContent(contacts: GupshupInboundMessage['contacts']): ExtractedContent {
  const first = contacts?.[0];
  const name =
    first?.name?.formatted_name ??
    [first?.name?.first_name, first?.name?.last_name].filter(Boolean).join(' ') ??
    'Unknown';
  const phone = first?.phones?.[0]?.phone ?? '';
  return { type: 'text', text: `Contact: ${name}: ${phone}` };
}

function extractInteractiveContent(interactive: NonNullable<GupshupInboundMessage['interactive']>): ExtractedContent {
  if (interactive.type === 'button_reply' && interactive.button_reply) {
    return { type: 'text', text: interactive.button_reply.title };
  }
  if (interactive.type === 'list_reply' && interactive.list_reply) {
    return { type: 'text', text: interactive.list_reply.title };
  }
  return { type: 'text', text: '' };
}

function extractContent(msg: GupshupInboundMessage): ExtractedContent | null {
  switch (msg.type) {
    case 'text':
      return msg.text ? { type: 'text', text: msg.text.body } : null;
    case 'image':
      return extractMediaContent('image', msg.image);
    case 'audio':
      return extractMediaContent('audio', msg.audio);
    case 'video':
      return extractMediaContent('video', msg.video);
    case 'document':
      return extractMediaContent('document', msg.document);
    case 'sticker':
      return msg.sticker ? { type: 'image', mediaUrl: msg.sticker.url, mimeType: msg.sticker.mime_type } : null;
    case 'location':
      return msg.location ? extractLocationContent(msg.location) : null;
    case 'contacts':
      return extractContactContent(msg.contacts);
    case 'interactive':
      return msg.interactive ? extractInteractiveContent(msg.interactive) : null;
    case 'button':
      return msg.button ? { type: 'text', text: msg.button.text } : null;
    default:
      return null;
  }
}
