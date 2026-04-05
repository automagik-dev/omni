/**
 * Listen Command — Speech-to-text verb
 *
 * omni listen audio.ogg                       — print transcription to stdout
 * omni listen audio.ogg --provider gemini     — force Gemini STT (handles >19.5MB)
 * omni listen audio.ogg --provider groq       — force Groq Whisper (fast, 19.5MB cap)
 * omni listen audio.ogg --language pt         — language hint
 * omni listen audio.ogg --timestamps          — include segment timestamps
 * omni listen audio.ogg --format json         — output structured JSON
 * omni listen audio.ogg --reply               — transcribe + quote-reply to trigger message
 * omni listen audio.ogg --reply <message-id>  — transcribe + quote-reply to specific message
 *
 * STT provider is resolved server-side through the provider registry:
 *   --provider explicit > `stt.provider` setting > first registered.
 */

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveContext, resolveReplyTo } from '../context.js';
import * as output from '../output.js';

interface ListenOptions {
  provider?: string;
  language?: string;
  timestamps?: boolean;
  format?: string;
  model?: string;
  reply?: string | true;
  instance?: string;
  chat?: string;
}

const ALLOWED_FORMATS = ['text', 'json'] as const;
type AllowedFormat = (typeof ALLOWED_FORMATS)[number];

function parseFormat(value: string | undefined): AllowedFormat {
  if (!value) return 'text';
  const normalized = value.toLowerCase() as AllowedFormat;
  if (!ALLOWED_FORMATS.includes(normalized)) {
    output.error(`Invalid --format "${value}". Allowed: ${ALLOWED_FORMATS.join(', ')}`);
  }
  return normalized;
}

/** Map a file extension to an audio MIME type the providers understand. */
function guessAudioMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase().slice(1);
  switch (ext) {
    case 'ogg':
    case 'oga':
      return 'audio/ogg';
    case 'opus':
      return 'audio/ogg';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'flac':
      return 'audio/flac';
    case 'aac':
      return 'audio/aac';
    case 'm4a':
      return 'audio/mp4';
    case 'mp4':
      return 'audio/mp4';
    case 'webm':
      return 'audio/webm';
    case 'aiff':
    case 'aif':
      return 'audio/aiff';
    default:
      return 'audio/ogg';
  }
}

export function createListenCommand(): Command {
  return (
    new Command('listen')
      .description('Transcribe an audio file to text and print (or send as reply)')
      .argument('<file>', 'Path to the audio file to transcribe')
      .option('--provider <name>', 'STT provider (gemini, groq). Default: server config.')
      .option('--language <code>', 'BCP-47 language hint (e.g. en, pt-BR)')
      .option('--timestamps', 'Include per-segment timestamps')
      .option('--format <fmt>', `Output format: ${ALLOWED_FORMATS.join(', ')} (default: text)`)
      .option('--model <name>', 'Model override (provider-specific)')
      .option('--reply [message-id]', 'Send transcript as a quote-reply to the trigger or a specific message')
      .option('--instance <id>', 'Override instance (default: from context, only with --reply)')
      .option('--chat <id>', 'Override chat (default: from context, only with --reply)')
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: verb action orchestrates file → stt → print/reply
      .action(async (file: string, options: ListenOptions) => {
        const client = getClient();
        const format = parseFormat(options.format);
        const wantTimestamps = options.timestamps === true;

        // Read the audio file
        let audioBuffer: Buffer;
        try {
          audioBuffer = await readFile(file);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          return output.error(`Failed to read ${file}: ${message}`);
        }

        if (audioBuffer.length === 0) {
          return output.error(`File is empty: ${file}`);
        }

        const mimeType = guessAudioMimeType(file);

        // Transcribe via server-side provider registry
        let result: {
          provider: string;
          text: string;
          segments?: Array<{ text: string; startMs?: number; endMs?: number }>;
          detectedLanguage?: string;
          processingMs: number;
        };
        try {
          result = await client.media.stt({
            audio: audioBuffer,
            mimeType,
            provider: options.provider,
            language: options.language,
            timestamps: wantTimestamps,
            model: options.model,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          return output.error(`STT transcription failed: ${message}`);
        }

        // --reply: transcribe + send as quote-reply
        if (options.reply !== undefined) {
          const ctx = await resolveContext({
            instance: options.instance,
            chat: options.chat,
          });

          if (!ctx.instanceId) {
            return output.error(
              'No instance in context. Set OMNI_INSTANCE, use --instance, or run: omni use <instance>',
            );
          }
          if (!ctx.chatId) {
            return output.error('No chat in context. Set OMNI_CHAT, use --chat, or run: omni open <contact>');
          }

          const replyId = typeof options.reply === 'string' ? options.reply : undefined;
          const resolvedReply = await resolveReplyTo(replyId);
          if (!resolvedReply) {
            return output.error(
              'No message to reply to. Set OMNI_MESSAGE, use --reply <id>, or run: omni open <contact>',
            );
          }

          try {
            const sendResult = await client.messages.send({
              instanceId: ctx.instanceId,
              to: ctx.chatId,
              text: result.text,
              replyTo: resolvedReply,
            });
            return output.success('Transcription sent as reply', {
              provider: result.provider,
              file: basename(file),
              sizeKb: Math.round((audioBuffer.length / 1024) * 100) / 100,
              processingMs: result.processingMs,
              text: result.text,
              ...sendResult,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            return output.error(`Failed to send transcription reply: ${message}`);
          }
        }

        // Default: print to stdout
        if (format === 'json') {
          return output.success('Transcription complete', {
            provider: result.provider,
            file: basename(file),
            mimeType,
            sizeKb: Math.round((audioBuffer.length / 1024) * 100) / 100,
            processingMs: result.processingMs,
            detectedLanguage: result.detectedLanguage,
            text: result.text,
            segments: result.segments,
          });
        }

        // text format: raw transcript on stdout, summary on stderr
        // biome-ignore lint/suspicious/noConsole: CLI output
        console.log(result.text);
      })
  );
}
