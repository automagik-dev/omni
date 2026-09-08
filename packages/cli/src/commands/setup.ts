/**
 * Setup Command — omni setup agent
 *
 * Compound one-step command that wires an AI agent to a channel instance.
 * Generalizes the `omni connect` pattern across every provider schema:
 *   agno | webhook | openclaw | ag-ui | claude-code | a2a | nats-genie
 *
 * Steps:
 *   1. Resolve instance by name or UUID
 *   2. Build provider config per `--schema` (per-schema adapter)
 *   3. Find-or-create provider (idempotent by name+schema)
 *   4. Find-or-create agent (idempotent by name+providerId)
 *   5. Update instance — agentId, agentProviderId, agentReplyFilter, triggerMode
 *   6. Run connectivity test via providers.checkHealth
 *   7. Print summary
 *
 * Closes #440.
 */

import { PROVIDER_SCHEMAS, type ProviderSchema } from '@omni/core';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveInstanceId } from '../resolve.js';
import { findOrCreateAgent, findOrCreateProvider, schemaToAgentProvider } from './_setup-helpers.js';

// ============================================================================
// TYPES
// ============================================================================

type TriggerMode = 'round-trip' | 'fire-and-forget';
type ReplyFilterMode = 'all' | 'filtered';

interface SetupAgentOptions {
  instance: string;
  schema: string;
  name: string;
  providerName?: string;
  baseUrl?: string;
  apiKey?: string;
  mode: 'turn-based' | 'fire-and-forget';
  replyFilter: ReplyFilterMode;
  // Schema-specific options
  defaultAgentId?: string;
  projectPath?: string;
  maxTurns?: number;
  permissionMode?: string;
  model?: string;
  systemPrompt?: string;
  agentName?: string;
  targetAgent?: string;
  teamName?: string;
  natsUrl?: string;
  webhookUrl?: string;
}

// ============================================================================
// SCHEMA ADAPTERS — build provider config + default baseUrl per schema
// ============================================================================

interface ProviderBuildResult {
  baseUrl: string;
  apiKey?: string;
  schemaConfig?: Record<string, unknown>;
}

function buildAgnoConfig(opts: SetupAgentOptions): ProviderBuildResult | { error: string } {
  if (!opts.baseUrl) return { error: 'agno provider requires --base-url (Agno API URL).' };
  const schemaConfig: Record<string, unknown> = {};
  if (opts.defaultAgentId) schemaConfig.defaultAgentId = opts.defaultAgentId;
  return {
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    schemaConfig: Object.keys(schemaConfig).length > 0 ? schemaConfig : undefined,
  };
}

function buildWebhookConfig(opts: SetupAgentOptions): ProviderBuildResult | { error: string } {
  const url = opts.webhookUrl ?? opts.baseUrl;
  if (!url) return { error: 'webhook provider requires --webhook-url (or --base-url).' };
  return { baseUrl: url, apiKey: opts.apiKey };
}

function buildOpenClawConfig(opts: SetupAgentOptions): ProviderBuildResult | { error: string } {
  if (!opts.baseUrl) return { error: 'openclaw provider requires --base-url (ws:// or wss://).' };
  if (!opts.baseUrl.startsWith('ws://') && !opts.baseUrl.startsWith('wss://')) {
    return { error: `openclaw requires ws:// or wss:// URL. Got: ${opts.baseUrl}` };
  }
  if (!opts.defaultAgentId) {
    return { error: 'openclaw provider requires --default-agent-id.' };
  }
  return {
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    schemaConfig: { defaultAgentId: opts.defaultAgentId },
  };
}

function buildAgUiConfig(opts: SetupAgentOptions): ProviderBuildResult | { error: string } {
  if (!opts.baseUrl) return { error: 'ag-ui provider requires --base-url.' };
  return { baseUrl: opts.baseUrl, apiKey: opts.apiKey };
}

