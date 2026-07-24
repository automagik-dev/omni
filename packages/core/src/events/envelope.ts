/**
 * Versioned tenant-aware event envelope (wish: omni-full-multitenancy, Group G5;
 * ADR-0008, WISH "Async and storage enforcement").
 *
 * THE SUBJECT DECISION
 * --------------------
 * ADR-0008 permits either a tenant-aware subject strategy OR consumer-validated
 * envelopes. The live subject layout is `{eventType}.{channelType}.{instanceId}`
 * (`nats/subjects.ts`), and every subscribe pattern in the system depends on
 * that three-token hierarchy (`{type}.>`), so folding a tenant token into the
 * subject would rewrite every producer AND every consumer and break the
 * instance-keyed routing the platform already relies on. Instances carry their
 * tenant (G2, `instances.tenant_id`), so the tenant is derivable at PUBLISH time
 * from the loaded instance and travels in the envelope. G5 therefore takes the
 * consumer-validated path: the subject is unchanged, and the trusted `tenantId`
 * rides inside the envelope where a consumer validates it before processing.
 *
 * THE DUAL WORLD
 * --------------
 * Both new fields are OPTIONAL and additive. A publisher stamps them ONLY when a
 * tenant context is present (`stampTenantEnvelope`), which only happens once
 * multitenancy is enabled and a scope/loaded resource supplies the tenant. A
 * flag-off deployment stamps nothing, so every envelope it produces is
 * `legacy` and every envelope it consumes classifies as `legacy` and is
 * processed byte-for-byte as it was before G5. The classification below is the
 * single place the two worlds diverge, and it diverges only for envelopes that
 * actually declare a version.
 *
 * THE TRUST BOUNDARY
 * ------------------
 * `tenantId` is read from the envelope METADATA the producer stamped, never from
 * the caller-facing payload. A producer stamps it from an authenticated context
 * or a loaded resource's persisted ownership; a consumer trusts that stamp and
 * refuses to fall back to any payload-carried tenant claim. `classifyEnvelope`
 * takes `EventMetadata`, not payload, precisely so a payload field named
 * `tenantId` can never reach this decision.
 */

import type { EventMetadata } from './types';

/**
 * The envelope version this build produces and understands.
 *
 * Bump — and add the old value to {@link KNOWN_ENVELOPE_VERSIONS} only if this
 * build can still process it — when the envelope's tenant-relevant shape
 * changes. A consumer that meets a version it does not know quarantines rather
 * than guesses, which is the whole point of carrying the number.
 */
export const CURRENT_ENVELOPE_VERSION = 1;

/** Every envelope version THIS build is able to process. */
export const KNOWN_ENVELOPE_VERSIONS: ReadonlySet<number> = new Set([CURRENT_ENVELOPE_VERSION]);

/**
 * RFC 4122 shape. A fail-closed guard, not an injection guard: a producer must
 * not be able to stamp — and a consumer must not accept — a `tenantId` that is
 * not a well-formed tenant identifier. Mirrors the shape `tenant-transaction.ts`
 * enforces at the DB boundary, kept local so `@omni/core` does not depend on
 * `@omni/api`.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EnvelopeQuarantineReason =
  /** A version marker this build does not recognise. */
  | 'unknown_version'
  /** A versioned envelope carrying no tenant at all. */
  | 'missing_tenant'
  /** A versioned envelope whose tenant is not a well-formed UUID. */
  | 'invalid_tenant'
  /** A tenant claim with no version marker — not legacy (legacy carries none). */
  | 'malformed_envelope';

/**
 * The three worlds a consumer must tell apart before it touches an event.
 *
 *   * `legacy`     — no version, no tenant: pre-G5 / flag-off. Process as today.
 *   * `tenant`     — a known version with a valid trusted tenant: establish the
 *                    worker tenant context from `tenantId` and process.
 *   * `quarantine` — a version this build cannot honour, or a tenant that is
 *                    missing/ambiguous/forged: route to quarantine/DLQ + alert,
 *                    never process. There is NO global-processing fallback.
 */
export type EnvelopeClassification =
  | { readonly world: 'legacy' }
  | { readonly world: 'tenant'; readonly tenantId: string; readonly envelopeVersion: number }
  | { readonly world: 'quarantine'; readonly reason: EnvelopeQuarantineReason };

/**
 * Classify an inbound envelope from its stamped metadata.
 *
 * Reads ONLY the producer-stamped `envelopeVersion`/`tenantId`. Never consults
 * the payload — the trust boundary is that a tenant is derived by the producer,
 * not asserted by whatever data the event carries.
 */
export function classifyEnvelope(metadata: EventMetadata | null | undefined): EnvelopeClassification {
  // An envelope with NO metadata object at all carries no version and no tenant
  // — which is precisely the definition of `legacy`, not of a corruption. It is
  // deliberately not quarantined: quarantine is for a versioned envelope whose
  // tenant is missing/ambiguous, or a tenant claim with no version contract, and
  // this is neither. Throwing here would let one shapeless message kill a
  // consumer outright, which is a strictly worse failure than processing it on
  // the same legacy path it took before G5.
  if (metadata === null || metadata === undefined) return { world: 'legacy' };

  const { envelopeVersion, tenantId } = metadata;

  if (envelopeVersion === undefined || envelopeVersion === null) {
    // A legacy envelope carries NEITHER field. A tenant claim without the
    // version contract is a corruption/forgery, not a legacy message, so it is
    // refused rather than processed as-today.
    if (tenantId !== undefined && tenantId !== null) {
      return { world: 'quarantine', reason: 'malformed_envelope' };
    }
    return { world: 'legacy' };
  }

  if (typeof envelopeVersion !== 'number' || !KNOWN_ENVELOPE_VERSIONS.has(envelopeVersion)) {
    return { world: 'quarantine', reason: 'unknown_version' };
  }

  if (tenantId === undefined || tenantId === null || tenantId === '') {
    return { world: 'quarantine', reason: 'missing_tenant' };
  }
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) {
    return { world: 'quarantine', reason: 'invalid_tenant' };
  }

  return { world: 'tenant', tenantId, envelopeVersion };
}

