/**
 * Logs Commands
 *
 * omni logs [--level <level>] [--modules <modules>] [--limit <n>]
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

export function createLogsCommand(): Command {
  const logs = new Command('logs').description('View system logs');

  // omni logs (default action)
  logs
    .argument('[level]', 'Log level filter (debug, info, warn, error)')
    .option('--modules <modules>', 'Comma-separated module names to filter')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10), 100)
    .action(async (level?: string, options?: { modules?: string; limit?: number }) => {
      const client = getClient();

      try {
        const result = await client.logs.recent({
          level: level as 'debug' | 'info' | 'warn' | 'error' | undefined,
          modules: options?.modules,
          limit: options?.limit,
        });

        const items = result.items.map((l) => ({
          time: new Date(l.time).toISOString(),
          level: l.level,
          module: l.module,
          message: l.msg.substring(0, 80),
        }));

        output.list(items, { emptyMessage: 'No logs found.' });
        output.dim(`Showing ${result.items.length} of ${result.meta.total} logs (buffer: ${result.meta.bufferSize})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get logs: ${message}`);
      }
    });

  return logs;
}
