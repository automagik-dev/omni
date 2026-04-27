/**
 * Providers Commands
 *
 * omni providers list [--active]
 * omni providers get <id>
 * omni providers create --name <name> --schema <schema> --base-url <url> [--api-key <key>]
 *   Claude Code: --project-path <path> [--max-turns <n>] [--permission-mode <mode>]
 *   OpenClaw: --default-agent-id <id>
 *   nats-genie: --agent-name <name> --target-agent <name> [--team-name <template>]
 * omni providers update <id> [--name <name>] [--base-url <url>] [--api-key <key>] [--schema-config <json>]
 * omni providers setup openclaw --gateway-url <url> --gateway-token <token> --agent-id <id>
 * omni providers agents <id>
 * omni providers teams <id>
 * omni providers workflows <id>
 * omni providers test <id>
 * omni providers delete <id>
 */

import { PROVIDER_SCHEMAS, type ProviderSchema } from '@omni/core';
import type { AgnoAgent, AgnoTeam, AgnoWorkflow } from '@automagik/omni-sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveProviderId } from '../resolve.js';
import { createSetupCommand } from './providers-setup.js';

/**
 * Map agno 2.5+ (`id`) and pre-2.5 (`agent_id`) agent shapes to the list row.
 */
function mapAgnoAgentRow(a: AgnoAgent): {
  id: string | undefined;
  name: string;
  model: string;
  description: string;
} {
  return {
    id: a.id ?? a.agent_id,
    name: a.name,
    model: a.model?.name ?? '-',
    description: a.description?.slice(0, 50) ?? '-',
  };
}

/**
 * Map agno 2.5+ (`id`) and pre-2.5 (`team_id`) team shapes to the list row.
 */
function mapAgnoTeamRow(t: AgnoTeam): {
  id: string | undefined;
  name: string;
  mode: string;
  members: number;
  description: string;
} {
  return {
    id: t.id ?? t.team_id,
    name: t.name,
    mode: t.mode ?? '-',
    members: t.members?.length ?? 0,
    description: t.description?.slice(0, 50) ?? '-',
  };
}

/**
 * Map agno 2.5+ (`id`) and pre-2.5 (`workflow_id`) workflow shapes to the list row.
 */
function mapAgnoWorkflowRow(w: AgnoWorkflow): {
  id: string | undefined;
  name: string;
  description: string;
} {
  return {
    id: w.id ?? w.workflow_id,
    name: w.name,
    description: w.description?.slice(0, 50) ?? '-',
  };
}

export const __testables = {
  mapAgnoAgentRow,
  mapAgnoTeamRow,
  mapAgnoWorkflowRow,
};

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
function validateCreateOptions(options: {
  schema: string;
  baseUrl: string;
  defaultAgentId?: string;
  projectPath?: string;
  agentName?: string;
  targetAgent?: string;
}): string | null {
  if (!VALID_SCHEMAS.includes(options.schema)) {
    return `Invalid schema: ${options.schema}. Valid: ${[...VALID_SCHEMAS].join(', ')}`;
  }
  const urlError = validateUrlScheme(options.schema, options.baseUrl);
  if (urlError) return urlError;
  if (options.schema === 'openclaw' && !options.defaultAgentId) {
    return 'OpenClaw providers require --default-agent-id.\nExample: omni providers create --schema openclaw --default-agent-id sofia ...';
  }
  if (options.schema === 'claude-code' && !options.projectPath) {
    return 'Claude Code providers require --project-path.\nExample: omni providers create --name "My Project" --schema claude-code --base-url http://localhost:8882 --project-path /home/user/myproject';
  }
  if (options.schema === 'nats-genie' && (!options.agentName || !options.targetAgent)) {
    return 'nats-genie providers require --agent-name and --target-agent.\nExample: omni providers create --name "My Nats Genie" --schema nats-genie --base-url "file:///home/user/.claude/teams" --agent-name omni --target-agent team-lead --team-name "workspace-{chat_id}"';
  }
  return null;
}

