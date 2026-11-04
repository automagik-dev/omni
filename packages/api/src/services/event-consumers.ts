/**
 * Durable event consumers (#989, RFC #925 G7 — the durable half; the one-shot
 * half is `omni events wait`, PR #972).
 *
 * A registered consumer is a name + filter + cursor over the JOURNAL
 * (`omni_events`, totally ordered by `journal_seq`). Delivery is
 * at-least-once-with-cursor: `pull` pages events strictly after the stored
 * cursor, `ack` advances it monotonically, disconnect/re-pull resumes exactly
 * after the last ack. The journal is the source of truth (NATS is transport),
 * so offsets older than NATS retention are automatically servable.
 *
 * Filter semantics REUSE the `events wait` contract (#966): the type filter
 * is exact-match or a trailing-* prefix glob (same as EventService.list), and
 * payload conditions run through the automation matcher
 * (`evaluateConditions`, @omni/core) against the row's rawPayload.
 *
 * The `pull` cursor advances over SCANNED rows, not merely matched ones —
 * acking the returned cursor skips filtered-out rows, so a sparse filter
 * never re-scans the same journal range. This is also what keeps the model
 * composable with G6 (waits/continuations): "wake a suspended run when a
 * matching event arrives" is `pull(limit: 1)` from a stored cursor with the
 * same matcher — nothing here assumes a live socket or a NATS subscription.
 *
 * Fan-out vs shared (#1188): by default every consumer NAME owns one cursor,
 * so two names on the same type each see every event (observers). A `shared`
 * consumer is a competing-consumer queue: each pull LEASES the next page to
 * that puller alone and the claimed watermark moves past it; ack(leaseId)
 * releases the lease and the cursor advances to the oldest outstanding lease.
 * An unacked lease expires and is redelivered — at-least-once, per page (pull
 * with limit 1 for per-message ack). Leases live on the consumer row and are
 * updated compare-and-set, so concurrent pullers on any replica never share
 * a page.
 *
 * Instance scoping (opt-in, 0082): a consumer created with `scoped: true`
 * stores its owner key and an instance set. Its pull only pages journal rows
 * of those instances (in SQL, inside the same scan, so the scanned cursor and
 * the empty-page advance still move past filtered rows), and only the owner
 * key or an instance-unrestricted key can see, pull, ack or delete it —
 * anyone else gets the same 404 as a missing name. Unscoped consumers (the
 * default for unrestricted keys) can only be pulled, streamed, acked or deleted by
 * instance-unrestricted keys: sharing their cursor with a restricted reader
 * would discard rows that reader never received. Restricted keys always
 * create scoped consumers. Scoped streams also apply the caller filter.
 * Agent-owned consumers additionally admit instance-less rows through an active
 * source or producing-agent grant. Instance scopes restrict their instance branch
 * only; grant branches are enabled by the paired-agent consumers flag.
 * Tenant credentials additionally require a matching tenant stamp, even without
 * database enforcement; unstamped pre-0091 registrations are hidden from them.
 * A key with events:consume but not events:write (`ownOnly`, #1461) owns what it creates
 * (owner_key_id, also unscoped), reaches only those consumers (any other is a 404) and owns
 * at most MAX_CONSUMERS_PER_OWN_ONLY_KEY of them.
 */

