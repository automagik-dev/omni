/**
 * Streaming and long-lived-state tenant keying — G5 deliverable (e)
 * (wish: omni-full-multitenancy, Group G5; ADR-0008, ADR-0006; RELEASE_SLOS
 * `revocation.websocket_sse_channel_provider_session_termination_seconds_max`).
 *
 * WHAT PROBLEM THIS SOLVES
 * ------------------------
 * A request lives for milliseconds and re-derives its authority on every hop.
 * A WebSocket/SSE subscription, an in-memory channel/plugin registry entry, or a
 * provider session lives for HOURS on authority derived exactly once, at connect
 * time — and the pre-G5 registries key those long-lived entries by RESOURCE UUID
 * alone (`client.params.sessionId !== sessionId` in `ws/voice.ts`,
 * `sub.chatId !== update.chatId` in `ws/chats.ts`). Two failure modes follow:
 *
 *   1. **Knowledge is treated as authority.** Any authenticated connection that
 *      can name a session/chat id joins its fan-out. Under multitenancy that id
 *      may belong to another tenant, so a resource-only match IS the cross-tenant
 *      read. WISH ("Streaming and long-lived state") states the rule directly:
 *      subscriptions are keyed AND authorized by tenant, not only by resource
 *      UUID.
 *   2. **Authority goes stale and nothing notices.** A tenant suspended (or a
 *      revocation epoch bumped) at 12:00 keeps streaming into a socket opened at
 *      09:00, because nothing re-checks. RELEASE_SLOS caps that window at
 *      {@link STREAM_TERMINATION_CEILING_SECONDS}.
 *
 * This module supplies the two devices those surfaces lack: a composite
 * (tenant, resource) key with an explicit authorization decision at subscribe
 * time, and a periodic revocation sweep that terminates a tenant's live
 * subscriptions inside the ceiling.
 *
 * WHY A SWEEP RATHER THAN AN EVENT
 * --------------------------------
 * Suspension/archival happens in `tenant-control-plane.ts`, possibly in another
 * process from the one holding the socket. An in-process event would only reach
 * connections owned by the process that performed the suspension — every other
 * node would keep streaming. A poll of the SAME trusted control-plane state
 * `periodic-tenant-work.ts` reads is process-independent, and its cadence is what
 * the ceiling actually bounds. The cadence is therefore derived FROM the ceiling
 * ({@link resolveStreamSweepIntervalMs}) rather than chosen independently.
 *
 * FAIL-CLOSED
 * -----------
 * Every ambiguous state terminates or refuses: a tenant-context subscriber may
 * not bind a resource of unknown ownership, an owned resource may not be bound
 * without a tenant context, and a tenant that no longer resolves in the control
 * plane loses its subscriptions. Silence is never read as permission.
 *
 * DUAL WORLD
 * ----------
 * Flag-off, no connection carries a tenant: {@link TenantStreamRegistry.matching}
 * degenerates to the pre-G5 resource-only match, {@link authorizeStreamSubscription}
 * admits every legacy pairing, and the sweep returns without a single query.
 * Flag-on, a tenantless (legacy/transitional) subscription is likewise never
 * swept — it has no tenant whose revocation could apply. The tenant-keyed
 * behaviour binds ONLY to subscriptions that carry a trusted tenant.
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { tenants } from '@omni/db';
import { eq } from 'drizzle-orm';
import { isMultitenancyEnabled } from './feature-flag';

const log = createLogger('tenant-stream-subscriptions');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The termination ceiling for long-lived subscriptions, sourced from
 * `RELEASE_SLOS.yaml`
 * `revocation.websocket_sse_channel_provider_session_termination_seconds_max`.
 * A revoked tenant's WebSocket/SSE/provider session must be closed within this
 * window.
 */
export const STREAM_TERMINATION_CEILING_SECONDS = 30;

