/**
 * Event Commands
 *
 * omni events list --instance <id>
 * omni events search <query>
 * omni events timeline <person-id>
 */

import type { OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import { loadConfig } from '../config.js';
import * as output from '../output.js';

/** Replay command options */
interface ReplayOptions {
  start?: boolean;
  since?: string;
  until?: string;
  types?: string;
  instance?: string;
  speed?: number;
  dryRun?: boolean;
  status?: string;
  cancel?: string;
}

/** Parse time duration like "24h", "7d", "1w" into ISO timestamp */
function parseSinceTime(since: string): string {
  const match = since.match(/^(\d+)([hdwm])$/);
  if (!match) {
    // Assume ISO timestamp
    return since;
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  const now = Date.now();
  let ms: number;

  switch (unit) {
    case 'h':
      ms = value * 60 * 60 * 1000;
      break;
    case 'd':
      ms = value * 24 * 60 * 60 * 1000;
      break;
    case 'w':
      ms = value * 7 * 24 * 60 * 60 * 1000;
      break;
    case 'm':
      ms = value * 30 * 24 * 60 * 60 * 1000;
      break;
    default:
      return since;
  }

  return new Date(now - ms).toISOString();
}

/** Cancel a replay session */
async function cancelReplay(client: OmniClient, id: string): Promise<void> {
  await client.eventOps.cancelReplay(id);
  output.success(`Replay session cancelled: ${id}`);
}

/** Get replay session status */
async function getReplayStatus(client: OmniClient, id: string): Promise<void> {
  const session = await client.eventOps.getReplay(id);
  output.data(session);
}

/** Start a new replay session */
async function startReplay(client: OmniClient, options: ReplayOptions): Promise<void> {
  if (!options.since) {
    output.error('--since is required when starting a replay');
    return;
  }

  const session = await client.eventOps.startReplay({
    since: parseSinceTime(options.since),
    until: options.until ? parseSinceTime(options.until) : undefined,
    eventTypes: options.types?.split(','),
    instanceId: options.instance,
    speedMultiplier: options.speed,
    dryRun: options.dryRun,
  });

  output.success(`Replay session started: ${session.id}`, {
    id: session.id,
    status: session.status,
    since: session.options.since,
    until: session.options.until,
  });
}

/** List all replay sessions */
async function listReplays(client: OmniClient): Promise<void> {
  const sessions = await client.eventOps.listReplays();

  const items = sessions.map((s) => ({
    id: s.id,
    status: s.status,
    since: s.options.since,
    until: s.options.until ?? '-',
    progress: s.progress ?? '-',
  }));

  output.list(items, { emptyMessage: 'No replay sessions found.' });
}

/** Analytics response shape */
interface AnalyticsData {
  totalMessages: number;
  successfulMessages: number;
  failedMessages: number;
  successRate: number;
  avgProcessingTimeMs: number | null;
  avgAgentTimeMs: number | null;
  messageTypes: Record<string, number>;
  errorStages: Record<string, number>;
  instances: Record<string, number>;
}

/** Fetch analytics from the API */
async function fetchAnalytics(options: {
  instance?: string;
  since?: string;
  allTime?: boolean;
}): Promise<AnalyticsData> {
  const config = loadConfig();
  const baseUrl = config.apiUrl ?? 'http://localhost:8881';

  const params = new URLSearchParams();
  if (options.instance) params.set('instanceId', options.instance);
  if (options.allTime) params.set('allTime', 'true');
  if (options.since) params.set('since', parseSinceTime(options.since));

  const resp = await fetch(`${baseUrl}/api/v2/events/analytics?${params}`, {
    headers: { 'x-api-key': config.apiKey ?? '' },
  });

  if (!resp.ok) {
    throw new Error(`API returned ${resp.status}: ${await resp.text()}`);
  }

  return (await resp.json()) as AnalyticsData;
}

/** Display analytics data */
function displayAnalytics(data: AnalyticsData): void {
  output.data({
    totalMessages: data.totalMessages,
    successful: data.successfulMessages,
    failed: data.failedMessages,
    successRate: `${(data.successRate * 100).toFixed(1)}%`,
    avgProcessingMs: data.avgProcessingTimeMs ?? '-',
    avgAgentMs: data.avgAgentTimeMs ?? '-',
  });

  displayRecordBreakdown('Message Types', data.messageTypes, 'type');
  displayRecordBreakdown('Per Instance', data.instances, 'instanceId');
  displayRecordBreakdown('Error Stages', data.errorStages, 'stage');
}

/** Display a record as a sorted list */
function displayRecordBreakdown(title: string, record: Record<string, number>, keyName: string): void {
  if (!record || Object.keys(record).length === 0) return;
  output.raw(`\n${title}:`);
  const items = Object.entries(record)
    .sort(([, a], [, b]) => b - a)
    .map(([key, count]) => ({ [keyName]: key, count }));
  output.list(items);
}

export function createEventsCommand(): Command {
  const events = new Command('events').description('Query events');

  // omni events list
  events
    .command('list')
    .description('List events')
    .option('--instance <id>', 'Filter by instance ID')
    .option('--channel <type>', 'Filter by channel type')
    .option('--type <type>', 'Filter by event type')
    .option('--since <time>', 'Events since (e.g., 24h, 7d, or ISO timestamp)')
    .option('--until <time>', 'Events until (ISO timestamp)')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10), 50)
    .action(
      async (options: {
        instance?: string;
        channel?: string;
        type?: string;
        since?: string;
        until?: string;
        limit?: number;
      }) => {
        const client = getClient();

        try {
          const result = await client.events.list({
            instanceId: options.instance,
            channel: options.channel,
            eventType: options.type,
            since: options.since ? parseSinceTime(options.since) : undefined,
            until: options.until,
            limit: options.limit,
          });

          const items = result.items.map((e) => ({
            id: e.id,
            type: e.eventType,
            instanceId: e.instanceId,
            direction: e.direction,
            receivedAt: e.receivedAt,
          }));

          output.list(items, { emptyMessage: 'No events found.' });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to list events: ${message}`);
        }
      },
    );

  // omni events search <query>
  events
    .command('search <query>')
    .description('Search events by content')
    .option('--since <time>', 'Events since (e.g., 24h, 7d)')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10), 50)
    .action(async (query: string, options: { since?: string; limit?: number }) => {
      const client = getClient();

      try {
        const result = await client.events.list({
          search: query,
          since: options.since ? parseSinceTime(options.since) : undefined,
          limit: options.limit,
        });

        const items = result.items.map((e) => ({
          id: e.id,
          type: e.eventType,
          instanceId: e.instanceId,
          direction: e.direction,
          receivedAt: e.receivedAt,
        }));

        output.list(items, { emptyMessage: 'No matching events found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to search events: ${message}`);
      }
    });

  // omni events timeline <person-id>
  events
    .command('timeline <personId>')
    .description('Show event timeline for a person')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10), 50)
    .action(async (personId: string, options: { limit?: number }) => {
      const client = getClient();

      try {
        // Get events related to this person
        // Note: The API might need a specific endpoint for person timeline
        // For now, we search by person ID
        const result = await client.events.list({
          search: personId,
          limit: options.limit,
        });

        const items = result.items.map((e) => ({
          id: e.id,
          type: e.eventType,
          instanceId: e.instanceId,
          direction: e.direction,
          receivedAt: e.receivedAt,
        }));

        output.list(items, { emptyMessage: `No events found for person: ${personId}` });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get timeline: ${message}`);
      }
    });

  // omni events metrics
  events
    .command('metrics')
    .description('Get event processing metrics')
    .action(async () => {
      const client = getClient();

      try {
        const metrics = await client.eventOps.metrics();
        output.data(metrics);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get metrics: ${message}`);
      }
    });

  // omni events analytics
  events
    .command('analytics')
    .description('Show event analytics summary')
    .option('--instance <id>', 'Filter by instance ID')
    .option('--since <time>', 'Events since (e.g., 24h, 7d, or ISO timestamp)')
    .option('--all-time', 'Show all-time stats (default: last 24h)')
    .action(async (options: { instance?: string; since?: string; allTime?: boolean }) => {
      try {
        const data = await fetchAnalytics(options);
        displayAnalytics(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get analytics: ${message}`);
      }
    });

  // omni events replay
  events
    .command('replay')
    .description('Start, list, or manage replay sessions')
    .option('--start', 'Start a new replay session')
    .option('--since <time>', 'Replay events since (required with --start)')
    .option('--until <time>', 'Replay events until')
    .option('--types <types>', 'Comma-separated event types to replay')
    .option('--instance <id>', 'Filter by instance ID')
    .option('--speed <n>', 'Speed multiplier', (v) => Number.parseFloat(v))
    .option('--dry-run', "Dry run (don't actually process)")
    .option('--status <id>', 'Get status of a replay session')
    .option('--cancel <id>', 'Cancel a replay session')
    .action(async (options: ReplayOptions) => {
      const client = getClient();

      try {
        if (options.cancel) {
          await cancelReplay(client, options.cancel);
        } else if (options.status) {
          await getReplayStatus(client, options.status);
        } else if (options.start) {
          await startReplay(client, options);
        } else {
          await listReplays(client);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to manage replay: ${message}`);
      }
    });

  return events;
}
