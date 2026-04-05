/**
 * Speak Command — Voice message verb
 *
 * omni speak "hello"                       — synthesize + send voice note to open chat
 * omni speak "hello" --provider gemini     — force Gemini TTS
 * omni speak "hello" --provider elevenlabs — force ElevenLabs TTS
 * omni speak "hello" --voice Kore          — specific voice (provider-dependent)
 * omni speak "hello" --style cheerful      — style prompt (Gemini only)
 * omni speak "hello" --reply               — quote-reply to trigger message
 * omni speak "hello" --output out.ogg      — save locally without sending
 *
 * Uses context resolution (env vars > PG context > config) for instance/chat.
 * TTS provider is resolved server-side through the provider registry:
 *   --provider explicit > `tts.provider` setting > first registered.
 */

import { writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveContext } from '../context.js';
import * as output from '../output.js';

interface SpeakOptions {
  voice?: string;
  provider?: string;
  style?: string;
  language?: string;
  speed?: string;
  format?: string;
  output?: string;
  instance?: string;
  chat?: string;
}

const ALLOWED_FORMATS = ['mp3', 'ogg', 'opus', 'wav', 'pcm', 'flac', 'aac'] as const;
type AllowedFormat = (typeof ALLOWED_FORMATS)[number];

function parseFormat(value: string | undefined): AllowedFormat | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase() as AllowedFormat;
  if (!ALLOWED_FORMATS.includes(normalized)) {
    output.error(`Invalid --format "${value}". Allowed: ${ALLOWED_FORMATS.join(', ')}`);
  }
  return normalized;
}

function parseSpeed(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseFloat(value);
  if (Number.isNaN(n) || n < 0.5 || n > 2.0) {
    output.error(`Invalid --speed "${value}". Must be a number between 0.5 and 2.0.`);
  }
  return n;
}

export function createSpeakCommand(): Command {
  return (
    new Command('speak')
      .description('Synthesize text to speech and send as a voice note (or save with --output)')
      .argument('<text>', 'Text to convert to speech')
      .option('--provider <name>', 'TTS provider (gemini, elevenlabs). Default: server config.')
      .option('--voice <name>', 'Voice identifier (e.g. Kore for Gemini, JBFqn... for ElevenLabs)')
      .option('--style <prompt>', 'Style prompt prepended to text (Gemini only, e.g. "Say cheerfully")')
      .option('--language <code>', 'BCP-47 language code (e.g. en-US, pt-BR)')
      .option('--speed <factor>', 'Speaking speed multiplier 0.5-2.0 (provider-dependent)')
      .option('--format <fmt>', `Audio format: ${ALLOWED_FORMATS.join(', ')} (default: ogg)`)
      .option('--output <path>', 'Save audio to file instead of sending')
      .option('--instance <id>', 'Override instance (default: from context)')
      .option('--chat <id>', 'Override chat (default: from context)')
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: verb action orchestrates context → tts → save/send
      .action(async (text: string, options: SpeakOptions) => {
        const client = getClient();
        const format = parseFormat(options.format);
        const speed = parseSpeed(options.speed);

        // Synthesize via server-side provider registry
        let audioBuffer: Buffer;
        let mimeType: string;
        let durationMs: number;
        let providerName: string;
        try {
          const result = await client.media.tts({
            text,
            provider: options.provider,
            voice: options.voice,
            language: options.language,
            speed,
            format,
            style: options.style,
          });
          audioBuffer = result.audio;
          mimeType = result.mimeType;
          durationMs = result.durationMs;
          providerName = result.provider;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          return output.error(`TTS synthesis failed: ${message}`);
        }

        // --output: save to disk, don't send
        if (options.output) {
          try {
            await writeFile(options.output, audioBuffer);
            return output.success('Audio saved', {
              path: options.output,
              provider: providerName,
              mimeType,
              durationMs,
              sizeKb: Math.round((audioBuffer.length / 1024) * 100) / 100,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            return output.error(`Failed to write ${options.output}: ${message}`);
          }
        }

        // Send as voice note: resolve context
        const ctx = await resolveContext({
          instance: options.instance,
          chat: options.chat,
        });

        if (!ctx.instanceId) {
          return output.error(
            'No instance in context. Set OMNI_INSTANCE, use --instance, run: omni use <instance>, or pass --output to save.',
          );
        }
        if (!ctx.chatId) {
          return output.error(
            'No chat in context. Set OMNI_CHAT, use --chat, run: omni open <contact>, or pass --output to save.',
          );
        }

        // Send as voice note via media send (marks as voice/PTT)
        try {
          const result = await client.messages.sendMedia({
            instanceId: ctx.instanceId,
            to: ctx.chatId,
            type: 'audio',
            base64: audioBuffer.toString('base64'),
            filename: pickFilename(mimeType, providerName),
            voiceNote: true,
          });
          output.success('Voice note sent', {
            provider: providerName,
            durationMs,
            sizeKb: Math.round((audioBuffer.length / 1024) * 100) / 100,
            ...result,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to send voice note: ${message}`);
        }
      })
  );
}

function pickFilename(mimeType: string, provider: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes('ogg') || lower.includes('opus')) return `${provider}-speak.ogg`;
  if (lower.includes('wav')) return `${provider}-speak.wav`;
  if (lower.includes('mp3') || lower.includes('mpeg')) return `${provider}-speak.mp3`;
  if (lower.includes('flac')) return `${provider}-speak.flac`;
  if (lower.includes('aac') || lower.includes('m4a')) return `${provider}-speak.m4a`;
  return `${provider}-speak.bin`;
}
