/**
 * Event Persistence Handler
 *
 * Subscribes to message events and persists them to the omni_events table.
 * This provides the data backing for the /events API endpoints.
 *
 * TENANT CONTEXT (G5, ADR-0008)
 * -----------------------------
 * These are consumer-only handlers — a NATS subscription, no request, no
 * credential. Each handler's DB work now runs through
 * `runConsumerInTenantContext(db, event, ...)`, which reads the versioned
 * envelope and, when it carries a trusted tenant, opens a fresh worker tenant
 * scope so the `omni_events` insert and the `chats` lookup are RLS-policed to
 * that tenant. A legacy envelope (no tenant) runs the same body on the ambient
 * pool exactly as before — the dual-world contract — and a quarantined envelope
 * never reaches here (the subscription layer rejects it first). All queries go
 * through `scopedHandle(db)`, which returns the worker transaction in-scope and
 * the ambient pool otherwise; the `omni_events` tenant_id is set by the
 * BEFORE INSERT derivation trigger, so no column is added here.
 */

import type { EventBus, MessageReceivedPayload, MessageSentPayload, ReactionReceivedPayload } from '@omni/core';
import { JOURNEY_STAGES, createLogger, getJourneyTracker, isValidUuid } from '@omni/core';
import type { Database, NewOmniEvent } from '@omni/db';
import { type ChannelType, type ContentType, channelTypes, chats, contentTypes, omniEvents, persons } from '@omni/db';
import { and, eq } from 'drizzle-orm';
import { ChatService } from '../services/chats';
import { scopedHandle } from '../tenancy/tenant-scope';
import { runConsumerInTenantContext } from '../tenancy/worker-tenant-context';
import { deepSanitize, sanitizeText } from '../utils/utf8';

const log = createLogger('event-persistence');

/**
 * Safely map channel type - defaults to 'discord' if unknown
 * (all events should have a valid channel type from metadata)
 */
function mapChannelType(channelType: string | undefined): ChannelType {
  if (channelType && (channelTypes as readonly string[]).includes(channelType)) {
    return channelType as ChannelType;
  }
  // Default fallback - should rarely happen as metadata should have channelType
  return 'discord';
}

/**
 * Safely map content type - returns null if not in the DB's supported list
 */
function mapContentType(contentType: string | undefined): ContentType | null {
  if (contentType && (contentTypes as readonly string[]).includes(contentType)) {
    return contentType as ContentType;
  }
  // Return null for unsupported types (poll, poll_update, etc.)
  return null;
}

function eventIdInsert(eventId: string | undefined): Partial<Pick<NewOmniEvent, 'id'>> {
  return eventId && isValidUuid(eventId) ? { id: eventId } : {};
}

type ChatLink = { chatUuid: string | null; canonicalChatId: string | null };
const NO_CHAT_LINK: ChatLink = { chatUuid: null, canonicalChatId: null };

/**
 * Resolve the chats row for a given instance + platform JID (chatId).
 * Goes through ChatService.findByExternalIdSmart so a WhatsApp `@lid` chat id
 * links to the phone-form chat the message pipeline routed it to (via
 * canonicalId or chat_id_mappings) instead of journaling unlinked (#1035).
 * Best-effort: returns an empty link if the chat doesn't exist yet or the
 * lookup fails. Never throws — event persistence must not fail because of this.
 */
async function resolveChatLink(
  db: Database,
  instanceId: string | undefined,
  chatId: string | undefined,
): Promise<ChatLink> {
  if (!instanceId || !chatId) return NO_CHAT_LINK;
  try {
    const chat = await new ChatService(db, null).findByExternalIdSmart(instanceId, chatId);
    return chat ? { chatUuid: chat.id, canonicalChatId: chat.canonicalId ?? null } : NO_CHAT_LINK;
  } catch {
    return NO_CHAT_LINK; // best-effort — never fail event persistence because of this
  }
}

/**
 * Best-effort person resolution for custom journal rows (#966): accept a
 * personId claim only when it is a valid UUID AND the persons row exists —
 * person_id carries an FK, and a bogus claim must not fail the whole insert.
 * Never throws.
 */
async function resolvePersonId(db: Database, candidate: unknown): Promise<string | null> {
  if (typeof candidate !== 'string' || !isValidUuid(candidate)) return null;
  try {
    const [person] = await db.select({ id: persons.id }).from(persons).where(eq(persons.id, candidate)).limit(1);
    return person?.id ?? null;
  } catch {
    return null; // best-effort — never fail event persistence because of this
  }
}

