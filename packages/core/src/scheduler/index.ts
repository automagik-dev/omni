/**
 * Scheduler Module
 *
 * In-process job scheduler using croner for cron-like scheduling.
 * Handles periodic tasks like auto-retry and cleanup.
 *
 * @see events-ops wish (DEC-9)
 */

import { Cron } from 'croner';
import { createLogger } from '../logger';

const log = createLogger('scheduler');

/**
 * Job handler function type
 */
export type JobHandler = () => Promise<void> | void;

/**
 * Job configuration
 */
export interface JobConfig {
  /** Unique job name */
  name: string;
  /** Cron expression (supports seconds) */
  cron: string;
  /** Job handler function */
  handler: JobHandler;
  /** Run immediately on registration */
  runOnStart?: boolean;
  /** Timezone for cron expression */
  timezone?: string;
}

/**
 * Job instance with metadata
 */
export interface Job {
  name: string;
  cron: string;
  lastRun: Date | null;
  nextRun: Date | null;
  runCount: number;
  lastError: string | null;
  isRunning: boolean;
}

/**
 * Scheduler class for managing periodic jobs
 */
export class Scheduler {
  private jobs = new Map<string, { cron: Cron; config: JobConfig; stats: Job }>();
  private started = false;

  /**
   * Register a job
   */
  register(config: JobConfig): void {
    if (this.jobs.has(config.name)) {
      throw new Error(`Job "${config.name}" already registered`);
    }

    const stats: Job = {
      name: config.name,
      cron: config.cron,
      lastRun: null,
      nextRun: null,
      runCount: 0,
      lastError: null,
      isRunning: false,
    };

    const cron = new Cron(
      config.cron,
      {
        paused: !this.started,
        timezone: config.timezone,
        protect: true, // Prevents overlapping runs
      },
      async () => {
        if (stats.isRunning) {
          log.warn('Job already running, skipping', { job: config.name });
          return;
        }

        stats.isRunning = true;
        const startTime = Date.now();

        try {
          log.debug('Job starting', { job: config.name });
          await config.handler();
          stats.lastRun = new Date();
          stats.runCount++;
          stats.lastError = null;
          log.debug('Job completed', {
            job: config.name,
            durationMs: Date.now() - startTime,
          });
        } catch (err) {
          stats.lastError = String(err);
          log.error('Job failed', {
            job: config.name,
            error: String(err),
            durationMs: Date.now() - startTime,
          });
        } finally {
          stats.isRunning = false;
          stats.nextRun = cron.nextRun() ?? null;
        }
      },
    );

    stats.nextRun = cron.nextRun() ?? null;
    this.jobs.set(config.name, { cron, config, stats });

    log.info('Job registered', {
      job: config.name,
      cron: config.cron,
      nextRun: stats.nextRun?.toISOString(),
    });

    // Run immediately if requested and scheduler is started
    if (config.runOnStart && this.started) {
      this.runNow(config.name).catch((err) => {
        log.error('runOnStart failed', { job: config.name, error: String(err) });
      });
    }
  }

  /**
   * Unregister a job
   */
  unregister(name: string): boolean {
    const job = this.jobs.get(name);
    if (!job) {
      return false;
    }

    job.cron.stop();
    this.jobs.delete(name);
    log.info('Job unregistered', { job: name });
    return true;
  }

  /**
   * Start the scheduler (resumes all jobs)
   */
  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;

    for (const [name, job] of this.jobs) {
      job.cron.resume();
      job.stats.nextRun = job.cron.nextRun() ?? null;

      // Run on start if configured
      if (job.config.runOnStart) {
        this.runNow(name).catch((err) => {
          log.error('runOnStart failed', { job: name, error: String(err) });
        });
      }
    }

    log.info('Scheduler started', { jobCount: this.jobs.size });
  }

  /**
   * Stop the scheduler (pauses all jobs)
   */
  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;

    for (const job of this.jobs.values()) {
      job.cron.pause();
    }

    log.info('Scheduler stopped');
  }

  /**
   * Run a job immediately (outside of schedule)
   */
  async runNow(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`Job "${name}" not found`);
    }

    await job.cron.trigger();
  }

  /**
   * Get job status
   */
  getJob(name: string): Job | undefined {
    return this.jobs.get(name)?.stats;
  }

  /**
   * List all jobs
   */
  listJobs(): Job[] {
    return Array.from(this.jobs.values()).map((j) => ({
      ...j.stats,
      nextRun: j.cron.nextRun() ?? null,
    }));
  }

  /**
   * Check if scheduler is running
   */
  isStarted(): boolean {
    return this.started;
  }

  /**
   * Shutdown and cleanup
   */
  shutdown(): void {
    this.stop();
    for (const job of this.jobs.values()) {
      job.cron.stop();
    }
    this.jobs.clear();
    log.info('Scheduler shutdown');
  }
}

/**
 * Singleton scheduler instance
 */
let schedulerInstance: Scheduler | null = null;

/**
 * Get or create the scheduler instance
 */
export function getScheduler(): Scheduler {
  if (!schedulerInstance) {
    schedulerInstance = new Scheduler();
  }
  return schedulerInstance;
}

/**
 * Reset the scheduler (useful for testing)
 */
export function resetScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.shutdown();
    schedulerInstance = null;
  }
}

/**
 * Common cron expressions
 */
export const CronExpressions = {
  /** Every 15 minutes */
  EVERY_15_MINUTES: '*/15 * * * *',
  /** Every hour */
  EVERY_HOUR: '0 * * * *',
  /** Every day at 3 AM */
  DAILY_3AM: '0 3 * * *',
  /** Every day at midnight */
  DAILY_MIDNIGHT: '0 0 * * *',
  /** Every minute (for testing) */
  EVERY_MINUTE: '* * * * *',
} as const;
