/**
 * Text message sender
 */

import type { Client, DMChannel, MessageCreateOptions, NewsChannel, TextChannel, ThreadChannel } from 'discord.js';
import { chunkMessage } from '../utils/chunking';
import { markdownToDiscord } from '../utils/markdown-to-discord';

type SendableChannel = TextChannel | DMChannel | NewsChannel | ThreadChannel;

/**
 * Build text message content
 */
export function buildTextContent(text: string): MessageCreateOptions {
  return { content: text };
}

/**
 * Send a text message
 *
 * @param client - Discord client
 * @param channelId - Channel to send to
 * @param text - Text content
 * @param replyToId - Optional message ID to reply to
 * @returns Array of sent message IDs (multiple if chunked)
 */
export async function sendTextMessage(
  client: Client,
  channelId: string,
  text: string,
  replyToId?: string,
  formatMode: 'convert' | 'passthrough' = 'convert',
): Promise<string[]> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel or cannot be accessed`);
  }

  const sendChannel = channel as SendableChannel;
  const formattedText = formatMode === 'passthrough' ? text : markdownToDiscord(text);
  const chunks = chunkMessage(formattedText);
  const messageIds: string[] = [];

  let isFirst = true;
  for (const chunk of chunks) {
    const options: MessageCreateOptions = buildTextContent(chunk);

    // Only reply to first chunk
    if (isFirst && replyToId) {
      options.reply = { messageReference: replyToId };
    }
    isFirst = false;

    const result = await sendChannel.send(options);
    messageIds.push(result.id);
  }

  return messageIds;
}

/**
 * Edit a text message
 *
 * @param client - Discord client
 * @param channelId - Channel containing the message
 * @param messageId - Message ID to edit
 * @param newText - New text content
 */
export async function editTextMessage(
  client: Client,
  channelId: string,
  messageId: string,
  newText: string,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);
  await message.edit({ content: newText });
}

/**
 * Delete a message
 *
 * @param client - Discord client
 * @param channelId - Channel containing the message
 * @param messageId - Message ID to delete
 */
export async function deleteMessage(client: Client, channelId: string, messageId: string): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('messages' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);
  await message.delete();
}
