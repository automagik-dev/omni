/**
 * Instance service - manages channel instance configurations
 */

import type { EventBus } from '@omni/core';
import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import { type ChannelType, type Instance, type NewInstance, instances } from '@omni/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

export interface ListInstancesOptions {
  channel?: ChannelType[];
  status?: ('active' | 'inactive')[];
  limit?: number;
  cursor?: string;
}

export interface InstanceWithStatus extends Instance {
  connectionStatus?: 'connected' | 'disconnected' | 'connecting' | 'error';
}

export class InstanceService {
  constructor(
    private db: Database,
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

    const lastItem = items[items.length - 1];
    return {
      items,
      hasMore,
      cursor: lastItem?.id,
    };
  }

  /**
   * Get instance by ID
   */
  async getById(id: string): Promise<Instance> {
    const [result] = await this.db.select().from(instances).where(eq(instances.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('Instance', id);
    }

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

    return updated;
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
}
