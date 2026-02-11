/**
 * Audio Processor
 *
 * Transcribes audio using Groq Whisper (primary) with OpenAI fallback.
 * Groq's Whisper is extremely fast (216x real-time) and cost-effective.
 */

import { createReadStream, statSync } from 'node:fs';
import Groq from 'groq-sdk';
import OpenAI from 'openai';
import type { Uploadable } from 'openai/uploads';

import { GROQ_WHISPER_MODEL, OPENAI_WHISPER_MODEL } from '../models';
import { calculateCost } from '../pricing';
import type { ProcessOptions, ProcessingResult } from '../types';
import { BaseProcessor } from './base';

const MAX_RETRIES = 3;

/**
 * Audio processor using Groq Whisper with OpenAI fallback
 */
export class AudioProcessor extends BaseProcessor {
  readonly name = 'audio';
  readonly supportedMimeTypes = [
    'audio/*',
    'audio/ogg',
    'audio/opus',
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/wav',
    'audio/webm',
    'audio/flac',
    'audio/m4a',
    'audio/x-m4a',
  ] as const;

  private groqClient: Groq | null = null;
  private openaiClient: OpenAI | null = null;

  /**
   * Get lazy-initialized Groq client
   */
  private getGroqClient(): Groq | null {
    if (!this.groqClient && this.config.groqApiKey) {
      this.groqClient = new Groq({ apiKey: this.config.groqApiKey });
      this.log.info('Groq client initialized');
    }
    return this.groqClient;
  }

  /**
   * Get lazy-initialized OpenAI client (fallback)
   */
  private getOpenAIClient(): OpenAI | null {
    if (!this.openaiClient && this.config.openaiApiKey) {
      this.openaiClient = new OpenAI({ apiKey: this.config.openaiApiKey });
      this.log.info('OpenAI client initialized (fallback)');
    }
    return this.openaiClient;
  }

  async process(filePath: string, _mimeType: string, options?: ProcessOptions): Promise<ProcessingResult> {
    const startTime = performance.now();
    const language = options?.language ?? this.config.defaultLanguage ?? 'pt';
    const durationSeconds = options?.durationSeconds ?? this.estimateDuration(filePath);

    // Try Groq first (faster and cheaper)
    let result = await this.transcribeWithGroq(filePath, language);

    // If Groq fails and we have OpenAI configured, try fallback
    if (!result.success && this.config.openaiApiKey) {
      this.log.info('Groq transcription failed, trying OpenAI fallback...');
      result = await this.transcribeWithOpenAI(filePath, language);
    }

    // Update processing time
    result.processingTimeMs = Math.round(performance.now() - startTime);

    // Calculate cost if successful and we have duration
    if (result.success && durationSeconds) {
      result.duration = durationSeconds;
      result.costCents = calculateCost(result.provider === 'groq' ? 'groq_whisper' : 'openai_whisper', result.model, {
        durationSeconds,
      });
    }

    if (result.success) {
      this.log.info('Audio transcription successful', {
        provider: result.provider,
        model: result.model,
        processingTimeMs: result.processingTimeMs,
        costCents: result.costCents,
      });
    } else {
      this.log.error('Audio transcription failed', { error: result.errorMessage });
    }

    return result;
  }

  /**
   * Transcribe using Groq Whisper API with retry on rate limits
   */
  private async transcribeWithGroq(filePath: string, language: string): Promise<ProcessingResult> {
    const client = this.getGroqClient();
    if (!client) {
      return this.createFailedResult('Groq client not configured (missing API key)', 'groq', GROQ_WHISPER_MODEL);
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Use ReadStream which is compatible with the SDK
        const fileStream = createReadStream(filePath);

        const transcription = await client.audio.transcriptions.create({
          file: fileStream as unknown as Uploadable,
          model: GROQ_WHISPER_MODEL,
          language,
          response_format: 'text',
        });

        // Groq returns text directly when response_format="text"
        const text =
          typeof transcription === 'string' ? transcription : ((transcription as { text?: string }).text ?? '');

        return {
          success: true,
          content: text.trim(),
          contentFormat: 'text',
          processingType: 'transcription',
          provider: 'groq',
          model: GROQ_WHISPER_MODEL,
          processingTimeMs: 0,
          language,
          costCents: 0,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (this.isRateLimitError(error)) {
          this.log.warn(`Groq rate limit hit (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
          await this.sleep(attempt);
        } else {
          // Non-rate-limit error, don't retry
          this.log.error('Groq transcription error', { error: lastError.message });
          break;
        }
      }
    }

    return this.createFailedResult(lastError?.message ?? 'Transcription failed', 'groq', GROQ_WHISPER_MODEL);
  }

  /**
   * Transcribe using OpenAI Whisper API (fallback)
   */
  private async transcribeWithOpenAI(filePath: string, language: string): Promise<ProcessingResult> {
    const client = this.getOpenAIClient();
    if (!client) {
      return this.createFailedResult('OpenAI client not configured (missing API key)', 'openai', OPENAI_WHISPER_MODEL);
    }

    try {
      // Use ReadStream which is compatible with the SDK
      const fileStream = createReadStream(filePath);

      const transcription = await client.audio.transcriptions.create({
        file: fileStream,
        model: OPENAI_WHISPER_MODEL,
        language,
        response_format: 'text',
      });

      const text =
        typeof transcription === 'string' ? transcription : ((transcription as { text?: string }).text ?? '');

      return {
        success: true,
        content: text?.trim() ?? '',
        contentFormat: 'text',
        processingType: 'transcription',
        provider: 'openai',
        model: OPENAI_WHISPER_MODEL,
        processingTimeMs: 0,
        language,
        costCents: 0,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error('OpenAI transcription error', { error: errorMsg });

      return this.createFailedResult(errorMsg, 'openai', OPENAI_WHISPER_MODEL);
    }
  }

  /**
   * Estimate audio duration from file size (rough approximation)
   * Used when actual duration is not provided
   */
  private estimateDuration(filePath: string): number | undefined {
    try {
      const stats = statSync(filePath);
      // Rough estimate: assume ~16kbps for voice notes
      // This gives us ~2KB per second
      const estimatedSeconds = Math.round(stats.size / 2000);
      return Math.max(1, estimatedSeconds);
    } catch {
      return undefined;
    }
  }
}
