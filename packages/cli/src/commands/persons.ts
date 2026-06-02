/**
 * Person Commands
 *
 * omni persons search <query>
 * omni persons get <id>
 * omni persons presence <id>
 * omni persons update <id> [--name] [--phone] [--email] [--avatar] [--metadata]
 * omni persons merge <source> <target> [--reason]
 * omni persons link <identityA> <identityB>
 * omni persons unlink <identityId> [--reason]
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

        const persons = results as Array<{
          id: string;
          displayName: string | null;
          primaryEmail?: string | null;
          primaryPhone?: string | null;
          email?: string | null;
          phone?: string | null;
        }>;
        const items = persons.map((p) => ({
          id: p.id,
          displayName: p.displayName ?? '-',
          email: p.primaryEmail ?? p.email ?? '-',
          phone: p.primaryPhone ?? p.phone ?? '-',
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

  // omni persons update <id>
  persons
    .command('update <id>')
    .description('Update person fields')
    .option('--name <name>', 'Display name')
    .option('--phone <phone>', 'Primary phone (E.164 format)')
    .option('--email <email>', 'Primary email')
    .option('--avatar <url>', 'Avatar URL')
    .option('--metadata <json>', 'Metadata as JSON string')
    .action(
      async (
        id: string,
        options: {
          name?: string;
          phone?: string;
          email?: string;
          avatar?: string;
          metadata?: string;
        },
      ) => {
        const client = getClient();

        try {
          const personId = await resolvePersonId(id);

          const data: Record<string, unknown> = {};
          if (options.name !== undefined) data.displayName = options.name;
          if (options.phone !== undefined) data.primaryPhone = options.phone;
          if (options.email !== undefined) data.primaryEmail = options.email;
          if (options.avatar !== undefined) data.avatarUrl = options.avatar;
          if (options.metadata !== undefined) {
            try {
              data.metadata = JSON.parse(options.metadata);
            } catch {
              output.error('Invalid JSON for --metadata');
            }
          }

          if (Object.keys(data).length === 0) {
            output.error('No fields to update. Use --name, --phone, --email, --avatar, or --metadata.');
          }

          const person = await client.persons.update(personId, data);
          output.success('Person updated');
          output.data(person);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to update person: ${message}`);
        }
      },
    );

  // omni persons merge <source> <target>
  persons
    .command('merge <source> <target>')
    .description('Merge source person into target (source is deleted)')
    .option('--reason <reason>', 'Reason for merge')
    .action(async (source: string, target: string, options: { reason?: string }) => {
      const client = getClient();

      try {
        const sourceId = await resolvePersonId(source);
        const targetId = await resolvePersonId(target);

        const result = await client.persons.merge(sourceId, targetId, options.reason);
        output.success(
          `Merged person ${result.deletedPersonId.slice(0, 8)} into ${result.person.id.slice(0, 8)} (${result.mergedIdentityIds.length} identities moved)`,
        );
        output.data(result.person);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to merge persons: ${message}`);
      }
    });

  // omni persons link <identityA> <identityB>
  persons
    .command('link <identityA> <identityB>')
    .description('Link two platform identities to the same person')
    .action(async (identityA: string, identityB: string) => {
      const client = getClient();

      try {
        const person = await client.persons.link(identityA, identityB);
        output.success(`Identities linked under person ${person.id.slice(0, 8)}`);
        output.data(person);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to link identities: ${message}`);
      }
    });

  // omni persons unlink <identityId>
  persons
    .command('unlink <identityId>')
    .description('Unlink a platform identity from its person')
    .option('--reason <reason>', 'Reason for unlinking', 'Manual unlink')
    .action(async (identityId: string, options: { reason: string }) => {
      const client = getClient();

      try {
        const result = await client.persons.unlink(identityId, options.reason);
        output.success(`Identity unlinked, new person ${result.person.id.slice(0, 8)} created`);
        output.data(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to unlink identity: ${message}`);
      }
    });

  return persons;
}
