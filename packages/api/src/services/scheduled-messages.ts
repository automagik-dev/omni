/**
 * Scheduled outbound messages — service + sweeper (#889).
 *
 * Two delivery modes, picked from the channel's `canScheduleMessage`
 * capability:
 *
 *   platform — the channel schedules natively (Slack chat.scheduleMessage).
 *              We hand the timer to the platform and only keep a record, so
 *              delivery survives omni being down.
 *   local    — omni holds the message and the sweeper sends it at send_at.
 *
 * We keep a row in BOTH modes on purpose. Slack's chat.scheduledMessages.list
 * only returns what the SAME token scheduled, so the platform can never be our
 * source of truth for "what is pending".
 *
 * Concurrency is the DB's job: the sweeper CLAIMS due rows by locking them
 * (`FOR UPDATE SKIP LOCKED`) and flipping `pending → sending` inside the SAME
 * transaction. Because the claim commits before delivery, a concurrent sweep
 * in another process (prod runs replicaCount:2 with no leader election) can no
 * longer re-select a row that is already being sent. A crash-stranded
 * `sending` row is reclaimed after a lease window so at-least-once holds.
 */

import type { ChannelPlugin, OutgoingMessage } from '@omni/channel-sdk';
import { ERROR_CODES, type Logger, OmniError, createLogger } from '@omni/core';
import type { Database, ScheduledMessage, ScheduledMessageDeliveryMode } from '@omni/db';
import { instances, resolveEnforcementMode, scheduledMessages } from '@omni/db';
import { type SQL, and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { isMultitenancyEnabled } from '../tenancy/feature-flag';
import { enumerateActiveWorkTenants } from '../tenancy/periodic-tenant-work';

/** How many due rows a single tick will attempt. Keeps a backlog from stalling the loop. */
const MAX_PER_TICK = 50;

/** Give up after this many failed delivery attempts. */
const MAX_ATTEMPTS = 3;

/**
 * How long a CLAIMED (`status='sending'`) row may sit before a sweep is allowed
 * to reclaim it. Covers the one case the claim cannot: a process that crashes
 * between claiming a row and finalizing it would otherwise strand the message
 * in `sending` forever. Comfortably larger than any single send so a healthy
 * in-flight delivery is never reclaimed under it.
 */
const CLAIM_LEASE_MS = 5 * 60_000;

export interface ScheduleMessageInput {
  instanceId: string;
  /** Platform chat id (not chats.id — the conversation may be unknown to us). */
  chatExternalId: string;
  content: Record<string, unknown>;
  sendAt: Date;
  threadExternalId?: string;
  /** Slack reply_broadcast: post in the thread AND surface it in the channel. */
  isThreadBroadcast?: boolean;
  createdByAgentId?: string;
}

export interface SweepStats {
  scanned: number;
  sent: number;
  failed: number;
}

/** Which rows a sweep pass may touch (ADR-0008). */
type SweepWorld = { kind: 'all' } | { kind: 'tenant'; tenantId: string } | { kind: 'legacy-rows' };

function accumulate(total: SweepStats, pass: SweepStats): void {
  total.scanned += pass.scanned;
  total.sent += pass.sent;
  total.failed += pass.failed;
}

/** Resolves the plugin for an instance. Injected so tests need no registry. */
export type PluginResolver = (instanceId: string) => Promise<ChannelPlugin | null>;

/**
 * Narrow a JSONB blob back into OutgoingContent.
 *
 * The column is jsonb, so by the time a row is read back the shape is only a
 * promise. A row written by an older build — or hand-edited — would otherwise
 * reach plugin.sendMessage() malformed and fail deep inside the channel with
 * an opaque error. Checking the discriminant here fails it where the context
 * still exists.
 */
function parseOutgoingContent(raw: unknown, scheduledMessageId: string): OutgoingMessage['content'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw callerError(`Scheduled message ${scheduledMessageId} has non-object content`);
  }
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== 'string' || type.length === 0) {
    throw callerError(`Scheduled message ${scheduledMessageId} has content without a 'type' discriminant`);
  }
  return raw as OutgoingMessage['content'];
}

/**
 * A mistake in the caller's request (bad date, over-limit lead time, malformed
 * content) — a 400, not a server fault. Typed so the route can tell it apart
 * from a genuine fault (plugin/network/DB), which must surface as a 5xx.
 */
function callerError(message: string): OmniError {
  return new OmniError({ code: ERROR_CODES.VALIDATION, message, recoverable: false });
}

