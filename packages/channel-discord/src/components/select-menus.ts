/**
 * Select menu component builder
 *
 * Creates dropdown selection components for messages.
 */

import {
  ActionRowBuilder,
  type Client,
  type DMChannel,
  type MessageCreateOptions,
  StringSelectMenuBuilder,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import type { SelectMenuOption, SelectMenuOptions } from '../types';

type SendableChannel = TextChannel | DMChannel | ThreadChannel;

/**
 * Build a string select menu
 *
 * @param options - Select menu configuration
 * @returns StringSelectMenuBuilder instance
 */
export function buildSelectMenu(options: SelectMenuOptions): StringSelectMenuBuilder {
  const menu = new StringSelectMenuBuilder().setCustomId(options.customId).setDisabled(options.disabled ?? false);

  if (options.placeholder) {
    menu.setPlaceholder(options.placeholder);
  }

  if (options.minValues !== undefined) {
    menu.setMinValues(options.minValues);
  }

  if (options.maxValues !== undefined) {
    menu.setMaxValues(options.maxValues);
  }

  menu.addOptions(
    options.options.map((opt) => ({
      label: opt.label,
      value: opt.value,
      description: opt.description,
      emoji: opt.emoji ? { name: opt.emoji } : undefined,
      default: opt.default,
    })),
  );

  return menu;
}

/**
 * Build an action row with a select menu
 *
 * @param options - Select menu configuration
 * @returns ActionRowBuilder with select menu
 */
export function buildSelectMenuRow(options: SelectMenuOptions): ActionRowBuilder<StringSelectMenuBuilder> {
  const row = new ActionRowBuilder<StringSelectMenuBuilder>();
  row.addComponents(buildSelectMenu(options));
  return row;
}

/**
 * Build message content with select menu
 *
 * @param text - Message text
 * @param menuOptions - Select menu configuration
 * @returns MessageCreateOptions
 */
export function buildSelectMenuMessage(text: string, menuOptions: SelectMenuOptions): MessageCreateOptions {
  return {
    content: text,
    components: [buildSelectMenuRow(menuOptions)],
  };
}

/**
 * Send a message with a select menu
 *
 * @param client - Discord client
 * @param channelId - Channel to send to
 * @param text - Message text
 * @param menuOptions - Select menu configuration
 * @param replyToId - Optional message ID to reply to
 * @returns Message ID
 */
export async function sendSelectMenuMessage(
  client: Client,
  channelId: string,
  text: string,
  menuOptions: SelectMenuOptions,
  replyToId?: string,
): Promise<string> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel or cannot be accessed`);
  }

  const sendChannel = channel as SendableChannel;
  const options = buildSelectMenuMessage(text, menuOptions);

  if (replyToId) {
    options.reply = { messageReference: replyToId };
  }

  const result = await sendChannel.send(options);
  return result.id;
}

/**
 * Update a select menu's options
 *
 * @param client - Discord client
 * @param channelId - Channel containing the message
 * @param messageId - Message ID
 * @param newOptions - New select menu options
 */
export async function updateSelectMenuOptions(
  client: Client,
  channelId: string,
  messageId: string,
  newOptions: SelectMenuOption[],
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);

  // Find the select menu component
  const row = message.components[0];
  if (!row || row.type !== 1) return; // 1 = ActionRow

  const existingMenu = row.components[0];
  if (!existingMenu || existingMenu.type !== 3) return; // 3 = StringSelect

  const newMenu = new StringSelectMenuBuilder().setCustomId(existingMenu.customId ?? 'select').addOptions(
    newOptions.map((opt) => ({
      label: opt.label,
      value: opt.value,
      description: opt.description,
      emoji: opt.emoji ? { name: opt.emoji } : undefined,
      default: opt.default,
    })),
  );

  const newRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(newMenu);

  await message.edit({
    components: [newRow],
  });
}

/**
 * Disable a select menu
 *
 * @param client - Discord client
 * @param channelId - Channel containing the message
 * @param messageId - Message ID
 */
export async function disableSelectMenu(client: Client, channelId: string, messageId: string): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);

  const row = message.components[0];
  if (!row || row.type !== 1) return; // 1 = ActionRow

  const existingMenu = row.components[0];
  if (!existingMenu || existingMenu.type !== 3) return; // 3 = StringSelect

  const disabledMenu = StringSelectMenuBuilder.from(existingMenu);
  disabledMenu.setDisabled(true);

  const newRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(disabledMenu);

  await message.edit({
    components: [newRow],
  });
}
