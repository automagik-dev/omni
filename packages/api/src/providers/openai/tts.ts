/**
 * OpenAI TTS provider.
 *
 * Uses the modern speech endpoint with `gpt-4o-mini-tts` and provider-routed
 * expressive instructions. Native MP3/WAV/PCM/AAC/FLAC requests are sent to
 * OpenAI when possible; OGG/Opus voice notes are converted locally with ffmpeg.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@omni/core';
import type { AudioFormat, ITtsProvider, TtsOptions, TtsResult, TtsVoice } from '../types';

const log = createLogger('provider:openai:tts');
const SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
const DEFAULT_MODEL = 'gpt-4o-mini-tts';
const DEFAULT_VOICE = 'cedar';

interface ChildProcessWithEvents extends ChildProcessWithoutNullStreams {
  on(event: 'close', listener: (code: number | null) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export interface OpenAiTtsSettingsReader {
  getSecret(key: string, envFallback?: string): Promise<string | undefined>;
  getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | undefined>;
}

const OPENAI_TTS_VOICES: TtsVoice[] = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
].map((id) => ({ id, name: id, provider: 'openai', gender: id === 'cedar' || id === 'onyx' ? 'male' : 'neutral' }));

export class OpenAiTtsProvider implements ITtsProvider {
  readonly name = 'openai';

  constructor(private readonly settings: OpenAiTtsSettingsReader) {}

  async synthesize(text: string, options?: TtsOptions): Promise<TtsResult> {
    if (!text.trim()) throw new Error('OpenAI TTS: text must not be empty');

    const started = Date.now();
    const apiKey = await this.getApiKey();
    const model =
      options?.model ??
      (await this.settings.getString('tts.openai.model', 'OPENAI_TTS_MODEL', DEFAULT_MODEL)) ??
      DEFAULT_MODEL;
    const voice =
      options?.voice ??
      (await this.settings.getString('tts.openai.default_voice', 'OPENAI_TTS_DEFAULT_VOICE', DEFAULT_VOICE)) ??
      DEFAULT_VOICE;
    const requestedFormat = normalizeOutputFormat(options?.format ?? 'mp3');
    const nativeFormat = requestedFormat === 'ogg' || requestedFormat === 'opus' ? 'mp3' : requestedFormat;
    const instructions = supportsInstructions(model) ? await this.buildInstructions(options) : undefined;

    log.debug('Calling OpenAI TTS', {
      model,
      voice,
      requestedFormat,
      nativeFormat,
      textLen: text.length,
      hasInstructions: !!instructions,
    });
    const response = await fetch(SPEECH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        ...(instructions ? { instructions } : {}),
        response_format: nativeFormat,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`OpenAI TTS error (${response.status}): ${body}`);
    }

    let audio: Buffer<ArrayBufferLike> = Buffer.from(await response.arrayBuffer());
    let mimeType = mimeForFormat(nativeFormat);
    if (requestedFormat === 'ogg' || requestedFormat === 'opus') {
      audio = await convertAudio(audio, nativeFormat, 'ogg');
      mimeType = 'audio/ogg; codecs=opus';
    }

    return {
      audio,
      mimeType,
      durationMs: 0,
      sizeBytes: audio.length,
      processingMs: Date.now() - started,
    } as TtsResult & { processingMs: number };
  }

  async listVoices(): Promise<TtsVoice[]> {
    return OPENAI_TTS_VOICES;
  }

  private async getApiKey(): Promise<string> {
    const key = await this.settings.getSecret('openai.api_key', 'OPENAI_API_KEY');
    if (!key) throw new Error('OpenAI API key not configured. Set openai.api_key or OPENAI_API_KEY.');
    return key;
  }

  private async buildInstructions(options?: TtsOptions): Promise<string | undefined> {
    const defaultInstructions = await this.settings.getString(
      'tts.openai.default_instructions',
      'OPENAI_TTS_DEFAULT_INSTRUCTIONS',
      '',
    );
    const parts = [defaultInstructions, options?.instructions];
    if (options?.language) parts.push(`Language/accent: ${options.language}.`);
    if (options?.style) parts.push(`Style: ${options.style}.`);
    if (options?.tone) parts.push(`Tone: ${options.tone}.`);
    if (options?.accent) parts.push(`Accent: ${options.accent}.`);
    if (options?.pace) parts.push(`Pace: ${options.pace}.`);
    if (options?.emotion) parts.push(`Emotion: ${options.emotion}.`);
    if (options?.speed) parts.push(`Speaking speed intent: ${options.speed}x.`);
    const text = parts
      .map((x) => x?.trim())
      .filter(Boolean)
      .join('\n');
    return text || undefined;
  }
}

function normalizeOutputFormat(format: AudioFormat): 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm' | 'ogg' {
  if (format === 'ogg') return 'ogg';
  if (format === 'opus') return 'opus';
  if (format === 'aac' || format === 'flac' || format === 'wav' || format === 'pcm') return format;
  return 'mp3';
}

function supportsInstructions(model: string): boolean {
  return /^gpt(?:-[\w.]+)*-tts$/i.test(model);
}

function mimeForFormat(format: string): string {
  if (format === 'wav') return 'audio/wav';
  if (format === 'pcm') return 'audio/pcm';
  if (format === 'flac') return 'audio/flac';
  if (format === 'aac') return 'audio/aac';
  return 'audio/mpeg';
}

async function convertAudio(input: Buffer<ArrayBufferLike>, from: string, to: 'ogg'): Promise<Buffer> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inputPath = join(tmpdir(), `omni-openai-tts-${stamp}.${from === 'pcm' ? 'wav' : from}`);
  const outputPath = join(tmpdir(), `omni-openai-tts-${stamp}.${to}`);
  try {
    await fs.writeFile(inputPath, input);
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-c:a',
        'libopus',
        '-b:a',
        '64k',
        '-application',
        'voip',
        '-ar',
        '48000',
        '-ac',
        '1',
        '-y',
        outputPath,
      ]) as ChildProcessWithEvents;
      let stderr = '';
      ffmpeg.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr || `ffmpeg exited ${code}`))));
      ffmpeg.on('error', reject);
    });
    return await fs.readFile(outputPath);
  } finally {
    await Promise.all([fs.rm(inputPath, { force: true }), fs.rm(outputPath, { force: true })]);
  }
}
