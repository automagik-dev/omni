/**
 * Access service - manages access rules (allow/deny lists)
 *
 * Supports three access modes per instance:
 * - disabled: No access control, all users allowed
 * - blocklist: Default allow, deny matching rules (default)
 * - allowlist: Default deny, allow matching rules
 */

import type { CacheProvider, EventBus } from '@omni/core';
import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import { type AccessMode, type AccessRule, type NewAccessRule, type RuleType, accessRules } from '@omni/db';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { CacheKeys } from '../cache/cache-keys';

export interface CheckAccessResult {
  allowed: boolean;
  rule?: AccessRule;
  reason: string;
  mode: AccessMode;
}

export class AccessService {
  constructor(
    private db: Database,
    private eventBus: EventBus | null,
    private cache?: CacheProvider,
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

    // Invalidate access cache on rule mutation
    await this.cache?.clear();

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

    // Invalidate access cache on rule mutation
    await this.cache?.clear();

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

    // Invalidate access cache on rule mutation
    await this.cache?.clear();
  }

  /**
   * Check if access is allowed for a user.
   *
   * Mode-aware evaluation:
   * - disabled: always allow, skip rule evaluation
   * - blocklist: default allow, deny on matching deny rule
   * - allowlist: default deny, allow on matching allow rule
   */
  async checkAccess(
    instance: { id: string; accessMode: AccessMode },
    platformUserId: string,
    _channel: string,
  ): Promise<CheckAccessResult> {
    const { id: instanceId, accessMode } = instance;

    if (accessMode === 'disabled') {
      return { allowed: true, reason: 'Access control disabled', mode: 'disabled' };
    }

    const cacheKey = CacheKeys.accessCheck(instanceId, platformUserId);
    const cached = await this.cache?.get<CheckAccessResult>(cacheKey);
    if (cached) return cached;

    const rules = await this.getApplicableRules(instanceId);
    const matchingRule = rules.find((rule) => this.ruleMatches(rule, platformUserId));
    const result = this.evaluateMode(accessMode, matchingRule);

    await this.cache?.set(cacheKey, result);
    await this.publishResult(instanceId, platformUserId, result);

    return result;
  }

  /**
   * Evaluate access mode against a matching rule (or lack thereof).
   */
  private evaluateMode(mode: AccessMode, matchingRule: AccessRule | undefined): CheckAccessResult {
    if (!matchingRule) {
      const defaultAllowed = mode === 'blocklist';
      return {
        allowed: defaultAllowed,
        reason: defaultAllowed ? 'No matching rule, default allow' : 'No matching rule, default deny (allowlist)',
        mode,
      };
    }

    const allowed = matchingRule.ruleType === 'allow';
    return {
      allowed,
      rule: matchingRule,
      reason: matchingRule.reason ?? (allowed ? 'Allowed by rule' : 'Denied by rule'),
      mode,
    };
  }

  /**
   * Publish access event based on result.
   */
  private async publishResult(instanceId: string, platformUserId: string, result: CheckAccessResult): Promise<void> {
    if (result.rule) {
      await this.publishAccessEvent(instanceId, platformUserId, result.rule, result.allowed);
    } else if (!result.allowed) {
      await this.publishDefaultDenyEvent(instanceId, platformUserId);
    }
  }

  /**
   * Get all applicable rules for an instance, ordered by priority desc then newest first.
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
      .orderBy(desc(accessRules.priority), desc(accessRules.createdAt));
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
   * Publish deny event for allowlist default deny (no matching rule)
   */
  private async publishDefaultDenyEvent(instanceId: string, platformUserId: string): Promise<void> {
    if (!this.eventBus) return;

    await this.eventBus.publish('access.denied', {
      instanceId,
      platformUserId,
      reason: 'Not in allowlist',
      action: 'block',
    });
  }

  /**
   * Normalize a phone number by stripping leading '+' for comparison.
   * WhatsApp sends numbers without '+' while rules may be stored with it.
   */
  private normalizePhone(phone: string): string {
    return phone.replace(/^\+/, '');
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
      const normalizedPattern = this.normalizePhone(rule.phonePattern);
      const normalizedUserId = this.normalizePhone(platformUserId);
      // Escape regex metacharacters except *, then replace * with .*
      const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
      const pattern = escaped.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(normalizedUserId);
    }

    return false;
  }
}
