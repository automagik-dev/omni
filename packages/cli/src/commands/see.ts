/**
 * See Command — Vision verb
 *
 * omni see photo.jpg                   — describe image, print to stdout
 * omni see photo.jpg "what color?"     — guided prompt
 * omni see photo.jpg --reply           — describe + quote-reply the description
 * omni see photo.jpg --language pt-BR  — response in a specific language
 * omni see photo.jpg --provider gemini — force a specific vision provider
 *
 * Reads the file locally, sends base64-encoded media to POST /v2/media/vision,
 * and prints the description. Used by agents to understand media they received.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import type { OmniClient } from '@automagik/omni-sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveContext, resolveReplyTo } from '../context.js';
import * as output from '../output.js';

interface SeeOptions {
  provider?: string;
  language?: string;
  maxTokens?: string;
  reply?: string | true;
  instance?: string;
  chat?: string;
}

interface VisionResponse {
  text: string;
  provider: string;
  processingMs: number;
}

/** Map common extensions to MIME types Gemini accepts. */
const MIME_BY_EXT: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  // Videos
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
};

function guessMimeType(path: string): string {
  const ext = extname(path).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function parseMaxTokens(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 8192) {
    output.error(`Invalid --max-tokens "${value}". Must be a positive integer up to 8192.`);
  }
  return n;
}

/** Validate local file and return its buffer + inferred mime type. */
function loadMedia(file: string): { buffer: Buffer; mimeType: string } {
  if (!existsSync(file)) {
    output.error(`File not found: ${file}`);
  }
  const stat = statSync(file);
  if (!stat.isFile()) {
    output.error(`Not a regular file: ${file}`);
  }
  if (stat.size === 0) {
    output.error(`File is empty: ${file}`);
  }
  try {
    return { buffer: readFileSync(file), mimeType: guessMimeType(file) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return output.error(`Failed to read ${file}: ${message}`);
  }
}

/** Call POST /v2/media/vision via the SDK. */
async function describeMedia(
  client: OmniClient,
  buffer: Buffer,
  mimeType: string,
  prompt: string | undefined,
  options: SeeOptions,
  maxTokens: number | undefined,
): Promise<VisionResponse> {
  try {
    const result = await client.media.vision({
      media: buffer,
      mimeType,
      provider: options.provider,
      prompt,
      language: options.language,
      maxTokens,
    });
    return { text: result.text, provider: result.provider, processingMs: result.processingMs };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return output.error(`Vision description failed: ${message}`);
  }
}

/** Send the description as a quote-reply to the trigger (or explicit) message. */
async function sendAsReply(client: OmniClient, description: VisionResponse, options: SeeOptions): Promise<void> {
  const ctx = await resolveContext({ instance: options.instance, chat: options.chat });
  if (!ctx.instanceId) {
    return output.error('No instance in context. Set OMNI_INSTANCE, use --instance, or run: omni use <instance>');
  }
  if (!ctx.chatId) {
    return output.error('No chat in context. Set OMNI_CHAT, use --chat, or run: omni open <contact>');
  }

  const replyId = typeof options.reply === 'string' ? options.reply : undefined;
  const replyTo = await resolveReplyTo(replyId);
  if (!replyTo) {
    return output.error('No message to reply to. Set OMNI_MESSAGE, use --reply <id>, or run: omni open <contact>');
  }

  try {
    const sent = await client.messages.send({
      instanceId: ctx.instanceId,
      to: ctx.chatId,
      text: description.text,
      replyTo,
    });
    output.success('Description sent as reply', {
      provider: description.provider,
      processingMs: description.processingMs,
      text: description.text,
      ...sent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to send reply: ${message}`);
  }
}

/** Print the description to stdout (human text or structured JSON). */
function printDescription(description: VisionResponse): void {
  if (output.getCurrentFormat() === 'json') {
    output.data({ provider: description.provider, processingMs: description.processingMs, text: description.text });
  } else {
    output.raw(description.text);
  }
}

export function createSeeCommand(): Command {
  return new Command('see')
    .description('Describe an image or video (prints to stdout); optionally quote-reply')
    .argument('<file>', 'Path to image or video file')
    .argument('[prompt]', 'Guided prompt (e.g. "what color is the cat?")')
    .option('--provider <name>', 'Vision provider (gemini). Default: server config.')
    .option('--language <code>', 'Response language (e.g. en, pt-BR)')
    .option('--max-tokens <n>', 'Maximum output tokens (1-8192)')
    .option('--reply [message-id]', 'Quote-reply trigger (or specific message ID) with the description')
    .option('--instance <id>', 'Override instance (default: from context)')
    .option('--chat <id>', 'Override chat (default: from context)')
    .action(async (file: string, prompt: string | undefined, options: SeeOptions) => {
      const { buffer, mimeType } = loadMedia(file);
      const maxTokens = parseMaxTokens(options.maxTokens);

      const client = getClient();
      const description = await describeMedia(client, buffer, mimeType, prompt, options, maxTokens);

      if (options.reply !== undefined) {
        await sendAsReply(client, description, options);
        return;
      }

      printDescription(description);
    });
}