export class ScheduledMessageService {
  private readonly logger: Logger;
  /** Auth-plane read connection — the one identity allowed to read `tenants`. */
  private authPlaneDb?: Database;
  private warnedMissingAuthPlane = false;

  constructor(
    private readonly db: Database,
    private readonly resolvePlugin: PluginResolver,
    logger?: Logger,
  ) {
    this.logger = logger ?? createLogger('services:scheduled-messages');
  }

  /**
   * Schedule a message.
   *
   * When the channel schedules natively we delegate immediately and store the
   * returned handle. If that call fails we do NOT silently fall back to local
   * mode — a channel that advertises native scheduling and then rejects the
   * request is a real error the caller must see.
   */
  async schedule(input: ScheduleMessageInput): Promise<ScheduledMessage> {
    if (input.sendAt.getTime() <= Date.now()) {
      throw callerError(`sendAt must be in the future (got ${input.sendAt.toISOString()})`);
    }

    // Validate up front for BOTH modes. In local mode nothing would touch this
    // payload until the sweeper fires, so a malformed content would surface as
    // a delivery failure days later instead of a rejected request now.
    parseOutgoingContent(input.content, '(new)');

    const plugin = await this.resolvePlugin(input.instanceId);
    if (!plugin) {
      throw new Error(`No channel plugin for instance ${input.instanceId}`);
    }

    const native = plugin.capabilities.canScheduleMessage === true && typeof plugin.scheduleMessage === 'function';
    const deliveryMode: ScheduledMessageDeliveryMode = native ? 'platform' : 'local';

    const maxAhead = plugin.capabilities.maxScheduleAheadMs;
    if (native && typeof maxAhead === 'number' && input.sendAt.getTime() - Date.now() > maxAhead) {
      throw callerError(
        `sendAt exceeds what ${plugin.id} accepts natively (${Math.round(maxAhead / 86_400_000)} days ahead).`,
      );
    }

    let externalScheduledId: string | undefined;
    if (native) {
      externalScheduledId = await plugin.scheduleMessage?.(
        input.instanceId,
        this.toOutgoingMessage(input),
        input.sendAt,
      );
    }

    // The native schedule already put a message on the platform's timer. If the
    // row insert now fails we must UNDO it — a platform message with no row to
    // hold its externalScheduledId is uncancelable, and a retry double-schedules.
    try {
      const [row] = await this.db
        .insert(scheduledMessages)
        .values({
          instanceId: input.instanceId,
          chatExternalId: input.chatExternalId,
          threadExternalId: input.threadExternalId,
          isThreadBroadcast: input.isThreadBroadcast ?? false,
          content: input.content,
          sendAt: input.sendAt,
          deliveryMode,
          status: 'pending',
          externalScheduledId,
          createdByAgentId: input.createdByAgentId,
        })
        .returning();

      if (!row) throw new Error('Failed to persist scheduled message');
      return row;
    } catch (error) {
      if (native && externalScheduledId) {
        try {
          await plugin.cancelScheduledMessage?.(input.instanceId, input.chatExternalId, externalScheduledId);
        } catch (cancelError) {
          this.logger.warn('Failed to roll back native schedule after a row-insert failure', {
            instanceId: input.instanceId,
            externalScheduledId,
            error: cancelError instanceof Error ? cancelError.message : String(cancelError),
          });
        }
      }
      throw error;
    }
  }

