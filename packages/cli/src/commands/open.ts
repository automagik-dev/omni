/**
 * Open Command
 *
 * omni open <contact>
 *
 * Resolves a contact (name, phone, chat ID) and sets it as the active
 * conversation context. Subsequent verb commands (say, send, react, etc.)
 * will target this chat without needing explicit --instance/--to flags.
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveInstanceFromContext } from '../context.js';
import * as output from '../output.js';
import { resolveChatId, resolveInstanceId } from '../resolve.js';

export function createOpenCommand(): Command {
  return new Command('open')
    .description('Open a conversation context (set active chat for verb commands)')
    .argument('<contact>', 'Contact name, phone number, or chat ID')
    .option('--instance <id>', 'Instance to use (default: resolved from context)')
    .action(async (contact: string, options: { instance?: string }) => {
      const client = getClient();

      // Resolve instance
      let instanceId: string;
      try {
        instanceId = await resolveInstanceFromContext(options.instance);
        // If it's a name/prefix, resolve to full UUID
        instanceId = await resolveInstanceId(instanceId);
      } catch {
        return output.error('Could not resolve instance. Use --instance or run: omni use <instance>');
      }

      // Resolve the contact to a chat ID
      let chatId: string;
      try {
        chatId = await resolveChatId(contact);
      } catch {
        return output.error(`Could not resolve contact "${contact}". Try a chat ID, name, or phone number.`);
      }

      // Store context in PG via API
      try {
        await client.context.set({ instanceId, chatId });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return output.error(`Failed to set context: ${message}`);
      }

      output.success(`Opened conversation ${chatId.slice(0, 8)}… on instance ${instanceId.slice(0, 8)}…`);
      output.dim('Verb commands (say, send, react, etc.) will now target this chat.');
    });
}
