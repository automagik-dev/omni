/**
 * DeepSeek Vision Provider
 *
 * Uses DeepSeek's Anthropic-compatible Messages API. The OpenAI-compatible
 * endpoint currently accepts text-only content for v4 models; Anthropic format
 * is the only DeepSeek surface that accepts image blocks without JSON schema
 * rejection, so we use it for Omni vision probes/dogfood.
 */

import { createLogger } from '@omni/core';
import type { IVisionProvider, VisionOptions, VisionResult } from '../types';

const log = createLogger('deepseek-vision');

const DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic/v1/messages';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_MAX_TOKENS = 1024;
const ANTHROPIC_VERSION = '2023-06-01';

const DEFAULT_PROMPT =
  'Describe this image in clear, concise detail. Mention key subjects, actions, colors, setting, and any legible text.';

/** Settings reader interface — avoids circular dep on SettingsService */
interface DeepSeekSettingsReader {
  getSecret(key: string, envFallback?: string): Promise<string | undefined>;
  getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | undefined>;
}

interface DeepSeekTextBlock {
  type: 'text';
  text: string;
}

interface DeepSeekMessageResponse {
  content?: Array<DeepSeekTextBlock | { type: string; [key: string]: unknown }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

export class DeepSeekVisionProvider implements IVisionProvider {
  readonly name = 'deepseek';

  constructor(private readonly settings: DeepSeekSettingsReader) {}

  async describe(media: Buffer, mimeType: string, options?: VisionOptions): Promise<VisionResult> {
    const started = Date.now();
    const apiKey = await this.settings.getSecret('deepseek.api_key', 'DEEPSEEK_API_KEY');
    if (!apiKey) {
      throw new Error('DeepSeek API key not configured (missing deepseek.api_key or DEEPSEEK_API_KEY)');
    }

    const model = await this.settings.getString('vision.deepseek.model', 'DEEPSEEK_VISION_MODEL', DEFAULT_MODEL);
    const baseUrl = await this.settings.getString('deepseek.anthropic_url', 'DEEPSEEK_ANTHROPIC_URL', DEFAULT_BASE_URL);
    const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
    const prompt = this.buildPrompt(options);

    log.info('Describing media with DeepSeek', {
      model,
      mimeType,
      sizeBytes: media.length,
      maxTokens,
      hasCustomPrompt: !!options?.prompt,
    });

    const response = await fetch(baseUrl ?? DEFAULT_BASE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: model ?? DEFAULT_MODEL,
        max_tokens: maxTokens,
        // Keep benchmark/dogfood cheap and deterministic by default. Callers can
        // compare thinking mode through direct DeepSeek benchmarks later.
        thinking: { type: 'disabled' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: media.toString('base64'),
                },
              },
            ],
          },
        ],
      }),
    });

    const bodyText = await response.text();
    let body: DeepSeekMessageResponse;
    try {
      body = JSON.parse(bodyText) as DeepSeekMessageResponse;
    } catch {
      throw new Error(`DeepSeek vision returned non-JSON response (${response.status}): ${bodyText.slice(0, 300)}`);
    }

    if (!response.ok) {
      throw new Error(`DeepSeek vision error (${response.status}): ${body.error?.message ?? bodyText.slice(0, 300)}`);
    }

    const text = extractText(body).trim();
    if (!text) {
      throw new Error('DeepSeek returned empty vision response');
    }

    const processingMs = Date.now() - started;
    log.info('DeepSeek vision description complete', { processingMs, textLength: text.length });
    return { text, processingMs };
  }

  private buildPrompt(options?: VisionOptions): string {
    const base = options?.prompt?.trim() || DEFAULT_PROMPT;
    if (options?.language) {
      return `Respond in ${options.language}.\n\n${base}`;
    }
    return base;
  }
}

function extractText(body: DeepSeekMessageResponse): string {
  return (body.content ?? [])
    .filter(
      (part): part is DeepSeekTextBlock => part.type === 'text' && typeof (part as DeepSeekTextBlock).text === 'string',
    )
    .map((part) => part.text)
    .join('\n');
}