interface SchemaConfigOptions {
  schema: string;
  defaultAgentId?: string;
  projectPath?: string;
  maxTurns?: number;
  permissionMode?: string;
  model?: string;
  systemPrompt?: string;
  agentName?: string;
  targetAgent?: string;
  teamName?: string;
}

function buildOpenClawConfig(options: SchemaConfigOptions): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (options.defaultAgentId) config.defaultAgentId = options.defaultAgentId;
  return config;
}

function buildClaudeCodeConfig(options: SchemaConfigOptions): Record<string, unknown> {
  const config: Record<string, unknown> = { projectPath: options.projectPath };
  if (options.maxTurns) config.maxTurns = options.maxTurns;
  if (options.permissionMode) config.permissionMode = options.permissionMode;
  if (options.model) config.model = options.model;
  if (options.systemPrompt) config.systemPrompt = options.systemPrompt;
  return config;
}

function buildNatsGenieConfig(options: SchemaConfigOptions): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (options.agentName) config.agentName = options.agentName;
  if (options.targetAgent) config.targetAgent = options.targetAgent;
  if (options.teamName) config.teamName = options.teamName;
  return config;
}

/** Build schema-specific config from CLI options */
function buildSchemaConfig(options: SchemaConfigOptions): Record<string, unknown> | undefined {
  const builders: Record<string, (opts: SchemaConfigOptions) => Record<string, unknown>> = {
    openclaw: buildOpenClawConfig,
    'claude-code': buildClaudeCodeConfig,
    'nats-genie': buildNatsGenieConfig,
  };

  const builder = builders[options.schema];
  if (builder) {
    const config = builder(options);
    return Object.keys(config).length > 0 ? config : undefined;
  }

  // Fallback for other schemas
  if (options.defaultAgentId) {
    return { defaultAgentId: options.defaultAgentId };
  }
  return undefined;
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

/** Copy defined values from source to target, optionally remapping keys */
function copyDefined(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  keyMap: Record<string, string>,
): void {
  for (const [srcKey, dstKey] of Object.entries(keyMap)) {
    if (source[srcKey] !== undefined) target[dstKey] = source[srcKey];
  }
}

/** Build PATCH body from update command options */
function buildUpdateBody(options: Record<string, unknown>): Record<string, unknown> | { error: string } {
  const body: Record<string, unknown> = {};

  // Top-level provider fields
  copyDefined(options, body, {
    name: 'name',
    baseUrl: 'baseUrl',
    apiKey: 'apiKey',
    description: 'description',
    timeout: 'defaultTimeout',
    stream: 'defaultStream',
    active: 'isActive',
  });

  // Schema config: raw JSON takes precedence over individual flags
  if (options.schemaConfig) {
    try {
      body.schemaConfig = JSON.parse(options.schemaConfig as string);
    } catch {
      return { error: 'Invalid JSON for --schema-config' };
    }
  } else {
    const schemaFields: Record<string, unknown> = {};
    copyDefined(options, schemaFields, {
      agentName: 'agentName',
      targetAgent: 'targetAgent',
      teamName: 'teamName',
      projectPath: 'projectPath',
      maxTurns: 'maxTurns',
      permissionMode: 'permissionMode',
      model: 'model',
      systemPrompt: 'systemPrompt',
    });
    if (Object.keys(schemaFields).length > 0) body.schemaConfig = schemaFields;
  }

  return body;
}

async function handleList(options: { active?: boolean }): Promise<void> {
  const client = getClient();
  try {
    const result = await client.providers.list({ active: options.active });
    const items = result.map((p) => ({
      id: p.id,
      name: p.name,
      schema: p.schema,
      projectPath: (p.schemaConfig as Record<string, unknown> | null)?.projectPath ?? '-',
      active: p.isActive ? 'yes' : 'no',
    }));
    output.list(items, { emptyMessage: 'No providers found.' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to list providers: ${message}`);
  }
}

async function handleGet(id: string): Promise<void> {
  const resolvedId = await resolveProviderId(id);
  const client = getClient();
  try {
    const provider = await client.providers.get(resolvedId);
    output.data(provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to get provider: ${message}`);
  }
}

async function handleCreate(options: {
  name: string;
  schema: string;
  baseUrl: string;
  apiKey?: string;
  description?: string;
  timeout?: number;
  stream?: boolean;
  defaultAgentId?: string;
  projectPath?: string;
  maxTurns?: number;
  permissionMode?: string;
  model?: string;
  systemPrompt?: string;
  agentName?: string;
  targetAgent?: string;
  teamName?: string;
}): Promise<void> {
  const validationError = validateCreateOptions(options);
  if (validationError) {
    output.error(validationError);
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
      schemaConfig: buildSchemaConfig(options),
    });

    output.success(`Created provider: ${provider.id}`);
    output.data(provider);
    output.info('\nNext steps:');
    output.info(`  1. Test connectivity:  omni providers test ${provider.id}`);
    output.info(
      `  2. Assign to instance: omni instances update <instance-id> --agent-provider ${provider.id}${options.defaultAgentId ? ` --agent ${options.defaultAgentId}` : ''}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to create provider: ${message}`);
  }
}

