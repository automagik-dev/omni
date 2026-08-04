/**
 * Message Persistence Handler
 *
 * Subscribes to message events and creates unified chats/messages.
 * This is the bridge between the event-based system and the unified message model.
 *
 * Flow:
 * - message.received (realtime)     → find/create chat → create message (source: 'realtime')
 * - message.received (history-sync) → find/create chat → create message (source: 'sync')
 * - message.sent → find/create chat → create message (source: 'realtime', isFromMe: true)
 * - message.delivered/read → update message delivery status
 *
 * @see unified-messages wish
 *
 * TENANT CONTEXT (G5, ADR-0008)
 * -----------------------------
 * This is the dominant inbound consumer: every message on every channel lands
 * here and writes `chats`, `messages`, `chat_participants`, `chat_id_mappings`,
 * `platform_identities` and `instances`. All five handlers are consumer-only —
 * a NATS subscription, no request, no credential — so until this leg every one
 * of those writes reached the ambient pool, which is why nine db-access-guard
 * sites stayed `pending-G5-conversion` long after their route callers were
 * scoped: a site is only as scoped as its least-scoped caller.
 *
 * Each handler now runs its AWAITED db work through
 * `runConsumerInTenantContext(services.db, event, ...)`: the versioned envelope
 * is classified once, and a producer-stamped trusted tenant opens one worker
 * tenant transaction for the whole work item. The services read `scopedHandle`
 * internally, so the same service code is RLS-policed here and on the routes. A
 * legacy envelope (no version, no tenant) runs the identical body on the ambient
 * pool exactly as before — the dual-world contract — and a quarantined envelope
 * is refused at the top of the handler, before ANY write.
 *
 * THE G6 GATE ON `persons`
 * -----------------------
 * The sender-identity write is deliberately NOT part of the message transaction.
 * `persons` is a G2-`unowned` table with no derivation, so under RLS enforcement
 * its INSERT policy can never be satisfied until the G6 backfill assigns a
 * `tenant_id`. Keeping that write inside the message transaction would let the
 * G6 gate destroy the message; nesting a scope for it would hold two pooled
 * connections at once. It therefore runs first, as its own work item, and
 * degrades to unset identity FKs (all nullable) with a warning — in the TENANT
 * world only. See `resolveSenderIdentityForWorkItem`.
 *
 * THE FIRE-AND-FORGET TRAP (G4 leg-2)
 * -----------------------------------
 * This handler spawns several unawaited writes — the LID mapping upserts, the
 * chat/instance recency bumps, and the new-identity profile fetch. They outlive
 * the handler, so they must NOT inherit its transaction: by the time their
 * continuations run it is committed and its connection is back in the pool, and
 * a query on it is a use-after-commit. Each therefore takes the trusted tenant
 * threaded down from the handler and opens its OWN worker scope through
 * `runTenantWorkDb`, which detaches before it stamps. Threading `null` (the
 * legacy world) makes `runTenantWorkDb` a pass-through, so flag-off behaviour is
 * byte-identical down to the call order.
 */

import type { EventBus, MessageReceivedPayload, MessageSentPayload } from '@omni/core';
import { classifyEnvelope, createLogger } from '@omni/core';
import type { ChannelType, ChatType, MessageType } from '@omni/db';
import * as Sentry from '@sentry/bun';
import { sentryEnabled } from '../lib/sentry-scrub';
import type { Services } from '../services';
import {
  WorkerTenantContextError,
  runConsumerInTenantContext,
  runTenantWorkDb,
} from '../tenancy/worker-tenant-context';
import { deepSanitize, sanitizeText } from '../utils/utf8';
import { getPlugin } from './loader';

const log = createLogger('message-persistence');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Truncate string to max length (safe for varchar columns).
 * Also sanitizes for valid UTF-8.
 */
function truncate(str: string | undefined | null, maxLength: number): string | undefined {
  const safe = sanitizeText(str);
  if (!safe) return undefined;
  return safe.length > maxLength ? safe.slice(0, maxLength) : safe;
}

/**
 * Content type to message type mapping
 */
const CONTENT_TYPE_MAP: Record<string, MessageType> = {
  audio: 'audio',
  image: 'image',
  video: 'video',
  document: 'document',
  sticker: 'sticker',
  contact: 'contact',
  location: 'location',
  poll: 'poll',
  poll_update: 'poll',
  reaction: 'reaction',
};

/**
 * WhatsApp internal JID suffixes that don't represent real chats.
 * These are used for broadcasts and channels - not user conversations.
 *
 * Note: @lid JIDs ARE real chats (Linked Device IDs) — they get resolved
 * to phone JIDs in the WhatsApp message handler before reaching here.
 * Any unresolved @lid JIDs that still arrive should be stored (not skipped).
 *
 * @broadcast - Status broadcasts and broadcast lists
 * @newsletter - WhatsApp Channels (one-way broadcasts)
 */
const INTERNAL_JID_SUFFIXES = ['@broadcast', '@newsletter'];

/**
 * Check if a chat ID is an internal WhatsApp JID that should be skipped.
 * These don't represent real conversations and shouldn't be stored as chats.
 */
function isInternalWhatsAppJid(chatId: string): boolean {
  return INTERNAL_JID_SUFFIXES.some((suffix) => chatId.endsWith(suffix));
}

/**
 * Resolve the effective chat name for a message based on chat type and direction.
 *
 * For DMs:
 * - Inbound (!isFromMe): chatName > pushName (sender's display name)
 * - Outbound (isFromMe): chatName > recipientName > verifiedBizName
 *   (pushName is the bot's own name, not the contact's — so we skip it for outbound)
 *
 * For groups/channels: always chatName (group subject)
 *
 * Exported for unit testing. See also: packages/db/scripts/backfill-chat-names.ts
 * for fixing existing null-named DMs created before this fix.
 */
export function resolveEffectiveChatName(params: {
  chatType: string;
  isFromMe: boolean;
  chatName: string | undefined;
  pushName: string | undefined;
  rawPayload: Record<string, unknown> | undefined;
}): string | undefined {
  const { chatType, isFromMe, chatName, pushName, rawPayload } = params;

  if (chatType === 'dm') {
    if (!isFromMe) {
      // Inbound: chatName > pushName (sender's display name)
      return chatName || pushName;
    }
    // Outbound: chatName > recipientName > verifiedBizName
    // pushName is our own name here — not the contact's — so skip it
    return (
      chatName ||
      truncate(rawPayload?.recipientName as string | undefined, 255) ||
      truncate(rawPayload?.verifiedBizName as string | undefined, 255)
    );
  }

  // Groups and channels: always use chatName (group subject / channel name)
  return chatName;
}

