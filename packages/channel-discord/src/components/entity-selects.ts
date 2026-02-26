/**
 * Entity select menu component builders
 *
 * Provides builders for User, Role, Channel, and Mentionable select menus.
 * These are Discord's auto-populated select menus that show guild members,
 * roles, channels, or mentionables without manually specifying options.
 */

import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  type ChannelType,
  type Client,
  type DMChannel,
  MentionableSelectMenuBuilder,
  type MessageCreateOptions,
  RoleSelectMenuBuilder,
  type TextChannel,
  type ThreadChannel,
  UserSelectMenuBuilder,
} from 'discord.js';

type SendableChannel = TextChannel | DMChannel | ThreadChannel;

/**
 * Options for entity select menus (User, Role, Channel, Mentionable)
 */
export interface EntitySelectMenuOptions {
  customId: string;
  placeholder?: string;
  minValues?: number;
  maxValues?: number;
  disabled?: boolean;
}

/**
 * Options for channel select with optional channel type filter
 */
export interface ChannelSelectMenuOptions extends EntitySelectMenuOptions {
  channelTypes?: ChannelType[];
}

/**
 * Build a user select menu (shows guild members)
 */
export function buildUserSelectMenu(options: EntitySelectMenuOptions): UserSelectMenuBuilder {
  const menu = new UserSelectMenuBuilder().setCustomId(options.customId).setDisabled(options.disabled ?? false);

  if (options.placeholder) menu.setPlaceholder(options.placeholder);
  if (options.minValues !== undefined) menu.setMinValues(options.minValues);
  if (options.maxValues !== undefined) menu.setMaxValues(options.maxValues);

  return menu;
}

/**
 * Build a role select menu (shows guild roles)
 */
export function buildRoleSelectMenu(options: EntitySelectMenuOptions): RoleSelectMenuBuilder {
  const menu = new RoleSelectMenuBuilder().setCustomId(options.customId).setDisabled(options.disabled ?? false);

  if (options.placeholder) menu.setPlaceholder(options.placeholder);
  if (options.minValues !== undefined) menu.setMinValues(options.minValues);
  if (options.maxValues !== undefined) menu.setMaxValues(options.maxValues);

  return menu;
}

/**
 * Build a channel select menu (shows guild channels)
 */
export function buildChannelSelectMenu(options: ChannelSelectMenuOptions): ChannelSelectMenuBuilder {
  const menu = new ChannelSelectMenuBuilder().setCustomId(options.customId).setDisabled(options.disabled ?? false);

  if (options.placeholder) menu.setPlaceholder(options.placeholder);
  if (options.minValues !== undefined) menu.setMinValues(options.minValues);
  if (options.maxValues !== undefined) menu.setMaxValues(options.maxValues);
  if (options.channelTypes) menu.setChannelTypes(options.channelTypes);

  return menu;
}

/**
 * Build a mentionable select menu (shows users + roles)
 */
export function buildMentionableSelectMenu(options: EntitySelectMenuOptions): MentionableSelectMenuBuilder {
  const menu = new MentionableSelectMenuBuilder().setCustomId(options.customId).setDisabled(options.disabled ?? false);

  if (options.placeholder) menu.setPlaceholder(options.placeholder);
  if (options.minValues !== undefined) menu.setMinValues(options.minValues);
  if (options.maxValues !== undefined) menu.setMaxValues(options.maxValues);

  return menu;
}

/**
 * Build an action row with a user select menu
 */
export function buildUserSelectMenuRow(options: EntitySelectMenuOptions): ActionRowBuilder<UserSelectMenuBuilder> {
  return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(buildUserSelectMenu(options));
}

/**
 * Build an action row with a role select menu
 */
export function buildRoleSelectMenuRow(options: EntitySelectMenuOptions): ActionRowBuilder<RoleSelectMenuBuilder> {
  return new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(buildRoleSelectMenu(options));
}

/**
 * Build an action row with a channel select menu
 */
export function buildChannelSelectMenuRow(
  options: ChannelSelectMenuOptions,
): ActionRowBuilder<ChannelSelectMenuBuilder> {
  return new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(buildChannelSelectMenu(options));
}

/**
 * Build an action row with a mentionable select menu
 */
export function buildMentionableSelectMenuRow(
  options: EntitySelectMenuOptions,
): ActionRowBuilder<MentionableSelectMenuBuilder> {
  return new ActionRowBuilder<MentionableSelectMenuBuilder>().addComponents(buildMentionableSelectMenu(options));
}

/**
 * Send a message with a user select menu
 */
export async function sendUserSelectMessage(
  client: Client,
  channelId: string,
  text: string,
  menuOptions: EntitySelectMenuOptions,
  replyToId?: string,
): Promise<string> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel or cannot be accessed`);
  }

  const options: MessageCreateOptions = {
    content: text,
    components: [buildUserSelectMenuRow(menuOptions)],
  };
  if (replyToId) options.reply = { messageReference: replyToId };

  const result = await (channel as SendableChannel).send(options);
  return result.id;
}

/**
 * Send a message with a role select menu
 */
export async function sendRoleSelectMessage(
  client: Client,
  channelId: string,
  text: string,
  menuOptions: EntitySelectMenuOptions,
  replyToId?: string,
): Promise<string> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel or cannot be accessed`);
  }

  const options: MessageCreateOptions = {
    content: text,
    components: [buildRoleSelectMenuRow(menuOptions)],
  };
  if (replyToId) options.reply = { messageReference: replyToId };

  const result = await (channel as SendableChannel).send(options);
  return result.id;
}

/**
 * Send a message with a channel select menu
 */
export async function sendChannelSelectMessage(
  client: Client,
  channelId: string,
  text: string,
  menuOptions: ChannelSelectMenuOptions,
  replyToId?: string,
): Promise<string> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel or cannot be accessed`);
  }

  const options: MessageCreateOptions = {
    content: text,
    components: [buildChannelSelectMenuRow(menuOptions)],
  };
  if (replyToId) options.reply = { messageReference: replyToId };

  const result = await (channel as SendableChannel).send(options);
  return result.id;
}

/**
 * Send a message with a mentionable select menu
 */
export async function sendMentionableSelectMessage(
  client: Client,
  channelId: string,
  text: string,
  menuOptions: EntitySelectMenuOptions,
  replyToId?: string,
): Promise<string> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel or cannot be accessed`);
  }

  const options: MessageCreateOptions = {
    content: text,
    components: [buildMentionableSelectMenuRow(menuOptions)],
  };
  if (replyToId) options.reply = { messageReference: replyToId };

  const result = await (channel as SendableChannel).send(options);
  return result.id;
}

/**
 * Send an ephemeral reply to an interaction
 *
 * Ephemeral messages are only visible to the user who triggered the interaction.
 */
export async function sendEphemeralReply(
  interaction: {
    replied: boolean;
    deferred: boolean;
    reply: (opts: unknown) => Promise<unknown>;
    followUp: (opts: unknown) => Promise<unknown>;
  },
  content: string,
): Promise<void> {
  const options = { content, ephemeral: true };

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(options);
  } else {
    await interaction.reply(options);
  }
}
