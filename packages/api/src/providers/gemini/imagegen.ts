/**
 * Gemini Image Generation Provider
 *
 * Generates images with Google's Gemini-native image models (Nano Banana).
 * Uses `generateContent` with `responseModalities: ['TEXT', 'IMAGE']` so the
 * same endpoint handles both Nano Banana Pro (higher quality, slower) and
 * Nano Banana 2 (fast preview).
 *
 * Model aliases (resolved via the `--model` flag or `imagegen.model` setting):
 *   - "nano-banana-2"   → gemini-3.1-flash-image  (default)
 *   - "nano-banana-pro" → gemini-3.1-pro-image
 *
 * Docs: https://ai.google.dev/gemini-api/docs/image-generation
 */

import { createLogger } from '@omni/core';
import type { GeneratedImage, IImageGenProvider, ImageGenOptions, ImageGenResult } from '../types';
import { getGeminiClient, resolveGeminiApiKey } from './client';

const log = createLogger('gemini-imagegen');

/** Settings reader interface — avoids circular dep on SettingsService */
export interface GeminiImageGenSettingsReader {
  getSecret(key: string, envFallback?: string): Promise<string | undefined>;
  getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | undefined>;
}

/** Map friendly aliases to underlying Gemini image model IDs. */
const MODEL_ALIASES: Record<string, string> = {
  'nano-banana-2': 'gemini-3.1-flash-image',
  'nano-banana-pro': 'gemini-3.1-pro-image',
  // Allow passing the raw model ID through as well
  'gemini-3.1-flash-image': 'gemini-3.1-flash-image',
  'gemini-3.1-pro-image': 'gemini-3.1-pro-image',
  'gemini-3.1-flash-image-preview': 'gemini-3.1-flash-image-preview',
  'gemini-3.1-pro-image-preview': 'gemini-3.1-pro-image-preview',
};

const DEFAULT_MODEL_ALIAS = 'nano-banana-2';

/** Extended image-gen options — Gemini supports model alias + image size. */
export interface GeminiImageGenOptions extends ImageGenOptions {
  /** Alias (nano-banana-2, nano-banana-pro) or raw Gemini model ID. */
  model?: string;
  /** Longest-edge preset ("1K", "2K", "4K"). Ignored when unset. */
  imageSize?: string;
}

/**
 * Resolve a model alias to the underlying Gemini model ID.
 * Unknown aliases fall through to the default model.
 */
function resolveModel(alias?: string): string {
  if (!alias) return MODEL_ALIASES[DEFAULT_MODEL_ALIAS] as string;
  const resolved = MODEL_ALIASES[alias];
  if (resolved) return resolved;
  // If caller passed something that looks like a raw Gemini model ID, trust it.
  if (alias.startsWith('gemini-')) return alias;
  log.warn('Unknown image model alias, falling back to default', {
    alias,
    fallback: DEFAULT_MODEL_ALIAS,
  });
  return MODEL_ALIASES[DEFAULT_MODEL_ALIAS] as string;
}

/**
 * Parse MIME type to derive image width/height heuristics.
 * Gemini doesn't always return pixel dimensions — callers that need exact
 * sizes should probe the returned buffer with an image library.
 */
function mimeTypeToFormat(mimeType?: string): 'png' | 'jpeg' | 'webp' {
  if (!mimeType) return 'png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpeg';
  if (mimeType.includes('webp')) return 'webp';
  return 'png';
}

/**
 * Build the `config` payload Gemini's native image models accept.
 * Extracted from `generate()` to keep the main orchestration function
 * under Biome's cognitive-complexity ceiling.
 */
function buildImageGenConfig(count: number, options?: GeminiImageGenOptions): Record<string, unknown> {
  const imageConfig: Record<string, unknown> = {};
  if (options?.aspectRatio) imageConfig.aspectRatio = options.aspectRatio;
  if (options?.imageSize) imageConfig.imageSize = options.imageSize;

  const config: Record<string, unknown> = {
    responseModalities: ['TEXT', 'IMAGE'],
    candidateCount: count,
  };
  if (Object.keys(imageConfig).length > 0) {
    config.imageConfig = imageConfig;
  }
  return config;
}

/**
 * Collect every inline image part across all candidates in a Gemini response.
 * Filters non-image parts and returns `GeneratedImage` records ready for the
 * provider result.
 */
function collectImages(
  candidates: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }>,
): GeneratedImage[] {
  const images: GeneratedImage[] = [];
  for (const candidate of candidates) {
    const parts = candidate.content?.parts ?? [];
    for (const part of parts) {
      const inline = part.inlineData;
      if (!inline?.data) continue;
      const mimeType = inline.mimeType || 'image/png';
      if (!mimeType.startsWith('image/')) continue;
      images.push({
        data: Buffer.from(inline.data, 'base64'),
        mimeType,
        // Gemini's native image models do not return pixel dimensions in the
        // response — downstream consumers can probe the buffer if needed.
        width: 0,
        height: 0,
      });
    }
  }
  return images;
}

export class GeminiImageGenProvider implements IImageGenProvider {
  readonly name = 'gemini';

  constructor(private readonly settings: GeminiImageGenSettingsReader) {}

  async generate(prompt: string, options?: GeminiImageGenOptions): Promise<ImageGenResult> {
    if (!prompt || prompt.trim().length === 0) {
      throw new Error('Gemini image gen: prompt must not be empty');
    }

    const started = Date.now();

    const apiKey = await resolveGeminiApiKey(this.settings);
    const client = getGeminiClient(apiKey);

    // Resolve model: explicit option > settings override > default alias.
    const modelSetting = await this.settings.getString(
      'imagegen.gemini.model',
      'GEMINI_IMAGE_MODEL',
      DEFAULT_MODEL_ALIAS,
    );
    const model = resolveModel(options?.model || modelSetting);

    const count = Math.max(1, Math.min(options?.count ?? 1, 4));

    log.info('Generating image(s)', {
      model,
      promptLength: prompt.length,
      count,
      aspectRatio: options?.aspectRatio,
      imageSize: options?.imageSize,
    });

    const config = buildImageGenConfig(count, options);

    let response: Awaited<ReturnType<typeof client.models.generateContent>>;
    try {
      response = await client.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // biome-ignore lint/suspicious/noExplicitAny: config typing varies between model families
        config: config as any,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Gemini image generation failed', { model, error: message });
      throw new Error(`Gemini image generation failed: ${message}`);
    }

    const images = collectImages(response.candidates ?? []);

    if (images.length === 0) {
      // Surface the text portion of the response (if any) to aid debugging.
      const text = response.text?.trim();
      throw new Error(
        text
          ? `Gemini returned no image (model responded with text: "${text.slice(0, 200)}")`
          : 'Gemini returned no image in response',
      );
    }

    const processingMs = Date.now() - started;
    log.info('Image generation complete', {
      model,
      imageCount: images.length,
      processingMs,
      firstFormat: mimeTypeToFormat(images[0]?.mimeType),
    });

    return { images, processingMs };
  }
}
