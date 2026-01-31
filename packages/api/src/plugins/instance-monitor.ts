/**
 * Instance Monitor
 *
 * Provides robustness features for channel instances:
 * - Health monitoring with periodic checks
 * - Automatic reconnection with exponential backoff
 * - Connection pooling to limit concurrent operations
 */

import type { ChannelRegistry } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import { instances } from '@omni/db';
import { eq } from 'drizzle-orm';

import { createLogger } from './logger';

const logger = createLogger({ module: 'instance-monitor' });

// ============================================================================
// Configuration
// ============================================================================

export interface MonitorConfig {
  /** Health check interval in ms (default: 30 seconds) */
  healthCheckIntervalMs?: number;
  /** Max concurrent reconnection attempts (default: 3) */
  maxConcurrentReconnects?: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  backoffBaseMs?: number;
  /** Max backoff delay in ms (default: 5 minutes) */
  backoffMaxMs?: number;
  /** Max reconnection attempts before giving up (default: 10) */
  maxReconnectAttempts?: number;
  /** Whether to auto-reconnect failed instances (default: true) */
  autoReconnect?: boolean;
}

const DEFAULT_CONFIG: Required<MonitorConfig> = {
  healthCheckIntervalMs: 30_000,
  maxConcurrentReconnects: 3,
  backoffBaseMs: 1000,
  backoffMaxMs: 300_000, // 5 minutes
  maxReconnectAttempts: 10,
  autoReconnect: true,
};

// ============================================================================
// Reconnection State
// ============================================================================

interface ReconnectState {
  instanceId: string;
  attempts: number;
  lastAttempt: Date;
  nextAttempt: Date;
  error?: string;
}

// ============================================================================
// Instance Monitor Class
// ============================================================================

export class InstanceMonitor {
  private config: Required<MonitorConfig>;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectQueue: Map<string, ReconnectState> = new Map();
  private activeReconnects = 0;
  private isRunning = false;

