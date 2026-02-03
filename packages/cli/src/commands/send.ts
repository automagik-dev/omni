/**
 * Send Commands
 *
 * omni send --instance <id> --to <recipient> --text <text>
 * omni send --instance <id> --to <recipient> --media <path>
 * omni send --instance <id> --to <recipient> --reaction <emoji> --message <id>
 * etc.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type { OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import { loadConfig } from '../config.js';
import * as output from '../output.js';

/** Get media type from file extension */
function getMediaType(path: string): 'image' | 'audio' | 'video' | 'document' {
  const ext = extname(path).toLowerCase();

  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const audioExts = ['.mp3', '.wav', '.ogg', '.m4a', '.opus'];
  const videoExts = ['.mp4', '.webm', '.mov', '.avi'];

  if (imageExts.includes(ext)) return 'image';
  if (audioExts.includes(ext)) return 'audio';
  if (videoExts.includes(ext)) return 'video';
  return 'document';
}

/** Read file as base64 */
function readFileAsBase64(path: string): string {
  const buffer = readFileSync(path);
  return buffer.toString('base64');
}

/** Send options type */
interface SendOptions {
  instance?: string;
  to?: string;
  text?: string;
  replyTo?: string;
  media?: string;
  caption?: string;
  voice?: boolean;
  reaction?: string;
  message?: string;
  sticker?: string;
  contact?: boolean;
  name?: string;
  phone?: string;
  email?: string;
  location?: boolean;
  lat?: number;
  lng?: number;
  address?: string;
  poll?: string;
  options?: string;
  multiSelect?: boolean;
  duration?: number;
  embed?: boolean;
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  presence?: string;
}

/** Message sender handlers - each validates required fields before use */
const messageSenders = {
  async text(client: OmniClient, instanceId: string, options: SendOptions) {
    const { to, text } = options;
    if (!to || !text) return; // Already validated by caller
    const result = await client.messages.send({
      instanceId,
      to,
      text,
      replyTo: options.replyTo,
    });
    output.success('Message sent', result);
  },

  async media(client: OmniClient, instanceId: string, options: SendOptions) {
    const { to, media } = options;
    if (!to || !media) return;
    if (!existsSync(media)) {
      output.error(`File not found: ${media}`);
      return;
    }
    const mediaType = getMediaType(media);
    const base64 = readFileAsBase64(media);
    const filename = basename(media);
    const result = await client.messages.sendMedia({
      instanceId,
      to,
      type: mediaType,
      base64,
      filename,
      caption: options.caption,
      voiceNote: options.voice,
    });
    output.success('Media sent', result);
  },

  async reaction(client: OmniClient, instanceId: string, options: SendOptions) {
    const { to, reaction, message } = options;
    if (!to || !reaction) return;
    if (!message) {
      output.error('--message <id> is required for reactions');
      return;
    }
    const result = await client.messages.sendReaction({
      instanceId,
      to,
      emoji: reaction,
      messageId: message,
    });
    output.success('Reaction sent', result);
  },

  async sticker(client: OmniClient, instanceId: string, options: SendOptions) {
    const { to, sticker } = options;
    if (!to || !sticker) return;
    const isBase64 = !sticker.startsWith('http');
    const result = await client.messages.sendSticker({
      instanceId,
      to,
      ...(isBase64 ? { base64: sticker } : { url: sticker }),
    });
    output.success('Sticker sent', result);
  },

  async contact(client: OmniClient, instanceId: string, options: SendOptions) {
    const { to, name } = options;
    if (!to) return;
    if (!name) {
      output.error('--name <name> is required for contact');
      return;
    }
    const result = await client.messages.sendContact({
      instanceId,
      to,
      contact: {
        name,
        phone: options.phone,
        email: options.email,
      },
    });
    output.success('Contact sent', result);
  },

  async location(client: OmniClient, instanceId: string, options: SendOptions) {
    const { to, lat, lng } = options;
    if (!to) return;
    if (lat === undefined || lng === undefined) {
      output.error('--lat and --lng are required for location');
      return;
    }
    const result = await client.messages.sendLocation({
      instanceId,
      to,
      latitude: lat,
      longitude: lng,
      address: options.address,
    });
    output.success('Location sent', result);
  },

  async poll(client: OmniClient, instanceId: string, options: SendOptions) {
    const { to, poll, options: pollOptions } = options;
    if (!to || !poll) return;
    if (!pollOptions) {
      output.error('--options <answers> is required for poll');
      return;
    }
    const answers = pollOptions.split(',').map((s: string) => s.trim());
    const result = await client.messages.sendPoll({
      instanceId,
      to,
      question: poll,
      answers,
      multiSelect: options.multiSelect,
      durationHours: options.duration,
    });
    output.success('Poll sent', result);
  },

  async embed(client: OmniClient, instanceId: string, options: SendOptions) {
    const { to } = options;
    if (!to) return;
    const result = await client.messages.sendEmbed({
      instanceId,
      to,
      title: options.title,
      description: options.description,
      color: options.color,
      url: options.url,
    });
    output.success('Embed sent', result);
  },

  async presence(client: OmniClient, instanceId: string, options: SendOptions) {
    const { to, presence } = options;
    if (!to || !presence) return;
    const validTypes = ['typing', 'recording', 'paused'] as const;
    if (!validTypes.includes(presence as (typeof validTypes)[number])) {
      output.error(`Invalid presence type: ${presence}`, { validTypes });
      return;
    }
    const result = await client.messages.sendPresence({
      instanceId,
      to,
      type: presence as 'typing' | 'recording' | 'paused',
    });
    output.success('Presence sent', result);
  },
};