/**
 * The sweep cadence. Half the ceiling, so a revocation landing immediately
 * after one tick is still caught by the next one WITHIN the ceiling — a cadence
 * equal to the ceiling would leave a worst case of exactly one full ceiling plus
 * the sweep's own duration.
 */
export function resolveStreamSweepIntervalMs(): number {
  return Math.floor((STREAM_TERMINATION_CEILING_SECONDS * 1000) / 2);
}

export type StreamAuthorizationRefusal =
  /** the subscriber's tenant is not the resource's persisted owner */
  | 'cross_tenant_resource'
  /** a tenant-context subscriber named a resource with no known owner */
  | 'unowned_resource'
  /** an owned resource was named by a connection carrying no tenant */
  | 'tenant_context_required'
  /** a supplied tenant is not a well-formed UUID */
  | 'malformed_tenant';

export type StreamAuthorization = { ok: true } | { ok: false; reason: StreamAuthorizationRefusal };

/**
 * The subscribe-time authorization decision (WISH "Streaming and long-lived
 * state").
 *
 * Both inputs must be TRUSTED derivations: `authenticatedTenantId` from the
 * connection's authenticated credential (never a query parameter or a socket
 * message), and `resourceTenantId` from the resource row's PERSISTED ownership
 * (the same derivation G2 defined) — never from the client's claim about what it
 * is subscribing to.
 *
 * The four states are decided explicitly rather than by a truthiness chain, so
 * no combination falls through to "allow":
 *
 *   | tenant ctx | resource owner | decision                       |
 *   |------------|----------------|--------------------------------|
 *   | absent     | absent         | allow  (legacy/flag-off world) |
 *   | present    | equal          | allow                          |
 *   | present    | different      | refuse cross_tenant_resource   |
 *   | present    | absent         | refuse unowned_resource        |
 *   | absent     | present        | refuse tenant_context_required |
 */
export function authorizeStreamSubscription(input: {
  authenticatedTenantId: string | null;
  resourceTenantId: string | null;
}): StreamAuthorization {
  const { authenticatedTenantId, resourceTenantId } = input;

  for (const value of [authenticatedTenantId, resourceTenantId]) {
    if (value !== null && !UUID.test(value)) return { ok: false, reason: 'malformed_tenant' };
  }

  if (authenticatedTenantId === null) {
    return resourceTenantId === null ? { ok: true } : { ok: false, reason: 'tenant_context_required' };
  }
  if (resourceTenantId === null) return { ok: false, reason: 'unowned_resource' };
  return authenticatedTenantId === resourceTenantId ? { ok: true } : { ok: false, reason: 'cross_tenant_resource' };
}

/**
 * The composite address of a subscription. A resource UUID alone is NOT a key:
 * the same session/chat id under two tenants yields two distinct keys, so a
 * fan-out computed from a resource id can never reach the other tenant even if
 * the ids collide.
 *
 * `null` produces the reserved legacy key, distinct from every tenant key, so a
 * legacy fan-out and a tenant fan-out never intersect either.
 */
export function streamSubscriptionKey(tenantId: string | null, resourceId: string): string {
  return `${tenantId ?? 'legacy'}::${resourceId}`;
}

/** One live long-lived subscription's tenancy state. */
export interface StreamSubscriptionBinding {
  /** The trusted tenant this connection was authorized for; null = legacy. */
  readonly tenantId: string | null;
  /** The resource (voice session, chat, instance, agent) the stream is bound to. */
  readonly resourceId: string;
  /**
   * The tenant revocation epoch observed when the connection was authorized. A
   * later epoch in the control plane means the authority this connection was
   * opened under has been superseded, and the connection must close even if the
   * tenant is still `active` (ADR-0006).
   */
  readonly revocationEpoch: number;
  /** Terminate the transport. Must be idempotent-safe from the sweeper's view. */
  close(reason: string): void;
}