/**
 * Map content type to message type
 */
function mapContentType(contentType: string | undefined): MessageType {
  return CONTENT_TYPE_MAP[contentType ?? ''] ?? 'text';
}

/**
 * Infer chat type from context
 */
function inferChatType(chatId: string, isGroup?: boolean): ChatType {
  if (chatId.includes('@g.us') || chatId.includes('@broadcast')) return 'group';
  if (chatId.includes('@newsletter')) return 'channel';
  if (isGroup) return 'group';
  return 'dm';
}

/**
 * Find long string fields in an object (for debugging varchar issues)
 */
function findLongStrings(obj: unknown, prefix = '', minLength = 200): Record<string, number> {
  const result: Record<string, number> = {};
  if (!obj || typeof obj !== 'object') return result;

  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = `${prefix}${key}`;
    if (typeof val === 'string' && val.length > minLength) {
      result[fullKey] = val.length;
    } else if (val && typeof val === 'object') {
      Object.assign(result, findLongStrings(val, `${fullKey}.`, minLength));
    }
  }
  return result;
}

/**
 * Extract platform timestamp from raw payload.
 * Returns null when no timestamp can be extracted (caller decides what to do).
 */
export function extractPlatformTimestamp(
  rawPayload: Record<string, unknown> | undefined,
  _fallback: number,
): Date | null {
  if (!rawPayload?.messageTimestamp) return null;

  const ts = rawPayload.messageTimestamp;
  let tsNum: number | null = null;

  if (typeof ts === 'number') {
    tsNum = ts;
  } else if (typeof ts === 'string') {
    tsNum = Number(ts);
  } else if (typeof ts === 'object' && ts !== null && 'low' in ts) {
    // Protobuf Long format: { low: number, high: number, unsigned: boolean }
    // Use unsigned right-shift (>>> 0) to treat both halves as uint32 before combining,
    // so timestamps after 2038 (where low bit 31 is set) reconstruct correctly.
    const lo = (ts as { low: number; high?: number }).low >>> 0;
    const hi = ((ts as { low: number; high?: number }).high ?? 0) >>> 0;
    tsNum = hi * 0x100000000 + lo;
  }

  if (!tsNum || Number.isNaN(tsNum)) return null;

  // WhatsApp timestamps are in seconds, convert to milliseconds
  return new Date(tsNum < 1e12 ? tsNum * 1000 : tsNum);
}

/**
 * Build a chat preview string from a message payload.
 * For groups, prefixes with sender name. Includes media type badges.
 */
function buildChatPreview(payload: MessageReceivedPayload, rawPayload: Record<string, unknown> | undefined): string {
  const isGroup = payload.chatId.endsWith('@g.us') || rawPayload?.isGroup === true;
  const isFromMe = rawPayload?.isFromMe === true;

  const text = payload.content.text ?? '';
  const badge =
    payload.content.type !== 'text' ? (MEDIA_BADGES[payload.content.type] ?? `[${payload.content.type}]`) : '';
  let preview = badge ? (text ? `${badge} ${text}` : badge) : text;

  // Prefix with sender name for groups (not from self)
  if (isGroup && !isFromMe) {
    const sender = payload.senderName || (rawPayload?.pushName as string) || (rawPayload?.displayName as string) || '';
    if (sender) preview = `${sender}: ${preview}`;
  }

  return preview.substring(0, 500);
}

const MEDIA_BADGES: Record<string, string> = {
  image: '[Image]',
  audio: '[Audio]',
  video: '[Video]',
  document: '[Document]',
  sticker: '[Sticker]',
  contact: '[Contact]',
  location: '[Location]',
  poll: '[Poll]',
};

const OUTBOUND_MEDIA_TYPES = new Set(['audio', 'image', 'video', 'document', 'sticker']);

function compactRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const compacted = Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function isSentMediaContent(content: MessageSentPayload['content']): boolean {
  return OUTBOUND_MEDIA_TYPES.has(content.type) || !!content.mediaUrl || !!content.localPath || !!content.mimeType;
}

function buildSentMediaMetadata(
  content: MessageSentPayload['content'],
  rawPayload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!isSentMediaContent(content)) return undefined;
  const rawSource = typeof rawPayload?.mediaSource === 'string' ? rawPayload.mediaSource : undefined;
  return compactRecord({
    caption: content.caption,
    filename: content.filename,
    voiceNote: content.isVoiceNote === true ? true : undefined,
    source: rawSource ?? (content.mediaUrl ? 'url' : content.localPath ? 'localPath' : 'inline'),
  });
}

export function buildSentMessageContentFields(payload: MessageSentPayload): {
  textContent?: string;
  hasMedia: boolean;
  mediaMimeType?: string;
  mediaUrl?: string;
  mediaLocalPath?: string;
  mediaMetadata?: Record<string, unknown>;
  rawPayload?: Record<string, unknown>;
} {
  return {
    textContent: sanitizeText(payload.content.text ?? payload.content.caption),
    hasMedia: isSentMediaContent(payload.content),
    mediaMimeType: truncate(payload.content.mimeType, 100),
    mediaUrl: payload.content.mediaUrl,
    mediaLocalPath: payload.content.localPath,
    mediaMetadata: buildSentMediaMetadata(payload.content, payload.rawPayload),
    rawPayload: payload.rawPayload ? deepSanitize(payload.rawPayload) : undefined,
  };
}

function buildSentChatPreview(payload: MessageSentPayload): string {
  const text = payload.content.text ?? payload.content.caption ?? '';
  const badge =
    payload.content.type !== 'text' ? (MEDIA_BADGES[payload.content.type] ?? `[${payload.content.type}]`) : '';
  return badge ? (text ? `${badge} ${text}` : badge) : text;
}

/**
 * Extract and validate phone from sender ID.
 * Returns E.164 phone (+digits) or undefined for non-phone IDs.
 *
 * Filters out:
 * - Group IDs (contain dashes, e.g. "120363123-1234567@g.us")
 * - LID references (numeric but not phone numbers)
 * - Meta IDs (non-numeric platform identifiers)
 * - IDs that are too short (<7 digits) or too long (>15 digits)
 */
