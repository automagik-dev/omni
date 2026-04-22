/**
 * Agents Commands
 *
 * omni agents list [--provider <p>] [--inactive-only] [--limit <n>]
 * omni agents get <id>
 * omni agents create --name <name> --provider <provider> [--agent-provider <id>] [--model <model>] [--type <type>]
 *                  [--provider-agent-id <id>] [--config-path <path>] [--metadata <json>]
 * omni agents update <id> [--name <name>] [--model <model>] [--provider <provider>] [--agent-provider <id>] [--type <type>] [--active|--inactive]
 *                  [--provider-agent-id <id>] [--config-path <path>] [--metadata <json>]
 * omni agents delete <id>
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveAgentId } from '../resolve.js';

const VALID_PROVIDERS = ['claude', 'agno', 'openai', 'gemini', 'custom', 'omni-internal'] as const;
type AgentProvider = (typeof VALID_PROVIDERS)[number];

const VALID_TYPES = ['assistant', 'workflow', 'team', 'tool'] as const;
type AgentType = (typeof VALID_TYPES)[number];

interface UpdateAgentOptions {
  name?: string;
  model?: string;
  provider?: string;
  agentProvider?: string;
  type?: string;
  active?: boolean;
  inactive?: boolean;
  providerAgentId?: string;
  configPath?: string;
  metadata?: string;
}

interface UpdateAgentBody {
  name?: string;
  model?: string;
  provider?: AgentProvider;
  agentProviderId?: string;
  agentType?: AgentType;
  isActive?: boolean;
  configPath?: string;
  metadata?: Record<string, unknown>;
}

interface CreateAgentOptions {
  name: string;
  provider: string;
  model?: string;
  type?: string;
  agentProvider?: string;
  providerAgentId?: string;
  configPath?: string;
  metadata?: string;
}

/**
 * Parse a --metadata JSON string into a plain object. Exits with a CLI error on
 * invalid JSON or non-object payloads. Returns undefined when raw is omitted.
 */
