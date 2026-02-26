/**
 * Slash command handler for Slack
 *
 * Handles:
 * - Command registration with Slack API
 * - Command execution routing
 */

import type { Logger } from '@omni/channel-sdk';
import type { App } from '@slack/bolt';

export interface CommandPayload {
  instanceId: string;
  command: string;
  text: string;
  userId: string;
  channelId: string;
  threadTs?: string;
  triggerId: string;
  responseUrl: string;
}

export interface CommandHandlerCallbacks {
  onCommand: (payload: CommandPayload) => Promise<string | undefined>;
}

/**
 * Set up slash command handlers on a Bolt.js app
 *
 * Commands must be pre-registered in the Slack App configuration.
 * This handler catches all commands and routes them.
 */
export function setupCommandHandlers(
  app: App,
  instanceId: string,
  commandNames: string[],
  callbacks: CommandHandlerCallbacks,
  logger: Logger,
): void {
  for (const commandName of commandNames) {
    app.command(commandName, async ({ command, ack, respond }) => {
      // Acknowledge within 3 seconds
      await ack();

      logger.debug('Slash command received', {
        instanceId,
        command: command.command,
        text: command.text,
        userId: command.user_id,
      });

      const payload: CommandPayload = {
        instanceId,
        command: command.command,
        text: command.text,
        userId: command.user_id,
        channelId: command.channel_id,
        triggerId: command.trigger_id,
        responseUrl: command.response_url,
      };

      try {
        const response = await callbacks.onCommand(payload);
        if (response) {
          await respond({ text: response, response_type: 'ephemeral' });
        }
      } catch (error) {
        logger.error('Command execution failed', { command: commandName, error: String(error) });
        await respond({ text: 'An error occurred while processing the command.', response_type: 'ephemeral' });
      }
    });
  }

  logger.info('Command handlers registered', { instanceId, commands: commandNames });
}