/** Determine which message type to send based on options */
function getMessageType(options: SendOptions): keyof typeof messageSenders | null {
  if (options.text) return 'text';
  if (options.media) return 'media';
  if (options.reaction) return 'reaction';
  if (options.sticker) return 'sticker';
  if (options.contact) return 'contact';
  if (options.location) return 'location';
  if (options.poll) return 'poll';
  if (options.embed) return 'embed';
  if (options.presence) return 'presence';
  return null;
}

export function createSendCommand(): Command {
  const send = new Command('send').description('Send messages');

  send
    .description('Send a message to a recipient')
    .option('--instance <id>', 'Instance ID (uses default if not specified)')
    .option('--to <recipient>', 'Recipient (phone number, chat ID, or channel ID)')
    // Text message
    .option('--text <text>', 'Send text message')
    .option('--reply-to <id>', 'Reply to a message ID')
    // Media message
    .option('--media <path>', 'Send media file (image, audio, video, document)')
    .option('--caption <text>', 'Caption for media')
    .option('--voice', 'Send audio as voice note')
    // Reaction
    .option('--reaction <emoji>', 'Send reaction emoji')
    .option('--message <id>', 'Message ID to react to')
    // Sticker
    .option('--sticker <url>', 'Send sticker (URL or base64)')
    // Contact
    .option('--contact', 'Send contact card')
    .option('--name <name>', 'Contact name')
    .option('--phone <phone>', 'Contact phone number')
    .option('--email <email>', 'Contact email')
    // Location
    .option('--location', 'Send location')
    .option('--lat <latitude>', 'Latitude', Number.parseFloat)
    .option('--lng <longitude>', 'Longitude', Number.parseFloat)
    .option('--address <address>', 'Location address')
    // Poll (Discord)
    .option('--poll <question>', 'Send poll with question')
    .option('--options <answers>', 'Poll options (comma-separated)')
    .option('--multi-select', 'Allow multiple selections')
    .option('--duration <hours>', 'Poll duration in hours', Number.parseInt)
    // Embed (Discord)
    .option('--embed', 'Send embed message')
    .option('--title <title>', 'Embed title')
    .option('--description <desc>', 'Embed description')
    .option('--color <color>', 'Embed color (hex)', Number.parseInt)
    .option('--url <url>', 'Embed URL')
    // Presence
    .option('--presence <type>', 'Send presence indicator (typing, recording, paused)')
    .action(async (options: SendOptions) => {
      // Resolve instance ID
      const instanceId = options.instance ?? loadConfig().defaultInstance;
      if (!instanceId) {
        output.error('No instance specified. Use --instance <id> or set default: omni config set defaultInstance <id>');
      }

      // Validate recipient
      if (!options.to && !options.presence) {
        output.error('--to <recipient> is required');
      }

      const messageType = getMessageType(options);
      if (!messageType) {
        output.error('No message type specified. Use --text, --media, --reaction, etc.');
        return;
      }

      const client = getClient();

      try {
        await messageSenders[messageType](client, instanceId, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to send: ${message}`);
      }
    });

  return send;
}