function buildClaudeCodeConfig(opts: SetupAgentOptions): ProviderBuildResult | { error: string } {
  if (!opts.baseUrl) return { error: 'claude-code provider requires --base-url.' };
  if (!opts.projectPath) return { error: 'claude-code provider requires --project-path.' };
  const schemaConfig: Record<string, unknown> = { projectPath: opts.projectPath };
  if (opts.maxTurns) schemaConfig.maxTurns = opts.maxTurns;
  if (opts.permissionMode) schemaConfig.permissionMode = opts.permissionMode;
  if (opts.model) schemaConfig.model = opts.model;
  if (opts.systemPrompt) schemaConfig.systemPrompt = opts.systemPrompt;
  return { baseUrl: opts.baseUrl, apiKey: opts.apiKey, schemaConfig };
}

function buildA2aConfig(opts: SetupAgentOptions): ProviderBuildResult | { error: string } {
  if (!opts.baseUrl) return { error: 'a2a provider requires --base-url.' };
  return { baseUrl: opts.baseUrl, apiKey: opts.apiKey };
}

function buildNatsGenieConfig(opts: SetupAgentOptions): ProviderBuildResult | { error: string } {
  const natsUrl = opts.natsUrl ?? 'localhost:4222';
  const schemaConfig: Record<string, unknown> = { natsUrl };
  if (opts.agentName) schemaConfig.agentName = opts.agentName;
  if (opts.targetAgent) schemaConfig.targetAgent = opts.targetAgent;
  if (opts.teamName) schemaConfig.teamName = opts.teamName;
  return {
    baseUrl: opts.baseUrl ?? `nats://${natsUrl}`,
    apiKey: opts.apiKey,
    schemaConfig,
  };
}

/** Dispatch to the per-schema builder. Returns `error` on invalid input. */
function buildProviderConfig(opts: SetupAgentOptions): ProviderBuildResult | { error: string } {
  switch (opts.schema) {
    case 'agno':
      return buildAgnoConfig(opts);
    case 'webhook':
      return buildWebhookConfig(opts);
    case 'openclaw':
      return buildOpenClawConfig(opts);
    case 'ag-ui':
      return buildAgUiConfig(opts);
    case 'claude-code':
      return buildClaudeCodeConfig(opts);
    case 'a2a':
      return buildA2aConfig(opts);
    case 'nats-genie':
      return buildNatsGenieConfig(opts);
    default:
      return { error: `Unsupported --schema "${opts.schema}". Valid: ${[...PROVIDER_SCHEMAS].join(', ')}` };
  }
}

// ============================================================================
// COMMAND
// ============================================================================

export function createTopLevelSetupCommand(): Command {
  const setup = new Command('setup').description('Compound setup wizards for Omni resources');

  setup
    .command('agent')
    .description('Wire an agent to an instance in one step (provider + agent + binding + health check)')
    .requiredOption('--instance <name-or-uuid>', 'Omni instance (name or UUID)')
    .requiredOption('--schema <schema>', `Provider schema (${[...PROVIDER_SCHEMAS].join(', ')})`)
    .requiredOption('--name <name>', 'Agent name (also used as default provider name)')
    .option('--provider-name <name>', 'Provider name override (default: <schema>-<name>)')
    .option('--base-url <url>', 'Provider base URL (required for most schemas)')
    .option('--api-key <key>', 'API key for the provider')
    .option('--mode <mode>', 'Trigger mode: turn-based (round-trip) or fire-and-forget', 'turn-based')
    .option('--reply-filter <filter>', 'Reply filter: all | filtered', 'all')
    // Schema-specific
    .option('--default-agent-id <id>', 'Default agent ID (agno, openclaw)')
    .option('--project-path <path>', 'Project directory (claude-code)')
    .option('--max-turns <n>', 'Max conversation turns (claude-code)', Number.parseInt)
    .option('--permission-mode <mode>', 'Permission mode (claude-code)')
    .option('--model <model>', 'Model override')
    .option('--system-prompt <prompt>', 'System prompt (claude-code)')
    .option('--agent-name <name>', 'Agent identity (nats-genie)')
    .option('--target-agent <name>', 'Target agent inbox (nats-genie)')
    .option('--team-name <template>', 'Team name template (nats-genie)')
    .option('--nats-url <url>', 'NATS server URL (nats-genie, default: localhost:4222)')
    .option('--webhook-url <url>', 'Webhook endpoint (webhook)')
    .action(async (options: SetupAgentOptions) => {
      await runSetupAgent(options);
    });

  return setup;
}

