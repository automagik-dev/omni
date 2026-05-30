/**
 * Gemini Video Generation Provider (Veo 3.1)
 *
 * Implements {@link IVideoGenProvider} using Google's Veo 3.1 preview model.
 * Video generation is long-running (tens of seconds to several minutes), so
 * the SDK exposes a submit + poll flow:
 *
 *   1. `submit(prompt, options)` → returns a pending `VideoGenOperation`
 *   2. `poll(operationId)` → returns the latest state (still processing /
 *      complete with downloaded video buffer / failed with error message)
 *
 * The caller is responsible for the polling loop. The `POST /v2/media/film`
 * route turns this into a blocking request with a bounded timeout.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/video
 */

import type { GenerateVideosOperation, Video as SdkVideo } from '@google/genai';
import { createLogger } from '@omni/core';
import type { GeneratedVideo, IVideoGenProvider, VideoGenOperation, VideoGenOptions } from '../types';
import { GEMINI_MODELS, getGeminiClient, resolveGeminiApiKey } from './client';

const log = createLogger('gemini-videogen');

/** Settings reader interface — avoids circular dep on SettingsService */
export interface GeminiVideoGenSettingsReader {
  getSecret(key: string, envFallback?: string): Promise<string | undefined>;
  getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | undefined>;
}

/**
 * In-process registry of active Veo operations. The Gemini SDK requires the
 * full operation object to poll for status, so we cache it by the operation's
 * server-assigned `name` field and return that name as our opaque operationId.
 *
 * Operations are removed on terminal state (`complete` or `failed`) to avoid
 * unbounded growth. API processes are stateless apart from this cache, so
 * restarting the API loses in-flight operations — acceptable for a preview
 * provider where generation completes within a few minutes.
 */
const activeOperations = new Map<string, GenerateVideosOperation>();

export class GeminiVideoGenProvider implements IVideoGenProvider {
  readonly name = 'gemini';

  constructor(private settings: GeminiVideoGenSettingsReader) {}

  async submit(prompt: string, options?: VideoGenOptions): Promise<VideoGenOperation> {
    if (!prompt || prompt.trim().length === 0) {
      throw new Error('Gemini videogen: prompt must not be empty');
    }

    const apiKey = await resolveGeminiApiKey(this.settings);
    const client = getGeminiClient(apiKey);

    // Veo only supports 16:9 and 9:16; other ratios fall back to 16:9.
    const aspectRatio =
      options?.aspectRatio === '9:16' || options?.aspectRatio === '16:9' ? options.aspectRatio : '16:9';

    const model =
      (await this.settings.getString('videogen.gemini.model', 'GEMINI_VIDEO_MODEL', GEMINI_MODELS.VIDEO_GEN)) ??
      GEMINI_MODELS.VIDEO_GEN;

    log.info('Submitting Veo 3.1 video generation', {
      model,
      promptLen: prompt.length,
      aspectRatio,
      durationSec: options?.durationSec,
      audio: options?.audio !== false,
    });

    const operation = await client.models.generateVideos({
      model,
      prompt,
      config: {
        aspectRatio,
        ...(options?.durationSec !== undefined ? { durationSeconds: options.durationSec } : {}),
        ...(options?.seed !== undefined ? { seed: options.seed } : {}),
        generateAudio: options?.audio !== false,
        ...(options?.resolution !== undefined ? { resolution: options.resolution } : {}),
      },
    });

    return this.toVideoGenOperation(operation);
  }

  async poll(operationId: string): Promise<VideoGenOperation> {
    const cached = activeOperations.get(operationId);
    if (!cached) {
      // Operation was already finalized (cleared on terminal state) or never submitted.
      return {
        operationId,
        state: 'failed',
        error: `Operation ${operationId} not found (may have expired or already completed)`,
      };
    }

    const apiKey = await resolveGeminiApiKey(this.settings);
    const client = getGeminiClient(apiKey);

    const updated = await client.operations.getVideosOperation({ operation: cached });
    return this.toVideoGenOperation(updated);
  }

  /**
   * Normalize a Gemini `GenerateVideosOperation` into the internal
   * {@link VideoGenOperation} shape, downloading the generated video bytes
   * on success. On terminal states the operation is evicted from the cache.
   */
  private async toVideoGenOperation(operation: GenerateVideosOperation): Promise<VideoGenOperation> {
    const operationId = operation.name;
    if (!operationId) {
      // Can't track this — surface as failure so the caller doesn't hang polling.
      return {
        operationId: 'unknown',
        state: 'failed',
        error: 'Gemini returned an operation without a name',
      };
    }

    // Cache the operation object for subsequent polls.
    activeOperations.set(operationId, operation);

    if (operation.error) {
      activeOperations.delete(operationId);
      const message =
        (operation.error.message as string | undefined) ?? JSON.stringify(operation.error) ?? 'Unknown error';
      log.warn('Veo operation failed', { operationId, message });
      return { operationId, state: 'failed', error: message };
    }

    if (!operation.done) {
      return { operationId, state: 'processing' };
    }

    const generated = operation.response?.generatedVideos?.[0]?.video;
    if (!generated) {
      activeOperations.delete(operationId);
      return {
        operationId,
        state: 'failed',
        error: 'Veo operation completed without a generated video',
      };
    }

    let video: GeneratedVideo;
    try {
      video = await this.downloadVideo(generated);
    } catch (err) {
      activeOperations.delete(operationId);
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error('Failed to download Veo video', { operationId, error: message });
      return { operationId, state: 'failed', error: `Failed to download video: ${message}` };
    }

    activeOperations.delete(operationId);
    log.info('Veo operation complete', {
      operationId,
      sizeBytes: video.data.length,
      mimeType: video.mimeType,
    });
    return { operationId, state: 'complete', video };
  }

  /**
   * Fetch the generated video bytes. Veo may return either inlined base64
   * `videoBytes` or a signed `uri` that must be fetched with the API key
   * appended as a query parameter (same pattern the Gemini SDK uses for
   * `ai.files.download`).
   */
  private async downloadVideo(video: SdkVideo): Promise<GeneratedVideo> {
    const mimeType = video.mimeType ?? 'video/mp4';

    if (video.videoBytes) {
      const data = Buffer.from(video.videoBytes, 'base64');
      return { data, mimeType, durationMs: 0 };
    }

    if (!video.uri) {
      throw new Error('Veo video has neither videoBytes nor uri');
    }

    const apiKey = await resolveGeminiApiKey(this.settings);
    const separator = video.uri.includes('?') ? '&' : '?';
    const url = `${video.uri}${separator}key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Veo video download failed: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    return { data, mimeType, durationMs: 0 };
  }
}
