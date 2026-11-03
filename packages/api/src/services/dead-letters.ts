/**
 * Dead Letter Service
 *
 * Manages dead letter events - failed events that exceeded max retries.
 * Supports auto-retry with backoff and manual intervention.
 *
 * @see events-ops wish
 */

import {
  ChannelTypeSchema,
  type ConnectorEventPublisher,
  type DeadLetterEntry,
  type EventBus,
  type EventMetadata,
  type EventType,
  NotFoundError,
  PUBLISH_NOT_DECLARED,
  SCHEMA_NOT_REGISTERED,
  SCHEMA_VALIDATION_FAILED,
  calculateNextAutoRetryAt,
  createDeadLetterSystemPayload,
  createLogger,
  generateId,
  isConnectorEventType,
  prepareDeadLetterInsert,
  resolveInstanceOwnerTenantId,
} from '@omni/core';
import type { Database, DeadLetterStatus } from '@omni/db';
import { deadLetterEvents, resolveEnforcementMode } from '@omni/db';
import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isMultitenancyEnabled } from '../tenancy/feature-flag';
import { enumerateActiveWorkTenants } from '../tenancy/periodic-tenant-work';
import { currentTenantScope, scopedHandle } from '../tenancy/tenant-scope';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';
import { ConnectorProvenanceError, restoreConnectorEvent } from './connectors';
import { DEAD_LETTER_RETRY_SOURCES } from './dead-letter-sources';
import { EventSchemaService } from './event-schemas';

const log = createLogger('dead-letters');

// The scheduler runs every 15 minutes. Expiry recovers an interrupted attempt;
// publication remains at-least-once if its outcome was unknown at the crash.
const RETRY_LEASE_MS = 15 * 60 * 1000;
type RetryClaim = Pick<DeadLetterEntry, 'id' | 'lastRetryAt'>;

function isGovernanceRefusal(error: string): boolean {
  return [SCHEMA_VALIDATION_FAILED, SCHEMA_NOT_REGISTERED, PUBLISH_NOT_DECLARED].some((reason) =>
    error.startsWith(`${reason}:`),
  );
}

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .nullish()
    .catch(undefined)
    .transform((value) => value ?? undefined);

/**
 * The consumed envelope `create` stores as the row's payload. Only the fields
 * that scope the event to its instance and flow come back on a retry. The
 * tenant is never read from here: ownership is the row's persisted tenant_id.
 * Producer identity, the envelope version and timings are stamped by the
 * factory and are not restored either.
 */
const StoredEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.record(z.unknown()),
  metadata: z.object({
    correlationId: optional(z.string()),
    causationId: optional(z.string()),
    instanceId: optional(z.string()),
    channelType: optional(ChannelTypeSchema),
    personId: optional(z.string()),
    platformIdentityId: optional(z.string()),
    traceId: optional(z.string()),
    ingestMode: optional(z.enum(['realtime', 'history-sync'])),
  }),
});

/**
 * Under multitenancy a retry must never move an event into a tenant its row was
 * not already in. A restored instanceId lets the publish derive the instance
 * owner's tenant, so it stays only when the row has a tenant and the bus's own
 * owner registry says that tenant owns the instance. A NULL-owned row, an unknown
 * owner or a mismatch republishes without it; event-persistence then drops an
 * instance-less receipt replay. With the flag off the owner registry is empty and
 * nothing is stamped from the instance, so the restore is unchanged.
 */
function confineToRowTenant(metadata: Partial<EventMetadata>, rowTenantId: string | null): Partial<EventMetadata> {
  if (!metadata.instanceId || !isMultitenancyEnabled()) return metadata;
  if (rowTenantId && resolveInstanceOwnerTenantId(metadata.instanceId) === rowTenantId) return metadata;
  const { instanceId: _foreign, ...confined } = metadata;
  return confined;
}

/**
 * The original event of a row filed by `create`, or null for a row whose
 * payload is not that row's own envelope (schema refusals store the refused
 * payload itself).
 */
function storedEnvelope(
  entry: { eventId: string; eventType: string; error: string },
  stored: Record<string, unknown>,
): { payload: Record<string, unknown>; metadata: Partial<EventMetadata> } | null {
  if (isGovernanceRefusal(entry.error)) return null;
  const parsed = StoredEnvelopeSchema.safeParse(stored);
  if (!parsed.success || parsed.data.id !== entry.eventId || parsed.data.type !== entry.eventType) return null;
  const metadata = Object.fromEntries(
    Object.entries(parsed.data.metadata).filter(([, value]) => value !== undefined),
  ) as Partial<EventMetadata>;
  return { payload: parsed.data.payload, metadata };
}

