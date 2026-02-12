/**
 * Routes Commands
 *
 * omni routes list <instance> [--scope chat|user] [--active]
 * omni routes get <instance> <route-id>
 * omni routes create <instance> --scope <scope> --chat <id>|--person <id> --provider <id> --agent <id> [options]
 * omni routes update <instance> <route-id> [options]
 * omni routes delete <instance> <route-id>
 * omni routes test <instance> [--chat <id>] [--person <id>]
 * omni routes metrics
 */

import type { UpdateAgentRoute } from '@omni/core';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveInstanceId } from '../resolve.js';

async function createAgentRouteAction(
  instanceArg: string,
  options: {
    scope: string;
    chat?: string;
    person?: string;
    provider: string;
    agent: string;
    agentType?: string;
    timeout?: number;
    stream?: boolean;
    prefixSender?: boolean;
    waitMedia?: boolean;
    sendMediaPath?: boolean;
    gate?: boolean;
    gateModel?: string;
    gatePrompt?: string;
    label?: string;
    priority?: number;
    inactive?: boolean;
  },
) {
  const client = getClient();

  try {
    // Validate scope-specific requirements
    if (options.scope === 'chat' && !options.chat) {
      output.error('--chat is required when scope is chat');
      return;
    }
    if (options.scope === 'user' && !options.person) {
      output.error('--person is required when scope is user');
      return;
    }
    if (options.scope !== 'chat' && options.scope !== 'user') {
      output.error('--scope must be either chat or user');
      return;
    }

    const instanceId = await resolveInstanceId(instanceArg);

    const route = await client.routes.create(instanceId, {
      scope: options.scope as 'chat' | 'user',
      chatId: options.chat,
      personId: options.person,
      agentProviderId: options.provider,
      agentId: options.agent,
      agentType: (options.agentType as 'agent' | 'team' | 'workflow') || 'agent',
      agentTimeout: options.timeout,
      agentStreamMode: options.stream,
      agentPrefixSenderName: options.prefixSender,
      agentWaitForMedia: options.waitMedia,
      agentSendMediaPath: options.sendMediaPath,
      agentGateEnabled: options.gate,
      agentGateModel: options.gateModel,
      agentGatePrompt: options.gatePrompt,
      label: options.label,
      priority: options.priority || 0,
      isActive: !options.inactive,
    });

    output.success(`Route created: ${route.id}`);
    output.data(route);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to create route: ${message}`);
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CLI option parsing requires many branches
async function updateAgentRouteAction(
  instanceArg: string,
  routeId: string,
  options: {
    agent?: string;
    agentType?: string;
    timeout?: number;
    stream?: boolean;
    prefixSender?: boolean;
    waitMedia?: boolean;
    sendMediaPath?: boolean;
    gate?: boolean;
    gateModel?: string;
    gatePrompt?: string;
    label?: string;
    priority?: number;
    active?: boolean;
    inactive?: boolean;
  },
) {
  const client = getClient();

  try {
    const instanceId = await resolveInstanceId(instanceArg);

    // Build update object with only provided options
    const updates: Partial<UpdateAgentRoute> = {};
    if (options.agent) updates.agentId = options.agent;
    if (options.agentType) updates.agentType = options.agentType as 'agent' | 'team' | 'workflow';
    if (options.timeout !== undefined) updates.agentTimeout = options.timeout;
    if (options.stream !== undefined) updates.agentStreamMode = options.stream;
    if (options.prefixSender !== undefined) updates.agentPrefixSenderName = options.prefixSender;
    if (options.waitMedia !== undefined) updates.agentWaitForMedia = options.waitMedia;
    if (options.sendMediaPath !== undefined) updates.agentSendMediaPath = options.sendMediaPath;
    if (options.gate !== undefined) updates.agentGateEnabled = options.gate;
    if (options.gateModel !== undefined) updates.agentGateModel = options.gateModel;
    if (options.gatePrompt !== undefined) updates.agentGatePrompt = options.gatePrompt;
    if (options.label !== undefined) updates.label = options.label;
    if (options.priority !== undefined) updates.priority = options.priority;
    if (options.active) updates.isActive = true;
    if (options.inactive) updates.isActive = false;

    if (Object.keys(updates).length === 0) {
      output.error('No updates provided');
      return;
    }

    const route = await client.routes.update(instanceId, routeId, updates);

    output.success('Route updated');
    output.data(route);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to update route: ${message}`);
  }
}