function extractPhoneFromSender(senderId: string, channel: string): string | undefined {
  if (!channel.startsWith('whatsapp')) return undefined;

  // Strip @suffix if still present (defensive)
  const bare = senderId.split('@')[0] || senderId;

  // Must be only digits (filters out group IDs with dashes, meta IDs, LIDs with letters)
  if (!/^\d+$/.test(bare)) return undefined;

  // E.164 validation: 7-15 digits
  if (bare.length < 7 || bare.length > 15) return undefined;

  return `+${bare}`;
}

// ============================================================================
// Identity Processing
// ============================================================================

interface IdentityResult {
  personId: string | undefined;
  platformIdentityId: string | undefined;
}

/**
 * Process sender identity - find or create person + platform identity
 */
async function processSenderIdentity(
  services: Services,
  payload: MessageReceivedPayload,
  metadata: { instanceId: string; personId?: string; platformIdentityId?: string; channelType?: string },
  channel: ChannelType,
  trustedTenantId: string | null,
): Promise<IdentityResult> {
  // Return existing if already resolved
  if (metadata.platformIdentityId) {
    return { personId: metadata.personId, platformIdentityId: metadata.platformIdentityId };
  }

  if (!payload.from) {
    return { personId: metadata.personId, platformIdentityId: undefined };
  }

  const displayName = truncate(payload.senderName ?? (payload.rawPayload?.pushName as string | undefined), 255);
  const platformUserId = truncate(payload.from, 255) ?? payload.from;
  // LID-addressed senders have numeric IDs that look like phones but are NOT E.164 numbers.
  // Skip phone extraction to prevent misidentifying LID IDs as phone numbers and linking to wrong people.
  // Check both: addressingMode (DM where the chat itself is @lid) and senderIsLid (group chats where
  // the chat is @g.us but individual participants can be @lid — addressingMode stays unset in that case).
  const isLidAddressed = payload.rawPayload?.addressingMode === 'lid' || payload.rawPayload?.senderIsLid === true;
  const resolvedPhone = isLidAddressed ? (payload.rawPayload?.resolvedSenderPhone as string | undefined) : undefined;
  const phoneNumber = isLidAddressed
    ? resolvedPhone
      ? `+${resolvedPhone}`
      : undefined
    : extractPhoneFromSender(platformUserId, channel);

  const { identity, person, isNew } = await services.persons.findOrCreateIdentity(
    { channel, instanceId: metadata.instanceId, platformUserId, platformUsername: displayName },
    {
      createPerson: true,
      displayName,
      matchByPhone: phoneNumber,
      matchByPlatformUserId: platformUserId,
      matchByChannel: channel,
    },
  );

  // Fetch profile for new identities (non-blocking)
  if (isNew) {
    log.debug('Auto-created identity for sender', {
      platformUserId: payload.from,
      identityId: identity.id,
      personId: person?.id,
    });
    // Fire-and-forget: outlives the handler transaction, so it carries the
    // trusted tenant and opens its own scope for the write (see module header).
    fetchAndUpdateProfile(services, channel, metadata.instanceId, payload.from, identity.id, trustedTenantId).catch(
      () => {},
    );
  }

  return { personId: person?.id, platformIdentityId: identity.id };
}

/**
 * Resolve the sender's identity as its OWN work item, BEFORE the message's
 * persistence transaction opens (G5, ADR-0008; G6-gated).
 *
 * This is hoisted out of `handleMessageReceived` for one specific reason. The
 * identity write touches `persons`, and `persons` is a G2-`unowned` table: it
 * has no derivation, so its `tenant_id` stays NULL until the G6 backfill assigns
 * one. Under RLS enforcement the `persons` INSERT policy is
 * `tenant_id = omni_current_tenant_id()`, which a NULL can never satisfy — so a
 * person cannot be created inside a tenant scope at all yet. (It cannot be
 * created OUTSIDE one either: unscoped, `omni_current_tenant_id()` raises.)
 * That is the same G6 gate that keeps `agent-runner.ts::persons` pending.
 *
 * Two consequences, both deliberate:
 *
 *   1. **Its own scope, never a nested one.** Running it inside the message
 *      transaction would make its failure abort that transaction and LOSE the
 *      message; running it as a nested `runInWorkerTenantScope` would hold two
 *      pooled connections at once and can deadlock under pool pressure. Hoisting
 *      it gives failure isolation with exactly one connection held at a time.
 *   2. **Degrade, do not drop — but only in the tenant world.** When a tenant is
 *      in play and the identity write is refused, the chat/message/participant
 *      rows still land with the identity FKs left unset (all three are nullable)
 *      and a warning is logged, rather than the whole message being lost to the
 *      G6 gate. The LEGACY path is untouched: no tenant means the original call
 *      with its original error propagation, byte-identical to pre-G5.
 *
 * Remove the degradation once G6 lands `persons.tenant_id`; the site is tracked
 * as `persons.ts`-adjacent debt in the db-access registry.
 */
async function resolveSenderIdentityForWorkItem(
  services: Services,
  payload: MessageReceivedPayload,
  metadata: { instanceId: string; personId?: string; platformIdentityId?: string; channelType?: string },
  channel: ChannelType,
  trustedTenantId: string | null,
): Promise<IdentityResult> {
  // Legacy world: exactly the pre-G5 call, exactly the pre-G5 error behaviour.
  if (!trustedTenantId) return processSenderIdentity(services, payload, metadata, channel, null);

  try {
    return await runTenantWorkDb(services.db, trustedTenantId, () =>
      processSenderIdentity(services, payload, metadata, channel, trustedTenantId),
    );
  } catch (error) {
    log.warn('Sender identity unresolved for this message; persisting without identity links', {
      instanceId: metadata.instanceId,
      externalId: payload.externalId,
      reason: 'persons has no tenant derivation until the G6 backfill (ADR-0008 / G6)',
      error: String(error),
    });
    return { personId: metadata.personId, platformIdentityId: metadata.platformIdentityId };
  }
}

/**
 * Fetch user profile from channel plugin and update identity (non-blocking)
 */
