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

import type { ChannelRegistry, ChannelType } from '@omni/channel-sdk';
import {
  CronExpressions,
  createLogger,
  deadLettersPending,
  getScheduler,
  payloadStorageSize,
  recordScheduledJob,
  scheduledJobNextRun,
} from '@omni/core';
import * as Sentry from '@sentry/bun';
import { sentryEnabled } from './lib/sentry-scrub';
import type { Services } from './services';
import { ScheduledMessageService, createPluginResolver } from './services/scheduled-messages';
import { runForEachActiveTenantRow } from './tenancy/periodic-tenant-work';

const log = createLogger('scheduler:setup');

/**
 * Create one daily per-instance sync job, fanned out across tenants
 * (G5, ADR-0008).
 *
 * This is the exact shape `runForEachActiveTenantRow` was written for: a
 * whole-table `listActive()` read followed by a per-row side effect that WRITES
 * a job row and PUBLISHES `sync.started`. A cron has no envelope and no
 * credential, so it must ENUMERATE whose work exists rather than scan
 * globally — under RLS enforcement the global scan is not even expressible.
 *
 * The three worlds are the helper's: flag-off runs the single pre-G5 ambient
 * pass byte-identically; flag-on runs one scoped `listActive` per ACTIVE tenant
 * (so a suspended tenant's daily sync stops at the next tick — dequeue-time
 * revalidation at cron cadence) and threads that tenant into `syncJobs.create`,
 * which scopes its own insert and stamps the published envelope; the
 * transitional NULL-tenant pass is skipped under enforcement.
 *
 * `perRow` failures stay per-row: one instance that cannot be synced must not
 * abort the rest of the tenant's pass, which is what the pre-G5 loop did too.
 */
async function createDailySyncJobs(services: Services, type: 'contacts' | 'groups'): Promise<number> {
  let jobsCreated = 0;
  await runForEachActiveTenantRow(
    {
      db: services.db,
      authPlaneDb: services.authPlane.db,
      jobName: `${type}-sync-daily`,
      listActive: () => services.instances.listActive(),
    },
    async (instance, tenantId) => {
      try {
        await services.syncJobs.create({
          instanceId: instance.id,
          channelType: instance.channel,
          type,
          config: {},
          tenantId,
        });
        jobsCreated++;
      } catch (err) {
        log.warn(`Failed to create ${type} sync job for instance`, {
          instanceId: instance.id,
          error: String(err),
        });
      }
    },
  );
  return jobsCreated;
}

/**
 * Re-emit cached unread counts for every active WhatsApp instance, fanned out
 * across tenants (G5, ADR-0008).
 *
 * Structurally identical to `createDailySyncJobs` and converted for the same
 * reason: a cron has no envelope and no credential, so it must ENUMERATE whose
 * instances exist rather than scan the table — under RLS enforcement the global
 * `listActive()` is not expressible at all. This was the last scheduler caller
 * reaching `services/instances.ts::instances` unscoped.
 *
 * The per-row side effect is an IN-PROCESS plugin call, not a database write, so
 * `runForEachActiveTenantRow` is the right helper: it scopes only the discrete
 * `listActive` READ and runs `perRow` outside that scope, never pinning a pooled
 * connection across the plugin call.
 *
 * Three worlds, from the helper: flag-off is the pre-G5 single ambient pass,
 * byte for byte; flag-on runs one scoped pass per ACTIVE tenant (a suspended
 * tenant stops being refreshed at the next tick); the transitional NULL-tenant
 * pass is skipped under enforcement.
 *
 * Returns the number of instances refreshed — what the job logs.
 */
