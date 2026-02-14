/**
 * Person Commands
 *
 * omni persons search <query>
 * omni persons get <id>
 * omni persons presence <id>
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolvePersonId } from '../resolve.js';

export function createPersonsCommand(): Command {
  const persons = new Command('persons').description('Search and manage persons');

  // omni persons search <query>
  // Note: --instance flag not added yet - SDK doesn't support instance filtering for persons
  persons
    .command('search <query>')
    .description('Search for persons')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10), 20)
    .action(async (query: string, options: { limit?: number }) => {
      const client = getClient();

      try {
        const results = await client.persons.search({
          search: query,
          limit: options.limit,
        });

        const items = results.map((p) => ({
          id: p.id,
          displayName: p.displayName ?? '-',
          email: p.email ?? '-',
          phone: p.phone ?? '-',
        }));

        output.list(items, { emptyMessage: 'No persons found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to search persons: ${message}`);
      }
    });

  // omni persons get <id>
  persons
    .command('get <id>')
    .description('Get person details')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const personId = await resolvePersonId(id);
        const person = await client.persons.get(personId);
        output.data(person);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get person: ${message}`, undefined, 3);
      }
    });

  // omni persons presence <id>
  persons
    .command('presence <id>')
    .description('Get person presence and activity info')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const personId = await resolvePersonId(id);
        const presence = await client.persons.presence(personId);
        output.data(presence);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get presence: ${message}`, undefined, 3);
      }
    });

  return persons;
}