import { randomUUID } from 'node:crypto';
import { ConflictError, ERROR_CODES, NotFoundError, OmniError, ValidationError, evaluateConditions } from '@omni/core';
import type { EventBus } from '@omni/core';
import type {
  AutomationCondition,
  ConsumerAccessFilter,
  ConsumerLease,
  Database,
  DurableConsumer,
  OmniEvent,
  SharedLeaseState,
} from '@omni/db';
import { agentSourceGrants, durableConsumers, instances, omniEvents } from '@omni/db';
import { type SQL, and, asc, count, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { KeyAgentResolution } from '../lib/key-agent';
import { pairedAgentFlagState } from '../tenancy/feature-flag';
import { runDetachedFromTenantScope, scopedHandle } from '../tenancy/tenant-scope';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';
import { eventTypeFilterClause } from './events';

type NewDurableConsumer = typeof durableConsumers.$inferInsert;

/** The row a create inserts. The scope columns are written only when scoped or owned. */
function consumerInsertValues(
  input: CreateConsumerInput,
  row: { tenantId: string | null; agentId: string | null; cursor: number; scope: ConsumerScope },
): NewDurableConsumer {
  return {
    name: input.name,
    tenantId: row.tenantId,
    agentId: row.agentId,
    eventType: input.eventType,
    excludeTypes: input.excludeTypes?.length ? input.excludeTypes : null,
    filters: input.filters ?? null,
    cursor: row.cursor,
    shared: input.shared ?? false,
    waitForReady: input.waitForReady ?? false,
    leaseState: input.shared ? { claimed: row.cursor, leases: [] } : null,
    ...(row.scope.scoped || row.scope.ownerKeyId ? row.scope : {}),
    accessFilter: input.access ?? 'all',
  };
}

/** Insert one consumer; undefined when its name is taken (the caller answers 409). */
async function insertConsumer(
  db: Pick<Database, 'insert'>,
  values: NewDurableConsumer,
): Promise<DurableConsumer | undefined> {
  const [created] = await db
    .insert(durableConsumers)
    .values(values)
    .onConflictDoNothing({ target: durableConsumers.name })
    .returning();
  return created;
}

/** Source namespaces are distinct: a parent connector never authorizes its legacy subscriptions. */
// Do not simplify the NULL-safe equality below to IS NOT DISTINCT FROM: that
// plans as NOT(DistinctExpr), not an OpExpr. compute_semijoin_info then cannot
// unique-ify grants to drive seeks on omni_events_source_type_seq_idx or
// omni_events_agent_type_seq_idx. Empty text is never a UUID's text, so coalesce
// preserves NULL/NULL equality without a sentinel collision.
function activeGrantSourceClause(agentId: string): SQL {
  return sql`exists (select 1 from ${agentSourceGrants}
    where ${agentSourceGrants.agentId} = ${agentId}
      and ${agentSourceGrants.revokedAt} is null
      and coalesce(${agentSourceGrants.tenantId}::text, '') = coalesce(${omniEvents.tenantId}::text, '')
      and ${agentSourceGrants.sourceKind} = ${omniEvents.sourceKind}
      and ${agentSourceGrants.sourceId} = ${omniEvents.sourceId})`;
}

// Do not simplify the NULL-safe equality below to IS NOT DISTINCT FROM: that
// plans as NOT(DistinctExpr), not an OpExpr. compute_semijoin_info then cannot
// unique-ify grants to drive seeks on omni_events_source_type_seq_idx or
// omni_events_agent_type_seq_idx. Empty text is never a UUID's text, so coalesce
// preserves NULL/NULL equality without a sentinel collision.
function activeGrantAgentClause(agentId: string): SQL {
  return sql`exists (select 1 from ${agentSourceGrants}
    where ${agentSourceGrants.agentId} = ${agentId}
      and ${agentSourceGrants.revokedAt} is null
      and coalesce(${agentSourceGrants.tenantId}::text, '') = coalesce(${omniEvents.tenantId}::text, '')
      and ${agentSourceGrants.sourceKind} = 'agent'
      and ${agentSourceGrants.sourceId} = ${omniEvents.agentId})`;
}

/** Where a new consumer's cursor starts: the journal head (default) or 0 (full replay). */
export type ConsumerStartFrom = 'now' | 'beginning';

export interface CreateConsumerInput {
  /** Trusted agent ownership is authorized separately from instance scoping. */
  agentId?: string;
  name: string;
  eventType: string;
  /** Type globs to drop (same syntax as eventType); exclusion wins (#1078). */
  excludeTypes?: string[];
  filters?: AutomationCondition[];
  /** 'now' (default, matches `events wait`) or 'beginning' (projection/backfill replay). */
  startFrom?: ConsumerStartFrom;
  /** Competing consumers: pullers on this name split the stream (#1188). Default false = fan-out. */
  shared?: boolean;
  /**
   * Opt-in access filter over the ingest verdict (`omni_events.access_decision`).
   * 'all' (default) adds no predicate. 'allowed'/'denied' require
   * OMNI_JOURNAL_ACCESS_DECISION=true, otherwise create() refuses with a 400.
   * Without `waitForReady` a row whose fill lands late can be skipped (its
   * verdict is still NULL when later rows move the cursor); set
   * `waitForReady` to hold the page until the fill lands.
   */
  access?: ConsumerAccessFilter;
  /**
   * Opt-in journal readiness gate: hold claimed-but-unfilled rows (younger
   * than the settle window) instead of delivering them hollow. Default false.
   */
  waitForReady?: boolean;
  /** Instance scoping + ownership (0082); always enabled for an instance-restricted caller. */
  scoped?: boolean;
  /**
   * Scoped consumers only: instance UUIDs to page (validated there). Ignored
   * for an unrestricted caller without `scoped: true` (legacy behaviour).
   */
  instanceIds?: unknown;
}

/**
 * The calling API key as the consumer access rules see it. Routes derive it
 * from the request's key; internal callers that pass none keep the legacy
 * unrestricted behaviour.
 */
export interface ConsumerCaller {
  principal?: KeyAgentResolution;
  admin?: boolean;
  /** Trusted authenticated tenant; absent/null keeps legacy key access rules. */
  tenantId?: string | null;
  /** api_keys.id of the caller; null when the request carried no key. */
  keyId: string | null;
  /** The key's instance restriction; null = every instance (ApiKeyService.instanceAllowed's rule). */
  instanceIds: string[] | null;
  /**
   * The key holds `events:consume` without `events:write` (#1461): it sees, runs and deletes
   * only the consumers it created (owner_key_id = keyId); any other consumer is a 404, and it
   * may own at most MAX_CONSUMERS_PER_OWN_ONLY_KEY. Unset for every other caller.
   */
  ownOnly?: boolean;
}

/** How many consumers one `ownOnly` key may own (#1461). Callers with events:write are not capped. */
export const MAX_CONSUMERS_PER_OWN_ONLY_KEY = 10;

/**
 * The ownership columns a create writes: all null/false unless the consumer is scoped, or
 * created by an `ownOnly` key (unscoped, but owned by that key).
 */
export type ConsumerScope =
  | { scoped: false; instanceIds: null; ownerKeyId: string | null }
  | { scoped: true; instanceIds: string[]; ownerKeyId: string };

/** A consumer row plus its live lag (journal head minus cursor). */
export interface ConsumerWithLag extends DurableConsumer {
  /** Highest journal_seq visible to this consumer (0 when empty). */
  head: number;
  /** head - cursor, floored at 0. Counts ALL journal rows past the cursor, not only matching ones. */
  lag: number;
  /** No type-matching journal row past the cursor — nothing left to scan (lag may still be > 0). */
  caughtUp: boolean;
}

export interface PullOptions {
  /** Max events to SCAN in this page (matches are <= this). 1..500, default 100. */
  limit?: number;
  /** Long-poll: when the page is empty, wait up to this long for new rows. 0..30000ms. */
  waitMs?: number;
  /** Shared consumers: how long the leased page stays with this puller before redelivery. */
  leaseMs?: number;
}

export interface PullResult {
  consumer: string;
  /** Rows matching the type filter AND payload conditions, ascending journal_seq. */
  items: OmniEvent[];
  /**
   * Highest journal_seq SCANNED (not merely matched). Ack THIS value: it
   * advances past filtered-out rows so a sparse filter never re-scans.
   * Equals the stored cursor when nothing new was scanned.
   */
  cursor: number;
  head: number;
  /** True when the scan filled the page — more rows are already waiting. */
  hasMore: boolean;
  /**
   * True when a full scan window matched nothing (#1128). The stored cursor
   * was already advanced past those rows, so the next pull scans new ground.
   */
  scanExhausted: boolean;
  /** Shared consumers: ack with this id (not the cursor). Absent when nothing was delivered. */
  leaseId?: string;
}

/**
 * One page of the SSE stream (`GET /events/consumers/:name/stream`). Same
 * scan as pull, read-only: nothing here writes the cursor or a lease.
 */
export interface StreamScanResult {
  /** Rows matching the type filter AND payload conditions, ascending journal_seq. */
  items: OmniEvent[];
  /** Highest journal_seq SCANNED (matched or not), or null when nothing was scanned. */
  through: number | null;
  /** The page was cut before a claimed-but-unfilled row younger than the settle window. */
  held: boolean;
  /** The page came back full and uncut: more rows are already waiting. */
  full: boolean;
}

/** Who is reading a stream page: the request's trusted tenant and its API key as the consumer rules see it. */
export interface StreamAccess {
  /** Tenant the request scope resolved (null = legacy credential, ambient pool). */
  tenantId: string | null;
  /**
   * The calling key (the pull route's `consumerCaller`): visibility and owner
   * narrowing of scoped consumers, and its `instanceIds` (null = every
   * instance, the `GET /events` rule) restrict every page.
   */
  caller: ConsumerCaller;
}

/**
 * The caller's instance restriction for a pull or stream page: none for a full-access key,
 * otherwise `instance_id IN (...)` (rows with no instance excluded, as in
 * `GET /events`), and a match-nothing predicate for an empty allow-list.
 */
export function streamInstanceClause(instanceIds: readonly string[] | null): SQL | undefined {
  if (instanceIds === null) return undefined;
  return instanceIds.length === 0 ? sql`false` : inArray(omniEvents.instanceId, [...instanceIds]);
}

/** Rows the stream scans per page (matches are <= this). */
const STREAM_PAGE_LIMIT = 100;

const PULL_POLL_INTERVAL_MS = 500;
const PULL_MAX_LIMIT = 500;
const PULL_MAX_WAIT_MS = 30_000;
const DEFAULT_LEASE_MS = 60_000;
const SHARED_CAS_ATTEMPTS = 20;
/** Default settle window for the opt-in readiness gate (EVENT_CONSUMER_SETTLE_MS). */
export const DEFAULT_CONSUMER_SETTLE_MS = 5_000;

/**
 * The readiness gate's settle window: EVENT_CONSUMER_SETTLE_MS when it is a
 * non-negative number, 5000 ms otherwise. Read per pull, not at load.
 */
export function resolveConsumerSettleMs(raw: string | undefined = process.env.EVENT_CONSUMER_SETTLE_MS): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_CONSUMER_SETTLE_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CONSUMER_SETTLE_MS;
}

