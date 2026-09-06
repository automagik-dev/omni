/**
 * Envelope construction for event publishing.
 *
 * Extracted from `NatsEventBus.publishInternal` so the metadata defaulting
 * (correlation self-reference for roots, tenant stamping, source fallback) has
 * exactly one implementation — the NATS bus and any in-memory bus used by
 * integration tests build byte-identical envelopes. See issue #956: the
 * correlation-chain guarantees only hold if every publisher shares this
 * defaulting.
 */

import { currentEventCausality } from './causality';
import { CURRENT_ENVELOPE_VERSION, resolvePublishTenantId } from './envelope';
import type { EventMetadata, EventType, OmniEvent } from './types';

/**
 * Build a complete OmniEvent envelope from a publish call's inputs.
 *
 * Defaulting rules:
 *   - `id` is freshly minted per publish.
 *   - `correlationId` falls back to the ambient causality context (#957 — a
 *     publish made while reacting to an event continues that event's flow),
 *     then to the event's own id — a publish with neither is a ROOT and
 *     self-references.
 *   - `causationId` (#957): explicit metadata wins, then the ambient
 *     causality context (the event being reacted to); omitted entirely when
 *     neither exists, keeping root envelopes byte-identical to pre-#957.
 *   - `traceId` falls back to the event's own id.
 *   - tenant stamping follows `resolvePublishTenantId` (G5, ADR-0008): both
 *     envelope fields or neither.
 */
export function createOmniEvent(
  type: EventType,
  payload: unknown,
  metadata: Partial<EventMetadata> | undefined,
  serviceName: string,
): OmniEvent {
  const eventId = crypto.randomUUID();
  const timestamp = Date.now();

  // Versioned tenant-aware envelope (G5, ADR-0008). One decision, three
  // sources in trust order — explicit republish tenant, then the request
  // scope, then the named instance's PERSISTED owner (the channel-plugin
  // producer path, which has neither of the first two). When none yields a
  // tenant — every flag-off publish, and every publish naming no known
  // instance — both fields stay undefined and the envelope is `legacy`, i.e.
  // byte-identical to pre-G5.
  const tenantId = resolvePublishTenantId(metadata?.tenantId, metadata?.instanceId);
  const ambient = currentEventCausality();
  const causationId = metadata?.causationId ?? ambient?.causationId;

  return {
    id: eventId,
    type,
    payload,
    timestamp,
    metadata: {
      correlationId: metadata?.correlationId ?? ambient?.correlationId ?? eventId,
      ...(causationId ? { causationId } : {}),
      instanceId: metadata?.instanceId,
      channelType: metadata?.channelType,
      personId: metadata?.personId,
      platformIdentityId: metadata?.platformIdentityId,
      traceId: metadata?.traceId ?? eventId,
      source: metadata?.source ?? serviceName,
      ingestMode: metadata?.ingestMode,
      timings: metadata?.timings,
      ...(tenantId ? { envelopeVersion: CURRENT_ENVELOPE_VERSION, tenantId } : {}),
    },
  };
}
