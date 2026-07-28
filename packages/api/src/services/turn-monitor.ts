/**
 * Turn monitor — polls for stale turns and emits lifecycle events.
 *
 * Runs on a 10-second interval:
 *   - 120s idle  → emit nudge (first)
 *   - 240s idle  → emit nudge (second)
 *   - agentStalledTimeoutMs idle (default 600s) → emit internal `turn.stalled` event
 *   - 1800s idle → force-close turn, emit timeout event
 *
 * Activity = any API call from the scoped key (tracked via auth middleware).
 *
 * Diagnostic messages MUST NEVER be sent to the user channel. Stalled turns are
 * surfaced as internal `turn.stalled` NATS events that downstream consumers
 * (ops dashboards, alerting) can subscribe to. There is no channel fallback.
 *
 * Instance config loading strategy:
 *   Per-instance stalled-timeout config (`agentStalledTimeoutMs`) is re-read at
 *   the start of every tick via `instanceService.getById()` — it is NOT cached.
 *   A CLI change takes effect on the next tick without requiring a serve restart.
 *
 * WORKER TENANT CONTEXT (wish: omni-full-multitenancy, G5; ADR-0008)
 * ------------------------------------------------------------------
 * This monitor is an INTERVAL: it has no request, no credential and no envelope,
 * so nothing hands it a tenant. Before this conversion every tick read the whole
 * `turns` table and then called `instanceService.getById`, `incrementNudge` and
 * `close` on the ambient pool — the unscoped worker caller that kept both
 * `services/instances.ts::instances` and `services/turns.ts::turns` in
 * `pending-G5-conversion`.
 *
 * It now adopts the same fan-out the daily sync crons use
 * (`periodic-tenant-work.ts` `runForEachActiveTenantRow`), which is the shape
 * for "list the active rows, then act on each" periodic work:
 *
 *   * the stale-turn READ runs once per ACTIVE tenant inside that tenant's
 *     worker scope — under RLS enforcement a global scan is not expressible, so
 *     a cron must ENUMERATE whose work exists rather than scan and sort out
 *     ownership afterwards. A suspended tenant drops out of the enumeration, so
 *     its turns stop being swept at the next tick (dequeue-time revalidation at
 *     cron cadence);
 *   * each per-turn action then opens its OWN short scope (`runTenantWorkDb`)
 *     for its DB block, because the actions PUBLISH `turn.*` events and a worker
 *     transaction held across a publish would make the event a pre-commit side
 *     effect. The scope's lifetime is exactly one DB block, never the work item.
 *
 * THREE WORLDS, and the legacy one is byte-identical: with no `db`/`authPlaneDb`
 * wired (the shape every existing test constructs), or with the flag off, the
 * tick is EXACTLY the pre-G5 loop — one ambient `getStale`, no enumeration, not
 * one additional query.
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { runForEachActiveTenantRow } from '../tenancy/periodic-tenant-work';
import { runTenantWorkDb } from '../tenancy/worker-tenant-context';
import type { InstanceService } from './instances';
import { publishTurnDone, publishTurnNudge, publishTurnStalled, publishTurnTimeout } from './turn-events';
import type { TurnService } from './turns';

const log = createLogger('turn-monitor');

/** Inactivity thresholds in milliseconds */
const NUDGE_THRESHOLD_MS = 120_000; // 120s
const DEFAULT_STALLED_THRESHOLD_MS = 600_000; // 600s (10 min)
const TIMEOUT_THRESHOLD_MS = 1_800_000; // 1800s (30 min)

/** Polling interval */
const POLL_INTERVAL_MS = 10_000; // 10s

export interface TurnMonitorDeps {
  turnService: TurnService;
  /** Instance service for per-instance stalled-timeout config lookup (live, not cached). */
  instanceService: InstanceService;
  /**
   * The runtime pool the per-tenant worker scopes open transactions on.
   *
   * OPTIONAL, and its absence is the legacy world: with no `db` the tick runs
   * the pre-G5 ambient pass unchanged. Wiring it (and `authPlaneDb`) is what
   * opts this monitor into the tenant fan-out.
   */
  db?: Database;
  /**
   * The auth-plane read connection (`services.authPlane.db`) — per ADR-0003 the
   * only runtime-process identity that may enumerate `tenants`.
   */
  authPlaneDb?: Database;
  /** Environment used for the flag/enforcement decisions. Tests override it. */
  env?: NodeJS.ProcessEnv;
}

