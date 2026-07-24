/**
 * The instance→tenant ownership registry — producer-side tenant derivation for
 * channel-plugin publishes (wish: omni-full-multitenancy, Group G5; ADR-0008).
 *
 * WHAT PROBLEM THIS SOLVES
 * ------------------------
 * G5 leg A gave every NATS envelope a version + trusted tenant and wired
 * `setEnvelopeTenantResolver` to the per-request tenant scope. That covers
 * publishes made INSIDE a request. It does not cover the path that carries
 * almost all of the platform's events: `BaseChannelPlugin.publishEventInternal`
 * emits `message.received`, `instance.connected`, `reaction.*`, `sync.*` from a
 * socket callback with no request and no scope. Those publishes stamped nothing,
 * so every real channel event classified `legacy` — and the consumers legs A–E
 * converted (`event-persistence`, `media-processor`, `sync-worker`,
 * `event-listeners`, `agent-dispatcher`, the follow-up cluster) never entered
 * the tenant world for live traffic. The conversions were correct and unreachable.
 *
 * THE DERIVATION, AND WHY IT IS TRUSTED
 * -------------------------------------
 * ADR-0008: "Publishers derive tenant from authenticated/LOADED RESOURCES, never
 * caller claims." A plugin publish always names the `instanceId` it is emitting
 * for, and `instances` is THE ownership root (G0/G2 `tenancy-ownership.ts`) — the
 * instance row's `tenant_id` IS the answer, and it is persisted server-side
 * state, not anything a payload can assert. `envelope.ts`'s own subject
 * rationale already relies on this: "Instances carry their tenant ... so the
 * tenant is derivable at PUBLISH time from the loaded instance."
 *
 * This registry is the carrier for that derivation. Every entry is written from
 * an `instances` ROW the API layer has already loaded — startup reconnect, the
 * monitor's fetches, `InstanceService` reads/writes — never from an event
 * payload, a header, or a caller-supplied hint. There is no path that inserts a
 * tenant this process did not read out of the database.
 *
 * WHY A REGISTRY AND NOT A QUERY
 * ------------------------------
 * A publish must not grow a database round trip, and under RLS enforcement a
 * scope-less `instances` read is not even expressible — the runtime role's
 * ambient reads fail closed (`omni_current_tenant_id()` RAISES). A read-through
 * cache would therefore have nowhere to read from. The map is instead populated
 * by the reads that legitimately happen anyway.
 *
 * IMMUTABILITY, AND WHAT THAT BUYS
 * --------------------------------
 * An instance's tenant is its ownership root: it is assigned once and does not
 * move. So a conflicting second derivation is a BUG somewhere upstream, not an
 * update — and `rememberInstanceOwner` refuses it (first write wins) rather than
 * letting one bad read redirect a live instance's entire event stream into
 * another tenant. Because the mapping never legitimately changes, staleness is
 * not a failure mode here.
 *
 * Tenant SUSPENSION/REVOCATION is deliberately NOT this seam's concern. Stamping
 * the correct tenant on an event is orthogonal to whether that tenant may still
 * have work done for it; the latter is enforced at dequeue and before every
 * durable side effect (`periodic-tenant-work.ts` `isTenantWorkAdmissible`).
 * Refusing to stamp a suspended tenant would produce an UNTENANTED envelope,
 * which consumers process on the legacy path — the exact global-processing
 * fallback ADR-0008 forbids.
 *
 * THE DUAL WORLD
 * --------------
 * Flag-off, every `instances.tenant_id` is NULL, so every `rememberInstanceOwner`
 * stores nothing, the resolver returns null, and publishes stay legacy —
 * byte-identical to pre-G5, with no flag check anywhere in this module. The
 * dual-world behavior falls out of the data rather than out of a branch.
 */

import { createLogger, setEnvelopeInstanceTenantResolver } from '@omni/core';

const log = createLogger('instance-owner-registry');

/** Mirrors the shape `tenant-transaction.ts` enforces at the DB boundary. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Hard ceiling on entries.
 *
 * One entry per instance is small and inherently bounded by the deployment, but
 * an in-memory map on the publish path must not be able to grow without limit on
 * any input, so the bound is explicit rather than assumed. Reaching it means the
 * deployment has more instances than this ceiling anticipates: further entries
 * are dropped and the publish for those instances stays legacy — a degradation,
 * loudly logged, never a wrong tenant.
 */
export const INSTANCE_OWNER_REGISTRY_MAX_ENTRIES = 10_000;

const owners = new Map<string, string>();
let capacityWarned = false;

/** The minimum shape of a loaded `instances` row this registry accepts. */
export interface InstanceOwnerRow {
  readonly id: string;
  readonly tenantId?: string | null;
}

/**
 * Record one loaded instance row's persisted ownership.
 *
 * A NULL/absent/malformed tenant is recorded as ABSENT — never as a tenant, and
 * never as a placeholder that could later be mistaken for one.
 */
export function rememberInstanceOwner(row: InstanceOwnerRow): void {
  const { id, tenantId } = row;
  if (typeof id !== 'string' || id.length === 0) return;
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) return;

  const existing = owners.get(id);
  if (existing !== undefined) {
    if (existing !== tenantId) {
      // First write wins. See the module header: this is a bug signal, not an
      // update, and taking the newer value would move a live instance's whole
      // event stream to another tenant.
      log.error('refusing a conflicting instance ownership derivation', { instanceId: id });
    }
    return;
  }

  if (owners.size >= INSTANCE_OWNER_REGISTRY_MAX_ENTRIES) {
    if (!capacityWarned) {
      capacityWarned = true;
      log.error('instance ownership registry is full; further instances publish legacy envelopes', {
        max: INSTANCE_OWNER_REGISTRY_MAX_ENTRIES,
      });
    }
    return;
  }

  owners.set(id, tenantId);
}

/** Record a batch of loaded rows; each is validated on its own. */
export function rememberInstanceOwners(rows: readonly InstanceOwnerRow[]): void {
  for (const row of rows) rememberInstanceOwner(row);
}

/** Drop an instance's entry — it was deleted. */
export function forgetInstanceOwner(instanceId: string): void {
  owners.delete(instanceId);
}

/** The persisted tenant of `instanceId`, or null when unknown. */
export function lookupInstanceOwner(instanceId: string): string | null {
  return owners.get(instanceId) ?? null;
}

/** Entry count. Exposed for the bound probe and for operational logging. */
export function instanceOwnerRegistrySize(): number {
  return owners.size;
}

/**
 * Hand this registry to `@omni/core`'s publish path.
 *
 * Called once at startup, next to `setEnvelopeTenantResolver`. Until it is
 * called, `@omni/core` stamps nothing from ownership — which is what keeps every
 * unit test and every embedded/library use of the event bus on the legacy path
 * unless it opts in.
 */
export function installInstanceOwnerResolver(): void {
  setEnvelopeInstanceTenantResolver((instanceId) => lookupInstanceOwner(instanceId));
}

/** Test-only: drop all state, including the capacity warning latch. */
export function __resetInstanceOwnerRegistry(): void {
  owners.clear();
  capacityWarned = false;
}
