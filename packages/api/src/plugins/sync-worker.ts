/**
 * Sync Worker Plugin
 *
 * Subscribes to sync.started events and processes sync jobs.
 * Handles message history sync by calling channel plugin fetchHistory methods.
 *
 * @see history-sync wish
 */

import type { ChannelRegistry, FetchHistoryOptions, HistorySyncMessage } from '@omni/channel-sdk';
import type { EventBus, OmniEvent } from '@omni/core';
import { classifyEnvelope, createLogger } from '@omni/core';
import type { ChannelType } from '@omni/core/types';
import type { Database, SyncJobConfig, SyncJobProgress, SyncJobType } from '@omni/db';
import { omniGroups } from '@omni/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Services } from '../services';
import { InflightRevocationError, createInflightRevocationMonitor } from '../tenancy/inflight-revocation';
import { isTenantWorkAdmissible } from '../tenancy/periodic-tenant-work';
import { scopedHandle } from '../tenancy/tenant-scope';
import { runConsumerInTenantContext } from '../tenancy/worker-tenant-context';
import { validateContactPhone } from '../utils/phone';

const log = createLogger('sync-worker');

/**
 * Sync started event payload
 */
interface SyncStartedPayload {
  jobId: string;
  instanceId: string;
  type: SyncJobType;
  config: SyncJobConfig;
}

/**
 * Rate limiter for sync operations
 */
class RateLimiter {
  private lastRequest = 0;
  private readonly minIntervalMs: number;

  constructor(requestsPerMinute: number) {
    this.minIntervalMs = Math.floor(60000 / requestsPerMinute);
  }

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequest;
    if (elapsed < this.minIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minIntervalMs - elapsed));
    }
    this.lastRequest = Date.now();
  }
}

/**
 * Rate limit configurations per channel type
 */
const RATE_LIMITS: Record<string, number> = {
  'whatsapp-baileys': 30, // 30 messages per minute
  discord: 50, // 50 messages per minute
  default: 20,
};

/**
 * Get rate limiter for a channel type
 */
function getRateLimiter(channelType: string): RateLimiter {
  const rpm = RATE_LIMITS[channelType] ?? RATE_LIMITS.default ?? 20;
  return new RateLimiter(rpm);
}

/**
 * Parse sync depth to date
 */
function parseSyncDepth(depth?: string): Date | undefined {
  if (!depth) return undefined;

  const now = new Date();
  switch (depth) {
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case '1y':
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    case 'all':
      return undefined; // No date filter
    default:
      return undefined;
  }
}

/**
 * Set up sync worker - subscribes to sync events and processes jobs
 */
/**
 * Database reference for direct table access
 * Set during setupSyncWorker initialization
 */
let db: Database | null = null;

/**
 * The envelope carried by the `sync.started` work item. Its trusted tenant (or
 * `legacy`, flag-off) scopes each per-item DB block below.
 */
type SyncEnvelope = Pick<OmniEvent, 'metadata'>;

/**
 * Run ONE per-item DB block under the work item's worker tenant scope.
 *
 * G5 worker-context boundary (ADR-0008): a converted consumer wraps each DISCRETE
 * DB block — never the whole `fetchHistory`/`fetchContacts`/`fetchGroups` job,
 * which awaits long-running channel I/O and must not hold a tenant transaction —
 * so `scopedHandle(db)` inside the block returns the worker transaction. A legacy
 * envelope runs the block on the ambient pool byte-identically; a quarantined one
 * is refused before any DB work. When no `db` handle was injected (unit setups
 * that never touch tenant tables) the block runs directly, exactly as before.
 */
function inSyncWorkerScope<T>(envelope: SyncEnvelope, fn: () => Promise<T>): Promise<T> {
  const handle = db;
  if (!handle) return fn();
  return runConsumerInTenantContext(handle, envelope, fn);
}

/**
 * The work item's trusted tenant, for the JOB-TABLE writes that cannot be
 * wrapped in `inSyncWorkerScope` (G5, ADR-0008).
 *
 * `SyncJobService` both writes `sync_jobs` AND publishes `sync.*`, so a scope
 * wrapped around a whole `start`/`complete`/`fail` call would hold a worker
 * transaction across the publish — a pre-commit side effect. The service instead
 * takes a THREADED tenant and scopes each of its own discrete DB blocks; this is
 * what threads it. Read only from producer-stamped envelope metadata, never from
 * payload. `null` for a legacy envelope (the ambient, byte-identical path);
 * throws on a quarantined one, which the subscription layer already refused.
 */
function trustedSyncTenant(envelope: SyncEnvelope): string | null {
  const classification = classifyEnvelope(envelope.metadata);
  if (classification.world === 'quarantine') {
    throw new Error(`sync-worker: refusing a quarantined envelope (${classification.reason})`);
  }
  return classification.world === 'tenant' ? classification.tenantId : null;
}

/**
 * The in-flight revocation gate for a sync job (G5, deliverable (c);
 * RELEASE_SLOS `inflight_privileged_work_revocation_seconds_max`). A message
 * backfill can run for minutes, so each processor calls the monitor per work
 * item: the first call doubles as dequeue-time revalidation, later calls
 * re-check the auth plane at the bounded cadence. Legacy jobs (null tenant)
 * never check — byte-identical.
 */
function jobRevocationMonitor(services: Services, jobTenantId: string | null) {
  return createInflightRevocationMonitor({
    tenantId: jobTenantId,
    check: (tenantId) => isTenantWorkAdmissible(services.authPlane.db, tenantId),
  });
}

