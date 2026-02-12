/**
 * Automations Commands
 *
 * omni automations list [--enabled]
 * omni automations get <id>
 * omni automations create --name <name> --trigger <event> --action <type> [--config <json>]
 * omni automations update <id> [--name <name>] [--enabled]
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
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveAutomationId } from '../resolve.js';

// ============================================================================
// HELPERS
// ============================================================================

interface CreateOptions {
  name: string;
  trigger: string;
  action: string;
  actionConfig?: string;
  condition?: string;
  conditionLogic?: string;
  description?: string;
  priority?: number;
  disabled?: boolean;
  agentId?: string;
  providerId?: string;
  responseAs?: string;
}

/** Parse JSON or return error message */
function parseJson<T>(json: string, fieldName: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(json) as T };
  } catch {
    return { ok: false, error: `Invalid JSON for ${fieldName}` };
  }
}

/** Build action config from options */
function buildActionConfig(
  options: CreateOptions,
): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  let config: Record<string, unknown> = {};

  if (options.actionConfig) {
    const result = parseJson<Record<string, unknown>>(options.actionConfig, '--action-config');
    if (!result.ok) return result;
    config = result.value;
  }

  if (options.action === 'call_agent') {
    if (options.agentId) config.agentId = options.agentId;
    if (options.providerId) config.providerId = options.providerId;
    if (options.responseAs) config.responseAs = options.responseAs;

    if (!config.agentId) {
      return { ok: false, error: 'call_agent action requires --agent-id or agentId in --action-config' };
    }
  }

  return { ok: true, config };
}

/** Parse and validate conditions */
function parseConditions(
  options: CreateOptions,
):
  | { ok: true; conditions?: Array<{ field: string; operator: string; value?: unknown }>; logic?: 'and' | 'or' }
  | { ok: false; error: string } {
  let conditions: Array<{ field: string; operator: string; value?: unknown }> | undefined;
  let logic: 'and' | 'or' | undefined;

  if (options.condition) {
    const result = parseJson<typeof conditions>(options.condition, '--condition');
    if (!result.ok) return result;
    conditions = result.value;
  }

  if (options.conditionLogic) {
    if (options.conditionLogic !== 'and' && options.conditionLogic !== 'or') {
      return { ok: false, error: '--condition-logic must be "and" or "or"' };
    }
    logic = options.conditionLogic;
  }

  return { ok: true, conditions, logic };
}

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
    .requiredOption('--name <name>', 'Automation name')
    .requiredOption('--trigger <event>', 'Trigger event type (e.g., message.received)')
    .requiredOption('--action <type>', 'Action type (webhook, send_message, emit_event, log, call_agent)')
    .option('--action-config <json>', 'Action config as JSON')
    .option('--condition <json>', 'Trigger conditions as JSON array')
    .option('--condition-logic <logic>', 'Condition logic: "and" (all must match) or "or" (any must match)')
    .option('--description <desc>', 'Automation description')
    .option('--priority <n>', 'Priority (higher = runs first)', (v) => Number.parseInt(v, 10))
    .option('--disabled', 'Create in disabled state')
    // call_agent specific options
    .option('--agent-id <id>', 'Agent ID (for call_agent action)')
    .option('--provider-id <id>', 'Provider ID (for call_agent action)')
    .option('--response-as <var>', 'Store agent response as variable (for call_agent action)')
    .action(async (options: CreateOptions) => {
      const client = getClient();

      try {
        const actionResult = buildActionConfig(options);
        if (!actionResult.ok) {
          output.error(actionResult.error);
          return;
        }

        const conditionResult = parseConditions(options);
        if (!conditionResult.ok) {
          output.error(conditionResult.error);
          return;
        }

        const automation = await client.automations.create({
          name: options.name,
          description: options.description,
          triggerEventType: options.trigger,
          triggerConditions: conditionResult.conditions as Parameters<
            typeof client.automations.create
          >[0]['triggerConditions'],
          conditionLogic: conditionResult.logic,
          actions: [
            {
              type: options.action as 'webhook' | 'send_message' | 'emit_event' | 'log' | 'call_agent',
              config: actionResult.config,
            },
          ],
          priority: options.priority,
          enabled: !options.disabled,
        });

        output.success(`Automation created: ${automation.id}`, {
          id: automation.id,
          name: automation.name,
          trigger: automation.triggerEventType,
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
    .description('Update an automation')
    .option('--name <name>', 'New name')
    .option('--description <desc>', 'New description')
    .option('--priority <n>', 'New priority', (v) => Number.parseInt(v, 10))
    .action(async (id: string, options: { name?: string; description?: string; priority?: number }) => {
      const client = getClient();

      try {
        const automationId = await resolveAutomationId(id);
        const automation = await client.automations.update(automationId, {
          name: options.name,
          description: options.description,
          priority: options.priority,
        });

        output.success(`Automation updated: ${automation.id}`, {
          id: automation.id,
          name: automation.name,
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
    .description('Test an automation with a mock event')
    .requiredOption('--event <json>', 'Event JSON (e.g., \'{"type":"message.received","payload":{}}\')')
    .action(async (id: string, options: { event: string }) => {
      const client = getClient();

      try {
        const automationId = await resolveAutomationId(id);
        let event: { type: string; payload: Record<string, unknown> };
        try {
          event = JSON.parse(options.event);
        } catch {
          output.error('Invalid JSON for --event');
          return;
        }

        if (!event.type || !event.payload) {
          output.error('Event must have "type" and "payload" fields');
        }

        const result = await client.automations.test(automationId, { event });

        if (result.matched) {
          output.success('Automation matched the event', {
            matched: true,
            wouldExecute: result.wouldExecute,
          });
        } else {
          output.info('Automation did not match the event');
          output.data({ matched: false });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to test automation: ${message}`);
      }
    });

  // omni automations execute <id>
  automations
    .command('execute <id>')
    .description('Execute an automation with a provided event (actually runs actions)')
    .requiredOption('--event <json>', 'Event JSON (e.g., \'{"type":"message.received","payload":{...}}\')')
    .action(async (id: string, options: { event: string }) => {
      const client = getClient();

      try {
        const automationId = await resolveAutomationId(id);
        let event: { type: string; payload: Record<string, unknown> };
        try {
          event = JSON.parse(options.event);
        } catch {
          output.error('Invalid JSON for --event');
          return;
        }

        if (!event.type || !event.payload) {
          output.error('Event must have "type" and "payload" fields');
          return;
        }

        const result = await client.automations.execute(automationId, { event });

        if (result.triggered) {
          const allSuccess = result.results.every((r: { status: string }) => r.status === 'success');
          if (allSuccess) {
            output.success('Automation executed successfully', {
              automationId: result.automationId,
              actionsExecuted: result.results.length,
              results: result.results,
            });
          } else {
            output.info('Automation executed with some failures');
            output.data({
              automationId: result.automationId,
              results: result.results,
            });
          }
        } else {
          output.info('Automation not triggered (event type did not match)');
          output.data({ triggered: false });
        }
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