  constructor(
    private readonly db: Database,
    private readonly registry: ChannelRegistry,
    config: MonitorConfig = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the instance monitor
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Monitor already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting instance monitor', {
      healthCheckInterval: this.config.healthCheckIntervalMs,
      maxConcurrentReconnects: this.config.maxConcurrentReconnects,
      autoReconnect: this.config.autoReconnect,
    });

    // Start periodic health checks
    this.healthCheckTimer = setInterval(() => {
      this.runHealthCheck().catch((err) => {
        logger.error('Health check failed', { error: String(err) });
      });
    }, this.config.healthCheckIntervalMs);

    // Process reconnect queue periodically
    setInterval(() => {
      this.processReconnectQueue().catch((err) => {
        logger.error('Reconnect queue processing failed', { error: String(err) });
      });
    }, 5000); // Check queue every 5 seconds
  }

  /**
   * Stop the instance monitor
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    this.reconnectQueue.clear();
    logger.info('Instance monitor stopped');
  }

  /**
   * Run health check on all active instances
   * Only reconnects instances that have been authenticated before (have ownerIdentifier)
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Health check logic requires multiple condition paths
  async runHealthCheck(): Promise<void> {
    const activeInstances = await this.db
      .select({
        id: instances.id,
        name: instances.name,
        channel: instances.channel,
        ownerIdentifier: instances.ownerIdentifier,
      })
      .from(instances)
      .where(eq(instances.isActive, true));

    if (activeInstances.length === 0) return;

    for (const instance of activeInstances) {
      try {
        const plugin = this.registry.get(instance.channel as Parameters<typeof this.registry.get>[0]);
        if (!plugin) {
          logger.warn('No plugin for instance', { instanceId: instance.id, channel: instance.channel });
          continue;
        }

        const status = await plugin.getStatus(instance.id);

        if (status.state === 'disconnected' || status.state === 'error') {
          // Only auto-reconnect if instance was previously authenticated
          // (has ownerIdentifier from a successful connection)
          const wasAuthenticated = !!instance.ownerIdentifier;

          if (!wasAuthenticated) {
            logger.debug('Skipping reconnect for never-authenticated instance', {
              instanceId: instance.id,
              name: instance.name,
              state: status.state,
            });
            continue;
          }

          logger.warn('Instance unhealthy', {
            instanceId: instance.id,
            name: instance.name,
            state: status.state,
            message: status.message,
          });

          if (this.config.autoReconnect) {
            this.scheduleReconnect(instance.id, instance.channel, status.message);
          }
        }
      } catch (error) {
        logger.error('Health check failed for instance', {
          instanceId: instance.id,
          error: String(error),
        });

        // Only auto-reconnect if instance was previously authenticated
        if (this.config.autoReconnect && instance.ownerIdentifier) {
          this.scheduleReconnect(instance.id, instance.channel, String(error));
        }
      }
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  scheduleReconnect(instanceId: string, _channel: string, error?: string): void {
    const existing = this.reconnectQueue.get(instanceId);

    if (existing && existing.attempts >= this.config.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached', {
        instanceId,
        attempts: existing.attempts,
      });
      // Mark instance as inactive in database
      this.markInstanceInactive(instanceId).catch(() => {});
      this.reconnectQueue.delete(instanceId);
      return;
    }

    const attempts = existing ? existing.attempts + 1 : 1;
    const backoffMs = Math.min(this.config.backoffBaseMs * 2 ** (attempts - 1), this.config.backoffMaxMs);

    const state: ReconnectState = {
      instanceId,
      attempts,
      lastAttempt: new Date(),
      nextAttempt: new Date(Date.now() + backoffMs),
      error,
    };

    this.reconnectQueue.set(instanceId, state);

    logger.info('Scheduled reconnect', {
      instanceId,
      attempt: attempts,
      backoffMs,
      nextAttempt: state.nextAttempt.toISOString(),
    });
  }

  /**
   * Process the reconnection queue
   */
  private async processReconnectQueue(): Promise<void> {
    if (this.reconnectQueue.size === 0) return;
    if (this.activeReconnects >= this.config.maxConcurrentReconnects) return;

    const now = new Date();
    const readyToReconnect: ReconnectState[] = [];

    for (const state of this.reconnectQueue.values()) {
      if (state.nextAttempt <= now) {
        readyToReconnect.push(state);
      }
    }

    // Sort by next attempt time (oldest first)
    readyToReconnect.sort((a, b) => a.nextAttempt.getTime() - b.nextAttempt.getTime());

    // Process up to maxConcurrentReconnects
    const toProcess = readyToReconnect.slice(0, this.config.maxConcurrentReconnects - this.activeReconnects);

    for (const state of toProcess) {
      this.attemptReconnect(state).catch(() => {});
    }
  }

  /**
   * Attempt to reconnect an instance
   */
  private async attemptReconnect(state: ReconnectState): Promise<void> {
    this.activeReconnects++;

    try {
      logger.info('Attempting reconnect', {
        instanceId: state.instanceId,
        attempt: state.attempts,
      });

      // Get instance details from database
      const [instance] = await this.db.select().from(instances).where(eq(instances.id, state.instanceId)).limit(1);

      if (!instance) {
        logger.warn('Instance not found, removing from queue', { instanceId: state.instanceId });
        this.reconnectQueue.delete(state.instanceId);
        return;
      }

      const plugin = this.registry.get(instance.channel as Parameters<typeof this.registry.get>[0]);
      if (!plugin) {
        logger.warn('No plugin for instance', { instanceId: state.instanceId, channel: instance.channel });
        this.reconnectQueue.delete(state.instanceId);
        return;
      }

      // Attempt reconnection
      await plugin.connect(instance.id, {
        instanceId: instance.id,
        credentials: {},
        options: {},
      });

      // Success - remove from queue
      this.reconnectQueue.delete(state.instanceId);
      logger.info('Reconnect successful', { instanceId: state.instanceId, attempts: state.attempts });
    } catch (error) {
      logger.error('Reconnect failed', {
        instanceId: state.instanceId,
        attempt: state.attempts,
        error: String(error),
      });

      // Update state for retry
      const instance = await this.db
        .select({ channel: instances.channel })
        .from(instances)
        .where(eq(instances.id, state.instanceId))
        .limit(1);

      if (instance[0]) {
        this.scheduleReconnect(state.instanceId, instance[0].channel, String(error));
      }
    } finally {
      this.activeReconnects--;
    }
  }

  /**
   * Mark an instance as inactive in the database
   */
  private async markInstanceInactive(instanceId: string): Promise<void> {
    await this.db.update(instances).set({ isActive: false }).where(eq(instances.id, instanceId));

    logger.info('Marked instance as inactive', { instanceId });
  }

  /**
   * Get current monitor status
   */
  getStatus(): {
    isRunning: boolean;
    activeReconnects: number;
    queuedReconnects: number;
    reconnectQueue: Array<{
      instanceId: string;
      attempts: number;
      nextAttempt: string;
    }>;
  } {
    return {
      isRunning: this.isRunning,
      activeReconnects: this.activeReconnects,
      queuedReconnects: this.reconnectQueue.size,
      reconnectQueue: Array.from(this.reconnectQueue.values()).map((s) => ({
        instanceId: s.instanceId,
        attempts: s.attempts,
        nextAttempt: s.nextAttempt.toISOString(),
      })),
    };
  }

  /**
   * Manually trigger reconnection for an instance
   */
  async forceReconnect(instanceId: string): Promise<void> {
    const [instance] = await this.db
      .select({ channel: instances.channel })
      .from(instances)
      .where(eq(instances.id, instanceId))
      .limit(1);

    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }

    // Remove from queue if present and add fresh
    this.reconnectQueue.delete(instanceId);
    this.scheduleReconnect(instanceId, instance.channel, 'Manual reconnect requested');
  }

  /**
   * Clear reconnect queue for an instance (e.g., when manually disconnected)
   */
  clearReconnectQueue(instanceId: string): void {
    this.reconnectQueue.delete(instanceId);
  }
}