export async function setupSyncWorker(
  eventBus: EventBus,
  services: Services,
  channelRegistry: ChannelRegistry,
  database?: Database,
): Promise<void> {
  // Always update db (including to null) so each call starts with a clean state.
  // This ensures test isolation when setupSyncWorker is called multiple times.
  db = database ?? null;
  try {
    // Subscribe to sync.started events
    // Events now include channelType/instanceId metadata, so hierarchical filtering works
    await eventBus.subscribe(
      'sync.started',
      async (event) => {
        const payload = event.payload as SyncStartedPayload;
        const { jobId, instanceId, type, config } = payload;

        log.info('Processing sync job', { jobId, instanceId, type });

        // Classify ONCE, before any work: a quarantined envelope must do no job
        // work at all, and the throw must escape rather than be swallowed into a
        // `syncJobs.fail` below.
        const jobTenantId = trustedSyncTenant(event);

        try {
          // Start the job
          await services.syncJobs.start(jobId, jobTenantId);

          // Get instance to determine channel type. One discrete scoped read
          // (G5, ADR-0008): a tenant-world job runs it in a short worker scope
          // via the envelope's classified world; a legacy job reads the
          // ambient pool byte-identically. Without this wrap the read was the
          // handler's ONE bare `instances` access between `syncJobs.start`
          // and the scoped per-item loop.
          const instance = await inSyncWorkerScope(event, () => services.instances.getById(instanceId));
          if (!instance) {
            throw new Error(`Instance ${instanceId} not found`);
          }

          const channelType = instance.channel;

          // Process based on job type. The `event` (versioned envelope) threads
          // through so each processor can scope its per-item DB blocks to the
          // work item's trusted tenant.
          switch (type) {
            case 'messages':
              await processMessageSync(jobId, instanceId, channelType, config, services, channelRegistry, event);
              break;
            case 'profile':
              // Profile sync is handled by ProfileSyncService, just mark complete
              await services.syncJobs.complete(jobId, jobTenantId);
              break;
            case 'contacts':
              // Not scoped this leg: its only tenant-table write is `persons`,
              // which G2 classifies `unowned` (tenant_id stays NULL until the G6
              // backfill), so there is no registered sync-worker site here to
              // ratchet. Left byte-identical.
              await processContactsSync(jobId, instanceId, channelType, config, services, channelRegistry, event);
              break;
            case 'groups':
              await processGroupsSync(jobId, instanceId, channelType, config, services, channelRegistry, event);
              break;
            case 'all':
              // All sync - process each type
              await processMessageSync(jobId, instanceId, channelType, config, services, channelRegistry, event);
              break;
            case 'history-push':
              // Progress/completion is driven by tracker subscribers, not the worker
              break;
            default:
              log.warn('Unknown sync type', { jobId, type });
              await services.syncJobs.fail(jobId, `Unknown sync type: ${type}`, jobTenantId);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.error('Sync job failed', { jobId, error: errorMessage });
          await services.syncJobs.fail(jobId, errorMessage, jobTenantId);
        }
      },
      {
        durable: 'sync-worker',
        queue: 'sync-workers',
        startFrom: 'new',
      },
    );

    log.info('Sync worker initialized - listening for sync.started events');
  } catch (error) {
    log.error('Failed to set up sync worker', { error: String(error) });
    throw error;
  }
}

/**
 * Build message anchors for WhatsApp history fetch
 * Gets the oldest message per chat to use as anchor points
 */
async function buildWhatsAppAnchors(
  database: Database,
  instanceId: string,
): Promise<
  Array<{ chatJid: string; messageKey: { remoteJid: string; id: string; fromMe: boolean }; timestamp: number }>
> {
  // Query oldest message per chat that has a raw_payload with key
  // Using raw SQL for the complex DISTINCT ON query. `scopedHandle` returns the
  // worker tenant transaction when this read runs inside a per-item worker scope
  // (see `inSyncWorkerScope`), and the ambient pool otherwise (byte-identical to
  // pre-G5).
  const result = await scopedHandle(database).execute(sql`
    WITH oldest_messages AS (
      SELECT DISTINCT ON (c.external_id)
        c.external_id as chat_jid,
        m.external_id,
        m.platform_timestamp,
        m.is_from_me,
        m.raw_payload->'key' as message_key
      FROM messages m
      JOIN chats c ON m.chat_id = c.id
      WHERE c.instance_id = ${instanceId}
        AND c.channel = 'whatsapp-baileys'
        AND m.raw_payload IS NOT NULL
        AND m.raw_payload::text != 'null'
        AND m.raw_payload->'key' IS NOT NULL
      ORDER BY c.external_id, m.platform_timestamp ASC
    )
    SELECT * FROM oldest_messages
  `);

  const anchors: Array<{
    chatJid: string;
    messageKey: { remoteJid: string; id: string; fromMe: boolean };
    timestamp: number;
  }> = [];

  for (const row of result as unknown as Array<{
    chat_jid: string;
    external_id: string;
    platform_timestamp: Date;
    is_from_me: boolean;
    message_key: { id: string; remoteJid: string; fromMe: boolean } | null;
  }>) {
    if (row.message_key?.id && row.message_key.remoteJid) {
      anchors.push({
        chatJid: row.chat_jid,
        messageKey: {
          remoteJid: row.message_key.remoteJid,
          id: row.message_key.id,
          fromMe: row.message_key.fromMe ?? row.is_from_me,
        },
        timestamp: new Date(row.platform_timestamp).getTime(),
      });
    }
  }

  log.info('Built WhatsApp anchors', { instanceId, anchorCount: anchors.length });
  return anchors;
}

/**
 * WhatsApp message anchor for active history fetching.
 * Intentionally duplicated from channel-whatsapp's MessageAnchor to avoid
 * @omni/api depending on a specific channel implementation package.
 * Keep in sync with: packages/channel-whatsapp/src/plugin.ts → MessageAnchor
 */
type WAnchor = {
  chatJid: string;
  messageKey: { remoteJid: string; id: string; fromMe: boolean };
  timestamp: number;
};

/** WhatsApp-specific sync options (extends canonical FetchHistoryOptions with WA-specific fields). */
type WhatsAppSyncOptions = FetchHistoryOptions & {
  count?: number;
  anchors?: WAnchor[];
};

/**
 * Resolve WhatsApp anchors for a sync job
 * Either uses explicit chatJids or builds from DB + Baileys discovery
 */
function buildAnchorsForExplicitChatJids(jobId: string, chatJids: string[], dbAnchors: WAnchor[]): WAnchor[] {
  log.info('Using explicit chatJids for sync', { jobId, chatJids });

  const anchors: WAnchor[] = [];
  for (const jid of chatJids) {
    const dbAnchor = dbAnchors.find((a) => a.chatJid === jid);
    if (dbAnchor) {
      log.debug('Found DB anchor for chatJid', { jobId, chatJid: jid, anchorId: dbAnchor.messageKey.id });
      anchors.push(dbAnchor);
      continue;
    }

    // No messages in DB - create anchor without message ID. This triggers fetchHistory without an anchor.
    log.debug('No DB anchor for chatJid, will fetch recent', { jobId, chatJid: jid });
    anchors.push({
      chatJid: jid,
      messageKey: { remoteJid: jid, id: '', fromMe: false },
      timestamp: Date.now(),
    });
  }

  return anchors;
}

function hasKnownChatJids(plugin: unknown): plugin is { getKnownChatJids: (id: string) => string[] } {
  return (
    typeof plugin === 'object' &&
    plugin !== null &&
    'getKnownChatJids' in plugin &&
    typeof (plugin as { getKnownChatJids?: unknown }).getKnownChatJids === 'function'
  );
}

async function discoverAnchorsFromPlugin(
  jobId: string,
  instanceId: string,
  plugin: unknown,
  dbAnchors: WAnchor[],
  services: Services,
  envelope: SyncEnvelope,
): Promise<WAnchor[]> {
  const anchoredJids = new Set(dbAnchors.map((a) => a.chatJid));

  // Query DB for all known chat external IDs (survives restarts). Discrete block
  // in the job envelope's world (G5, ADR-0008) — it reads `chats` AND
  // `chat_id_mappings`, so an ambient read would leave both sites unscoped.
  const dbExternalIds = await inSyncWorkerScope(envelope, () => services.chats.getAllExternalIds(instanceId));

  // Merge with Baileys volatile cache (newly connected chats not yet in DB)
  const baileysJids = hasKnownChatJids(plugin) ? plugin.getKnownChatJids(instanceId) : [];
  const allJids = new Set([...dbExternalIds, ...baileysJids]);

  const discovered: WAnchor[] = [];
  for (const jid of allJids) {
    if (anchoredJids.has(jid)) continue;
    if (jid.includes('@newsletter') || jid.includes('@broadcast')) continue;
    discovered.push({ chatJid: jid, messageKey: { remoteJid: jid, id: '', fromMe: false }, timestamp: Date.now() });
  }

  if (discovered.length > 0) {
    log.info('Discovered chats from DB + Baileys not in anchors', {
      jobId,
      discoveredCount: discovered.length,
      fromDb: dbExternalIds.length,
      fromBaileys: baileysJids.length,
    });
  }

  return discovered;
}

async function resolveWhatsAppAnchors(
  jobId: string,
  instanceId: string,
  config: SyncJobConfig,
  plugin: unknown,
  dbAnchors: WAnchor[],
  services: Services,
  envelope: SyncEnvelope,
): Promise<WAnchor[]> {
  // Explicit chatJids take priority (per-chat active sync)
  if (config.chatJids?.length) {
    return buildAnchorsForExplicitChatJids(jobId, config.chatJids, dbAnchors);
  }

  // Default: use DB anchors + discover chats known to Baileys but not in DB.
  return [...dbAnchors, ...(await discoverAnchorsFromPlugin(jobId, instanceId, plugin, dbAnchors, services, envelope))];
}

/**
 * Process message history sync
 */
async function processMessageSync(
  jobId: string,
  instanceId: string,
  channelType: ChannelType,
  config: SyncJobConfig,
  services: Services,
  channelRegistry: ChannelRegistry,
  envelope: SyncEnvelope,
): Promise<void> {
  const plugin = channelRegistry.get(channelType);
  if (!plugin) {
    throw new Error(`No plugin found for channel type: ${channelType}`);
  }

  // Non-null db handle for the per-item worker scopes below. When absent (unit
  // setups that never touch tenant tables) the blocks run unscoped, as before.
  const handle = db;

  // The `sync_jobs` writes below are threaded rather than wrapped — see
  // `trustedSyncTenant`.
  const jobTenantId = trustedSyncTenant(envelope);

  // In-flight revocation gate (RELEASE_SLOS inflight ceiling): the first call
  // is the dequeue-time revalidation — it runs before ANY anchor read or
  // message store; per-message calls below observe a mid-flight revocation at
  // the bounded cadence. Sticky: once refused, the rest of the fetch drops.
  const revocation = jobRevocationMonitor(services, jobTenantId);
  await revocation.assertAdmissible();
  let inflightRevoked: InflightRevocationError | null = null;

  // Check if plugin supports fetchHistory
  if (!('fetchHistory' in plugin) || typeof plugin.fetchHistory !== 'function') {
    log.warn('Plugin does not support fetchHistory', { channelType });
    await services.syncJobs.complete(jobId, jobTenantId);
    return;
  }

  const since = config.since ? new Date(config.since) : parseSyncDepth(config.depth);
  const rateLimiter = getRateLimiter(channelType);

  let fetched = 0;
  let stored = 0;
  let duplicates = 0;

  log.info('Starting message sync', {
    jobId,
    instanceId,
    channelType,
    since: since?.toISOString(),
  });

  // Build anchors for active history fetch.
  // For WhatsApp: always discover from DB + Baileys cache so chats not in volatile
  // memory (e.g. after restart) are still synced (GH#142).
  // Falls back to passive sync only when no anchors are found (fresh instance).
  let anchors: WAnchor[] = [];

  if (channelType === 'whatsapp-baileys' && config.chatJids?.length) {
    // Per-chat active sync: build anchors for the specific requested chats only.
    // The DB anchor read runs in a per-item worker scope so it only sees the
    // work item's tenant's messages/chats under enforcement.
    const dbAnchors = handle ? await inSyncWorkerScope(envelope, () => buildWhatsAppAnchors(handle, instanceId)) : [];
    anchors = await resolveWhatsAppAnchors(jobId, instanceId, config, plugin, dbAnchors, services, envelope);
    log.info('WhatsApp per-chat active sync', { jobId, anchorCount: anchors.length, chatJids: config.chatJids });
  } else if (channelType === 'whatsapp-baileys') {
    // Default sync: discover all known chats from DB + Baileys volatile cache.
    // Using DB ensures chats survive restarts even when Baileys cache is empty.
    const dbAnchors = handle ? await inSyncWorkerScope(envelope, () => buildWhatsAppAnchors(handle, instanceId)) : [];
    const discoveredAnchors = await discoverAnchorsFromPlugin(jobId, instanceId, plugin, dbAnchors, services, envelope);
    anchors = [...dbAnchors, ...discoveredAnchors];
    if (anchors.length > 0) {
      log.info('WhatsApp default sync with DB+cache discovery', {
        jobId,
        instanceId,
        dbAnchorCount: dbAnchors.length,
        newlyDiscovered: discoveredAnchors.length,
        totalAnchors: anchors.length,
      });
    } else {
      // Fresh instance: no DB data and no Baileys cache — fall back to passive sync
      log.info('WhatsApp passive sync (no prior data)', { jobId, instanceId });
    }
  }

  const fetchOptions: WhatsAppSyncOptions = {
    since,
    until: new Date(),
    count: 100, // Messages per chat (recursive fetching will get more)
    anchors: anchors.length > 0 ? anchors : undefined,
    onProgress: async (count: number, progress?: number) => {
      if (inflightRevoked) return; // no durable side effects after the flip
      await services.syncJobs.updateProgress(
        jobId,
        {
          fetched: count,
          stored,
          duplicates,
          totalEstimated: progress ? Math.round(count / (progress / 100)) : undefined,
        },
        jobTenantId,
      );
    },
    onMessage: async (msg: HistorySyncMessage) => {
      // The per-item revocation gate, BEFORE the try below: its refusal must
      // stop the store, not be swallowed by the per-message error handler. The
      // channel plugin may keep feeding messages after the flip — they are
      // dropped here without side effects, and the job fails after the fetch.
      if (inflightRevoked) return;
      try {
        await revocation.assertAdmissible();
      } catch (error) {
        if (error instanceof InflightRevocationError) {
          inflightRevoked = error;
          return;
        }
        throw error;
      }

      // Rate limit — OUTSIDE the worker scope, so no tenant transaction is held
      // across the sleep.
      await rateLimiter.wait();

      fetched++;

      try {
        // Each synced message is one work item: its find-or-create + de-dupe
        // check + insert run inside a fresh per-item worker tenant scope so the
        // row lands under the work item's tenant (legacy envelope → ambient pool,
        // byte-identical). The counters are updated OUTSIDE the scope.
        const outcome = await inSyncWorkerScope(envelope, async (): Promise<'duplicate' | 'stored'> => {
          // Find or create chat
          const { chat } = await services.chats.findOrCreate(instanceId, msg.chatId, {
            chatType: 'dm', // Default, will be updated
            channel: channelType as 'whatsapp-baileys' | 'discord',
          });

          // Check for duplicates
          const existing = await services.messages.getByExternalId(chat.id, msg.externalId);
          if (existing) return 'duplicate';

          // Create message
          await services.messages.create({
            chatId: chat.id,
            externalId: msg.externalId,
            source: 'sync',
            messageType: mapContentType(msg.content.type),
            textContent: msg.content.text ?? msg.content.caption,
            platformTimestamp: msg.timestamp,
            hasMedia: ['audio', 'image', 'video', 'document', 'sticker'].includes(msg.content.type),
            mediaMimeType: msg.content.mimeType,
            mediaUrl: msg.content.mediaUrl,
            mediaLocalPath: msg.content.localPath,
            senderPlatformUserId: msg.from,
            isFromMe: msg.isFromMe,
            rawPayload: msg.rawPayload as Record<string, unknown>,
          });
          return 'stored';
        });

        if (outcome === 'duplicate') duplicates++;
        else stored++;
      } catch (error) {
        log.warn('Failed to store synced message', {
          externalId: msg.externalId,
          error: String(error),
        });
      }
    },
  };

  // Add channel ID for Discord
  if (channelType === 'discord' && config.channelId) {
    fetchOptions.channelId = config.channelId;
  }

  // Call fetchHistory
  await plugin.fetchHistory(instanceId, fetchOptions);

  // A revocation observed mid-flight fails the job — never "completed".
  if (inflightRevoked) throw inflightRevoked;

  // Update final progress
  await services.syncJobs.updateProgress(
    jobId,
    {
      fetched,
      stored,
      duplicates,
    },
    jobTenantId,
  );

  await queueMediaBackfillAfterSync(services, config, instanceId, jobId, stored);

  // Complete the job
  await services.syncJobs.complete(jobId, jobTenantId);

  log.info('Message sync completed', {
    jobId,
    fetched,
    stored,
    duplicates,
  });
}

async function queueMediaBackfillAfterSync(
  services: Services,
  config: SyncJobConfig,
  instanceId: string,
  jobId: string,
  stored: number,
): Promise<void> {
  if ((config.backfillMedia !== true && config.processMedia !== true) || stored === 0) return;

  try {
    const params = {
      jobType: 'time_based_batch' as const,
      instanceId,
      daysBack: config.daysBack ?? 3650,
      limit: config.mediaLimit,
      contentTypes: config.contentTypes ?? ['audio', 'image', 'video', 'document'],
      force: config.forceMedia === true,
      delayMinMs: config.delayMinMs ?? 1000,
      delayMaxMs: config.delayMaxMs ?? 3000,
    };
    const batch = await services.batchJobs.create(params);
    log.info('Queued media backfill batch after message sync', { jobId, batchJobId: batch.id, stored });
  } catch (error) {
    log.warn('Failed to queue media backfill batch after message sync', { jobId, error: String(error) });
  }
}

/**
 * Map content type to message type
 */
function mapContentType(
  contentType: string,
): 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'contact' | 'location' | 'poll' {
  switch (contentType) {
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    case 'document':
      return 'document';
    case 'sticker':
      return 'sticker';
    case 'contact':
      return 'contact';
    case 'location':
      return 'location';
    case 'poll':
    case 'poll_update':
      return 'poll';
    default:
      return 'text';
  }
}

/** Update a DM chat's name if it's missing or stale */
async function updateDmChatName(
  services: Services,
  instanceId: string,
  jid: string,
  name: string,
  envelope: SyncEnvelope,
): Promise<void> {
  try {
    // Lookup + conditional rename are one work item, in the envelope's world.
    await inSyncWorkerScope(envelope, async () => {
      // Use smart lookup to handle LID/phone JID resolution
      const chat = await services.chats.findByExternalIdSmart(instanceId, jid);
      if (!chat) return;
      const hasStaleJidName = chat.name?.endsWith('@s.whatsapp.net') || chat.name?.endsWith('@lid');
      if (!chat.name || hasStaleJidName) {
        await services.chats.update(chat.id, { name });
      }
    });
  } catch {
    // Chat may not exist yet — that's fine
  }
}

/**
 * Process contacts sync
 */
async function processContactsSync(
  jobId: string,
  instanceId: string,
  channelType: ChannelType,
  config: SyncJobConfig,
  services: Services,
  channelRegistry: ChannelRegistry,
  envelope: SyncEnvelope,
): Promise<void> {
  const plugin = channelRegistry.get(channelType);
  if (!plugin) {
    throw new Error(`No plugin found for channel type: ${channelType}`);
  }

  // The envelope reaches this processor for its `sync_jobs` bookkeeping ONLY.
  // The contact ingestion itself is deliberately left unscoped: its tenant-table
  // write is `persons`, which G2 classifies `unowned` (tenant_id stays NULL until
  // the G6 backfill), so there is no registered site here to convert and a scope
  // would find nothing. The job table is owned and is scoped.
  const jobTenantId = trustedSyncTenant(envelope);

  // In-flight revocation gate — same contract as processMessageSync.
  const revocation = jobRevocationMonitor(services, jobTenantId);
  await revocation.assertAdmissible();
  let inflightRevoked: InflightRevocationError | null = null;

  // Check if plugin supports fetchContacts
  if (!('fetchContacts' in plugin) || typeof plugin.fetchContacts !== 'function') {
    log.warn('Plugin does not support fetchContacts', { channelType });
    await services.syncJobs.complete(jobId, jobTenantId);
    return;
  }

  let fetched = 0;
  let stored = 0;
  let linked = 0;

  log.info('Starting contacts sync', {
    jobId,
    instanceId,
    channelType,
  });

  // Build fetch options based on channel type
  const fetchOptions: Record<string, unknown> = {
    onProgress: async (count: number) => {
      await services.syncJobs.updateProgress(
        jobId,
        {
          fetched: count,
          stored,
          duplicates: 0,
        },
        jobTenantId,
      );
    },
    onContact: async (contact: unknown) => {
      if (inflightRevoked) return;
      try {
        await revocation.assertAdmissible();
      } catch (error) {
        if (error instanceof InflightRevocationError) {
          inflightRevoked = error;
          return;
        }
        throw error;
      }

      fetched++;

      const c = contact as {
        platformUserId: string;
        name?: string;
        phone?: string;
        profilePicUrl?: string;
        isGroup?: boolean;
        isBusiness?: boolean;
        guildId?: string;
        metadata?: Record<string, unknown>;
      };

      // Skip groups - they're handled separately
      if (c.isGroup) return;

      try {
        // One work item per contact: the identity/person write runs in the job
        // envelope's world (G5, ADR-0008), so `platform_identities` and the
        // `chat_id_mappings` read behind it are RLS-policed.
        const result = await inSyncWorkerScope(envelope, () =>
          services.persons.findOrCreateIdentity(
            {
              channel: channelType,
              instanceId,
              platformUserId: c.platformUserId,
              platformUsername: c.name,
              profilePicUrl: c.profilePicUrl,
              profileData: c.metadata,
            },
            {
              matchByPhone: validateContactPhone(c.phone, c.platformUserId),
              createPerson: true,
              displayName: c.name,
            },
          ),
        );

        if (result.isNew) stored++;
        if (result.wasLinked) linked++;

        // Update DM chat name if missing or stale
        if (c.name && !c.isGroup) {
          await updateDmChatName(services, instanceId, c.platformUserId, c.name, envelope);
        }
      } catch (error) {
        log.warn('Failed to store synced contact', {
          platformUserId: c.platformUserId,
          error: String(error),
        });
      }
    },
  };

  // For Discord, we need a guild ID from config
  if (channelType === 'discord' && config.channelId) {
    fetchOptions.guildId = config.channelId;
  }

  // Call fetchContacts
  await plugin.fetchContacts(instanceId, fetchOptions);

  // A revocation observed mid-flight fails the job — never "completed".
  if (inflightRevoked) throw inflightRevoked;

  // Update final progress
  await services.syncJobs.updateProgress(
    jobId,
    {
      fetched,
      stored,
      duplicates: 0,
    },
    jobTenantId,
  );

  // Complete the job
  await services.syncJobs.complete(jobId, jobTenantId);

  log.info('Contacts sync completed', {
    jobId,
    fetched,
    stored,
    linked,
  });
}

/** Shape of a WhatsApp group emitted by the channel plugin's fetchGroups. */
type SyncedGroupInput = {
  externalId: string;
  name?: string;
  description?: string;
  memberCount?: number;
  iconUrl?: string;
  ownerId?: string;
  createdBy?: string;
  createdAt?: Date;
  isReadOnly?: boolean;
  metadata?: Record<string, unknown>;
};

/**
 * Upsert ONE synced WhatsApp group. Extracted from the `onGroup` callback so it
 * is a testable seam: it reads/writes `omni_groups` through `scopedHandle`, so
 * inside a per-item worker scope it is the worker's tenant transaction and the
 * insert is RLS-stamped/checked; on the ambient pool it is byte-identical to
 * pre-G5. Errors propagate to the caller, which keeps the sync-loop's
 * log-and-continue behaviour.
 */
async function upsertSyncedGroup(
  database: Database,
  instanceId: string,
  channelType: ChannelType,
  g: SyncedGroupInput,
): Promise<'stored' | 'updated'> {
  const sdb = scopedHandle(database);
  // Check if group already exists
  const [existing] = await sdb
    .select()
    .from(omniGroups)
    .where(and(eq(omniGroups.instanceId, instanceId), eq(omniGroups.externalId, g.externalId)))
    .limit(1);

  if (existing) {
    // Update existing group
    await sdb
      .update(omniGroups)
      .set({
        name: g.name,
        description: g.description,
        iconUrl: g.iconUrl,
        memberCount: g.memberCount,
        ownerId: g.ownerId,
        isReadOnly: g.isReadOnly ?? false,
        platformMetadata: g.metadata,
        syncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(omniGroups.id, existing.id));
    return 'updated';
  }

  // Create new group
  await sdb.insert(omniGroups).values({
    instanceId,
    externalId: g.externalId,
    channel: channelType,
    name: g.name,
    description: g.description,
    iconUrl: g.iconUrl,
    memberCount: g.memberCount,
    ownerId: g.ownerId,
    createdBy: g.createdBy,
    isReadOnly: g.isReadOnly ?? false,
    isCommunity: false,
    platformMetadata: g.metadata,
    syncedAt: new Date(),
  });
  return 'stored';
}

/**
 * Process groups sync
 */
async function processGroupsSync(
  jobId: string,
  instanceId: string,
  channelType: ChannelType,
  _config: SyncJobConfig,
  services: Services,
  channelRegistry: ChannelRegistry,
  envelope: SyncEnvelope,
): Promise<void> {
  const plugin = channelRegistry.get(channelType);
  if (!plugin) {
    throw new Error(`No plugin found for channel type: ${channelType}`);
  }

  // The `sync_jobs` writes below are threaded rather than wrapped — see
  // `trustedSyncTenant`. The per-group `omni_groups` upserts keep their own
  // per-item `inSyncWorkerScope` (leg B pt2).
  const jobTenantId = trustedSyncTenant(envelope);

  // In-flight revocation gate — same contract as processMessageSync.
  const revocation = jobRevocationMonitor(services, jobTenantId);
  await revocation.assertAdmissible();
  let inflightRevoked: InflightRevocationError | null = null;

  // Check if plugin supports fetchGroups (WhatsApp) or fetchGuilds (Discord)
  const fetchMethod = channelType === 'discord' ? 'fetchGuilds' : 'fetchGroups';
  if (!(fetchMethod in plugin) || typeof plugin[fetchMethod as keyof typeof plugin] !== 'function') {
    log.warn(`Plugin does not support ${fetchMethod}`, { channelType });
    await services.syncJobs.complete(jobId, jobTenantId);
    return;
  }

  if (!db) {
    throw new Error('Database not initialized for sync worker');
  }

  // Capture db reference for use in closures
  const database = db;

  let fetched = 0;
  let stored = 0;
  let updated = 0;

  log.info('Starting groups sync', {
    jobId,
    instanceId,
    channelType,
  });

  // Build fetch options
  const fetchOptions: Record<string, unknown> = {
    onProgress: async (count: number) => {
      await services.syncJobs.updateProgress(
        jobId,
        {
          fetched: count,
          stored,
          duplicates: updated,
        },
        jobTenantId,
      );
    },
    onGroup: async (group: unknown) => {
      if (inflightRevoked) return;
      try {
        await revocation.assertAdmissible();
      } catch (error) {
        if (error instanceof InflightRevocationError) {
          inflightRevoked = error;
          return;
        }
        throw error;
      }
      fetched++;

      const g = group as SyncedGroupInput;

      try {
        // One group = one work item, upserted inside a fresh per-item worker
        // tenant scope; counters are updated OUTSIDE the scope.
        const outcome = await inSyncWorkerScope(envelope, () =>
          upsertSyncedGroup(database, instanceId, channelType, g),
        );
        if (outcome === 'updated') updated++;
        else stored++;
      } catch (error) {
        log.warn('Failed to store synced group', {
          externalId: g.externalId,
          error: String(error),
        });
      }
    },
    // Discord uses onGuild
    onGuild: async (guild: unknown) => {
      fetched++;

      const g = guild as {
        externalId: string;
        name: string;
        description?: string;
        memberCount?: number;
        iconUrl?: string;
        ownerId?: string;
        createdAt?: Date;
        metadata?: Record<string, unknown>;
      };

      try {
        // One guild = one work item, upserted inside a fresh per-item worker
        // tenant scope; `scopedHandle` returns the worker transaction (ambient
        // pool when unscoped, byte-identical). Discord's field mapping differs
        // from WhatsApp groups (no createdBy, isReadOnly always false), so it is
        // kept inline rather than sharing `upsertSyncedGroup`.
        const outcome = await inSyncWorkerScope(envelope, async (): Promise<'stored' | 'updated'> => {
          const sdb = scopedHandle(database);
          // Check if guild already exists
          const [existing] = await sdb
            .select()
            .from(omniGroups)
            .where(and(eq(omniGroups.instanceId, instanceId), eq(omniGroups.externalId, g.externalId)))
            .limit(1);

          if (existing) {
            // Update existing guild
            await sdb
              .update(omniGroups)
              .set({
                name: g.name,
                description: g.description,
                iconUrl: g.iconUrl,
                memberCount: g.memberCount,
                ownerId: g.ownerId,
                platformMetadata: g.metadata,
                syncedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(omniGroups.id, existing.id));
            return 'updated';
          }
          // Create new guild
          await sdb.insert(omniGroups).values({
            instanceId,
            externalId: g.externalId,
            channel: channelType,
            name: g.name,
            description: g.description,
            iconUrl: g.iconUrl,
            memberCount: g.memberCount,
            ownerId: g.ownerId,
            isReadOnly: false,
            isCommunity: false,
            platformMetadata: g.metadata,
            syncedAt: new Date(),
          });
          return 'stored';
        });
        if (outcome === 'updated') updated++;
        else stored++;
      } catch (error) {
        log.warn('Failed to store synced guild', {
          externalId: g.externalId,
          error: String(error),
        });
      }
    },
  };

  // Call the appropriate fetch method
  const fetchFn = plugin[fetchMethod as keyof typeof plugin] as (
    instanceId: string,
    options: Record<string, unknown>,
  ) => Promise<void>;
  await fetchFn.call(plugin, instanceId, fetchOptions);

  // A revocation observed mid-flight fails the job — never "completed".
  if (inflightRevoked) throw inflightRevoked;

  // Update final progress
  await services.syncJobs.updateProgress(
    jobId,
    {
      fetched,
      stored,
      duplicates: updated,
    },
    jobTenantId,
  );

  // Complete the job
  await services.syncJobs.complete(jobId, jobTenantId);

  log.info('Groups sync completed', {
    jobId,
    fetched,
    stored,
    updated,
  });
}

const historyPushLog = createLogger('history-push-tracker');

/**
 * Set up history-push sync tracker
 *
 * - Subscribes to `instance.connected` to auto-create a `history-push` sync job
 * - Subscribes to `sync.progress` (jobType=history-push) to update sync job progress
 * - Subscribes to `sync.completed` (jobType=history-push) to mark sync job completed
 */
export async function setupHistoryPushTracker(eventBus: EventBus, services: Services): Promise<void> {
  try {
    // 1. Create history-push sync job when an instance connects
    await eventBus.subscribe(
      'instance.connected',
      async (event) => {
        const { instanceId, channelType } = event.payload;

        // The `instance.connected` envelope's trusted tenant (G5, ADR-0008).
        // Since the ownership registry seeds channel-plugin publishes, a
        // plugin-originated reconnect now carries the instance's persisted
        // tenant here; a legacy envelope threads null and runs ambient.
        const jobTenantId = trustedSyncTenant(event);

        try {
          // Reuse an already-running history-push job for this instance instead of
          // creating a duplicate on every reconnect.
          if (await services.syncJobs.hasActiveJob(instanceId, 'history-push', jobTenantId)) {
            historyPushLog.debug('Active history-push job already exists — skipping create', {
              instanceId,
              channel: channelType,
            });
            return;
          }

          // Create a running history-push sync job
          const job = await services.syncJobs.create({
            instanceId,
            channelType,
            type: 'history-push',
            tenantId: jobTenantId,
          });

          // Immediately start the job (set status to running)
          await services.syncJobs.start(job.id, jobTenantId);

          historyPushLog.info('Created history-push sync job', {
            jobId: job.id,
            instanceId,
            channel: channelType,
          });
        } catch (error) {
          historyPushLog.error('Failed to create history-push sync job', {
            instanceId,
            error: String(error),
          });
        }
      },
      {
        durable: 'history-push-creator',
        startFrom: 'new',
      },
    );

    // 2. Update history-push sync job progress from WhatsApp plugin events
    await eventBus.subscribePattern(
      'sync.progress.>',
      async (event) => {
        const payload = event.payload as {
          instanceId?: string;
          jobType?: string;
          fetched?: number;
          progress?: number;
        };

        // Only handle history-push progress events (from WhatsApp plugin)
        if (payload.jobType !== 'history-push' || !payload.instanceId) return;

        const jobTenantId = trustedSyncTenant(event);

        try {
          // Find the active history-push job for this instance
          const activeJobs = await services.syncJobs.getActiveForInstance(payload.instanceId, jobTenantId);
          const historyPushJob = activeJobs.find((j) => j.type === 'history-push');

          if (!historyPushJob) {
            historyPushLog.debug('No active history-push job found for progress update', {
              instanceId: payload.instanceId,
            });
            return;
          }

          // Only update counters we actually have from Baileys. Never reset
          // stored/duplicates/mediaDownloaded to 0 — ingestion updates them
          // separately and they must not be clobbered by a progress event.
          // `fetched` is also preserved when absent: a progress event missing
          // the counter must not reset the stored value to 0.
          const update: Partial<SyncJobProgress> = {};
          if (typeof payload.fetched === 'number') {
            update.fetched = payload.fetched;
          }
          if (typeof payload.progress === 'number' && payload.progress > 0 && typeof payload.fetched === 'number') {
            update.totalEstimated = Math.round(payload.fetched / (payload.progress / 100));
          }

          if (Object.keys(update).length === 0) return;

          await services.syncJobs.updateProgress(historyPushJob.id, update, jobTenantId);

          historyPushLog.debug('Updated history-push progress', {
            jobId: historyPushJob.id,
            instanceId: payload.instanceId,
            fetched: payload.fetched,
            progress: payload.progress,
          });
        } catch (error) {
          historyPushLog.warn('Failed to update history-push progress', {
            instanceId: payload.instanceId,
            error: String(error),
          });
        }
      },
      {
        durable: 'history-push-tracker',
        startFrom: 'new',
      },
    );

    // 3. Complete history-push sync job when WhatsApp signals completion
    await eventBus.subscribePattern(
      'sync.completed.>',
      async (event) => {
        const payload = event.payload as {
          instanceId?: string;
          jobType?: string;
          totalFetched?: number;
        };

        // Only handle history-push completed events (from WhatsApp plugin)
        if (payload.jobType !== 'history-push' || !payload.instanceId) return;

        const jobTenantId = trustedSyncTenant(event);

        try {
          // Find the active history-push job for this instance
          const activeJobs = await services.syncJobs.getActiveForInstance(payload.instanceId, jobTenantId);
          const historyPushJob = activeJobs.find((j) => j.type === 'history-push');

          if (!historyPushJob) {
            historyPushLog.debug('No active history-push job found for completion', {
              instanceId: payload.instanceId,
            });
            return;
          }

          // Update final progress
          await services.syncJobs.updateProgress(
            historyPushJob.id,
            {
              fetched: payload.totalFetched ?? 0,
              stored: 0,
              duplicates: 0,
              mediaDownloaded: 0,
            },
            jobTenantId,
          );

          // Mark completed
          await services.syncJobs.complete(historyPushJob.id, jobTenantId);

          historyPushLog.info('History-push sync completed', {
            jobId: historyPushJob.id,
            instanceId: payload.instanceId,
            totalFetched: payload.totalFetched,
          });
        } catch (error) {
          historyPushLog.warn('Failed to complete history-push sync job', {
            instanceId: payload.instanceId,
            error: String(error),
          });
        }
      },
      {
        durable: 'history-push-completer',
        startFrom: 'new',
      },
    );

    historyPushLog.info('History-push tracker initialized');
  } catch (error) {
    historyPushLog.error('Failed to set up history-push tracker', { error: String(error) });
    throw error;
  }
}

/**
 * Test-only seams: the two `omni_groups`/`messages` DB-access sites, exposed so
 * the two-tenant real-PostgreSQL suite can drive them directly under a worker
 * tenant scope (the same shape the media-processor suite uses).
 */
export const __test__ = {
  buildWhatsAppAnchors,
  upsertSyncedGroup,
};
