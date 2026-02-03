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
    .action(async (options) => {
      // Resolve instance ID
      const instanceId = options.instance ?? loadConfig().defaultInstance;
      if (!instanceId) {
        output.error('No instance specified. Use --instance <id> or set default: omni config set defaultInstance <id>');
      }

      // Validate recipient
      if (!options.to && !options.presence) {
        output.error('--to <recipient> is required');
      }

      const client = getClient();

      try {
        // Determine message type and send
        if (options.text) {
          const result = await client.messages.send({
            instanceId,
            to: options.to,
            text: options.text,
            replyTo: options.replyTo,
          });
          output.success('Message sent', result);
        } else if (options.media) {
          if (!existsSync(options.media)) {
            output.error(`File not found: ${options.media}`);
          }

          const mediaType = getMediaType(options.media);
          const base64 = readFileAsBase64(options.media);
          const filename = basename(options.media);

          const result = await client.messages.sendMedia({
            instanceId,
            to: options.to,
            type: mediaType,
            base64,
            filename,
            caption: options.caption,
            voiceNote: options.voice,
          });
          output.success('Media sent', result);
        } else if (options.reaction) {
          if (!options.message) {
            output.error('--message <id> is required for reactions');
          }
          const result = await client.messages.sendReaction({
            instanceId,
            to: options.to,
            emoji: options.reaction,
            messageId: options.message,
          });
          output.success('Reaction sent', result);
        } else if (options.sticker) {
          const isBase64 = !options.sticker.startsWith('http');
          const result = await client.messages.sendSticker({
            instanceId,
            to: options.to,
            ...(isBase64 ? { base64: options.sticker } : { url: options.sticker }),
          });
          output.success('Sticker sent', result);
        } else if (options.contact) {
          if (!options.name) {
            output.error('--name <name> is required for contact');
          }
          const result = await client.messages.sendContact({
            instanceId,
            to: options.to,
            contact: {
              name: options.name,
              phone: options.phone,
              email: options.email,
            },
          });
          output.success('Contact sent', result);
        } else if (options.location) {
          if (options.lat === undefined || options.lng === undefined) {
            output.error('--lat and --lng are required for location');
          }
          const result = await client.messages.sendLocation({
            instanceId,
            to: options.to,
            latitude: options.lat,
            longitude: options.lng,
            address: options.address,
          });
          output.success('Location sent', result);
        } else if (options.poll) {
          if (!options.options) {
            output.error('--options <answers> is required for poll');
          }
          const answers = options.options.split(',').map((s: string) => s.trim());
          const result = await client.messages.sendPoll({
            instanceId,
            to: options.to,
            question: options.poll,
            answers,
            multiSelect: options.multiSelect,
            durationHours: options.duration,
          });
          output.success('Poll sent', result);
        } else if (options.embed) {
          const result = await client.messages.sendEmbed({
            instanceId,
            to: options.to,
            title: options.title,
            description: options.description,
            color: options.color,
            url: options.url,
          });
          output.success('Embed sent', result);
        } else if (options.presence) {
          const validTypes = ['typing', 'recording', 'paused'];
          if (!validTypes.includes(options.presence)) {
            output.error(`Invalid presence type: ${options.presence}`, {
              validTypes,
            });
          }
          const result = await client.messages.sendPresence({
            instanceId,
            to: options.to,
            type: options.presence as 'typing' | 'recording' | 'paused',
          });
          output.success('Presence sent', result);
        } else {
          output.error('No message type specified. Use --text, --media, --reaction, etc.');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to send: ${message}`);
      }
    });

  return send;
}
