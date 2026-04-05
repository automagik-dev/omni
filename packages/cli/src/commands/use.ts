/**
 * Use Command
 *
 * omni use <instance>
 *
 * Sets the active instance for the current API key.
 * Scoped agents can only use instances in their allowed list.
 * Admins can switch between any instance.
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveInstanceId } from '../resolve.js';

export function createUseCommand(): Command {
  return new Command('use')
    .description('Set active instance for verb commands')
    .argument('<instance>', 'Instance name, ID, or prefix')
    .action(async (instance: string) => {
      const client = getClient();

      // Resolve instance identifier to UUID
      const instanceId = await resolveInstanceId(instance);

      // Set as active instance via context API
      try {
        await client.context.use(instanceId);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return output.error(`Failed to set active instance: ${message}`);
      }

      // Fetch instance name for display
      try {
        const inst = await client.instances.get(instanceId);
        output.success(`Active instance: ${inst.name} (${instanceId.slice(0, 8)}…)`);
      } catch {
        output.success(`Active instance: ${instanceId.slice(0, 8)}…`);
      }
    });
}
