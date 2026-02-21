/**
 * Logs Commands
 *
 * omni logs [--level <level>] [--modules <modules>] [--limit <n>]
 * omni logs --process [service]  - Stream PM2 process logs
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { isPm2Available, pm2NotFoundError, resolveProcessName } from '../pm2.js';

// ============================================================================
// PM2 LOG STREAMING
// ============================================================================

async function streamProcessLogs(service: string, lines: number, follow: boolean): Promise<void> {
  if (!(await isPm2Available())) {
    pm2NotFoundError();
  }

  const processName = resolveProcessName(service);
  const pm2Args = ['logs', processName, '--lines', String(lines)];
  if (!follow) {
    pm2Args.push('--nostream');
  }

  const proc = Bun.spawn({
    cmd: ['pm2', ...pm2Args],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  });
  await proc.exited;
}

// ============================================================================
// COMMAND FACTORY
// ============================================================================

interface LogsActionOptions {
  modules?: string;
  limit: number;
  process?: true | string;
  follow: boolean;
}

export function createLogsCommand(): Command {
  const logs = new Command('logs').description('View system logs');

  // omni logs (default action)
  logs
    .argument('[level]', 'Log level filter (debug, info, warn, error)')
    .option('--modules <modules>', 'Comma-separated module names to filter')
    .option('--limit <n>', 'Limit results', (v: string) => Number.parseInt(v, 10), 100)
    .option('--process [service]', 'Stream PM2 process logs (default: api)')
    .option('--follow', 'Stream live logs (only with --process)', false)
    .action(async (level?: string, options?: LogsActionOptions) => {
      // --process mode: stream PM2 logs
      if (options?.process !== undefined) {
        const service = typeof options.process === 'string' ? options.process : 'api';
        await streamProcessLogs(service, options.limit, options.follow);
        return;
      }

      // Default mode: query API structured logs
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