/**
 * A registry of long-lived connections keyed by (tenant, resource).
 *
 * `C` is the transport handle (a `ws`, an SSE stream, a provider session); this
 * class owns only the tenancy bookkeeping, never the transport semantics — the
 * concrete registries (`VoiceStreamRegistry`, the chat WS handler) keep their own
 * per-connection payload state and consult this for WHO may receive WHAT.
 */
export class TenantStreamRegistry<C> {
  private readonly bindings = new Map<C, StreamSubscriptionBinding>();

  add(connection: C, binding: StreamSubscriptionBinding): void {
    this.bindings.set(connection, binding);
  }

  remove(connection: C): void {
    this.bindings.delete(connection);
  }

  get(connection: C): StreamSubscriptionBinding | undefined {
    return this.bindings.get(connection);
  }

  get size(): number {
    return this.bindings.size;
  }

  /**
   * The tenant-narrowed fan-out set for one resource.
   *
   * A caller broadcasting tenant A's update passes A's trusted tenant and
   * reaches ONLY A's subscribers of that resource. A legacy caller passes `null`
   * and reaches only the legacy subscribers — the pre-G5 resource-only match,
   * byte-identical, because flag-off every binding is tenantless.
   */
  *matching(resourceId: string, tenantId: string | null): Generator<[C, StreamSubscriptionBinding]> {
    const wanted = streamSubscriptionKey(tenantId, resourceId);
    for (const [connection, binding] of this.bindings) {
      if (streamSubscriptionKey(binding.tenantId, binding.resourceId) === wanted) {
        yield [connection, binding];
      }
    }
  }

  /** Every binding, for sweeps and diagnostics. */
  entries(): IterableIterator<[C, StreamSubscriptionBinding]> {
    return this.bindings.entries();
  }

  /** The distinct tenants holding at least one live subscription (legacy excluded). */
  activeTenantIds(): string[] {
    const seen = new Set<string>();
    for (const [, binding] of this.bindings) {
      if (binding.tenantId !== null) seen.add(binding.tenantId);
    }
    return [...seen];
  }

