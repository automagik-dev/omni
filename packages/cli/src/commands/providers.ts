/**
 * Providers Commands
 *
 * omni providers list [--active]
 * omni providers get <id>
 * omni providers create --name <name> --schema <schema> --base-url <url> --api-key <key>
 * omni providers agents <id>
 * omni providers teams <id>
 * omni providers workflows <id>
 * omni providers test <id>
 * omni providers delete <id>
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

type ProviderSchema = 'agnoos' | 'a2a' | 'openai' | 'anthropic' | 'custom';
const VALID_SCHEMAS: ProviderSchema[] = ['agnoos', 'a2a', 'openai', 'anthropic', 'custom'];

export function createProvidersCommand(): Command {
  const providers = new Command('providers').description('Manage AI/agent providers');

  // omni providers list
  providers
    .command('list')
    .description('List available providers')
    .option('--active', 'Show only active providers')
    .action(async (options: { active?: boolean }) => {
      const client = getClient();

      try {
        const result = await client.providers.list({
          active: options.active,
        });

        const items = result.map((p) => ({
          id: p.id,
          name: p.name,
          schema: p.schema,
          active: p.isActive ? 'yes' : 'no',
        }));

        output.list(items, { emptyMessage: 'No providers found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list providers: ${message}`);
      }
    });

  // omni providers get <id>
  providers
    .command('get <id>')
    .description('Get provider details')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const provider = await client.providers.get(id);
        output.data(provider);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get provider: ${message}`);
      }
    });

  // omni providers create
  providers
    .command('create')
    .description('Create a new AI provider')
    .requiredOption('--name <name>', 'Provider name (unique)')
    .requiredOption('--schema <schema>', `Provider schema (${VALID_SCHEMAS.join(', ')})`)
    .requiredOption('--base-url <url>', 'API base URL')
    .requiredOption('--api-key <key>', 'API key')
    .option('--description <desc>', 'Provider description')
    .option('--timeout <seconds>', 'Default timeout in seconds', Number.parseInt, 60)
    .option('--stream', 'Enable streaming by default')
    .action(
      async (options: {
        name: string;
        schema: string;
        baseUrl: string;
        apiKey: string;
        description?: string;
        timeout?: number;
        stream?: boolean;
      }) => {
        if (!VALID_SCHEMAS.includes(options.schema as ProviderSchema)) {
          output.error(`Invalid schema: ${options.schema}`, {
            validSchemas: VALID_SCHEMAS,
          });
          return;
        }

        const client = getClient();

        try {
          const provider = await client.providers.create({
            name: options.name,
            schema: options.schema as ProviderSchema,
            baseUrl: options.baseUrl,
            apiKey: options.apiKey,
            description: options.description,
            defaultTimeout: options.timeout,
            defaultStream: options.stream ?? true,
          });

          output.success(`Created provider: ${provider.id}`);
          output.data(provider);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to create provider: ${message}`);
        }
      },
    );

  // omni providers test <id>
  providers
    .command('test <id>')
    .description('Test provider health')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const result = await client.providers.checkHealth(id);

        if (result.healthy) {
          output.success(`Provider is healthy (latency: ${result.latency}ms)`);
        } else {
          output.error(`Provider health check failed: ${result.error ?? 'Unknown error'}`, {
            latency: result.latency,
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to test provider: ${message}`);
      }
    });

  // omni providers agents <id>
  providers
    .command('agents <id>')
    .description('List agents from provider (Agno)')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const agents = await client.providers.listAgents(id);

        const items = agents.map((a) => ({
          id: a.agent_id,
          name: a.name,
          model: a.model?.name ?? '-',
          description: a.description?.slice(0, 50) ?? '-',
        }));

        output.list(items, { emptyMessage: 'No agents found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list agents: ${message}`);
      }
    });

  // omni providers teams <id>
  providers
    .command('teams <id>')
    .description('List teams from provider (Agno)')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const teams = await client.providers.listTeams(id);

        const items = teams.map((t) => ({
          id: t.team_id,
          name: t.name,
          mode: t.mode ?? '-',
          members: t.members?.length ?? 0,
          description: t.description?.slice(0, 50) ?? '-',
        }));

        output.list(items, { emptyMessage: 'No teams found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list teams: ${message}`);
      }
    });

  // omni providers workflows <id>
  providers
    .command('workflows <id>')
    .description('List workflows from provider (Agno)')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const workflows = await client.providers.listWorkflows(id);

        const items = workflows.map((w) => ({
          id: w.workflow_id,
          name: w.name,
          description: w.description?.slice(0, 50) ?? '-',
        }));

        output.list(items, { emptyMessage: 'No workflows found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list workflows: ${message}`);
      }
    });

  // omni providers delete <id>
  providers
    .command('delete <id>')
    .description('Delete a provider')
    .option('--force', 'Skip confirmation')
    .action(async (id: string, options: { force?: boolean }) => {
      const client = getClient();

      if (!options.force) {
        output.warn(`This will delete provider ${id}. Use --force to confirm.`);
        return;
      }

      try {
        await client.providers.delete(id);
        output.success(`Deleted provider: ${id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to delete provider: ${message}`);
      }
    });

  return providers;
}
