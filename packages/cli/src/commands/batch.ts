/**
 * Batch Commands - manage batch media processing jobs
 *
 * omni batch list [--instance <id>] [--status <status>]
 * omni batch create --instance <id> --type <type> [options]
 * omni batch status <id> [--watch]
 * omni batch cancel <id>
 * omni batch estimate --instance <id> --type <type> [options]
 *
 * @see media-processing-batch wish
 */

import type { BatchJobType, CostEstimate, OmniClient, ProcessableContentType } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

// ============================================================================
// TYPES
// ============================================================================

interface ListOptions {
  instance?: string;
  status?: string;
  type?: string;
  limit?: number;
}

interface CreateOptions {
  instance: string;
  type: BatchJobType;
  chat?: string;
  days?: number;
  limit?: number;
  contentTypes?: string;
  force?: boolean;
  noConfirm?: boolean;
}

interface StatusOptions {
  watch?: boolean;
  interval?: number;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Parse content types from comma-separated string */
function parseContentTypes(str: string | undefined): ProcessableContentType[] | undefined {
  if (!str) return undefined;
  const types = str.split(',').map((t) => t.trim().toLowerCase());
  const valid: ProcessableContentType[] = [];
  for (const t of types) {
    if (t === 'audio' || t === 'image' || t === 'video' || t === 'document') {
      valid.push(t);
    } else {
      output.warn(`Unknown content type: ${t}`);
    }
  }
  return valid.length > 0 ? valid : undefined;
}

/** Format cost estimate for display */
function formatEstimate(estimate: CostEstimate): string {
  const lines = [
    `Total items: ${estimate.totalItems}`,
    `  Audio: ${estimate.audioCount}`,
    `  Images: ${estimate.imageCount}`,
    `  Videos: ${estimate.videoCount}`,
    `  Documents: ${estimate.documentCount}`,
    '',
    `Estimated cost: $${estimate.estimatedCostUsd.toFixed(2)} (${estimate.estimatedCostCents} cents)`,
    `Estimated duration: ~${estimate.estimatedDurationMinutes} minutes`,
  ];
  return lines.join('\n');
}

/** Format progress bar */
function progressBar(percent: number, width = 30): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percent}%`;
}

/** Format job status for display */
function formatJobStatus(job: {
  id: string;
  status: string;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  skippedItems?: number;
  progressPercent: number;
  currentItem?: string | null;
  totalCostUsd?: number | null;
  estimatedCompletion?: string | null;
}): string {
  const lines = [
    `Job ID: ${job.id}`,
    `Status: ${job.status}`,
    '',
    progressBar(job.progressPercent),
    '',
    `Processed: ${job.processedItems}/${job.totalItems}`,
    `Failed: ${job.failedItems}`,
    job.skippedItems !== undefined ? `Skipped: ${job.skippedItems}` : null,
    job.currentItem ? `Current: ${job.currentItem}` : null,
    job.totalCostUsd !== null && job.totalCostUsd !== undefined
      ? `Cost: $${(job.totalCostUsd / 100).toFixed(2)}`
      : null,
    job.estimatedCompletion ? `ETA: ${new Date(job.estimatedCompletion).toLocaleTimeString()}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

/** Sleep for ms */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// COMMANDS
// ============================================================================

/** List batch jobs */
async function handleList(client: OmniClient, options: ListOptions): Promise<void> {
  const result = await client.batchJobs.list({
    instanceId: options.instance,
    status: options.status?.split(',') as ('pending' | 'running' | 'completed' | 'failed' | 'cancelled')[] | undefined,
    jobType: options.type?.split(',') as ('targeted_chat_sync' | 'time_based_batch')[] | undefined,
    limit: options.limit ?? 20,
  });

  if (result.items.length === 0) {
    output.info('No batch jobs found.');
    return;
  }

  // Format for table display
  const jobs = result.items.map(
    (job: {
      id: string;
      jobType: string;
      status: string;
      processedItems: number;
      totalItems: number;
      progressPercent: number;
      createdAt: string;
    }) => ({
      id: job.id.slice(0, 8),
      type: job.jobType,
      status: job.status,
      progress: `${job.processedItems}/${job.totalItems}`,
      percent: `${job.progressPercent}%`,
      created: new Date(job.createdAt).toLocaleDateString(),
    }),
  );

  output.list(jobs);

  if (result.meta.hasMore) {
    output.info('More jobs available. Use --limit to see more.');
  }
}

/** Create a batch job */
async function handleCreate(client: OmniClient, options: CreateOptions): Promise<void> {
  // Validate required options based on type
  if (options.type === 'targeted_chat_sync' && !options.chat) {
    output.error('--chat is required for targeted_chat_sync jobs');
  }
  if (options.type === 'time_based_batch' && options.days === undefined) {
    output.error('--days is required for time_based_batch jobs');
  }

  const contentTypes = parseContentTypes(options.contentTypes);

  // First, get an estimate
  if (!options.noConfirm) {
    output.info('Estimating job scope...');

    try {
      const estimate = await client.batchJobs.estimate({
        jobType: options.type,
        instanceId: options.instance,
        chatId: options.chat,
        daysBack: options.days,
        limit: options.limit,
        contentTypes,
      });

      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(`\n${formatEstimate(estimate)}\n`);

      if (estimate.totalItems === 0) {
        output.info('No items to process. Job not created.');
        return;
      }

      // Auto-confirm for CLI usage (user can pipe yes if needed)
      output.info('Creating job...');
    } catch (err) {
      output.warn(`Could not estimate: ${err instanceof Error ? err.message : 'Unknown error'}`);
      output.info('Proceeding with job creation...');
    }
  }

  // Create the job
  const job = await client.batchJobs.create({
    jobType: options.type,
    instanceId: options.instance,
    chatId: options.chat,
    daysBack: options.days,
    limit: options.limit,
    contentTypes,
    force: options.force,
  });

  output.success(`Batch job created: ${job.id}`);
  output.info(`\nMonitor progress: omni batch status ${job.id} --watch`);
  output.info(`Cancel: omni batch cancel ${job.id}`);
}