async function runSetupAgent(options: SetupAgentOptions): Promise<void> {
  if (!PROVIDER_SCHEMAS.includes(options.schema as ProviderSchema)) {
    output.error(`Invalid --schema "${options.schema}". Valid: ${[...PROVIDER_SCHEMAS].join(', ')}`);
    return;
  }

  const client = getClient();

  // 1. Resolve instance
  const instanceId = await resolveInstanceId(options.instance);

  // 2. Build provider config per schema
  const built = buildProviderConfig(options);
  if ('error' in built) {
    output.error(built.error);
    return;
  }

  const providerName = options.providerName ?? `${options.schema}-${options.name}`;

  // 3. Find or create provider
  output.info(`Creating ${options.schema} provider "${providerName}"...`);
  const providerId = await findOrCreateProvider(client, {
    name: providerName,
    schema: options.schema,
    baseUrl: built.baseUrl,
    apiKey: built.apiKey,
    schemaConfig: built.schemaConfig,
  });
  if (!providerId) return;

  // 4. Find or create agent
  output.info(`Creating agent record "${options.name}"...`);
  const agentId = await findOrCreateAgent(client, {
    name: options.name,
    providerId,
    agentProvider: schemaToAgentProvider(options.schema),
    model: options.model,
  });
  if (!agentId) return;

  // 5. Resolve trigger mode + reply filter
  const triggerMode: TriggerMode = options.mode === 'turn-based' ? 'round-trip' : 'fire-and-forget';
  const agentReplyFilter = {
    mode: options.replyFilter,
    conditions: { onDm: true, onMention: true, onReply: true, onNameMatch: false },
  };

  // 6. Update instance — bind agent + provider + reply filter + trigger mode
  output.info('Updating instance agent assignment...');
  try {
    await client.instances.update(instanceId, {
      agentId,
      agentProviderId: providerId,
      agentReplyFilter,
      triggerMode,
    } as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.warn(`Could not update instance agent assignment: ${message}`);
    output.info(
      `Set manually: omni instances update ${instanceId} --agent-id ${agentId} --agent-provider-id ${providerId}`,
    );
    return;
  }

  // 7. Connectivity test
  output.info('Testing provider connectivity...');
  let healthSummary: string;
  try {
    const health = await client.providers.checkHealth(providerId);
    healthSummary = health.healthy
      ? `healthy (latency: ${health.latency}ms)`
      : `unhealthy — ${health.error ?? 'unknown error'}`;
    if (health.healthy) {
      output.success(`Provider is healthy (latency: ${health.latency}ms)`);
    } else {
      output.warn(`Provider created but health check failed: ${health.error ?? 'unknown error'}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    healthSummary = `error — ${message}`;
    output.warn(`Health check errored: ${message}`);
  }

  // 8. Summary
  output.success(`Connected instance "${options.instance}" to agent "${options.name}".`);
  output.header('Configuration Summary');
  output.keyValue('Instance ID', instanceId);
  output.keyValue('Schema', options.schema);
  output.keyValue('Provider ID', providerId);
  output.keyValue('Agent ID', agentId);
  output.keyValue('Reply Filter', options.replyFilter);
  output.keyValue('Trigger Mode', `${triggerMode} (--mode ${options.mode})`);
  output.keyValue('Health', healthSummary);
}
