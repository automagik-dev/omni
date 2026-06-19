/** Gemini Lyria music generation provider. */

import { createLogger } from '@omni/core';
import type { IMusicGenProvider, MusicGenOptions, MusicGenResult } from '../types';
import { getGeminiClient, resolveGeminiApiKey } from './client';

const log = createLogger('gemini-musicgen');
const DEFAULT_PRO_MODEL = 'lyria-3-pro-preview';
const DEFAULT_CLIP_MODEL = 'lyria-3-clip-preview';

export interface GeminiMusicGenSettingsReader {
  getSecret(key: string, envFallback?: string): Promise<string | undefined>;
  getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | undefined>;
}

export class GeminiMusicGenProvider implements IMusicGenProvider {
  readonly name = 'gemini';

  constructor(private readonly settings: GeminiMusicGenSettingsReader) {}

  async generate(prompt: string, options?: MusicGenOptions): Promise<MusicGenResult> {
    if (!prompt.trim()) throw new Error('Gemini musicgen: prompt must not be empty');
    const started = Date.now();
    const apiKey = await resolveGeminiApiKey(this.settings);
    const client = getGeminiClient(apiKey);
    const model = await this.resolveModel(options);
    const finalPrompt = buildMusicPrompt(prompt, options);

    log.info('Generating music with Lyria', { model, mode: options?.mode ?? 'pro', promptLen: finalPrompt.length });
    const parts: Array<Record<string, unknown>> = [{ text: finalPrompt }];
    if (options?.imageBase64) {
      parts.push({ inlineData: { data: options.imageBase64, mimeType: options.imageMimeType ?? 'image/png' } });
    }

    const response = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      // biome-ignore lint/suspicious/noExplicitAny: Lyria media response modalities lag SDK typings.
      config: { responseModalities: ['AUDIO'] } as any,
    });

    const audio = extractAudio(response);
    if (!audio) {
      const text = response.text?.trim();
      throw new Error(
        text ? `Gemini Lyria returned no audio: ${text.slice(0, 200)}` : 'Gemini Lyria returned no audio',
      );
    }

    return {
      model,
      processingMs: Date.now() - started,
      audio: { data: audio.data, mimeType: audio.mimeType, sizeBytes: audio.data.length, durationMs: 0 },
    };
  }

  private async resolveModel(options?: MusicGenOptions): Promise<string> {
    if (options?.model) return options.model;
    if (options?.mode === 'clip') {
      return (
        (await this.settings.getString('musicgen.gemini.clip_model', 'GEMINI_MUSIC_CLIP_MODEL', DEFAULT_CLIP_MODEL)) ??
        DEFAULT_CLIP_MODEL
      );
    }
    return (
      (await this.settings.getString('musicgen.gemini.model', 'GEMINI_MUSIC_MODEL', DEFAULT_PRO_MODEL)) ??
      DEFAULT_PRO_MODEL
    );
  }
}

function buildMusicPrompt(prompt: string, options?: MusicGenOptions): string {
  const parts = [prompt];
  if (options?.style) parts.push(`Style: ${options.style}.`);
  if (options?.genre) parts.push(`Genre: ${options.genre}.`);
  if (options?.mood) parts.push(`Mood: ${options.mood}.`);
  if (options?.bpm) parts.push(`Tempo: ${options.bpm} BPM.`);
  if (options?.instruments?.length) parts.push(`Instruments: ${options.instruments.join(', ')}.`);
  if (options?.instrumental) parts.push('Instrumental only; no vocals.');
  if (options?.singerProfile) parts.push(`Singer profile: ${options.singerProfile}.`);
  if (options?.lyrics) parts.push(`Lyrics:\n${options.lyrics}`);
  if (options?.timedSections?.length) {
    parts.push(
      `Timed sections:\n${options.timedSections.map((s) => `[${s.start} - ${s.end}] ${s.instruction}`).join('\n')}`,
    );
  }
  if (options?.durationSec) parts.push(`Target duration: about ${options.durationSec} seconds.`);
  return parts.join('\n\n');
}

function extractAudio(response: {
  candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>;
}): { data: Buffer; mimeType: string } | null {
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = part.inlineData;
      if (!inline?.data) continue;
      const mimeType = inline.mimeType || 'audio/mpeg';
      if (!mimeType.startsWith('audio/')) continue;
      return { data: Buffer.from(inline.data, 'base64'), mimeType };
    }
  }
  return null;
}
