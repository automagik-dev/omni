/**
 * Resync Command
 *
 * omni resync --instance <id> --since 2h
 * omni resync --instance <id> --since 2026-02-09T10:00:00Z
 * omni resync --all --since 1h
 *
 * Triggers history backfill for instances to recover missed messages.
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import { loadConfig } from '../config.js';
import { type Example, type OptionDef, formatExamples, formatOptionGroup } from '../help.js';
import * as output from '../output.js';

interface ResyncOptions {
  instance?: string;
  all?: boolean;
  since?: string;
  until?: string;
  dryRun?: boolean;
}

const options: OptionDef[] = [
  { flags: '-i, --instance <id>', description: 'Instance ID or name to resync' },
  { flags: '-a, --all', description: 'Resync all connected instances' },
  { flags: '-s, --since <duration>', description: 'Start time (duration: 2h, 30m, 1d) or ISO timestamp' },
  { flags: '-u, --until <timestamp>', description: 'End time (ISO timestamp, default: now)' },
  { flags: '--dry-run', description: 'Show what would be resynced without triggering' },
];

const examples: Example[] = [
  { command: 'omni resync -i wa-main --since 2h', description: 'Resync last 2 hours for wa-main' },
  { command: 'omni resync -i wa-main --since 2026-02-09T10:00:00Z', description: 'Resync since specific time' },
  { command: 'omni resync --all --since 1h', description: 'Resync all instances, last hour' },
  { command: 'omni resync -i wa-main --since 30m --dry-run', description: 'Preview what would be resynced' },
];

/** Resolve instance IDs from --all or --instance flag */
async function resolveInstanceIds(opts: ResyncOptions): Promise<string[] | null> {
  const client = getClient();

  if (opts.all) {
    const result = await client.instances.list();
    const ids = result.items.filter((i: { isActive: boolean }) => i.isActive).map((i: { id: string }) => i.id);
    if (ids.length === 0) {
      output.warn('No active instances found');
      return null;
    }
    output.info(`Found ${ids.length} active instance(s) to resync`);
    return ids;
  }

  if (opts.instance) {
    try {
      const instance = await client.instances.get(opts.instance);
      if (instance) return [(instance as { id: string }).id];
    } catch {
      // Assume it's already an ID
    }
    return [opts.instance];
  }

  return [];
}

/** Trigger resync API call for a single instance */
async function triggerResync(
  baseUrl: string,
  apiKey: string,
  instanceId: string,
  since: string,
  until?: string,
): Promise<boolean> {
  const resp = await fetch(`${baseUrl}/api/v2/instances/${instanceId}/resync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ since, until }),
  });

  if (resp.ok) {
    const result = (await resp.json()) as { data?: { message?: string } };
    output.success(result.data?.message ?? `Resync triggered for ${instanceId}`);
    return true;
  }

  const err = (await resp.json()) as { error?: { message?: string } };
  output.warn(`Failed for ${instanceId}: ${err.error?.message ?? resp.statusText}`);
  return false;
}

/** Execute resync for a list of instances, return {succeeded, failed} */
async function executeResync(instanceIds: string[], since: string, until?: string): Promise<void> {
  const config = loadConfig();
  const baseUrl = config.apiUrl ?? 'http://localhost:8881';
  const apiKey = config.apiKey ?? '';
  let succeeded = 0;
  let failed = 0;

  for (const instanceId of instanceIds) {
    try {
      const ok = await triggerResync(baseUrl, apiKey, instanceId, since, until);
      if (ok) succeeded++;
      else failed++;
    } catch (error) {
      output.warn(`Failed for ${instanceId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      failed++;
    }
  }

  if (instanceIds.length > 1) {
    output.info(`Resync complete: ${succeeded} succeeded, ${failed} failed`);
  }
}

/** Print dry-run summary */
function printDryRun(instanceIds: string[], since: string, until?: string): void {
  output.info('Dry run - would trigger resync for:');
  for (const id of instanceIds) {
    output.raw(`  - Instance: ${id}, since: ${since}${until ? `, until: ${until}` : ''}`);
  }
}

/** Validate required options, returns true if valid */
function validateOptions(opts: ResyncOptions): opts is ResyncOptions & { since: string } {
  if (!opts.instance && !opts.all) {
    output.error('Specify --instance <id> or --all');
    return false;
  }
  if (!opts.since) {
    output.error('Specify --since <duration> (e.g., 2h, 30m, 1d) or ISO timestamp');
    return false;
  }
  return true;
}

export function createResyncCommand(): Command {
  const cmd = new Command('resync')
    .description('Trigger history backfill to recover missed messages')
    .addHelpText('after', `\n${formatOptionGroup('Options', options)}\n${formatExamples(examples)}`);

  for (const opt of options) {
    cmd.option(opt.flags, opt.description);
  }

  cmd.action(async (opts: ResyncOptions) => {
    if (!validateOptions(opts)) return;

    const instanceIds = await resolveInstanceIds(opts);
    if (!instanceIds) return;

    if (opts.dryRun) {
      printDryRun(instanceIds, opts.since, opts.until);
      return;
    }

    await executeResync(instanceIds, opts.since, opts.until);
  });

  return cmd;
}
