/**
 * Close Command
 *
 * omni close
 *
 * Clears the active conversation context. After this, verb commands
 * will require explicit --instance/--to flags or env vars.
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

export function createCloseCommand(): Command {
  return new Command('close').description('Clear active conversation context').action(async () => {
    const client = getClient();

    try {
      await client.context.clear();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return output.error(`Failed to clear context: ${message}`);
    }

    output.success('Conversation context cleared.');
  });
}
