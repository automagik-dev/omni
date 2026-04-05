/**
 * Groq STT provider — Speech-to-text via Groq Whisper.
 *
 * Uses Groq's whisper-large-v3-turbo model — extremely fast (~216x real-time)
 * and highly accurate. Limited to 19.5 MB per request (Groq's API constraint).
 * For larger files, the caller should use the Gemini STT provider instead.
 */

import { createLogger } from '@omni/core';
import type { ISttProvider, SttOptions, SttResult, SttSegment } from '../types';

const log = createLogger('provider:groq:stt');

/** Groq hard limit per the docs: 25 MB, we leave margin for multipart framing. */
const GROQ_MAX_BYTES = 19.5 * 1024 * 1024;

/** Default Whisper model for Groq STT */
export const GROQ_STT_MODEL = 'whisper-large-v3-turbo';

const GROQ_TRANSCRIPTION_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

/** Settings reader — kept small to avoid circular deps on SettingsService. */
export interface GroqSttSettingsReader {
  getSecret(key: string, envFallback?: string): Promise<string | undefined>;
}

interface GroqVerboseResponse {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    start?: number;
    end?: number;
    text?: string;
  }>;
  words?: Array<{
    start?: number;
    end?: number;
    word?: string;
  }>;
}

/**
 * Groq Whisper STT provider.
 *
 * Uses the OpenAI-compatible /audio/transcriptions endpoint with
 * response_format=verbose_json to obtain segment-level timestamps.
 */
export class GroqSttProvider implements ISttProvider {
  readonly name = 'groq';

  constructor(private settings: GroqSttSettingsReader) {}

  async transcribe(audio: Buffer, mimeType: string, options?: SttOptions): Promise<SttResult> {
    if (audio.length > GROQ_MAX_BYTES) {
      throw new Error(
        `Audio too large for Groq Whisper: ${(audio.length / (1024 * 1024)).toFixed(1)} MB ` +
          `(limit ${(GROQ_MAX_BYTES / (1024 * 1024)).toFixed(1)} MB). Use --provider gemini for larger files.`,
      );
    }

    const apiKey = await this.getApiKey();
    const started = Date.now();
    const model = options?.model ?? GROQ_STT_MODEL;
    const wantTimestamps = options?.timestamps ?? false;

    const filename = guessFilename(mimeType);
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mimeType }), filename);
    form.append('model', model);
    if (options?.language) {
      form.append('language', options.language);
    }
    form.append('response_format', wantTimestamps ? 'verbose_json' : 'json');
    if (wantTimestamps) {
      form.append('timestamp_granularities[]', 'segment');
    }

    log.debug('Calling Groq Whisper', {
      model,
      mimeType,
      sizeBytes: audio.length,
      language: options?.language,
      wantTimestamps,
    });

    const response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`Groq Whisper error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as GroqVerboseResponse;
    const processingMs = Date.now() - started;

    let segments: SttSegment[] | undefined;
    if (wantTimestamps && Array.isArray(data.segments)) {
      segments = data.segments.map((s) => ({
        text: (s.text ?? '').trim(),
        startMs: typeof s.start === 'number' ? Math.round(s.start * 1000) : undefined,
        endMs: typeof s.end === 'number' ? Math.round(s.end * 1000) : undefined,
      }));
    }

    return {
      text: (data.text ?? '').trim(),
      segments,
      detectedLanguage: data.language ?? options?.language,
      processingMs,
    };
  }

  private async getApiKey(): Promise<string> {
    const key = await this.settings.getSecret('groq.api_key', 'GROQ_API_KEY');
    if (!key) {
      throw new Error(
        'Groq API key not configured. Set it in Settings > Media (groq.api_key) or via GROQ_API_KEY env var.',
      );
    }
    return key;
  }
}

/** Derive a reasonable filename from the MIME type — Groq requires a filename on the part. */
function guessFilename(mimeType: string): string {
  const subtype = mimeType.toLowerCase().split('/')[1]?.split(';')[0]?.trim() ?? 'bin';
  const ext = subtype.replace('mpeg', 'mp3').replace('x-m4a', 'm4a').replace('mp4', 'm4a').replace('quicktime', 'mov');
  return `audio.${ext}`;
}
