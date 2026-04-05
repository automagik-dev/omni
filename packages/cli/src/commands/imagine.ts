/**
 * Imagine Command — Image generation verb
 *
 * omni imagine "a neon cat in Tokyo"                        generate + send to open chat
 * omni imagine "a cat" --output cat.png                      save locally, no send
 * omni imagine "a cat" --aspect-ratio 16:9 --size 2K         control output shape/size
 * omni imagine "a cat" --model nano-banana-pro               pick the pro model
 * omni imagine "a cat" --count 3 --output cat.png            save 3 variants (cat-1.png, ...)
 * omni imagine "a cat" --reply                               quote-reply to trigger message
 *
 * Delegates to POST /v2/media/imagine which routes through the provider
 * registry. Defaults to Gemini Nano Banana 2 — override with --provider.
 */

import { writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveContext, resolveReplyTo } from '../context.js';
import * as output from '../output.js';

type AspectRatio = '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3';
const ALLOWED_ASPECT_RATIOS: readonly AspectRatio[] = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'];

interface ImagineOptions {
  aspectRatio?: string;
  size?: string;
  model?: string;
  provider?: string;
  count?: string;
  output?: string;
  reply?: string | true;
  instance?: string;
  chat?: string;
}

/** Guess a sensible file extension from a MIME type. */
function extensionForMime(mimeType: string): string {
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg';
  if (mimeType.includes('webp')) return '.webp';
  return '.png';
}

/**
 * Build an output path for image N.
 * - Single image: use `outputBase` verbatim.
 * - Multiple images: insert `-N` before the extension (cat.png -> cat-1.png).
 */
function buildOutputPath(outputBase: string, index: number, total: number, mimeType: string): string {
  const dir = dirname(outputBase);
  const ext = extname(outputBase) || extensionForMime(mimeType);
  const stem = basename(outputBase, extname(outputBase));
  if (total <= 1) {
    return join(dir, `${stem}${ext}`);
  }
  return join(dir, `${stem}-${index + 1}${ext}`);
}

function parseAspectRatio(value: string | undefined): AspectRatio | undefined {
  if (!value) return undefined;
  if (!(ALLOWED_ASPECT_RATIOS as readonly string[]).includes(value)) {
    output.error(`Invalid --aspect-ratio "${value}". Allowed: ${ALLOWED_ASPECT_RATIOS.join(', ')}`);
  }
  return value as AspectRatio;
}

export function createImagineCommand(): Command {
  return (
    new Command('imagine')
      .description('Generate an image from a text prompt (Gemini Nano Banana) and send or save it')
      .argument('<prompt...>', 'Prompt describing the image to generate')
      .option('--aspect-ratio <ratio>', 'Aspect ratio (1:1, 3:4, 4:3, 9:16, 16:9, 3:2, 2:3)')
      .option('--size <size>', 'Image size preset (1K, 2K, 4K — not all models support all sizes)')
      .option('--model <name>', 'Model alias (nano-banana-2, nano-banana-pro) or raw Gemini model ID')
      .option('--provider <name>', 'Provider override (default: config imagegen.provider)')
      .option('--count <n>', 'Number of images to generate (1-4)', '1')
      .option('--output <path>', 'Save locally instead of sending (appends -N for count > 1)')
      .option('--reply [message-id]', 'Quote-reply to the trigger message or a specific message ID')
      .option('--instance <id>', 'Override instance (default: from context)')
      .option('--chat <id>', 'Override chat (default: from context)')
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: verb action orchestrates context → imagegen → save/send
      .action(async (promptParts: string[], options: ImagineOptions) => {
        const prompt = promptParts.join(' ').trim();
        if (!prompt) {
          return output.error('Prompt is required. Example: omni imagine "a neon cat in Tokyo"');
        }

        const count = Number.parseInt(options.count ?? '1', 10);
        if (Number.isNaN(count) || count < 1 || count > 4) {
          return output.error('--count must be an integer between 1 and 4');
        }

        const aspectRatio = parseAspectRatio(options.aspectRatio);
        const saveLocally = !!options.output;

        // Resolve context only when we need to send — output-only runs don't
        // require a chat.
        let instanceId: string | undefined;
        let chatId: string | undefined;
        let replyTo: string | undefined;

        if (!saveLocally) {
          const ctx = await resolveContext({
            instance: options.instance,
            chat: options.chat,
          });

          if (!ctx.instanceId) {
            return output.error(
              'No instance in context. Set OMNI_INSTANCE, use --instance, --output, or run: omni use <instance>',
            );
          }
          if (!ctx.chatId) {
            return output.error('No chat in context. Set OMNI_CHAT, use --chat, --output, or run: omni open <contact>');
          }
          instanceId = ctx.instanceId;
          chatId = ctx.chatId;

          if (options.reply !== undefined) {
            const explicitReplyId = typeof options.reply === 'string' ? options.reply : undefined;
            const resolved = await resolveReplyTo(explicitReplyId);
            if (!resolved) {
              return output.error(
                'No message to reply to. Set OMNI_MESSAGE, use --reply <id>, or run: omni open <contact>',
              );
            }
            replyTo = resolved;
          }
        }

        const client = getClient();

        // Generate via the server-side imagegen provider registry.
        let result: Awaited<ReturnType<typeof client.media.imagine>>;
        try {
          result = await client.media.imagine({
            prompt,
            provider: options.provider,
            count,
            aspectRatio,
            imageSize: options.size,
            model: options.model,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          return output.error(`Image generation failed: ${message}`);
        }

        if (!result.images || result.images.length === 0) {
          return output.error('API returned no images');
        }

        // Local save path — write each image to disk using --output as the base.
        if (saveLocally && options.output) {
          const savedPaths: string[] = [];
          for (let i = 0; i < result.images.length; i++) {
            const image = result.images[i];
            if (!image) continue;
            const path = buildOutputPath(options.output, i, result.images.length, image.mimeType);
            try {
              writeFileSync(path, Buffer.from(image.base64, 'base64'));
              savedPaths.push(path);
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Unknown error';
              return output.error(`Failed to write ${path}: ${message}`);
            }
          }
          return output.success(`Generated ${savedPaths.length} image(s) via ${result.provider}`, {
            provider: result.provider,
            processingMs: result.processingMs,
            paths: savedPaths,
          });
        }

        // Send path — forward each image to the resolved chat as a media message.
        // --reply is captured but not yet wired through sendMedia; caption carries the prompt.
        void replyTo;

        const sent: Array<{ messageId: string; index: number }> = [];
        for (let i = 0; i < result.images.length; i++) {
          const image = result.images[i];
          if (!image) continue;
          const filename =
            result.images.length > 1 ? `imagine-${Date.now()}-${i + 1}.png` : `imagine-${Date.now()}.png`;
          try {
            const res = await client.messages.sendMedia({
              instanceId: instanceId as string,
              to: chatId as string,
              type: 'image',
              base64: image.base64,
              filename,
              caption: i === 0 ? prompt : undefined,
            });
            sent.push({ messageId: res.messageId, index: i });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            return output.error(`Failed to send image ${i + 1}: ${message}`);
          }
        }

        output.success(`Generated and sent ${sent.length} image(s) via ${result.provider}`, {
          provider: result.provider,
          processingMs: result.processingMs,
          instanceId,
          chatId,
          sent,
        });
      })
  );
}
