/**
 * Turn monitor — polls for stale turns and emits lifecycle events.
 *
 * Runs on a 10-second interval:
 *   - 60s idle  → emit nudge (first)
 *   - 120s idle → emit nudge (second)
 *   - 300s idle → send fallback message to user ("Still processing...")
 *   - 900s idle → force-close turn, emit timeout event
 *
 * Activity = any API call from the scoped key (tracked via auth middleware).
 */

import { createLogger } from '@omni/core';
import { publishTurnDone, publishTurnNudge, publishTurnTimeout } from './turn-events';
import type { TurnService } from './turns';

const log = createLogger('turn-monitor');

/** Inactivity thresholds in milliseconds */
const NUDGE_THRESHOLD_MS = 60_000; // 60s
const FALLBACK_THRESHOLD_MS = 300_000; // 300s (5 min)
const TIMEOUT_THRESHOLD_MS = 900_000; // 900s (15 min)

/** Polling interval */
const POLL_INTERVAL_MS = 10_000; // 10s

export interface TurnMonitorDeps {
  turnService: TurnService;
  /** Send a fallback message to the user (uses existing send infrastructure) */
  sendFallback?: (instanceId: string, chatId: string, text: string) => Promise<void>;
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
      fallbackMs: FALLBACK_THRESHOLD_MS,
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

        // Force-close at 900s
        if (idleMs >= TIMEOUT_THRESHOLD_MS) {
          await this.handleTimeout(turn.id, turn.instanceId, turn.chatId, idleSec, turn.nudgeCount);
          continue;
        }

        // Send fallback message at 300s (only once — when nudgeCount is exactly 2)
        if (idleMs >= FALLBACK_THRESHOLD_MS && turn.nudgeCount === 2) {
          await this.handleFallback(turn.id, turn.instanceId, turn.chatId, idleSec);
          continue;
        }

        // Nudge at 60s intervals (nudgeCount 0 → nudge 1, nudgeCount 1 → nudge 2)
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

  private async handleFallback(turnId: string, instanceId: string, chatId: string, idleSec: number): Promise<void> {
    // Increment nudge count to 3 to mark fallback as sent
    await this.deps.turnService.incrementNudge(turnId);

    // Send fallback message to the user via existing send infrastructure
    if (this.deps.sendFallback) {
      try {
        await this.deps.sendFallback(instanceId, chatId, '⏱ Still processing your request...');
        log.info('Fallback message sent', { turnId, idleSec });
      } catch (error) {
        log.error('Failed to send fallback message', { turnId, error: String(error) });
      }
    }
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

    // Send a timeout fallback to the user
    const fallbackSent = !!this.deps.sendFallback;
    if (this.deps.sendFallback) {
      try {
        await this.deps.sendFallback(instanceId, chatId, '⏱ Request timed out. Please try again.');
      } catch (error) {
        log.error('Failed to send timeout fallback', { turnId, error: String(error) });
      }
    }

    publishTurnTimeout(instanceId, chatId, {
      turnId,
      duration,
      nudgeCount,
      fallbackSent,
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
