/**
 * Slack-only commands (#889)
 *
 *   omni slack dm <instance> <userId>       — resolve/open the DM channel
 *   omni slack search <instance> <query>    — full-text search (user token only)
 *
 * Neither has a cross-channel equivalent, which is why they live here rather
 * than under `omni messages`.
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { resolveInstanceId } from '../resolve.js';

export function createSlackCommand(): Command {
  const cmd = new Command('slack').description('Slack-only operations: open a DM, search messages (#889)');

  cmd
    .command('dm <instance> <userId>')
    .description('Resolve the DM channel id for a Slack user (U…). Idempotent.')
    .action(async (instance: string, userId: string) => {
      try {
        const instanceId = await resolveInstanceId(instance);
        const { channelId } = await getClient().slack.openDm(instanceId, userId);
        output.success(`DM channel with ${userId}: ${channelId}`);
        output.info(`Send with: omni send text ${instance} ${channelId} "..."`);
      } catch (err) {
        output.error(`Failed to open DM: ${err instanceof Error ? err.message : 'Unknown error'}`, undefined, 3);
      }
    });

  cmd
    .command('search <instance> <query>')
    .description("Search messages. Needs an instance in 'user' auth mode — a bot token cannot search.")
    .option('--count <n>', 'Results per page', '20')
    .option('--page <n>', 'Page number', '1')
    .action(async (instance: string, query: string, opts) => {
      try {
        const instanceId = await resolveInstanceId(instance);
        const matches = await getClient().slack.search(instanceId, query, {
          count: Number(opts.count),
          page: Number(opts.page),
        });

        if (matches.length === 0) {
          output.info('No matches.');
          return;
        }

        output.list(
          matches.map((m) => ({
            channel: String(m.channelId ?? ''),
            ts: String(m.ts ?? ''),
            from: String(m.username ?? ''),
            text: String(m.text ?? '').slice(0, 80),
          })),
        );
        // Slack applies the authorizing user's own search preferences, so this
        // is that person's view of the workspace, not a neutral index query.
        output.info(`${matches.length} result(s), from the authorizing user's perspective.`);
      } catch (err) {
        output.error(`Search failed: ${err instanceof Error ? err.message : 'Unknown error'}`, undefined, 3);
      }
    });

  return cmd;
}
