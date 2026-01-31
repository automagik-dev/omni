/**
 * Instance Monitor
 *
 * Provides robustness features for channel instances:
 * - Health monitoring with periodic checks
 * - Automatic reconnection with exponential backoff
 * - Connection pooling to limit concurrent operations
 */

import type { ChannelPlugin, ChannelRegistry } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import { instances } from '@omni/db';
import { eq } from 'drizzle-orm';

import { createLogger } from './logger';

const logger = createLogger({ module: 'instance-monitor' });

// ============================================================================
// Types
// ============================================================================

interface InstanceInfo {
  id: string;
  name: string;
  channel: string;
  ownerIdentifier: string | null;
}

interface ReconnectState {
  instanceId: string;
  attempts: number;
  lastAttempt: Date;
  nextAttempt: Date;
  error?: string;
}

interface ReconnectResults {
  attempted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ instanceId: string; error: string }>;
}

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
// Helper Functions
// ============================================================================

/**
 * Check if an instance needs reconnection based on its status
 */
function needsReconnect(state: string): boolean {
  return state === 'disconnected' || state === 'error';
}

/**
 * Check if an instance was previously authenticated
 */
function wasAuthenticated(instance: InstanceInfo): boolean {
  return !!instance.ownerIdentifier;
}

/**
 * Connect a single instance via its plugin
 */
async function connectInstance(instance: { id: string; channel: string }, registry: ChannelRegistry): Promise<void> {
  const plugin = registry.get(instance.channel as Parameters<typeof registry.get>[0]);
  if (!plugin) {
    throw new Error(`No plugin for channel: ${instance.channel}`);
  }

  await plugin.connect(instance.id, {
    instanceId: instance.id,
    credentials: {},
    options: {},
  });
}

/**
 * Process a single batch result and update counters
 */
async function handleBatchResult(
  result: PromiseSettledResult<string>,
  instance: { id: string; name: string },
  db: Database,
  results: ReconnectResults,
): Promise<void> {
  if (result.status === 'fulfilled') {
    results.succeeded++;
    logger.info('Instance reconnected', { instanceId: instance.id, name: instance.name });
  } else {
    results.failed++;
    const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
    results.errors.push({ instanceId: instance.id, error });
    logger.error('Instance reconnection failed', { instanceId: instance.id, name: instance.name, error });
    await db.update(instances).set({ isActive: false }).where(eq(instances.id, instance.id));
  }
}

