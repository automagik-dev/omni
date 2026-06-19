/**
 * Say Command — Text message verb
 *
 * omni say "hello"              — send text to open chat
 * omni say "hello" --reply      — quote-reply to trigger message
 * omni say "hello" --reply <id> — quote-reply to specific message
 *
 * Uses context resolution (env vars > PG context > config) for instance/chat.
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveContext, resolveReplyTo } from '../context.js';
import * as output from '../output.js';
import { resolveInstanceId, resolveRecipient } from '../resolve.js';

interface SayOptions {
  reply?: string | true;
  instance?: string;
  chat?: string;
}

export function createSayCommand(): Command {
  return new Command('say')
    .description('Send a text message to the open chat')
    .argument('<text>', 'Text message to send')
    .option('--reply [message-id]', 'Quote-reply to trigger message or specific message ID')
    .option('--instance <id>', 'Override instance (default: from context)')
    .option('--chat <id>', 'Override chat (default: from context)')
    .action(async (text: string, options: SayOptions) => {
      const client = getClient();

      // Resolve context
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

      const instanceId = await resolveInstanceId(ctx.instanceId);
      const chatId = await resolveRecipient(ctx.chatId, instanceId);

      // Resolve --reply
      let replyTo: string | undefined;
      if (options.reply !== undefined) {
        const replyId = typeof options.reply === 'string' ? options.reply : undefined;
        const resolved = await resolveReplyTo(replyId);
        if (!resolved) {
          return output.error(
            'No message to reply to. Set OMNI_MESSAGE, use --reply <id>, or run: omni open <contact>',
          );
        }
        replyTo = resolved;
      }

      try {
        const result = await client.messages.send({
          instanceId,
          to: chatId,
          text,
          replyTo,
        });
        output.success('Message sent', result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to send: ${message}`);
      }
    });
}
