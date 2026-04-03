/**
 * Connect Command — omni connect <instance-id> <agent-name>
 *
 * One-command setup for Omni ↔ Genie NATS integration:
 *   1. Discovers agent via `genie agent directory <agent-name> --json`
 *   2. Creates/updates Omni provider with schema `nats-genie`
 *   3. Creates Omni agent record linked to provider
 *   4. Updates instance to use the new agent
 */

import { execFileSync } from 'node:child_process';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

interface GenieDirectoryEntry {
  name: string;
  dir: string;
  promptMode?: string;
  model?: string;
}

/** Find or create a provider, returning its ID */
async function findOrCreateProvider(
  client: ReturnType<typeof getClient>,
  agentName: string,
  agentEntry: GenieDirectoryEntry,
  natsUrl: string,
): Promise<string | null> {
  try {
    const response = await client.post('/providers', {
      name: `nats-genie-${agentName}`,
      schema: 'nats-genie',
      baseUrl: `nats://${natsUrl}`,
      schemaConfig: { agentName: agentEntry.name, agentDir: agentEntry.dir, natsUrl },
    });
    return (response.data as Record<string, unknown>).id as string;
  } catch {
    // Provider may already exist — try to find it
    try {
      const listResponse = await client.get('/providers');
      const providers = (listResponse.data as Record<string, unknown>[]) || [];
      const existing = providers.find((p) => p.name === `nats-genie-${agentName}` && p.schema === 'nats-genie');
      if (existing) {
        output.info(`Using existing provider: ${existing.id}`);
        return existing.id as string;
      }
    } catch {
      // fall through
    }
    output.error('Failed to create provider. Check API connection.');
    return null;
  }
}

/** Find or create an agent record, returning its ID */
async function findOrCreateAgent(
  client: ReturnType<typeof getClient>,
  agentName: string,
  providerId: string,
): Promise<string | null> {
  try {
    const response = await client.post('/agents', { name: agentName, providerId, type: 'agent' });
    return (response.data as Record<string, unknown>).id as string;
  } catch {
    try {
      const listResponse = await client.get('/agents');
      const agentsList = (listResponse.data as Record<string, unknown>[]) || [];
      const existing = agentsList.find((a) => a.name === agentName && a.providerId === providerId);
      if (existing) {
        output.info(`Using existing agent: ${existing.id}`);
        return existing.id as string;
      }
    } catch {
      // fall through
    }
    output.error('Failed to create agent record. Check API connection.');
    return null;
  }
}

export function createConnectCommand(): Command {
  return new Command('connect')
    .description('Connect an Omni instance to a Genie agent via NATS')
    .argument('<instance-id>', 'Omni instance ID')
    .argument('<agent-name>', 'Genie agent name (from genie directory)')
    .option('--nats-url <url>', 'NATS server URL', 'localhost:4222')
    .action(async (instanceId: string, agentName: string, options: { natsUrl: string }) => {
      const client = getClient();

      // 1. Discover agent from genie directory
      output.info(`Discovering agent "${agentName}" from genie directory...`);

      let agentEntry: GenieDirectoryEntry;
      try {
        const stdout = execFileSync('genie', ['dir', 'get', agentName, '--json'], {
          encoding: 'utf-8',
          env: process.env,
          timeout: 10_000,
        });
        agentEntry = JSON.parse(stdout.trim());
      } catch {
        output.error(
          `Failed to discover agent "${agentName}" from genie directory.\nMake sure genie is installed and the agent is registered:\n  genie dir add ${agentName} --dir /path/to/agent`,
        );
        return;
      }

      output.info(`Found agent: ${agentEntry.name} (dir: ${agentEntry.dir})`);

      // 2. Verify instance exists
      let instance: Record<string, unknown>;
      try {
        const response = await client.get(`/instances/${instanceId}`);
        instance = response.data as Record<string, unknown>;
      } catch {
        output.error(`Instance "${instanceId}" not found. Run: omni instances list`);
        return;
      }

      const instanceName = (instance.name as string) || instanceId;

      // 3. Create or find provider
      output.info('Creating NATS Genie provider...');
      const providerId = await findOrCreateProvider(client, agentName, agentEntry, options.natsUrl);
      if (!providerId) return;

      // 4. Create or find agent record
      output.info('Creating agent record...');
      const agentId = await findOrCreateAgent(client, agentName, providerId);
      if (!agentId) return;

      // 5. Update instance to use the agent
      output.info('Updating instance agent assignment...');
      try {
        await client.patch(`/instances/${instanceId}`, { agentProviderId: providerId });
      } catch {
        output.warn('Could not update instance agent assignment automatically.');
        output.info(`Set manually: omni instances update ${instanceId} --agent-provider-id ${providerId}`);
      }

      // Done
      output.success(
        `Connected instance "${instanceName}" to genie agent "${agentName}".\n  NATS topics:\n    Inbound:  omni.message.${instanceId}.*\n    Outbound: omni.reply.${instanceId}.*\n\n  Next: Start the genie bridge:\n    genie omni start`,
      );
    });
}