async function fetchAndUpdateProfile(
  services: Services,
  channel: ChannelType,
  instanceId: string,
  userId: string,
  identityId: string,
  trustedTenantId: string | null,
): Promise<void> {
  try {
    const plugin = await getPlugin(channel);
    if (!plugin || !('fetchUserProfile' in plugin)) return;

    const fetchProfile = plugin.fetchUserProfile as (
      instanceId: string,
      userId: string,
    ) => Promise<{ displayName?: string; avatarUrl?: string; bio?: string; platformData?: Record<string, unknown> }>;

    const profile = await fetchProfile.call(plugin, instanceId, userId);
    if (profile.avatarUrl || profile.bio || profile.platformData) {
      await runTenantWorkDb(services.db, trustedTenantId, () =>
        services.persons.updateIdentityProfile(identityId, profile),
      );
      log.debug('Updated identity with profile data', {
        identityId,
        hasAvatar: !!profile.avatarUrl,
        hasBio: !!profile.bio,
      });
    }
  } catch (error) {
    log.warn('Failed to fetch profile for new identity', { identityId, error: String(error) });
  }
}

// ============================================================================
// Message Received Handler
// ============================================================================

interface MessageMetadata {
  instanceId: string;
  personId?: string;
  platformIdentityId?: string;
  channelType?: string;
  ingestMode?: 'realtime' | 'history-sync';
}

/** Check if a chat name should be updated given a new incoming name */
function shouldUpdateChatName(current: string | null | undefined, incoming: string): boolean {
  if (!current) return true;
  if (current.endsWith('@s.whatsapp.net') || current.endsWith('@lid')) return true;
  return incoming !== current; // Name changed (e.g. Discord channel/thread rename)
}

/**
 * Persist LID↔phone mapping for a chat and set canonicalId if not already present.
 * Handles both legacy (phone-canonical with LID in rawPayload) and LID-first modes.
 */
async function persistLidMappings(
  services: Services,
  chat: { id: string; canonicalId?: string | null },
  chatExternalId: string,
  instanceId: string,
  rawPayload: Record<string, unknown> | undefined,
  trustedTenantId: string | null,
): Promise<void> {
  // Legacy path: phone-form chat, LID came from rawPayload.originalLidJid (pre-LID-first messages)
  const originalLidJid = rawPayload?.originalLidJid as string | undefined;
  if (originalLidJid && chatExternalId.endsWith('@s.whatsapp.net')) {
    // Unawaited: own worker scope, never the handler's transaction.
    runTenantWorkDb(services.db, trustedTenantId, () =>
      services.chats.upsertLidMapping(instanceId, originalLidJid, chatExternalId),
    ).catch((err) => {
      log.debug('Failed to persist LID mapping (non-critical)', { error: String(err) });
    });
    if (!chat.canonicalId) {
      await services.chats.update(chat.id, { canonicalId: chatExternalId });
      chat.canonicalId = chatExternalId;
    }
  }

  // LID-first path: chatExternalId is @lid canonical — persist mapping from resolvedPhoneJid.
  // Without this, phone-based lookups after restart miss the chat and create duplicate threads.
  const resolvedPhoneJid = rawPayload?.resolvedPhoneJid as string | undefined;
  if (chatExternalId.endsWith('@lid') && resolvedPhoneJid) {
    // Unawaited: own worker scope, never the handler's transaction.
    runTenantWorkDb(services.db, trustedTenantId, () =>
      services.chats.upsertLidMapping(instanceId, chatExternalId, resolvedPhoneJid),
    ).catch((err) => {
      log.debug('Failed to persist LID↔phone mapping for LID-canonical chat (non-critical)', { error: String(err) });
    });
    if (!chat.canonicalId) {
      try {
        await services.chats.update(chat.id, { canonicalId: resolvedPhoneJid });
        chat.canonicalId = resolvedPhoneJid;
      } catch (err) {
        // Non-critical: unique constraint means a pre-migration phone chat already owns this canonicalId.
        // The upsertLidMapping call above handles cross-chat reconciliation independently.
        log.debug('canonicalId backfill skipped — already claimed by another chat', {
          chatId: chat.id,
          resolvedPhoneJid,
          error: String(err),
        });
      }
    }
  }
}

/**
 * Post-process a chat after findOrCreate: populate canonicalId, persist LID mappings,
 * and fix stale names (raw JIDs).
 */
async function postProcessChat(
  services: Services,
  chat: { id: string; canonicalId?: string | null; name?: string | null },
  _chatCreated: boolean,
  chatExternalId: string,
  chatType: ChatType,
  pushName: string | undefined,
  instanceId: string,
  rawPayload: Record<string, unknown> | undefined,
  isFromMe: boolean,
  chatName: string | undefined,
  trustedTenantId: string | null,
): Promise<void> {
  // Populate canonicalId ONLY if not already set
  // (Usually set during creation, but handle legacy chats or edge cases)
  if (chatExternalId.endsWith('@s.whatsapp.net') && !chat.canonicalId) {
    await services.chats.update(chat.id, { canonicalId: chatExternalId });
    chat.canonicalId = chatExternalId;
  }

  await persistLidMappings(services, chat, chatExternalId, instanceId, rawPayload, trustedTenantId);

  // Update chat name if missing, stale, or changed (e.g. Discord thread/channel renames)
  // For outbound DMs: also resolve from rawPayload (recipientName, verifiedBizName)
  // Note: we process both new and existing chats — new chats may have been created
  // without a name if effectiveName was not available at findOrCreate time.
  {
    const chatNameLocal = chatName ?? (rawPayload?.chatName as string | undefined);
    const effectiveNameLocal = resolveEffectiveChatName({
      chatType,
      isFromMe,
      chatName: chatNameLocal,
      pushName,
      rawPayload,
    });
    if (effectiveNameLocal && shouldUpdateChatName(chat.name, effectiveNameLocal)) {
      await services.chats.update(chat.id, { name: effectiveNameLocal });
      chat.name = effectiveNameLocal;
    }
  }
}

/**
 * Resolve sender display name with fallback chain
 * Priority: senderName > rawPayload.pushName > participant displayName > undefined
 */
function resolveSenderDisplayName(
  senderName: string | undefined,
  rawPayload: Record<string, unknown> | undefined,
  participantResult: { participant: { displayName: string | null } } | undefined,
): string | undefined {
  return (
    truncate(senderName ?? (rawPayload?.pushName as string | undefined), 255) ||
    participantResult?.participant.displayName ||
    undefined
  );
}

async function maybeFindOrCreateParticipant(
  services: Services,
  chatId: string,
  from: string | undefined,
  rawPayload: Record<string, unknown> | undefined,
  personId: string | undefined,
  platformIdentityId: string | undefined,
  senderName: string | undefined,
): Promise<Awaited<ReturnType<typeof services.chats.findOrCreateParticipant>> | undefined> {
  if (!from) return undefined;

  const participantUserId = truncate(from, 255) ?? from;
  return services.chats.findOrCreateParticipant(chatId, participantUserId, {
    displayName: truncate(senderName ?? (rawPayload?.pushName as string | undefined), 255),
    personId,
    platformIdentityId,
  });
}

