/**
 * Automations Commands
 *
 * omni automations list [--enabled]
 * omni automations get <id>
 * omni automations create --name <name> --trigger <event> --action <type> [--action-config <json>]...
 * omni automations create --file <definition.json> [flag overrides]
 * omni automations update <id> [--name] [--trigger] [--condition] [--action ...] [--file <json>]
 * omni automations delete <id>
 * omni automations enable <id>
 * omni automations disable <id>
 * omni automations test <id> --event <json>
 * omni automations execute <id> --event <json>
 * omni automations logs <id> [--limit <n>] [--status <status>]
 *
 * Example: Create call_agent automation (response stored for chaining)
 * omni automations create \
 *   --name "Support Bot" \
 *   --trigger message.received \
 *   --action call_agent \
 *   --agent-id support-agent \
 *   --response-as agentResponse
 *
 * Multi-action (#1077): repeat --action; the i-th --action-config pairs with
 * the i-th --action. --file takes a full definition (the `get` output works
 * as-is: id/timestamps are ignored) and explicit flags override its fields.
 * `update` PATCHes in place, so the automation id and its execution logs
 * survive — no delete+recreate.
 */

import { readFileSync } from 'node:fs';
import type { CreateAutomationBody, OmniClient, TestAutomationBody } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { getCurrentFormat } from '../output.js';
import { resolveAutomationId } from '../resolve.js';

// ============================================================================
// HELPERS
// ============================================================================

type ActionType = CreateAutomationBody['actions'][number]['type'];
type Action = CreateAutomationBody['actions'][number];
type Condition = NonNullable<CreateAutomationBody['triggerConditions']>[number];

interface ActionOptions {
  action?: string[];
  actionConfig?: string[];
  agentId?: string;
  providerId?: string;
  responseAs?: string;
}

interface DefinitionOptions extends ActionOptions {
  file?: string;
  name?: string;
  trigger?: string;
  condition?: string;
  conditionLogic?: string;
  description?: string;
  priority?: number;
  // Transactional publication (G5, #988): true from --transactional-emissions,
  // undefined when the flag is not given (server default false applies).
  transactionalEmissions?: boolean;
}

interface CreateOptions extends DefinitionOptions {
  disabled?: boolean;
}

/** Commander accumulator for repeatable flags (--action a --action b). */
function collectRepeated(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

/** Parse JSON; throws a flag-named error (caught by the command's error path). */
function parseJson<T>(json: string, fieldName: string): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new Error(`Invalid JSON for ${fieldName}`);
  }
}

/**
 * Read a full definition from --file. Read-only/server-owned fields are
 * dropped so `omni automations get <id> --json > a.json` round-trips
 * straight into create/update.
 */
function readDefinitionFile(path: string): Partial<CreateAutomationBody> {
  let text: string;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Cannot read --file '${path}': ${reason}`);
  }
  const parsed = parseJson<unknown>(text, '--file');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--file must contain a JSON object');
  }
  const readOnly = new Set(['id', 'createdAt', 'updatedAt', 'managedByAgentId']);
  // `get` renders unset fields as null; the API's PATCH schema wants them absent.
  const body = Object.fromEntries(
    Object.entries(parsed).filter(([key, value]) => !readOnly.has(key) && value !== null),
  );
  return body as Partial<CreateAutomationBody>;
}

/** --agent-id / --provider-id / --response-as shortcuts, applied to one call_agent config. */
function applyCallAgentShortcuts(config: Record<string, unknown>, options: ActionOptions): void {
  if (options.agentId) config.agentId = options.agentId;
  if (options.providerId) config.providerId = options.providerId;
  if (options.responseAs) config.responseAs = options.responseAs;
}

/**
 * Build the ordered actions array from repeatable --action / --action-config.
 * Returns undefined when no --action was given (so --file actions stand).
 */
function buildActions(options: ActionOptions): Action[] | undefined {
  const types = options.action ?? [];
  const configs = options.actionConfig ?? [];
  if (types.length === 0) {
    if (configs.length > 0) throw new Error('--action-config requires a matching --action');
    return undefined;
  }
  if (configs.length > types.length) {
    throw new Error(`Got ${configs.length} --action-config for ${types.length} --action`);
  }

  const firstCallAgent = types.indexOf('call_agent');
  return types.map((type, i) => {
    const raw = configs[i];
    const config: Record<string, unknown> = raw
      ? parseJson<Record<string, unknown>>(raw, `--action-config #${i + 1}`)
      : {};

    if (type === 'call_agent') {
      // Shortcut flags target the first call_agent action only.
      if (i === firstCallAgent) applyCallAgentShortcuts(config, options);
      if (!config.agentId) {
        throw new Error('call_agent action requires --agent-id or agentId in --action-config');
      }
    }

    return { type: type as ActionType, config } as Action;
  });
}