/** Same FK-safe contract for a direct chats.id claim (payload.chatUuid). */
async function resolveChatUuidById(db: Database, candidate: unknown): Promise<string | null> {
  if (typeof candidate !== 'string' || !isValidUuid(candidate)) return null;
  try {
    const [chat] = await db.select({ id: chats.id }).from(chats).where(eq(chats.id, candidate)).limit(1);
    return chat?.id ?? null;
  } catch {
    return null; // best-effort — never fail event persistence because of this
  }
}

/** Shared consumer options for event persistence */
const CONSUMER_OPTIONS = {
  queue: 'event-persistence',
  maxRetries: 3,
  retryDelayMs: 1000,
  startFrom: 'first' as const,
  concurrency: 10,
};

/**
 * Set up event persistence - subscribes to message events and writes to omni_events
 */
export async function setupEventPersistence(eventBus: EventBus, db: Database): Promise<void> {
  try {
    // Subscribe to message.received
    await eventBus.subscribe(
      'message.received',
      async (event) => {
        const payload = event.payload as MessageReceivedPayload;
        const metadata = event.metadata;

        // T3: Event consumed from NATS — record journey checkpoint
        const t3 = Date.now();
        if (metadata.timings && metadata.correlationId) {
          const tracker = getJourneyTracker();
          tracker.recordCheckpoint(metadata.correlationId, 'T3', JOURNEY_STAGES.T3, t3);
        }

        try {
          await runConsumerInTenantContext(db, event, async () => {
            const sdb = scopedHandle(db);
            const chatLink = await resolveChatLink(sdb, metadata.instanceId, payload.chatId);

            const columns: Omit<NewOmniEvent, 'id'> = {
              externalId: payload.externalId,
              channel: mapChannelType(metadata.channelType),
              instanceId: metadata.instanceId,
              personId: metadata.personId,
              platformIdentityId: metadata.platformIdentityId,
              eventType: 'message.received',
              // #1034: own-device echoes (owner typing on their phone) arrive as
              // message.received with rawPayload.isFromMe=true. Journal them as
              // outbound so `message.received` + `inbound` means "someone else wrote to us".
              direction: payload.rawPayload?.isFromMe === true ? 'outbound' : 'inbound',
              contentType: mapContentType(payload.content.type),
              textContent: sanitizeText(payload.content.text),
              mediaUrl: payload.content.mediaUrl,
              mediaMimeType: payload.content.mimeType,
              chatId: payload.chatId,
              replyToExternalId: payload.replyToId,
              status: 'received',
              receivedAt: new Date(event.timestamp),
              rawPayload: payload.rawPayload ? deepSanitize(payload.rawPayload) : undefined,
              metadata: {
                correlationId: metadata.correlationId,
                from: payload.from,
              },
              agentId: metadata.agentId ?? null,
              causationId: metadata.causationId ?? null,
              conversationId: null,
              ...chatLink,
            };

            // Upsert on id (#1032): the channel ingress claim (`createIngressClaim`)
            // inserted a skeletal row under this id before the publish; fill it
            // in here. A NATS redelivery rewrites identical values — still one row.
            await sdb
              .insert(omniEvents)
              .values({ ...eventIdInsert(event.id), ...columns })
              .onConflictDoUpdate({ target: omniEvents.id, set: columns });
          });

          // T4: Message stored in database — record journey checkpoint
          if (metadata.timings && metadata.correlationId) {
            const tracker = getJourneyTracker();
            tracker.recordCheckpoint(metadata.correlationId, 'T4', JOURNEY_STAGES.T4);
          }

          log.debug('Persisted message.received', {
            externalId: payload.externalId,
            instanceId: metadata.instanceId,
          });
        } catch (error) {
          log.error('Failed to persist message.received', {
            externalId: payload.externalId,
            error: String(error),
          });
        }
      },
      { ...CONSUMER_OPTIONS, durable: 'event-persistence-received' },
    );

    // Subscribe to message.sent
    await eventBus.subscribe(
      'message.sent',
      async (event) => {
        const payload = event.payload as MessageSentPayload;
        const metadata = event.metadata;

        try {
          await runConsumerInTenantContext(db, event, async () => {
            const sdb = scopedHandle(db);
            const chatLink = await resolveChatLink(sdb, metadata.instanceId, payload.chatId);

            const newEvent: NewOmniEvent = {
              ...eventIdInsert(event.id),
              externalId: payload.externalId,
              channel: mapChannelType(metadata.channelType),
              instanceId: metadata.instanceId,
              personId: metadata.personId,
              platformIdentityId: metadata.platformIdentityId,
              eventType: 'message.sent',
              direction: 'outbound',
              contentType: mapContentType(payload.content.type),
              textContent: sanitizeText(payload.content.text ?? payload.content.caption),
              mediaUrl: payload.content.mediaUrl,
              mediaMimeType: payload.content.mimeType,
              chatId: payload.chatId,
              replyToExternalId: payload.replyToId,
              status: 'completed',
              receivedAt: new Date(event.timestamp),
              processedAt: new Date(),
              rawPayload: payload.rawPayload ? deepSanitize(payload.rawPayload) : undefined,
              metadata: {
                correlationId: metadata.correlationId,
                to: payload.to,
                filename: payload.content.filename,
                voiceNote: payload.content.isVoiceNote,
              },
              agentId: metadata.agentId ?? null,
              causationId: metadata.causationId ?? null,
              conversationId: null,
              ...chatLink,
            };

            await sdb.insert(omniEvents).values(newEvent).onConflictDoNothing({ target: omniEvents.id });
          });
          log.debug('Persisted message.sent', {
            externalId: payload.externalId,
            instanceId: metadata.instanceId,
          });
        } catch (error) {
          log.error('Failed to persist message.sent', {
            externalId: payload.externalId,
            error: String(error),
          });
        }
      },
      { ...CONSUMER_OPTIONS, durable: 'event-persistence-sent' },
    );

    // Subscribe to message.delivered - update existing event
    await eventBus.subscribe(
      'message.delivered',
      async (event) => {
        const payload = event.payload as { externalId: string; chatId: string; deliveredAt: number };
        const metadata = event.metadata;

        try {
          await runConsumerInTenantContext(db, event, async () => {
            const sdb = scopedHandle(db);
            // Try to update existing event, or create new record
            const updated = await sdb
              .update(omniEvents)
              .set({
                deliveredAt: new Date(payload.deliveredAt),
                status: 'completed',
              })
              .where(eq(omniEvents.externalId, payload.externalId))
              .returning();

            if (updated.length === 0) {
              // No existing event found, create a new record
              const chatLink = await resolveChatLink(sdb, metadata.instanceId, payload.chatId);
              const newEvent: NewOmniEvent = {
                ...eventIdInsert(event.id),
                externalId: payload.externalId,
                channel: mapChannelType(metadata.channelType),
                instanceId: metadata.instanceId,
                eventType: 'message.delivered',
                direction: 'outbound',
                chatId: payload.chatId,
                status: 'completed',
                receivedAt: new Date(event.timestamp),
                deliveredAt: new Date(payload.deliveredAt),
                agentId: metadata.agentId ?? null,
                causationId: metadata.causationId ?? null,
                conversationId: null,
                ...chatLink,
              };
              await sdb.insert(omniEvents).values(newEvent).onConflictDoNothing({ target: omniEvents.id });
            }
          });

          log.debug('Persisted message.delivered', {
            externalId: payload.externalId,
          });
        } catch (error) {
          log.error('Failed to persist message.delivered', {
            externalId: payload.externalId,
            error: String(error),
          });
        }
      },
      { ...CONSUMER_OPTIONS, durable: 'event-persistence-delivered' },
    );

    // Subscribe to message.read - update existing event
    await eventBus.subscribe(
      'message.read',
      async (event) => {
        const payload = event.payload as { externalId: string; chatId: string; readAt: number };
        const metadata = event.metadata;

        try {
          await runConsumerInTenantContext(db, event, async () => {
            const sdb = scopedHandle(db);
            const updated = await sdb
              .update(omniEvents)
              .set({
                readAt: new Date(payload.readAt),
              })
              .where(eq(omniEvents.externalId, payload.externalId))
              .returning();

            if (updated.length === 0) {
              // No existing event found, create a new record
              const chatLink = await resolveChatLink(sdb, metadata.instanceId, payload.chatId);
              const newEvent: NewOmniEvent = {
                ...eventIdInsert(event.id),
                externalId: payload.externalId,
                channel: mapChannelType(metadata.channelType),
                instanceId: metadata.instanceId,
                eventType: 'message.read',
                direction: 'outbound',
                chatId: payload.chatId,
                status: 'completed',
                receivedAt: new Date(event.timestamp),
                readAt: new Date(payload.readAt),
                agentId: metadata.agentId ?? null,
                causationId: metadata.causationId ?? null,
                conversationId: null,
                ...chatLink,
              };
              await sdb.insert(omniEvents).values(newEvent).onConflictDoNothing({ target: omniEvents.id });
            }
          });

          log.debug('Persisted message.read', {
            externalId: payload.externalId,
          });
        } catch (error) {
          log.error('Failed to persist message.read', {
            externalId: payload.externalId,
            error: String(error),
          });
        }
      },
      { ...CONSUMER_OPTIONS, durable: 'event-persistence-read' },
    );

    // Subscribe to message.failed
    await eventBus.subscribe(
      'message.failed',
      async (event) => {
        const payload = event.payload as {
          externalId?: string;
          chatId: string;
          error: string;
          errorCode?: string;
          retryable: boolean;
        };
        const metadata = event.metadata;

        try {
          const updatedRows = await runConsumerInTenantContext(db, event, async () => {
            const sdb = scopedHandle(db);
            // Async failures (e.g. WhatsApp PreKeyError surfaced minutes after a
            // server-ACKed send) arrive AFTER the original message.sent row was
            // already persisted with status='completed'. Flip the existing row
            // to 'failed' instead of inserting a parallel record so the audit
            // trail stays unambiguous. Match on instance+externalId; fall back
            // to insert when no original row exists (synchronous failures).
            let updated: { id: string }[] = [];
            if (payload.externalId && metadata.instanceId) {
              updated = await sdb
                .update(omniEvents)
                .set({
                  status: 'failed',
                  errorMessage: payload.error,
                  errorStage: payload.errorCode,
                  metadata: {
                    correlationId: metadata.correlationId,
                    retryable: payload.retryable,
                  },
                })
                .where(
                  and(eq(omniEvents.instanceId, metadata.instanceId), eq(omniEvents.externalId, payload.externalId)),
                )
                .returning({ id: omniEvents.id });
            }

            if (updated.length === 0) {
              // No existing message.sent row to flip — synchronous failure path.
              // Insert a fresh failed row, mirroring the message.read subscriber
              // pattern (eventIdInsert for replay-safe deterministic id +
              // onConflictDoNothing on id for idempotency).
              const chatLink = await resolveChatLink(sdb, metadata.instanceId, payload.chatId);
              const newEvent: NewOmniEvent = {
                ...eventIdInsert(event.id),
                externalId: payload.externalId,
                channel: mapChannelType(metadata.channelType),
                instanceId: metadata.instanceId,
                personId: metadata.personId,
                eventType: 'message.failed',
                direction: 'outbound',
                chatId: payload.chatId,
                status: 'failed',
                errorMessage: payload.error,
                errorStage: payload.errorCode,
                receivedAt: new Date(event.timestamp),
                metadata: {
                  correlationId: metadata.correlationId,
                  retryable: payload.retryable,
                },
                agentId: metadata.agentId ?? null,
                causationId: metadata.causationId ?? null,
                conversationId: null,
                ...chatLink,
              };
              await sdb.insert(omniEvents).values(newEvent).onConflictDoNothing({ target: omniEvents.id });
            }
            return updated.length;
          });

          log.debug('Persisted message.failed', {
            chatId: payload.chatId,
            externalId: payload.externalId,
            updatedRows,
            error: payload.error,
          });
        } catch (error) {
          log.error('Failed to persist message.failed', {
            chatId: payload.chatId,
            error: String(error),
          });
        }
      },
      { ...CONSUMER_OPTIONS, durable: 'event-persistence-failed' },
    );

    // Subscribe to reaction.received / reaction.removed (#1059). Reactions
    // live on the REACTION stream, not MESSAGE, so none of the subscribers
    // above ever saw them; once #1045 stopped dual-emitting them as
    // message.received they vanished from the journal entirely. Each gets its
    // own row (a reaction is a fact, not a mutation of the target row):
    // externalId is the target message id so --message filters still match.
    for (const type of ['reaction.received', 'reaction.removed'] as const) {
      await eventBus.subscribe(
        type,
        async (event) => {
          const payload = event.payload as ReactionReceivedPayload;
          const metadata = event.metadata;
          try {
            await runConsumerInTenantContext(db, event, async () => {
              const sdb = scopedHandle(db);
              const chatLink = await resolveChatLink(sdb, metadata.instanceId, payload.chatId);
              const personId = await resolvePersonId(sdb, metadata.personId);
              const newEvent: NewOmniEvent = {
                ...eventIdInsert(event.id),
                externalId: payload.messageId,
                channel: mapChannelType(metadata.channelType),
                instanceId: metadata.instanceId,
                personId,
                eventType: type,
                chatId: payload.chatId,
                contentType: 'reaction',
                textContent: sanitizeText(payload.emoji),
                // #1034 convention: own-account reactions (from the phone) are outbound
                direction: payload.rawPayload?.isFromMe === true ? 'outbound' : 'inbound',
                status: 'completed',
                receivedAt: new Date(event.timestamp),
                rawPayload: deepSanitize({ ...payload, rawPayload: payload.rawPayload ?? null }),
                metadata: { correlationId: metadata.correlationId, from: payload.from, emoji: payload.emoji },
                causationId: metadata.causationId ?? null,
                conversationId: null,
                ...chatLink,
              };
              await sdb.insert(omniEvents).values(newEvent).onConflictDoNothing({ target: omniEvents.id });
            });
            log.debug(`Persisted ${type}`, { messageId: payload.messageId, emoji: payload.emoji });
          } catch (error) {
            log.error(`Failed to persist ${type}`, { messageId: payload.messageId, error: String(error) });
          }
        },
        { ...CONSUMER_OPTIONS, durable: `event-persistence-${type.replace('.', '-')}` },
      );
    }

    // Subscribe to ALL custom events (#957). Webhook ingress roots and
    // automation emit_event hops live on the CUSTOM stream but were never
    // journaled, so `omni events trace` could not include the root ingress
    // event or any intermediate hop — the chain existed only in NATS
    // retention. Each custom event gets a minimal row: identity, causality
    // (causation_id column + correlationId in the metadata jsonb), and the
    // payload for debugging. channel is 'internal' (there is no channel-side
    // fact here) and the eventType is truncated to the column's 255 chars
    // (#966 — a stale 50-char cap silently broke exact-match type filters
    // for longer custom.webhook.{source}.{event} types after #958 widened
    // the column). chatUuid and personId are mapped best-effort from the
    // envelope metadata / payload (see the inline comment) so the CLI's
    // --chat-id / --person-id filters can match custom events too.
    await eventBus.subscribePattern(
      'custom.>',
      async (event) => {
        const metadata = event.metadata;
        try {
          await runConsumerInTenantContext(db, event, async () => {
            const sdb = scopedHandle(db);
            const payload =
              typeof event.payload === 'object' && event.payload !== null
                ? (event.payload as Record<string, unknown>)
                : {};
            const instanceId = metadata.instanceId && isValidUuid(metadata.instanceId) ? metadata.instanceId : null;
            const payloadChatId = typeof payload.chatId === 'string' ? payload.chatId : undefined;

            // #966: best-effort identity mapping so --chat-id/--person-id
            // filters can match custom events. personId: metadata.personId
            // (publisher claim) first, then payload.personId — either must
            // reference an existing persons row (FK safety). chatUuid:
            // payload.chatUuid (a chats.id UUID) first, then payload.chatId
            // (a platform JID) resolved against the instance like the
            // message subscribers do.
            const personId =
              (await resolvePersonId(sdb, metadata.personId)) ?? (await resolvePersonId(sdb, payload.personId));
            const chatUuid = await resolveChatUuidById(sdb, payload.chatUuid);
            const chatLink = chatUuid
              ? { chatUuid, canonicalChatId: null }
              : await resolveChatLink(sdb, instanceId ?? undefined, payloadChatId);

            const newEvent: NewOmniEvent = {
              ...eventIdInsert(event.id),
              channel: 'internal',
              instanceId,
              personId,
              eventType: event.type.slice(0, 255) as NewOmniEvent['eventType'],
              direction: 'internal',
              status: 'completed',
              receivedAt: new Date(event.timestamp),
              rawPayload: deepSanitize(payload),
              metadata: {
                correlationId: metadata.correlationId,
                source: metadata.source,
                fullEventType: event.type,
              },
              causationId: metadata.causationId ?? null,
              conversationId: null,
              chatId: payloadChatId,
              ...chatLink,
            };
            await sdb.insert(omniEvents).values(newEvent).onConflictDoNothing({ target: omniEvents.id });
          });
        } catch (error) {
          log.error('Failed to persist custom event', {
            eventType: event.type,
            eventId: event.id,
            error: String(error),
          });
        }
      },
      // startFrom 'new', unlike the message subscribers: #957 is explicitly
      // forward-only — replaying the whole CUSTOM stream retention on first
      // deploy would journal thousands of historical events that can never
      // carry a causation parent.
      { ...CONSUMER_OPTIONS, durable: 'event-persistence-custom', startFrom: 'new' },
    );

    log.info('Event persistence initialized - listening for message events');
  } catch (error) {
    log.error('Failed to set up event persistence', { error: String(error) });
    throw error;
  }
}
