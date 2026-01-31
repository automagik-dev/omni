/**
 * Scheduler Setup
 *
 * Configures and starts the in-process scheduler for periodic jobs:
 * - Dead letter auto-retry (every 15 minutes)
 * - Payload cleanup (daily at 3 AM)
 * - Dead letter cleanup (daily at 3 AM)
 *
 * @see events-ops wish (DEC-9)
 */

import {
  CronExpressions,
  createLogger,
  deadLettersPending,
  getScheduler,
  payloadStorageSize,
  recordScheduledJob,
  scheduledJobNextRun,
} from '@omni/core';
import type { Services } from './services';

const log = createLogger('scheduler:setup');

/**
 * Setup and start the scheduler with all jobs
 */
export function setupScheduler(services: Services): void {
  const scheduler = getScheduler();

  // Dead letter auto-retry - every 15 minutes
  scheduler.register({
    name: 'dead-letter-auto-retry',
    cron: CronExpressions.EVERY_15_MINUTES,
    runOnStart: false, // Don't run immediately on startup
    handler: async () => {
      const startTime = Date.now();
      try {
        const result = await services.deadLetters.processAutoRetries();
        const durationSec = (Date.now() - startTime) / 1000;
        recordScheduledJob('dead-letter-auto-retry', 'success', durationSec);

        // Update metrics
        const pendingCount = await services.deadLetters.getPendingCount();
        deadLettersPending.set(pendingCount);

        log.info('Dead letter auto-retry completed', result);
      } catch (err) {
        const durationSec = (Date.now() - startTime) / 1000;
        recordScheduledJob('dead-letter-auto-retry', 'failure', durationSec);
        throw err;
      }
    },
  });

  // Payload cleanup - daily at 3 AM
  scheduler.register({
    name: 'payload-cleanup',
    cron: CronExpressions.DAILY_3AM,
    runOnStart: false,
    handler: async () => {
      const startTime = Date.now();
      try {
        const deleted = await services.payloadStore.cleanupExpired();
        const durationSec = (Date.now() - startTime) / 1000;
        recordScheduledJob('payload-cleanup', 'success', durationSec);

        // Update storage size metric
        const stats = await services.payloadStore.getStats();
        payloadStorageSize.set(stats.totalSizeCompressed);

        log.info('Payload cleanup completed', { deleted });
      } catch (err) {
        const durationSec = (Date.now() - startTime) / 1000;
        recordScheduledJob('payload-cleanup', 'failure', durationSec);
        throw err;
      }
    },
  });

  // Dead letter cleanup - daily at 3 AM
  scheduler.register({
    name: 'dead-letter-cleanup',
    cron: CronExpressions.DAILY_3AM,
    runOnStart: false,
    handler: async () => {
      const startTime = Date.now();
      try {
        const deleted = await services.deadLetters.cleanupExpired();
        const durationSec = (Date.now() - startTime) / 1000;
        recordScheduledJob('dead-letter-cleanup', 'success', durationSec);

        log.info('Dead letter cleanup completed', { deleted });
      } catch (err) {
        const durationSec = (Date.now() - startTime) / 1000;
        recordScheduledJob('dead-letter-cleanup', 'failure', durationSec);
        throw err;
      }
    },
  });

  // Update next run timestamps for metrics
  updateSchedulerMetrics();

  // Start the scheduler
  scheduler.start();

  log.info('Scheduler started', {
    jobs: scheduler.listJobs().map((j) => ({
      name: j.name,
      cron: j.cron,
      nextRun: j.nextRun?.toISOString(),
    })),
  });
}

/**
 * Update scheduler metrics (call periodically or after job runs)
 */
function updateSchedulerMetrics(): void {
  const scheduler = getScheduler();
  const jobs = scheduler.listJobs();

  for (const job of jobs) {
    if (job.nextRun) {
      scheduledJobNextRun.set({ job: job.name }, job.nextRun.getTime() / 1000);
    }
  }
}

/**
 * Stop the scheduler (for graceful shutdown)
 */
export function stopScheduler(): void {
  const scheduler = getScheduler();
  scheduler.stop();
  log.info('Scheduler stopped');
}
