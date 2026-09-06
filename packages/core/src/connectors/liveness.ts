/**
 * Connector liveness sweeper — supervises the connector CONTRACT, not the
 * connector process (#961). A source that declares a cadence promises
 * "≥1 event or heartbeat per N seconds"; the sweeper turns silence beyond
 * that window into a `system.connector.stalled` event and a visible unhealthy
 * state, and the next signal back into `system.connector.recovered`.
 *
 * Invoked by the API's in-process `Scheduler`. This module is pure logic:
 * data access is injected via `ConnectorLivenessRepo` (follow-up sweeper
 * precedent) so the core package stays free of `@omni/db` and the transition
 * semantics are trivial to unit test.
 *
 * Emitted-once guarantee: the repo persists a transition with a guarded
 * update (`WHERE liveness_status = <previous>`) BEFORE the event is
 * published. An already-stalled row is skipped, a lost guard race publishes
 * nothing, and overlapping ticks can never double-publish. A crash between
 * the mark and the publish loses at most one event while the persisted
 * status still tells the truth in list/API — the right failure mode for an
 * alerting signal that must not spam.
 */

import type { EventBus } from '../events/bus';
import type { Logger } from '../logger';

/**
 * Liveness state of a supervised source. Kept in sync with:
 *   - `packages/db/src/schema.ts` → `connectorLivenessStatuses` const tuple
 */
export type ConnectorLivenessState = 'healthy' | 'stalled';

/** Which signal last reset the liveness window. */
export type ConnectorSignalKind = 'event' | 'heartbeat' | 'rearmed';

/**
 * Supervised source row as the sweeper understands it. Independent of the
 * Drizzle row shape so the core module stays DB-agnostic.
 */
export interface ConnectorLivenessRow {
  id: string;
  name: string;
  /** Declared cadence — rows without one are not returned by `findSupervised`. */
  expectedIntervalSeconds: number;
  lastReceivedAt: Date | null;
  lastHeartbeatAt: Date | null;
  /** Stamped when the cadence is (re)declared — the window's starting anchor. */
  livenessArmedAt: Date | null;
  /** NULL is treated as healthy (a cadence declared outside the service path). */
  livenessStatus: ConnectorLivenessState | null;
  /** When the current stall began — set by the stalled transition. */
  stalledAt: Date | null;
  /** Last-resort anchor when no signal or arm timestamp exists. */
  createdAt: Date;
  /** Trusted tenant of the row; stamps the published envelope when present. */
  tenantId?: string | null;
}

/**
 * Data-access contract implemented by the API layer (`WebhookService`, the
 * one sanctioned `webhook_sources` accessor per the tenancy DB-access guard).
 */
export interface ConnectorLivenessRepo {
  /** All enabled sources with a declared cadence. */
  findSupervised(): Promise<ConnectorLivenessRow[]>;
  /**
   * Persist healthy→stalled with a guarded update (only when not already
   * stalled). Returns true iff THIS call performed the transition.
   */
  markStalled(id: string, at: Date): Promise<boolean>;
  /**
   * Persist stalled→healthy with a guarded update (only when currently
   * stalled). Returns true iff THIS call performed the transition.
   */
  markRecovered(id: string, at: Date): Promise<boolean>;
}

/** Payload of `system.connector.stalled` (registered in events/nats/registry.ts). */
export interface ConnectorStalledPayload {
  sourceId: string;
  sourceName: string;
  expectedIntervalSeconds: number;
  lastReceivedAt: number | null;
  lastHeartbeatAt: number | null;
  silentForSeconds: number;
  stalledAt: number;
}

/** Payload of `system.connector.recovered` (registered in events/nats/registry.ts). */
export interface ConnectorRecoveredPayload {
  sourceId: string;
  sourceName: string;
  expectedIntervalSeconds: number;
  stalledForSeconds: number;
  recoveredBy: ConnectorSignalKind;
  recoveredAt: number;
}

/**
 * Dependencies for a single sweep invocation.
 */
export interface ConnectorLivenessDeps {
  repo: ConnectorLivenessRepo;
  eventBus: Pick<EventBus, 'publishGeneric'> | null;
  logger: Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>;
  /** Override the wall clock — used in tests. */
  now?: () => Date;
  /**
   * Ops surfacing hook, invoked after a stalled transition is persisted and
   * published (the API layer files the DLQ entry here). `publishedEventId` is
   * null when there is no bus. Hook failures are logged, never fatal.
   */
  onStalled?: (
    row: ConnectorLivenessRow,
    payload: ConnectorStalledPayload,
    publishedEventId: string | null,
  ) => Promise<void>;
  /** Counterpart of `onStalled` — the API layer resolves the DLQ entry here. */
  onRecovered?: (row: ConnectorLivenessRow, payload: ConnectorRecoveredPayload) => Promise<void>;
}

export interface ConnectorLivenessSweepStats {
  scanned: number;
  stalled: number;
  recovered: number;
  errors: number;
}