  /**
   * Close and drop every subscription belonging to one tenant. Returns the count
   * closed. A `close` that throws is logged and does not stop the sweep — a
   * wedged socket must not keep a sibling's revocation from landing.
   */
  terminateTenant(tenantId: string, reason: string): number {
    let closed = 0;
    for (const [connection, binding] of [...this.bindings]) {
      if (binding.tenantId !== tenantId) continue;
      try {
        binding.close(reason);
      } catch (err) {
        log.warn('stream termination failed', {
          tenantId,
          reason,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.bindings.delete(connection);
      closed += 1;
    }
    return closed;
  }
}

/** The control-plane freshness state a live subscription is revalidated against. */
export interface TenantRevocationState {
  status: string;
  revocationEpoch: number;
}

export type TenantRevocationStateReader = (
  authPlaneDb: Database,
  tenantId: string,
) => Promise<TenantRevocationState | null>;

/**
 * Read one tenant's live status + revocation epoch from the auth plane.
 *
 * Same trusted, non-caller-controlled source and same connection posture as
 * `periodic-tenant-work.ts`: `tenants` is an AUTH-PLANE table, so this must run
 * on `services.authPlane.db`. Under enforcement without a dedicated auth-plane
 * handle the read FAILS CLOSED (it raises), and the sweep treats that as
 * "unknown" — which terminates, never grants.
 */
const readTenantRevocationState: TenantRevocationStateReader = async (authPlaneDb, tenantId) => {
  const [row] = await authPlaneDb
    .select({ status: tenants.status, revocationEpoch: tenants.revocationEpoch })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row ?? null;
};

export interface StreamSweepStats {
  /** Distinct tenants revalidated this tick. */
  tenantsChecked: number;
  /** Subscriptions closed this tick. */
  terminated: number;
}

/**
 * One revocation pass over every live tenant-bound subscription (RELEASE_SLOS
 * `websocket_sse_channel_provider_session_termination_seconds_max`).
 *
 * For each DISTINCT tenant holding a subscription — one control-plane read per
 * tenant, not per connection — the pass terminates when the tenant is not
 * `active` (suspended/archived), when the tenant's current revocation epoch is
 * AHEAD of the epoch the connection was authorized under, or when the tenant no
 * longer resolves at all. A read that throws also terminates: an auth plane we
 * cannot consult is not evidence of continued authority.
 *
 * Flag-off, and for tenantless legacy subscriptions flag-on, this does nothing
 * and issues no query.
 *
 * @param readState - seam for the control-plane read; production callers use the
 *   default. Tests inject synthetic epochs through it, which is why the ceiling
 *   proofs need no wall clock.
 */
export async function sweepRevokedStreamSubscriptions(
  authPlaneDb: Database,
  registry: TenantStreamRegistry<unknown>,
  env: NodeJS.ProcessEnv = process.env,
  readState: TenantRevocationStateReader = readTenantRevocationState,
): Promise<StreamSweepStats> {
  const stats: StreamSweepStats = { tenantsChecked: 0, terminated: 0 };
  if (!isMultitenancyEnabled(env)) return stats;

  for (const tenantId of registry.activeTenantIds()) {
    stats.tenantsChecked += 1;

    let state: TenantRevocationState | null;
    try {
      state = await readState(authPlaneDb, tenantId);
    } catch (err) {
      log.warn('stream revocation read failed; terminating fail-closed', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      stats.terminated += registry.terminateTenant(tenantId, 'tenant_revoked');
      continue;
    }

    if (state === null || state.status !== 'active') {
      stats.terminated += registry.terminateTenant(tenantId, 'tenant_revoked');
      continue;
    }

    stats.terminated += terminateSupersededEpochs(registry, tenantId, state.revocationEpoch);
  }

  return stats;
}

/**
 * Close a tenant's connections whose authorized epoch has been SUPERSEDED, while
 * the tenant itself is still active (ADR-0006).
 *
 * Per connection rather than per tenant, so a socket that reauthorized at the
 * current epoch survives the same tick that closes its stale siblings.
 */
function terminateSupersededEpochs(
  registry: TenantStreamRegistry<unknown>,
  tenantId: string,
  currentEpoch: number,
): number {
  let terminated = 0;
  for (const [connection, binding] of [...registry.entries()]) {
    if (binding.tenantId !== tenantId) continue;
    if (binding.revocationEpoch >= currentEpoch) continue;
    try {
      binding.close('tenant_revoked');
    } catch (err) {
      log.warn('stream termination failed', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    registry.remove(connection);
    terminated += 1;
  }
  return terminated;
}

/**
 * Start the periodic revocation sweep, returning a stop handle.
 *
 * Flag-off this starts NO timer at all — the pre-G5 process gains no background
 * work. The interval is `unref`'d where the runtime supports it so a sweeping
 * process can still exit.
 */
export function startStreamRevocationSweeper(
  authPlaneDb: Database,
  registry: TenantStreamRegistry<unknown>,
  env: NodeJS.ProcessEnv = process.env,
): { stop: () => void } {
  if (!isMultitenancyEnabled(env)) return { stop: () => {} };

  const timer = setInterval(() => {
    void sweepRevokedStreamSubscriptions(authPlaneDb, registry, env).then(
      (stats) => {
        if (stats.terminated > 0) {
          log.info('terminated revoked stream subscriptions', {
            terminated: stats.terminated,
            tenantsChecked: stats.tenantsChecked,
          });
        }
      },
      (err) => log.warn('stream revocation sweep failed', { error: err instanceof Error ? err.message : String(err) }),
    );
  }, resolveStreamSweepIntervalMs());

  (timer as unknown as { unref?: () => void }).unref?.();
  return { stop: () => clearInterval(timer) };
}
