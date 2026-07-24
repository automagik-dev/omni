/**
 * Access service - manages access rules (allow/deny lists)
 *
 * Supports three access modes per instance:
 * - disabled: No access control, all users allowed
 * - blocklist: Default allow, deny matching rules (default)
 * - allowlist: Default deny, allow matching rules
 *
 * Pairing flow (for allowlist mode):
 * - Unknown sender triggers pairing request with 6-char code (A-Z, 0-9)
 * - Owner approves/denies via API or CLI
 * - Max 3 pending requests per instance, 1 hour expiry
 */

import { randomInt } from 'node:crypto';
import type { CacheProvider, EventBus } from '@omni/core';
import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import { type AccessMode, type AccessRule, type NewAccessRule, type RuleType, accessRules, instances } from '@omni/db';
import { type SQL, and, count, desc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import { CacheKeys, CacheTTL, authCacheTtlMs } from '../cache/cache-keys';
import { scopedHandle } from '../tenancy/tenant-scope';

/** Default pairing request expiry: 1 hour */
const DEFAULT_PAIRING_EXPIRY_MS = 60 * 60 * 1000;

/** Max pending pairing requests per instance */
const MAX_PENDING_PER_INSTANCE = 3;

/** Pairing code character set: A-Z, 0-9 (36 chars, no lowercase) */
const PAIRING_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Pairing code length: 6 chars = 2.1B combinations */
const PAIRING_CODE_LENGTH = 6;

export interface CheckAccessResult {
  allowed: boolean;
  rule?: AccessRule;
  reason: string;
  mode: AccessMode;
}

export interface PairingRequest {
  id: string;
  instanceId: string;
  platformUserId: string;
  pairingCode: string;
  expiresAt: Date;
  createdAt: Date;
}

/** Thrown when a pairing request has expired */
export class PairingRequestExpiredError extends Error {
  constructor(requestId: string) {
    super(`Pairing request has expired: ${requestId}`);
    this.name = 'PairingRequestExpiredError';
  }
}

/** Thrown when a pairing request has already been consumed (approved or denied) */
export class PairingRequestConsumedError extends Error {
  constructor(requestId: string) {
    super(`Pairing request has already been used: ${requestId}`);
    this.name = 'PairingRequestConsumedError';
  }
}

export class AccessService {
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
    private cache?: CacheProvider | null,
  ) {}

  /**
   * List access rules.
   * Always excludes internal `pending_pairing` rows — use
   * `listPendingPairingRequests()` to inspect pairing state.
   */
  async list(options: { instanceId?: string; type?: RuleType } = {}): Promise<AccessRule[]> {
    const { instanceId, type } = options;

    // Always exclude internal pairing-state rows from the public listing
    const conditions: (SQL<unknown> | undefined)[] = [ne(accessRules.ruleType, 'pending_pairing')];

    if (instanceId) {
      // Include both instance-specific and global rules
      conditions.push(or(eq(accessRules.instanceId, instanceId), isNull(accessRules.instanceId)));
    }

    if (type) {
      conditions.push(eq(accessRules.ruleType, type));
    }

    return this.db
      .select()
      .from(accessRules)
      .where(and(...conditions))
      .orderBy(desc(accessRules.priority));
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

    // G5 (RELEASE_SLOS auth_cache_invalidation_seconds_max): an allow/deny
    // decision is cached authorization state — clamped to the revocation
    // ceiling when multitenancy is enabled; the legacy 5-minute TTL flag-off
    // (the explicit argument equals the cache's default, so flag-off behavior
    // is unchanged).
    await this.cache?.set(cacheKey, result, authCacheTtlMs(CacheTTL.ACCESS_CHECK));
    await this.publishResult(instanceId, platformUserId, result);

    return result;
  }

  // ==========================================================================
  // PAIRING FLOW
  // ==========================================================================

  /**
   * Generate a 6-character uppercase alphanumeric pairing code.
   * Character set: A-Z, 0-9 (36 chars, 2.1B combinations).
   */
  static generatePairingCode(): string {
    let code = '';
    for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
      const randomIndex = randomInt(0, PAIRING_CODE_CHARS.length);
      code += PAIRING_CODE_CHARS[randomIndex];
    }
    return code;
  }

  /**
   * Request a pairing code for an unknown sender in allowlist mode.
   *
   * - If sender already has a pending request, reuse existing code
   * - Max 3 pending requests per instance enforced
   * - Expired requests are auto-cleaned
   * - Returns the pairing request or null if rate-limited
   *
   * The read-count-insert sequence is wrapped in a transaction with a
   * per-instance advisory lock so concurrent denied messages cannot both
   * race past the `pendingCount < MAX` check and create duplicates.
   */
  async requestPairing(
    instanceId: string,
    platformUserId: string,
    options: { expiryMs?: number; channelType?: string } = {},
  ): Promise<PairingRequest | null> {
    const expiryMs = options.expiryMs ?? DEFAULT_PAIRING_EXPIRY_MS;

    // Run the check + insert atomically under a per-instance advisory lock.
    // pg_advisory_xact_lock serializes concurrent calls for the same instance
    // and is released automatically when the transaction ends.
    const txResult = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${instanceId}))`);

      // Clean expired requests
      await tx
        .delete(accessRules)
        .where(
          and(
            eq(accessRules.instanceId, instanceId),
            eq(accessRules.ruleType, 'pending_pairing'),
            sql`${accessRules.expiresAt} <= now()`,
          ),
        );

      // Reuse existing code if sender already has a pending request
      const [existing] = await tx
        .select()
        .from(accessRules)
        .where(
          and(
            eq(accessRules.instanceId, instanceId),
            eq(accessRules.ruleType, 'pending_pairing'),
            eq(accessRules.platformUserId, platformUserId),
            gt(accessRules.expiresAt, new Date()),
          ),
        )
        .limit(1);

      if (existing) {
        const metadata = existing.metadata as Record<string, unknown> | null;
        return {
          request: {
            id: existing.id,
            instanceId: existing.instanceId ?? instanceId,
            platformUserId: existing.platformUserId ?? platformUserId,
            pairingCode: (metadata?.pairingCode as string) ?? '',
            expiresAt: existing.expiresAt ?? new Date(Date.now() + expiryMs),
            createdAt: existing.createdAt,
          } satisfies PairingRequest,
          isNew: false,
        };
      }

      // Rate limit: max pending per instance
      const [countResult] = await tx
        .select({ count: count() })
        .from(accessRules)
        .where(
          and(
            eq(accessRules.instanceId, instanceId),
            eq(accessRules.ruleType, 'pending_pairing'),
            gt(accessRules.expiresAt, new Date()),
          ),
        );

      if ((countResult?.count ?? 0) >= MAX_PENDING_PER_INSTANCE) {
        return null; // Rate-limited
      }

      // Generate code and insert new pairing request
      const pairingCode = AccessService.generatePairingCode();
      const expiresAt = new Date(Date.now() + expiryMs);

      const [rule] = await tx
        .insert(accessRules)
        .values({
          instanceId,
          ruleType: 'pending_pairing',
          platformUserId,
          priority: 0,
          enabled: true,
          action: 'block',
          expiresAt,
          metadata: { pairingCode, requestedAt: Date.now() },
        })
        .returning();

      if (!rule) {
        throw new Error('Failed to create pairing request');
      }

      return {
        request: {
          id: rule.id,
          instanceId,
          platformUserId,
          pairingCode,
          expiresAt,
          createdAt: rule.createdAt,
        } satisfies PairingRequest,
        isNew: true,
      };
    });

    if (!txResult) return null;

    // Publish event outside the transaction so it only fires on commit
    if (txResult.isNew && this.eventBus) {
      await this.eventBus.publish(
        'access.pairing_requested',
        {
          instanceId,
          platformUserId,
          pairingCode: txResult.request.pairingCode,
          requestId: txResult.request.id,
          expiresAt: txResult.request.expiresAt.getTime(),
        },
        {
          instanceId,
          channelType: options.channelType as import('@omni/core').ChannelType | undefined,
        },
      );
    }

    return txResult.request;
  }

  /**
   * List pending pairing requests for an instance.
   * Only returns non-expired pending_pairing rules.
   */
  async listPendingPairingRequests(instanceId: string): Promise<PairingRequest[]> {
    // Clean expired first
    await this.cleanExpiredPairingRequests(instanceId);

    const rules = await this.db
      .select()
      .from(accessRules)
      .where(
        and(
          eq(accessRules.instanceId, instanceId),
          eq(accessRules.ruleType, 'pending_pairing'),
          gt(accessRules.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(accessRules.createdAt));

    return rules.map((rule) => {
      const metadata = rule.metadata as Record<string, unknown> | null;
      return {
        id: rule.id,
        instanceId: rule.instanceId ?? instanceId,
        platformUserId: rule.platformUserId ?? '',
        pairingCode: (metadata?.pairingCode as string) ?? '',
        expiresAt: rule.expiresAt ?? new Date(),
        createdAt: rule.createdAt,
      };
    });
  }

  /**
   * Approve a pairing request.
   * Creates an 'allow' rule for the user and deletes the pairing request.
   * One-time-use and instance-scoped: concurrent approvals and cross-instance
   * access are both rejected atomically inside a transaction.
   */
  async approvePairingRequest(requestId: string, instanceId: string): Promise<AccessRule> {
    const { allowRule, platformUserId } = await this.db.transaction(async (tx) => {
      // Fetch the request with instance scoping to prevent cross-tenant access
      const [request] = await tx
        .select()
        .from(accessRules)
        .where(
          and(
            eq(accessRules.id, requestId),
            eq(accessRules.instanceId, instanceId),
            eq(accessRules.ruleType, 'pending_pairing'),
          ),
        )
        .limit(1);

      if (!request) {
        throw new NotFoundError('AccessRule', requestId);
      }

      // Check if expired
      if (request.expiresAt && request.expiresAt < new Date()) {
        throw new PairingRequestExpiredError(requestId);
      }

      // Atomically mark as consumed — only succeeds if not already consumed.
      // This prevents duplicate allow-rule creation under concurrent approve calls.
      const [consumed] = await tx
        .update(accessRules)
        .set({
          metadata: {
            ...(request.metadata as Record<string, unknown> | null),
            consumed: true,
            consumedAt: Date.now(),
            consumedAction: 'approve',
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(accessRules.id, requestId),
            sql`(${accessRules.metadata}->>'consumed' IS NULL OR ${accessRules.metadata}->>'consumed' != 'true')`,
          ),
        )
        .returning();

      if (!consumed) {
        throw new PairingRequestConsumedError(requestId);
      }

      // Create allow rule for the user (within the same transaction)
      const [created] = await tx
        .insert(accessRules)
        .values({
          instanceId: request.instanceId,
          ruleType: 'allow',
          platformUserId: request.platformUserId,
          priority: 0,
          enabled: true,
          action: 'allow',
          reason: 'Approved via pairing request',
        })
        .returning();

      if (!created) {
        throw new Error('Failed to create allow rule');
      }

      // Delete the consumed pairing request
      await tx.delete(accessRules).where(eq(accessRules.id, requestId));

      return { allowRule: created, platformUserId: request.platformUserId ?? '' };
    });

    // Invalidate cache outside the transaction
    await this.cache?.clear();

    // Emit pairing approved event with channel metadata
    if (this.eventBus) {
      // Look up instance to get channel type for NATS subject routing
      const [instance] = await this.db
        .select({ channel: instances.channel })
        .from(instances)
        .where(eq(instances.id, instanceId))
        .limit(1);
      await this.eventBus.publish(
        'access.pairing_approved',
        {
          instanceId,
          platformUserId,
          requestId,
          ruleId: allowRule.id,
        },
        {
          instanceId,
          channelType: instance?.channel,
        },
      );
    }

    return allowRule;
  }

  /**
   * Deny a pairing request.
   * Stores deny reason in metadata audit log and deletes the request.
   * One-time-use and instance-scoped: concurrent denials and cross-instance
   * access are both rejected atomically inside a transaction.
   */
  async denyPairingRequest(requestId: string, instanceId: string, reason?: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Fetch the request with instance scoping to prevent cross-tenant access
      const [request] = await tx
        .select()
        .from(accessRules)
        .where(
          and(
            eq(accessRules.id, requestId),
            eq(accessRules.instanceId, instanceId),
            eq(accessRules.ruleType, 'pending_pairing'),
          ),
        )
        .limit(1);

      if (!request) {
        throw new NotFoundError('AccessRule', requestId);
      }

      // Check if expired
      if (request.expiresAt && request.expiresAt < new Date()) {
        throw new PairingRequestExpiredError(requestId);
      }

      // Atomically mark as consumed — only succeeds if not already consumed.
      // This prevents double-deny or approve-after-deny races.
      const [consumed] = await tx
        .update(accessRules)
        .set({
          metadata: {
            ...(request.metadata as Record<string, unknown> | null),
            consumed: true,
            consumedAt: Date.now(),
            consumedAction: 'deny',
            denyReason: reason,
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(accessRules.id, requestId),
            sql`(${accessRules.metadata}->>'consumed' IS NULL OR ${accessRules.metadata}->>'consumed' != 'true')`,
          ),
        )
        .returning();

      if (!consumed) {
        throw new PairingRequestConsumedError(requestId);
      }

      // Delete the consumed pairing request
      await tx.delete(accessRules).where(eq(accessRules.id, requestId));
    });

    // Invalidate cache outside the transaction
    await this.cache?.clear();
  }

  // ==========================================================================
  // PAIRING HELPERS
  // ==========================================================================

  /**
   * Clean expired pairing requests for an instance.
   */
  private async cleanExpiredPairingRequests(instanceId: string): Promise<void> {
    await this.db
      .delete(accessRules)
      .where(
        and(
          eq(accessRules.instanceId, instanceId),
          eq(accessRules.ruleType, 'pending_pairing'),
          sql`${accessRules.expiresAt} <= now()`,
        ),
      );
  }

  // ==========================================================================
  // ACCESS EVALUATION
  // ==========================================================================

  /**
   * Evaluate access mode against a matching rule (or lack thereof).
   *
   * GUARD: pending_pairing rules MUST NOT be evaluated as access decisions.
   * If a matching rule has ruleType 'pending_pairing', it throws an error.
   */
  private evaluateMode(mode: AccessMode, matchingRule: AccessRule | undefined): CheckAccessResult {
    if (matchingRule?.ruleType === 'pending_pairing') {
      throw new Error('pending_pairing rules cannot be used as access decisions');
    }

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
   * Excludes pending_pairing rules from access evaluation.
   */
  private async getApplicableRules(instanceId: string): Promise<AccessRule[]> {
    return this.db
      .select()
      .from(accessRules)
      .where(
        and(
          or(eq(accessRules.instanceId, instanceId), isNull(accessRules.instanceId)),
          eq(accessRules.enabled, true),
          ne(accessRules.ruleType, 'pending_pairing'),
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
    // Exact match on platformUserId (normalize JIDs by stripping @suffix)
    if (rule.platformUserId) {
      const normalizeJid = (id: string) => id.replace(/@.*$/, '');
      if (normalizeJid(rule.platformUserId) === normalizeJid(platformUserId)) {
        return true;
      }
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
