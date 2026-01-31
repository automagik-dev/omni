/**
 * Button component builder
 *
 * Creates interactive button components for messages.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  type DMChannel,
  type MessageCreateOptions,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import type { ButtonOptions, ButtonStyleType } from '../types';

type SendableChannel = TextChannel | DMChannel | ThreadChannel;

/**
 * Map style string to Discord ButtonStyle
 */
function mapButtonStyle(style: ButtonStyleType): ButtonStyle {
  switch (style) {
    case 'Primary':
      return ButtonStyle.Primary;
    case 'Secondary':
      return ButtonStyle.Secondary;
    case 'Success':
      return ButtonStyle.Success;
    case 'Danger':
      return ButtonStyle.Danger;
    case 'Link':
      return ButtonStyle.Link;
    default:
      return ButtonStyle.Primary;
  }
}

/**
 * Build a single button
 *
 * @param options - Button configuration
 * @returns ButtonBuilder instance
 */
export function buildButton(options: ButtonOptions): ButtonBuilder {
  const button = new ButtonBuilder()
    .setLabel(options.label)
    .setStyle(mapButtonStyle(options.style ?? 'Primary'))
    .setDisabled(options.disabled ?? false);

  // Link buttons use URL, others use customId
  if (options.style === 'Link' && options.url) {
    button.setURL(options.url);
  } else {
    button.setCustomId(options.customId);
  }

  if (options.emoji) {
    button.setEmoji(options.emoji);
  }

  return button;
}

/**
 * Build an action row with buttons
 *
 * @param buttons - Array of button options (max 5 per row)
 * @returns ActionRowBuilder with buttons
 */
export function buildButtonRow(buttons: ButtonOptions[]): ActionRowBuilder<ButtonBuilder> {
  if (buttons.length > 5) {
    throw new Error('Maximum 5 buttons per row');
  }

  const row = new ActionRowBuilder<ButtonBuilder>();
  row.addComponents(buttons.map(buildButton));
  return row;
}

/**
 * Build multiple rows of buttons
 *
 * @param buttons - 2D array of button options (outer = rows, inner = buttons)
 * @returns Array of ActionRowBuilder
 */
export function buildButtonRows(buttons: ButtonOptions[][]): ActionRowBuilder<ButtonBuilder>[] {
  if (buttons.length > 5) {
    throw new Error('Maximum 5 rows per message');
  }

  return buttons.map(buildButtonRow);
}

/**
 * Build message content with buttons
 *
 * @param text - Message text
 * @param buttons - Button configuration (1D for single row, 2D for multiple rows)
 * @returns MessageCreateOptions
 */
export function buildButtonMessage(text: string, buttons: ButtonOptions[] | ButtonOptions[][]): MessageCreateOptions {
  // Normalize to 2D array
  const rows =
    Array.isArray(buttons[0]) && 'customId' in buttons[0]
      ? [buttons as ButtonOptions[]]
      : (buttons as ButtonOptions[][]);

  return {
    content: text,
    components: buildButtonRows(rows),
  };
}

/**
 * Send a message with buttons
 *
 * @param client - Discord client
 * @param channelId - Channel to send to
 * @param text - Message text
 * @param buttons - Button configuration
 * @param replyToId - Optional message ID to reply to
 * @returns Message ID
 */
export async function sendButtonMessage(
  client: Client,
  channelId: string,
  text: string,
  buttons: ButtonOptions[] | ButtonOptions[][],
  replyToId?: string,
): Promise<string> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel or cannot be accessed`);
  }

  const sendChannel = channel as SendableChannel;
  const options = buildButtonMessage(text, buttons);

  if (replyToId) {
    options.reply = { messageReference: replyToId };
  }

  const result = await sendChannel.send(options);
  return result.id;
}

/**
 * Update a message's buttons (disable, change label, etc.)
 *
 * @param client - Discord client
 * @param channelId - Channel containing the message
 * @param messageId - Message ID
 * @param buttons - New button configuration
 */
export async function updateButtons(
  client: Client,
  channelId: string,
  messageId: string,
  buttons: ButtonOptions[] | ButtonOptions[][],
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);

  // Normalize to 2D array
  const rows =
    Array.isArray(buttons[0]) && 'customId' in buttons[0]
      ? [buttons as ButtonOptions[]]
      : (buttons as ButtonOptions[][]);

  await message.edit({
    components: buildButtonRows(rows),
  });
}

/**
 * Disable all buttons on a message
 *
 * @param client - Discord client
 * @param channelId - Channel containing the message
 * @param messageId - Message ID
 */
export async function disableAllButtons(client: Client, channelId: string, messageId: string): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);

  const disabledRows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (const row of message.components) {
    if (row.type !== 1) continue; // Skip non-ActionRow components

    const newRow = new ActionRowBuilder<ButtonBuilder>();
    for (const component of row.components) {
      if (component.type === 2) {
        // Button type
        const button = ButtonBuilder.from(component);
        button.setDisabled(true);
        newRow.addComponents(button);
      }
    }
    if (newRow.components.length > 0) {
      disabledRows.push(newRow);
    }
  }

  await message.edit({ components: disabledRows });
}
