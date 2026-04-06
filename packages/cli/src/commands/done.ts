/**
 * Done Command — Turn-closing verb
 *
 * omni done "final text"         — send text + close turn
 * omni done --media <path>       — send media + close turn
 * omni done --react <emoji>      — react to trigger message + close turn
 * omni done --skip               — close turn with no outbound
 *
 * Uses context resolution (env vars > PG context > config) for instance/chat/message.
 * Calls POST /v2/turns/close to emit NATS turn.done event.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type { OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import { type ResolvedContext, resolveContext, resolveReplyTo } from '../context.js';
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

/** Close turn and output result */
async function closeTurn(
  client: OmniClient,
  action: 'message' | 'react' | 'skip',
  successMsg: string,
  reason?: string,
): Promise<void> {
  try {
    const result = await client.turns.close({ action, reason });
    if (result.alreadyClosed) {
      output.success(`${successMsg} Turn already closed (idempotent).`);
    } else {
      output.success(successMsg, { turnId: result.turnId, duration: result.duration });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to close turn: ${message}`);
  }
}

/** Handle --skip action */
async function handleSkip(client: OmniClient, reason?: string): Promise<void> {
  await closeTurn(client, 'skip', 'Turn closed (skip)', reason);
}

/** Handle --react action */
async function handleReact(client: OmniClient, ctx: ResolvedContext, emoji: string): Promise<void> {
  if (!ctx.messageId) {
    return output.error('No trigger message in context. Set OMNI_MESSAGE or use --message for --react.');
  }

  try {
    await client.messages.sendReaction({
      instanceId: ctx.instanceId as string,
      to: ctx.chatId as string,
      messageId: ctx.messageId,
      emoji,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to send reaction: ${message}`);
  }

  await closeTurn(client, 'react', `Reacted ${emoji} + turn closed`);
}

/** Handle --media action */
async function handleMedia(
  client: OmniClient,
  ctx: ResolvedContext,
  mediaPath: string,
  caption?: string,
): Promise<void> {
  if (!existsSync(mediaPath)) {
    return output.error(`File not found: ${mediaPath}`);
  }

  try {
    const mediaType = getMediaType(mediaPath);
    const buffer = readFileSync(mediaPath);
    const base64 = buffer.toString('base64');
    const filename = basename(mediaPath);

    await client.messages.sendMedia({
      instanceId: ctx.instanceId as string,
      to: ctx.chatId as string,
      type: mediaType,
      base64,
      filename,
      caption,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to send media: ${message}`);
  }

  await closeTurn(client, 'message', 'Media sent + turn closed');
}

/** Handle text message action */
async function handleText(client: OmniClient, ctx: ResolvedContext, text: string): Promise<void> {
  try {
    await client.messages.send({
      instanceId: ctx.instanceId as string,
      to: ctx.chatId as string,
      text,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to send message: ${message}`);
  }

  await closeTurn(client, 'message', 'Message sent + turn closed');
}

interface DoneOptions {
  react?: string;
  skip?: boolean;
  media?: string;
  caption?: string;
  reason?: string;
  instance?: string;
  chat?: string;
  message?: string;
}

export function createDoneCommand(): Command {
  return new Command('done')
    .description('Close the current turn (send final message/reaction + emit turn.done)')
    .argument('[text]', 'Final text message to send before closing')
    .option('--react <emoji>', 'React to trigger message + close turn')
    .option('--skip', 'Close turn with no outbound message')
    .option('--media <path>', 'Send media file + close turn')
    .option('--caption <text>', 'Caption for media')
    .option('--reason <text>', 'Reason for closing (used with --skip)')
    .option('--instance <id>', 'Override instance (default: from context)')
    .option('--chat <id>', 'Override chat (default: from context)')
    .option('--message <id>', 'Override trigger message (default: from context)')
    .action(async (text: string | undefined, options: DoneOptions) => {
      const client = getClient();

      // Resolve context — only pass instance/chat flags; message is resolved
      // separately to avoid short-circuiting env var lookup when only --message is set
      const ctx = await resolveContext({
        instance: options.instance,
        chat: options.chat,
      });

      if (!ctx.instanceId) {
        return output.error('No instance in context. Set OMNI_INSTANCE, use --instance, or run: omni use <instance>');
      }
      if (!ctx.chatId) {
        return output.error('No chat in context. Set OMNI_CHAT, use --chat, or run: omni open <contact>');
      }

      // Resolve message ID separately (--message flag > OMNI_MESSAGE env > PG context)
      const messageId = await resolveReplyTo(options.message);
      const ctxWithMessage: ResolvedContext = { ...ctx, messageId };

      if (options.skip) return handleSkip(client, options.reason);
      if (options.react) return handleReact(client, ctxWithMessage, options.react);
      if (options.media) return handleMedia(client, ctxWithMessage, options.media, options.caption);
      if (text) return handleText(client, ctxWithMessage, text);

      output.error(
        'Specify what to do: omni done "text", omni done --media <file>, omni done --react <emoji>, or omni done --skip',
      );
    });
}
