/** OpenAI image generation provider (`gpt-image-2` by default). */

import { createLogger } from '@omni/core';
import type { GeneratedImage, IImageGenProvider, ImageGenOptions, ImageGenResult } from '../types';

const log = createLogger('provider:openai:imagegen');
const IMAGE_GENERATIONS_URL = 'https://api.openai.com/v1/images/generations';
const DEFAULT_MODEL = 'gpt-image-2';

export interface OpenAiImageGenSettingsReader {
  getSecret(key: string, envFallback?: string): Promise<string | undefined>;
  getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | undefined>;
}

interface OpenAiImageResponse {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
}

export class OpenAiImageGenProvider implements IImageGenProvider {
  readonly name = 'openai';

  constructor(private readonly settings: OpenAiImageGenSettingsReader) {}

  async generate(prompt: string, options?: ImageGenOptions): Promise<ImageGenResult> {
    if (!prompt.trim()) throw new Error('OpenAI image gen: prompt must not be empty');

    const started = Date.now();
    const apiKey = await this.getApiKey();
    const model =
      options?.model ??
      (await this.settings.getString('imagegen.openai.model', 'OPENAI_IMAGE_MODEL', DEFAULT_MODEL)) ??
      DEFAULT_MODEL;
    const count = Math.max(1, Math.min(options?.count ?? 1, 4));
    const outputFormat = options?.outputFormat ?? options?.format ?? 'png';
    const size = normalizeSize(options?.imageSize, options?.aspectRatio);

    const body: Record<string, unknown> = {
      model,
      prompt: buildPrompt(prompt, options),
      n: count,
      size,
      ...(!model.startsWith('gpt-image-') ? { response_format: 'b64_json' } : {}),
      ...(options?.quality ? { quality: options.quality } : {}),
      ...(options?.background ? { background: options.background } : {}),
      ...(outputFormat ? { output_format: outputFormat } : {}),
      ...(options?.compression !== undefined ? { output_compression: options.compression } : {}),
    };

    log.info('Generating OpenAI image(s)', { model, count, size, outputFormat });
    const response = await fetch(IMAGE_GENERATIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new Error(`OpenAI image generation error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as OpenAiImageResponse;
    const images: GeneratedImage[] = [];
    for (const item of data.data ?? []) {
      let buffer: Buffer | undefined;
      if (item.b64_json) buffer = Buffer.from(item.b64_json, 'base64');
      else if (item.url) buffer = await fetchImageUrl(item.url);
      if (!buffer) continue;
      images.push({ data: buffer, mimeType: mimeTypeForFormat(outputFormat), width: 0, height: 0 });
    }
    if (images.length === 0) throw new Error('OpenAI returned no images');
    return { images, processingMs: Date.now() - started };
  }

  private async getApiKey(): Promise<string> {
    const key = await this.settings.getSecret('openai.api_key', 'OPENAI_API_KEY');
    if (!key) throw new Error('OpenAI API key not configured. Set openai.api_key or OPENAI_API_KEY.');
    return key;
  }
}

function buildPrompt(prompt: string, options?: ImageGenOptions): string {
  const parts = [prompt];
  if (options?.style) parts.push(`Style: ${options.style}.`);
  if (options?.negativePrompt) parts.push(`Avoid: ${options.negativePrompt}.`);
  return parts.join('\n');
}

function normalizeSize(size?: string, aspectRatio?: string): string {
  if (size) return size;
  if (aspectRatio === '16:9') return '1536x1024';
  if (aspectRatio === '9:16') return '1024x1536';
  return '1024x1024';
}

function mimeTypeForFormat(format: string): string {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
}

async function fetchImageUrl(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`OpenAI image URL download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