async function handleTest(id: string): Promise<void> {
  const resolvedId = await resolveProviderId(id);
  const client = getClient();
  try {
    const result = await client.providers.checkHealth(resolvedId);
    if (result.healthy) {
      output.success(`Provider is healthy (latency: ${result.latency}ms)`);
    } else {
      const errorMsg = result.error ?? 'Unknown error';
      const hint = getHealthCheckHint(errorMsg);
      output.error(`Provider health check failed: ${errorMsg}${hint}`, { latency: result.latency });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to test provider: ${message}`);
  }
}

async function handleUpdate(id: string, options: Record<string, unknown>): Promise<void> {
  const body = buildUpdateBody(options as Parameters<typeof buildUpdateBody>[0]);
  if ('error' in body) {
    output.error(body.error as string);
    return;
  }
  if (Object.keys(body).length === 0) {
    output.error('No fields to update. Provide at least one option.');
    return;
  }

  const resolvedId = await resolveProviderId(id);
  const client = getClient();
  try {
    // If updating individual schemaConfig fields (not raw --schema-config JSON),
    // merge with the existing config to avoid dropping required fields.
    if (body.schemaConfig && !options.schemaConfig) {
      const existing = await client.providers.get(resolvedId);
      const existingConfig = (existing.schemaConfig as Record<string, unknown>) ?? {};
      body.schemaConfig = { ...existingConfig, ...(body.schemaConfig as Record<string, unknown>) };
    }

    const provider = await client.providers.update(resolvedId, body);
    output.success(`Updated provider: ${provider.id}`);
    output.data(provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to update provider: ${message}`);
  }
}

async function handleDelete(id: string, options: { force?: boolean }): Promise<void> {
  if (!options.force) {
    output.warn(`This will delete provider ${id}. Use --force to confirm.`);
    return;
  }
  const resolvedId = await resolveProviderId(id);
  const client = getClient();
  try {
    await client.providers.delete(resolvedId);
    output.success(`Deleted provider: ${resolvedId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to delete provider: ${message}`);
  }
}