function parseMetadataJson(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`--metadata is not valid JSON: ${message}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    output.error('--metadata must be a JSON object.');
  }

  return parsed as Record<string, unknown>;
}

/**
 * Compose metadata for create: parse --metadata (may be undefined) and merge
 * --provider-agent-id on top (flag wins over any providerAgentId embedded in
 * --metadata).
 */
function composeCreateMetadata(raw: string | undefined, providerAgentId?: string): Record<string, unknown> | undefined {
  const parsed = parseMetadataJson(raw);
  if (providerAgentId !== undefined) return { ...(parsed ?? {}), providerAgentId };
  return parsed;
}

/**
 * Validate enums for create and return a typed body. Calls output.error on invalid input.
 */
function buildCreateAgentBody(options: CreateAgentOptions): {
  name: string;
  provider: AgentProvider;
  model?: string;
  agentType: AgentType;
  agentProviderId?: string;
  configPath?: string;
  metadata?: Record<string, unknown>;
  capabilities: string[];
  isInternal: boolean;
  isActive: boolean;
} {
  if (!VALID_PROVIDERS.includes(options.provider as AgentProvider)) {
    output.error(`Invalid provider: ${options.provider}. Valid: ${VALID_PROVIDERS.join(', ')}`);
  }

  if (options.type && !VALID_TYPES.includes(options.type as AgentType)) {
    output.error(`Invalid type: ${options.type}. Valid: ${VALID_TYPES.join(', ')}`);
  }

  const metadata = composeCreateMetadata(options.metadata, options.providerAgentId);

  return {
    name: options.name,
    provider: options.provider as AgentProvider,
    model: options.model,
    agentType: (options.type ?? 'assistant') as AgentType,
    agentProviderId: options.agentProvider,
    configPath: options.configPath,
    metadata,
    capabilities: [],
    isInternal: false,
    isActive: true,
  };
}

/**
 * Build the PATCH body from CLI options, validating enums and flag conflicts.
 * Calls output.error (which exits) on any validation failure.
 */
function buildUpdateAgentBody(options: UpdateAgentOptions): UpdateAgentBody {
  if (options.active && options.inactive) {
    output.error('Cannot combine --active and --inactive.');
  }

  if (options.provider !== undefined && !VALID_PROVIDERS.includes(options.provider as AgentProvider)) {
    output.error(`Invalid provider: ${options.provider}. Valid: ${VALID_PROVIDERS.join(', ')}`);
  }

  if (options.type !== undefined && !VALID_TYPES.includes(options.type as AgentType)) {
    output.error(`Invalid type: ${options.type}. Valid: ${VALID_TYPES.join(', ')}`);
  }

  const body: UpdateAgentBody = {};
  if (options.name !== undefined) body.name = options.name;
  if (options.model !== undefined) body.model = options.model;
  if (options.provider !== undefined) body.provider = options.provider as AgentProvider;
  if (options.agentProvider !== undefined) body.agentProviderId = options.agentProvider;
  if (options.type !== undefined) body.agentType = options.type as AgentType;
  if (options.active) body.isActive = true;
  if (options.inactive) body.isActive = false;

  return body;
}

export function createAgentsCommand(): Command {
  const agents = new Command('agents').description('Manage AI agent entities');

  // omni agents list [--provider <p>] [--inactive-only] [--limit <n>]
  agents
    .command('list')
    .description('List all agents')
    .option('--provider <provider>', `Filter by provider (${VALID_PROVIDERS.join(', ')})`)
    .option('--inactive-only', 'Show only inactive agents')
    .option(
      '--limit <n>',
      'Max results',
      (v) => {
        const n = Number.parseInt(v, 10);
        if (!Number.isFinite(n) || n < 1) throw new Error(`Invalid limit: ${v}`);
        return n;
      },
      50,
    )
    .action(async (options: { provider?: string; inactiveOnly?: boolean; limit?: number }) => {
      const client = getClient();

      if (options.provider && !VALID_PROVIDERS.includes(options.provider as AgentProvider)) {
        output.error(`Invalid provider: ${options.provider}. Valid: ${VALID_PROVIDERS.join(', ')}`);
      }

      try {
        const { items } = await client.agents.list({
          provider: options.provider as AgentProvider | undefined,
          isActive: options.inactiveOnly ? false : undefined,
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
      const resolvedId = await resolveAgentId(id);
      const client = getClient();

      try {
        const agent = await client.agents.get(resolvedId);
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
    .option('--agent-provider <agentProviderId>', 'Link to an agent provider configuration')
    .option(
      '--provider-agent-id <id>',
      'Provider-internal agent identifier (e.g. agno agent name). Stored at metadata.providerAgentId; used by the dispatcher to resolve agentInternalId.',
    )
    .option('--config-path <path>', 'Path to the agent config file (DB column config_path)')
    .option(
      '--metadata <json>',
      'Additional metadata as JSON string. Merged into metadata; --provider-agent-id takes precedence if both provide providerAgentId.',
    )
    .action(async (options: CreateAgentOptions) => {
      const body = buildCreateAgentBody(options);

      try {
        const agent = await getClient().agents.create(body);
        output.success(`Agent created: ${agent.id}`);
        output.data(agent);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to create agent: ${message}`);
      }
    });

  // omni agents update <id> [--name <name>] [--model <model>] [--provider <provider>] [--agent-provider <id>] [--type <type>]
  //                        [--active|--inactive] [--provider-agent-id <id>] [--config-path <path>] [--metadata <json>]
  agents
    .command('update <id>')
    .description('Update an existing agent (partial patch; omitted fields are preserved)')
    .option('--name <name>', 'Agent name')
    .option('--model <model>', 'Model identifier (e.g. claude-sonnet-4-6)')
    .option('--provider <provider>', `AI provider (${VALID_PROVIDERS.join(', ')})`)
    .option('--agent-provider <agentProviderId>', 'Link to an agent provider configuration')
    .option('--type <type>', `Agent type (${VALID_TYPES.join(', ')})`)
    .option('--active', 'Mark agent as active')
    .option('--inactive', 'Mark agent as inactive')
    .option(
      '--provider-agent-id <id>',
      'Provider-internal agent identifier (e.g. agno agent name). Merged into metadata.providerAgentId; wins over any value in --metadata.',
    )
    .option('--config-path <path>', 'Path to the agent config file (DB column config_path)')
    .option(
      '--metadata <json>',
      'Additional metadata as JSON object. Merged shallowly into existing metadata; omitted keys are preserved. --provider-agent-id wins if both set providerAgentId.',
    )
    .action(async (id: string, options: UpdateAgentOptions) => {
      const body = buildUpdateAgentBody(options);
      if (options.configPath !== undefined) body.configPath = options.configPath;

      // Validate --metadata JSON up front (fails fast before any network call).
      const parsedMetadata = parseMetadataJson(options.metadata);
      const resolvedId = await resolveAgentId(id);
      const client = getClient();

      try {
        // Metadata is stored as a single JSONB column server-side; to avoid
        // clobbering keys the user didn't pass, fetch-then-merge whenever
        // --metadata or --provider-agent-id is supplied.
        if (parsedMetadata !== undefined || options.providerAgentId !== undefined) {
          const existing = await client.agents.get(resolvedId);
          const existingMetadata = (existing.metadata ?? {}) as Record<string, unknown>;
          const merged: Record<string, unknown> = { ...existingMetadata, ...(parsedMetadata ?? {}) };
          if (options.providerAgentId !== undefined) merged.providerAgentId = options.providerAgentId;
          body.metadata = merged;
        }

        if (Object.keys(body).length === 0) {
          output.error(
            'No fields to update. Pass at least one of --name, --model, --provider, --agent-provider, --type, --active, --inactive, --config-path, --metadata, --provider-agent-id.',
          );
        }

        const agent = await client.agents.update(resolvedId, body);
        output.data(agent);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to update agent: ${message}`, undefined, 3);
      }
    });

  // omni agents delete <id>
  agents
    .command('delete <id>')
    .description('Delete an agent (soft-delete, sets inactive)')
    .action(async (id: string) => {
      const resolvedId = await resolveAgentId(id);
      const client = getClient();

      try {
        await client.agents.delete(resolvedId);
        output.success(`Agent ${resolvedId} deleted.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to delete agent: ${message}`, undefined, 3);
      }
    });

  return agents;
}
