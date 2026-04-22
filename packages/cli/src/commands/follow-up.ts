/**
 * Follow-up config commands (issue #404)
 *
 * omni follow-up get agents|instances|chats <id>
 * omni follow-up set agents|instances|chats <id> <json>
 * omni follow-up unset agents|instances|chats <id>
 *
 * The <json> argument is either a literal JSON string, or `@<path>` to read
 * from a file, or `-` to read from stdin.
 */

import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveAgentId, resolveChatId, resolveInstanceId } from '../resolve.js';

type Scope = 'agents' | 'instances' | 'chats';

const VALID_SCOPES: Scope[] = ['agents', 'instances', 'chats'];

function assertScope(scope: string): asserts scope is Scope {
  if (!VALID_SCOPES.includes(scope as Scope)) {
    output.error(`Invalid scope: ${scope}. Expected one of: ${VALID_SCOPES.join(', ')}`);
  }
}

async function resolveScopedId(scope: Scope, id: string): Promise<string> {
  if (scope === 'agents') return resolveAgentId(id);
  if (scope === 'instances') return resolveInstanceId(id);
  return resolveChatId(id);
}

function readJsonArg(raw: string): unknown {
  let body = raw;
  if (body === '-') {
    body = readFileSync(0, 'utf8');
  } else if (body.startsWith('@')) {
    body = readFileSync(body.slice(1), 'utf8');
  }
  try {
    return JSON.parse(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Invalid JSON: ${message}`);
  }
}

export function createFollowUpCommand(): Command {
  const cmd = new Command('follow-up').description(
    'Idle-chat follow-up config (agents/instances/chats). Closest scope wins at runtime.',
  );

  cmd
    .command('get <scope> <id>')
    .description('Read follow-up config at a scope (agents|instances|chats).')
    .action(async (scope: string, id: string) => {
      assertScope(scope);
      const resolvedId = await resolveScopedId(scope, id);
      const client = getClient();
      try {
        const data =
          scope === 'agents'
            ? await client.followUp.getAgent(resolvedId)
            : scope === 'instances'
              ? await client.followUp.getInstance(resolvedId)
              : await client.followUp.getChat(resolvedId);
        output.data(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to read ${scope} follow-up: ${message}`, undefined, 3);
      }
    });

  cmd
    .command('set <scope> <id> <json>')
    .description('Write follow-up config at a scope. <json> can be a literal, `@path`, or `-` for stdin.')
    .action(async (scope: string, id: string, json: string) => {
      assertScope(scope);
      const config = readJsonArg(json);
      const resolvedId = await resolveScopedId(scope, id);
      const client = getClient();
      try {
        const data =
          scope === 'agents'
            ? await client.followUp.setAgent(resolvedId, config as never)
            : scope === 'instances'
              ? await client.followUp.setInstance(resolvedId, config as never)
              : await client.followUp.setChat(resolvedId, config as never);
        output.success(`Follow-up config set on ${scope.slice(0, -1)} ${resolvedId}.`, data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to set ${scope} follow-up: ${message}`, undefined, 3);
      }
    });

  cmd
    .command('unset <scope> <id>')
    .description('Clear the override at a scope so broader scopes apply.')
    .action(async (scope: string, id: string) => {
      assertScope(scope);
      const resolvedId = await resolveScopedId(scope, id);
      const client = getClient();
      try {
        if (scope === 'agents') await client.followUp.unsetAgent(resolvedId);
        else if (scope === 'instances') await client.followUp.unsetInstance(resolvedId);
        else await client.followUp.unsetChat(resolvedId);
        output.success(`Follow-up config cleared on ${scope.slice(0, -1)} ${resolvedId}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to unset ${scope} follow-up: ${message}`, undefined, 3);
      }
    });

  return cmd;
}
