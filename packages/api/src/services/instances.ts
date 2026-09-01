/**
 * Instance service - manages channel instance configurations
 *
 * TENANT-BOUND SEALING OF CHANNEL CREDENTIALS (G5 deliverable (g); ADR-0008)
 * --------------------------------------------------------------------------
 * An instance row carries the bot tokens and signing secrets for its channel —
 * ADR-0008's "channel/provider/webhook credentials", which must be "encrypted
 * with tenant-bound context" and whose "plaintext never appears in API
 * responses, logs, caches, migration receipts, or object metadata".
 * `SEALED_CREDENTIAL_COLUMNS` is that set, and every read/write path in this
 * service passes through `openInstanceCredentials` / `sealInstanceCredentials`.
 *
 * The tenant binding needs no resolver seam here: `instances` IS the G2
 * ownership root, so a row's own persisted `tenant_id` is the trusted answer —
 * and it is the answer on BOTH sides. A write seals under the tenant the
 * PERSISTED ROW will present back on read, never merely under the active scope.
 *
 * WHY THAT SYMMETRY IS THE WHOLE CONTRACT. Reads open with `row.tenant_id`; a
 * write that sealed under the active scope while the row landed with
 * `tenant_id` NULL would produce an envelope nothing can ever open —
 * `openCredentialField(null, sealed)` fails closed to `null`, so a rotation
 * would silently and permanently destroy a live bot token. Nothing stamps this
 * root's `tenant_id` today (`NewInstance` omits it, the root has no derivation
 * trigger and no column default, and the trusted ownership writer has no
 * production caller), so every row production writes is still NULL-tenant and
 * the sealing arm of (g) is INERT on this surface until root-ownership
 * assignment lands. That is a ROLLOUT ORDERING CONSTRAINT, and it is enforced
 * here rather than merely documented: master-key custody may precede ownership
 * without any credential being lost, because a write only seals once the row
 * actually carries the tenant it is sealed for. The active scope still bounds
 * it — a write from a scope that does not own the row seals nothing.
 *
 * DUAL WORLD. Sealing engages only when BOTH a tenant is present AND a master
 * key is configured (`setTenantSecretMasterKey`). Flag-off there is no tenant;
 * with no key the codec is the identity function. In either case the column
 * holds the same bytes it held before G5 and callers see the same plaintext —
 * the deliverable is INERT until a deployment opts in. Reads are transitional:
 * legacy plaintext rows and sealed rows coexist, each handled on its own shape,
 * because G5 ships no credential backfill.
 */

import type { EventBus } from '@omni/core';
import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import { type ChannelType, type Instance, type NewInstance, instances } from '@omni/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { invalidateProviderCacheForInstance } from '../plugins/agent-dispatcher';
import { forgetInstanceOwner, rememberInstanceOwners } from '../tenancy/instance-owner-registry';
import { credentialSealingEngages, openCredentialField, sealCredentialField } from '../tenancy/sealed-credentials';
import { currentTenantScope, runAfterTenantCommit, scopedHandle } from '../tenancy/tenant-scope';

export interface ListInstancesOptions {
  channel?: ChannelType[];
  status?: ('active' | 'inactive')[];
  limit?: number;
  cursor?: string;
}

/**
 * The `instances` columns that hold channel credential material.
 *
 * Deliberately an explicit allow-list rather than a heuristic on the column
 * name: a heuristic that silently stopped matching (a renamed column, a new
 * channel) would fail OPEN, writing a live bot token as plaintext with nothing
 * to notice it. Adding a channel means adding its secret column here, and the
 * per-column probe in `sealed-credential-surfaces.test.ts` asserts the whole
 * list is honoured rather than only the first entry.
 *
 * `twilioAccountSid`, `twilioFrom`, the messaging-service SID and the callback
 * URLs are identifiers, not secrets, and stay in the clear so operators can
 * still read them out of the database.
 */
