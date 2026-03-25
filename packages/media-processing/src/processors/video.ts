/**
 * Video Processor
 *
 * Generates descriptions for videos using Gemini Flash.
 * Supports video understanding including scene description, action detection,
 * and audio transcription for videos with speech.
 *
 * Uses centralized retry + circuit breaker for resilience.
 */

import { readFileSync, statSync } from 'node:fs';
import { type GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';

import { GEMINI_MODEL } from '../models';
import { calculateCost } from '../pricing';
import { VIDEO_DESCRIPTION_PROMPT } from '../prompts';
import type { ProcessOptions, ProcessingResult } from '../types';
import { getMediaTimeouts } from '../types';
import { BaseProcessor } from './base';

const MAX_VIDEO_SIZE_MB = 20; // Gemini inline limit

/**
 * Video processor using Gemini Flash
 */
export class VideoProcessor extends BaseProcessor {
  readonly name = 'video';
  readonly supportedMimeTypes = [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'video/mpeg',
    'video/3gpp',
    'video/3gpp2',
  ] as const;

  private geminiClient: GoogleGenerativeAI | null = null;
  private geminiModel: GenerativeModel | null = null;

  /**
   * Get lazy-initialized Gemini model for video
   */
  private getGeminiModel(): GenerativeModel | null {
    if (!this.geminiModel && this.config.geminiApiKey) {
      this.geminiClient = new GoogleGenerativeAI(this.config.geminiApiKey);
      this.geminiModel = this.geminiClient.getGenerativeModel({ model: GEMINI_MODEL });
      this.log.info('Gemini model initialized for video');
    }
    return this.geminiModel;
  }

  async process(filePath: string, mimeType: string, options?: ProcessOptions): Promise<ProcessingResult> {
    const startTime = performance.now();

    // Check if Gemini API key is configured
    if (!this.config.geminiApiKey) {
      return this.createFailedResult('No video API configured (missing Gemini API key)', 'none', 'none');
    }

    // Check file size
    const stats = statSync(filePath);
    const fileSizeMb = stats.size / (1024 * 1024);

    if (fileSizeMb > MAX_VIDEO_SIZE_MB) {
      return this.createFailedResult(
        `Video too large (${fileSizeMb.toFixed(1)}MB). Max: ${MAX_VIDEO_SIZE_MB}MB. Use batch processing for larger files.`,
        'google',
        GEMINI_MODEL,
      );
    }

    const basePrompt = options?.prompt ?? VIDEO_DESCRIPTION_PROMPT;
    const prompt = options?.caption ? `${basePrompt}\n\nAdditional context: ${options.caption}` : basePrompt;

    // Read video file
    const videoData = readFileSync(filePath);

    // Process with Gemini
    const result = await this.describeWithGemini(videoData, mimeType, prompt);

    // Update processing time
    result.processingTimeMs = Math.round(performance.now() - startTime);

    if (result.success) {
      this.log.info('Video description successful', {
        provider: result.provider,
        model: result.model,
        processingTimeMs: result.processingTimeMs,
        costCents: result.costCents,
        fileSizeMb: fileSizeMb.toFixed(1),
      });
    } else {
      this.log.error('Video description failed', { error: result.errorMessage });
    }

    return result;
  }

  /**
   * Describe video using Gemini Flash API with retry + circuit breaker
   */
  private async describeWithGemini(videoData: Buffer, mimeType: string, prompt: string): Promise<ProcessingResult> {
    const model = this.getGeminiModel();
    if (!model) {
      return this.createFailedResult('Gemini not configured (missing API key)', 'google', GEMINI_MODEL);
    }

    const timeouts = getMediaTimeouts();

    try {
      const { text, inputTokens, outputTokens } = await this.executeWithResilience(
        'gemini',
        async () => {
          const result = await model.generateContent([
            {
              inlineData: {
                mimeType: this.normalizeVideoMimeType(mimeType),
                data: videoData.toString('base64'),
              },
            },
            { text: prompt },
          ]);

          const response = result.response;
          const usageMetadata = response.usageMetadata;

          return {
            text: response.text(),
            inputTokens: usageMetadata?.promptTokenCount ?? 0,
            outputTokens: usageMetadata?.candidatesTokenCount ?? 0,
          };
        },
        { timeoutMs: timeouts.videoTimeoutMs },
      );

      const costCents = calculateCost('gemini_video', GEMINI_MODEL, {
        inputTokens,
        outputTokens,
      });

      return {
        success: true,
        content: text.trim(),
        contentFormat: 'text',
        processingType: 'description',
        provider: 'google',
        model: GEMINI_MODEL,
        processingTimeMs: 0,
        inputTokens,
        outputTokens,
        costCents,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isCircuit = this.isCircuitOpen(error);
      this.log.error('Gemini video description error', { error: errorMsg, circuitOpen: isCircuit });
      return this.createFailedResult(errorMsg, 'google', GEMINI_MODEL);
    }
  }

  /**
   * Normalize MIME type for Gemini API
   */
  private normalizeVideoMimeType(mimeType: string): string {
    const mimeMap: Record<string, string> = {
      'video/quicktime': 'video/mp4', // MOV files
      'video/x-msvideo': 'video/avi',
      'video/x-matroska': 'video/mkv',
    };

    return mimeMap[mimeType.toLowerCase()] ?? mimeType;
  }

  /**
   * Override createFailedResult to use 'description' processing type
   */
  protected override createFailedResult(errorMessage: string, provider: string, model: string): ProcessingResult {
    return {
      success: false,
      contentFormat: 'text',
      processingType: 'description',
      provider,
      model,
      processingTimeMs: 0,
      costCents: 0,
      errorMessage,
    };
  }
}