export function createProvidersCommand(): Command {
  const providers = new Command('providers').description('Manage AI/agent providers');

  // omni providers setup <schema>
  providers.addCommand(createSetupCommand());

  // omni providers list
  providers
    .command('list')
    .description('List available providers')
    .option('--active', 'Show only active providers')
    .action(handleList);

  // omni providers get <id>
  providers.command('get <id>').description('Get provider details').action(handleGet);

  // omni providers create
  providers
    .command('create')
    .description('Create a new AI provider')
    .requiredOption('--name <name>', 'Provider name (unique)')
    .requiredOption('--schema <schema>', `Provider schema (${VALID_SCHEMAS.join(', ')})`)
    .requiredOption('--base-url <url>', 'API base URL (ws:// or wss:// for openclaw)')
    .option('--api-key <key>', 'API key (optional for claude-code if using env ANTHROPIC_API_KEY)')
    .option('--description <desc>', 'Provider description')
    .option('--timeout <seconds>', 'Default timeout in seconds', Number.parseInt, 60)
    .option('--stream', 'Enable streaming by default')
    // OpenClaw options
    .option('--default-agent-id <agentId>', 'Default agent ID (required for openclaw)')
    // Claude Code options
    .option('--project-path <path>', 'Project directory path (required for claude-code)')
    .option('--max-turns <number>', 'Max conversation turns (claude-code)', Number.parseInt)
    .option('--permission-mode <mode>', 'Permission mode: default, acceptEdits, bypassPermissions, plan (claude-code)')
    .option('--model <model>', 'Model override (claude-code)')
    .option('--system-prompt <prompt>', 'System prompt prepended to agent (claude-code)')
    // nats-genie options
    .option('--agent-name <name>', 'Agent identity / "from" field (required for nats-genie)')
    .option('--target-agent <name>', 'Target agent inbox to deliver to (required for nats-genie)')
    .option(
      '--team-name <template>',
      'Team name template, supports {chat_id}, {thread_id}, {sender_id} (nats-genie, default: omni-{chat_id})',
    )
    .action(handleCreate);

  // omni providers test <id>
  providers.command('test <id>').description('Test provider health').action(handleTest);

  // omni providers agents <id>
  providers
    .command('agents <id>')
    .description('List agents from provider (Agno)')
    .action(async (id: string) => {
      const resolvedId = await resolveProviderId(id);
      const client = getClient();

      try {
        const agents = await client.providers.listAgents(resolvedId);

        const items = agents.map(mapAgnoAgentRow);

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
      const resolvedId = await resolveProviderId(id);
      const client = getClient();

      try {
        const teams = await client.providers.listTeams(resolvedId);

        const items = teams.map(mapAgnoTeamRow);

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
      const resolvedId = await resolveProviderId(id);
      const client = getClient();

      try {
        const workflows = await client.providers.listWorkflows(resolvedId);

        const items = workflows.map(mapAgnoWorkflowRow);

        output.list(items, { emptyMessage: 'No workflows found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list workflows: ${message}`);
      }
    });

  // omni providers update <id>
  providers
    .command('update <id>')
    .description('Update a provider')
    .option('--name <name>', 'Provider name')
    .option('--base-url <url>', 'API base URL')
    .option('--api-key <key>', 'API key')
    .option('--description <desc>', 'Provider description')
    .option('--timeout <seconds>', 'Default timeout in seconds', Number.parseInt)
    .option('--stream', 'Enable streaming by default')
    .option('--no-stream', 'Disable streaming by default')
    .option('--active', 'Set provider active')
    .option('--no-active', 'Set provider inactive')
    // Schema-specific options (nats-genie)
    .option('--agent-name <name>', 'Agent identity (nats-genie)')
    .option('--target-agent <name>', 'Target agent inbox (nats-genie)')
    .option('--team-name <template>', 'Team name template (nats-genie)')
    // Schema-specific options (claude-code)
    .option('--project-path <path>', 'Project directory path (claude-code)')
    .option('--max-turns <number>', 'Max conversation turns (claude-code)', Number.parseInt)
    .option('--permission-mode <mode>', 'Permission mode (claude-code)')
    .option('--model <model>', 'Model override (claude-code)')
    .option('--system-prompt <prompt>', 'System prompt (claude-code)')
    // Raw schema config
    .option('--schema-config <json>', 'Raw schemaConfig as JSON (overrides individual schema flags)')
    .action(handleUpdate);

  // omni providers delete <id>
  providers
    .command('delete <id>')
    .description('Delete a provider')
    .option('--force', 'Skip confirmation')
    .action(handleDelete);

  return providers;
}
