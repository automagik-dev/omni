/**
 * React Command — Emoji reaction verb
 *
 * omni react 👍              — react to trigger message
 * omni react 👍 --message <id> — react to specific message
 *
 * Uses context resolution (env vars > PG context > config) for instance/chat/message.
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveContext, resolveReplyTo } from '../context.js';
import * as output from '../output.js';
import { resolveInstanceId, resolveRecipient } from '../resolve.js';

interface ReactOptions {
  message?: string;
  instance?: string;
  chat?: string;
}

export function createReactCommand(): Command {
  return new Command('react')
    .description('React to a message with an emoji')
    .argument('<emoji>', 'Emoji to react with')
    .option('--message <id>', 'Message ID to react to (default: trigger message from context)')
    .option('--instance <id>', 'Override instance (default: from context)')
    .option('--chat <id>', 'Override chat (default: from context)')
    .action(async (emoji: string, options: ReactOptions) => {
      const client = getClient();

      // Resolve context — only pass instance/chat flags; message is resolved
      // separately via resolveReplyTo to avoid short-circuiting env var lookup
      const ctx = await resolveContext({
        instance: options.instance,
        chat: options.chat,
      });

      if (!ctx.instanceId) {
        return output.error('No instance in context. Set OMNI_INSTANCE, use --instance, or run: omni use <instance>');
      }
      if (!ctx.chatId) {
        return output.error('No chat in context. Set OMNI_CHAT, use --chat, or run: omni open <contact>');
      }

      try {
        const instanceId = await resolveInstanceId(ctx.instanceId);
        const chatId = await resolveRecipient(ctx.chatId, instanceId);

        // Resolve message to react to
        const messageId = await resolveReplyTo(options.message);
        if (!messageId) {
          return output.error(
            'No message to react to. Set OMNI_MESSAGE, use --message <id>, or ensure context has a trigger message.',
          );
        }

        const result = await client.messages.sendReaction({
          instanceId,
          to: chatId,
          messageId,
          emoji,
        });
        output.success(`Reacted ${emoji}`, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to react: ${message}`);
      }
    });
}
