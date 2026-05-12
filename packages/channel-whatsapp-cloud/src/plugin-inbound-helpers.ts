/**
 * Inbound-handler helpers for the WhatsApp Cloud plugin.
 *
 * Why a sidecar? `BaseChannelPlugin` exposes its event emission helpers
 * (`emitMessageReceived`, `emitMessageDelivered`, …) as `protected`, and the
 * underlying `eventBus` is also `protected`. The webhook handler
 * (`handlers/webhook.ts`) lives outside the plugin class — to keep
 * `plugin.ts` untouched in Group 4, this file provides thin wrappers that
 * adapt the incoming Meta-shaped payload to the SDK's emit parameter shapes
 * and call those protected helpers through a narrow friend-style cast.
 *
 * Runtime note: `protected` is a TypeScript-only constraint with **no
 * runtime effect** — the methods are regular instance methods that fully
 * exist on the WhatsAppCloudPlugin object. We use a typed cast to
 * `ProtectedPluginSurface` to bypass the compile-time visibility check
 * without resorting to `any`.
 *
 * If/when plugin.ts is updated to expose public `handleMessageReceived` /
 * `handleStatusUpdate` / `emitTemplateStatusChanged` wrappers (mirroring the
 * Gupshup plugin pattern), this sidecar can be deleted and the webhook
 * handler can call the plugin methods directly.
 */

import type { DedupeCache } from '@omni/channel-sdk';
import type { Logger } from '@omni/core';
import type { CoreEventType, EventBus, EventMetadata, EventPayloadMap } from '@omni/core/events';
import type { ChannelType, ContentType } from '@omni/core/types';
import type {
  MetaInboundMessage,
  MetaTemplateStatusUpdate,
  MetaWebhookStatusEntry,
} from '@omni/core/schemas';

import type { WhatsAppCloudPlugin } from './plugin';

// ─────────────────────────────────────────────────────────────────────────
// Friend-style surface — exposes the protected helpers we need to call.
// `protected` is purely a TS compile-time check; at runtime these are
// plain instance methods. Casting through this interface keeps the call
// sites type-safe without sprinkling `any` casts.
// ─────────────────────────────────────────────────────────────────────────

interface ProtectedPluginSurface {
  readonly id: string;
  eventBus: EventBus;
  emitMessageReceived: (params: {
    instanceId: string;
    externalId: string;
    chatId: string;
    from: string;
    senderName?: string;
    content: {
      type: ContentType;
      text?: string;
      mediaUrl?: string;
      mimeType?: string;
      isVoiceNote?: boolean;
    };
    replyToId?: string;
    rawPayload?: Record<string, unknown>;
    timings?: Record<string, number>;
  }) => Promise<string>;
  emitMessageSent: (params: {
    instanceId: string;
    externalId: string;
    chatId: string;
    to: string;
    content: { type: ContentType; text?: string };
  }) => Promise<void>;
  emitMessageDelivered: (params: {
    instanceId: string;
    externalId: string;
    chatId: string;
    deliveredAt: number;
  }) => Promise<void>;
  emitMessageRead: (params: {
    instanceId: string;
    externalId: string;
    chatId: string;
    readAt: number;
  }) => Promise<void>;
  emitMessageFailed: (params: {
    instanceId: string;
    externalId: string;
    chatId: string;
    error: string;
    errorCode?: string;
    retryable: boolean;
  }) => Promise<void>;
  emitReactionReceived: (params: {
    instanceId: string;
    messageId: string;
    chatId: string;
    from: string;
    emoji: string;
    rawPayload?: Record<string, unknown>;
  }) => Promise<void>;
  emitReactionRemoved: (params: {
    instanceId: string;
    messageId: string;
    chatId: string;
    from: string;
    emoji: string;
  }) => Promise<void>;
}

function asProtected(plugin: WhatsAppCloudPlugin): ProtectedPluginSurface {
  return plugin as unknown as ProtectedPluginSurface;
}

// ─────────────────────────────────────────────────────────────────────────
// Content extraction
// ─────────────────────────────────────────────────────────────────────────

interface ExtractedInboundContent {
  type: ContentType;
  text?: string;
  mediaUrl?: string;
  mediaId?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
  isVoiceNote?: boolean;
}

const MEDIA_TYPE_MAP: Partial<Record<MetaInboundMessage['type'], ContentType>> = {
  image: 'image',
  audio: 'audio',
  video: 'video',
  document: 'document',
  sticker: 'sticker',
};

/**
 * Extract a normalized content envelope from a Meta inbound message.
 *
 * Media-bearing messages return only the `mediaId` — Group 6 (or a later
 * media-download worker) is responsible for swapping that for a downloadable
 * URL via `GET /{media_id}`. Returning `mediaId` in the content keeps the
 * webhook handler synchronous and avoids hitting Graph API while we still
 * owe Meta a 2xx response.
 */