/**
 * Filter options for listing dead letters
 */
export interface ListDeadLettersOptions {
  status?: DeadLetterStatus[];
  eventType?: string[];
  since?: Date;
  until?: Date;
  limit?: number;
  cursor?: string;
}

/**
 * Result for manual retry operation
 */
export interface RetryResult {
  success: boolean;
  deadLetterId: string;
  error?: string;
}

/**
 * Dead Letter Service class
 */
export class DeadLetterService {
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

  private warnedNoBus = false;
  private authPlaneDb: Database | null = null;

  setAuthPlane(authPlaneDb: Database): void {
    this.authPlaneDb = authPlaneDb;
  }

  /** Request work never fans out; periodic work discovers owners on the auth plane. */
  private async workTenants(): Promise<Array<string | null>> {
    const caller = currentTenantScope()?.tenantId;
    if (caller || !isMultitenancyEnabled()) return [caller ?? null];
    const tenants = await enumerateActiveWorkTenants(this.authPlaneDb ?? this.pool);
    return resolveEnforcementMode() === 'enforced' ? tenants : [...tenants, null];
  }

  private workDb<T>(tenantId: string | null, work: () => Promise<T>): Promise<T> {
    // Reuse an active request transaction; worker DB blocks commit before publish.
    if (currentTenantScope()?.tenantId === tenantId) return work();
    return runTenantWorkDb(this.pool, tenantId, work);
  }

  private workPredicate(tenantId: string | null) {
    return tenantId
      ? eq(deadLetterEvents.tenantId, tenantId)
      : isMultitenancyEnabled()
        ? isNull(deadLetterEvents.tenantId)
        : undefined;
  }

  constructor(
    private readonly pool: Database,
    private eventBus: (EventBus & ConnectorEventPublisher) | null,
  ) {}

  /**
   * List dead letters with filtering
   */
  async list(options: ListDeadLettersOptions = {}): Promise<{
    items: DeadLetterEntry[];
    hasMore: boolean;
    cursor?: string;
    total?: number;
  }> {
    const { status, eventType, since, until, limit = 50, cursor } = options;

    const conditions = [];

    if (status?.length) {
      conditions.push(inArray(deadLetterEvents.status, status));
    }

    if (eventType?.length) {
      conditions.push(inArray(deadLetterEvents.eventType, eventType));
    }

    if (since) {
      conditions.push(gte(deadLetterEvents.createdAt, since));
    }

    if (until) {
      conditions.push(lte(deadLetterEvents.createdAt, until));
    }

    if (cursor) {
      conditions.push(sql`${deadLetterEvents.createdAt} < ${cursor}`);
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const items = await this.db
      .select()
      .from(deadLetterEvents)
      .where(whereClause)
      .orderBy(desc(deadLetterEvents.createdAt))
      .limit(limit + 1);

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop();
    }

    const lastItem = items[items.length - 1];
    return {
      items: items as DeadLetterEntry[],
      hasMore,
      cursor: lastItem?.createdAt.toISOString(),
    };
  }

