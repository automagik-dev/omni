/**
 * Video Processor
 *
 * Generates descriptions for videos using Gemini Flash.
 * Supports video understanding including scene description, action detection,
 * and audio transcription for videos with speech.
 */

import { readFileSync, statSync } from 'node:fs';
import { type GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';

import { GEMINI_MODEL } from '../models';
import { calculateCost } from '../pricing';
import type { ProcessOptions, ProcessingResult } from '../types';
import { BaseProcessor } from './base';

const MAX_RETRIES = 3;
const MAX_VIDEO_SIZE_MB = 20; // Gemini inline limit

/** Default prompt for video description */
const DEFAULT_PROMPT = `Analyze this video and provide a comprehensive description.

Include:
1. Main subjects and what they're doing
2. Setting/environment
3. Key actions or events that occur
4. Any speech or dialogue (transcribe if present)
5. Text visible in the video
6. Overall context and purpose

If there is speech in the video, transcribe it accurately.
Respond in Portuguese if no specific language is detected in the audio.`;

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

    const prompt = options?.caption ? `${DEFAULT_PROMPT}\n\nAdditional context: ${options.caption}` : DEFAULT_PROMPT;

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
   * Describe video using Gemini Flash API
   */
  private async describeWithGemini(videoData: Buffer, mimeType: string, prompt: string): Promise<ProcessingResult> {
    const model = this.getGeminiModel();
    if (!model) {
      return this.createFailedResult('Gemini not configured (missing API key)', 'google', GEMINI_MODEL);
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
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
        const text = response.text();
        const usageMetadata = response.usageMetadata;

        const inputTokens = usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = usageMetadata?.candidatesTokenCount ?? 0;

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
        lastError = error instanceof Error ? error : new Error(String(error));

        if (this.isRateLimitError(error)) {
          this.log.warn(`Gemini rate limit hit (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
          await this.sleep(attempt);
        } else {
          this.log.error('Gemini video description error', { error: lastError.message });
          break;
        }
      }
    }

    return this.createFailedResult(lastError?.message ?? 'Video description failed', 'google', GEMINI_MODEL);
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
