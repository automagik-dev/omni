/**
 * Instance service - manages channel instance configurations
 */

import type { EventBus } from '@omni/core';
import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import { type ChannelType, type Instance, type NewInstance, instances } from '@omni/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { forgetInstanceOwner, rememberInstanceOwners } from '../tenancy/instance-owner-registry';
import { scopedHandle } from '../tenancy/tenant-scope';

export interface ListInstancesOptions {
  channel?: ChannelType[];
  status?: ('active' | 'inactive')[];
  limit?: number;
  cursor?: string;
}

export class InstanceService {
  /**
   * The handle every query in this service uses.
   *
   * Inside a tenant-scoped request this is the request's tenant-stamped
   * transaction (wish: omni-full-multitenancy, G4 — see `tenancy/tenant-scope.ts`);
   * for a legacy credential, a worker, or the CLI it is the ambient pool and
   * the query issued is byte-for-byte the one issued before the conversion.
   */
  private get db(): Database {
    return scopedHandle(this.pool);
  }

  constructor(
    private readonly pool: Database,
    private eventBus: EventBus | null,
  ) {}

  /**
   * List instances with filtering
   */
  async list(options: ListInstancesOptions = {}): Promise<{
    items: Instance[];
    hasMore: boolean;
    cursor?: string;
  }> {
    const { channel, status, limit = 50, cursor } = options;

    let query = this.db.select().from(instances).$dynamic();

    // Build conditions
    const conditions = [];

    if (channel?.length) {
      conditions.push(inArray(instances.channel, channel));
    }

    if (status?.length) {
      const activeStatus = status.includes('active');
      const inactiveStatus = status.includes('inactive');
      if (activeStatus && !inactiveStatus) {
        conditions.push(eq(instances.isActive, true));
      } else if (inactiveStatus && !activeStatus) {
        conditions.push(eq(instances.isActive, false));
      }
    }

    if (cursor) {
      // Cursor is the last ID seen
      conditions.push(sql`${instances.id} > ${cursor}`);
    }

    if (conditions.length) {
      query = query.where(and(...conditions));
    }

    const items = await query.orderBy(instances.createdAt).limit(limit + 1);

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    // G5 (ADR-0008): every `instances` row this service loads teaches the
    // ownership registry, so a channel plugin's later scope-less publish for
    // that instance can stamp a TRUSTED tenant instead of falling back to a
    // legacy envelope. The tenant comes from the persisted row, never a caller
    // claim; a NULL tenant (flag-off) teaches nothing. See
    // `tenancy/instance-owner-registry.ts`.
    rememberInstanceOwners(items);

    const lastItem = items[items.length - 1];
    return {
      items,
      hasMore,
      cursor: lastItem?.id,
    };
  }

  /**
   * List all active instances
   */
  async listActive(): Promise<Instance[]> {
    const rows = await this.db.select().from(instances).where(eq(instances.isActive, true));
    rememberInstanceOwners(rows);
    return rows;
  }

  /**
   * Get instance by ID
   */
  async getById(id: string): Promise<Instance> {
    const [result] = await this.db.select().from(instances).where(eq(instances.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('Instance', id);
    }

    rememberInstanceOwners([result]);
    return result;
  }

  /**
   * Get instance by name
   */
  async getByName(name: string): Promise<Instance> {
    const [result] = await this.db.select().from(instances).where(eq(instances.name, name)).limit(1);

    if (!result) {
      throw new NotFoundError('Instance', name);
    }

    return result;
  }

  /**
   * Create a new instance
   */
  async create(data: NewInstance): Promise<Instance> {
    const [created] = await this.db.insert(instances).values(data).returning();

    if (!created) {
      throw new Error('Failed to create instance');
    }

    // Teach the ownership registry BEFORE the publish below: this is the first
    // moment the instance exists, and the `instance.connected` consumers
    // (history-push tracker, event-listeners) derive their worker tenant from
    // the envelope this publish stamps.
    rememberInstanceOwners([created]);

    if (this.eventBus) {
      await this.eventBus.publish('instance.connected', {
        instanceId: created.id,
        channelType: created.channel,
        profileName: created.profileName ?? undefined,
        profilePicUrl: created.profilePicUrl ?? undefined,
        ownerIdentifier: created.ownerIdentifier ?? undefined,
      });
    }

    return created;
  }

  /**
   * Update an instance
   */
  async update(id: string, data: Partial<NewInstance>): Promise<Instance> {
    const [updated] = await this.db
      .update(instances)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(instances.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Instance', id);
    }

    rememberInstanceOwners([updated]);
    return updated;
  }

  /**
   * Atomically set a single guild config override using jsonb_set.
   * Avoids the read-modify-write race where two concurrent requests for different
   * guild IDs can clobber each other by both reading the same snapshot.
   */
  async setGuildConfigOverride(instanceId: string, guildId: string, config: Record<string, unknown>): Promise<void> {
    await this.db
      .update(instances)
      .set({
        guildConfigOverrides: sql`jsonb_set(COALESCE(guild_config_overrides, '{}'), ARRAY[${guildId}], ${JSON.stringify(config)}::jsonb, true)`,
        updatedAt: new Date(),
      })
      .where(eq(instances.id, instanceId));
  }

  /**
   * Atomically delete a single guild config override using the JSONB - operator.
   * Avoids the read-modify-write race for the same reason as setGuildConfigOverride.
   */
  async deleteGuildConfigOverride(instanceId: string, guildId: string): Promise<void> {
    await this.db
      .update(instances)
      .set({
        guildConfigOverrides: sql`COALESCE(guild_config_overrides, '{}') - ${guildId}`,
        updatedAt: new Date(),
      })
      .where(eq(instances.id, instanceId));
  }

  /**
   * Delete an instance
   */
  async delete(id: string): Promise<void> {
    // Get instance first to know the channel type
    const instance = await this.getById(id);

    const result = await this.db.delete(instances).where(eq(instances.id, id)).returning();

    if (!result.length) {
      throw new NotFoundError('Instance', id);
    }

    // The instance is gone; drop its ownership entry so the registry stays
    // bounded by what actually exists.
    forgetInstanceOwner(id);

    if (this.eventBus) {
      await this.eventBus.publish('instance.disconnected', {
        instanceId: id,
        channelType: instance.channel,
        reason: 'deleted',
        willReconnect: false,
      });
    }
  }

  /**
   * Get instance count by channel
   */
  async getCountByChannel(): Promise<Record<string, number>> {
    const result = await this.db
      .select({
        channel: instances.channel,
        count: sql<number>`count(*)::int`,
      })
      .from(instances)
      .groupBy(instances.channel);

    return Object.fromEntries(result.map((r) => [r.channel, r.count]));
  }

  /**
   * Get active instance count
   */
  async getActiveCount(): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(instances)
      .where(eq(instances.isActive, true));

    return result?.count ?? 0;
  }

  /**
   * Update the last message timestamp for an instance.
   * Used for reconnect gap detection — only updates if new timestamp is later.
   */
  async updateLastMessageAt(instanceId: string, timestamp: Date): Promise<void> {
    await this.db
      .update(instances)
      .set({
        lastMessageAt: sql`GREATEST(${instances.lastMessageAt}, ${timestamp.toISOString()})`,
      })
      .where(eq(instances.id, instanceId));
  }

  /**
   * Get the last message timestamp for an instance.
   */
  async getLastMessageAt(instanceId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ lastMessageAt: instances.lastMessageAt })
      .from(instances)
      .where(eq(instances.id, instanceId));
    return row?.lastMessageAt ?? null;
  }
}
