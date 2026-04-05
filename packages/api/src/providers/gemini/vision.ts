/**
 * Gemini Vision Provider
 *
 * Describes images and videos using the Gemini multimodal model.
 * Supports guided prompts (e.g. "what color is the cat?") and
 * returns a plain-text description.
 *
 * Uses `gemini-3.1-flash-lite-preview` by default for fast,
 * low-cost vision understanding. Callers can override via model
 * config in settings.
 */

import { createLogger } from '@omni/core';
import type { IVisionProvider, VisionOptions, VisionResult } from '../types';
import { getGeminiClient, resolveGeminiApiKey } from './client';

const log = createLogger('gemini-vision');

/**
 * Default Gemini vision model.
 *
 * `gemini-3.1-flash-lite-preview` is fast, low-cost, and supports
 * image + video understanding. Override via `vision.model` setting
 * or `GEMINI_VISION_MODEL` env var when Google rotates the preview tag.
 */
const DEFAULT_VISION_MODEL = 'gemini-3.1-flash-lite-preview';

/** Default guided prompt when no custom prompt is provided */
const DEFAULT_PROMPT =
  'Describe this image in clear, concise detail. Mention key subjects, actions, colors, setting, and any legible text.';

/** Settings reader interface — avoids circular dep on SettingsService */
interface VisionSettingsReader {
  getSecret(key: string, envFallback?: string): Promise<string | undefined>;
  getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | undefined>;
}

export class GeminiVisionProvider implements IVisionProvider {
  readonly name = 'gemini';

  constructor(private readonly settings: VisionSettingsReader) {}

  async describe(media: Buffer, mimeType: string, options?: VisionOptions): Promise<VisionResult> {
    const started = Date.now();

    const apiKey = await resolveGeminiApiKey(this.settings);
    const client = getGeminiClient(apiKey);

    const model = await this.settings.getString('vision.model', 'GEMINI_VISION_MODEL', DEFAULT_VISION_MODEL);

    const prompt = this.buildPrompt(options);

    // Gemini expects base64-encoded data for inline parts
    const base64 = media.toString('base64');

    log.info('Describing media', {
      model,
      mimeType,
      sizeBytes: media.length,
      hasCustomPrompt: !!options?.prompt,
    });

    try {
      const response = await client.models.generateContent({
        model: model ?? DEFAULT_VISION_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64,
                },
              },
              { text: prompt },
            ],
          },
        ],
        ...(options?.maxTokens ? { config: { maxOutputTokens: options.maxTokens } } : {}),
      });

      const text = response.text?.trim();
      if (!text) {
        throw new Error('Gemini returned empty vision response');
      }

      const processingMs = Date.now() - started;
      log.info('Vision description complete', { processingMs, textLength: text.length });

      return { text, processingMs };
    } catch (err) {
      log.error('Vision description failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Build the prompt sent alongside the media.
   * Prepends a language hint if requested.
   */
  private buildPrompt(options?: VisionOptions): string {
    const base = options?.prompt?.trim() || DEFAULT_PROMPT;
    if (options?.language) {
      return `Respond in ${options.language}.\n\n${base}`;
    }
    return base;
  }
}