/**
 * Delay execution for a specified duration
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    }, 5000);
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
   */
  async runHealthCheck(): Promise<void> {
    const activeInstances = await this.fetchActiveInstances();
    if (activeInstances.length === 0) return;

    for (const instance of activeInstances) {
      await this.checkInstanceHealth(instance);
    }
  }

  /**
   * Fetch all active instances from database
   */
  private async fetchActiveInstances(): Promise<InstanceInfo[]> {
    return this.db
      .select({
        id: instances.id,
        name: instances.name,
        channel: instances.channel,
        ownerIdentifier: instances.ownerIdentifier,
      })
      .from(instances)
      .where(eq(instances.isActive, true));
  }

  /**
   * Check health of a single instance and schedule reconnect if needed
   */
  private async checkInstanceHealth(instance: InstanceInfo): Promise<void> {
    const plugin = this.getPluginForInstance(instance);
    if (!plugin) return;

    try {
      const status = await plugin.getStatus(instance.id);

      if (needsReconnect(status.state)) {
        this.handleUnhealthyInstance(instance, status.state, status.message);
      }
    } catch (error) {
      logger.error('Health check failed for instance', { instanceId: instance.id, error: String(error) });
      this.handleHealthCheckError(instance, String(error));
    }
  }

  /**
   * Get plugin for an instance, logging warning if not found
   */
  private getPluginForInstance(instance: InstanceInfo): ChannelPlugin | null {
    const plugin = this.registry.get(instance.channel as Parameters<typeof this.registry.get>[0]);
    if (!plugin) {
      logger.warn('No plugin for instance', { instanceId: instance.id, channel: instance.channel });
    }
    return plugin ?? null;
  }

  /**
   * Handle an unhealthy instance by scheduling reconnect if appropriate
   */
  private handleUnhealthyInstance(instance: InstanceInfo, state: string, message?: string): void {
    if (!wasAuthenticated(instance)) {
      logger.debug('Skipping reconnect for never-authenticated instance', {
        instanceId: instance.id,
        name: instance.name,
        state,
      });
      return;
    }

    logger.warn('Instance unhealthy', {
      instanceId: instance.id,
      name: instance.name,
      state,
      message,
    });

    if (this.config.autoReconnect) {
      this.scheduleReconnect(instance.id, instance.channel, message);
    }
  }

  /**
   * Handle a health check error
   */
  private handleHealthCheckError(instance: InstanceInfo, error: string): void {
    if (this.config.autoReconnect && wasAuthenticated(instance)) {
      this.scheduleReconnect(instance.id, instance.channel, error);
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  scheduleReconnect(instanceId: string, _channel: string, error?: string): void {
    const existing = this.reconnectQueue.get(instanceId);

    if (existing && existing.attempts >= this.config.maxReconnectAttempts) {
      logger.error('Max reconnect attempts reached', { instanceId, attempts: existing.attempts });
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

    const readyToReconnect = this.getReadyReconnects();
    const toProcess = readyToReconnect.slice(0, this.config.maxConcurrentReconnects - this.activeReconnects);

    for (const state of toProcess) {
      this.attemptReconnect(state).catch(() => {});
    }
  }

  /**
   * Get reconnects that are ready to be processed
   */
  private getReadyReconnects(): ReconnectState[] {
    const now = new Date();
    const ready: ReconnectState[] = [];

    for (const state of this.reconnectQueue.values()) {
      if (state.nextAttempt <= now) {
        ready.push(state);
      }
    }

    return ready.sort((a, b) => a.nextAttempt.getTime() - b.nextAttempt.getTime());
  }

  /**
   * Attempt to reconnect an instance
   */
  private async attemptReconnect(state: ReconnectState): Promise<void> {
    this.activeReconnects++;

    try {
      logger.info('Attempting reconnect', { instanceId: state.instanceId, attempt: state.attempts });

      const instance = await this.fetchInstanceById(state.instanceId);
      if (!instance) {
        logger.warn('Instance not found, removing from queue', { instanceId: state.instanceId });
        this.reconnectQueue.delete(state.instanceId);
        return;
      }

      await connectInstance(instance, this.registry);
      this.reconnectQueue.delete(state.instanceId);
      logger.info('Reconnect successful', { instanceId: state.instanceId, attempts: state.attempts });
    } catch (error) {
      await this.handleReconnectFailure(state, String(error));
    } finally {
      this.activeReconnects--;
    }
  }

  /**
   * Handle a failed reconnection attempt
   */
  private async handleReconnectFailure(state: ReconnectState, error: string): Promise<void> {
    logger.error('Reconnect failed', { instanceId: state.instanceId, attempt: state.attempts, error });

    const instance = await this.fetchInstanceById(state.instanceId);
    if (instance) {
      this.scheduleReconnect(state.instanceId, instance.channel, error);
    }
  }

  /**
   * Fetch an instance by ID
   */
  private async fetchInstanceById(instanceId: string): Promise<{ id: string; channel: string } | null> {
    const [instance] = await this.db.select().from(instances).where(eq(instances.id, instanceId)).limit(1);
    return instance ?? null;
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
    reconnectQueue: Array<{ instanceId: string; attempts: number; nextAttempt: string }>;
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
    const instance = await this.fetchInstanceById(instanceId);
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }

    this.reconnectQueue.delete(instanceId);
    this.scheduleReconnect(instanceId, instance.channel, 'Manual reconnect requested');
  }

  /**
   * Clear reconnect queue for an instance
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
 */
export async function reconnectWithPool(
  db: Database,
  registry: ChannelRegistry,
  options: { maxConcurrent?: number; delayBetweenMs?: number } = {},
): Promise<ReconnectResults> {
  const { maxConcurrent = 3, delayBetweenMs = 500 } = options;

  const activeInstances = await db.select().from(instances).where(eq(instances.isActive, true));

  logger.info('Starting pooled reconnection', {
    instanceCount: activeInstances.length,
    maxConcurrent,
    delayBetweenMs,
  });

  const results: ReconnectResults = {
    attempted: activeInstances.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  if (activeInstances.length === 0) {
    return results;
  }

  await processInstanceBatches(activeInstances, registry, db, results, maxConcurrent, delayBetweenMs);

  logger.info('Pooled reconnection complete', { ...results });
  return results;
}

/**
 * Process instances in batches with concurrency control
 */
async function processInstanceBatches(
  allInstances: Array<{ id: string; name: string; channel: string }>,
  registry: ChannelRegistry,
  db: Database,
  results: ReconnectResults,
  maxConcurrent: number,
  delayBetweenMs: number,
): Promise<void> {
  for (let i = 0; i < allInstances.length; i += maxConcurrent) {
    const batch = allInstances.slice(i, i + maxConcurrent);
    await processSingleBatch(batch, registry, db, results);

    const hasMoreBatches = i + maxConcurrent < allInstances.length;
    if (hasMoreBatches) {
      await delay(delayBetweenMs);
    }
  }
}

/**
 * Process a single batch of instances
 */
async function processSingleBatch(
  batch: Array<{ id: string; name: string; channel: string }>,
  registry: ChannelRegistry,
  db: Database,
  results: ReconnectResults,
): Promise<void> {
  const batchResults = await Promise.allSettled(
    batch.map((instance) => connectInstance(instance, registry).then(() => instance.id)),
  );

  for (let j = 0; j < batchResults.length; j++) {
    const result = batchResults[j];
    const instance = batch[j];
    if (!result || !instance) continue;

    await handleBatchResult(result, instance, db, results);
  }
}