  /**
   * Get a single dead letter by ID
   */
  async getById(id: string): Promise<DeadLetterEntry> {
    const [result] = await this.db.select().from(deadLetterEvents).where(eq(deadLetterEvents.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('DeadLetterEvent', id);
    }

    return result as DeadLetterEntry;
  }

  /**
   * Create a new dead letter entry
   */
  async create(options: {
    event: Parameters<typeof prepareDeadLetterInsert>[0]['event'];
    subject: string;
    error: Error;
    retryCount: number;
    /**
     * `false` files a manual-resolution-only entry (no auto-retry schedule).
     * Used for entries where republishing the event would be wrong — e.g. a
     * connector stall marker (#961), whose event is emitted-once by contract.
     */
    autoRetry?: boolean;
  }): Promise<DeadLetterEntry> {
    const insertData = prepareDeadLetterInsert(options);
    if (options.autoRetry === false) {
      insertData.nextAutoRetryAt = null;
    }

    const [result] = await this.db.insert(deadLetterEvents).values(insertData).returning();

    if (!result) {
      throw new Error('Failed to create dead letter entry');
    }

    log.info('Dead letter created', {
      deadLetterId: result.id,
      eventId: result.eventId,
      eventType: result.eventType,
      nextAutoRetryAt: result.nextAutoRetryAt?.toISOString(),
    });

    await this.publishSystemEvent(result as DeadLetterEntry);

    return result as DeadLetterEntry;
  }

  /**
   * Dead-letter a payload refused by an emission/ingress governance gate.
   * The refused event never entered the journal — this row IS its only
   * record, with `error` starting with the refusing reason token:
   * `schema_validation_failed` (issue #959, the default), the strict gate's
   * `schema_not_registered` (issue #1000), or the publish-allowlist gate's
   * `publish_not_declared` (RFC #925 G4c, issue #987).
   *
   * `nextAutoRetryAt` stays null: retrying an unchanged refused payload can
   * never succeed, so these rows are manual-intervention only.
   */
  async createSchemaValidationFailure(input: {
    eventType: string;
    subject: string;
    payload: Record<string, unknown>;
    errors: string[];
    /**
     * DLQ reason token prefixing `error`; defaults to
     * `schema_validation_failed` (`SCHEMA_NOT_REGISTERED` and
     * `PUBLISH_NOT_DECLARED` are the caller-supplied siblings).
     */
    reason?: string;
  }): Promise<DeadLetterEntry> {
    const [result] = await this.db
      .insert(deadLetterEvents)
      .values({
        // Refusals have no journaled source event; generate their identity here.
        eventId: generateId(),
        eventType: input.eventType,
        subject: input.subject,
        payload: input.payload,
        error: `${input.reason ?? SCHEMA_VALIDATION_FAILED}: ${input.errors.join('; ')}`,
        stack: null,
        autoRetryCount: 0,
        nextAutoRetryAt: null,
        status: 'pending',
      })
      .returning();

    if (!result) {
      throw new Error('Failed to create dead letter entry');
    }

    log.warn('Payload refused by schema registry, dead-lettered', {
      deadLetterId: result.id,
      eventId: result.eventId,
      eventType: result.eventType,
    });

    await this.publishSystemEvent(result as DeadLetterEntry);

    return result as DeadLetterEntry;
  }

  /** Announce a new DLQ row on the bus; failures are logged, never thrown. */
  private async publishSystemEvent(result: DeadLetterEntry): Promise<void> {
    if (!this.eventBus) {
      if (!this.warnedNoBus) {
        this.warnedNoBus = true;
        log.warn('No event bus: dead letter announcements disabled — no system.dead_letter will be published', {
          deadLetterId: result.id,
        });
      }
      return;
    }
    try {
      const systemPayload = createDeadLetterSystemPayload(result.id, result);
      await this.eventBus.publishGeneric(
        'system.dead_letter',
        { ...systemPayload },
        {
          source: 'dead-letter-service',
          ...(result.tenantId ? { tenantId: result.tenantId } : {}),
        },
      );
    } catch (err) {
      log.error('Failed to publish dead letter system event', { error: String(err) });
    }
  }

  private async republish(
    entry: { id: string; eventId: string; eventType: string; error: string; tenantId?: string | null },
    payload: Record<string, unknown>,
    source: string,
  ): Promise<void> {
    if (!this.eventBus) throw new Error('Event bus not available');
    if (isGovernanceRefusal(entry.error)) {
      // Refusal rows have no trusted emitter identity: schema validity cannot
      // establish permission to publish a type the original agent did not declare.
      if (entry.error.startsWith(`${PUBLISH_NOT_DECLARED}:`)) {
        throw new Error('Publish declaration refusals must be re-emitted through the original source');
      }
      // Use the current, uncached registry row in its tenant work scope. Normal
      // lax ingress allows unknown types, but recovery of a refusal requires an
      // enabled schema and a valid payload. Do not file another refusal row.
      const verdict = await this.workDb(entry.tenantId ?? null, () =>
        new EventSchemaService(this.pool).validatePayload(entry.eventType, payload),
      );
      if (!verdict.enabled || !verdict.valid) {
        throw new Error(
          `Schema refusal remains pending: ${verdict.enabled ? verdict.errors.join('; ') : 'schema disabled'}`,
        );
      }
    }
    if (isConnectorEventType(entry.eventType)) {
      const connectorType = entry.eventType;
      const restored = await runTenantWorkDb(this.pool, entry.tenantId ?? null, () =>
        restoreConnectorEvent(this.db, entry.eventId, connectorType, entry.tenantId ?? null),
      );
      await this.eventBus.publishConnector(entry.eventType, restored.payload, { ...restored.metadata, source });
    } else {
      const original = storedEnvelope(entry, payload);
      await this.eventBus.publishGeneric(entry.eventType as EventType, original?.payload ?? payload, {
        ...(original ? confineToRowTenant(original.metadata, entry.tenantId ?? null) : {}),
        source,
        // Every generic retry publishes OmniEvent.id = this dead-letter row ID,
        // stable across attempts for consumer-side idempotency. Do not reuse
        // entry.eventId: it may already have a retained failed-handler claim.
        publishEventId: entry.id,
        ...(entry.tenantId ? { tenantId: entry.tenantId } : {}),
      });
    }
  }

  /**
   * Manually retry a dead letter
   */
  async retry(id: string): Promise<RetryResult> {
    const current = await this.getById(id);

    if (current.status === 'resolved') {
      return { success: false, deadLetterId: id, error: 'Dead letter already resolved' };
    }

    if (current.status === 'retrying') {
      return { success: false, deadLetterId: id, error: 'Dead letter already retrying' };
    }

    // A status read is not ownership: only the pending-to-retrying claim wins.
    const [deadLetter] = await this.db
      .update(deadLetterEvents)
      .set({
        status: 'retrying',
        lastRetryAt: new Date(),
      })
      .where(and(eq(deadLetterEvents.id, id), eq(deadLetterEvents.status, 'pending')))
      .returning();

    if (!deadLetter) {
      return { success: false, deadLetterId: id, error: 'Dead letter is no longer pending' };
    }

    try {
      await this.republish(deadLetter, deadLetter.payload, DEAD_LETTER_RETRY_SOURCES[0]);
    } catch (err) {
      const [updated] = await this.db
        .update(deadLetterEvents)
        .set({
          status: 'pending',
          error: `${deadLetter.error}\n[Manual-retry]: ${String(err)}`,
          manualRetryCount: deadLetter.manualRetryCount + 1,
          nextAutoRetryAt:
            isGovernanceRefusal(deadLetter.error) || err instanceof ConnectorProvenanceError
              ? null
              : calculateNextAutoRetryAt(deadLetter.autoRetryCount),
        })
        .where(this.retryClaimPredicate(deadLetter))
        .returning({ id: deadLetterEvents.id });

      log.error('Dead letter manual retry failed', { deadLetterId: id, error: String(err) });
      return {
        success: false,
        deadLetterId: id,
        error: updated ? String(err) : 'Dead letter retry lease is no longer owned',
      };
    }

    // A successful publish must never enter the publish-failure reset above.
    // Keep its lease if bookkeeping fails; expiry handles an uncertain result.
    try {
      const resolved = await this.resolveRetry(deadLetter, 'manual-retry', new Date(), deadLetter.manualRetryCount + 1);
      if (!resolved) return { success: false, deadLetterId: id, error: 'Dead letter retry lease is no longer owned' };
      log.info('Dead letter manually retried successfully', { deadLetterId: id });
      return { success: true, deadLetterId: id };
    } catch (err) {
      log.error('Published retry could not be marked resolved; keeping retry lease', {
        deadLetterId: id,
        error: String(err),
      });
      return { success: false, deadLetterId: id, error: 'Event published but retry finalization failed' };
    }
  }

  private retryClaimPredicate(claim: RetryClaim) {
    return and(
      eq(deadLetterEvents.id, claim.id),
      eq(deadLetterEvents.status, 'retrying'),
      // Fence an expired claimant from a later retry of the same row (ABA).
      claim.lastRetryAt ? eq(deadLetterEvents.lastRetryAt, claim.lastRetryAt) : isNull(deadLetterEvents.lastRetryAt),
    );
  }

  private async resolveRetry(
    claim: RetryClaim,
    resolvedBy: string,
    now: Date,
    manualRetryCount?: number,
  ): Promise<boolean> {
    // A request may own the claim in its outer tenant transaction. Isolate a
    // failed final write so catching it does not roll the outer claim back
    // to pending. Workers likewise keep their separately committed claim.
    const [updated] = await this.db.transaction((tx) =>
      tx
        .update(deadLetterEvents)
        .set({
          status: 'resolved',
          resolvedAt: now,
          resolvedBy,
          ...(manualRetryCount !== undefined ? { manualRetryCount } : {}),
        })
        .where(this.retryClaimPredicate(claim))
        .returning({ id: deadLetterEvents.id }),
    );
    return !!updated;
  }

  /**
   * Mark a dead letter as resolved with a note
   */
  async resolve(id: string, note: string): Promise<DeadLetterEntry> {
    const deadLetter = await this.getById(id);

    if (deadLetter.status === 'resolved') {
      throw new Error('Dead letter already resolved');
    }

    const [updated] = await this.db
      .update(deadLetterEvents)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: note,
        nextAutoRetryAt: null,
      })
      .where(eq(deadLetterEvents.id, id))
      .returning();