const SEALED_CREDENTIAL_COLUMNS = [
  'discordBotToken',
  'slackBotToken',
  'slackUserToken',
  'slackAppToken',
  'slackSigningSecret',
  'telegramBotToken',
  'gupshupAuthToken',
  'webhookVerifyToken',
  'twilioAuthToken',
] as const satisfies readonly (keyof Instance)[];

/**
 * Seal the credential columns present in `data` for `tenantId`.
 *
 * Only keys the caller actually supplied are touched, so a partial update that
 * does not mention a token cannot blank or re-seal it. Returns a NEW object;
 * the caller's input is never mutated.
 */
function sealInstanceCredentials<T extends Record<string, unknown>>(tenantId: string | null, data: T): T {
  const out: Record<string, unknown> = { ...data };
  for (const column of SEALED_CREDENTIAL_COLUMNS) {
    if (!(column in out)) continue;
    const value = out[column];
    if (typeof value !== 'string') continue;
    out[column] = sealCredentialField(tenantId, value);
  }
  return out as T;
}

/** Does `data` actually carry a credential column a seal could reshape? */
function hasSealableCredential(data: Record<string, unknown>): boolean {
  return SEALED_CREDENTIAL_COLUMNS.some((column) => {
    const value = data[column];
    return typeof value === 'string' && value !== '';
  });
}

/**
 * Open the credential columns of a loaded row, using the row's OWN persisted
 * tenant. A row that cannot be opened (sealed under a different tenant, or no
 * key configured) yields `null` for that column — fail-closed, never the
 * ciphertext envelope. See `sealed-credentials.ts` for why null and not a throw.
 */
function openInstanceCredentials<T extends { tenantId?: string | null }>(row: T): T {
  const tenantId = row.tenantId ?? null;
  let copy: Record<string, unknown> | null = null;
  for (const column of SEALED_CREDENTIAL_COLUMNS) {
    const stored = (row as Record<string, unknown>)[column];
    if (typeof stored !== 'string') continue;
    const opened = openCredentialField(tenantId, stored);
    if (opened === stored) continue;
    if (!copy) copy = { ...row };
    copy[column] = opened;
  }
  return (copy ?? row) as T;
}

/** Open a batch of loaded rows. Identity when nothing in the batch is sealed. */
function openInstanceCredentialsAll<T extends { tenantId?: string | null }>(rows: T[]): T[] {
  return rows.map(openInstanceCredentials);
}

/**
 * The `instances` columns that get baked into a cached IAgentProvider at
 * construction time (see resolveProvider / createAgnoProvider and friends in
 * agent-dispatcher). An update touching any of these must evict the instance's
 * provider-cache entry or the running dispatcher keeps the stale values until
 * the process restarts (omni#906).
 */
const PROVIDER_BAKED_COLUMNS = [
  'agentId',
  'agentTimeout',
  'enableAutoSplit',
  'agentPrefixSenderName',
] as const satisfies readonly (keyof NewInstance)[];

