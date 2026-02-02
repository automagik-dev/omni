/**
 * Event Commands
 *
 * omni events list --instance <id>
 * omni events search <query>
 * omni events timeline <person-id>
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

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
    .option('--limit <n>', 'Limit results', Number.parseInt, 50)
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
    .option('--limit <n>', 'Limit results', Number.parseInt, 50)
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
    .option('--limit <n>', 'Limit results', Number.parseInt, 50)
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

  return events;
}