/**
 * Opt-in journal readiness gate. With `waitForReady` false the page is
 * returned unchanged (today's behaviour). With it true the page is cut just
 * before the first claimed-but-unfilled row (`journalReady` false) whose
 * receivedAt is younger than `settleMs`, so neither delivery nor the cursor
 * moves past it. A not-ready row older than the window counts as ready, so
 * a fill that never lands cannot stall the consumer.
 */
export function truncateAtUnready<T extends Pick<OmniEvent, 'journalReady' | 'receivedAt'>>(
  page: T[],
  waitForReady: boolean,
  settleMs: number,
  now: number,
): T[] {
  if (!waitForReady) return page;
  const held = page.findIndex((row) => !row.journalReady && now - row.receivedAt.getTime() < settleMs);
  return held === -1 ? page : page.slice(0, held);
}

/** JSON lease metadata added by this service; older persisted leases have no key binding. */
type KeyedConsumerLease = ConsumerLease & { keyId: string | null };

/** Where a shared puller goes next: redeliver an expired lease, or claim new rows after `after`. */
export function planSharedPull(
  state: SharedLeaseState,
  now: number,
): { reclaim: ConsumerLease; after?: never } | { reclaim?: never; after: number } {
  const expired = state.leases.find((lease) => lease.expiresAt <= now);
  return expired ? { reclaim: expired } : { after: state.claimed };
}

/** State after leasing (from, to] to a puller (replacing `replaces` on redelivery). */
export function claimLease(state: SharedLeaseState, lease: ConsumerLease, replaces?: string): SharedLeaseState {
  const previous = state.leases.find((item) => item.id === replaces);
  // A bounded reclaim may cover only the first page of its old range. Keep the
  // unscanned tail expired, ahead of fresh work, with a separate ack identity.
  const remainder = previous && lease.to < previous.to ? [{ ...previous, id: randomUUID(), from: lease.to }] : [];
  return {
    claimed: Math.max(state.claimed, lease.to),
    leases: [...state.leases.filter((l) => l.id !== replaces), ...remainder, lease],
  };
}

/**
 * State + cursor after acking a lease, or null when the lease is gone (it
 * expired and was redelivered). The cursor is the oldest outstanding lease
 * start, or the claimed watermark when nothing is outstanding.
 */
export function releaseLease(
  state: SharedLeaseState,
  leaseId: string,
): { state: SharedLeaseState; cursor: number } | null {
  if (!state.leases.some((l) => l.id === leaseId)) return null;
  const leases = state.leases.filter((l) => l.id !== leaseId);
  const cursor = leases.length ? Math.min(...leases.map((l) => l.from)) : state.claimed;
  return { state: { claimed: state.claimed, leases }, cursor };
}

