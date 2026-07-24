/**
 * In-flight privileged-work revocation monitor (wish: omni-full-multitenancy,
 * Group G5, deliverable (c); ADR-0006; RELEASE_SLOS
 * `revocation.inflight_privileged_work_revocation_seconds_max: 30`).
 *
 * WHAT PROBLEM THIS SOLVES
 * ------------------------
 * Dequeue-time revalidation (`isTenantWorkAdmissible` at the top of a handler)
 * bounds the gap between REVOCATION and the START of work. It does not bound
 * the gap between revocation and the END of work: a multi-thousand-message
 * sync or a slow batch loop can run for minutes after its single up-front
 * check. The release ceiling says in-flight privileged work must OBSERVE a
 * revocation within 30 seconds — so a long loop needs a re-check cadence, not
 * a one-shot gate.
 *
 * THE CADENCE
 * -----------
 * `assertAdmissible()` is called once per work sub-item (per synced message,
 * per batch row). It is CHEAP by design: it consults the injected clock and
 * only re-queries the auth plane when the recheck interval has elapsed. The
 * interval is HALF the ceiling — the same rationale as the stream-termination
 * sweep cadence: a revocation landing immediately after one check is still
 * caught by the next one, within the ceiling. The first call always checks,
 * which doubles as the dequeue-time revalidation for callers that start their
 * loop with it.
 *
 * FAIL-CLOSED, STICKY
 * -------------------
 * An inadmissible answer throws {@link InflightRevocationError} and the
 * monitor STAYS refused: one work item never resumes after observing its
 * tenant's revocation, even if the tenant is later reinstated — the
 * reinstated tenant's next work item gets a fresh monitor. A check that
 * THROWS (auth plane unreachable) also refuses: silence is not admissibility
 * for privileged work that has already proven it can outlive its gate.
 *
 * DUAL WORLD
 * ----------
 * A null/undefined tenant (legacy/flag-off work) never checks, never queries,
 * never refuses — byte-identical to the pre-G5 loop.
 */

import { createLogger } from '@omni/core';

const log = createLogger('inflight-revocation');

/**
 * Sourced from `RELEASE_SLOS.yaml`
 * `revocation.inflight_privileged_work_revocation_seconds_max`.
 */
export const INFLIGHT_REVOCATION_CEILING_SECONDS = 30;

/** Half the ceiling — see the cadence rationale in the module doc. */
export function resolveInflightRecheckIntervalMs(): number {
  return Math.floor((INFLIGHT_REVOCATION_CEILING_SECONDS * 1000) / 2);
}

export class InflightRevocationError extends Error {
  readonly code = 'inflight_tenant_revoked';
  constructor(tenantId: string) {
    super(`inflight-revocation: tenant ${tenantId} is no longer admissible (suspended/archived/revoked)`);
    this.name = 'InflightRevocationError';
  }
}

export interface InflightRevocationMonitor {
  /**
   * The per-item gate. Cheap between cadence ticks; re-checks admissibility
   * when the interval has elapsed; throws {@link InflightRevocationError}
   * once the tenant is observed inadmissible (and on every call after).
   */
  assertAdmissible(): Promise<void>;
}

export function createInflightRevocationMonitor(options: {
  /** Trusted tenant of the work item; null/undefined = legacy, never checked. */
  tenantId: string | null | undefined;
  /** The admissibility read (`isTenantWorkAdmissible` over the auth plane). */
  check: (tenantId: string) => Promise<boolean>;
  /** Injectable clock for synthetic-time tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Override cadence (tests only). Defaults to half the ceiling. */
  recheckIntervalMs?: number;
}): InflightRevocationMonitor {
  const { tenantId, check } = options;
  const now = options.now ?? Date.now;
  const intervalMs = options.recheckIntervalMs ?? resolveInflightRecheckIntervalMs();

  let lastCheckedAt: number | null = null;
  let refused = false;

  return {
    async assertAdmissible(): Promise<void> {
      if (!tenantId) return; // legacy work — byte-identical, zero queries
      if (refused) throw new InflightRevocationError(tenantId);

      const at = now();
      if (lastCheckedAt !== null && at - lastCheckedAt < intervalMs) return;

      let admissible = false;
      try {
        admissible = await check(tenantId);
      } catch (error) {
        // Fail closed: privileged work that cannot verify its tenant stops.
        log.warn('Admissibility check failed — refusing in-flight work', {
          tenantId,
          error: String(error),
        });
        admissible = false;
      }
      lastCheckedAt = at;

      if (!admissible) {
        refused = true;
        throw new InflightRevocationError(tenantId);
      }
    },
  };
}
