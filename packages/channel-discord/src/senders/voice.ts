/**
 * Voice message sender
 *
 * Handles encoding audio to OGG/Opus format with waveform generation
 * for Discord voice messages. Falls back to file attachment if ffmpeg
 * is unavailable.
 *
 * Supported input formats: MP3, WAV, OGG, M4A (transcoded to OGG/Opus)
 */

import { createLogger } from '@omni/core';
import type { Client, DMChannel, TextChannel, ThreadChannel } from 'discord.js';
import { AttachmentBuilder, MessageFlags } from 'discord.js';

const log = createLogger('discord:voice');

type SendableChannel = TextChannel | DMChannel | ThreadChannel;

/** Check if ffmpeg is available on the system */
let ffmpegAvailable: boolean | null = null;

async function checkFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    const proc = Bun.spawn(['which', 'ffmpeg'], { stdout: 'pipe', stderr: 'pipe' });
    const exitCode = await proc.exited;
    ffmpegAvailable = exitCode === 0;
    if (!ffmpegAvailable) {
      log.warn('ffmpeg not found — voice messages will be sent as file attachments');
    }
    return ffmpegAvailable;
  } catch {
    ffmpegAvailable = false;
    log.warn('ffmpeg not found — voice messages will be sent as file attachments');
    return false;
  }
}

/** Get audio duration in seconds using ffprobe */
async function getAudioDuration(audioBuffer: Buffer): Promise<number> {
  const proc = Bun.spawn(['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-i', 'pipe:0'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  proc.stdin.write(audioBuffer);
  proc.stdin.end();

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  try {
    const data = JSON.parse(output);
    return Math.ceil(Number.parseFloat(data.format?.duration ?? '0'));
  } catch {
    log.warn('Failed to parse ffprobe output, defaulting duration to 0');
    return 0;
  }
}

/** Encode audio to OGG/Opus using ffmpeg via stdin */
async function encodeToOggOpus(audioBuffer: Buffer): Promise<Buffer> {
  const proc = Bun.spawn(['ffmpeg', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '64k', '-vn', '-f', 'ogg', 'pipe:1'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  proc.stdin.write(audioBuffer);
  proc.stdin.end();

  const output = await new Response(proc.stdout).arrayBuffer();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg encoding failed (exit ${exitCode}): ${stderr.slice(0, 200)}`);
  }

  return Buffer.from(output);
}

/** Generate waveform data (256 uint8 samples) from audio */
async function generateWaveform(audioBuffer: Buffer): Promise<string> {
  // Use ffmpeg to extract raw PCM samples, then downsample to 256 points
  const proc = Bun.spawn(
    [
      'ffmpeg',
      '-i',
      'pipe:0',
      '-ac',
      '1', // mono
      '-ar',
      '8000', // low sample rate for waveform
      '-f',
      's16le', // raw 16-bit signed LE
      '-acodec',
      'pcm_s16le',
      'pipe:1',
    ],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  );

  proc.stdin.write(audioBuffer);
  proc.stdin.end();

  const rawOutput = await new Response(proc.stdout).arrayBuffer();
  await proc.exited;

  const rawBuffer = Buffer.from(rawOutput);
  const samples = new Int16Array(rawBuffer.buffer, rawBuffer.byteOffset, Math.floor(rawBuffer.length / 2));

  // Downsample to 256 points
  const waveform = new Uint8Array(256);
  if (samples.length === 0) return Buffer.from(waveform).toString('base64');

  const chunkSize = Math.max(1, Math.floor(samples.length / 256));

  for (let i = 0; i < 256; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, samples.length);
    let maxAbs = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(samples[j] ?? 0);
      if (abs > maxAbs) maxAbs = abs;
    }
    // Scale to 0-255
    waveform[i] = Math.min(255, Math.round((maxAbs / 32768) * 255));
  }

  return Buffer.from(waveform).toString('base64');
}

export interface VoiceMessageOptions {
  /** Reply to message ID */
  replyToId?: string;
  /** Caption text (not used for voice, but kept for API consistency) */
  caption?: string;
}

export interface VoiceMessageResult {
  messageId: string;
  duration: number;
  isVoice: boolean;
}

/**
 * Send a voice message to a Discord channel.
 *
 * If ffmpeg is available, encodes to OGG/Opus and sends as a voice message
 * with waveform visualization. If not, falls back to a regular audio attachment.
 */
export async function sendVoiceMessage(
  client: Client,
  channelId: string,
  audioBuffer: Buffer,
  options: VoiceMessageOptions = {},
): Promise<VoiceMessageResult> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel or cannot be accessed`);
  }

  const sendChannel = channel as SendableChannel;
  const hasFfmpeg = await checkFfmpeg();

  if (!hasFfmpeg) {
    // Fallback: send as regular audio file
    log.warn('Sending voice as file attachment (ffmpeg unavailable)', { channelId });
    const attachment = new AttachmentBuilder(audioBuffer, { name: `voice-${Date.now()}.ogg` });
    const result = await sendChannel.send({
      files: [attachment],
      ...(options.replyToId ? { reply: { messageReference: options.replyToId } } : {}),
    });
    return { messageId: result.id, duration: 0, isVoice: false };
  }

  // Encode to OGG/Opus
  const oggBuffer = await encodeToOggOpus(audioBuffer);

  // Get duration and waveform in parallel
  const [duration, waveform] = await Promise.all([getAudioDuration(audioBuffer), generateWaveform(audioBuffer)]);

  // Build voice message attachment
  const attachment = new AttachmentBuilder(oggBuffer, {
    name: 'voice-message.ogg',
  });

  // Discord voice messages use the IS_VOICE_MESSAGE flag
  // and require duration_secs and waveform in the attachment metadata.
  // These fields are not yet typed in discord.js, so we cast the options object.
  const sendOptions: Record<string, unknown> = {
    files: [attachment],
    flags: MessageFlags.IsVoiceMessage,
    attachments: [
      {
        id: 0,
        filename: 'voice-message.ogg',
        duration_secs: duration,
        waveform,
      },
    ],
    ...(options.replyToId ? { reply: { messageReference: options.replyToId } } : {}),
  };
  // biome-ignore lint/suspicious/noExplicitAny: voice message fields not yet typed in discord.js
  const result = await sendChannel.send(sendOptions as any);

  log.debug('Voice message sent', { channelId, duration, messageId: result.id });

  return { messageId: result.id, duration, isVoice: true };
}

/** Reset ffmpeg availability cache (for testing) */
export function resetFfmpegCache(): void {
  ffmpegAvailable = null;
}

export { checkFfmpeg, encodeToOggOpus, getAudioDuration, generateWaveform };