async function maybeRecordMessageEdit(
  services: Services,
  created: boolean,
  rawPayload: Record<string, unknown> | undefined,
  messageId: string,
  newText: string | undefined,
  platformTimestamp: Date,
  from: string | undefined,
): Promise<void> {
  if (created) return;
  if (rawPayload?.isEdited !== true) return;

  const editedAtMs = rawPayload.editDate;
  const editedAt = new Date(typeof editedAtMs === 'number' ? editedAtMs : platformTimestamp.getTime());
  await services.messages.recordEdit(messageId, newText ?? '', editedAt, truncate(from, 255) ?? undefined);
}

async function maybeRecordParticipantActivity(
  services: Services,
  chatId: string,
  from: string | undefined,
): Promise<void> {
  if (!from) return;
  const activityUserId = truncate(from, 255) ?? from;
  await services.chats.recordParticipantActivity(chatId, activityUserId);
}

function maybeUpdateRecency(
  services: Services,
  instanceId: string,
  chatId: string,
  rawPayload: Record<string, unknown> | undefined,
  payload: MessageReceivedPayload,
  platformTimestamp: Date,
  trustedTenantId: string | null,
): void {
  // Edits should not bump recency.
  if (rawPayload?.isEdited === true) return;

  const preview = sanitizeText(buildChatPreview(payload, rawPayload)) ?? '';
  const isFromMe = rawPayload?.isFromMe === true;
  // Both writes are unawaited and outlive the handler transaction, so each opens
  // its own worker scope rather than inheriting one that is about to commit.
  runTenantWorkDb(services.db, trustedTenantId, () =>
    services.chats.updateLastMessage(chatId, preview, platformTimestamp, isFromMe),
  ).catch((error) => {
    log.debug('Failed to update chat lastMessage (non-critical)', { error: String(error) });
  });

  runTenantWorkDb(services.db, trustedTenantId, () =>
    services.instances.updateLastMessageAt(instanceId, platformTimestamp),
  ).catch((error) => {
    log.debug('Failed to update instance lastMessageAt (non-critical)', { error: String(error) });
  });
}

/**
 * Find or create the chat for an inbound message.
 *
 * For LID-canonical messages (@lid chatExternalId with resolvedPhoneJid in rawPayload):
 * probes for a pre-existing phone chat BEFORE calling findOrCreate. Without this,
 * findOrCreate creates a new @lid chat (LID mapping not yet written at that point),
 * and even after upsertLidMapping the split is permanent — direct externalId matches
 * win over mapping fallback in findByExternalIdSmart, so phone lookups keep routing
 * to the old phone chat forever.
 */
async function resolveOrCreateChat(
  services: Services,
  instanceId: string,
  chatExternalId: string,
  chatType: ChatType,
  channel: ChannelType,
  effectiveName: string | undefined,
  canonicalId: string | undefined,
  rawPayload: Record<string, unknown> | undefined,
  trustedTenantId: string | null,
): ReturnType<typeof services.chats.findOrCreate> {
  const resolvedPhoneJid = rawPayload?.resolvedPhoneJid as string | undefined;
  if (chatExternalId.endsWith('@lid') && resolvedPhoneJid) {
    return services.chats.findByExternalIdSmart(instanceId, resolvedPhoneJid).then((phoneChat) => {
      if (phoneChat) {
        // Persist mapping so subsequent LID lookups also route to this phone chat.
        // Unawaited: own worker scope, never the handler's transaction.
        runTenantWorkDb(services.db, trustedTenantId, () =>
          services.chats.upsertLidMapping(instanceId, chatExternalId, resolvedPhoneJid),
        ).catch((err) => {
          log.debug('Failed to persist LID mapping during chat pre-check (non-critical)', { error: String(err) });
        });
        return { chat: phoneChat, created: false };
      }
      return services.chats.findOrCreate(instanceId, chatExternalId, {
        chatType,
        channel,
        name: effectiveName,
        canonicalId,
      });
    });
  }
  return services.chats.findOrCreate(instanceId, chatExternalId, {
    chatType,
    channel,
    name: effectiveName,
    canonicalId,
  });
}

/**
 * Handle message.received event - main processing logic
 */
