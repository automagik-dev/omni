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
  // Note: --json is registered on the Command for --help visibility but the
  // global CLI flag handler in index.ts strips it from argv before Commander
  // parses it, so this field is never populated. JSON mode is detected via
  // `output.getCurrentFormat() === 'json'` in the action handler.
  verbose?: boolean;
}

/**
 * Pretty-print a single log entry as multi-line text including any `data` fields.
 * Used by --verbose mode to surface stack traces, agent/chat IDs, and error context.
 */
function printVerboseEntry(entry: {
  time: number;
  level: string;
  module: string;
  msg: string;
  data?: Record<string, unknown>;
}): void {
  const time = new Date(entry.time).toISOString();
  output.raw(`${time}  [${entry.level.toUpperCase()}]  ${entry.module}`);
  output.raw(`  ${entry.msg}`);
  if (entry.data && Object.keys(entry.data).length > 0) {
    for (const [key, value] of Object.entries(entry.data)) {
      const formatted =
        typeof value === 'string' && value.includes('\n')
          ? `\n${value
              .split('\n')
              .map((line) => `    ${line}`)
              .join('\n')}`
          : typeof value === 'object'
            ? JSON.stringify(value, null, 2)
                .split('\n')
                .map((line, idx) => (idx === 0 ? line : `    ${line}`))
                .join('\n')
            : String(value);
      output.raw(`  ${key}: ${formatted}`);
    }
  }
  output.raw('');
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
    .option('--json', 'Emit raw LogEntry[] as JSON (no truncation, no summary line)', false)
    .option('--verbose', 'Multi-line pretty-print with stack traces and data fields', false)
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

        // --json mode: emit raw LogEntry[] with no truncation or summary line.
        // Note: `--json` is a global CLI flag stripped from argv before Commander
        // parses it (see packages/cli/src/index.ts), so we detect it via the
        // runtime output format rather than a subcommand-level option.
        if (output.getCurrentFormat() === 'json') {
          // biome-ignore lint/suspicious/noConsole: CLI output
          console.log(JSON.stringify(result.items, null, 2));
          await output.flushStdout();
          return;
        }

        // --verbose mode: multi-line pretty-print including `data` fields
        if (options?.verbose) {
          if (result.items.length === 0) {
            output.dim('No logs found.');
            return;
          }
          for (const entry of result.items) {
            printVerboseEntry(entry);
          }
          output.dim(`Showing ${result.items.length} of ${result.meta.total} logs (buffer: ${result.meta.bufferSize})`);
          return;
        }

        // Default mode: truncated table view
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
