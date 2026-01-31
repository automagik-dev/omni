/**
 * Media message sender
 *
 * Handles sending attachments (images, audio, video, documents).
 */

import type { Client, DMChannel, MessageCreateOptions, TextChannel, ThreadChannel } from 'discord.js';

type SendableChannel = TextChannel | DMChannel | ThreadChannel;

/**
 * Build media message content
 *
 * @param mediaUrl - URL or file path to the media
 * @param caption - Optional caption/description
 * @param filename - Optional filename
 */
export function buildMediaContent(mediaUrl: string, caption?: string, filename?: string): MessageCreateOptions {
  return {
    content: caption,
    files: [
      {
        attachment: mediaUrl,
        name: filename,
      },
    ],
  };
}

/**
 * Send a media message (image, audio, video, document)
 *
 * @param client - Discord client
 * @param channelId - Channel to send to
 * @param mediaUrl - URL or file path to the media
 * @param options - Additional options
 * @returns Message ID
 */
export async function sendMediaMessage(
  client: Client,
  channelId: string,
  mediaUrl: string,
  options: {
    caption?: string;
    filename?: string;
    replyToId?: string;
    spoiler?: boolean;
  } = {},
): Promise<string> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel or cannot be accessed`);
  }

  const sendChannel = channel as SendableChannel;
  const messageOptions: MessageCreateOptions = buildMediaContent(mediaUrl, options.caption, options.filename);

  if (options.replyToId) {
    messageOptions.reply = { messageReference: options.replyToId };
  }

  // Mark as spoiler if requested
  if (options.spoiler && messageOptions.files) {
    for (const file of messageOptions.files) {
      if (typeof file === 'object' && 'attachment' in file) {
        file.name = `SPOILER_${file.name ?? 'file'}`;
      }
    }
  }

  const result = await sendChannel.send(messageOptions);
  return result.id;
}

/**
 * Send multiple files in a single message
 *
 * @param client - Discord client
 * @param channelId - Channel to send to
 * @param files - Array of file URLs/paths
 * @param options - Additional options
 * @returns Message ID
 */
export async function sendMultipleFiles(
  client: Client,
  channelId: string,
  files: Array<{ url: string; filename?: string }>,
  options: {
    caption?: string;
    replyToId?: string;
  } = {},
): Promise<string> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel or cannot be accessed`);
  }

  const sendChannel = channel as SendableChannel;
  const messageOptions: MessageCreateOptions = {
    content: options.caption,
    files: files.map((f) => ({
      attachment: f.url,
      name: f.filename,
    })),
  };

  if (options.replyToId) {
    messageOptions.reply = { messageReference: options.replyToId };
  }

  const result = await sendChannel.send(messageOptions);
  return result.id;
}

/**
 * Send media from a buffer
 *
 * @param client - Discord client
 * @param channelId - Channel to send to
 * @param buffer - File buffer
 * @param options - Options including filename (required) and caption
 * @returns Message ID
 */
export async function sendMediaBuffer(
  client: Client,
  channelId: string,
  buffer: Buffer,
  options: {
    filename: string;
    caption?: string;
    replyToId?: string;
    spoiler?: boolean;
  },
): Promise<string> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel or cannot be accessed`);
  }

  const sendChannel = channel as SendableChannel;
  const filename = options.spoiler ? `SPOILER_${options.filename}` : options.filename;

  const messageOptions: MessageCreateOptions = {
    content: options.caption,
    files: [
      {
        attachment: buffer,
        name: filename,
      },
    ],
  };

  if (options.replyToId) {
    messageOptions.reply = { messageReference: options.replyToId };
  }

  const result = await sendChannel.send(messageOptions);
  return result.id;
}
