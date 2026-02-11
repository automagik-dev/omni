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

import { PROVIDER_SCHEMAS, type ProviderSchema } from '@omni/core';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

// Single source of truth: derive VALID_SCHEMAS from @omni/core (DEC-12)
const VALID_SCHEMAS: readonly string[] = PROVIDER_SCHEMAS;

// Schemas that require ws:// or wss:// URLs
const WS_ONLY_SCHEMAS: ProviderSchema[] = ['openclaw'];

/**
 * Validate URL scheme for a given schema.
 * OpenClaw requires ws:// or wss://.
 */
function validateUrlScheme(schema: string, baseUrl: string): string | null {
  if (WS_ONLY_SCHEMAS.includes(schema as ProviderSchema)) {
    if (!baseUrl.startsWith('ws://') && !baseUrl.startsWith('wss://')) {
      return `OpenClaw requires ws:// or wss:// URL scheme. Got: ${baseUrl}\nExample: --base-url ws://127.0.0.1:18789 or --base-url wss://gateway.example.com`;
    }
  }
  return null;
}

/** Validate create provider options, returning an error message or null */
function validateCreateOptions(options: { schema: string; baseUrl: string; defaultAgentId?: string }): string | null {
  if (!VALID_SCHEMAS.includes(options.schema)) {
    return `Invalid schema: ${options.schema}. Valid: ${[...VALID_SCHEMAS].join(', ')}`;
  }
  const urlError = validateUrlScheme(options.schema, options.baseUrl);
  if (urlError) return urlError;
  if (options.schema === 'openclaw' && !options.defaultAgentId) {
    return 'OpenClaw providers require --default-agent-id.\nExample: omni providers create --schema openclaw --default-agent-id sofia ...';
  }
  return null;
}

/** Get contextual hint for provider health check error */
function getHealthCheckHint(errorMsg: string): string {
  if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('connect ECONNREFUSED')) {
    return '\nHint: Cannot connect to gateway. Is it running?';
  }
  if (errorMsg.includes('401') || errorMsg.includes('auth') || errorMsg.includes('Unauthorized')) {
    return '\nHint: Gateway rejected the API key. Verify token with: omni providers get <id>';
  }
  if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
    return '\nHint: Connection timed out. Check network connectivity and URL.';
  }
  if (errorMsg.includes('WebSocket') && errorMsg.includes('state')) {
    return '\nHint: WebSocket is not connected. The gateway may be unreachable.';
  }
  return '';
}

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
    .requiredOption('--base-url <url>', 'API base URL (ws:// or wss:// for openclaw)')
    .requiredOption('--api-key <key>', 'API key')
    .option('--description <desc>', 'Provider description')
    .option('--timeout <seconds>', 'Default timeout in seconds', Number.parseInt, 60)
    .option('--stream', 'Enable streaming by default')
    .option('--default-agent-id <agentId>', 'Default agent ID (required for openclaw)')
    .action(
      async (options: {
        name: string;
        schema: string;
        baseUrl: string;
        apiKey: string;
        description?: string;
        timeout?: number;
        stream?: boolean;
        defaultAgentId?: string;
      }) => {
        const validationError = validateCreateOptions(options);
        if (validationError) {
          output.error(validationError);
          return;
        }

        // Build schemaConfig from flags
        const schemaConfig: Record<string, unknown> = {};
        if (options.defaultAgentId) {
          schemaConfig.defaultAgentId = options.defaultAgentId;
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
            schemaConfig: Object.keys(schemaConfig).length > 0 ? schemaConfig : undefined,
          });

          output.success(`Created provider: ${provider.id}`);
          output.data(provider);

          // Guided next steps
          output.info('\nNext steps:');
          output.info(`  1. Test connectivity:  omni providers test ${provider.id}`);
          output.info(
            `  2. Assign to instance: omni instances update <instance-id> --agent-provider-id ${provider.id}${options.defaultAgentId ? ` --agent-id ${options.defaultAgentId}` : ''}`,
          );
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
          const errorMsg = result.error ?? 'Unknown error';
          const hint = getHealthCheckHint(errorMsg);
          output.error(`Provider health check failed: ${errorMsg}${hint}`, {
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