// ============================================================================
// Connection Pool for Startup
// ============================================================================

/**
 * Reconnect instances with connection pooling
 *
 * Limits concurrent connections to prevent overwhelming the system on startup
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Batch reconnection logic requires multiple condition paths
export async function reconnectWithPool(
  db: Database,
  registry: ChannelRegistry,
  options: {
    maxConcurrent?: number;
    delayBetweenMs?: number;
  } = {},
): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ instanceId: string; error: string }>;
}> {
  const { maxConcurrent = 3, delayBetweenMs = 500 } = options;

  const activeInstances = await db.select().from(instances).where(eq(instances.isActive, true));

  logger.info('Starting pooled reconnection', {
    instanceCount: activeInstances.length,
    maxConcurrent,
    delayBetweenMs,
  });

  const results = {
    attempted: activeInstances.length,
    succeeded: 0,
    failed: 0,
    errors: [] as Array<{ instanceId: string; error: string }>,
  };

  if (activeInstances.length === 0) {
    return results;
  }

  // Process in batches
  for (let i = 0; i < activeInstances.length; i += maxConcurrent) {
    const batch = activeInstances.slice(i, i + maxConcurrent);

    const batchResults = await Promise.allSettled(
      batch.map(async (instance) => {
        const plugin = registry.get(instance.channel as Parameters<typeof registry.get>[0]);
        if (!plugin) {
          throw new Error(`No plugin for channel: ${instance.channel}`);
        }

        await plugin.connect(instance.id, {
          instanceId: instance.id,
          credentials: {},
          options: {},
        });

        return instance.id;
      }),
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const instance = batch[j];
      if (!result || !instance) continue; // Type guard

      if (result.status === 'fulfilled') {
        results.succeeded++;
        logger.info('Instance reconnected', { instanceId: instance.id, name: instance.name });
      } else {
        results.failed++;
        const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
        results.errors.push({ instanceId: instance.id, error });
        logger.error('Instance reconnection failed', {
          instanceId: instance.id,
          name: instance.name,
          error,
        });

        // Mark as inactive if connection fails
        await db.update(instances).set({ isActive: false }).where(eq(instances.id, instance.id));
      }
    }

    // Delay between batches to prevent overwhelming
    if (i + maxConcurrent < activeInstances.length) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenMs));
    }
  }

  logger.info('Pooled reconnection complete', results);
  return results;
}
