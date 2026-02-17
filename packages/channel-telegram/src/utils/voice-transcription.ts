/**
 * Voice Note Transcription Utility
 *
 * Preflight transcription: converts voice audio → text before agent dispatch.
 * Uses the pluggable TranscriptionProvider from @omni/core.
 */

import { readFile } from 'node:fs/promises';
import { TranscriptionError, WhisperProvider, createLogger } from '@omni/core';
import type { TranscriptionProvider } from '@omni/core';

const log = createLogger('telegram:voice-transcription');

/** Maximum voice note duration for transcription (seconds) */
const MAX_DURATION_SECONDS = 300; // 5 minutes

/** Fallback text when transcription is unavailable */
const FALLBACK_TEXT = '[Voice note - transcription unavailable]';

/** Lazy-initialized singleton provider */
let cachedProvider: TranscriptionProvider | null = null;

/**
 * Get or create the transcription provider from environment config.
 * Returns null if no API key is configured.
 */
function getProvider(): TranscriptionProvider | null {
  if (cachedProvider) return cachedProvider;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.warn('Voice transcription enabled but OPENAI_API_KEY not set — transcription will use fallback');
    return null;
  }

  cachedProvider = new WhisperProvider({
    apiKey,
    model: process.env.WHISPER_MODEL ?? 'whisper-1',
    timeoutMs: 30_000,
    baseUrl: process.env.OPENAI_BASE_URL,
  });

  return cachedProvider;
}

/**
 * Result of voice transcription attempt
 */
export interface VoiceTranscriptionResult {
  /** Text to inject into message content */
  text: string;
  /** Whether transcription succeeded */
  success: boolean;
}

/**
 * Transcribe a voice note file to text.
 *
 * @param localPath - Path to the downloaded audio file
 * @param durationSeconds - Voice note duration (from Telegram API), used for max-duration check
 * @param mimeType - Audio MIME type (e.g., 'audio/ogg')
 * @returns Transcription result with injected text format
 */
export async function transcribeVoiceNote(
  localPath: string,
  durationSeconds: number | undefined,
  mimeType: string,
): Promise<VoiceTranscriptionResult> {
  // Check max duration
  if (durationSeconds && durationSeconds > MAX_DURATION_SECONDS) {
    log.info('Voice note exceeds max duration, skipping transcription', {
      durationSeconds,
      maxDuration: MAX_DURATION_SECONDS,
    });
    return { text: FALLBACK_TEXT, success: false };
  }

  const provider = getProvider();
  if (!provider) {
    return { text: FALLBACK_TEXT, success: false };
  }

  // Determine audio format from MIME type
  const format = mimeTypeToFormat(mimeType);

  try {
    const audioBuffer = await readFile(localPath);

    const startTime = performance.now();
    const result = await provider.transcribe(audioBuffer, format);
    const elapsed = Math.round(performance.now() - startTime);

    log.info('voice_transcription_completed', {
      durationSeconds: result.duration,
      textLength: result.text.length,
      processingTimeMs: elapsed,
    });

    if (!result.text.trim()) {
      return { text: FALLBACK_TEXT, success: false };
    }

    return {
      text: `[Voice Note Transcription]: ${result.text.trim()}`,
      success: true,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorCode = error instanceof TranscriptionError ? error.code : 'UNKNOWN';

    log.error('voice_transcription_failed', { error: errorMsg, code: errorCode, localPath });

    return { text: FALLBACK_TEXT, success: false };
  }
}

/** Extract audio format from MIME type */
function mimeTypeToFormat(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/flac': 'flac',
    'audio/m4a': 'm4a',
    'audio/mp4': 'mp4',
  };
  return map[mimeType] ?? 'ogg';
}

/**
 * Reset cached provider (for testing)
 * @internal
 */
export function _resetProvider(): void {
  cachedProvider = null;
}
