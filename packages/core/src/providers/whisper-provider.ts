/**
 * OpenAI Whisper Transcription Provider
 *
 * Calls POST /v1/audio/transcriptions with multipart form data.
 * Uses plain fetch (no SDK dependency) to keep @omni/core lean.
 */

import { z } from 'zod';

import { TranscriptionError } from './transcription';
import type { TranscriptionProvider, TranscriptionResult } from './transcription';

const WhisperApiResponseSchema = z.object({
  text: z.string().optional(),
  duration: z.number().optional(),
});

/**
 * Configuration for the Whisper provider
 */
export interface WhisperProviderConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Whisper model (default: 'whisper-1') */
  model?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Base URL for the API (default: 'https://api.openai.com') */
  baseUrl?: string;
}

/** Format → MIME type mapping for audio */
const FORMAT_MIME: Record<string, string> = {
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  wav: 'audio/wav',
  webm: 'audio/webm',
  flac: 'audio/flac',
  m4a: 'audio/m4a',
  mp4: 'audio/mp4',
};

/** Build multipart form data for the Whisper API */
function buildFormData(audioBuffer: Buffer, format: string, model: string, language?: string): FormData {
  const mimeType = FORMAT_MIME[format] ?? `audio/${format}`;
  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: mimeType }), `audio.${format}`);
  formData.append('model', model);
  formData.append('response_format', 'verbose_json');
  if (language) {
    formData.append('language', language);
  }
  return formData;
}

/** Wrap non-TranscriptionError errors into TranscriptionError */
function wrapError(error: unknown, timeoutMs: number): TranscriptionError {
  if (error instanceof TranscriptionError) return error;

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new TranscriptionError(`Transcription timed out after ${timeoutMs}ms`, 'TIMEOUT');
  }

  return new TranscriptionError(
    `Whisper API error: ${error instanceof Error ? error.message : String(error)}`,
    'API_ERROR',
    error instanceof Error ? error : undefined,
  );
}

/**
 * OpenAI Whisper API transcription provider
 */
export class WhisperProvider implements TranscriptionProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(config: WhisperProviderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'whisper-1';
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com';
  }

  async transcribe(audioBuffer: Buffer, format: string, language?: string): Promise<TranscriptionResult> {
    const formData = buildFormData(audioBuffer, format, this.model, language);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response
          .text()
          .then((t) => t.slice(0, 1024))
          .catch(() => 'Unknown error');
        throw new TranscriptionError(`Whisper API error (${response.status}): ${errorBody}`, 'API_ERROR');
      }

      const data = WhisperApiResponseSchema.parse(await response.json());
      return { text: data.text ?? '', duration: data.duration ?? 0 };
    } catch (error) {
      throw wrapError(error, this.timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }
}
