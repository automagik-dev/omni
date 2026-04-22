/**
 * Gemini STT provider — Speech-to-text via Google Gemini.
 *
 * Uses the Gemini multimodal model with audio inlineData input.
 * Supports large files (up to Gemini's limit, much higher than Whisper's 19.5MB),
 * language hints, and optional word-level timestamps via structured output.
 *
 * Model: gemini-2.0-flash (fast, supports audio understanding)
 */

import { createLogger } from '@omni/core';
import type { ISttProvider, SttOptions, SttResult, SttSegment } from '../types';
import { GEMINI_MODELS, getGeminiClient, resolveGeminiApiKey } from './client';

const log = createLogger('provider:gemini:stt');

/** Settings reader interface — avoids circular dep on SettingsService */
export interface GeminiSttSettingsReader {
  getSecret(key: string, envFallback?: string): Promise<string | undefined>;
}

/**
 * Gemini STT provider implementation.
 *
 * Unlike Groq Whisper (pure transcription), Gemini is a multimodal LLM that
 * understands audio. We prompt it to return a verbatim transcript (with
 * optional segment timestamps) as structured output.
 */
export class GeminiSttProvider implements ISttProvider {
  readonly name = 'gemini';

  constructor(private settings: GeminiSttSettingsReader) {}

  async transcribe(audio: Buffer, mimeType: string, options?: SttOptions): Promise<SttResult> {
    const started = Date.now();
    const apiKey = await resolveGeminiApiKey(this.settings);
    const client = getGeminiClient(apiKey);

    const model = options?.model ?? GEMINI_MODELS.STT;
    const wantTimestamps = options?.timestamps ?? false;
    const language = options?.language;

    // Build the prompt. With timestamps we ask for a structured JSON response.
    const promptParts: string[] = [
      'Transcribe the following audio verbatim.',
      'Return ONLY the transcript text — no preamble, no analysis, no translation.',
    ];
    if (language) {
      promptParts.push(`The audio is in ${language}. Preserve the original language.`);
    }
    if (wantTimestamps) {
      promptParts.push(
        'Return a JSON object with this exact shape: {"text": "full transcript", "segments": [{"text": "...", "startMs": 0, "endMs": 1000}]}',
        'Do not wrap the JSON in markdown code fences.',
      );
    }

    log.debug('Calling Gemini STT', { model, mimeType, sizeBytes: audio.length, wantTimestamps, language });

    const response = await client.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptParts.join(' ') },
            {
              inlineData: {
                data: audio.toString('base64'),
                mimeType: normalizeAudioMimeType(mimeType),
              },
            },
          ],
        },
      ],
      config: wantTimestamps
        ? {
            responseMimeType: 'application/json',
          }
        : undefined,
    });

    const raw = response.text ?? '';
    const processingMs = Date.now() - started;

    if (!wantTimestamps) {
      return {
        text: raw.trim(),
        detectedLanguage: language,
        processingMs,
      };
    }

    // Parse JSON with segments
    try {
      const parsed = JSON.parse(raw) as { text?: string; segments?: SttSegment[] };
      return {
        text: (parsed.text ?? '').trim(),
        segments: parsed.segments,
        detectedLanguage: language,
        processingMs,
      };
    } catch (err) {
      log.warn('Failed to parse Gemini STT JSON response, falling back to raw text', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        text: raw.trim(),
        detectedLanguage: language,
        processingMs,
      };
    }
  }
}

/**
 * Normalize common audio MIME types Gemini accepts.
 * Gemini supports: audio/wav, audio/mp3, audio/aiff, audio/aac, audio/ogg, audio/flac.
 */
function normalizeAudioMimeType(mimeType: string): string {
  const lower = mimeType.toLowerCase().split(';')[0]?.trim() ?? 'audio/ogg';
  // Gemini accepts audio/mpeg as audio/mp3
  if (lower === 'audio/mpeg') return 'audio/mp3';
  if (lower === 'audio/x-m4a' || lower === 'audio/m4a' || lower === 'audio/mp4') return 'audio/mp3';
  if (lower === 'audio/opus' || lower === 'audio/webm') return 'audio/ogg';
  return lower;
}