async function refreshUnreadCounts(
  services: Services,
  channelRegistry: ChannelRegistry,
  env?: NodeJS.ProcessEnv,
): Promise<number> {
  const waPlugin = channelRegistry.get('whatsapp-baileys') as
    | { refreshUnreadCounts?: (instanceId: string) => void }
    | undefined;

  // No plugin: return before any enumeration or query, exactly as the pre-G5
  // early return did.
  if (!waPlugin?.refreshUnreadCounts) return 0;
  const refresh = waPlugin.refreshUnreadCounts.bind(waPlugin);

  let refreshed = 0;
  await runForEachActiveTenantRow(
    {
      db: services.db,
      authPlaneDb: services.authPlane.db,
      jobName: 'unread-count-refresh',
      listActive: () => services.instances.listActive(),
      env,
    },
    async (instance) => {
      if (instance.channel !== 'whatsapp-baileys') return;
      refresh(instance.id);
      refreshed++;
    },
  );
  return refreshed;
}

/** Test seam for {@link refreshUnreadCounts} — see the tenant fan-out probe. */
export function __refreshUnreadCountsForTest(
  services: Services,
  channelRegistry: ChannelRegistry,
  env?: NodeJS.ProcessEnv,
): Promise<number> {
  return refreshUnreadCounts(services, channelRegistry, env);
}

/**
 * Wrap a scheduled job handler with Sentry cron monitoring.
 * When Sentry is not configured the handler runs directly.
 */
async function withCronMonitor(
  slug: string,
  cron: string,
  checkinMargin: number,
  maxRuntime: number,
  handler: () => Promise<void>,
): Promise<void> {
  if (sentryEnabled()) {
    await Sentry.withMonitor(slug, handler, {
      schedule: { type: 'crontab', value: cron },
      checkinMargin,
      maxRuntime,
    });
  } else {
    await handler();
  }
}

/**
 * Setup and start the scheduler with all jobs
 */
