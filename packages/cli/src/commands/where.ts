/**
 * Where Command
 *
 * omni where
 *
 * Shows the current conversation context: active instance, chat, and message.
 * Displays where each value comes from (flags, env, API, config).
 */

import { Command } from 'commander';
import { resolveContext } from '../context.js';
import * as output from '../output.js';

export function createWhereCommand(): Command {
  return new Command('where')
    .description('Show current conversation context (instance, chat, message)')
    .action(async () => {
      const ctx = await resolveContext();

      if (ctx.source === 'none') {
        output.warn('No active context. Run: omni open <contact> or omni use <instance>');
        return;
      }

      const sourceLabel: Record<string, string> = {
        flags: 'CLI flags',
        env: 'environment variables',
        api: 'stored context (PG)',
        config: 'config defaults',
      };

      output.data({
        instance: ctx.instanceId ?? '(not set)',
        chat: ctx.chatId ?? '(not set)',
        message: ctx.messageId ?? '(not set)',
        source: sourceLabel[ctx.source] ?? ctx.source,
      });
    });
}
