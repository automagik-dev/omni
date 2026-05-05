/**
 * Legacy artifact cleanup registry.
 *
 * Generalizes the bespoke `cleanupSidecars()` step in `omni update` into a
 * registry of `LegacyArtifact` entries so future deprecation cleanups (e.g.
 * obsolete WhatsApp baileys session formats, dead pm2 process names, stale
 * config files) drop in without code changes to the update orchestration.
 *
 * The day-one entry is `nats-reply-sidecar`, which wraps the existing
 * `cleanupSidecars()` / `cleanupSucceeded()` / `formatCleanupSummary()`
 * helpers in `sidecar-cleanup.ts`. Operator-facing output is byte-identical
 * to the pre-registry behavior — the registry only changes the dispatch.
 *
 * Public shape mirrors the genie wish (independent code, identical signature
 * per SHARED-DESIGN.md decision #3).
 */

import {
  type CleanupResult as SidecarCleanupResult,
  cleanupSidecars,
  formatCleanupSummary as formatSidecarSummary,
} from './sidecar-cleanup.js';

/**
 * One legacy artifact eligible for cleanup. Implementations are stateful:
 * `cleanup()` may stash the raw result so `summary()` can render it.
 */
export interface LegacyArtifact {
  readonly name: string;
  /**
   * Best-effort fast probe — return true if cleanup() should be run. Returning
   * false is reserved for hard short-circuits (e.g. the artifact's namespace
   * doesn't exist on this OS). If detection itself is cheap relative to
   * cleanup, implementations may simply return true and let the empty-case
   * path in cleanup() produce an empty summary.
   */
  detect(): Promise<boolean>;
  /**
   * Run the cleanup. Returns the user-visible artifacts (`removed`) and any
   * non-fatal problems (`warnings`). Implementations should never throw —
   * the registry treats a thrown error as "warning, succeeded=false".
   */
  cleanup(): Promise<{ removed: string[]; warnings: string[] }>;
  /**
   * Human-readable multi-line summary of the most recent cleanup() call.
   * Empty string when nothing happened (so the caller can suppress the block).
   */
  summary(): string;
}

/**
 * Per-artifact outcome captured in the report.
 */
export interface ArtifactOutcome {
  readonly name: string;
  readonly state: 'ran' | 'skipped' | 'not-detected' | 'errored';
  readonly removed: string[];
  readonly warnings: string[];
  readonly summary: string;
  readonly error?: string;
}

/**
 * Aggregate cleanup outcome across the registry. Consumed by diagnostics
 * (Group 4) and by the update banner ("warn loudly when a cleanup partially
 * failed").
 */
export interface CleanupReport {
  readonly outcomes: ArtifactOutcome[];
  /** True iff every ran artifact reported zero warnings AND nothing errored. */
  readonly succeeded: boolean;
  /** Names that were skipped via `skipList`. */
  readonly skipped: string[];
}

/**
 * Build the day-one nats-reply-sidecar artifact. Wraps the existing
 * sidecar-cleanup module without modifying its public API.
 *
 * `detect()` always returns true — the underlying `cleanupSidecars()` is
 * idempotent and produces an empty `formatCleanupSummary()` when nothing is
 * present, which is exactly the byte-identical "no sidecars found" path the
 * acceptance criteria require.
 */
function createNatsReplySidecarArtifact(): LegacyArtifact {
  let lastResult: SidecarCleanupResult | null = null;

  return {
    name: 'nats-reply-sidecar',
    async detect() {
      return true;
    },
    async cleanup() {
      const result = await cleanupSidecars();
      lastResult = result;

      const removed: string[] = [];
      const warnings: string[] = [];

      for (const m of result.pm2Stopped) {
        removed.push(`pm2:${m.name.length > 0 ? m.name : `pm_id=${m.pmId}`}`);
      }
      for (const m of result.rawKilled) {
        removed.push(`pid:${m.pid}`);
      }
      for (const m of result.pm2Failed) {
        warnings.push(`pm2-failed:${m.name.length > 0 ? m.name : `pm_id=${m.pmId}`}`);
      }
      for (const m of result.rawFailed) {
        warnings.push(`raw-failed:pid=${m.pid}`);
      }

      return { removed, warnings };
    },
    summary() {
      return lastResult === null ? '' : formatSidecarSummary(lastResult);
    },
  };
}

/**
 * The live registry. Order matters — artifacts run sequentially so an earlier
 * cleanup's side effects are visible to a later one (e.g. stopping a process
 * before deleting its config file).
 *
 * To add a new artifact:
 *   1. Implement `LegacyArtifact` (idempotent, never-throws).
 *   2. Append a factory call below.
 *   3. Add a unit test that runs the registry round-trip.
 *   4. Document the deprecation in `docs/migration/`.
 */
export const REGISTRY: LegacyArtifact[] = [createNatsReplySidecarArtifact()];

/**
 * Run every registry entry whose name is not in `skipList`. Never throws —
 * an artifact whose `detect()` or `cleanup()` rejects is recorded as
 * `state: 'errored'` and contributes a warning to the aggregate report.
 *
 * Returns a `CleanupReport` capturing what ran, what was skipped, and the
 * per-artifact summaries. The caller decides how to render them (typically
 * `console.log(outcome.summary)` for each `state === 'ran'`).
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function erroredOutcome(name: string, phase: 'detect' | 'cleanup', error: unknown): ArtifactOutcome {
  const message = errorMessage(error);
  return {
    name,
    state: 'errored',
    removed: [],
    warnings: [`${phase}-threw:${message}`],
    summary: '',
    error: message,
  };
}

async function runArtifact(artifact: LegacyArtifact): Promise<ArtifactOutcome> {
  let detected: boolean;
  try {
    detected = await artifact.detect();
  } catch (error) {
    return erroredOutcome(artifact.name, 'detect', error);
  }

  if (!detected) {
    return {
      name: artifact.name,
      state: 'not-detected',
      removed: [],
      warnings: [],
      summary: '',
    };
  }

  try {
    const { removed, warnings } = await artifact.cleanup();
    return {
      name: artifact.name,
      state: 'ran',
      removed,
      warnings,
      summary: artifact.summary(),
    };
  } catch (error) {
    return erroredOutcome(artifact.name, 'cleanup', error);
  }
}

export async function cleanupLegacyArtifacts(skipList: Set<string>): Promise<CleanupReport> {
  const outcomes: ArtifactOutcome[] = [];
  const skipped: string[] = [];

  for (const artifact of REGISTRY) {
    if (skipList.has(artifact.name)) {
      skipped.push(artifact.name);
      outcomes.push({
        name: artifact.name,
        state: 'skipped',
        removed: [],
        warnings: [],
        summary: '',
      });
      continue;
    }

    outcomes.push(await runArtifact(artifact));
  }

  const succeeded = outcomes.every((o) => o.state !== 'errored' && (o.state !== 'ran' || o.warnings.length === 0));

  return { outcomes, succeeded, skipped };
}
