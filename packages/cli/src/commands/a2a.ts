/**
 * A2A Commands
 *
 * omni a2a list [--include-unconfigured]
 * omni a2a card <agent-id>
 * omni a2a send <instance-id> --text <message> [--context <id>] [--task <id>] [--wait]
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

interface A2AListOptions {
  includeUnconfigured?: boolean;
}

interface A2ASendOptions {
  text: string;
  context?: string;
  task?: string;
  wait?: boolean;
}

export function createA2ACommand(): Command {
  const a2a = new Command('a2a').description('A2A agent registry and JSON-RPC helpers');

  a2a
    .command('list')
    .description('List agents discoverable through A2A')
    .option('--include-unconfigured', 'Include active agents that do not have an active A2A instance')
    .action(async (options: A2AListOptions) => {
      const client = getClient();

      try {
        const agents = await client.a2a.listAgents({ includeUnconfigured: options.includeUnconfigured });
        const rows = agents.map((agent) => ({
          id: agent.agentId,
          name: agent.name,
          configured: agent.configured ? 'yes' : 'no',
          instance: agent.instanceId ?? '-',
          provider: agent.providerSchema ?? agent.provider ?? '-',
          model: agent.model ?? '-',
        }));

        output.list(rows, { emptyMessage: 'No A2A agents found.', rawData: agents });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list A2A agents: ${message}`);
      }
    });

  a2a
    .command('card <agent-id>')
    .description('Get the extended A2A Agent Card for an agent')
    .action(async (agentId: string) => {
      const client = getClient();

      try {
        const card = await client.a2a.getAgentCard(agentId);
        output.data(card);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get A2A Agent Card: ${message}`);
      }
    });

  a2a
    .command('send <instance-id>')
    .description('Send a text message to an A2A instance')
    .requiredOption('--text <message>', 'Text message to send')
    .option('--context <id>', 'A2A context id')
    .option('--task <id>', 'A2A task id')
    .option('--wait', 'Wait for completion instead of returning immediately')
    .action(async (instanceId: string, options: A2ASendOptions) => {
      const client = getClient();

      try {
        const result = await client.a2a.sendMessage(instanceId, options.text, {
          contextId: options.context,
          taskId: options.task,
          returnImmediately: !options.wait,
        });
        output.data(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to send A2A message: ${message}`);
      }
    });

  return a2a;
}
