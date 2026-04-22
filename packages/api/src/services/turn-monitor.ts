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
 */

import { createLogger } from '@omni/core';
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
      // Get all turns idle for at least NUDGE_THRESHOLD_MS (the lowest threshold)
      const staleTurns = await this.deps.turnService.getStale(NUDGE_THRESHOLD_MS);

      for (const turn of staleTurns) {
        const idleMs = Date.now() - turn.lastActivityAt.getTime();
        const idleSec = Math.round(idleMs / 1000);

        // Force-close at TIMEOUT_THRESHOLD_MS
        if (idleMs >= TIMEOUT_THRESHOLD_MS) {
          await this.handleTimeout(turn.id, turn.instanceId, turn.chatId, idleSec, turn.nudgeCount);
          continue;
        }

        // Per-instance stalled-timeout config (live — re-read every tick, no caching).
        const instance = await this.deps.instanceService.getById(turn.instanceId).catch(() => null);
        const stalledThresholdMs = instance?.agentStalledTimeoutMs ?? DEFAULT_STALLED_THRESHOLD_MS;

        // Emit internal turn.stalled event once — when nudgeCount is exactly 2 and idle crosses the per-instance threshold
        if (idleMs >= stalledThresholdMs && turn.nudgeCount === 2) {
          await this.handleStalled(turn.id, turn.instanceId, turn.chatId, idleMs, stalledThresholdMs);
          continue;
        }

        // Nudge at 120s intervals (nudgeCount 0 → nudge 1, nudgeCount 1 → nudge 2)
        // Only nudge if idle exceeds the threshold for the *next* nudge
        const expectedNudges = Math.floor(idleMs / NUDGE_THRESHOLD_MS);
        if (turn.nudgeCount < expectedNudges && turn.nudgeCount < 2) {
          await this.handleNudge(turn.id, turn.instanceId, turn.chatId, idleSec, turn.nudgeCount + 1);
        }
      }
    } catch (error) {
      log.error('Turn monitor tick failed', { error: String(error) });
    } finally {
      this.running = false;
    }
  }

  private async handleNudge(
    turnId: string,
    instanceId: string,
    chatId: string,
    idleSec: number,
    nudgeCount: number,
  ): Promise<void> {
    await this.deps.turnService.incrementNudge(turnId);

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
  ): Promise<void> {
    // Increment nudge count to 3 to mark stalled as emitted so we never retry.
    await this.deps.turnService.incrementNudge(turnId);

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
  ): Promise<void> {
    const closed = await this.deps.turnService.close(turnId, {
      action: 'timeout',
      reason: `Idle for ${idleSec}s`,
    });

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