/** Presence check, not value diff: `null` is a meaningful new value here. */
export function touchesProviderBakedConfig(data: Partial<NewInstance>): boolean {
  return PROVIDER_BAKED_COLUMNS.some((column) => column in data);
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
      // Ownership is taught from the RAW rows above (the registry reads
      // `tenant_id`, which sealing never touches); only what leaves this method
      // is opened.
      items: openInstanceCredentialsAll(items),
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
    return openInstanceCredentialsAll(rows);
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
    return openInstanceCredentials(result);
  }

  /**
   * Get instance by name
   */
  async getByName(name: string): Promise<Instance> {
    const [result] = await this.db.select().from(instances).where(eq(instances.name, name)).limit(1);

    if (!result) {
      throw new NotFoundError('Instance', name);
    }

    return openInstanceCredentials(result);
  }

  /**
   * The tenant a WRITE from this service seals under, given the tenant the
   * PERSISTED ROW carries (or will carry).
   *
   * Two trusted facts must agree, and sealing happens only when they do:
   *
   *   * the ACTIVE tenant scope — what the G3/G4 boundary resolved from the
   *     caller's credential. Null on every legacy/worker/CLI path;
   *   * the ROW's own `tenant_id` — the ownership root's persisted answer, and
   *     the only thing `openInstanceCredentials` will have on the read side.
   *
   * Disagreement (including the additive phase, where the row is NULL-tenant)
   * returns null, which makes `sealCredentialField` the identity function: the
   * column keeps the exact bytes it kept before G5. That is strictly safer than
   * sealing — a value sealed under a tenant the row does not carry is
   * unopenable FOREVER, while plaintext is exactly the pre-G5 posture. A caller
   * still cannot choose the key: `NewInstance` omits `tenantId`, and a row
   * tenant that does not equal the active scope seals nothing at all.
   */
  private sealTenantFor(rowTenantId: string | null | undefined): string | null {
    const scope = currentTenantScope()?.tenantId ?? null;
    if (!scope) return null;
    return (rowTenantId ?? null) === scope ? scope : null;
  }

  /**
   * The seal tenant for an UPDATE: the persisted row's own tenant, cross-checked
   * against the active scope.
   *
   * The lookup is skipped whenever it could not change the outcome — no scope,
   * no credential column in the patch, or no master key configured — so the
   * legacy/inert world issues exactly the statements it issued before G5, not
   * one more. It runs on `this.db`, i.e. inside the caller's tenant transaction
   * when there is one.
   */
  private async updateSealTenant(id: string, data: Partial<NewInstance>): Promise<string | null> {
    const scope = currentTenantScope()?.tenantId ?? null;
    if (!credentialSealingEngages(scope)) return null;
    if (!hasSealableCredential(data as Record<string, unknown>)) return null;

    const [row] = await this.db
      .select({ tenantId: instances.tenantId })
      .from(instances)
      .where(eq(instances.id, id))
      .limit(1);

    return this.sealTenantFor(row?.tenantId ?? null);
  }

  /**
   * Create a new instance
   */
  async create(data: NewInstance): Promise<Instance> {
    // The row's tenant is whatever the insert persists. `NewInstance` omits
    // `tenantId`, so in production that is NULL and nothing seals; the cast
    // mirrors the ownership-carrying shape the G3 root writer produces.
    const rowTenant = (data as { tenantId?: string | null }).tenantId ?? null;

    const [created] = await this.db
      .insert(instances)
      .values(sealInstanceCredentials(this.sealTenantFor(rowTenant), data))
      .returning();

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

    return openInstanceCredentials(created);
  }

  /**
   * Update an instance
   */
  async update(id: string, data: Partial<NewInstance>): Promise<Instance> {
    const sealTenant = await this.updateSealTenant(id, data);
    const [updated] = await this.db
      .update(instances)
      .set({ ...sealInstanceCredentials(sealTenant, data), updatedAt: new Date() })
      .where(eq(instances.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Instance', id);
    }

    // omni#906: these fields are baked into the cached IAgentProvider at
    // construction, so the dispatcher would keep serving the old values until
    // a process restart unless the cache entry is evicted here. Guarded by
    // field presence so unrelated updates (profileName, isActive, presence…)
    // don't churn providers that hold live NATS/WS subscriptions. Deferred to
    // commit: inside the request transaction a concurrent dispatch still reads
    // the OLD row and would re-cache a stale provider right after an immediate
    // eviction — and a rollback must not have disposed a live provider.
    if (touchesProviderBakedConfig(data)) {
      runAfterTenantCommit(() => invalidateProviderCacheForInstance(id));
    }

    rememberInstanceOwners([updated]);
    return openInstanceCredentials(updated);
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

    // Dispose the cached agent provider (and its NATS/WS subscriptions) —
    // nothing can dispatch for this instance anymore (omni#906). After commit,
    // so a concurrent dispatch can't rebuild a provider for a row whose DELETE
    // is still uncommitted (and a rollback keeps the provider alive).
    runAfterTenantCommit(() => invalidateProviderCacheForInstance(id));

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
