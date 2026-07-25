/**
 * Session Cleaner Plugin
 *
 * Listens for trash emoji messages and clears the agent session.
 * When a user sends only a trash emoji (🗑️ or 🗑), their conversation
 * history with the agent is cleared via DELETE /sessions/{identity}.
 * Sends a confirmation message and blocks agent response.
 */

import type { EventBus, OmniEvent, TypedOmniEvent } from '@omni/core';
import { classifyEnvelope, createAgnoClient, createLogger } from '@omni/core';
import type { ChannelType, Database } from '@omni/db';
import { agents, chatParticipants } from '@omni/db';
import { and, eq } from 'drizzle-orm';
import { withIdempotency } from '../lib/idempotency';
import type { Services } from '../services';
import { type ResolvedAgentSessionIdentity, resolveKhalSessionId } from '../services/agent-session-identity';
import { scopedHandle } from '../tenancy/tenant-scope';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';
import { applyAgentFkOverrides, resolveProvider } from './agent-dispatcher';
import { getPlugin } from './loader';

const log = createLogger('session-cleaner');

/**
 * Classify the consumed envelope once and return the trusted tenant to thread
 * through the cleanup's DB blocks, or `null` for a legacy envelope. Throws on a
 * quarantined envelope — processing it globally is the fallback ADR-0008 forbids
 * (defense in depth: the subscription layer already terms it first). The tenant
 * is read ONLY from the producer-stamped metadata, never from payload fields.
 */
function trustedTenantOf(event: Pick<OmniEvent, 'metadata'>): string | null {
  const classification = classifyEnvelope(event.metadata);
  if (classification.world === 'quarantine') {
    throw new Error(`session-cleaner: refusing quarantined envelope (${classification.reason})`);
  }
  return classification.world === 'tenant' ? classification.tenantId : null;
}

/**
 * Check if message contains only trash emoji
 */
function isTrashEmojiOnly(text: string | undefined): boolean {
  if (!text) return false;

  // Remove whitespace and check if only trash emoji
  const trimmed = text.trim();

  // Match trash can emoji variations
  const trashEmojiPattern = /^[\uFE0F\u200D]*(?:🗑️|🗑)[\uFE0F\u200D]*$/u;

  return trashEmojiPattern.test(trimmed);
}

/**
 * Send a message via channel plugin.
 *
 * The instance lookup is one discrete scoped read (G5, ADR-0008): the
 * consumer caller threads the envelope tenant so a tenant-world cleanup
 * resolves the channel under a short worker scope; nothing threaded reads the
 * ambient pool byte-identically. The plugin network call stays OUTSIDE the
 * scope — a worker transaction must never span a channel send.
 */
async function sendMessage(
  services: Services,
  db: Database,
  instanceId: string,
  chatId: string,
  text: string,
  trustedTenantId?: string | null,
): Promise<void> {
  const instance = await runTenantWorkDb(db, trustedTenantId, () => services.instances.getById(instanceId));
  const channel = instance.channel as ChannelType;
  const plugin = await getPlugin(channel);
  if (plugin) {
    await plugin.sendMessage(instanceId, {
      to: chatId,
      content: { type: 'text', text },
    });
  }
}

/**
 * The `chat_participants` read of the cleanup path, extracted so the two-tenant
 * probe can exercise the EXACT query the consumer issues rather than a replica
 * of it. Callers supply the world (see `resolveCleanupPersonId`).
 */
async function readChatParticipant(
  db: Database,
  chatId: string,
  platformUserId: string,
): Promise<{ personId: string | null } | undefined> {
  const [participant] = await scopedHandle(db)
    .select({ personId: chatParticipants.personId })
    .from(chatParticipants)
    .where(and(eq(chatParticipants.chatId, chatId), eq(chatParticipants.platformUserId, platformUserId)))
    .limit(1);
  return participant;
}

/**
 * Clear agent session for the given user and chat.
 * Tries IAgentProvider.resetSession() first (supports OpenClaw, Webhook, etc.),
 * falls back to direct AgnoOS client for legacy.
 */
