/**
 * Health check runner for channel plugins
 *
 * Periodically checks plugin health and aggregates status.
 */

import type { Logger } from '../types/context';
import type { HealthCheck, HealthStatus } from '../types/plugin';

/**
 * Health checker for monitoring plugin health
 */
export class HealthChecker {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastStatus: HealthStatus | null = null;
  private logger: Logger;
  private getHealth: () => Promise<HealthStatus>;

  constructor(options: {
    logger: Logger;
    getHealth: () => Promise<HealthStatus>;
  }) {
    this.logger = options.logger;
    this.getHealth = options.getHealth;
  }

  /**
   * Start periodic health checks
   *
   * @param intervalMs - Interval between checks in milliseconds
   */
  start(intervalMs = 30000): void {
    if (this.intervalId) {
      this.stop();
    }

    // Run initial check
    this.runCheck().catch((err) => {
      this.logger.error('Initial health check failed', { error: String(err) });
    });

    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      this.runCheck().catch((err) => {
        this.logger.error('Health check failed', { error: String(err) });
      });
    }, intervalMs);
  }

  /**
   * Stop periodic health checks
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Run a health check now
   */
  async runCheck(): Promise<HealthStatus> {
    try {
      this.lastStatus = await this.getHealth();
      this.logHealthChange();
      return this.lastStatus;
    } catch (error) {
      this.lastStatus = {
        status: 'unhealthy',
        message: `Health check error: ${String(error)}`,
        checks: [],
        checkedAt: new Date(),
      };
      this.logger.error('Health check threw an error', { error: String(error) });
      return this.lastStatus;
    }
  }

  /**
   * Get the last health status without running a check
   */
  getLastStatus(): HealthStatus | null {
    return this.lastStatus;
  }

  /**
   * Log health status changes
   */
  private logHealthChange(): void {
    if (!this.lastStatus) return;

    const level = this.lastStatus.status === 'healthy' ? 'debug' : 'warn';
    this.logger[level](`Health check: ${this.lastStatus.status}`, {
      status: this.lastStatus.status,
      checks: this.lastStatus.checks.map((c) => ({ name: c.name, status: c.status })),
    });
  }
}

/**
 * Aggregate multiple health checks into a single status
 */
export function aggregateHealthChecks(checks: HealthCheck[]): 'healthy' | 'degraded' | 'unhealthy' {
  if (checks.length === 0) return 'healthy';

  const hasFailure = checks.some((c) => c.status === 'fail');
  const hasWarning = checks.some((c) => c.status === 'warn');

  if (hasFailure) return 'unhealthy';
  if (hasWarning) return 'degraded';
  return 'healthy';
}

/**
 * Create a health check result
 */
export function createHealthCheck(
  name: string,
  status: 'pass' | 'warn' | 'fail',
  message?: string,
  data?: Record<string, unknown>,
): HealthCheck {
  return { name, status, message, data };
}
