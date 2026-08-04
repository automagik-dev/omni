/**
 * Scheduled message commands (#889)
 *
 *   omni schedule send <instance> <chat> <text> --at <when>
 *   omni schedule list <instance>
 *   omni schedule get <id>
 *   omni schedule cancel <id>
 *
 * The delivery mode is decided server-side from the channel's
 * canScheduleMessage capability — the caller cannot know which channels
 * schedule natively, and choosing wrong would silently change the durability
 * guarantee.
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveInstanceId } from '../resolve.js';

/**
 * Parse `--at`: an ISO-8601 instant, or a relative offset like `30m`, `2h`, `3d`.
 *
 * Relative offsets exist because that is how a human actually thinks about
 * this ("mandar daqui a 2h"), and hand-writing an ISO timestamp in the right
 * timezone is exactly the step that goes wrong.
 */
export function parseSendAt(raw: string, now: Date = new Date()): Date {
  const relative = /^(\d+)\s*(m|h|d)$/i.exec(raw.trim());
  if (relative) {
    const amount = Number(relative[1]);
    const unit = (relative[2] ?? '').toLowerCase();
    const ms = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return new Date(now.getTime() + amount * ms);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Could not read "${raw}" as a time. Use an ISO-8601 instant or a relative offset (30m, 2h, 3d).`);
  }

  // A bare "2026-08-05 14:00" is parsed in the HOST's timezone, which is a
  // silent trap when the server sits elsewhere. Say what we understood.
  return parsed;
}

export function createScheduleCommand(): Command {
  const cmd = new Command('schedule').description('Schedule messages for later delivery (#889)');

  cmd
    .command('send <instance> <chat> <text>')
    .description('Schedule a text message. <chat> is the PLATFORM id (Slack C…/D…).')
    .requiredOption('--at <when>', 'ISO-8601 instant, or a relative offset: 30m, 2h, 3d')
    .option('--thread <ts>', 'Post into this thread (Slack thread_ts)')
    .option('--broadcast', 'Also surface it in the channel (Slack reply_broadcast)')
    .action(async (instance: string, chat: string, text: string, opts) => {
      try {
        const sendAt = parseSendAt(opts.at);
        const instanceId = await resolveInstanceId(instance);
        const row = await getClient().scheduledMessages.schedule({
          instanceId,
          chatId: chat,
          content: { type: 'text', text },
          sendAt: sendAt.toISOString(),
          threadId: opts.thread,
          isThreadBroadcast: opts.broadcast === true,
        });

        output.success(`Scheduled for ${sendAt.toISOString()} (${row.deliveryMode} mode) — id ${row.id}`);
      } catch (err) {
        output.error(`Failed to schedule: ${err instanceof Error ? err.message : 'Unknown error'}`, undefined, 3);
      }
    });

  cmd
    .command('list <instance>')
    .description('List pending messages scheduled through omni.')
    .option('--limit <n>', 'Max rows', '100')
    .action(async (instance: string, opts) => {
      try {
        const instanceId = await resolveInstanceId(instance);
        const rows = await getClient().scheduledMessages.listPending(instanceId, Number(opts.limit));

        if (rows.length === 0) {
          output.info('No pending scheduled messages.');
          // Not the same as "nothing is scheduled": anything scheduled by hand
          // in the Slack UI is invisible to the API.
          output.info('(Only messages scheduled through omni are listed.)');
          return;
        }

        output.list(
          rows.map((r) => ({
            id: String(r.id ?? ''),
            sendAt: String(r.sendAt ?? ''),
            chat: String(r.chatExternalId ?? ''),
            mode: String(r.deliveryMode ?? ''),
            status: String(r.status ?? ''),
          })),
        );
      } catch (err) {
        output.error(`Failed to list: ${err instanceof Error ? err.message : 'Unknown error'}`, undefined, 3);
      }
    });

  cmd
    .command('get <id>')
    .description('Show one scheduled message.')
    .action(async (id: string) => {
      try {
        const row = await getClient().scheduledMessages.get(id);
        if (!row) {
          output.error(`Scheduled message ${id} not found.`, undefined, 4);
          return;
        }
        output.data(row);
      } catch (err) {
        output.error(`Failed to read: ${err instanceof Error ? err.message : 'Unknown error'}`, undefined, 3);
      }
    });

  cmd
    .command('cancel <id>')
    .description('Cancel a pending scheduled message.')
    .action(async (id: string) => {
      try {
        const row = await getClient().scheduledMessages.cancel(id);
        output.success(`Scheduled message ${id} is now ${row.status}.`);
      } catch (err) {
        output.error(`Failed to cancel: ${err instanceof Error ? err.message : 'Unknown error'}`, undefined, 3);
      }
    });

  return cmd;
}