async function resolveCleanupPersonId(
  services: Services,
  db: Database,
  instanceId: string,
  chatId: string,
  from: string,
  metadataPersonId?: string,
  trustedTenantId?: string | null,
): Promise<string | undefined> {
  if (metadataPersonId?.trim()) return metadataPersonId.trim();

  // Discrete DB block in the caller's world (G5, ADR-0008): threaded a tenant
  // opens a short worker scope; threaded nothing (legacy consumer / route
  // request scope) runs byte-identically via `runTenantWorkDb`'s passthrough.
  const dbChat = await runTenantWorkDb(db, trustedTenantId, () =>
    services.chats.findByExternalIdSmart(instanceId, chatId),
  );
  if (!dbChat?.id) return undefined;

  // G5-CONVERTED. The participant read runs through `scopedHandle` inside the
  // same threaded world as the chat lookup above. `chat_participants` derives its
  // tenant from the REQUIRED `chat_id` parent, so it is owned by the `instances`
  // root and RLS scopes it — it does NOT need the G6 `persons` backfill, even
  // though `person_id` is the column being read (the column's VALUE is opaque
  // here; only the ROW's visibility is at stake).
  const participant = await runTenantWorkDb(db, trustedTenantId, () => readChatParticipant(db, dbChat.id, from));

  return participant?.personId ?? undefined;
}

/**
 * Clear the agent session for a user/chat.
 *
 * Tenant boundary (G5, ADR-0008): each DISCRETE DB block is wrapped in
 * `runTenantWorkDb(db, trustedTenantId, …)`. The consumer path threads the
 * envelope-derived tenant so every lookup runs in a short worker scope; the
 * route caller (routes/v2/chats.ts) threads NOTHING and relies on its own
 * request scope via `scopedHandle` — `runTenantWorkDb` passes straight through
 * for an undefined tenant, so that path is byte-identical to pre-G5. The
 * provider `resetSession` / Agno `deleteSession` calls are EXTERNAL side effects
 * and are deliberately left outside any scope — a worker transaction must never
 * span them.
 */
export async function clearAgentSession(
  services: Services,
  db: Database,
  instanceId: string,
  from: string,
  chatId: string,
  options: { personId?: string; rawPayload?: Record<string, unknown> } = {},
  trustedTenantId?: string | null,
): Promise<ResolvedAgentSessionIdentity> {
  // Get instance with provider (pure DB lookup → scoped as one block).
  const instance = await runTenantWorkDb(db, trustedTenantId, () =>
    services.agentRunner.getInstanceWithProvider(instanceId),
  );

  if (!instance?.agentId) {
    throw new Error('No agent configured for instance');
  }
  // Narrow the nullable FK to a local BEFORE the closure captures it — TS cannot
  // carry the `!instance.agentId` guard into an arrow that closes over `instance`.
  const agentId = instance.agentId;

  // Resolve agent provider from the agent FK. This `agents` read is a registered
  // `pending-G5-conversion` site; the caller scope is established around it.
  const [agentRow] = await runTenantWorkDb(db, trustedTenantId, () =>
    db.select({ agentProviderId: agents.agentProviderId }).from(agents).where(eq(agents.id, agentId)).limit(1),
  );

  if (!agentRow?.agentProviderId) {
    throw new Error('Agent has no provider configured');
  }
  const agentProviderId = agentRow.agentProviderId;

  // Get provider record from DB (pure DB lookup → scoped as one block).
  const providerRecord = await runTenantWorkDb(db, trustedTenantId, () => services.providers.getById(agentProviderId));

  const personId = await resolveCleanupPersonId(
    services,
    db,
    instanceId,
    chatId,
    from,
    options.personId,
    trustedTenantId,
  );
  const identity = resolveKhalSessionId({
    providerSchema: providerRecord.schema,
    sessionStrategy: instance.agentSessionStrategy ?? 'per_chat',
    from,
    chatId,
    channel: instance.channel,
    instanceId,
    personId,
    rawPayload: options.rawPayload,
  });
  const { sessionId, legacySessionId } = identity;
  const hasKhalContext = !!identity.canonicalSessionId || !!identity.environment || !!options.rawPayload?.khalSessionId;
  if (providerRecord.schema === 'agno' && hasKhalContext && identity.source === 'legacy') {
    throw new Error('Canonical KHAL session resolution failed; refusing blind legacy Agno reset');
  }

  // Try IAgentProvider.resetSession() first (covers OpenClaw, Agno, Claude, etc.)
  // Pass chatId so providers that build their own key format (e.g. OpenClaw)
  // can reconstruct the correct session key instead of using the generic sessionId.
  // Pass instanceId for providers that persist session state scoped by instance.
  // Extend instance with transient dispatch fields required by resolveProvider.
  // applyAgentFkOverrides stamps agentInternalId / agentType / agentProviderId from the
  // Agent entity — without it, providers that require a non-empty agentId (post 2.260430)
  // throw "cannot resolve agentId" and the user sees "Erro ao limpar sessão".
  const dispatchInstance = { ...instance, agentProviderId: agentRow.agentProviderId };
  // applyAgentFkOverrides threads the trusted tenant into its own discrete DB
  // block (via runDispatchDb); no extra wrap here.
  await applyAgentFkOverrides(db, agentId, dispatchInstance, trustedTenantId ?? undefined);
  // `providerRecord`'s secrets were opened inside the worker scope above; this
  // resolution deliberately runs OUTSIDE it (a worker transaction must not span
  // the provider call), so the tenant is threaded rather than read from the
  // ambient scope — otherwise the shared OpenClaw client built with THIS
  // tenant's device key would be pooled in the scope-less bucket and reused by
  // the next tenant (G5; ADR-0008).
  const agentProvider = resolveProvider(providerRecord, dispatchInstance, db, trustedTenantId ?? null);
  if (agentProvider?.resetSession) {
    await agentProvider.resetSession(sessionId, chatId, instanceId);
    if (legacySessionId !== sessionId) {
      await agentProvider.resetSession(legacySessionId, chatId, instanceId);
    }
    return identity;
  }

  // Fallback: direct AgnoOS client
  if (providerRecord.schema !== 'agno') {
    throw new Error(`Session clearing not supported for ${providerRecord.schema} providers`);
  }

  const client = createAgnoClient({
    baseUrl: providerRecord.baseUrl,
    apiKey: providerRecord.apiKey ?? '',
    defaultTimeoutMs: (providerRecord.defaultTimeout ?? 60) * 1000,
  });

  const primaryDelete = await client.deleteSession?.(sessionId);
  const legacyDelete = legacySessionId !== sessionId ? await client.deleteSession?.(legacySessionId) : undefined;
  log.info('Agno session delete verified', {
    instanceId,
    sessionId,
    legacySessionId,
    primaryStatus: primaryDelete?.status,
    primaryExisted: primaryDelete?.existed,
    legacyStatus: legacyDelete?.status,
    legacyExisted: legacyDelete?.existed,
  });

  return identity;
}