export function setupScheduler(services: Services, channelRegistry?: ChannelRegistry | null): void {
  const scheduler = getScheduler();

  // Dead letter auto-retry - every 15 minutes
  scheduler.register({
    name: 'dead-letter-auto-retry',
    cron: CronExpressions.EVERY_15_MINUTES,
    runOnStart: false, // Don't run immediately on startup
    handler: async () => {
      await withCronMonitor('dead-letter-auto-retry', '*/15 * * * *', 5, 10, async () => {
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
      });
    },
  });

  // Payload cleanup - daily at 3 AM
  scheduler.register({
    name: 'payload-cleanup',
    cron: CronExpressions.DAILY_3AM,
    runOnStart: false,
    handler: async () => {
      await withCronMonitor('payload-cleanup', '0 3 * * *', 10, 30, async () => {
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
      });
    },
  });

  // Dead letter cleanup - daily at 3 AM
  scheduler.register({
    name: 'dead-letter-cleanup',
    cron: CronExpressions.DAILY_3AM,
    runOnStart: false,
    handler: async () => {
      await withCronMonitor('dead-letter-cleanup', '0 3 * * *', 10, 15, async () => {
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
      });
    },
  });

  // Contacts sync - daily at 4 AM
  scheduler.register({
    name: 'contacts-sync-daily',
    cron: '0 4 * * *', // 4 AM daily
    runOnStart: false,
    handler: async () => {
      await withCronMonitor('contacts-sync-daily', '0 4 * * *', 15, 60, async () => {
        const startTime = Date.now();
        try {
          const jobsCreated = await createDailySyncJobs(services, 'contacts');

          const durationSec = (Date.now() - startTime) / 1000;
          recordScheduledJob('contacts-sync-daily', 'success', durationSec);
          log.info('Daily contacts sync jobs created', { jobsCreated });
        } catch (err) {
          const durationSec = (Date.now() - startTime) / 1000;
          recordScheduledJob('contacts-sync-daily', 'failure', durationSec);
          throw err;
        }
      });
    },
  });

  // Groups sync - daily at 5 AM
  scheduler.register({
    name: 'groups-sync-daily',
    cron: '0 5 * * *', // 5 AM daily
    runOnStart: false,
    handler: async () => {
      await withCronMonitor('groups-sync-daily', '0 5 * * *', 15, 60, async () => {
        const startTime = Date.now();
        try {
          const jobsCreated = await createDailySyncJobs(services, 'groups');

          const durationSec = (Date.now() - startTime) / 1000;
          recordScheduledJob('groups-sync-daily', 'success', durationSec);
          log.info('Daily groups sync jobs created', { jobsCreated });
        } catch (err) {
          const durationSec = (Date.now() - startTime) / 1000;
          recordScheduledJob('groups-sync-daily', 'failure', durationSec);
          throw err;
        }
      });
    },
  });

  // Idle-chat follow-up sweeper — every 15 seconds.
  // Fires `chat.idle_timeout` for due rows and advances the sequence.
  // See issue #404 and .genie/wishes/idle-chat-follow-up/WISH.md.
  scheduler.register({
    name: 'follow-up-sweeper',
    cron: '*/15 * * * * *',
    runOnStart: false,
    handler: async () => {
      await withCronMonitor('follow-up-sweeper', '*/15 * * * * *', 1, 1, async () => {
        const startTime = Date.now();
        try {
          const stats = await services.followUpSweeper.sweep();
          const durationSec = (Date.now() - startTime) / 1000;
          recordScheduledJob('follow-up-sweeper', 'success', durationSec);
          if (stats.scanned > 0) {
            log.debug('Follow-up sweep tick', stats);
          }
        } catch (err) {
          const durationSec = (Date.now() - startTime) / 1000;
          recordScheduledJob('follow-up-sweeper', 'failure', durationSec);
          throw err;
        }
      });
    },
  });

  // Scheduled-message sweeper — every 15 seconds (#889).
  //
  // Only local-mode rows are swept: platform-mode messages are held by the
  // channel itself (Slack chat.scheduleMessage) and firing them here would
  // double-post. Needs the registry to reach plugin.sendMessage, so it stays
  // unregistered when there is none.
  if (channelRegistry) {
    const scheduledMessages = new ScheduledMessageService(
      services.db,
      createPluginResolver(services.db, (channel) => channelRegistry.get(channel as ChannelType) ?? undefined),
    );

    scheduler.register({
      name: 'scheduled-message-sweeper',
      cron: '*/15 * * * * *',
      runOnStart: false,
      handler: async () => {
        await withCronMonitor('scheduled-message-sweeper', '*/15 * * * * *', 1, 1, async () => {
          const startTime = Date.now();
          try {
            const stats = await scheduledMessages.sweep();
            recordScheduledJob('scheduled-message-sweeper', 'success', (Date.now() - startTime) / 1000);
            if (stats.scanned > 0) {
              log.debug('Scheduled-message sweep tick', { ...stats });
            }
          } catch (err) {
            recordScheduledJob('scheduled-message-sweeper', 'failure', (Date.now() - startTime) / 1000);
            throw err;
          }
        });
      },
    });
  }

  // Unread count refresh — hourly
  // Re-emits cached unread counts from WhatsApp plugin to DB so stale counts get corrected.
  // Without this, counts only update on connection (chats.upsert) or real-time read events.
  scheduler.register({
    name: 'unread-count-refresh',
    cron: CronExpressions.EVERY_HOUR,
    runOnStart: false,
    handler: async () => {
      if (!channelRegistry) return;

      await withCronMonitor('unread-count-refresh', '0 * * * *', 5, 5, async () => {
        const startTime = Date.now();
        try {
          const instanceCount = await refreshUnreadCounts(services, channelRegistry);

          const durationSec = (Date.now() - startTime) / 1000;
          recordScheduledJob('unread-count-refresh', 'success', durationSec);
          log.debug('Refreshed unread counts', { instanceCount });
        } catch (err) {
          const durationSec = (Date.now() - startTime) / 1000;
          recordScheduledJob('unread-count-refresh', 'failure', durationSec);
          throw err;
        }
      });
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
