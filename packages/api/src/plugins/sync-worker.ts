/**
 * Sync Worker Plugin
 *
 * Subscribes to sync.started events and processes sync jobs.
 * Handles message history sync by calling channel plugin fetchHistory methods.
 *
 * @see history-sync wish
 */

import type { ChannelRegistry } from '@omni/channel-sdk';
import type { EventBus } from '@omni/core';
import { createLogger } from '@omni/core';
import type { ChannelType } from '@omni/core/types';
import type { Database, SyncJobConfig, SyncJobType } from '@omni/db';
import { omniGroups } from '@omni/db';
import { and, eq, sql } from 'drizzle-orm';
import type { Services } from '../services';

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
  if (database) {
    db = database;
  }
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

  // Build anchors for WhatsApp to enable active history fetching
  let anchors: Array<{
    chatJid: string;
    messageKey: { remoteJid: string; id: string; fromMe: boolean };
    timestamp: number;
  }> = [];

  if (channelType === 'whatsapp-baileys') {
    anchors = await buildWhatsAppAnchors(instanceId, services);
    log.info('WhatsApp anchors built', { jobId, anchorCount: anchors.length });
  }

  const fetchOptions: Record<string, unknown> = {
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
    onMessage: async (message: unknown) => {
      // Rate limit
      await rateLimiter.wait();

      const msg = message as {
        externalId: string;
        chatId: string;
        from: string;
        timestamp: Date;
        content: { type: string; text?: string };
        isFromMe: boolean;
        rawPayload: unknown;
      };

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
    const chat = await services.chats.getByExternalId(instanceId, jid);
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
            matchByPhone: c.phone,
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
