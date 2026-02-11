/**
 * Image Processor
 *
 * Generates descriptions for images using Gemini Vision (primary) with OpenAI fallback.
 */

import { readFileSync } from 'node:fs';
import { type GenerativeModel, GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

import { GEMINI_MODEL, OPENAI_VISION_MODEL } from '../models';
import { calculateCost } from '../pricing';
import type { ProcessOptions, ProcessingResult } from '../types';
import { BaseProcessor } from './base';

const MAX_RETRIES = 3;

/** Default prompt for image description */
const DEFAULT_PROMPT = `Analyze this image and provide a detailed description that would help someone who cannot see it understand what's in it.

Include:
1. Main subject(s) and their appearance
2. Setting/environment
3. Any text visible in the image
4. Notable details, colors, or objects
5. The overall mood or context

Be concise but thorough. If there's text in the image, transcribe it exactly.
Respond in the same language as any text in the image, or in Portuguese if no text is present.`;

/**
 * Image processor using Gemini Vision with OpenAI fallback
 */
export class ImageProcessor extends BaseProcessor {
  readonly name = 'image';
  readonly supportedMimeTypes = [
    'image/*',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
  ] as const;

  private geminiClient: GoogleGenerativeAI | null = null;
  private geminiModel: GenerativeModel | null = null;
  private openaiClient: OpenAI | null = null;

  /**
   * Get lazy-initialized Gemini model
   */
  private getGeminiModel(): GenerativeModel | null {
    if (!this.geminiModel && this.config.geminiApiKey) {
      this.geminiClient = new GoogleGenerativeAI(this.config.geminiApiKey);
      this.geminiModel = this.geminiClient.getGenerativeModel({ model: GEMINI_MODEL });
      this.log.info('Gemini model initialized');
    }
    return this.geminiModel;
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

  async process(filePath: string, mimeType: string, options?: ProcessOptions): Promise<ProcessingResult> {
    const startTime = performance.now();

    // Check if any API keys are configured
    if (!this.config.geminiApiKey && !this.config.openaiApiKey) {
      return this.createFailedResult('No vision API configured (missing Gemini or OpenAI API key)', 'none', 'none');
    }

    const prompt = options?.caption
      ? `${DEFAULT_PROMPT}\n\nAdditional context (caption): ${options.caption}`
      : DEFAULT_PROMPT;

    // Read file
    const imageData = readFileSync(filePath);

    // Try Gemini first (cheaper and often faster)
    let result = await this.describeWithGemini(imageData, mimeType, prompt);

    // If Gemini fails and we have OpenAI configured, try fallback
    if (!result.success && this.config.openaiApiKey) {
      this.log.info('Gemini description failed, trying OpenAI fallback...');
      result = await this.describeWithOpenAI(imageData, mimeType, prompt);
    }

    // Update processing time
    result.processingTimeMs = Math.round(performance.now() - startTime);

    if (result.success) {
      this.log.info('Image description successful', {
        provider: result.provider,
        model: result.model,
        processingTimeMs: result.processingTimeMs,
        costCents: result.costCents,
      });
    } else {
      this.log.error('Image description failed', { error: result.errorMessage });
    }

    return result;
  }

  /**
   * Describe image using Gemini Vision API
   */
  private async describeWithGemini(imageData: Buffer, mimeType: string, prompt: string): Promise<ProcessingResult> {
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
              mimeType: this.normalizeGeminiMimeType(mimeType),
              data: imageData.toString('base64'),
            },
          },
          { text: prompt },
        ]);

        const response = result.response;
        const text = response.text();
        const usageMetadata = response.usageMetadata;

        const inputTokens = usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = usageMetadata?.candidatesTokenCount ?? 0;

        const costCents = calculateCost('gemini_vision', GEMINI_MODEL, {
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
          this.log.error('Gemini description error', { error: lastError.message });
          break;
        }
      }
    }

    return this.createFailedResult(lastError?.message ?? 'Description failed', 'google', GEMINI_MODEL);
  }

  /**
   * Describe image using OpenAI Vision API (fallback)
   */
  private async describeWithOpenAI(imageData: Buffer, mimeType: string, prompt: string): Promise<ProcessingResult> {
    const client = this.getOpenAIClient();
    if (!client) {
      return this.createFailedResult('OpenAI client not configured (missing API key)', 'openai', OPENAI_VISION_MODEL);
    }

    try {
      const base64Data = imageData.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64Data}`;

      const response = await client.chat.completions.create({
        model: OPENAI_VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: dataUrl,
                  detail: 'high',
                },
              },
            ],
          },
        ],
        max_tokens: 1024,
      });

      const text = response.choices[0]?.message?.content ?? '';
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;

      const costCents = calculateCost('openai_vision', OPENAI_VISION_MODEL, {
        inputTokens,
        outputTokens,
      });

      return {
        success: true,
        content: text.trim(),
        contentFormat: 'text',
        processingType: 'description',
        provider: 'openai',
        model: OPENAI_VISION_MODEL,
        processingTimeMs: 0,
        inputTokens,
        outputTokens,
        costCents,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log.error('OpenAI description error', { error: errorMsg });

      return this.createFailedResult(errorMsg, 'openai', OPENAI_VISION_MODEL);
    }
  }

  /**
   * Normalize MIME type for Gemini API
   * Gemini is picky about exact MIME types
   */
  private normalizeGeminiMimeType(mimeType: string): string {
    // Map common variations to standard types
    const mimeMap: Record<string, string> = {
      'image/jpg': 'image/jpeg',
      'image/heic': 'image/heic',
      'image/heif': 'image/heif',
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