async function handleMessageReceived(
  services: Services,
  payload: MessageReceivedPayload,
  metadata: MessageMetadata,
  eventTimestamp: number,
  trustedTenantId: string | null,
  identity: IdentityResult,
): Promise<void> {
  const channel = (metadata.channelType ?? 'whatsapp') as ChannelType;
  const isHistorySync = metadata.ingestMode === 'history-sync';

  const chatExternalId = truncate(payload.chatId, 255) ?? payload.chatId;
  const messageExternalId = truncate(payload.externalId, 255) ?? payload.externalId;
  // Deep-sanitize rawPayload: WhatsApp protobuf can contain invalid UTF-8 bytes
  // (e.g. truncated multi-byte chars) that PostgreSQL rejects on insert
  const rawPayload = payload.rawPayload ? deepSanitize(payload.rawPayload) : undefined;

  // Step 1: Find or create chat
  const chatType = inferChatType(payload.chatId, rawPayload?.isGroup as boolean | undefined);
  const isFromMe = rawPayload?.isFromMe === true;

  // Resolve the chat name based on direction and chat type.
  // For outbound DMs, we look at rawPayload fields (recipientName, verifiedBizName)
  // since pushName is our own name, not the contact's.
  const pushName = truncate(payload.senderName ?? (rawPayload?.pushName as string | undefined), 255);
  const chatName = truncate(payload.chatName ?? (rawPayload?.chatName as string | undefined), 255);
  const effectiveName = resolveEffectiveChatName({ chatType, isFromMe, chatName, pushName, rawPayload });

  // Determine canonicalId upfront for phone-based chats
  const canonicalId = chatExternalId.endsWith('@s.whatsapp.net') ? chatExternalId : undefined;

  const { chat, created: chatCreated } = await resolveOrCreateChat(
    services,
    metadata.instanceId,
    chatExternalId,
    chatType,
    channel,
    effectiveName,
    canonicalId,
    rawPayload,
    trustedTenantId,
  );

  // Post-process chat: canonicalId, LID mapping, name updates
  await postProcessChat(
    services,
    chat,
    chatCreated,
    chatExternalId,
    chatType,
    pushName,
    metadata.instanceId,
    rawPayload,
    isFromMe,
    chatName,
    trustedTenantId,
  );

  // Step 2: sender identity, resolved by the caller in its OWN work item before
  // this transaction opened (see `resolveSenderIdentityForWorkItem`).
  const { personId, platformIdentityId } = identity;

  // Step 3: Find or create participant (with identity links)
  const participantResult = await maybeFindOrCreateParticipant(
    services,
    chat.id,
    payload.from,
    rawPayload,
    personId,
    platformIdentityId,
    payload.senderName,
  );

  // Step 4: Resolve sender display name (fallback chain: senderName > pushName > participant > undefined)
  const senderDisplayName = resolveSenderDisplayName(payload.senderName, rawPayload, participantResult);

  // Step 5: Build and create message
  const quotedMessage = rawPayload?.quotedMessage as Record<string, unknown> | undefined;
  const platformTimestamp = extractPlatformTimestamp(rawPayload, eventTimestamp);

  // For history-sync messages, messageTimestamp is the source of truth.
  // If it's missing (null), we have no reliable timestamp to preserve — skip rather than
  // storing with event.timestamp (= Date.now()), which would be misleading.
  if (isHistorySync && platformTimestamp === null) {
    log.debug('Skipping history-sync message without messageTimestamp', {
      externalId: payload.externalId,
      chatId: payload.chatId,
    });
    return;
  }

  const { message, created } = await services.messages.findOrCreate(chat.id, messageExternalId, {
    source: isHistorySync ? 'sync' : 'realtime',
    messageType: mapContentType(payload.content.type),
    textContent: sanitizeText(payload.content.text),
    // platformTimestamp is null only for realtime messages without messageTimestamp;
    // fall back to event.timestamp (≈ now) — acceptable for realtime, not for history-sync
    // (history-sync null case is already handled above with early return).
    platformTimestamp: platformTimestamp ?? new Date(eventTimestamp),
    senderPlatformUserId: truncate(payload.from, 255),
    senderDisplayName,
    senderPersonId: personId,
    senderPlatformIdentityId: platformIdentityId,
    isFromMe: rawPayload?.isFromMe === true,
    hasMedia: !!(payload.content.mediaUrl || payload.content.mimeType),
    mediaMimeType: truncate(payload.content.mimeType, 100),
    mediaUrl: payload.content.mediaUrl,
    mediaLocalPath: rawPayload?.mediaLocalPath as string | undefined,
    replyToExternalId: truncate(payload.replyToId, 255),
    quotedText: quotedMessage?.conversation as string | undefined,
    quotedSenderName: truncate(quotedMessage?.pushName as string | undefined, 255),
    // Thread (#889) — previously dropped: threadId rode along in the payload
    // for per_thread session routing and was never persisted.
    threadExternalId: truncate(payload.threadId, 255),
    isThreadBroadcast: rawPayload?.isThreadBroadcast === true,
    isForwarded: !!(rawPayload?.isForwarded || rawPayload?.forwardingScore),
    rawPayload,
  });

  // Telegram and WhatsApp edits can arrive as "message.received" with a stable externalId.
  // When we detect an edit, update the existing unified message instead of treating it as a duplicate.
  await maybeRecordMessageEdit(
    services,
    created,
    rawPayload,
    message.id,
    sanitizeText(payload.content.text) ?? undefined,
    platformTimestamp ?? new Date(eventTimestamp),
    payload.from,
  );

  if (created) {
    log.debug('Created message', { externalId: payload.externalId, chatId: chat.id });
  }

  // Step 6: Record participant activity
  await maybeRecordParticipantActivity(services, chat.id, payload.from);

  // Step 7/8: Update chat + instance recency (edits should not bump recency)
  maybeUpdateRecency(
    services,
    metadata.instanceId,
    chat.id,
    rawPayload,
    payload,
    platformTimestamp ?? new Date(eventTimestamp),
    trustedTenantId,
  );
}

/**
 * Log detailed error info for message.received failures
 */
function logMessageReceivedError(payload: MessageReceivedPayload, error: unknown): void {
  const rawPayload = payload.rawPayload;
  const quotedMsg = rawPayload?.quotedMessage as Record<string, unknown> | undefined;
  const longFields = findLongStrings(rawPayload, 'raw.');

  log.error('Failed to persist message.received to unified model', {
    externalId: payload.externalId,
    error: String(error),
    fieldLengths: {
      chatId: payload.chatId?.length,
      from: payload.from?.length,
      pushName: (rawPayload?.pushName as string)?.length,
      chatName: (rawPayload?.chatName as string)?.length,
      mimeType: payload.content?.mimeType?.length,
      replyToId: payload.replyToId?.length,
      quotedPushName: (quotedMsg?.pushName as string)?.length,
      quotedParticipant: (quotedMsg?.participant as string)?.length,
    },
    longFields: Object.keys(longFields).length > 0 ? longFields : undefined,
  });
}

// ============================================================================
// Main Setup
// ============================================================================

/**
 * Set up message persistence - subscribes to message events and writes to chats/messages tables
 */