/** True when the row's payload passes the consumer's conditions (wait/automation matcher). */
export function matchesConsumerPayload(
  row: Pick<OmniEvent, 'rawPayload'>,
  filters?: AutomationCondition[] | null,
): boolean {
  if (!filters || filters.length === 0) return true;
  return evaluateConditions(filters, row.rawPayload ?? {});
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The caller's key id when it can own a consumer (owner_key_id is a uuid column), else null. */
function ownerKeyOf(caller?: ConsumerCaller): string | null {
  const keyId = caller?.keyId ?? null;
  return keyId && UUID_RE.test(keyId) ? keyId : null;
}

const ScopedInstanceIdsSchema = z.array(z.string().uuid()).max(100).optional();

/**
 * Resolve the scope columns for a create. Restricted callers always create
 * scoped consumers, even with scoped: false. Unscoped for an unrestricted key is exactly
 * the pre-0082 consumer, and any `instanceIds` sent with it is ignored as it
 * was before (an unknown field). Scoped: the instanceIds must be up to 100
 * UUIDs (400 otherwise); an instance-restricted key gets the
 * requested instances (all of its own when omitted) and may not name an
 * instance outside its set (403); an unrestricted key must name a non-empty
 * set. An empty result is a 400. Existence is checked separately at create
 * time (`assertInstancesResolve`: an unknown instance is a 400). Exported for unit tests.
 */
export function resolveConsumerScope(
  input: Pick<CreateConsumerInput, 'scoped' | 'instanceIds'>,
  caller?: ConsumerCaller,
): ConsumerScope {
  if (!input.scoped && (!caller || caller.instanceIds === null)) {
    if (!caller?.ownOnly) return { scoped: false, instanceIds: null, ownerKeyId: null };
    // An ownOnly key owns what it creates, also unscoped: scoping would page only instance
    // rows, and a host follows instance-less events too.
    const ownerKeyId = ownerKeyOf(caller);
    if (!ownerKeyId) {
      throw new ValidationError('this API key can only create consumers it owns, and it has no owner id', {
        keyId: ['no calling API key'],
      });
    }
    return { scoped: false, instanceIds: null, ownerKeyId };
  }

  const parsedIds = ScopedInstanceIdsSchema.safeParse(input.instanceIds);
  if (!parsedIds.success) {
    throw new ValidationError('instanceIds must be an array of up to 100 instance UUIDs', {
      instanceIds: ['array of up to 100 UUIDs'],
    });
  }

  const ownerKeyId = ownerKeyOf(caller);
  if (!ownerKeyId) {
    throw new ValidationError('a scoped consumer needs an API key to own it', { scoped: ['no calling API key'] });
  }

  // Instance ids are UUIDs: normalise to lowercase once, so membership checks,
  // the stored set and later narrowing all compare the same spelling.
  const requested = parsedIds.data ? [...new Set(parsedIds.data.map((id) => id.toLowerCase()))] : undefined;
  const keyInstances = caller?.instanceIds ? caller.instanceIds.map((id) => id.toLowerCase()) : null;
  if (keyInstances === null) {
    if (!requested?.length) {
      throw new ValidationError('a scoped consumer on an instance-unrestricted key needs a non-empty instanceIds', {
        instanceIds: ['required (non-empty) for an unrestricted key'],
      });
    }
    return { scoped: true, instanceIds: requested, ownerKeyId };
  }

  const outside = requested?.filter((id) => !keyInstances.includes(id)) ?? [];
  if (outside.length > 0) {
    throw new OmniError({
      code: ERROR_CODES.FORBIDDEN,
      message: 'API key does not have access to this instance',
      context: { instanceIds: outside },
      recoverable: false,
    });
  }
  const instanceIds = requested ?? [...new Set(keyInstances)];
  if (instanceIds.length === 0) {
    throw new ValidationError('a scoped consumer needs at least one instance the API key can access', {
      instanceIds: ['empty after intersecting with the API key instances'],
    });
  }
  return { scoped: true, instanceIds, ownerKeyId };
}

/**
 * Tenant callers can access only stamped consumers of their own tenant;
 * unstamped legacy rows fail closed. Legacy callers keep their access rules.
 * Delivery and mutations additionally require getMutable. Within the tenant
 * boundary, unscoped consumers are visible to every caller; a scoped
 * consumer is visible to its owner key and to instance-unrestricted keys.
 * Exported for unit tests.
 */
export function canAccessConsumer(
  consumer: Pick<DurableConsumer, 'tenantId' | 'scoped' | 'ownerKeyId'> & { agentId?: string | null },
  caller?: ConsumerCaller,
): boolean {
  if (caller?.tenantId && consumer.tenantId !== caller.tenantId) return false;
  if (caller?.ownOnly && !ownsConsumer(consumer, caller)) return false;
  if (consumer.agentId) {
    if (!caller) return true;
    if (caller.principal?.kind === 'unresolved') return false;
    return (
      caller.admin === true || (caller.principal?.kind === 'agent' && caller.principal.agentId === consumer.agentId)
    );
  }
  if (!consumer.scoped || !caller || caller.instanceIds === null) return true;
  return consumer.ownerKeyId !== null && consumer.ownerKeyId === caller.keyId;
}

/** An `ownOnly` key's consumers: those whose owner_key_id is the key's own (uuid) id. */
function ownsConsumer(consumer: Pick<DurableConsumer, 'ownerKeyId'>, caller: ConsumerCaller): boolean {
  const keyId = ownerKeyOf(caller);
  return keyId !== null && consumer.ownerKeyId === keyId;
}

/**
 * Mutations by restricted keys require a scoped consumer they own, also in SQL. An `ownOnly`
 * key additionally requires owner_key_id = its key; every other caller gets the unchanged clause.
 */
export function consumerAccessClause(caller?: ConsumerCaller): SQL | undefined {
  const clause = keyConsumerAccessClause(caller);
  if (!caller?.ownOnly) return clause;
  const keyId = ownerKeyOf(caller);
  return and(clause, keyId ? eq(durableConsumers.ownerKeyId, keyId) : sql`false`);
}

function keyConsumerAccessClause(caller?: ConsumerCaller): SQL | undefined {
  const tenant = caller?.tenantId ? eq(durableConsumers.tenantId, caller.tenantId) : undefined;
  if (!caller || (caller.admin && caller.instanceIds === null && caller.principal?.kind !== 'unresolved'))
    return tenant;
  const keyId = ownerKeyOf(caller);
  const legacy = and(
    isNull(durableConsumers.agentId),
    caller.instanceIds === null
      ? undefined
      : keyId
        ? and(eq(durableConsumers.scoped, true), eq(durableConsumers.ownerKeyId, keyId))
        : sql`false`,
  );
  return and(
    tenant,
    or(legacy, caller.principal?.kind === 'agent' ? eq(durableConsumers.agentId, caller.principal.agentId) : undefined),
  );
}

/** Shared by the route (before agent lookup) and service (before any write). */
export function resolveConsumerAgentId(input: CreateConsumerInput, caller?: ConsumerCaller): string | null {
  const flag = pairedAgentFlagState('consumers');
  if (!flag.enabled) {
    if (input.agentId !== undefined)
      throw new ValidationError(
        `agentId needs ${flag.flag}=true${flag.reason === 'multitenancy_enabled' ? ' and OMNI_MULTITENANCY_ENABLED disabled' : ''}`,
      );
    return null;
  }
  if (caller?.principal?.kind === 'unresolved')
    throw new OmniError({
      code: ERROR_CODES.FORBIDDEN,
      message: `An unresolved agent key cannot create consumers (${caller.principal.reason})`,
      recoverable: false,
    });
  if (input.agentId !== undefined) {
    const agentId = input.agentId.toLowerCase();
    if (
      !caller?.admin &&
      !(caller?.principal?.kind === 'agent' && caller.principal.agentId.toLowerCase() === agentId)
    ) {
      throw new OmniError({
        code: ERROR_CODES.FORBIDDEN,
        message: 'Cannot create a consumer for another agent',
        recoverable: false,
      });
    }
    return agentId;
  }
  return caller?.principal?.kind === 'agent' ? caller.principal.agentId.toLowerCase() : null;
}

/**
 * The consumer as `caller` may page it: a scoped consumer pulled by an
 * instance-restricted key (its owner) pages only the stored instances the key
 * still has, so narrowing the key later also narrows the pull. Unscoped
 * consumers and unrestricted callers are returned unchanged. Exported for unit tests.
 */
export function narrowToCaller(consumer: DurableConsumer, caller?: ConsumerCaller): DurableConsumer {
  const keyInstances = caller?.instanceIds?.map((id) => id.toLowerCase());
  if (!consumer.scoped || !keyInstances) return consumer;
  return {
    ...consumer,
    instanceIds: (consumer.instanceIds ?? []).filter((id) => keyInstances.includes(id.toLowerCase())),
  };
}

/** A scoped consumer pages only its instances' rows; an empty set fails closed. */
function instanceScopeClause(consumer: Pick<DurableConsumer, 'scoped' | 'instanceIds'>): SQL | undefined {
  if (!consumer.scoped) return undefined;
  return consumer.instanceIds?.length ? inArray(omniEvents.instanceId, consumer.instanceIds) : sql`false`;
}

/** Env flag that makes event persistence journal the access verdict (0083). */
const ACCESS_DECISION_ENV = 'OMNI_JOURNAL_ACCESS_DECISION';

/**
 * The scanPage predicate for a consumer's access filter: undefined for 'all'
 * (so the WHERE is exactly the unfiltered one), `access_decision = <filter>`
 * otherwise. Rows journaled without a decision never match a filtered consumer.
 *
 * A claimed-but-unfilled row (`journal_ready` false) has no decision yet: the
 * fill writes `access_decision` and `journal_ready = true` in one upsert.
 * - Without `waitForReady` the plain predicate excludes that row while later
 *   rows move the cursor past it, so a row whose fill lands late is skipped.
 *   `waitForReady` is the fix for an access-filtered consumer.
 * - With `waitForReady` the predicate widens to
 *   `access_decision = <filter> OR journal_ready = false`: the not-ready row
 *   reaches `truncateAtUnready`, which holds the page before it, and
 *   `matchesConsumerAccess` then drops non-matching survivors in JS (a dead
 *   not-ready row older than the settle window included) while the cursor
 *   still advances past them.
 */
export function accessFilterClause(
  filter: ConsumerAccessFilter | null | undefined,
  waitForReady = false,
): SQL | undefined {
  if (filter !== 'allowed' && filter !== 'denied') return undefined;
  const decided = eq(omniEvents.accessDecision, filter);
  return waitForReady ? or(decided, eq(omniEvents.journalReady, false)) : decided;
}

/**
 * The access filter applied to a scanned page, like the payload filter: true
 * for 'all', otherwise the row's ingest verdict must equal the filter. Without
 * `waitForReady` the SQL predicate already guarantees it; with it this drops
 * the not-ready rows the widened predicate let through.
 */
export function matchesConsumerAccess(
  row: Pick<OmniEvent, 'accessDecision'>,
  filter: ConsumerAccessFilter | null | undefined,
): boolean {
  if (filter !== 'allowed' && filter !== 'denied') return true;
  return row.accessDecision === filter;
}

/** True when a scanned row passes the consumer's access filter and payload conditions. */
function matchesConsumer(row: OmniEvent, consumer: DurableConsumer): boolean {
  return matchesConsumerAccess(row, consumer.accessFilter) && matchesConsumerPayload(row, consumer.filters);
}

/**
 * Refuse an access-filtered consumer while nothing journals the verdict: it
 * would match no row. Throws a ValidationError (HTTP 400) naming the env var.
 */
function assertAccessFilterAvailable(access: ConsumerAccessFilter | undefined): void {
  if (access === undefined || access === 'all') return;
  if (process.env[ACCESS_DECISION_ENV] === 'true') return;
  throw new ValidationError(
    `access '${access}' needs ${ACCESS_DECISION_ENV}=true: without it no journal row carries an access decision`,
    undefined,
    { access, env: ACCESS_DECISION_ENV },
  );
}

/** Initial cursor for a new consumer. Exported for unit tests. */
export function resolveInitialCursor(startFrom: ConsumerStartFrom, head: number): number {
  return startFrom === 'beginning' ? 0 : head;
}

/** Lag math: journal head minus cursor, floored at 0. Exported for unit tests. */
export function computeLag(head: number, cursor: number): number {
  return Math.max(0, head - cursor);
}

export class EventConsumerService {
  /**
   * The handle every query in this service uses: the request's tenant-stamped
   * transaction inside a tenant scope, the ambient pool otherwise (G4 —
   * `tenancy/tenant-scope.ts`). Under RLS enforcement this is what keeps
   * `pull` tenant-policed: a tenant-scoped request only pages its own
   * tenant's `omni_events` rows.
   */
  private get db(): Database {
    return scopedHandle(this.pool);
  }

  constructor(
    private readonly pool: Database,
    private readonly eventBus: EventBus | null = null,
  ) {}

  /** Highest journal_seq in the journal, 0 when empty. Cheap (backward index scan). */
  async head(tenantId?: string | null): Promise<number> {
    const query = this.db
      .select({ head: sql<number>`coalesce(max(${omniEvents.journalSeq}), 0)::bigint` })
      .from(omniEvents);
    const [row] = await (tenantId ? query.where(eq(omniEvents.tenantId, tenantId)) : query);
    return Number(row?.head ?? 0);
  }

  /** Every consumer the caller may see (all of them without a caller), with live lag. */
  async list(caller?: ConsumerCaller): Promise<ConsumerWithLag[]> {
    const [rows, head] = await Promise.all([
      this.db
        .select()
        .from(durableConsumers)
        .where(caller?.tenantId ? eq(durableConsumers.tenantId, caller.tenantId) : undefined)
        .orderBy(asc(durableConsumers.name)),
      this.head(caller?.tenantId),
    ]);
    const visible = rows.filter((row) => canAccessConsumer(row, caller));
    return Promise.all(visible.map((row) => this.withLag(row, head, caller)));
  }

  async getByName(name: string): Promise<DurableConsumer> {
    const [row] = await this.db.select().from(durableConsumers).where(eq(durableConsumers.name, name)).limit(1);
    if (!row) throw new NotFoundError('DurableConsumer', name);
    return row;
  }

  /** getByName, but a scoped consumer the caller may not access is the same 404 as a missing one. */
  private async getVisible(name: string, caller?: ConsumerCaller): Promise<DurableConsumer> {
    const row = await this.getByName(name);
    if (!canAccessConsumer(row, caller)) throw new NotFoundError('DurableConsumer', name);
    return row;
  }

  /** getByName plus live head/lag — the `inspect` surface. */
  async inspect(name: string, caller?: ConsumerCaller): Promise<ConsumerWithLag> {
    const row = await this.getVisible(name, caller);
    return this.withLag(row, await this.head(row.tenantId), caller);
  }

  /** Delivery and mutations fail closed for restricted callers on unscoped consumers. */
  private async getMutable(name: string, caller?: ConsumerCaller): Promise<DurableConsumer> {
    const row = await this.getVisible(name, caller);
    if (!row.scoped && caller && caller.instanceIds !== null) {
      throw new OmniError({
        code: ERROR_CODES.FORBIDDEN,
        message: `Instance-restricted API keys cannot pull, stream, ack or delete unscoped consumer '${name}'. Create a scoped consumer (scoped: true) for this key.`,
        context: { name },
        recoverable: false,
      });
    }
    return narrowToCaller(row, caller);
  }

  private async withLag(row: DurableConsumer, head: number, caller?: ConsumerCaller): Promise<ConsumerWithLag> {
    const caughtUp =
      row.cursor >= head ||
      (
        await this.scan(
          narrowToCaller(row, caller),
          1,
          undefined,
          undefined,
          streamInstanceClause(caller?.instanceIds ?? null),
        )
      ).length === 0;
    return { ...row, head, lag: computeLag(head, row.cursor), caughtUp };
  }

  /**
   * A scoped create names only instances that exist and the caller can see:
   * one read through `scopedHandle`, so under a tenant scope another tenant's
   * instance is unresolved too (RLS hides it). Unresolved ids are a 400 that
   * names them. Unscoped creates never reach this (no extra query).
   */
  private async assertInstancesResolve(instanceIds: string[]): Promise<void> {
    const rows = await this.db.select({ id: instances.id }).from(instances).where(inArray(instances.id, instanceIds));
    const resolved = new Set(rows.map((row) => row.id.toLowerCase()));
    const unresolved = instanceIds.filter((id) => !resolved.has(id.toLowerCase()));
    if (unresolved.length > 0) {
      throw new ValidationError(
        'a scoped consumer names instances that do not exist',
        { instanceIds: unresolved },
        { instanceIds: unresolved },
      );
    }
  }

  async create(input: CreateConsumerInput, caller?: ConsumerCaller): Promise<ConsumerWithLag> {
    const agentId = resolveConsumerAgentId(input, caller);
    assertAccessFilterAvailable(input.access);
    const scope = resolveConsumerScope(input, caller);
    if (scope.scoped) await this.assertInstancesResolve(scope.instanceIds);
    const tenantId = caller?.tenantId ?? null;
    const head = await this.head(tenantId);
    const cursor = resolveInitialCursor(input.startFrom ?? 'now', head);

    const values = consumerInsertValues(input, { tenantId, agentId, cursor, scope });
    const created =
      caller?.ownOnly && scope.ownerKeyId
        ? await this.insertWithinOwnerCap(values, scope.ownerKeyId, tenantId)
        : await insertConsumer(this.db, values);
    if (!created) {
      throw new ConflictError('DurableConsumer', `a consumer named '${input.name}' already exists`, {
        name: input.name,
      });
    }

    // State change → event (repo contract). webhook_sources CRUD publishes
    // nothing; the local pattern followed here is the agents CRUD one
    // (`system.agent.registered`). system.* events live on the bus, not in
    // the journal — journaling every registry mutation would be noise.
    if (this.eventBus) {
      await this.eventBus.publishGeneric('system.consumer.created', {
        consumerId: created.id,
        ...(created.agentId ? { agentId: created.agentId } : {}),
        name: created.name,
        eventType: created.eventType,
        cursor: created.cursor,
        shared: created.shared,
        ...(created.scoped ? { scoped: true, instanceIds: created.instanceIds, ownerKeyId: created.ownerKeyId } : {}),
        ...(!created.scoped && created.ownerKeyId ? { ownerKeyId: created.ownerKeyId } : {}),
      });
    }

    return this.withLag(created, head, caller);
  }

  /**
   * An `ownOnly` key's create, under MAX_CONSUMERS_PER_OWN_ONLY_KEY. The count and the insert
   * run in one transaction behind an advisory lock keyed on the owner, so concurrent creates
   * by one key queue rather than overshoot the cap.
   */
  private async insertWithinOwnerCap(
    values: NewDurableConsumer,
    ownerKeyId: string,
    tenantId: string | null,
  ): Promise<DurableConsumer | undefined> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`omni:consumer-owner:${ownerKeyId}`}))`);
      const [row] = await tx
        .select({ owned: count() })
        .from(durableConsumers)
        .where(
          and(
            eq(durableConsumers.ownerKeyId, ownerKeyId),
            tenantId ? eq(durableConsumers.tenantId, tenantId) : undefined,
          ),
        );
      if ((row?.owned ?? 0) >= MAX_CONSUMERS_PER_OWN_ONLY_KEY) {
        throw new OmniError({
          code: ERROR_CODES.CONSUMER_LIMIT_REACHED,
          message: `This API key already owns ${MAX_CONSUMERS_PER_OWN_ONLY_KEY} consumers, the most it may own. Delete one to create another.`,
          context: { limit: MAX_CONSUMERS_PER_OWN_ONLY_KEY },
          recoverable: true,
        });
      }
      return insertConsumer(tx, values);
    });
  }

  async delete(name: string, caller?: ConsumerCaller): Promise<void> {
    await this.getMutable(name, caller);
    const [deleted] = await this.db
      .delete(durableConsumers)
      .where(and(eq(durableConsumers.name, name), consumerAccessClause(caller)))
      .returning();
    if (!deleted) throw new NotFoundError('DurableConsumer', name);

    if (this.eventBus) {
      await this.eventBus.publishGeneric('system.consumer.deleted', {
        consumerId: deleted.id,
        name: deleted.name,
        eventType: deleted.eventType,
        cursor: deleted.cursor,
      });
    }
  }

  /**
   * Page journal events strictly after the stored cursor. Does NOT advance
   * the cursor past delivered rows — that is `ack`'s job (at-least-once: a
   * client that crashes mid-page re-pulls the same page).
   *
   * Exception (#1128): a page that scanned rows but matched NONE delivers
   * nothing, so the cursor is advanced past it here. Otherwise a client that
   * never acks an empty page (peek, or acking only delivered items) re-scans
   * the same window forever once non-matching rows exceed `limit`.
   */
  async pull(name: string, options: PullOptions = {}, caller?: ConsumerCaller): Promise<PullResult> {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), PULL_MAX_LIMIT);
    const waitMs = Math.min(Math.max(options.waitMs ?? 0, 0), PULL_MAX_WAIT_MS);
    const consumer = await this.getMutable(name, caller);
    if (consumer.shared) return this.pullShared(consumer, limit, waitMs, options.leaseMs ?? DEFAULT_LEASE_MS, caller);

    const deadline = Date.now() + waitMs;
    // Readiness gate (opt-in): a page cut to empty keeps long-polling.
    const settleMs = consumer.waitForReady ? resolveConsumerSettleMs() : 0;
    const keyInstances = streamInstanceClause(caller?.instanceIds ?? null);
    const scan = async (): Promise<OmniEvent[]> => {
      const page = await this.scan(consumer, limit, undefined, undefined, keyInstances);
      return consumer.waitForReady ? truncateAtUnready(page, true, settleMs, Date.now()) : page;
    };
    let scanned = await scan();
    while (scanned.length === 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, PULL_POLL_INTERVAL_MS));
      scanned = await scan();
    }

    const items = scanned.filter((row) => matchesConsumer(row, consumer));
    const last = scanned[scanned.length - 1];
    const cursor = last ? Number(last.journalSeq) : consumer.cursor;
    if (items.length === 0 && cursor > consumer.cursor) {
      // Monotonic (lte guard): a concurrent ack further ahead wins.
      await this.db
        .update(durableConsumers)
        .set({ cursor, updatedAt: new Date() })
        .where(
          and(eq(durableConsumers.id, consumer.id), lte(durableConsumers.cursor, cursor), consumerAccessClause(caller)),
        );
    }
    const head = await this.head(consumer.tenantId);
    const hasMore = scanned.length === limit;
    return {
      consumer: consumer.name,
      items,
      cursor,
      head,
      hasMore,
      scanExhausted: hasMore && items.length === 0,
    };
  }

  /**
   * Advance the cursor. Monotonic: an ack equal to the stored cursor is an
   * idempotent no-op (client retry), an ack BEHIND it is refused with a 400 —
   * a durable cursor never moves backwards.
   */
  async ack(name: string, cursor: number, leaseId?: string, caller?: ConsumerCaller): Promise<ConsumerWithLag> {
    if (leaseId) {
      return this.ackShared(name, leaseId, caller);
    }

    await this.getMutable(name, caller);
    const [updated] = await this.db
      .update(durableConsumers)
      .set({ cursor, updatedAt: new Date() })
      .where(
        and(
          eq(durableConsumers.name, name),
          eq(durableConsumers.shared, false),
          lte(durableConsumers.cursor, cursor),
          consumerAccessClause(caller),
        ),
      )
      .returning();

    if (!updated) {
      const existing = await this.getVisible(name, caller); // throws NotFoundError when absent or not visible
      if (existing.shared) {
        throw new ValidationError(`consumer '${name}' is shared — ack with the pull result's leaseId`, undefined, {
          name,
        });
      }
      throw new ValidationError(
        `ack cursor ${cursor} is behind the stored cursor ${existing.cursor} — acks are monotonic`,
        undefined,
        { name, cursor, storedCursor: existing.cursor },
      );
    }

    return this.withLag(updated, await this.head(updated.tenantId), caller);
  }

  /**
   * The consumer behind an SSE stream. Fan-out consumers only: a shared
   * consumer is refused (400), because handing out leases is the pull path's
   * job and the stream never takes or acks one.
   */
  async getStreamable(name: string, caller?: ConsumerCaller): Promise<DurableConsumer> {
    // Match pull: restricted keys need a scoped consumer, and an owner
    // pages only the stored instances its key still has.
    const consumer = await this.getMutable(name, caller);
    if (consumer.shared) {
      throw new ValidationError(
        `consumer '${name}' is shared — streams serve fan-out consumers only; pull and ack with the leaseId`,
        undefined,
        { name },
      );
    }
    return consumer;
  }

  /**
   * One SSE stream page strictly after `after`: the pull scan (type filter,
   * exclude globs, payload conditions) with the readiness gate ALWAYS on,
   * whatever the consumer's own waitForReady says, so a hollow row is held
   * rather than pushed. Read-only: never writes the cursor or a lease.
   *
   * A stream outlives the request that opened it, and with a tenant
   * credential that request's transaction has committed by the time a later
   * page is read. So every page runs detached from the request scope, in a
   * short worker transaction of its own for `trustedTenantId` (the tenant the
   * request scope resolved), or on the ambient pool for a legacy credential.
   * The consumer is re-read per page, so a deleted consumer ends the stream.
   *
   * The scan runs as `{ ...consumer, waitForReady: true }`: with an access
   * filter (0083) that widens the predicate to admit unfilled rows, so they
   * are held rather than skipped, and the survivors are filtered with the
   * pull's own `matchesConsumer` (payload + access verdict), so a dead
   * unfilled row past the settle window is skipped, not streamed.
   *
   * Scoping matches pull (getVisible + narrowToCaller), and an
   * instance-restricted API key additionally only scans its own instances'
   * rows (the `GET /events` rule), so other instances' rows are never sent
   * and never hold the page. Agent-owned grant branches remain independent
   * of instance restrictions; the position simply moves on past excluded rows.
   */
  async scanForStream(
    name: string,
    after: number,
    access: StreamAccess,
    limit: number = STREAM_PAGE_LIMIT,
  ): Promise<StreamScanResult> {
    return runDetachedFromTenantScope(() =>
      runTenantWorkDb(this.pool, access.tenantId, async () => {
        const consumer = { ...(await this.getStreamable(name, access.caller)), waitForReady: true };
        const keyInstances = streamInstanceClause(access.caller.instanceIds);
        const page = await this.scan(consumer, limit, after, undefined, keyInstances);
        const rows = truncateAtUnready(page, true, resolveConsumerSettleMs(), Date.now());
        const held = rows.length < page.length;
        const last = rows[rows.length - 1];
        return {
          items: rows.filter((row) => matchesConsumer(row, consumer)),
          through: last ? Number(last.journalSeq) : null,
          held,
          full: !held && page.length === limit,
        };
      }),
    );
  }

  /** Shared pull: lease the next page (or an expired one) to this caller alone. */
  private async pullShared(
    initial: DurableConsumer,
    limit: number,
    waitMs: number,
    leaseMs: number,
    caller?: ConsumerCaller,
  ): Promise<PullResult> {
    const deadline = Date.now() + waitMs;
    const keyInstances = streamInstanceClause(caller?.instanceIds ?? null);
    let claim = await this.claimShared(initial, limit, leaseMs, keyInstances, caller);
    while (!claim.lease && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, PULL_POLL_INTERVAL_MS));
      claim = await this.claimShared(await this.getMutable(initial.name, caller), limit, leaseMs, keyInstances, caller);
    }

    const { consumer, lease, scanned } = claim;
    const items = scanned.filter((row) => matchesConsumer(row, consumer));
    if (lease && items.length === 0) {
      // Nothing to deliver: release now so the cursor moves past filtered-out rows (#1128).
      await this.ackShared(consumer.name, lease.id, caller).catch(() => undefined);
    }
    const hasMore = scanned.length >= limit;
    return {
      consumer: consumer.name,
      items,
      cursor: lease?.to ?? consumer.cursor,
      head: await this.head(consumer.tenantId),
      hasMore,
      scanExhausted: hasMore && items.length === 0,
      ...(lease && items.length > 0 ? { leaseId: lease.id } : {}),
    };
  }

  private async claimShared(
    start: DurableConsumer,
    limit: number,
    leaseMs: number,
    keyInstances?: SQL,
    caller?: ConsumerCaller,
  ): Promise<{ consumer: DurableConsumer; lease: ConsumerLease | null; scanned: OmniEvent[] }> {
    let consumer = start;
    for (let attempt = 0; attempt < SHARED_CAS_ATTEMPTS; attempt++) {
      const state = consumer.leaseState ?? { claimed: consumer.cursor, leases: [] };
      const now = Date.now();
      const plan = planSharedPull(state, now);
      const scanned = plan.reclaim
        ? await this.scan(consumer, PULL_MAX_LIMIT, plan.reclaim.from, plan.reclaim.to, keyInstances)
        : await this.scanFresh(consumer, limit, plan.after, keyInstances);
      const last = scanned[scanned.length - 1];
      if (!plan.reclaim && !last) return { consumer, lease: null, scanned };

      const lease: KeyedConsumerLease = plan.reclaim
        ? {
            ...plan.reclaim,
            id: randomUUID(),
            to: last && scanned.length === PULL_MAX_LIMIT ? Number(last.journalSeq) : plan.reclaim.to,
            expiresAt: now + leaseMs,
            keyId: caller?.keyId ?? null,
          }
        : {
            id: randomUUID(),
            from: plan.after,
            to: Number(last?.journalSeq),
            expiresAt: now + leaseMs,
            keyId: caller?.keyId ?? null,
          };
      if (await this.casLeaseState(consumer, claimLease(state, lease, plan.reclaim?.id))) {
        return { consumer, lease, scanned };
      }
      // Recheck ownership and scope after contention or a delete/recreate.
      consumer = await this.getMutable(consumer.name, caller);
    }
    throw new ConflictError('DurableConsumer', `too much contention leasing '${start.name}', retry`, {
      name: start.name,
    });
  }

  private async ackShared(name: string, leaseId: string, caller?: ConsumerCaller): Promise<ConsumerWithLag> {
    for (let attempt = 0; attempt < SHARED_CAS_ATTEMPTS; attempt++) {
      const consumer = await this.getMutable(name, caller);
      if (!consumer.shared) {
        throw new ValidationError(`consumer '${name}' is not shared — ack with a cursor`, undefined, { name });
      }
      const lease = consumer.leaseState?.leases.find((item) => item.id === leaseId);
      const claimingKey = lease && 'keyId' in lease ? lease.keyId : null;
      if (lease && claimingKey !== (caller?.keyId ?? null)) {
        throw new OmniError({
          code: ERROR_CODES.FORBIDDEN,
          message: 'This lease belongs to another API key. Ack with the key that pulled its page.',
          context: { name, leaseId },
          recoverable: false,
        });
      }
      const released = releaseLease(consumer.leaseState ?? { claimed: consumer.cursor, leases: [] }, leaseId);
      if (!released) {
        throw new ValidationError(
          `lease ${leaseId} is unknown or expired — its page was (or will be) redelivered`,
          undefined,
          { name, leaseId },
        );
      }
      const updated = await this.casLeaseState(consumer, released.state, Math.max(consumer.cursor, released.cursor));
      if (updated) return this.withLag(updated, await this.head(updated.tenantId), caller);
    }
    throw new ConflictError('DurableConsumer', `too much contention acking '${name}', retry`, { name });
  }

  /** Compare-and-set on lease_state: null when another puller changed it first. */
  private async casLeaseState(
    consumer: DurableConsumer,
    next: SharedLeaseState,
    cursor?: number,
  ): Promise<DurableConsumer | null> {
    const unchanged: SQL = consumer.leaseState
      ? sql`${durableConsumers.leaseState} = ${JSON.stringify(consumer.leaseState)}::jsonb`
      : isNull(durableConsumers.leaseState);
    const [updated] = await this.db
      .update(durableConsumers)
      .set({ leaseState: next, ...(cursor === undefined ? {} : { cursor }), updatedAt: new Date() })
      .where(and(eq(durableConsumers.id, consumer.id), unchanged))
      .returning();
    return updated ?? null;
  }

  /**
   * A fresh shared page after `after`. With the opt-in readiness gate it is
   * cut before a held row, so a fresh lease never spans one (an expired
   * lease's reclaim keeps its fixed range and does not come through here).
   */
  private async scanFresh(
    consumer: DurableConsumer,
    limit: number,
    after: number,
    keyInstances?: SQL,
  ): Promise<OmniEvent[]> {
    const page = await this.scan(consumer, limit, after, undefined, keyInstances);
    if (!consumer.waitForReady) return page;
    return truncateAtUnready(page, true, resolveConsumerSettleMs(), Date.now());
  }

  private scan(
    consumer: DurableConsumer,
    limit: number,
    after = consumer.cursor,
    through?: number,
    extra?: SQL,
  ): Promise<OmniEvent[]> {
    return consumer.agentId
      ? this.scanAgentOwnedPage(consumer, limit, after, through, extra)
      : this.scanPage(consumer, limit, after, through, extra);
  }

  /**
   * One statement gives every branch the same snapshot. Each branch reads at
   * most a page in journal order. Taking the first page
   * of their ordered union cannot skip an unread match, even when S and A
   * authorize the same row. Instance restrictions apply only to I: an active
   * grant alone authorizes an instance-less S/A row. Reclaim uses the same
   * live grant predicates and its original upper bound on every branch.
   */
  private async scanAgentOwnedPage(
    consumer: DurableConsumer,
    limit: number,
    after = consumer.cursor,
    through?: number,
    extra?: SQL,
  ): Promise<OmniEvent[]> {
    const common = and(
      gt(omniEvents.journalSeq, after),
      through === undefined ? undefined : lte(omniEvents.journalSeq, through),
      eventTypeFilterClause([consumer.eventType], consumer.excludeTypes ?? undefined),
      consumer.tenantId ? eq(omniEvents.tenantId, consumer.tenantId) : undefined,
      accessFilterClause(consumer.accessFilter, consumer.waitForReady),
    );
    const page = (branch: SQL | undefined) =>
      this.db.select().from(omniEvents).where(and(common, branch)).orderBy(asc(omniEvents.journalSeq)).limit(limit);
    const instancePage = page(and(isNotNull(omniEvents.instanceId), instanceScopeClause(consumer), extra));
    const rows =
      consumer.agentId && pairedAgentFlagState('consumers').enabled
        ? await unionAll(
            instancePage,
            page(and(isNull(omniEvents.instanceId), activeGrantSourceClause(consumer.agentId))),
            page(and(isNull(omniEvents.instanceId), activeGrantAgentClause(consumer.agentId))),
          )
        : await instancePage;
    const unique = new Map(rows.map((row) => [row.journalSeq, row]));
    return [...unique.values()].sort((a, b) => a.journalSeq - b.journalSeq).slice(0, limit);
  }

  /**
   * One ascending journal page after the consumer's cursor, pre-filtered by
   * the type filter in SQL (exact match, or trailing-* prefix glob — the
   * EventService.list / #966 contract) minus the exclude globs (#1078).
   * A scoped consumer (0082) also keeps only its instances' rows — in the
   * same query, so the page's last row (the scanned cursor) is a row it may
   * see, and the empty-page advance skips other instances' rows. Only for an
   * access-filtered consumer, the ingest access verdict (0083) is applied too.
   * Every caller (fresh lease, reclaim, pull, withLag's caughtUp) inherits it.
   * With `waitForReady` the access predicate also admits not-ready rows (see
   * `accessFilterClause`), so a pending claim keeps caughtUp false and the
   * callers apply `matchesConsumerAccess` to whatever survives truncation.
   */
  private async scanPage(
    consumer: DurableConsumer,
    limit: number,
    after = consumer.cursor,
    through?: number,
    /** The caller's instance restriction for pull and stream delivery. */
    extra?: SQL,
  ): Promise<OmniEvent[]> {
    const typeClause = eventTypeFilterClause([consumer.eventType], consumer.excludeTypes ?? undefined);

    return this.db
      .select()
      .from(omniEvents)
      .where(
        and(
          gt(omniEvents.journalSeq, after),
          through === undefined ? undefined : lte(omniEvents.journalSeq, through),
          typeClause,
          consumer.tenantId ? eq(omniEvents.tenantId, consumer.tenantId) : undefined,
          instanceScopeClause(consumer),
          accessFilterClause(consumer.accessFilter, consumer.waitForReady),
          extra,
        ),
      )
      .orderBy(asc(omniEvents.journalSeq))
      .limit(limit);
  }
}