function parseConditionLogic(logic: string | undefined): 'and' | 'or' | undefined {
  if (logic === undefined) return undefined;
  if (logic !== 'and' && logic !== 'or') throw new Error('--condition-logic must be "and" or "or"');
  return logic;
}

/**
 * Merge --file (base) with explicit flags (override) into a PATCH/POST body.
 * Only fields actually given are present, so `update` leaves the rest untouched.
 */
function buildDefinition(options: DefinitionOptions): Partial<CreateAutomationBody> {
  const body: Partial<CreateAutomationBody> = options.file ? readDefinitionFile(options.file) : {};

  const actions = buildActions(options);
  if (actions) body.actions = actions;
  if (options.name !== undefined) body.name = options.name;
  if (options.description !== undefined) body.description = options.description;
  if (options.trigger !== undefined) body.triggerEventType = options.trigger;
  if (options.condition !== undefined)
    body.triggerConditions = parseJson<Condition[]>(options.condition, '--condition');
  const logic = parseConditionLogic(options.conditionLogic);
  if (logic !== undefined) body.conditionLogic = logic;
  if (options.priority !== undefined) body.priority = options.priority;
  if (options.transactionalEmissions !== undefined) body.transactionalEmissions = options.transactionalEmissions;

  return body;
}

/** Full create body: --file + flags, with the required fields enforced client-side. */
function buildCreateBody(options: CreateOptions): CreateAutomationBody {
  const body = buildDefinition(options);
  if (!body.name) throw new Error('--name is required (or "name" in --file)');
  if (!body.triggerEventType) throw new Error('--trigger is required (or "triggerEventType" in --file)');
  if (!body.actions || body.actions.length === 0) {
    throw new Error('At least one --action is required (or "actions" in --file)');
  }
  if (options.disabled) body.enabled = false;
  return body as CreateAutomationBody;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `--event` is either inline event JSON (legacy) or the id of a journaled
 * event (#1073). Returns the API body, or undefined when it is neither.
 */
function parseEventOption(raw: string): TestAutomationBody | undefined {
  const value = raw.trim();
  if (UUID_RE.test(value)) return { eventId: value };
  try {
    const event = JSON.parse(value) as { type?: unknown; payload?: unknown };
    if (typeof event.type !== 'string' || typeof event.payload !== 'object' || event.payload === null) return undefined;
    return { event: event as TestAutomationBody['event'] };
  } catch {
    return undefined;
  }
}

function reportExecution(result: Awaited<ReturnType<OmniClient['automations']['execute']>>): void {
  if (!result.triggered) {
    output.info('Automation not triggered (event type did not match)');
    output.data({ triggered: false });
    return;
  }
  const allSuccess = result.results.every((r) => r.status === 'success');
  if (allSuccess) {
    output.success('Automation executed successfully', {
      automationId: result.automationId,
      actionsExecuted: result.results.length,
      results: result.results,
    });
  } else {
    output.info('Automation executed with some failures');
    output.data({ automationId: result.automationId, results: result.results });
  }
}

export const __testables = { buildActions, buildDefinition, buildCreateBody, readDefinitionFile, parseEventOption };

// ============================================================================
// COMMANDS
// ============================================================================

export function createAutomationsCommand(): Command {
  const automations = new Command('automations').description('Manage automations');

  // omni automations list
  automations
    .command('list')
    .description('List all automations')
    .option('--enabled', 'Show only enabled automations')
    .option('--disabled', 'Show only disabled automations')
    .action(async (options: { enabled?: boolean; disabled?: boolean }) => {
      const client = getClient();

      try {
        let enabledFilter: boolean | undefined;
        if (options.enabled) enabledFilter = true;
        if (options.disabled) enabledFilter = false;

        const result = await client.automations.list({ enabled: enabledFilter });

        const items = result.map((a) => ({
          id: a.id,
          name: a.name,
          trigger: a.triggerEventType,
          enabled: a.enabled ? 'yes' : 'no',
          priority: a.priority,
          // Compiled from an agent manifest (#986) — managed rows reject
          // manual mutation; edit the owning agent's manifest instead.
          managed: a.managedByAgentId ? 'manifest' : '-',
        }));

        output.list(items, { emptyMessage: 'No automations found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list automations: ${message}`);
      }
    });

  // omni automations get <id>
  automations
    .command('get <id>')
    .description('Get automation details')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const automationId = await resolveAutomationId(id);
        const automation = await client.automations.get(automationId);
        output.data(automation);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get automation: ${message}`);
      }
    });

  // omni automations create
  automations
    .command('create')
    .description('Create an automation')
    .option('--file <path>', 'Full definition as JSON (the `get` output works as-is); explicit flags override it')
    .option('--name <name>', 'Automation name')
    .option('--trigger <event>', 'Trigger event type (e.g., message.received)')
    .option(
      '--action <type>',
      'Action type (webhook, send_message, emit_event, log, call_agent); repeat for ordered multi-action',
      collectRepeated,
    )
    .option('--action-config <json>', 'Action config as JSON; the i-th pairs with the i-th --action', collectRepeated)
    .option('--condition <json>', 'Trigger conditions as JSON array')
    .option('--condition-logic <logic>', 'Condition logic: "and" (all must match) or "or" (any must match)')
    .option('--description <desc>', 'Automation description')
    .option('--priority <n>', 'Priority (higher = runs first)', (v) => Number.parseInt(v, 10))
    .option('--disabled', 'Create in disabled state')
    .option(
      '--transactional-emissions',
      "Buffer the run's emit_event publishes and flush them in order only when every action succeeded; " +
        'a failed run publishes zero (#988). Defaults to off (immediate publishing)',
    )
    // call_agent specific options
    .option('--agent-id <id>', 'Agent ID (for the first call_agent action)')
    .option('--provider-id <id>', 'Provider ID (for the first call_agent action)')
    .option('--response-as <var>', 'Store agent response as variable (for the first call_agent action)')
    .action(async (options: CreateOptions) => {
      const client = getClient();

      try {
        const automation = await client.automations.create(buildCreateBody(options));

        output.success(`Automation created: ${automation.id}`, {
          id: automation.id,
          name: automation.name,
          trigger: automation.triggerEventType,
          actions: automation.actions.length,
          enabled: automation.enabled,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to create automation: ${message}`);
      }
    });

  // omni automations update <id>
  automations
    .command('update <id>')
    .description('Update an automation in place (id and execution logs are kept)')
    .option('--file <path>', 'Full definition as JSON (the `get` output works as-is); explicit flags override it')
    .option('--name <name>', 'New name')
    .option('--description <desc>', 'New description')
    .option('--trigger <event>', 'New trigger event type')
    .option('--condition <json>', 'Replace trigger conditions (JSON array)')
    .option('--condition-logic <logic>', 'Condition logic: "and" or "or"')
    .option('--action <type>', 'Replace the actions list; repeat for ordered multi-action', collectRepeated)
    .option('--action-config <json>', 'Action config as JSON; the i-th pairs with the i-th --action', collectRepeated)
    .option('--priority <n>', 'New priority', (v) => Number.parseInt(v, 10))
    .option(
      '--transactional-emissions',
      "Buffer the run's emit_event publishes and flush them in order only when every action succeeded; " +
        'a failed run publishes zero (#988)',
    )
    .option('--no-transactional-emissions', 'Return the automation to immediate mid-sequence publishing')
    .option('--agent-id <id>', 'Agent ID (for the first call_agent action)')
    .option('--provider-id <id>', 'Provider ID (for the first call_agent action)')
    .option('--response-as <var>', 'Store agent response as variable (for the first call_agent action)')
    // Commander negatable pair (#988, mirrors --strict-schemas from #1000):
    // true from --transactional-emissions, false from
    // --no-transactional-emissions, undefined when neither flag is given —
    // the field is then omitted from the PATCH and stays untouched.
    .action(async (id: string, options: DefinitionOptions) => {
      const client = getClient();

      try {
        const body = buildDefinition(options);
        if (Object.keys(body).length === 0) {
          output.error('Nothing to update: pass at least one field flag or --file');
          return;
        }
        const automationId = await resolveAutomationId(id);
        const automation = await client.automations.update(automationId, body);

        output.success(`Automation updated: ${automation.id}`, {
          id: automation.id,
          name: automation.name,
          trigger: automation.triggerEventType,
          actions: automation.actions.length,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to update automation: ${message}`);
      }
    });

  // omni automations delete <id>
  automations
    .command('delete <id>')
    .description('Delete an automation')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const automationId = await resolveAutomationId(id);
        await client.automations.delete(automationId);
        output.success(`Automation deleted: ${automationId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to delete automation: ${message}`);
      }
    });

  // omni automations enable <id>
  automations
    .command('enable <id>')
    .description('Enable an automation')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const automationId = await resolveAutomationId(id);
        const automation = await client.automations.enable(automationId);
        output.success(`Automation enabled: ${automation.name}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to enable automation: ${message}`);
      }
    });

  // omni automations disable <id>
  automations
    .command('disable <id>')
    .description('Disable an automation')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const automationId = await resolveAutomationId(id);
        const automation = await client.automations.disable(automationId);
        output.success(`Automation disabled: ${automation.name}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to disable automation: ${message}`);
      }
    });

  // omni automations test <id>
  automations
    .command('test <id>')
    .description('Dry-run an automation against a mock event or a REAL journaled event: verdicts, no side effects')
    .requiredOption(
      '--event <json|event-id>',
      'Event JSON (\'{"type":"message.received","payload":{}}\') or the id of a journaled event (omni events list)',
    )
    .option('--execute', 'Actually run the actions against the event (same as `execute`)', false)
    .action(async (id: string, options: { event: string; execute: boolean }) => {
      const client = getClient();

      try {
        const automationId = await resolveAutomationId(id);
        const body = parseEventOption(options.event);
        if (!body) {
          output.error('--event must be valid JSON with "type" and "payload" fields, or a journaled event UUID');
          return;
        }

        if (options.execute) {
          reportExecution(await client.automations.execute(automationId, body));
          return;
        }

        const result = await client.automations.test(automationId, body);
        const verdicts = result.conditions.map((c) => ({
          field: c.field,
          operator: c.operator,
          expected: c.expected === undefined ? '' : JSON.stringify(c.expected),
          actual: c.resolved ? JSON.stringify(c.actual) : '(unresolved)',
          matched: c.matched ? 'yes' : 'no',
        }));
        const summary = result.matched
          ? 'Automation matched the event (dry run — nothing executed)'
          : result.triggerMatched
            ? `Conditions did not match (${result.conditionLogic})`
            : 'Trigger did not match: event type differs from the automation trigger';

        if (result.matched) output.success(summary);
        else output.info(summary);
        if (getCurrentFormat() === 'json') {
          output.data(result);
          return;
        }
        if (verdicts.length > 0) {
          output.header('Conditions');
          output.list(verdicts, { rawData: result.conditions });
        }
        output.header('Actions (templates rendered, not executed)');
        output.data(result.actions);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to test automation: ${message}`);
      }
    });

  // omni automations execute <id>
  automations
    .command('execute <id>')
    .description('Execute an automation with a provided or journaled event (actually runs actions)')
    .requiredOption('--event <json|event-id>', 'Event JSON or the id of a journaled event')
    .action(async (id: string, options: { event: string }) => {
      const client = getClient();

      try {
        const automationId = await resolveAutomationId(id);
        const body = parseEventOption(options.event);
        if (!body) {
          output.error('--event must be valid JSON with "type" and "payload" fields, or a journaled event UUID');
          return;
        }
        reportExecution(await client.automations.execute(automationId, body));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to execute automation: ${message}`);
      }
    });

  // omni automations logs <id>
  automations
    .command('logs <id>')
    .description('Get automation execution logs')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10), 20)
    .option('--cursor <cursor>', 'Pagination cursor')
    .action(async (id: string, options: { limit?: number; cursor?: string }) => {
      const client = getClient();
      const automationId = await resolveAutomationId(id);

      try {
        const result = await client.automations.getLogs(automationId, {
          limit: options.limit,
          cursor: options.cursor,
        });

        output.list(result.items, { emptyMessage: 'No logs found for this automation.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get automation logs: ${message}`);
      }
    });

  return automations;
}