export async function setupMessagePersistence(eventBus: EventBus, services: Services): Promise<void> {
  try {
    // Subscribe to message.received with durable consumer for reliability
    // - durable: survives API restarts, resumes from last acked message
    // - queue: load balances across multiple API instances
    // - maxRetries: retries failed messages before dead letter
    await eventBus.subscribe(
      'message.received',
      async (event) => {
        const payload = event.payload as MessageReceivedPayload;
        const metadata = event.metadata;

        // Skip if no instance ID
        if (!metadata.instanceId) {
          log.debug('Skipping message without instanceId', { externalId: payload.externalId });
          return;
        }

        // The trusted tenant for this work item, read from the producer-stamped
        // envelope and NEVER from the payload (G5, ADR-0008). It is threaded into
        // the handler so the fire-and-forget writes it spawns can open their own
        // scopes; the awaited work is wrapped below.
        const classification = classifyEnvelope(metadata);
        // Refused HERE, not merely inside `runConsumerInTenantContext` below:
        // the identity resolution is hoisted ahead of that call, so the
        // quarantine check has to come ahead of BOTH or a malformed envelope
        // would get one write in before being rejected.
        if (classification.world === 'quarantine') {
          throw new WorkerTenantContextError(`refusing to process a quarantined envelope (${classification.reason})`);
        }
        const trustedTenantId = classification.world === 'tenant' ? classification.tenantId : null;
        // Captured before the closure below: TypeScript drops the narrowing from
        // the `!metadata.instanceId` guard across a callback boundary.
        const instanceId = metadata.instanceId;

        try {
          const workMetadata = { ...metadata, instanceId };
          // Resolved BEFORE the persistence transaction opens — its own work
          // item, its own scope, G6-gated (see the function's header).
          const identity = await resolveSenderIdentityForWorkItem(
            services,
            payload,
            workMetadata,
            (metadata.channelType ?? 'whatsapp') as ChannelType,
            trustedTenantId,
          );
          await runConsumerInTenantContext(services.db, event, () =>
            handleMessageReceived(services, payload, workMetadata, event.timestamp, trustedTenantId, identity),
          );
          // Sentry metric: message received count by channel
          if (sentryEnabled()) {
            Sentry.metrics.count('messages.received', 1, {
              attributes: { channel_type: metadata.channelType ?? 'whatsapp' },
            });
          }
          // Track consumer offset after successful processing
          if (metadata.streamSequence) {
            await services.consumerOffsets.updateOffset(
              'message-persistence-received',
              'MESSAGE',
              metadata.streamSequence,
              event.id,
            );
          }
        } catch (error) {
          logMessageReceivedError(payload, error);
          throw error;
        }
      },
      {
        durable: 'message-persistence-received',
        queue: 'message-persistence',
        maxRetries: 3,
        retryDelayMs: 1000,
        startFrom: 'first',
        concurrency: 10, // Process up to 10 messages in parallel
      },
    );

    // Subscribe to message.sent with durable consumer
    await eventBus.subscribe(
      'message.sent',
      async (event) => {
        const payload = event.payload as MessageSentPayload;
        const metadata = event.metadata;

        try {
          // Skip if no instance ID
          if (!metadata.instanceId) {
            log.debug('Skipping sent message without instanceId', { externalId: payload.externalId });
            return;
          }

          // Truncate IDs for varchar(255) safety
          const chatExternalId = truncate(payload.chatId, 255) ?? payload.chatId;
          const messageExternalId = truncate(payload.externalId, 255) ?? payload.externalId;

          const sentInstanceId = metadata.instanceId;
          const sentClassification = classifyEnvelope(metadata);
          const sentTenantId = sentClassification.world === 'tenant' ? sentClassification.tenantId : null;

          // The chat + message writes are one work item: one worker transaction.
          const { chat, message, created } = await runConsumerInTenantContext(services.db, event, async () => {
            // Find or create chat
            const { chat } = await services.chats.findOrCreate(sentInstanceId, chatExternalId, {
              chatType: inferChatType(payload.chatId),
              channel: (metadata.channelType ?? 'whatsapp') as ChannelType,
            });

            const sentContent = buildSentMessageContentFields(payload);

            // Create message (sent by us)
            const { message, created } = await services.messages.findOrCreate(chat.id, messageExternalId, {
              source: 'realtime',
              messageType: mapContentType(payload.content.type),
              textContent: sentContent.textContent,
              platformTimestamp: new Date(event.timestamp),
              // Sender info (from us)
              senderPersonId: metadata.personId,
              senderPlatformIdentityId: metadata.platformIdentityId,
              isFromMe: true,
              senderAgentId: (payload as MessageSentPayload & { senderAgentId?: string }).senderAgentId ?? null,
              // Media
              hasMedia: sentContent.hasMedia,
              mediaMimeType: sentContent.mediaMimeType,
              mediaUrl: sentContent.mediaUrl,
              mediaLocalPath: sentContent.mediaLocalPath,
              mediaMetadata: sentContent.mediaMetadata,
              rawPayload: sentContent.rawPayload,
              // Reply info - truncate varchar(255) fields
              replyToExternalId: truncate(payload.replyToId, 255),
              // Thread (#889) — keep outbound symmetric with inbound, otherwise
              // our own thread replies read back as top-level channel messages.
              threadExternalId: truncate(payload.threadId, 255),
            });

            return { chat, message, created };
          });

          if (created) {
            log.debug('Created sent message', {
              messageId: message.id,
              externalId: payload.externalId,
              chatId: chat.id,
            });
          }

          // Update chat recency — marks lastMessageFromMe=true so the chat no longer
          // shows as pending/attention-needing after we send a reply.
          // Unawaited: own worker scope, never the transaction that just committed.
          runTenantWorkDb(services.db, sentTenantId, () =>
            services.chats.updateLastMessage(
              chat.id,
              sanitizeText(buildSentChatPreview(payload)) ?? '',
              new Date(event.timestamp),
              true,
            ),
          ).catch((err: unknown) => log.debug('Failed to update chat recency (sent)', { error: String(err) }));

          // Track consumer offset after successful processing
          if (metadata.streamSequence) {
            await services.consumerOffsets.updateOffset(
              'message-persistence-sent',
              'MESSAGE',
              metadata.streamSequence,
              event.id,
            );
          }
        } catch (error) {
          log.error('Failed to persist message.sent to unified model', {
            externalId: payload.externalId,
            error: String(error),
          });
          throw error;
        }
      },
      {
        durable: 'message-persistence-sent',
        queue: 'message-persistence',
        maxRetries: 3,
        retryDelayMs: 1000,
        startFrom: 'first',
        concurrency: 10,
      },
    );

    // Subscribe to message.delivered - update delivery status
    await eventBus.subscribe(
      'message.delivered',
      async (event) => {
        const payload = event.payload as { externalId: string; chatId: string; deliveredAt: number };
        const metadata = event.metadata;

        try {
          if (!metadata.instanceId) return;

          // Skip internal WhatsApp JIDs (device sync, broadcasts, newsletters)
          if (isInternalWhatsAppJid(payload.chatId)) return;
          const deliveredInstanceId = metadata.instanceId;

          // Lookup + status update are one work item: one worker transaction.
          await runConsumerInTenantContext(services.db, event, async () => {
            // Find the chat (use smart lookup to handle LID/phone JID resolution)
            const chat = await services.chats.findByExternalIdSmart(deliveredInstanceId, payload.chatId);
            if (!chat) {
              log.debug('Chat not found for message.delivered', { chatId: payload.chatId });
              return;
            }

            // Find the message
            const message = await services.messages.getByExternalId(chat.id, payload.externalId);
            if (!message) {
              log.debug('Message not found for message.delivered', { externalId: payload.externalId });
              return;
            }

            // Update delivery status
            await services.messages.updateDeliveryStatus(message.id, 'delivered');
            log.debug('Updated message delivery status', { messageId: message.id, status: 'delivered' });
          });
        } catch (error) {
          log.error('Failed to update delivery status', {
            externalId: payload.externalId,
            error: String(error),
          });
          // Note: Not re-throwing - delivery status updates are non-critical
          // If they fail, the message is still stored, just status may be stale
        }
      },
      {
        durable: 'message-persistence-delivered',
        queue: 'message-persistence',
        maxRetries: 2,
        retryDelayMs: 500,
        startFrom: 'first',
        concurrency: 10,
      },
    );

    // Subscribe to message.read - update delivery status
    await eventBus.subscribe(
      'message.read',
      async (event) => {
        const payload = event.payload as { externalId: string; chatId: string; readAt: number };
        const metadata = event.metadata;

        try {
          if (!metadata.instanceId) return;

          // Skip internal WhatsApp JIDs (device sync, broadcasts, newsletters)
          if (isInternalWhatsAppJid(payload.chatId)) return;
          const readInstanceId = metadata.instanceId;

          // Lookup + status update are one work item: one worker transaction.
          await runConsumerInTenantContext(services.db, event, async () => {
            // Find the chat (use smart lookup to handle LID/phone JID resolution)
            const chat = await services.chats.findByExternalIdSmart(readInstanceId, payload.chatId);
            if (!chat) {
              log.debug('Chat not found for message.read', { chatId: payload.chatId });
              return;
            }

            // Find the message
            const message = await services.messages.getByExternalId(chat.id, payload.externalId);
            if (!message) {
              log.debug('Message not found for message.read', { externalId: payload.externalId });
              return;
            }

            // Update delivery status to read
            await services.messages.updateDeliveryStatus(message.id, 'read');
            log.debug('Updated message delivery status', { messageId: message.id, status: 'read' });
          });
        } catch (error) {
          log.error('Failed to update read status', {
            externalId: payload.externalId,
            error: String(error),
          });
          // Note: Not re-throwing - read status updates are non-critical
        }
      },
      {
        durable: 'message-persistence-read',
        queue: 'message-persistence',
        maxRetries: 2,
        retryDelayMs: 500,
        startFrom: 'first',
        concurrency: 10,
      },
    );

    // Subscribe to instance.connected for post-reconnect backfill detection
    await eventBus.subscribe(
      'instance.connected',
      async (event) => {
        const payload = event.payload as { instanceId: string };
        const instanceId = payload.instanceId;
        if (!instanceId) return;

        // Classified once for the whole handler: the `instances` read below runs
        // in a worker scope, while `syncJobs.create` (which PUBLISHES) stays
        // outside it — holding a transaction across a publish would make the
        // event a pre-commit side effect (a phantom on rollback).
        const reconnectClassification = classifyEnvelope(event.metadata);
        const reconnectTenantId = reconnectClassification.world === 'tenant' ? reconnectClassification.tenantId : null;
        if (reconnectClassification.world === 'quarantine') {
          throw new Error(
            `message-persistence: refusing a quarantined instance.connected envelope (${reconnectClassification.reason})`,
          );
        }

        try {
          const lastMessageAt = await runTenantWorkDb(services.db, reconnectTenantId, () =>
            services.instances.getLastMessageAt(instanceId),
          );
          if (!lastMessageAt) return;

          const gapMs = Date.now() - lastMessageAt.getTime();
          const gapMinutes = Math.round(gapMs / 60_000);

          // In dev mode, use higher threshold (60 min) to avoid spam on frequent restarts
          const isDev = process.env.NODE_ENV === 'development';
          const gapThresholdMs = isDev ? 60 * 60 * 1000 : 5 * 60 * 1000; // 60 min in dev, 5 min in prod

          // Only trigger backfill if gap exceeds threshold
          if (gapMs > gapThresholdMs) {
            const channelType = event.metadata.channelType ?? ('whatsapp-baileys' as ChannelType);

            // Discord sync requires a specific channelId — skip auto-backfill
            // (users can trigger per-channel sync manually via POST /instances/:id/sync)
            if (channelType === 'discord') {
              log.info('Instance reconnected with message gap (Discord — skipping auto-backfill, use manual sync)', {
                instanceId,
                gapMinutes,
              });
            } else {
              log.warn('Instance reconnected with message gap', {
                instanceId,
                lastMessageAt: lastMessageAt.toISOString(),
                gapMinutes,
              });

              // Create a sync job (inserts DB row + publishes sync.started event).
              // The job is created for the RECONNECTED INSTANCE's tenant, taken
              // from the `instance.connected` envelope the producer stamped
              // (G5, ADR-0008) — never from the payload. A legacy envelope
              // threads null and the create runs ambient, byte-identically.
              const job = await services.syncJobs.create({
                instanceId,
                channelType,
                type: 'messages',
                config: {
                  since: lastMessageAt.toISOString(),
                  until: new Date().toISOString(),
                },
                tenantId: reconnectTenantId,
              });

              log.info('Post-reconnect backfill triggered', {
                instanceId,
                jobId: job.id,
                since: lastMessageAt.toISOString(),
                gapMinutes,
              });
            }
          } else {
            log.debug('Instance reconnected, gap within threshold', { instanceId, gapMinutes });
          }
        } catch (error) {
          log.warn('Post-reconnect gap check failed (non-critical)', {
            instanceId,
            error: String(error),
          });
        }
      },
      {
        durable: 'message-persistence-reconnect',
        queue: 'message-persistence',
        maxRetries: 2,
        retryDelayMs: 1000,
        startFrom: 'first',
        concurrency: 5,
      },
    );

    log.info('Message persistence initialized - populating unified chats/messages');

    // Startup gap detection (non-blocking)
    detectStartupGaps(services).catch((error) => {
      log.warn('Startup gap detection failed (non-critical)', { error: String(error) });
    });
  } catch (error) {
    log.error('Failed to set up message persistence', { error: String(error) });
    throw error;
  }
}

/**
 * Detect unprocessed message gaps on startup by comparing
 * stored consumer offsets with current stream state.
 */
async function detectStartupGaps(services: Services): Promise<void> {
  const consumers = [
    'message-persistence-received',
    'message-persistence-sent',
    'message-persistence-delivered',
    'message-persistence-read',
  ];

  for (const consumerName of consumers) {
    const offset = await services.consumerOffsets.getOffset(consumerName);
    if (offset > 0) {
      log.info('Consumer startup offset', { consumer: consumerName, lastSequence: offset });
    }
  }
}