export function createRoutesCommand(): Command {
  const routes = new Command('routes').description('Manage agent routing configuration');

  // omni routes list <instance>
  routes
    .command('list <instance>')
    .description('List agent routes for an instance')
    .option('--scope <scope>', 'Filter by scope (chat or user)')
    .option('--active', 'Show only active routes')
    .action(async (instanceArg: string, options: { scope?: string; active?: boolean }) => {
      const client = getClient();

      try {
        const instanceId = await resolveInstanceId(instanceArg);

        const result = await client.routes.list(instanceId, {
          scope: options.scope as 'chat' | 'user' | undefined,
          isActive: options.active,
        });

        const items = result.map((r) => ({
          id: r.id.substring(0, 8),
          scope: r.scope,
          chatId: r.chatId ? r.chatId.substring(0, 8) : '-',
          personId: r.personId ? r.personId.substring(0, 8) : '-',
          provider: r.agentProviderId.substring(0, 8),
          agent: r.agentId,
          label: r.label || '-',
          priority: r.priority,
          active: r.isActive ? 'yes' : 'no',
        }));

        output.list(items, { emptyMessage: 'No routes found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list routes: ${message}`);
      }
    });

  // omni routes get <instance> <route-id>
  routes
    .command('get <instance> <routeId>')
    .description('Get agent route details')
    .action(async (instanceArg: string, routeId: string) => {
      const client = getClient();

      try {
        const instanceId = await resolveInstanceId(instanceArg);
        const route = await client.routes.get(instanceId, routeId);

        output.data(route);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get route: ${message}`);
      }
    });

  // omni routes create <instance>
  routes
    .command('create <instance>')
    .description('Create a new agent route')
    .requiredOption('--scope <scope>', 'Route scope: chat or user')
    .option('--chat <chatId>', 'Chat UUID (required when scope=chat)')
    .option('--person <personId>', 'Person UUID (required when scope=user)')
    .requiredOption('--provider <providerId>', 'Agent provider UUID')
    .requiredOption('--agent <agentId>', 'Agent ID within the provider')
    .option('--agent-type <type>', 'Agent type: agent, team, or workflow', 'agent')
    .option('--timeout <seconds>', 'Agent timeout in seconds', Number.parseInt)
    .option('--stream', 'Enable streaming responses')
    .option('--no-stream', 'Disable streaming responses')
    .option('--prefix-sender', 'Prefix messages with sender name')
    .option('--no-prefix-sender', 'Do not prefix messages with sender name')
    .option('--wait-media', 'Wait for media processing')
    .option('--no-wait-media', 'Do not wait for media processing')
    .option('--send-media-path', 'Include file path in media text')
    .option('--no-send-media-path', 'Do not include file path in media text')
    .option('--gate', 'Enable LLM response gate')
    .option('--no-gate', 'Disable LLM response gate')
    .option('--gate-model <model>', 'Response gate model')
    .option('--gate-prompt <prompt>', 'Response gate prompt')
    .option('--label <label>', 'Human-readable label for this route')
    .option('--priority <number>', 'Priority (higher = higher priority)', Number.parseInt, 0)
    .option('--inactive', 'Create route as inactive')
    .action(createAgentRouteAction);

  // omni routes update <instance> <route-id>
  routes
    .command('update <instance> <routeId>')
    .description('Update an existing agent route')
    .option('--agent <agentId>', 'Agent ID within the provider')
    .option('--agent-type <type>', 'Agent type: agent, team, or workflow')
    .option('--timeout <seconds>', 'Agent timeout in seconds', Number.parseInt)
    .option('--stream', 'Enable streaming responses')
    .option('--no-stream', 'Disable streaming responses (set to null)')
    .option('--prefix-sender', 'Prefix messages with sender name')
    .option('--no-prefix-sender', 'Do not prefix messages with sender name (set to null)')
    .option('--wait-media', 'Wait for media processing')
    .option('--no-wait-media', 'Do not wait for media processing (set to null)')
    .option('--send-media-path', 'Include file path in media text')
    .option('--no-send-media-path', 'Do not include file path in media text (set to null)')
    .option('--gate', 'Enable LLM response gate')
    .option('--no-gate', 'Disable LLM response gate (set to null)')
    .option('--gate-model <model>', 'Response gate model')
    .option('--gate-prompt <prompt>', 'Response gate prompt')
    .option('--label <label>', 'Human-readable label for this route')
    .option('--priority <number>', 'Priority (higher = higher priority)', Number.parseInt)
    .option('--active', 'Activate route')
    .option('--inactive', 'Deactivate route')
    .action(updateAgentRouteAction);

  // omni routes delete <instance> <route-id>
  routes
    .command('delete <instance> <routeId>')
    .description('Delete an agent route')
    .action(async (instanceArg: string, routeId: string) => {
      const client = getClient();

      try {
        const instanceId = await resolveInstanceId(instanceArg);
        await client.routes.delete(instanceId, routeId);

        output.success('Route deleted');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to delete route: ${message}`);
      }
    });

  // omni routes test <instance>
  routes
    .command('test <instance>')
    .description('Test route resolution for a given instance, chat, and/or person')
    .option('--chat <chatId>', 'Chat UUID to test')
    .option('--person <personId>', 'Person UUID to test')
    .action(async (instanceArg: string, options: { chat?: string; person?: string }) => {
      const client = getClient();

      try {
        const instanceId = await resolveInstanceId(instanceArg);

        if (!options.chat && !options.person) {
          output.error('At least one of --chat or --person must be provided');
          return;
        }

        // This would require a dedicated test endpoint in the API
        // For now, we'll simulate by listing matching routes
        const routes = await client.routes.list(instanceId, {});

        let matchedRoute = null;
        // Chat routes have priority over user routes
        if (options.chat) {
          matchedRoute = routes.find((r) => r.scope === 'chat' && r.chatId === options.chat && r.isActive);
        }
        if (!matchedRoute && options.person) {
          matchedRoute = routes.find((r) => r.scope === 'user' && r.personId === options.person && r.isActive);
        }

        if (matchedRoute) {
          output.success('Route found:');
          output.data(matchedRoute);
        } else {
          output.info('No matching route found - instance default will be used');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to test route: ${message}`);
      }
    });

  // omni routes metrics
  routes
    .command('metrics')
    .description('View route cache metrics')
    .action(async () => {
      const client = getClient();

      try {
        const metrics = await client.routes.getMetrics();

        output.data(metrics);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get metrics: ${message}`);
      }
    });

  return routes;
}
