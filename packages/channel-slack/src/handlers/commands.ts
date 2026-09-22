/**
 * Slash command handler for Slack
 *
 * Handles:
 * - Command registration with Slack API
 * - Command execution routing
 */

import type { Logger } from '@omni/channel-sdk';
import type { App } from '@slack/bolt';

/**
 * A slash command as Slack delivered it, before it is routed to an instance.
 *
 * `teamId` and `userId` are what route it: one Bolt `App` is shared by every
 * install behind the same app-level token, so the command has to be narrowed
 * to the workspace it was typed in and, within that workspace, to the human
 * who typed it (Group 5 review, HIGH #1).
 */
export interface SlackCommandEvent {
  command: string;
  text: string;
  /** Slack user id of the human who typed the command. */
  userId: string;
  channelId: string;
  /** Workspace the command was typed in (`command.team_id`). */
  teamId?: string;
  threadTs?: string;
  triggerId: string;
  responseUrl: string;
}

/** A slash command already routed to one instance. */
export interface CommandPayload extends SlackCommandEvent {
  instanceId: string;
}

export interface CommandHandlerCallbacks {
  /** Answers with an optional ephemeral reply; the callback owns the routing. */
  onCommand: (command: SlackCommandEvent) => Promise<string | undefined>;
}

/**
 * Set up slash command handlers on a Bolt.js app
 *
 * Commands must be pre-registered in the Slack App configuration.
 * This handler catches all commands and routes them.
 */
export function setupCommandHandlers(
  app: App,
  receiverKey: string,
  commandNames: string[],
  callbacks: CommandHandlerCallbacks,
  logger: Logger,
): void {
  for (const commandName of commandNames) {
    app.command(commandName, async ({ command, ack, respond }) => {
      // Acknowledge within 3 seconds
      await ack();

      logger.debug('Slash command received', {
        receiver: receiverKey,
        command: command.command,
        text: command.text,
        userId: command.user_id,
        teamId: command.team_id,
      });

      const payload: SlackCommandEvent = {
        command: command.command,
        text: command.text,
        userId: command.user_id,
        channelId: command.channel_id,
        teamId: command.team_id,
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

  logger.info('Command handlers registered', { receiver: receiverKey, commands: commandNames });
}
