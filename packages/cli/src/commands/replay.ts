/**
 * Replay Command
 *
 * omni replay <instanceId> [--since <iso-timestamp>]
 *
 * Manually triggers agent replay for missed messages on an instance.
 * Re-dispatches inbound messages received since the given timestamp
 * (or lastSeenAt, capped at 24h ago) through the normal agent pipeline.
 */

import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { type Example, type OptionDef, formatExamples, formatOptionGroup } from '../help.js';
import * as output from '../output.js';
import { resolveInstanceId } from '../resolve.js';

interface ReplayOptions {
  since?: string;
}

const options: OptionDef[] = [
  {
    flags: '-s, --since <timestamp>',
    description: 'Replay messages received after this ISO 8601 timestamp (default: lastSeenAt, max 24h ago)',
  },
];

const examples: Example[] = [
  { command: 'omni replay wa-main', description: 'Replay missed messages for wa-main (since lastSeenAt)' },
  {
    command: 'omni replay wa-main --since 2026-02-27T10:00:00Z',
    description: 'Replay messages received after a specific timestamp',
  },
];

interface ReplayResponseData {
  message: string;
  replayed: number;
  skipped: number;
  since: string;
  until: string;
}

interface ReplayResponse {
  data?: ReplayResponseData;
  error?: { code?: string; message?: string };
}

/**
 * Trigger replay via API and print result
 */
async function triggerReplay(baseUrl: string, apiKey: string, instanceId: string, since?: string): Promise<void> {
  const body: Record<string, string> = {};
  if (since) body.since = since;

  const resp = await fetch(`${baseUrl}/api/v2/instances/${instanceId}/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
  });

  const json = (await resp.json()) as ReplayResponse;

  if (resp.ok && json.data) {
    output.success(json.data.message);
    output.data({
      replayed: json.data.replayed,
      skipped: json.data.skipped,
      since: json.data.since,
      until: json.data.until,
    });
    return;
  }

  const errMsg = json.error?.message ?? `API error: ${resp.status}`;
  output.error(`Replay failed: ${errMsg}`);
}

/**
 * Resolve instance ID from argument, output error and return null on failure
 */
async function tryResolveInstanceId(instanceId: string): Promise<string | null> {
  try {
    return await resolveInstanceId(instanceId);
  } catch (_err) {
    output.error(`Instance not found: ${instanceId}`);
    return null;
  }
}

/**
 * Validate the --since timestamp, output error and return false if invalid
 */
function validateSince(since: string): boolean {
  const parsed = new Date(since);
  if (Number.isNaN(parsed.getTime())) {
    output.error(`Invalid --since timestamp: "${since}". Use ISO 8601 format (e.g. 2026-02-27T10:00:00Z)`);
    return false;
  }
  return true;
}

export function createReplayCommand(): Command {
  const cmd = new Command('replay')
    .description('Replay missed messages for an agent instance')
    .argument('<instanceId>', 'Instance ID or name')
    .addHelpText('after', `\n${formatOptionGroup('Options', options)}\n${formatExamples(examples)}`);

  for (const opt of options) {
    cmd.option(opt.flags, opt.description);
  }

  cmd.action(async (instanceId: string, opts: ReplayOptions) => {
    const config = loadConfig();
    const baseUrl = config.apiUrl ?? 'http://localhost:8882';
    const apiKey = config.apiKey ?? '';

    const resolvedId = await tryResolveInstanceId(instanceId);
    if (!resolvedId) return;

    if (opts.since && !validateSince(opts.since)) return;

    output.info(`Triggering replay for instance: ${resolvedId}${opts.since ? ` (since: ${opts.since})` : ''}`);

    try {
      await triggerReplay(baseUrl, apiKey, resolvedId, opts.since);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      output.error(`Failed to trigger replay: ${message}`);
    }
  });

  return cmd;
}
