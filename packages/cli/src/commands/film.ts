/**
 * Film Command — Video generation verb
 *
 *   omni film "sunset over dunes"                  — generate + send to open chat
 *   omni film "sunset" --duration 8                — 8-second clip
 *   omni film "sunset" --resolution 1080p          — resolution hint
 *   omni film "sunset" --output sunset.mp4         — save locally, don't send
 *   omni film "sunset" --reply                     — quote-reply to trigger message
 *
 * Uses Gemini Veo 3.1 via the `POST /v2/media/film` endpoint. The API handles
 * the async polling loop internally; the CLI shows a spinner while it waits
 * and enforces a 5-minute timeout.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { Command } from 'commander';
import ora from 'ora';
import { getClient } from '../client.js';
import { resolveContext, resolveReplyTo } from '../context.js';
import * as output from '../output.js';

interface FilmOptions {
  duration?: string;
  resolution?: string;
  reference?: string;
  extend?: string;
  output?: string;
  reply?: string | true;
  provider?: string;
  instance?: string;
  chat?: string;
  aspectRatio?: string;
  seed?: string;
  audio?: boolean;
  dialogue?: string;
  camera?: string;
  shot?: string[];
  audioDirection?: string;
  music?: string;
  style?: string;
}

export function createFilmCommand(): Command {
  return (
    new Command('film')
      .description('Generate a video from a text prompt (Gemini Veo 3.1)')
      .argument('<prompt>', 'Text prompt describing the video')
      .option('--duration <seconds>', 'Clip duration in seconds (provider-dependent max)')
      .option('--resolution <res>', 'Resolution hint (720p or 1080p)')
      .option('--aspect-ratio <ratio>', 'Aspect ratio (16:9 or 9:16)', '16:9')
      .option('--reference <path>', 'Reference image path for image-to-video')
      .option('--extend <operationId>', 'Extend an existing video operation (reserved for future use)')
      .option('--dialogue <text>', 'Dialogue direction to fold into the prompt')
      .option('--camera <text>', 'Camera/framing direction')
      .option(
        '--shot <text>',
        'Shot-list item (repeatable)',
        (value, previous: string[] = []) => [...previous, value],
        [],
      )
      .option('--audio-direction <text>', 'Sound/dialogue/ambient direction')
      .option('--music <text>', 'Music direction')
      .option('--style <text>', 'Visual style direction')
      .option('--seed <number>', 'RNG seed for reproducible output')
      .option('--no-audio', 'Disable audio generation')
      .option('-o, --output <path>', 'Save video to file locally (does not send)')
      .option('--reply [message-id]', 'Quote-reply to trigger message or specific message ID')
      .option('--provider <name>', 'Video generation provider (default: gemini)')
      .option('--instance <id>', 'Override instance (default: from context)')
      .option('--chat <id>', 'Override chat (default: from context)')
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: verb action orchestrates context → film → save/send with spinner
      .action(async (prompt: string, options: FilmOptions) => {
        const client = getClient();

        const saveOnly = Boolean(options.output);

        // Resolve context only when sending (not when saving locally)
        let instanceId: string | undefined;
        let chatId: string | undefined;
        let replyTo: string | undefined;

        if (!saveOnly) {
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
            const replyId = typeof options.reply === 'string' ? options.reply : undefined;
            const resolved = await resolveReplyTo(replyId);
            if (!resolved) {
              return output.error(
                'No message to reply to. Set OMNI_MESSAGE, use --reply <id>, or run: omni open <contact>',
              );
            }
            replyTo = resolved;
          }
        }

        const durationSec = options.duration ? Number.parseInt(options.duration, 10) : undefined;
        if (options.duration !== undefined && Number.isNaN(durationSec)) {
          return output.error(`Invalid --duration value: ${options.duration}`);
        }
        const seed = options.seed ? Number.parseInt(options.seed, 10) : undefined;
        if (options.seed !== undefined && Number.isNaN(seed)) {
          return output.error(`Invalid --seed value: ${options.seed}`);
        }
        let imageBase64: string | undefined;
        let imageMimeType: string | undefined;
        if (options.reference) {
          try {
            const ref = readFileSync(resolvePath(options.reference));
            imageBase64 = ref.toString('base64');
            imageMimeType = mimeForImagePath(options.reference);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            return output.error(`Failed to read --reference ${options.reference}: ${message}`);
          }
        }

        const spinner = ora({
          text: 'Submitting video generation request…',
          isEnabled: output.getCurrentFormat() === 'human',
        }).start();

        const startTime = Date.now();
        const tick = setInterval(() => {
          const seconds = Math.floor((Date.now() - startTime) / 1000);
          spinner.text = `Generating video via Veo 3.1… ${seconds}s elapsed`;
        }, 1000);

        try {
          const result = await client.media.film({
            prompt,
            provider: options.provider,
            durationSec,
            resolution: options.resolution,
            aspectRatio: options.aspectRatio,
            seed,
            audio: options.audio !== false,
            imageBase64,
            imageMimeType,
            dialogue: options.dialogue,
            camera: options.camera,
            shotList: options.shot,
            audioDirection: options.audioDirection,
            music: options.music,
            style: options.style,
          });

          clearInterval(tick);
          spinner.succeed(`Video ready (${result.sizeBytes} bytes, ${result.mimeType})`);

          const videoBuffer = Buffer.from(result.videoBase64, 'base64');

          // --output: save locally and stop.
          if (options.output) {
            const outPath = resolvePath(options.output);
            writeFileSync(outPath, videoBuffer);
            output.success('Video saved', { path: outPath, sizeBytes: videoBuffer.length });
            return;
          }

          // Default: send to the resolved chat as a video message.
          const filename = `film-${Date.now()}.mp4`;
          const sent = await client.messages.sendMedia({
            instanceId: instanceId as string,
            to: chatId as string,
            type: 'video',
            base64: result.videoBase64,
            filename,
            caption: prompt,
          });

          // Note: --reply on media sends is captured (replyTo={replyTo}) but
          // not yet wired through sendMedia. Caption carries the trigger prompt.
          void replyTo;

          output.success('Video sent', { ...sent, filename, sizeBytes: videoBuffer.length });
        } catch (err) {
          clearInterval(tick);
          spinner.fail('Video generation failed');
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`omni film: ${message}`);
        }
      })
  );
}

function mimeForImagePath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}