export class TurnMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private deps: TurnMonitorDeps) {}

  /**
   * Start the monitor polling loop.
   */
  start(): void {
    if (this.intervalId) return;

    log.info('Turn monitor started', {
      pollIntervalMs: POLL_INTERVAL_MS,
      nudgeMs: NUDGE_THRESHOLD_MS,
      defaultStalledMs: DEFAULT_STALLED_THRESHOLD_MS,
      timeoutMs: TIMEOUT_THRESHOLD_MS,
    });

    this.intervalId = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  /**
   * Stop the monitor.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      log.info('Turn monitor stopped');
    }
  }

  /**
   * Single tick — check all open turns for staleness.
   */
  private async tick(): Promise<void> {
    if (this.running) return; // Prevent overlapping ticks
    this.running = true;

    try {
      const { db, authPlaneDb } = this.deps;

      // LEGACY WORLD (no pool wired): the pre-G5 pass, statement for statement.
      if (!db || !authPlaneDb) {
        const staleTurns = await this.deps.turnService.getStale(NUDGE_THRESHOLD_MS);
        for (const turn of staleTurns) {
          await this.processTurn(turn, null);
        }
        return;
      }

      // TENANT WORLD: enumerate, scope the read per tenant, act per row outside
      // that read's scope. Flag-off this helper still runs exactly one ambient
      // pass with `tenantId === null`, so the branch above and this one agree.
      await runForEachActiveTenantRow(
        {
          db,
          authPlaneDb,
          jobName: 'turn-monitor',
          listActive: () => this.deps.turnService.getStale(NUDGE_THRESHOLD_MS),
          env: this.deps.env,
        },
        (turn, tenantId) => this.processTurn(turn, tenantId),
      );
    } catch (error) {
      log.error('Turn monitor tick failed', { error: String(error) });
    } finally {
      this.running = false;
    }
  }

  /**
   * One stale turn's staleness decision and action.
   *
   * `tenantId` is the pass's TRUSTED tenant (from the enumeration, matched
   * against the row's own persisted `tenant_id` by the fan-out helper) or null
   * on the legacy path. Every DB block below threads it, so each opens its own
   * short scope and closes before the event publish that follows it.
   *
   * A per-turn failure stays per-turn: one broken turn must not abort the rest
   * of the tenant's sweep, which is also what the pre-G5 loop's outer catch did
   * for the whole tick.
   */
  private async processTurn(
    turn: { id: string; instanceId: string; chatId: string; lastActivityAt: Date; nudgeCount: number },
    tenantId: string | null,
  ): Promise<void> {
    const idleMs = Date.now() - turn.lastActivityAt.getTime();
    const idleSec = Math.round(idleMs / 1000);

    // Force-close at TIMEOUT_THRESHOLD_MS
    if (idleMs >= TIMEOUT_THRESHOLD_MS) {
      await this.handleTimeout(turn.id, turn.instanceId, turn.chatId, idleSec, turn.nudgeCount, tenantId);
      return;
    }

    // Per-instance stalled-timeout config (live — re-read every tick, no caching).
    // This is the `instances` read the conversion exists for: its own short
    // worker scope, closed before anything else happens.
    const instance = await runTenantWorkDb(this.deps.db as never, tenantId, () =>
      this.deps.instanceService.getById(turn.instanceId),
    ).catch(() => null);
    const stalledThresholdMs = instance?.agentStalledTimeoutMs ?? DEFAULT_STALLED_THRESHOLD_MS;

    // Emit internal turn.stalled event once — when nudgeCount is exactly 2 and idle crosses the per-instance threshold
    if (idleMs >= stalledThresholdMs && turn.nudgeCount === 2) {
      await this.handleStalled(turn.id, turn.instanceId, turn.chatId, idleMs, stalledThresholdMs, tenantId);
      return;
    }

    // Nudge at 120s intervals (nudgeCount 0 → nudge 1, nudgeCount 1 → nudge 2)
    // Only nudge if idle exceeds the threshold for the *next* nudge
    const expectedNudges = Math.floor(idleMs / NUDGE_THRESHOLD_MS);
    if (turn.nudgeCount < expectedNudges && turn.nudgeCount < 2) {
      await this.handleNudge(turn.id, turn.instanceId, turn.chatId, idleSec, turn.nudgeCount + 1, tenantId);
    }
  }

  private async handleNudge(
    turnId: string,
    instanceId: string,
    chatId: string,
    idleSec: number,
    nudgeCount: number,
    tenantId: string | null,
  ): Promise<void> {
    await runTenantWorkDb(this.deps.db as never, tenantId, () => this.deps.turnService.incrementNudge(turnId));

    publishTurnNudge(instanceId, chatId, {
      turnId,
      nudgeCount,
      idleSec,
      message: `Turn idle for ${idleSec}s. Are you still working?`,
    });

    log.info('Turn nudge emitted', { turnId, nudgeCount, idleSec });
  }

  private async handleStalled(
    turnId: string,
    instanceId: string,
    chatId: string,
    stalledAtMs: number,
    threshold: number,
    tenantId: string | null,
  ): Promise<void> {
    // Increment nudge count to 3 to mark stalled as emitted so we never retry.
    await runTenantWorkDb(this.deps.db as never, tenantId, () => this.deps.turnService.incrementNudge(turnId));

    const payload = { turnId, instanceId, chatId, stalledAtMs, threshold };

    publishTurnStalled(instanceId, chatId, payload);
    log.warn('Turn stalled — internal event emitted (no channel message sent)', payload);
  }

  private async handleTimeout(
    turnId: string,
    instanceId: string,
    chatId: string,
    idleSec: number,
    nudgeCount: number,
    tenantId: string | null,
  ): Promise<void> {
    const closed = await runTenantWorkDb(this.deps.db as never, tenantId, () =>
      this.deps.turnService.close(turnId, {
        action: 'timeout',
        reason: `Idle for ${idleSec}s`,
      }),
    );

    if (!closed) return;

    const duration = closed.closedAt ? closed.closedAt.getTime() - closed.startedAt.getTime() : idleSec * 1000;

    publishTurnTimeout(instanceId, chatId, {
      turnId,
      duration,
      nudgeCount,
    });

    // Also emit turn.done for consistent lifecycle tracking
    publishTurnDone(instanceId, chatId, {
      turnId,
      action: 'timeout',
      reason: `Idle for ${idleSec}s`,
      duration,
      nudgeCount,
      messagesSent: closed.messagesSent,
    });

    log.info('Turn force-closed (timeout)', { turnId, duration, nudgeCount });
  }
}
