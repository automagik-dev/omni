/**
 * Payloads Commands
 *
 * omni payloads list <event-id>
 * omni payloads get <event-id> <stage>
 * omni payloads delete <event-id> --reason <reason>
 * omni payloads config
 * omni payloads config <event-type> --retention <days> [--store-webhook] [--store-agent]
 * omni payloads stats
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';

const VALID_STAGES = ['webhook_raw', 'agent_request', 'agent_response', 'channel_send', 'error'] as const;

export function createPayloadsCommand(): Command {
  const payloads = new Command('payloads').description('Manage event payloads');

  // omni payloads list <event-id>
  payloads
    .command('list <eventId>')
    .description('List payloads for an event')
    .action(async (eventId: string) => {
      const client = getClient();

      try {
        const result = await client.payloads.listForEvent(eventId);

        const items = result.map((p) => ({
          stage: p.stage,
          hasData: p.hasData ? 'yes' : 'no',
          createdAt: p.createdAt,
        }));

        output.list(items, { emptyMessage: 'No payloads found for this event.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list payloads: ${message}`);
      }
    });

  // omni payloads get <event-id> <stage>
  payloads
    .command('get <eventId> <stage>')
    .description(`Get a specific payload stage (${VALID_STAGES.join(', ')})`)
    .action(async (eventId: string, stage: string) => {
      if (!VALID_STAGES.includes(stage as (typeof VALID_STAGES)[number])) {
        output.error(`Invalid stage: ${stage}. Valid stages: ${VALID_STAGES.join(', ')}`);
      }

      const client = getClient();

      try {
        const result = await client.payloads.getStage(eventId, stage as (typeof VALID_STAGES)[number]);
        output.data(result.payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get payload: ${message}`);
      }
    });

  // omni payloads delete <event-id>
  payloads
    .command('delete <eventId>')
    .description('Delete payloads for an event')
    .requiredOption('--reason <reason>', 'Reason for deletion')
    .action(async (eventId: string, options: { reason: string }) => {
      const client = getClient();

      try {
        const result = await client.payloads.delete(eventId, { reason: options.reason });
        output.success(`Deleted ${result.deleted} payload(s)`);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to delete payloads: ${message}`);
      }
    });

  // omni payloads config [event-type]
  payloads
    .command('config [eventType]')
    .description('List or update payload storage config')
    .option('--retention <days>', 'Retention days', (v) => Number.parseInt(v, 10))
    .option('--store-webhook <bool>', 'Store raw webhook payloads')
    .option('--store-agent-request <bool>', 'Store agent request payloads')
    .option('--store-agent-response <bool>', 'Store agent response payloads')
    .option('--store-channel-send <bool>', 'Store channel send payloads')
    .option('--store-error <bool>', 'Store error payloads')
    .action(
      async (
        eventType?: string,
        options?: {
          retention?: number;
          storeWebhook?: string;
          storeAgentRequest?: string;
          storeAgentResponse?: string;
          storeChannelSend?: string;
          storeError?: string;
        },
      ) => {
        const client = getClient();

        try {
          if (eventType && options && Object.keys(options).some((k) => options[k as keyof typeof options])) {
            // Update config
            const parseBool = (v: string | undefined) => (v === 'true' ? true : v === 'false' ? false : undefined);

            const config = await client.payloads.updateConfig(eventType, {
              retentionDays: options.retention,
              storeWebhookRaw: parseBool(options.storeWebhook),
              storeAgentRequest: parseBool(options.storeAgentRequest),
              storeAgentResponse: parseBool(options.storeAgentResponse),
              storeChannelSend: parseBool(options.storeChannelSend),
              storeError: parseBool(options.storeError),
            });

            output.success(`Config updated for ${eventType}`, config);
          } else {
            // List configs
            const configs = await client.payloads.listConfigs();

            const items = configs.map((c) => ({
              eventType: c.eventType,
              retention: c.retentionDays,
              webhook: c.storeWebhookRaw ? 'yes' : 'no',
              agentReq: c.storeAgentRequest ? 'yes' : 'no',
              agentRes: c.storeAgentResponse ? 'yes' : 'no',
              channelSend: c.storeChannelSend ? 'yes' : 'no',
              error: c.storeError ? 'yes' : 'no',
            }));

            output.list(items, { emptyMessage: 'No payload configs found.' });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to manage config: ${message}`);
        }
      },
    );

  // omni payloads stats
  payloads
    .command('stats')
    .description('Get payload storage statistics')
    .action(async () => {
      const client = getClient();

      try {
        const stats = await client.payloads.stats();

        output.data({
          totalPayloads: stats.totalPayloads,
          totalSize: `${(stats.totalSizeBytes / 1024 / 1024).toFixed(2)} MB`,
          byStage: stats.byStage,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get stats: ${message}`);
      }
    });

  return payloads;
}