/**
 * The most recent signal that resets the liveness window, and what kind it
 * was (drives `recoveredBy`). `livenessArmedAt`/`createdAt` count as signals
 * so a freshly declared cadence gets one full window before it can stall.
 */
export function latestConnectorSignal(row: ConnectorLivenessRow): { at: Date; kind: ConnectorSignalKind } {
  let best: { at: Date; kind: ConnectorSignalKind } = { at: row.createdAt, kind: 'rearmed' };
  const candidates: Array<{ at: Date | null; kind: ConnectorSignalKind }> = [
    { at: row.livenessArmedAt, kind: 'rearmed' },
    { at: row.lastReceivedAt, kind: 'event' },
    { at: row.lastHeartbeatAt, kind: 'heartbeat' },
  ];
  for (const candidate of candidates) {
    if (candidate.at && candidate.at.getTime() >= best.at.getTime()) {
      best = { at: candidate.at, kind: candidate.kind };
    }
  }
  return best;
}

/**
 * Run one sweep tick over every supervised source. Safe to call concurrently:
 * the repo's guarded transitions make each transition single-winner.
 */
export async function sweepConnectorLiveness(deps: ConnectorLivenessDeps): Promise<ConnectorLivenessSweepStats> {
  const clock = deps.now ?? (() => new Date());
  const now = clock();

  const rows = await deps.repo.findSupervised();
  const stats: ConnectorLivenessSweepStats = { scanned: rows.length, stalled: 0, recovered: 0, errors: 0 };

  for (const row of rows) {
    try {
      await processRow(row, now, deps, stats);
    } catch (err) {
      stats.errors += 1;
      deps.logger.error('connector liveness: failed to process source', {
        sourceId: row.id,
        sourceName: row.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (stats.stalled > 0 || stats.recovered > 0) {
    deps.logger.info('connector liveness sweep tick', { ...stats });
  }
  return stats;
}

async function processRow(
  row: ConnectorLivenessRow,
  now: Date,
  deps: ConnectorLivenessDeps,
  stats: ConnectorLivenessSweepStats,
): Promise<void> {
  const signal = latestConnectorSignal(row);
  const silentForSeconds = Math.max(0, Math.round((now.getTime() - signal.at.getTime()) / 1000));
  const overdue = silentForSeconds > row.expectedIntervalSeconds;

  if (overdue) {
    if (row.livenessStatus === 'stalled') return; // transition already announced
    if (!(await deps.repo.markStalled(row.id, now))) return; // concurrent tick won the guard

    const payload: ConnectorStalledPayload = {
      sourceId: row.id,
      sourceName: row.name,
      expectedIntervalSeconds: row.expectedIntervalSeconds,
      lastReceivedAt: row.lastReceivedAt?.getTime() ?? null,
      lastHeartbeatAt: row.lastHeartbeatAt?.getTime() ?? null,
      silentForSeconds,
      stalledAt: now.getTime(),
    };
    const eventId = await publishTransition(deps, 'system.connector.stalled', { ...payload }, row);
    stats.stalled += 1;
    await runHook(deps.logger, 'onStalled', row, () => deps.onStalled?.(row, payload, eventId));
    return;
  }

  if (row.livenessStatus === 'stalled') {
    if (!(await deps.repo.markRecovered(row.id, now))) return;

    const stalledSince = row.stalledAt ?? signal.at;
    const payload: ConnectorRecoveredPayload = {
      sourceId: row.id,
      sourceName: row.name,
      expectedIntervalSeconds: row.expectedIntervalSeconds,
      stalledForSeconds: Math.max(0, Math.round((now.getTime() - stalledSince.getTime()) / 1000)),
      recoveredBy: signal.kind,
      recoveredAt: now.getTime(),
    };
    await publishTransition(deps, 'system.connector.recovered', { ...payload }, row);
    stats.recovered += 1;
    await runHook(deps.logger, 'onRecovered', row, () => deps.onRecovered?.(row, payload));
  }
}

async function publishTransition(
  deps: ConnectorLivenessDeps,
  type: 'system.connector.stalled' | 'system.connector.recovered',
  payload: Record<string, unknown>,
  row: ConnectorLivenessRow,
): Promise<string | null> {
  if (!deps.eventBus) {
    deps.logger.warn('connector liveness: no event bus, transition persisted without event', {
      type,
      sourceName: row.name,
    });
    return null;
  }
  const result = await deps.eventBus.publishGeneric(type, payload, {
    source: 'connector-liveness',
    ...(row.tenantId ? { tenantId: row.tenantId } : {}),
  });
  return result.id;
}

async function runHook(
  logger: ConnectorLivenessDeps['logger'],
  name: string,
  row: ConnectorLivenessRow,
  hook: () => Promise<void> | undefined,
): Promise<void> {
  try {
    await hook();
  } catch (err) {
    logger.error(`connector liveness: ${name} hook failed`, {
      sourceId: row.id,
      sourceName: row.name,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
