/**
 * Profile sync service - syncs instance profile information from channels
 *
 * @see history-sync wish
 */

import type { ChannelRegistry } from '@omni/channel-sdk';
import type { EventBus } from '@omni/core';
import { NotFoundError, createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { instances } from '@omni/db';
import { eq } from 'drizzle-orm';

const log = createLogger('services:profile-sync');

export interface ProfileInfo {
  name?: string;
  avatarUrl?: string;
  bio?: string;
  ownerIdentifier?: string;
  platformMetadata?: Record<string, unknown>;
}

/**
 * Check if profile is stale (older than 24 hours)
 */
function isProfileStale(lastSyncedAt: Date | null, staleThresholdHours = 24): boolean {
  if (!lastSyncedAt) return true;
  const now = new Date();
  const hoursAgo = (now.getTime() - lastSyncedAt.getTime()) / (1000 * 60 * 60);
  return hoursAgo > staleThresholdHours;
}

export class ProfileSyncService {
  constructor(
    private db: Database,
    private eventBus: EventBus | null,
    private channelRegistry: ChannelRegistry,
  ) {}

  /**
   * Sync profile for an instance
   *
   * @param instanceId - Instance ID to sync profile for
   * @returns The synced profile information
   */
  async syncProfile(instanceId: string): Promise<ProfileInfo> {
    // Get instance
    const [instance] = await this.db.select().from(instances).where(eq(instances.id, instanceId)).limit(1);

    if (!instance) {
      throw new NotFoundError('Instance', instanceId);
    }

    // Get the plugin for this channel
    const plugin = this.channelRegistry.get(instance.channel as Parameters<typeof this.channelRegistry.get>[0]);

    if (!plugin) {
      throw new Error(`No plugin found for channel: ${instance.channel}`);
    }

    // Check if plugin has getProfile method
    if (!('getProfile' in plugin) || typeof plugin.getProfile !== 'function') {
      throw new Error(`Plugin ${instance.channel} does not support profile sync`);
    }

    // Get profile from plugin
    const profile = await (plugin as { getProfile: (instanceId: string) => Promise<ProfileInfo> }).getProfile(
      instanceId,
    );

    // Update instance with profile info
    await this.db
      .update(instances)
      .set({
        profileName: profile.name ?? instance.profileName,
        profilePicUrl: profile.avatarUrl ?? instance.profilePicUrl,
        profileBio: profile.bio ?? null,
        profileMetadata: profile.platformMetadata ?? null,
        profileSyncedAt: new Date(),
        ownerIdentifier: profile.ownerIdentifier ?? instance.ownerIdentifier,
        updatedAt: new Date(),
      })
      .where(eq(instances.id, instanceId));

    // Emit profile.synced event
    if (this.eventBus) {
      await this.eventBus.publish('profile.synced', {
        instanceId,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        bio: profile.bio,
        platformMetadata: profile.platformMetadata,
      });
    }

    return profile;
  }

  /**
   * Sync profile if stale
   *
   * @param instanceId - Instance ID to check and sync
   * @param staleThresholdHours - Hours after which profile is considered stale (default: 24)
   * @returns The profile info if synced, or null if not stale
   */
  async syncIfStale(instanceId: string, staleThresholdHours = 24): Promise<ProfileInfo | null> {
    // Get instance
    const [instance] = await this.db.select().from(instances).where(eq(instances.id, instanceId)).limit(1);

    if (!instance) {
      throw new NotFoundError('Instance', instanceId);
    }

    // Check if stale
    if (!isProfileStale(instance.profileSyncedAt, staleThresholdHours)) {
      return null;
    }

    // Sync and return profile
    return this.syncProfile(instanceId);
  }

  /**
   * Sync all stale profiles for active instances
   *
   * @param staleThresholdHours - Hours after which profile is considered stale (default: 24)
   * @returns Number of profiles synced
   */
  async syncAllStale(staleThresholdHours = 24): Promise<{ synced: number; failed: number }> {
    // Get all active instances
    const activeInstances = await this.db.select().from(instances).where(eq(instances.isActive, true));

    let synced = 0;
    let failed = 0;

    for (const instance of activeInstances) {
      if (!isProfileStale(instance.profileSyncedAt, staleThresholdHours)) {
        continue;
      }

      try {
        await this.syncProfile(instance.id);
        synced++;
      } catch (error) {
        log.error(`Failed to sync profile for instance ${instance.id}`, { error: String(error) });
        failed++;
      }
    }

    return { synced, failed };
  }

  /**
   * Get current profile info from database (no sync)
   */
  async getProfile(instanceId: string): Promise<ProfileInfo & { lastSyncedAt: Date | null }> {
    const [instance] = await this.db.select().from(instances).where(eq(instances.id, instanceId)).limit(1);

    if (!instance) {
      throw new NotFoundError('Instance', instanceId);
    }

    return {
      name: instance.profileName ?? undefined,
      avatarUrl: instance.profilePicUrl ?? undefined,
      bio: instance.profileBio ?? undefined,
      ownerIdentifier: instance.ownerIdentifier ?? undefined,
      platformMetadata: (instance.profileMetadata as Record<string, unknown>) ?? undefined,
      lastSyncedAt: instance.profileSyncedAt,
    };
  }

  /**
   * Check if a plugin supports profile sync
   */
  supportsProfileSync(channelType: string): boolean {
    const plugin = this.channelRegistry.get(channelType as Parameters<typeof this.channelRegistry.get>[0]);
    return plugin !== undefined && 'getProfile' in plugin && typeof plugin.getProfile === 'function';
  }
}
