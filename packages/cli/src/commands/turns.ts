/**
 * Turns Commands — Admin turn management
 *
 * omni turns list [--status open|done|timeout] [--instance <id>] [--chat <id>] [--agent <id>] [--limit N]
 * omni turns get <id>
 * omni turns close <id> [--reason <text>]
 * omni turns close-all --confirm [--reason <text>]
 * omni turns stats
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

/** Format duration in ms to human-readable string */
function formatDuration(startedAt: string, closedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function createTurnsCommand(): Command {
  const cmd = new Command('turns').description('Admin turn management');

  // ── list ──────────────────────────────────────────────────────────────────
  cmd
    .command('list')
    .description('List turns with optional filters')
    .option('--status <status>', 'Filter by status (open, done, timeout)')
    .option('--instance <id>', 'Filter by instance ID')
    .option('--chat <id>', 'Filter by chat ID')
    .option('--agent <id>', 'Filter by agent ID')
    .option('--limit <n>', 'Max results (default 50)', '50')
    .option('--offset <n>', 'Offset for pagination (default 0)', '0')
    .action(async (opts) => {
      const client = getClient();
      const result = await client.turns.list({
        status: opts.status,
        instanceId: opts.instance,
        chatId: opts.chat,
        agentId: opts.agent,
        limit: Number(opts.limit),
        offset: Number(opts.offset),
      });

      const rows = result.items.map((t) => ({
        id: t.id.slice(0, 8),
        status: t.status,
        chat: t.chatId.length > 20 ? `${t.chatId.slice(0, 20)}…` : t.chatId,
        agent: t.agentId.slice(0, 8),
        duration: formatDuration(t.startedAt, t.closedAt),
        nudges: t.nudgeCount,
        msgs: t.messagesSent,
      }));

      output.list(rows, {
        emptyMessage: 'No turns found.',
        rawData: result.items,
      });
      if (output.getCurrentFormat() !== 'json') {
        output.dim(`Total: ${result.total} | Showing ${result.offset + 1}–${result.offset + result.items.length}`);
      }
    });

  // ── get ───────────────────────────────────────────────────────────────────
  cmd
    .command('get')
    .description('Get a single turn by ID')
    .argument('<id>', 'Turn ID')
    .action(async (id: string) => {
      const client = getClient();
      const turn = await client.turns.get(id);
      output.data(turn);
    });

  // ── close ─────────────────────────────────────────────────────────────────
  cmd
    .command('close')
    .description('Admin force-close a turn')
    .argument('<id>', 'Turn ID to close')
    .option('--reason <text>', 'Close reason')
    .action(async (id: string, opts: { reason?: string }) => {
      const client = getClient();
      const result = await client.turns.forceClose(id, opts.reason);
      output.success(`Turn ${result.turnId} closed`, result);
    });

  // ── close-all ─────────────────────────────────────────────────────────────
  cmd
    .command('close-all')
    .description('Bulk close all open turns (requires --confirm)')
    .option('--confirm', 'Confirm bulk close')
    .option('--reason <text>', 'Close reason')
    .action(async (opts: { confirm?: boolean; reason?: string }) => {
      if (!opts.confirm) {
        output.error('Bulk close requires --confirm flag to proceed.');
      }
      const client = getClient();
      const result = await client.turns.bulkClose(opts.reason);
      output.success(result.message, result);
    });

  // ── stats ─────────────────────────────────────────────────────────────────
  cmd
    .command('stats')
    .description('Show aggregate turn metrics')
    .action(async () => {
      const client = getClient();
      const stats = await client.turns.stats();
      output.data({
        openCount: stats.openCount,
        totalCount: stats.totalCount,
        avgDurationMs: stats.avgDurationMs,
        timeoutRate: `${(stats.timeoutRate * 100).toFixed(1)}%`,
      });
    });

  return cmd;
}