    log.info('Dead letter resolved', { deadLetterId: id, note });
    return updated as DeadLetterEntry;
  }

  /**
   * Abandon a dead letter (stop auto-retrying)
   */
  async abandon(id: string): Promise<DeadLetterEntry> {
    const deadLetter = await this.getById(id);

    if (deadLetter.status === 'resolved') {
      throw new Error('Cannot abandon resolved dead letter');
    }

    if (deadLetter.status === 'abandoned') {
      throw new Error('Dead letter already abandoned');
    }

    const [updated] = await this.db
      .update(deadLetterEvents)
      .set({
        status: 'abandoned',
        nextAutoRetryAt: null,
      })
      .where(eq(deadLetterEvents.id, id))
      .returning();

    log.info('Dead letter abandoned', { deadLetterId: id });
    return updated as DeadLetterEntry;
  }

  /**
   * Process due auto-retries
   * Called by scheduler every 15 minutes
   */
  async processAutoRetries(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const now = new Date();
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const tenantId of await this.workTenants()) {
      await this.recoverExpiredRetries(tenantId, now);
      const dueForRetry = await this.workDb(tenantId, () =>
        this.db
          .select()
          .from(deadLetterEvents)
          .where(
            and(
              eq(deadLetterEvents.status, 'pending'),
              lte(deadLetterEvents.nextAutoRetryAt, now),
              this.workPredicate(tenantId),
            ),
          )
          .limit(100),
      );

      for (const candidate of dueForRetry) {
        const [deadLetter] = await this.workDb(tenantId, () =>
          this.db
            .update(deadLetterEvents)
            .set({ status: 'retrying', lastRetryAt: now })
            .where(
              and(
                eq(deadLetterEvents.id, candidate.id),
                eq(deadLetterEvents.status, 'pending'),
                lte(deadLetterEvents.nextAutoRetryAt, now),
                this.workPredicate(tenantId),
              ),
            )
            .returning(),
        );
        if (!deadLetter) continue;
        processed++;

        try {
          await this.republish(deadLetter, deadLetter.payload, DEAD_LETTER_RETRY_SOURCES[1]);
        } catch (err) {
          failed += await this.workDb(tenantId, () => this.recordAutoRetryFailure(deadLetter, err, now));
          continue;
        }

        try {
          const resolved = await this.workDb(tenantId, () =>
            this.resolveRetry(deadLetter, `auto-retry-${deadLetter.autoRetryCount + 1}`, now),
          );
          if (resolved) {
            succeeded++;
            log.info('Auto-retry succeeded', { deadLetterId: deadLetter.id });
          }
        } catch (err) {
          failed++;
          log.error('Published retry could not be marked resolved; keeping retry lease', {
            deadLetterId: deadLetter.id,
            error: String(err),
          });
        }
      }
    }

    if (processed > 0) {
      log.info('Auto-retry batch completed', { processed, succeeded, failed });
    }

    return { processed, succeeded, failed };
  }

  private async recordAutoRetryFailure(
    deadLetter: RetryClaim & { autoRetryCount: number; error: string },
    error: unknown,
    now: Date,
  ): Promise<0 | 1> {
    const manualOnly = isGovernanceRefusal(deadLetter.error) || error instanceof ConnectorProvenanceError;
    const retryCount = deadLetter.autoRetryCount + (manualOnly ? 0 : 1);
    const nextRetry = manualOnly ? null : calculateNextAutoRetryAt(retryCount, now);
    const [updated] = await this.db
      .update(deadLetterEvents)
      .set({
        status: 'pending',
        autoRetryCount: retryCount,
        nextAutoRetryAt: nextRetry,
        error: `${deadLetter.error}\n[Auto-retry ${manualOnly ? 'skipped' : retryCount}]: ${String(error)}`,
      })
      .where(this.retryClaimPredicate(deadLetter))
      .returning({ id: deadLetterEvents.id });
    if (!updated) return 0;
    log.warn(manualOnly ? 'Auto-retry skipped' : 'Auto-retry failed', {
      deadLetterId: deadLetter.id,
      retryCount,
      nextRetryAt: nextRetry?.toISOString() ?? 'manual-only',
    });
    return manualOnly ? 0 : 1;
  }

  private async recoverExpiredRetries(tenantId: string | null, now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - RETRY_LEASE_MS);
    const expired = await this.workDb(tenantId, () =>
      this.db
        .select()
        .from(deadLetterEvents)
        .where(
          and(
            eq(deadLetterEvents.status, 'retrying'),
            lt(deadLetterEvents.lastRetryAt, cutoff),
            this.workPredicate(tenantId),
          ),
        )
        .limit(100),
    );
    for (const claim of expired) {
      // Claim kind is not persisted. Charge any interrupted attempt to the
      // bounded auto-retry budget, including interrupted manual retries.
      // Existing manual-only rows must never gain an automatic schedule.
      const retryCount = claim.autoRetryCount + 1;
      const nextRetry =
        claim.nextAutoRetryAt && !isGovernanceRefusal(claim.error) ? calculateNextAutoRetryAt(retryCount, now) : null;
      const [updated] = await this.workDb(tenantId, () =>
        this.db
          .update(deadLetterEvents)
          .set({
            status: 'pending',
            autoRetryCount: retryCount,
            nextAutoRetryAt: nextRetry,
            error: `${claim.error}\n[Retry lease expired]: interrupted attempt counted`,
          })
          .where(and(this.retryClaimPredicate(claim), this.workPredicate(tenantId)))
          .returning({ id: deadLetterEvents.id }),
      );
      if (updated) log.warn('Expired dead letter retry recovered', { deadLetterId: claim.id, retryCount });
    }
  }

  /**
   * Get count of pending dead letters (for metrics)
   */
  async getPendingCount(): Promise<number> {
    let pending = 0;
    for (const tenantId of await this.workTenants()) {
      pending += await this.workDb(tenantId, async () => {
        const [result] = await this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(deadLetterEvents)
          .where(and(eq(deadLetterEvents.status, 'pending'), this.workPredicate(tenantId)));
        return result?.count ?? 0;
      });
    }
    return pending;
  }

  /** Pending depth and oldest pending row, for the /health DLQ check (#1163). */
  async getPendingSummary(): Promise<{ pending: number; oldestPendingAt: Date | null }> {
    const [result] = await this.db
      .select({
        pending: sql<number>`count(*)::int`,
        oldest: sql<string | null>`min(${deadLetterEvents.createdAt})`,
      })
      .from(deadLetterEvents)
      .where(eq(deadLetterEvents.status, 'pending'));

    return { pending: result?.pending ?? 0, oldestPendingAt: result?.oldest ? new Date(result.oldest) : null };
  }

  /**
   * Get dead letter statistics
   */
  async getStats(): Promise<{
    total: number;
    pending: number;
    resolved: number;
    abandoned: number;
    byEventType: Record<string, number>;
  }> {
    const [totals] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${deadLetterEvents.status} = 'pending')::int`,
        resolved: sql<number>`count(*) filter (where ${deadLetterEvents.status} = 'resolved')::int`,
        abandoned: sql<number>`count(*) filter (where ${deadLetterEvents.status} = 'abandoned')::int`,
      })
      .from(deadLetterEvents);

    const byType = await this.db
      .select({
        eventType: deadLetterEvents.eventType,
        count: sql<number>`count(*)::int`,
      })
      .from(deadLetterEvents)
      .groupBy(deadLetterEvents.eventType);

    return {
      total: totals?.total ?? 0,
      pending: totals?.pending ?? 0,
      resolved: totals?.resolved ?? 0,
      abandoned: totals?.abandoned ?? 0,
      byEventType: Object.fromEntries(byType.map((r) => [r.eventType, r.count])),
    };
  }

  /**
   * Cleanup old dead letters (30-day retention)
   */
  async cleanupExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await this.db
      .delete(deadLetterEvents)
      .where(
        and(
          lte(deadLetterEvents.createdAt, cutoff),
          or(eq(deadLetterEvents.status, 'resolved'), eq(deadLetterEvents.status, 'abandoned')),
        ),
      )
      .returning({ id: deadLetterEvents.id });

    if (result.length > 0) {
      log.info('Cleaned up expired dead letters', { count: result.length });
    }

    return result.length;
  }
}