/**
 * Set up session cleaner - subscribes to message.received and clears sessions on trash emoji
 */
/**
 * Handle trash emoji message event.
 *
 * Idempotency (#411): the actual cleanup work is wrapped in `withIdempotency`
 * so PM2-restart redeliveries do not re-fire DELETE-session + send-confirmation.
 * The previous in-memory `Set<externalId>` dedupe only worked within one
 * process — incident showed duplicates spanning two restarts (26s apart).
 */
async function handleTrashEmojiMessage(
  services: Services,
  db: Database,
  event: TypedOmniEvent<'message.received'>,
): Promise<void> {
  const { content, chatId } = event.payload;
  const { instanceId } = event.metadata;

  if (!instanceId || !content?.text) return;
  if (!isTrashEmojiOnly(content.text)) return;

  const result = await withIdempotency(db, event.id, 'session-cleaner', async () => {
    await runTrashEmojiCleanup(services, db, event);
  });

  if (!result.executed) {
    log.debug('Trash emoji event already processed (NATS redelivery skipped)', {
      eventId: event.id,
      instanceId,
      chatId,
    });
  }
}

export async function runTrashEmojiCleanup(
  services: Services,
  db: Database,
  event: TypedOmniEvent<'message.received'>,
): Promise<void> {
  const { chatId, from, rawPayload } = event.payload;
  const { instanceId, personId } = event.metadata;
  if (!instanceId) return;

  // Classify the envelope ONCE and refuse quarantine BEFORE any work — the throw
  // must escape (not be swallowed by the error handler below into an "Erro ao
  // limpar sessão" message), so a corrupt/forged tenant does no cleanup at all.
  const tenantId = trustedTenantOf(event);

  log.info('Trash emoji detected, clearing session', { instanceId, chatId, from, personId });

  try {
    const identity = await clearAgentSession(
      services,
      db,
      instanceId,
      from,
      chatId,
      { personId, rawPayload },
      tenantId,
    );
    const { sessionId, legacySessionId, sessionStrategy, source, canonicalSessionId, environment, channelSegment } =
      identity;

    log.info('Session cleared successfully', {
      instanceId,
      sessionId,
      legacySessionId,
      sessionStrategy,
      source,
      canonicalSessionId,
      personId: identity.personId,
      environment,
      channelSegment,
    });

    // Disarm any active follow-up sequence — clearing the session means the
    // user has explicitly reset the conversation; queued follow-ups referencing
    // the cleared context should not fire.
    // Also resume agent if paused (handoff active) — trash emoji from dev/QA
    // is the explicit signal to re-enable the agent and start fresh.
    try {
      const dbChat = await runTenantWorkDb(db, tenantId, () =>
        services.chats.findByExternalIdSmart(instanceId, chatId),
      );
      if (dbChat?.id) {
        // Disarm THREADS the tenant — the lifecycle service scopes its own DB
        // blocks and publishes between them, so wrapping it in one scope here
        // would hold a worker transaction across a publish.
        await services.followUpLifecycle.disarm({
          chatId: dbChat.id,
          instanceId,
          reason: 'session_cleared',
          tenantId,
        });

        // Resume agent if handoff had paused it.
        // Also record agentResumedAt so the dispatcher can drop messages that
        // arrived before the resume (NATS redelivery of pre-handoff messages).
        const isAgentPaused = (dbChat.settings as { agentPaused?: boolean } | null)?.agentPaused === true;
        if (isAgentPaused) {
          // Discrete DB block → scoped. This write sets agentPaused:false, so
          // chats.update's false→true handoff publish never fires here.
          await runTenantWorkDb(db, tenantId, () =>
            services.chats.update(dbChat.id, {
              settings: { agentPaused: false, agentResumedAt: new Date().toISOString() },
            }),
          );
          log.info('Agent resumed after session clear (was paused by handoff)', { instanceId, chatId });
        }
      }
    } catch (disarmError) {
      log.warn('Failed to disarm follow-up after session clear', {
        instanceId,
        chatId,
        error: String(disarmError),
      });
    }

    // Send confirmation message
    try {
      await sendMessage(
        services,
        db,
        instanceId,
        chatId,
        '✅ Conversa limpa! Sua sessão com o assistente foi resetada.',
        tenantId,
      );
      log.info('Sent session cleared confirmation', { instanceId, chatId });
    } catch (sendError) {
      log.error('Failed to send confirmation message', { instanceId, chatId, error: String(sendError) });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Skip silently for instances without an agent/provider configured
    const skippableErrors = [
      'No agent configured',
      'No agent provider',
      'Agent has no provider',
      'Session clearing not supported for',
    ];
    if (skippableErrors.some((e) => errorMessage.includes(e))) {
      log.debug('Session clearing skipped', { instanceId, reason: errorMessage });
      return;
    }

    log.error('Failed to clear session', { instanceId, chatId, error: errorMessage });

    // Send error message
    try {
      await sendMessage(services, db, instanceId, chatId, '❌ Erro ao limpar sessão. Tente novamente.', tenantId);
    } catch (sendError) {
      log.error('Failed to send error message', { instanceId, chatId, error: String(sendError) });
    }
  }
}

/**
 * Set up session cleaner - subscribes to message.received and clears sessions on trash emoji
 */
export async function setupSessionCleaner(eventBus: EventBus, services: Services, db: Database): Promise<void> {
  try {
    await eventBus.subscribe('message.received', async (event) => handleTrashEmojiMessage(services, db, event), {
      durable: 'session-cleaner',
      queue: 'session-cleaner',
      maxRetries: 2,
      retryDelayMs: 1000,
      // 'new' (was 'last') — for an existing durable this is a no-op (the
      // last-ack position wins); for a recreated durable it prevents
      // arbitrary-time replay of an old side-effect event. See #411.
      startFrom: 'new',
      concurrency: 5,
    });

    log.info('Session cleaner initialized');
  } catch (error) {
    log.error('Failed to set up session cleaner', { error: String(error) });
    throw error;
  }
}

/** Seams the two-tenant containment probe drives directly. Not a public API. */
export const __test__ = { readChatParticipant };
