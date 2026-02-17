/**
 * Transcription Provider Interface
 *
 * Pluggable transcription abstraction for voice note → text conversion.
 * Default implementation: WhisperProvider (OpenAI Whisper API).
 */

import { z } from 'zod';

/**
 * Transcription result schema
 */
export const TranscriptionResultSchema = z.object({
  /** Transcribed text */
  text: z.string(),
  /** Audio duration in seconds */
  duration: z.number(),
  /** Confidence score 0-1 (not all providers return this) */
  confidence: z.number().optional(),
});

export type TranscriptionResult = z.infer<typeof TranscriptionResultSchema>;

/**
 * Pluggable transcription provider interface
 *
 * Implementations: WhisperProvider (OpenAI), local whisper.cpp, Groq, etc.
 */
export interface TranscriptionProvider {
  /**
   * Transcribe audio to text
   *
   * @param audioBuffer - Raw audio data
   * @param format - Audio format (e.g., 'ogg', 'opus', 'mp3', 'wav')
   * @param language - Optional language hint (ISO 639-1, e.g., 'en', 'pt')
   * @returns Transcription result with text and duration
   * @throws TranscriptionError on failure
   */
  transcribe(audioBuffer: Buffer, format: string, language?: string): Promise<TranscriptionResult>;
}

/**
 * Transcription error codes
 */
export type TranscriptionErrorCode = 'API_ERROR' | 'TIMEOUT' | 'UNSUPPORTED_FORMAT' | 'FILE_TOO_LARGE' | 'NO_PROVIDER';

/**
 * Typed error for transcription failures
 */
export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode;

  constructor(message: string, code: TranscriptionErrorCode, cause?: Error) {
    super(message);
    this.name = 'TranscriptionError';
    this.code = code;
    if (cause) {
      this.cause = cause;
    }
  }
}
