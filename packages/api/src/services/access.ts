/**
 * Access service - manages access rules (allow/deny lists)
 */

import type { EventBus } from '@omni/core';
import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import { type AccessRule, type NewAccessRule, type RuleType, accessRules } from '@omni/db';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';

export interface CheckAccessResult {
  allowed: boolean;
  rule?: AccessRule;
  reason: string;
}

export class AccessService {
  constructor(
    private db: Database,
    private eventBus: EventBus | null,
  ) {}

  /**
   * List access rules
   */
  async list(options: { instanceId?: string; type?: RuleType } = {}): Promise<AccessRule[]> {
    const { instanceId, type } = options;

    const conditions = [];

    if (instanceId) {
      // Include both instance-specific and global rules
      conditions.push(or(eq(accessRules.instanceId, instanceId), isNull(accessRules.instanceId)));
    }

    if (type) {
      conditions.push(eq(accessRules.ruleType, type));
    }

    let query = this.db.select().from(accessRules).$dynamic();

    if (conditions.length) {
      query = query.where(and(...conditions));
    }

    return query.orderBy(desc(accessRules.priority));
  }

  /**
   * Get rule by ID
   */
  async getById(id: string): Promise<AccessRule> {
    const [result] = await this.db.select().from(accessRules).where(eq(accessRules.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('AccessRule', id);
    }

    return result;
  }

  /**
   * Create a new rule
   */
  async create(data: NewAccessRule): Promise<AccessRule> {
    const [created] = await this.db.insert(accessRules).values(data).returning();

    if (!created) {
      throw new Error('Failed to create access rule');
    }

    return created;
  }

  /**
   * Update a rule
   */
  async update(id: string, data: Partial<NewAccessRule>): Promise<AccessRule> {
    const [updated] = await this.db
      .update(accessRules)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(accessRules.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('AccessRule', id);
    }

    return updated;
  }

  /**
   * Delete a rule
   */
  async delete(id: string): Promise<void> {
    const result = await this.db.delete(accessRules).where(eq(accessRules.id, id)).returning();

    if (!result.length) {
      throw new NotFoundError('AccessRule', id);
    }
  }

  /**
   * Check if access is allowed for a user
   */
  async checkAccess(instanceId: string, platformUserId: string, _channel: string): Promise<CheckAccessResult> {
    const rules = await this.getApplicableRules(instanceId);
    const matchingRule = rules.find((rule) => this.ruleMatches(rule, platformUserId));

    if (!matchingRule) {
      return { allowed: true, reason: 'No matching rule, default allow' };
    }

    const allowed = matchingRule.ruleType === 'allow';
    await this.publishAccessEvent(instanceId, platformUserId, matchingRule, allowed);

    return {
      allowed,
      rule: matchingRule,
      reason: matchingRule.reason ?? (allowed ? 'Allowed by rule' : 'Denied by rule'),
    };
  }

  /**
   * Get all applicable rules for an instance
   */
  private async getApplicableRules(instanceId: string): Promise<AccessRule[]> {
    return this.db
      .select()
      .from(accessRules)
      .where(
        and(
          or(eq(accessRules.instanceId, instanceId), isNull(accessRules.instanceId)),
          eq(accessRules.enabled, true),
          or(isNull(accessRules.expiresAt), sql`${accessRules.expiresAt} > now()`),
        ),
      )
      .orderBy(desc(accessRules.priority));
  }

  /**
   * Publish access event (allowed or denied)
   */
  private async publishAccessEvent(
    instanceId: string,
    platformUserId: string,
    rule: AccessRule,
    allowed: boolean,
  ): Promise<void> {
    if (!this.eventBus) return;

    if (allowed) {
      await this.eventBus.publish('access.allowed', {
        instanceId,
        platformUserId,
        ruleId: rule.id,
      });
    } else {
      await this.eventBus.publish('access.denied', {
        instanceId,
        platformUserId,
        ruleId: rule.id,
        reason: rule.reason ?? 'Denied by rule',
        action: rule.action === 'silent_block' ? 'silent_block' : 'block',
      });
    }
  }

  /**
   * Check if a rule matches a platform user ID
   */
  private ruleMatches(rule: AccessRule, platformUserId: string): boolean {
    // Exact match on platformUserId
    if (rule.platformUserId && rule.platformUserId === platformUserId) {
      return true;
    }

    // Phone pattern match (supports wildcards)
    if (rule.phonePattern) {
      const pattern = rule.phonePattern.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(platformUserId);
    }

    return false;
  }
}