/**
 * Stamp a trusted tenant onto an envelope's metadata (returns a new object;
 * never mutates the input).
 *
 * @throws when `tenantId` is not a well-formed UUID — a producer cannot stamp a
 *   tenant it could not have derived from a real resource, which is what keeps a
 *   bogus claim from ever entering the wire.
 */
export function stampTenantEnvelope(metadata: EventMetadata, tenantId: string): EventMetadata {
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) {
    throw new Error(`stampTenantEnvelope: refusing to stamp a non-UUID tenant (${String(tenantId)})`);
  }
  return { ...metadata, envelopeVersion: CURRENT_ENVELOPE_VERSION, tenantId };
}

/** Whether `tenantId` is a value a producer may stamp / a consumer may trust. */
export function isStampableTenantId(tenantId: unknown): tenantId is string {
  return typeof tenantId === 'string' && UUID.test(tenantId);
}

/**
 * Injectable seam so `@omni/core`'s publisher can stamp the request's tenant
 * WITHOUT depending on `@omni/api`, where the per-request tenant scope
 * (`AsyncLocalStorage`) actually lives. The API layer registers a resolver that
 * returns `currentTenantScope()?.tenantId`; a flag-off deployment registers
 * nothing, so publishes stamp nothing and stay legacy/byte-identical.
 *
 * This carries a REQUEST-originated tenant to the envelope. It is deliberately
 * NOT a fallback for worker/consumer publishes — those must pass an explicit
 * `metadata.tenantId` derived from the loaded resource, never inherit an ambient
 * one, which is the G4 leg-2 cross-context trap the worker-context module
 * guards against.
 */
let ambientTenantResolver: (() => string | null | undefined) | null = null;

export function setEnvelopeTenantResolver(resolver: (() => string | null | undefined) | null): void {
  ambientTenantResolver = resolver;
}

export function resolveAmbientTenantId(): string | null {
  if (!ambientTenantResolver) return null;
  try {
    const tenantId = ambientTenantResolver();
    return isStampableTenantId(tenantId) ? tenantId : null;
  } catch {
    return null;
  }
}

/**
 * The PLUGIN-PRODUCER seam (G5, ADR-0008).
 *
 * The resolver above carries a REQUEST-originated tenant. The dominant traffic
 * path has no request: `BaseChannelPlugin.publishEventInternal` emits
 * `message.received`, `instance.connected`, `reaction.*` and friends from a
 * socket callback, so without this seam every real channel event stamps nothing
 * and classifies `legacy` — and the consumers G5 converted never enter the
 * tenant world at all.
 *
 * ADR-0008 names the derivation for exactly this case: "Publishers derive tenant
 * from authenticated/LOADED RESOURCES, never caller claims", and this module's
 * subject rationale above already relies on it — instances carry their tenant
 * (G2, `instances.tenant_id`), so a publish that names an instance can derive
 * that instance's PERSISTED owner.
 *
 * The API layer registers a resolver backed by an ownership registry populated
 * from `instances` rows it has already loaded (startup reconnect, instance
 * create/update, the monitor's per-instance fetch). It is deliberately
 * SYNCHRONOUS: a publish must not grow a database round trip, and the mapping is
 * immutable in practice — an instance's tenant is its ownership ROOT and does
 * not change. Tenant SUSPENSION is not this seam's job; it is enforced at
 * dequeue and before side effects (`isTenantWorkAdmissible`).
 *
 * Flag-off nothing registers, so this returns null and every envelope stays
 * legacy/byte-identical — the same dual-world shape as the ambient resolver.
 */
let instanceOwnerTenantResolver: ((instanceId: string) => string | null | undefined) | null = null;

export function setEnvelopeInstanceTenantResolver(
  resolver: ((instanceId: string) => string | null | undefined) | null,
): void {
  instanceOwnerTenantResolver = resolver;
}

export function resolveInstanceOwnerTenantId(instanceId: string | undefined | null): string | null {
  if (!instanceOwnerTenantResolver || !instanceId) return null;
  try {
    const tenantId = instanceOwnerTenantResolver(instanceId);
    return isStampableTenantId(tenantId) ? tenantId : null;
  } catch {
    // A broken registry must degrade to `legacy` — never fail the publish, and
    // never fall through to something less trustworthy.
    return null;
  }
}

/**
 * The single decision every publisher makes about which tenant to stamp.
 *
 * Precedence, most-trusted first:
 *   1. `explicitTenantId` — a worker/consumer republish that already derived the
 *      tenant from ITS OWN loaded resource or consumed envelope. A non-UUID
 *      value is not a claim this function honours; it falls through rather than
 *      poisoning the envelope.
 *   2. the REQUEST scope — the authenticated caller's tenant, which the edge
 *      validated before the handler ran.
 *   3. the INSTANCE OWNER registry — the plugin/worker case, derived from the
 *      instance's persisted ownership.
 *
 * Returns null when none applies: the envelope then carries neither field and is
 * `legacy`, exactly as before G5.
 */
export function resolvePublishTenantId(
  explicitTenantId: unknown,
  instanceId: string | undefined | null,
): string | null {
  if (isStampableTenantId(explicitTenantId)) return explicitTenantId;
  return resolveAmbientTenantId() ?? resolveInstanceOwnerTenantId(instanceId);
}
