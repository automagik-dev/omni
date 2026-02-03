/**
 * Dead Letters Commands
 *
 * omni dead-letters list [--status <status>] [--type <event-type>]
 * omni dead-letters get <id>
 * omni dead-letters stats
 * omni dead-letters retry <id>
 * omni dead-letters resolve <id> --note <note>
 * omni dead-letters abandon <id>
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

export function createDeadLettersCommand(): Command {
  const deadLetters = new Command('dead-letters').description('Manage failed events (dead letters)');

  // omni dead-letters list
  deadLetters
    .command('list')
    .description('List dead letters')
    .option('--status <status>', 'Filter by status (pending, retrying, resolved, abandoned)')
    .option('--type <type>', 'Filter by event type')
    .option('--since <date>', 'Filter by date (ISO format or relative like "24h")')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10), 20)
    .action(async (options: { status?: string; type?: string; since?: string; limit?: number }) => {
      const client = getClient();

      try {
        const result = await client.deadLetters.list({
          status: options.status,
          eventType: options.type,
          since: options.since,
          limit: options.limit,
        });

        const items = result.items.map((d) => ({
          id: d.id,
          eventType: d.eventType,
          status: d.status,
          attempts: d.retryCount,
          error: d.errorMessage ? d.errorMessage.substring(0, 50) : '-',
          createdAt: d.createdAt,
        }));

        output.list(items, { emptyMessage: 'No dead letters found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list dead letters: ${message}`);
      }
    });

  // omni dead-letters get <id>
  deadLetters
    .command('get <id>')
    .description('Get dead letter details')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const deadLetter = await client.deadLetters.get(id);
        output.data(deadLetter);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get dead letter: ${message}`);
      }
    });

  // omni dead-letters stats
  deadLetters
    .command('stats')
    .description('Get dead letter statistics')
    .action(async () => {
      const client = getClient();

      try {
        const stats = await client.deadLetters.stats();
        output.data(stats);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get stats: ${message}`);
      }
    });

  // omni dead-letters retry <id>
  deadLetters
    .command('retry <id>')
    .description('Retry processing a dead letter')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const result = await client.deadLetters.retry(id);
        if (result.success) {
          output.success(`Dead letter queued for retry: ${id}`);
        } else {
          output.error(`Failed to retry: ${result.error ?? 'Unknown error'}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to retry dead letter: ${message}`);
      }
    });

  // omni dead-letters resolve <id>
  deadLetters
    .command('resolve <id>')
    .description('Mark a dead letter as resolved')
    .requiredOption('--note <note>', 'Resolution note explaining why this was resolved')
    .action(async (id: string, options: { note: string }) => {
      const client = getClient();

      try {
        const deadLetter = await client.deadLetters.resolve(id, { note: options.note });
        output.success(`Dead letter resolved: ${id}`, {
          id: deadLetter.id,
          status: deadLetter.status,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to resolve dead letter: ${message}`);
      }
    });

  // omni dead-letters abandon <id>
  deadLetters
    .command('abandon <id>')
    .description('Abandon a dead letter (stop retry attempts)')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const deadLetter = await client.deadLetters.abandon(id);
        output.success(`Dead letter abandoned: ${id}`, {
          id: deadLetter.id,
          status: deadLetter.status,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to abandon dead letter: ${message}`);
      }
    });

  return deadLetters;
}