/** Get job status */
async function handleStatus(client: OmniClient, jobId: string, options: StatusOptions): Promise<void> {
  if (options.watch) {
    // Watch mode - poll and update
    const interval = options.interval ?? 2000;
    let lastStatus = '';

    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log('Watching job status (Ctrl+C to stop)...\n');

    while (true) {
      try {
        const status = await client.batchJobs.getStatus(jobId);
        const display = formatJobStatus(status);

        // Clear previous output and show new status
        if (lastStatus) {
          const lines = lastStatus.split('\n').length;
          // Move cursor up and clear
          process.stdout.write(`\x1b[${lines}A\x1b[0J`);
        }

        // biome-ignore lint/suspicious/noConsole: CLI output
        console.log(display);
        lastStatus = display;

        // Exit if job is done
        if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
          // biome-ignore lint/suspicious/noConsole: CLI output
          console.log('\nJob finished.');
          break;
        }

        await sleep(interval);
      } catch (err) {
        output.error(`Failed to get status: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
  } else {
    // Single status check
    const status = await client.batchJobs.getStatus(jobId);
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(formatJobStatus(status));
  }
}

/** Cancel a job */
async function handleCancel(client: OmniClient, jobId: string): Promise<void> {
  const job = await client.batchJobs.cancel(jobId);
  output.success(`Job cancelled: ${job.id}`);
  output.info(`Final progress: ${job.processedItems}/${job.totalItems} (${job.progressPercent}%)`);
}

/** Estimate job scope */
async function handleEstimate(client: OmniClient, options: CreateOptions): Promise<void> {
  // Validate required options based on type
  if (options.type === 'targeted_chat_sync' && !options.chat) {
    output.error('--chat is required for targeted_chat_sync jobs');
  }
  if (options.type === 'time_based_batch' && options.days === undefined) {
    output.error('--days is required for time_based_batch jobs');
  }

  const contentTypes = parseContentTypes(options.contentTypes);

  const estimate = await client.batchJobs.estimate({
    jobType: options.type,
    instanceId: options.instance,
    chatId: options.chat,
    daysBack: options.days,
    limit: options.limit,
    contentTypes,
  });

  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(formatEstimate(estimate));
}

// ============================================================================
// COMMAND DEFINITION
// ============================================================================

export function createBatchCommand(): Command {
  const batch = new Command('batch').description('Manage batch media processing jobs');

  // List jobs
  batch
    .command('list')
    .description('List batch jobs')
    .option('--instance <id>', 'Filter by instance ID')
    .option('--status <status>', 'Filter by status (comma-separated: pending,running,completed,failed,cancelled)')
    .option('--type <type>', 'Filter by job type (targeted_chat_sync,time_based_batch)')
    .option('--limit <n>', 'Max results', Number.parseInt)
    .action(async (options: ListOptions) => {
      const client = getClient();
      try {
        await handleList(client, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list jobs: ${message}`);
      }
    });

  // Create job
  batch
    .command('create')
    .description('Create a batch processing job')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--type <type>', 'Job type: targeted_chat_sync or time_based_batch')
    .option('--chat <id>', 'Chat ID (required for targeted_chat_sync)')
    .option('--days <n>', 'Days to look back (required for time_based_batch)', Number.parseInt)
    .option('--limit <n>', 'Max items to process', Number.parseInt)
    .option('--content-types <types>', 'Content types: audio,image,video,document')
    .option('--force', 'Re-process items that already have content')
    .option('--no-confirm', 'Skip confirmation prompt')
    .action(async (options: CreateOptions) => {
      const client = getClient();
      try {
        await handleCreate(client, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to create job: ${message}`);
      }
    });

  // Get status
  batch
    .command('status <jobId>')
    .description('Get job status')
    .option('--watch', 'Watch for updates')
    .option('--interval <ms>', 'Poll interval in ms (default: 2000)', Number.parseInt)
    .action(async (jobId: string, options: StatusOptions) => {
      const client = getClient();
      try {
        await handleStatus(client, jobId, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get status: ${message}`);
      }
    });

  // Cancel job
  batch
    .command('cancel <jobId>')
    .description('Cancel a running job')
    .action(async (jobId: string) => {
      const client = getClient();
      try {
        await handleCancel(client, jobId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to cancel job: ${message}`);
      }
    });

  // Estimate
  batch
    .command('estimate')
    .description('Estimate job scope and cost without creating')
    .requiredOption('--instance <id>', 'Instance ID')
    .requiredOption('--type <type>', 'Job type: targeted_chat_sync or time_based_batch')
    .option('--chat <id>', 'Chat ID (required for targeted_chat_sync)')
    .option('--days <n>', 'Days to look back (required for time_based_batch)', Number.parseInt)
    .option('--limit <n>', 'Max items to process', Number.parseInt)
    .option('--content-types <types>', 'Content types: audio,image,video,document')
    .action(async (options: CreateOptions) => {
      const client = getClient();
      try {
        await handleEstimate(client, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to estimate: ${message}`);
      }
    });

  return batch;
}
