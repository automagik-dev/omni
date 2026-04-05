/**
 * Sync Worker Plugin
 *
 * Subscribes to sync.started events and processes sync jobs.
 * Handles message history sync by calling channel plugin fetchHistory methods.
 *
 * @see history-sync wish
 */

import type { ChannelRegistry, FetchHistoryOptions, HistorySyncMessage } from '@omni/channel-sdk';
import type { EventBus } from '@omni/core';
import { createLogger } from '@omni/core';
import type { ChannelType } from '@omni/core/types';
import type { Database, SyncJobConfig, SyncJobType } from '@omni/db';
import { omniGroups } from '@omni/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Services } from '../services';
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

        try {
          // Start the job
          await services.syncJobs.start(jobId);

          // Get instance to determine channel type
          const instance = await services.instances.getById(instanceId);
          if (!instance) {
            throw new Error(`Instance ${instanceId} not found`);
          }

          const channelType = instance.channel;

          // Process based on job type
          switch (type) {
            case 'messages':
              await processMessageSync(jobId, instanceId, channelType, config, services, channelRegistry);
              break;
            case 'profile':
              // Profile sync is handled by ProfileSyncService, just mark complete
              await services.syncJobs.complete(jobId);
              break;
            case 'contacts':
              await processContactsSync(jobId, instanceId, channelType, config, services, channelRegistry);
              break;
            case 'groups':
              await processGroupsSync(jobId, instanceId, channelType, config, services, channelRegistry);
              break;
            case 'all':
              // All sync - process each type
              await processMessageSync(jobId, instanceId, channelType, config, services, channelRegistry);
              break;
            case 'history-push':
              // Progress/completion is driven by tracker subscribers, not the worker
              break;
            default:
              log.warn('Unknown sync type', { jobId, type });
              await services.syncJobs.fail(jobId, `Unknown sync type: ${type}`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log.error('Sync job failed', { jobId, error: errorMessage });
          await services.syncJobs.fail(jobId, errorMessage);
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
  instanceId: string,
  _services: Services,
): Promise<
  Array<{ chatJid: string; messageKey: { remoteJid: string; id: string; fromMe: boolean }; timestamp: number }>
> {
  if (!db) {
    log.warn('Database not available for building anchors');
    return [];
  }

  // Query oldest message per chat that has a raw_payload with key
  // Using raw SQL for the complex DISTINCT ON query
  const result = await db.execute(sql`
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
): Promise<WAnchor[]> {
  const anchoredJids = new Set(dbAnchors.map((a) => a.chatJid));

  // Query DB for all known chat external IDs (survives restarts)
  const dbExternalIds = await services.chats.getAllExternalIds(instanceId);

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
): Promise<WAnchor[]> {
  // Explicit chatJids take priority (per-chat active sync)
  if (config.chatJids?.length) {
    return buildAnchorsForExplicitChatJids(jobId, config.chatJids, dbAnchors);
  }

  // Default: use DB anchors + discover chats known to Baileys but not in DB.
  return [...dbAnchors, ...(await discoverAnchorsFromPlugin(jobId, instanceId, plugin, dbAnchors, services))];
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
): Promise<void> {
  const plugin = channelRegistry.get(channelType);
  if (!plugin) {
    throw new Error(`No plugin found for channel type: ${channelType}`);
  }

  // Check if plugin supports fetchHistory
  if (!('fetchHistory' in plugin) || typeof plugin.fetchHistory !== 'function') {
    log.warn('Plugin does not support fetchHistory', { channelType });
    await services.syncJobs.complete(jobId);
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
    // Per-chat active sync: build anchors for the specific requested chats only
    const dbAnchors = await buildWhatsAppAnchors(instanceId, services);
    anchors = await resolveWhatsAppAnchors(jobId, instanceId, config, plugin, dbAnchors, services);
    log.info('WhatsApp per-chat active sync', { jobId, anchorCount: anchors.length, chatJids: config.chatJids });
  } else if (channelType === 'whatsapp-baileys') {
    // Default sync: discover all known chats from DB + Baileys volatile cache.
    // Using DB ensures chats survive restarts even when Baileys cache is empty.
    const dbAnchors = await buildWhatsAppAnchors(instanceId, services);
    const discoveredAnchors = await discoverAnchorsFromPlugin(jobId, instanceId, plugin, dbAnchors, services);
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
      await services.syncJobs.updateProgress(jobId, {
        fetched: count,
        stored,
        duplicates,
        totalEstimated: progress ? Math.round(count / (progress / 100)) : undefined,
      });
    },
    onMessage: async (msg: HistorySyncMessage) => {
      // Rate limit
      await rateLimiter.wait();

      fetched++;

      try {
        // Find or create chat
        const { chat } = await services.chats.findOrCreate(instanceId, msg.chatId, {
          chatType: 'dm', // Default, will be updated
          channel: channelType as 'whatsapp-baileys' | 'discord',
        });

        // Check for duplicates
        const existing = await services.messages.getByExternalId(chat.id, msg.externalId);
        if (existing) {
          duplicates++;
          return;
        }

        // Create message
        await services.messages.create({
          chatId: chat.id,
          externalId: msg.externalId,
          source: 'sync',
          messageType: mapContentType(msg.content.type),
          textContent: msg.content.text,
          platformTimestamp: msg.timestamp,
          senderPlatformUserId: msg.from,
          isFromMe: msg.isFromMe,
          rawPayload: msg.rawPayload as Record<string, unknown>,
        });

        stored++;
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

  // Update final progress
  await services.syncJobs.updateProgress(jobId, {
    fetched,
    stored,
    duplicates,
  });

  // Complete the job
  await services.syncJobs.complete(jobId);

  log.info('Message sync completed', {
    jobId,
    fetched,
    stored,
    duplicates,
  });
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
async function updateDmChatName(services: Services, instanceId: string, jid: string, name: string): Promise<void> {
  try {
    // Use smart lookup to handle LID/phone JID resolution
    const chat = await services.chats.findByExternalIdSmart(instanceId, jid);
    if (!chat) return;
    const hasStaleJidName = chat.name?.endsWith('@s.whatsapp.net') || chat.name?.endsWith('@lid');
    if (!chat.name || hasStaleJidName) {
      await services.chats.update(chat.id, { name });
    }
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
): Promise<void> {
  const plugin = channelRegistry.get(channelType);
  if (!plugin) {
    throw new Error(`No plugin found for channel type: ${channelType}`);
  }

  // Check if plugin supports fetchContacts
  if (!('fetchContacts' in plugin) || typeof plugin.fetchContacts !== 'function') {
    log.warn('Plugin does not support fetchContacts', { channelType });
    await services.syncJobs.complete(jobId);
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
      await services.syncJobs.updateProgress(jobId, {
        fetched: count,
        stored,
        duplicates: 0,
      });
    },
    onContact: async (contact: unknown) => {
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
        const result = await services.persons.findOrCreateIdentity(
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
        );

        if (result.isNew) stored++;
        if (result.wasLinked) linked++;

        // Update DM chat name if missing or stale
        if (c.name && !c.isGroup) {
          await updateDmChatName(services, instanceId, c.platformUserId, c.name);
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

  // Update final progress
  await services.syncJobs.updateProgress(jobId, {
    fetched,
    stored,
    duplicates: 0,
  });

  // Complete the job
  await services.syncJobs.complete(jobId);

  log.info('Contacts sync completed', {
    jobId,
    fetched,
    stored,
    linked,
  });
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
): Promise<void> {
  const plugin = channelRegistry.get(channelType);
  if (!plugin) {
    throw new Error(`No plugin found for channel type: ${channelType}`);
  }

  // Check if plugin supports fetchGroups (WhatsApp) or fetchGuilds (Discord)
  const fetchMethod = channelType === 'discord' ? 'fetchGuilds' : 'fetchGroups';
  if (!(fetchMethod in plugin) || typeof plugin[fetchMethod as keyof typeof plugin] !== 'function') {
    log.warn(`Plugin does not support ${fetchMethod}`, { channelType });
    await services.syncJobs.complete(jobId);
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
      await services.syncJobs.updateProgress(jobId, {
        fetched: count,
        stored,
        duplicates: updated,
      });
    },
    onGroup: async (group: unknown) => {
      fetched++;

      const g = group as {
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

      try {
        // Check if group already exists
        const [existing] = await database
          .select()
          .from(omniGroups)
          .where(and(eq(omniGroups.instanceId, instanceId), eq(omniGroups.externalId, g.externalId)))
          .limit(1);

        if (existing) {
          // Update existing group
          await database
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
          updated++;
        } else {
          // Create new group
          await database.insert(omniGroups).values({
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
          stored++;
        }
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
        // Check if guild already exists
        const [existing] = await database
          .select()
          .from(omniGroups)
          .where(and(eq(omniGroups.instanceId, instanceId), eq(omniGroups.externalId, g.externalId)))
          .limit(1);

        if (existing) {
          // Update existing guild
          await database
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
          updated++;
        } else {
          // Create new guild
          await database.insert(omniGroups).values({
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
          stored++;
        }
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

  // Update final progress
  await services.syncJobs.updateProgress(jobId, {
    fetched,
    stored,
    duplicates: updated,
  });

  // Complete the job
  await services.syncJobs.complete(jobId);

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

        try {
          // Create a running history-push sync job
          const job = await services.syncJobs.create({
            instanceId,
            channelType,
            type: 'history-push',
          });

          // Immediately start the job (set status to running)
          await services.syncJobs.start(job.id);

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

        try {
          // Find the active history-push job for this instance
          const activeJobs = await services.syncJobs.getActiveForInstance(payload.instanceId);
          const historyPushJob = activeJobs.find((j) => j.type === 'history-push');

          if (!historyPushJob) {
            historyPushLog.debug('No active history-push job found for progress update', {
              instanceId: payload.instanceId,
            });
            return;
          }

          await services.syncJobs.updateProgress(historyPushJob.id, {
            fetched: payload.fetched ?? 0,
            stored: 0,
            duplicates: 0,
            mediaDownloaded: 0,
            totalEstimated:
              payload.progress && payload.progress > 0
                ? Math.round((payload.fetched ?? 0) / (payload.progress / 100))
                : 0,
          });

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

        try {
          // Find the active history-push job for this instance
          const activeJobs = await services.syncJobs.getActiveForInstance(payload.instanceId);
          const historyPushJob = activeJobs.find((j) => j.type === 'history-push');

          if (!historyPushJob) {
            historyPushLog.debug('No active history-push job found for completion', {
              instanceId: payload.instanceId,
            });
            return;
          }

          // Update final progress
          await services.syncJobs.updateProgress(historyPushJob.id, {
            fetched: payload.totalFetched ?? 0,
            stored: 0,
            duplicates: 0,
            mediaDownloaded: 0,
          });

          // Mark completed
          await services.syncJobs.complete(historyPushJob.id);

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
