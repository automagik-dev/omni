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
 * omni agents manifest get <id>
 * omni agents manifest apply <id> --file <path>
 * omni agents graph [--type <event>]
 */

import { readFileSync } from 'node:fs';
import type { AgentEventManifest } from '@omni/core';
import { AgentEventManifestSchema } from '@omni/core';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveAgentId } from '../resolve.js';
import { maybeNudgeForGenieBackedAgent } from '../utils/genie-wiring-nudge.js';

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

// ─── Event manifest helpers (RFC #925 G4a, #985) ────────────────────────────

/** Detect the manifest file format from its extension (.yaml/.yml → YAML). */
function detectManifestFormat(filePath: string): 'json' | 'yaml' {
  return /\.ya?ml$/i.test(filePath) ? 'yaml' : 'json';
}

/**
 * Parse a manifest file's contents. YAML is parsed with Bun's built-in
 * `Bun.YAML` (no extra dependency); JSON with JSON.parse. Throws with a
 * readable message on parse failure.
 */
function parseManifestSource(source: string, format: 'json' | 'yaml'): unknown {
  if (format === 'yaml') {
    const yaml = (globalThis.Bun as { YAML?: { parse(input: string): unknown } } | undefined)?.YAML;
    if (!yaml) {
      throw new Error('YAML manifests require Bun >= 1.2 (Bun.YAML). Convert the file to JSON or upgrade Bun.');
    }
    return yaml.parse(source);
  }
  return JSON.parse(source);
}

/**
 * Validate a parsed manifest document against the shared Zod schema
 * (client-side, before any network call). Throws with per-field messages.
 */
function validateManifestDocument(raw: unknown): AgentEventManifest {
  const result = AgentEventManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Manifest failed validation:\n${issues}`);
  }
  return result.data;
}

/** Minimal agent shape the graph helpers need (matches SDK list output). */
interface GraphAgentInput {
  name: string;
  eventManifest?: {
    accepts?: { event: string; filter?: Record<string, unknown> }[];
    publishes?: { event: string }[];
  } | null;
}

interface GraphRow {
  agent: string;
  consumes: string;
  produces: string;
}

/** Render one accepts entry for the graph table ("event (filtered)" when narrowed). */
function formatAcceptsEntry(entry: { event: string; filter?: Record<string, unknown> }): string {
  const filtered = entry.filter !== undefined && Object.keys(entry.filter).length > 0;
  return filtered ? `${entry.event} (filtered)` : entry.event;
}

/**
 * Build the producer/consumer table: one row per agent that declares at least
 * one accepts/publishes entry. Agents without a manifest are omitted.
 */
function buildGraphRows(agents: GraphAgentInput[]): GraphRow[] {
  const rows: GraphRow[] = [];
  for (const agent of agents) {
    const manifest = agent.eventManifest;
    const accepts = manifest?.accepts ?? [];
    const publishes = manifest?.publishes ?? [];
    if (accepts.length === 0 && publishes.length === 0) continue;
    rows.push({
      agent: agent.name,
      consumes: accepts.length > 0 ? accepts.map(formatAcceptsEntry).join(', ') : '-',
      produces: publishes.length > 0 ? publishes.map((entry) => entry.event).join(', ') : '-',
    });
  }
  return rows;
}

interface TypeGraphRow {
  agent: string;
  role: 'consumes' | 'produces';
  filter: string;
}

/**
 * Answer "who listens to / who may emit this event type": one row per
 * declaration matching the given type.
 */
function buildTypeRows(agents: GraphAgentInput[], eventType: string): TypeGraphRow[] {
  const rows: TypeGraphRow[] = [];
  for (const agent of agents) {
    for (const entry of agent.eventManifest?.accepts ?? []) {
      if (entry.event !== eventType) continue;
      const hasFilter = entry.filter !== undefined && Object.keys(entry.filter).length > 0;
      rows.push({ agent: agent.name, role: 'consumes', filter: hasFilter ? JSON.stringify(entry.filter) : '-' });
    }
    for (const entry of agent.eventManifest?.publishes ?? []) {
      if (entry.event !== eventType) continue;
      rows.push({ agent: agent.name, role: 'produces', filter: '-' });
    }
  }
  return rows;
}

/** Exported for unit tests only. */
export const __testables = {
  detectManifestFormat,
  parseManifestSource,
  validateManifestDocument,
  buildGraphRows,
  buildTypeRows,
};

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
        const client = getClient();
        const agent = await client.agents.create(body);
        output.success(`Agent created: ${agent.id}`);
        output.data(agent);

        // Deprecation nudge — when the agent is bound to a nats-genie
        // provider, the operator is recreating step 2 of the legacy
        // 5-command wiring chain. `omni connect <instance> <agent>` does
        // the same thing in one step, plus binds the instance. Stderr-only
        // so CI stdout grep stays stable. The fetch is best-effort: if the
        // provider lookup fails, we silently skip the nudge.
        if (options.agentProvider) {
          await maybeNudgeForGenieBackedAgent(client, options.agentProvider, agent.name);
        }
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

  // omni agents manifest get|apply — declarative accepts/publishes (RFC #925 G4a)
  const manifest = new Command('manifest').description('Manage the agent event manifest (declared accepts/publishes)');

  // omni agents manifest get <id>
  manifest
    .command('get <id>')
    .description('Print the stored event manifest for an agent')
    .action(async (id: string) => {
      const resolvedId = await resolveAgentId(id);
      const client = getClient();

      try {
        const stored = await client.agents.getManifest(resolvedId);
        if (stored === null) {
          if (output.getCurrentFormat() === 'json') {
            output.data(null);
          } else {
            output.info('No event manifest declared for this agent.');
          }
          return;
        }
        output.data(stored);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get agent manifest: ${message}`, undefined, 3);
      }
    });

  // omni agents manifest apply <id> --file <path>
  manifest
    .command('apply <id>')
    .description('Validate a manifest file (JSON or YAML) and apply it to an agent (full replacement)')
    .requiredOption('--file <path>', 'Path to the manifest file (.json, .yaml, or .yml)')
    .action(async (id: string, options: { file: string }) => {
      let document: AgentEventManifest;
      try {
        const source = readFileSync(options.file, 'utf8');
        const parsed = parseManifestSource(source, detectManifestFormat(options.file));
        document = validateManifestDocument(parsed);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return output.error(`Cannot apply manifest from ${options.file}: ${message}`);
      }

      const resolvedId = await resolveAgentId(id);
      const client = getClient();

      try {
        const stored = await client.agents.updateManifest(resolvedId, document);
        output.success(`Manifest applied to agent ${resolvedId}.`);
        output.data(stored);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to apply agent manifest: ${message}`, undefined, 3);
      }
    });

  agents.addCommand(manifest);

  // omni agents graph [--type <event>] — pure read over declared manifests
  agents
    .command('graph')
    .description('Show declared event producers/consumers across agents (living documentation)')
    .option('--type <event>', 'Only show who consumes / may produce this event type')
    .action(async (options: { type?: string }) => {
      const client = getClient();

      try {
        const { items } = await client.agents.list({ limit: 200 });

        if (options.type !== undefined) {
          const rows = buildTypeRows(items, options.type);
          output.list(rows, { emptyMessage: `No agent declares ${options.type}.` });
          return;
        }

        const rows = buildGraphRows(items);
        output.list(rows, { emptyMessage: 'No agent declares an event manifest.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to build agent graph: ${message}`);
      }
    });

  return agents;
}
