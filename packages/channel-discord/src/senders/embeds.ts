/**
 * Embed message sender
 *
 * Handles rich embed messages (cards with title, description, fields, images).
 */

import type { Client, DMChannel, MessageCreateOptions, TextChannel, ThreadChannel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import type { EmbedOptions } from '../types';

type SendableChannel = TextChannel | DMChannel | ThreadChannel;

/**
 * Build an embed from options
 *
 * @param options - Embed configuration
 * @returns EmbedBuilder instance
 */
export function buildEmbed(options: EmbedOptions): EmbedBuilder {
  const embed = new EmbedBuilder();

  if (options.title) {
    embed.setTitle(options.title);
  }

  if (options.description) {
    embed.setDescription(options.description);
  }

  if (options.url) {
    embed.setURL(options.url);
  }

  // Default to Discord blurple if no color specified
  embed.setColor(options.color ?? 0x5865f2);

  if (options.timestamp) {
    const date = typeof options.timestamp === 'number' ? new Date(options.timestamp) : options.timestamp;
    embed.setTimestamp(date);
  }

  if (options.footer) {
    if (typeof options.footer === 'string') {
      embed.setFooter({ text: options.footer });
    } else {
      embed.setFooter({ text: options.footer.text, iconURL: options.footer.iconUrl });
    }
  }

  if (options.thumbnail) {
    embed.setThumbnail(options.thumbnail);
  }

  if (options.image) {
    embed.setImage(options.image);
  }

  if (options.author) {
    embed.setAuthor({
      name: options.author.name,
      iconURL: options.author.iconUrl,
      url: options.author.url,
    });
  }

  if (options.fields) {
    embed.addFields(
      options.fields.map((f) => ({
        name: f.name,
        value: f.value,
        inline: f.inline ?? false,
      })),
    );
  }

  return embed;
}

/**
 * Build message content with embed
 */
export function buildEmbedContent(options: EmbedOptions | EmbedOptions[], text?: string): MessageCreateOptions {
  const embeds = Array.isArray(options) ? options.map(buildEmbed) : [buildEmbed(options)];

  return {
    content: text,
    embeds,
  };
}

/**
 * Send an embed message
 *
 * @param client - Discord client
 * @param channelId - Channel to send to
 * @param options - Embed options (single or array)
 * @param text - Optional text content to accompany embed
 * @param replyToId - Optional message ID to reply to
 * @returns Message ID
 */
export async function sendEmbedMessage(
  client: Client,
  channelId: string,
  options: EmbedOptions | EmbedOptions[],
  text?: string,
  replyToId?: string,
): Promise<string> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel or cannot be accessed`);
  }

  const sendChannel = channel as SendableChannel;
  const messageOptions = buildEmbedContent(options, text);

  if (replyToId) {
    messageOptions.reply = { messageReference: replyToId };
  }

  const result = await sendChannel.send(messageOptions);
  return result.id;
}

/**
 * Edit a message's embeds
 *
 * @param client - Discord client
 * @param channelId - Channel containing the message
 * @param messageId - Message ID to edit
 * @param options - New embed options
 * @param text - Optional new text content
 */
export async function editEmbedMessage(
  client: Client,
  channelId: string,
  messageId: string,
  options: EmbedOptions | EmbedOptions[],
  text?: string,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);

  const embeds = Array.isArray(options) ? options.map(buildEmbed) : [buildEmbed(options)];
  await message.edit({
    content: text,
    embeds,
  });
}

/**
 * Create a simple info embed
 */
export function createInfoEmbed(title: string, description: string, color = 0x5865f2): EmbedBuilder {
  return buildEmbed({ title, description, color });
}

/**
 * Create a success embed (green)
 */
export function createSuccessEmbed(title: string, description: string): EmbedBuilder {
  return buildEmbed({ title, description, color: 0x57f287 });
}

/**
 * Create a warning embed (yellow)
 */
export function createWarningEmbed(title: string, description: string): EmbedBuilder {
  return buildEmbed({ title, description, color: 0xfee75c });
}

/**
 * Create an error embed (red)
 */
export function createErrorEmbed(title: string, description: string): EmbedBuilder {
  return buildEmbed({ title, description, color: 0xed4245 });
}