function extractInboundContent(msg: MetaInboundMessage): ExtractedInboundContent | null {
  if (msg.type === 'text') {
    return { type: 'text', text: msg.text.body };
  }

  if (msg.type === 'location') {
    const { latitude, longitude, name, address } = msg.location;
    const label = [name, address].filter(Boolean).join(', ');
    return {
      type: 'location',
      text: label || `${latitude},${longitude}`,
    };
  }

  if (msg.type === 'contacts') {
    const first = msg.contacts[0];
    const formattedName = first?.name?.formatted_name as string | undefined;
    const firstName = first?.name?.first_name as string | undefined;
    const phone = (first?.phones?.[0]?.phone as string | undefined) ?? '';
    const name = formattedName ?? firstName ?? 'Contact';
    return {
      type: 'text',
      text: `Contact: ${name}${phone ? `: ${phone}` : ''}`,
    };
  }

  if (msg.type === 'interactive') {
    const i = msg.interactive;
    if (i.type === 'button_reply' && i.button_reply) {
      return { type: 'text', text: i.button_reply.title };
    }
    if (i.type === 'list_reply' && i.list_reply) {
      return { type: 'text', text: i.list_reply.title };
    }
    return { type: 'text', text: '[interactive]' };
  }

  if (msg.type === 'button') {
    return { type: 'text', text: msg.button.text };
  }

  // Media types — image | audio | video | document | sticker
  const omniType = MEDIA_TYPE_MAP[msg.type];
  if (omniType) {
    const mediaField =
      msg.type === 'image'
        ? msg.image
        : msg.type === 'audio'
          ? msg.audio
          : msg.type === 'video'
            ? msg.video
            : msg.type === 'document'
              ? msg.document
              : msg.sticker;
    if (!mediaField) return null;
    return {
      type: omniType,
      mediaId: mediaField.id,
      mimeType: mediaField.mime_type,
      caption: mediaField.caption,
      filename: mediaField.filename,
      isVoiceNote: msg.type === 'audio' ? mediaField.voice === true : undefined,
    };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Public helpers (used by handlers/webhook.ts)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Emit `message.received` (or `reaction.received` for reaction messages)
 * from a Meta inbound message, after checking dedupe.
 *
 * Returns `true` if the message was processed (event emitted), `false` if it
 * was a duplicate or had no extractable content.
 */
export async function emitMessageReceivedFromMeta(
  plugin: WhatsAppCloudPlugin,
  instanceId: string,
  msg: MetaInboundMessage,
  contacts: Array<{ profile?: { name?: string }; wa_id?: string }> | undefined,
  dedupeCache: DedupeCache,
): Promise<boolean> {
  const logger = plugin.getLogger();
  const wamid = msg.id;

  if (dedupeCache.isDuplicate(instanceId, wamid, 'whatsapp-cloud', logger)) {
    logger.debug('[whatsapp-cloud] duplicate inbound dropped', { instanceId, wamid });
    return false;
  }

  // Reactions go through emitReactionReceived (or emitReactionRemoved when
  // emoji is empty — Meta uses empty emoji as "reaction removed").
  if (msg.type === 'reaction') {
    const surface = asProtected(plugin);
    const targetMessageId = msg.reaction.message_id;
    const emoji = msg.reaction.emoji;
    if (!emoji) {
      await surface.emitReactionRemoved({
        instanceId,
        messageId: targetMessageId,
        chatId: msg.from,
        from: msg.from,
        emoji: '',
      });
    } else {
      await surface.emitReactionReceived({
        instanceId,
        messageId: targetMessageId,
        chatId: msg.from,
        from: msg.from,
        emoji,
        rawPayload: msg as unknown as Record<string, unknown>,
      });
    }
    return true;
  }

  const content = extractInboundContent(msg);
  if (!content) {
    logger.warn('[whatsapp-cloud] inbound message has no extractable content', {
      instanceId,
      wamid,
      type: msg.type,
    });
    return false;
  }

  const senderName = contacts?.find((c) => c.wa_id === msg.from)?.profile?.name;
  // Meta timestamps come as decimal strings (seconds since epoch).
  const tsSeconds = Number.parseInt(msg.timestamp, 10);
  const platformTimestampMs = Number.isFinite(tsSeconds) ? tsSeconds * 1000 : Date.now();
  const replyToId = 'context' in msg ? msg.context?.id : undefined;

  await asProtected(plugin).emitMessageReceived({
    instanceId,
    externalId: wamid,
    chatId: msg.from,
    from: msg.from,
    senderName,
    content: {
      type: content.type,
      text: content.text ?? content.caption,
      mediaUrl: content.mediaUrl,
      mimeType: content.mimeType,
      isVoiceNote: content.isVoiceNote,
    },
    replyToId,
    rawPayload: {
      meta: msg as unknown as Record<string, unknown>,
      mediaId: content.mediaId,
      filename: content.filename,
      platformTimestampMs,
    },
  });
  return true;
}

/**
 * Emit the appropriate `message.*` event for a Meta status update.
 *
 * Maps:
 *   sent      → (no-op — `message.sent` is already emitted by `plugin.sendMessage`
 *                immediately after the Graph API POST returns 200; emitting again
 *                here on the webhook callback would duplicate the event)
 *   delivered → message.delivered
 *   read      → message.read
 *   failed    → message.failed (carrying the first error code, if any)
 */
export async function emitStatusEvent(
  plugin: WhatsAppCloudPlugin,
  instanceId: string,
  status: MetaWebhookStatusEntry,
): Promise<void> {
  const surface = asProtected(plugin);
  const timestampMs = (() => {
    const seconds = Number.parseInt(status.timestamp, 10);
    return Number.isFinite(seconds) ? seconds * 1000 : Date.now();
  })();

  switch (status.status) {
    case 'sent': {
      // Intentionally no-op — see docstring above.
      return;
    }
    case 'delivered': {
      await surface.emitMessageDelivered({
        instanceId,
        externalId: status.id,
        chatId: status.recipient_id,
        deliveredAt: timestampMs,
      });
      return;
    }
    case 'read': {
      await surface.emitMessageRead({
        instanceId,
        externalId: status.id,
        chatId: status.recipient_id,
        readAt: timestampMs,
      });
      return;
    }
    case 'failed': {
      const firstError = status.errors?.[0];
      const errorCode = firstError ? String(firstError.code) : undefined;
      const errorMessage =
        firstError?.message ?? firstError?.title ?? 'Meta reported delivery failure';
      await surface.emitMessageFailed({
        instanceId,
        externalId: status.id,
        chatId: status.recipient_id,
        error: errorMessage,
        errorCode,
        retryable: false,
      });
      return;
    }
  }
}

/**
 * Emit `template.status_changed` from a Meta template status update.
 *
 * NOTE: The full payload requires the local template UUID (whatsapp_templates
 * row id) and the previous status — both are looked up by Group 6's template
 * service when it owns the template store. Until then we surface what we
 * have from the webhook (metaTemplateId, name, language, event) and emit a
 * best-effort event so consumers can observe template lifecycle changes.
 *
 * Callers that have access to the local template store SHOULD pass
 * `templateId` and `previousStatus` for full fidelity.
 */
export async function emitTemplateStatusChanged(
  plugin: WhatsAppCloudPlugin,
  instanceId: string,
  update: MetaTemplateStatusUpdate,
  extras?: { templateId?: string; previousStatus?: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DELETED' },
): Promise<void> {
  const newStatus = mapTemplateEventToStatus(update.event);
  if (!newStatus) {
    plugin.getLogger().debug('[whatsapp-cloud] unmapped template lifecycle event', {
      instanceId,
      event: update.event,
      metaTemplateId: update.message_template_id,
    });
    return;
  }

  const payload: EventPayloadMap['template.status_changed'] = {
    instanceId,
    // Local UUID — caller can supply when known. The Meta-side template id is
    // always available, so we duplicate it here as a stable fallback (the row
    // can be reconciled later by `metaTemplateId`).
    templateId: extras?.templateId ?? update.message_template_id,
    metaTemplateId: update.message_template_id,
    templateName: update.message_template_name,
    language: update.message_template_language,
    previousStatus: extras?.previousStatus ?? null,
    newStatus,
    rejectionReason: update.reason,
  };

  await publishEvent(plugin, 'template.status_changed', payload, instanceId);
}

function mapTemplateEventToStatus(
  event: MetaTemplateStatusUpdate['event'],
): 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DELETED' | null {
  switch (event) {
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    case 'PAUSED':
      return 'PAUSED';
    case 'DISABLED':
      return 'DELETED';
    case 'FLAGGED':
      // FLAGGED is informational — templates remain APPROVED but with warning.
      // We surface as PAUSED to signal "do not use" without inventing a new
      // status value.
      return 'PAUSED';
  }
}

/**
 * Publish a core event through the plugin's event bus.
 *
 * Used for events that BaseChannelPlugin doesn't expose a dedicated emit*
 * helper for (currently: `template.status_changed`).
 */
async function publishEvent<T extends CoreEventType>(
  plugin: WhatsAppCloudPlugin,
  type: T,
  payload: EventPayloadMap[T],
  instanceId: string,
): Promise<void> {
  const surface = asProtected(plugin);
  const metadata: Partial<EventMetadata> = {
    instanceId,
    channelType: surface.id as ChannelType,
    source: `channel:${surface.id}`,
  };
  await surface.eventBus.publish(type, payload, metadata);
}

// Re-export Logger type so handler files don't need to add a separate import
// when they want to type the result of `plugin.getLogger()`.
export type { Logger };
