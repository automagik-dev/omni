/**
 * Agents Commands
 *
 * omni agents list [--provider <p>] [--inactive] [--limit <n>]
 * omni agents get <id>
 * omni agents create --name <name> --provider <provider> [--instance <id>] [--model <model>] [--type <type>]
 * omni agents delete <id>
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

const VALID_PROVIDERS = ['claude', 'agno', 'openai', 'gemini', 'custom', 'omni-internal'] as const;
type AgentProvider = (typeof VALID_PROVIDERS)[number];

const VALID_TYPES = ['assistant', 'workflow', 'team', 'tool'] as const;
type AgentType = (typeof VALID_TYPES)[number];

export function createAgentsCommand(): Command {
  const agents = new Command('agents').description('Manage AI agent entities');

  // omni agents list [--provider <p>] [--inactive] [--limit <n>]
  agents
    .command('list')
    .description('List all agents')
    .option('--provider <provider>', `Filter by provider (${VALID_PROVIDERS.join(', ')})`)
    .option('--inactive', 'Include inactive agents only')
    .option('--limit <n>', 'Max results', (v) => Number.parseInt(v, 10), 50)
    .action(async (options: { provider?: string; inactive?: boolean; limit?: number }) => {
      const client = getClient();

      if (options.provider && !VALID_PROVIDERS.includes(options.provider as AgentProvider)) {
        output.error(`Invalid provider: ${options.provider}. Valid: ${VALID_PROVIDERS.join(', ')}`);
      }

      try {
        const { items } = await client.agents.list({
          provider: options.provider as AgentProvider | undefined,
          isActive: options.inactive ? false : undefined,
          limit: options.limit,
        });

        const rows = items.map((a) => ({
          id: a.id,
          name: a.name,
          provider: a.provider,
          type: a.agentType,
          model: a.model ?? '-',
          active: a.isActive ? 'yes' : 'no',
        }));

        output.list(rows, { emptyMessage: 'No agents found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list agents: ${message}`);
      }
    });

  // omni agents get <id>
  agents
    .command('get <id>')
    .description('Get agent details')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const agent = await client.agents.get(id);
        output.data(agent);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get agent: ${message}`, undefined, 3);
      }
    });

  // omni agents create --name <name> --provider <provider> [options]
  agents
    .command('create')
    .description('Create a new agent')
    .requiredOption('--name <name>', 'Agent name')
    .requiredOption('--provider <provider>', `AI provider (${VALID_PROVIDERS.join(', ')})`)
    .option('--model <model>', 'Model identifier (e.g. claude-sonnet-4-6)')
    .option('--type <type>', `Agent type (${VALID_TYPES.join(', ')})`, 'assistant')
    .option('--instance <instanceId>', 'Link to an instance (sets agentProviderId)')
    .action(
      async (options: {
        name: string;
        provider: string;
        model?: string;
        type?: string;
        instance?: string;
      }) => {
        const client = getClient();

        if (!VALID_PROVIDERS.includes(options.provider as AgentProvider)) {
          output.error(`Invalid provider: ${options.provider}. Valid: ${VALID_PROVIDERS.join(', ')}`);
        }

        if (options.type && !VALID_TYPES.includes(options.type as AgentType)) {
          output.error(`Invalid type: ${options.type}. Valid: ${VALID_TYPES.join(', ')}`);
        }

        try {
          const agent = await client.agents.create({
            name: options.name,
            provider: options.provider as AgentProvider,
            model: options.model,
            agentType: (options.type ?? 'assistant') as AgentType,
            agentProviderId: options.instance,
            capabilities: [],
            isInternal: false,
            isActive: true,
          });

          output.success(`Agent created: ${agent.id}`);
          output.data(agent);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to create agent: ${message}`);
        }
      },
    );

  // omni agents delete <id>
  agents
    .command('delete <id>')
    .description('Delete an agent (soft-delete, sets inactive)')
    .action(async (id: string) => {
      const client = getClient();

      try {
        await client.agents.delete(id);
        output.success(`Agent ${id} deleted.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to delete agent: ${message}`, undefined, 3);
      }
    });

  return agents;
}