  /**
   * Cancel a pending scheduled message.
   *
   * In platform mode we ask the channel to drop it first. If the platform says
   * it is already gone we still mark the row canceled — the outcome the caller
   * asked for has been achieved either way.
   */
  async cancel(id: string): Promise<ScheduledMessage | null> {
    const row = await this.getById(id);
    if (!row) return null;
    if (row.status !== 'pending') return row;

    if (row.deliveryMode === 'platform' && row.externalScheduledId) {
      const plugin = await this.resolvePlugin(row.instanceId);
      try {
        await plugin?.cancelScheduledMessage?.(row.instanceId, row.chatExternalId, row.externalScheduledId);
      } catch (error) {
        this.logger.warn('Platform refused the cancel; marking canceled locally anyway', {
          scheduledMessageId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const [updated] = await this.db
      .update(scheduledMessages)
      .set({ status: 'canceled', canceledAt: new Date(), updatedAt: new Date() })
      .where(and(eq(scheduledMessages.id, id), eq(scheduledMessages.status, 'pending')))
      .returning();

    return updated ?? row;
  }

  async getById(id: string): Promise<ScheduledMessage | null> {
    const [row] = await this.db.select().from(scheduledMessages).where(eq(scheduledMessages.id, id)).limit(1);
    return row ?? null;
  }

  /** Pending messages for an instance, soonest first. */
  async listPending(instanceId: string, limit = 100): Promise<ScheduledMessage[]> {
    return this.db
      .select()
      .from(scheduledMessages)
      .where(and(eq(scheduledMessages.instanceId, instanceId), eq(scheduledMessages.status, 'pending')))
      .orderBy(asc(scheduledMessages.sendAt))
      .limit(limit);
  }

  /**
   * Inject the auth-plane read connection used to enumerate active tenants.
   * Wired after construction, mirroring FollowUpSweeperService (ADR-0008).
   */
  setAuthPlane(db: Database): void {
    this.authPlaneDb = db;
  }

  /**
   * Send local-mode messages whose time has come.
   *
   * Platform-mode rows are skipped: the channel owns their timer. They are
   * reconciled to 'sent' separately, not here — firing them again would
   * double-post.
   *
   * A cron has no envelope and no credential, so under multitenancy it must
   * ENUMERATE whose work exists rather than scan the table globally — the
   * global scan is not even expressible under RLS enforcement. Flag-off keeps
   * the single ambient pass; flag-on runs one scoped pass per ACTIVE tenant,
   * so a suspended tenant stops having messages delivered at the next tick,
   * plus a transitional NULL-tenant pass that is skipped under enforcement.
   * Same shape as follow-up-sweeper (#404, ADR-0008).
   */
  async sweep(): Promise<SweepStats> {
    if (!isMultitenancyEnabled()) {
      return this.sweepWorld({ kind: 'all' });
    }

    const totals: SweepStats = { scanned: 0, sent: 0, failed: 0 };

    if (this.authPlaneDb) {
      for (const tenantId of await enumerateActiveWorkTenants(this.authPlaneDb)) {
        try {
          accumulate(totals, await this.sweepWorld({ kind: 'tenant', tenantId }));
        } catch (error) {
          // One tenant's failure must not starve a sibling's queue.
          this.logger.warn('scheduled-message sweeper: tenant pass failed', {
            tenantId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } else if (!this.warnedMissingAuthPlane) {
      this.warnedMissingAuthPlane = true;
      this.logger.warn(
        'scheduled-message sweeper: multitenancy is enabled but no auth-plane connection was injected — tenant rows will not be swept',
      );
    }

    if (resolveEnforcementMode(process.env) !== 'enforced') {
      accumulate(totals, await this.sweepWorld({ kind: 'legacy-rows' }));
    }

    return totals;
  }

  /**
   * Restrict a sweep to one tenant's rows, the legacy untenanted rows, or all.
   *
   * There is no tenant_id column here by design — tenancy derives via
   * instance_id (the whatsapp_flow_keys precedent) — so the predicate reaches
   * through the owning instance instead. `EXISTS` rather than a join keeps the
   * row shape and the `FOR UPDATE` target as `scheduled_messages` alone;
   * `FOR UPDATE` cannot be applied across a join here.
   */
  private worldPredicate(world: SweepWorld): SQL[] {
    if (world.kind === 'tenant') {
      return [
        sql`EXISTS (SELECT 1 FROM ${instances} WHERE ${instances.id} = ${scheduledMessages.instanceId} AND ${instances.tenantId} = ${world.tenantId})`,
      ];
    }
    if (world.kind === 'legacy-rows') {
      return [
        sql`EXISTS (SELECT 1 FROM ${instances} WHERE ${instances.id} = ${scheduledMessages.instanceId} AND ${instances.tenantId} IS NULL)`,
      ];
    }
    return [];
  }

  /** One sweep pass over a single world. */
  private async sweepWorld(world: SweepWorld): Promise<SweepStats> {
    const stats: SweepStats = { scanned: 0, sent: 0, failed: 0 };
    const now = new Date();
    const claimCutoff = new Date(now.getTime() - CLAIM_LEASE_MS);

    // CLAIM due rows atomically. We lock them with `FOR UPDATE SKIP LOCKED` and,
    // in the SAME transaction, flip `pending → sending`. The transaction commits
    // with the rows already marked `sending`, so a concurrent sweep — whose
    // predicate matches only `pending` rows (plus `sending` rows abandoned past
    // the lease) — cannot re-select and re-deliver a row we are mid-sending.
    // This is what makes delivery safe across processes; the single-process
    // overlap is already prevented by the scheduler's `protect:true` guard.
    const due = await this.db.transaction(async (tx) => {
      const locked = await tx
        .select({ id: scheduledMessages.id })
        .from(scheduledMessages)
        .where(
          and(
            eq(scheduledMessages.deliveryMode, 'local'),
            lte(scheduledMessages.sendAt, now),
            or(
              eq(scheduledMessages.status, 'pending'),
              // Reclaim a row a crashed sweep left stranded in `sending`.
              and(eq(scheduledMessages.status, 'sending'), lte(scheduledMessages.updatedAt, claimCutoff)),
            ),
            ...this.worldPredicate(world),
          ),
        )
        .orderBy(asc(scheduledMessages.sendAt))
        .limit(MAX_PER_TICK)
        .for('update', { skipLocked: true });

      if (locked.length === 0) return [];

      return tx
        .update(scheduledMessages)
        .set({ status: 'sending', updatedAt: now })
        .where(
          inArray(
            scheduledMessages.id,
            locked.map((r) => r.id),
          ),
        )
        .returning();
    });

    stats.scanned = due.length;

    for (const row of due) {
      try {
        const plugin = await this.resolvePlugin(row.instanceId);
        if (!plugin) throw new Error(`No channel plugin for instance ${row.instanceId}`);

        const result = await plugin.sendMessage(row.instanceId, {
          to: row.chatExternalId,
          threadId: row.threadExternalId ?? undefined,
          content: parseOutgoingContent(row.content, row.id),
          metadata: { isThreadBroadcast: row.isThreadBroadcast },
        });

        if (!result.success) {
          throw new Error(result.error ?? 'sendMessage reported failure without an error');
        }

        // Finalize only while WE still hold the claim (`status = 'sending'`). If
        // a lease reclaim handed the row to another sweep, this update no-ops
        // rather than clobbering the new owner's state.
        await this.db
          .update(scheduledMessages)
          .set({
            status: 'sent',
            sentAt: new Date(),
            sentExternalId: result.messageId,
            attemptCount: row.attemptCount + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(scheduledMessages.id, row.id), eq(scheduledMessages.status, 'sending')));

        stats.sent++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const attempts = row.attemptCount + 1;
        // Only give up once we're out of attempts — a transient outage should
        // not discard a message the user asked us to send. Releasing the claim
        // back to `pending` re-arms the row for the next tick.
        const exhausted = attempts >= MAX_ATTEMPTS;

        await this.db
          .update(scheduledMessages)
          .set({
            status: exhausted ? 'failed' : 'pending',
            failedAt: exhausted ? new Date() : null,
            lastError: message,
            attemptCount: attempts,
            updatedAt: new Date(),
          })
          .where(and(eq(scheduledMessages.id, row.id), eq(scheduledMessages.status, 'sending')));

        stats.failed++;
        this.logger.warn('Scheduled message delivery failed', {
          scheduledMessageId: row.id,
          attempts,
          exhausted,
          error: message,
        });
      }
    }

    return stats;
  }

  /** Drop rows for instances that no longer exist, and old terminal rows. */
  async pruneTerminal(olderThan: Date): Promise<number> {
    const result = await this.db
      .delete(scheduledMessages)
      .where(
        and(
          sql`${scheduledMessages.status} IN ('sent', 'canceled', 'failed')`,
          lte(scheduledMessages.updatedAt, olderThan),
        ),
      )
      .returning({ id: scheduledMessages.id });
    return result.length;
  }

  private toOutgoingMessage(input: ScheduleMessageInput): OutgoingMessage {
    return {
      to: input.chatExternalId,
      threadId: input.threadExternalId,
      // Validated before we hand it to the platform, so a malformed payload
      // fails at schedule time rather than silently days later.
      content: parseOutgoingContent(input.content, '(new)'),
      metadata: { isThreadBroadcast: input.isThreadBroadcast ?? false },
    };
  }
}

/** Convenience resolver bound to the instances table + a plugin registry lookup. */
export function createPluginResolver(
  db: Database,
  getPlugin: (channel: string) => ChannelPlugin | undefined,
): PluginResolver {
  return async (instanceId: string) => {
    const [row] = await db
      .select({ channel: instances.channel })
      .from(instances)
      .where(eq(instances.id, instanceId))
      .limit(1);
    if (!row) return null;
    return getPlugin(row.channel) ?? null;
  };
}
