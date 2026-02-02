/**
 * Media message sender
 *
 * Handles sending attachments (images, audio, video, documents).
 */

import type { Client, DMChannel, MessageCreateOptions, TextChannel, ThreadChannel } from 'discord.js';

type SendableChannel = TextChannel | DMChannel | ThreadChannel;

/**
 * Common MIME type to extension mapping
 */
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'text/plain': '.txt',
};

/**
 * Extract filename from URL path
 */
function getFilenameFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const lastSegment = pathname.split('/').pop();

    // Check if it has a file extension
    if (lastSegment && /\.[a-zA-Z0-9]+$/.test(lastSegment)) {
      return lastSegment;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get file extension from content-type header
 */
function getExtensionFromContentType(contentType: string | null): string {
  if (!contentType) return '.bin';

  // Extract main MIME type (ignore charset, etc.)
  const mimeType = contentType.split(';')[0]?.trim().toLowerCase();
  if (!mimeType) return '.bin';

  return MIME_TO_EXTENSION[mimeType] || '.bin';
}

/**
 * Infer filename for a media URL
 *
 * First tries to extract from URL, then does a HEAD request to get content-type.
 */
async function inferFilename(mediaUrl: string): Promise<string> {
  // Try to get filename from URL
  const urlFilename = getFilenameFromUrl(mediaUrl);
  if (urlFilename) {
    return urlFilename;
  }

  // Do a HEAD request to get content-type
  try {
    const response = await fetch(mediaUrl, { method: 'HEAD' });
    const contentType = response.headers.get('content-type');
    const extension = getExtensionFromContentType(contentType);

    // Generate a filename based on timestamp
    return `media-${Date.now()}${extension}`;
  } catch {
    // If HEAD fails, try a small GET request
    try {
      const response = await fetch(mediaUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' }, // Request only 1 byte
      });
      const contentType = response.headers.get('content-type');
      const extension = getExtensionFromContentType(contentType);
      return `media-${Date.now()}${extension}`;
    } catch {
      // Last resort: generic filename
      return `media-${Date.now()}.bin`;
    }
  }
}

/**
 * Build media message content
 *
 * @param mediaUrl - URL or file path to the media
 * @param caption - Optional caption/description
 * @param filename - Optional filename (will be inferred if not provided)
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

  // Infer filename if not provided (ensures proper extension for Discord to display inline)
  const filename = options.filename || (await inferFilename(mediaUrl));

  const sendChannel = channel as SendableChannel;
  const messageOptions: MessageCreateOptions = buildMediaContent(mediaUrl, options.caption, filename);

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
