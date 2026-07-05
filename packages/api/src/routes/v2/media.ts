/**
 * Media routes - serve stored media files and multimodal generation endpoints.
 *
 * Endpoints:
 *   GET  /media/:instanceId/*  - Serve stored media files (range-request aware)
 *   POST /media/tts            - Text-to-speech synthesis (provider-routed)
 *   POST /media/stt            - Speech-to-text transcription (provider-routed)
 *   POST /media/vision         - Image/video description (provider-routed)
 *   POST /media/film           - Video generation (provider-routed, async)
 *
 * @see history-sync wish
 * @see omni-agentic-cli wish (multimodal provider routing)
 */

import { zValidator } from '@hono/zod-validator';
import { createLogger } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';

import { providerRegistry } from '../../providers/registry';
import type {
  IImageGenProvider,
  IMusicGenProvider,
  ISttProvider,
  ITtsProvider,
  IVideoGenProvider,
  IVisionProvider,
} from '../../providers/types';
import { MediaStorageService } from '../../services/media-storage';
import type { AppVariables } from '../../types';

const log = createLogger('routes:media');

const mediaRoutes = new Hono<{ Variables: AppVariables }>();

// Singleton media storage service (initialized lazily)
let mediaStorage: MediaStorageService | null = null;

function getMediaStorage(db: unknown): MediaStorageService {
  if (!mediaStorage) {
    // @ts-expect-error - db type mismatch
    mediaStorage = new MediaStorageService(db);
  }
  return mediaStorage;
}

/**
 * Validate path component to prevent path traversal attacks
 */
function isValidPathComponent(component: string): boolean {
  // Reject empty, dot sequences, or absolute paths
  if (!component || component === '.' || component === '..') {
    return false;
  }
  // Reject if contains path traversal patterns
  if (component.includes('..') || component.includes('\0')) {
    return false;
  }
  return true;
}

/**
 * Validate UUID format for instanceId
 */
function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// ---------------------------------------------------------------------------
// TTS — Text-to-speech with provider routing
// ---------------------------------------------------------------------------

const ttsAudioFormatSchema = z.enum(['mp3', 'ogg', 'opus', 'wav', 'pcm', 'flac', 'aac']);

const ttsRequestSchema = z.object({
  text: z.string().min(1).max(5000).describe('Text to synthesize'),
  provider: z.string().optional().describe('Provider name (gemini, openai, elevenlabs). Defaults to config default.'),
  voice: z.string().optional().describe('Voice identifier (provider-specific)'),
  language: z.string().optional().describe('BCP-47 language code (e.g. "en-US")'),
  speed: z.number().min(0.5).max(2.0).optional().describe('Speaking speed multiplier (0.5-2.0)'),
  format: ttsAudioFormatSchema.optional().describe('Output audio format (default: ogg)'),
  style: z.string().optional().describe('Style prompt (provider-specific, e.g. Gemini style prompts)'),
  model: z.string().optional().describe('Model override (provider-specific)'),
  instructions: z.string().max(4000).optional().describe('Provider-native voice instructions'),
  tone: z.string().optional().describe('Tone guidance'),
  accent: z.string().optional().describe('Accent guidance'),
  pace: z.string().optional().describe('Pace guidance'),
  emotion: z.string().optional().describe('Emotion guidance'),
  voiceNoteProfile: z.string().optional().describe('Expression preset/profile name'),
  multiSpeaker: z
    .array(z.object({ speaker: z.string().min(1), voice: z.string().min(1) }))
    .max(2)
    .optional()
    .describe('Gemini multi-speaker voice mapping'),
});

/**
 * POST /media/tts - Synthesize text to speech via the registered provider.
 *
 * Resolves the TTS provider via the provider registry (explicit `provider`
 * param > `tts.provider` setting > first registered). Returns a JSON response
 * with base64-encoded audio so callers can stream, save, or forward it.
 *
 * This endpoint is the unified TTS entrypoint for the `omni speak` verb —
 * the legacy `POST /messages/send/tts` remains for direct ElevenLabs voice
 * notes during the turn lifecycle.
 */
mediaRoutes.post('/tts', zValidator('json', ttsRequestSchema), async (c) => {
  const body = c.req.valid('json');

  let provider: ITtsProvider;
  try {
    provider = await providerRegistry.resolve('tts', body.provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.warn('TTS provider resolution failed', { provider: body.provider, error: message });
    return c.json(
      {
        error: {
          code: 'PROVIDER_NOT_AVAILABLE',
          message,
          available: providerRegistry.list('tts'),
        },
      },
      400,
    );
  }

  try {
    const result = await provider.synthesize(body.text, {
      voice: body.voice,
      language: body.language,
      speed: body.speed,
      format: body.format,
      model: body.model,
      instructions: body.instructions,
      style: body.style,
      tone: body.tone,
      accent: body.accent,
      pace: body.pace,
      emotion: body.emotion,
      voiceNoteProfile: body.voiceNoteProfile,
      multiSpeaker: body.multiSpeaker,
    });

    return c.json({
      data: {
        provider: provider.name,
        mimeType: result.mimeType,
        durationMs: result.durationMs,
        sizeBytes: result.sizeBytes,
        audioBase64: result.audio.toString('base64'),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('TTS synthesis failed', { provider: provider.name, error: message });
    return c.json(
      {
        error: {
          code: 'TTS_SYNTHESIS_FAILED',
          message,
          provider: provider.name,
        },
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// STT — Speech-to-text with provider routing
// ---------------------------------------------------------------------------

const sttRequestSchema = z.object({
  audioBase64: z.string().min(1).describe('Base64-encoded audio data'),
  mimeType: z.string().min(1).describe('Audio MIME type (e.g. "audio/ogg", "audio/mpeg", "audio/wav")'),
  provider: z.string().optional().describe('Provider name (openai, gemini, groq). Defaults to config default.'),
  language: z.string().optional().describe('BCP-47 language hint (e.g. "en", "pt-BR")'),
  timestamps: z.boolean().optional().describe('Include word/segment timestamps in response'),
  model: z.string().optional().describe('Model override (provider-specific)'),
  prompt: z.string().max(4000).optional().describe('Provider transcription prompt/instructions'),
  context: z.string().max(4000).optional().describe('Domain context for acoustic disambiguation'),
  glossary: z.array(z.string().min(1).max(100)).max(200).optional().describe('Likely terms/acronyms/products'),
});

/**
 * POST /media/stt - Transcribe audio to text via the registered provider.
 *
 * Resolves the STT provider via the provider registry (explicit `provider`
 * param > `stt.provider` setting > first registered). Audio is supplied as
 * base64 in JSON to stay consistent with `/media/tts`.
 *
 * This endpoint powers the `omni listen` verb.
 */
mediaRoutes.post('/stt', zValidator('json', sttRequestSchema), async (c) => {
  const body = c.req.valid('json');

  let provider: ISttProvider;
  try {
    provider = await providerRegistry.resolve('stt', body.provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.warn('STT provider resolution failed', { provider: body.provider, error: message });
    return c.json(
      {
        error: {
          code: 'PROVIDER_NOT_AVAILABLE',
          message,
          available: providerRegistry.list('stt'),
        },
      },
      400,
    );
  }

  // Decode audio
  let audioBuffer: Buffer;
  try {
    audioBuffer = Buffer.from(body.audioBase64, 'base64');
    if (audioBuffer.length === 0) {
      throw new Error('Decoded audio is empty');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid base64';
    return c.json(
      {
        error: {
          code: 'INVALID_AUDIO',
          message: `Could not decode audio: ${message}`,
        },
      },
      400,
    );
  }

  try {
    const result = await provider.transcribe(audioBuffer, body.mimeType, {
      language: body.language,
      timestamps: body.timestamps,
      model: body.model,
      prompt: body.prompt,
      context: body.context,
      glossary: body.glossary,
    });

    return c.json({
      data: {
        provider: provider.name,
        text: result.text,
        segments: result.segments,
        detectedLanguage: result.detectedLanguage,
        processingMs: result.processingMs,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('STT transcription failed', { provider: provider.name, error: message });
    return c.json(
      {
        error: {
          code: 'STT_TRANSCRIPTION_FAILED',
          message,
          provider: provider.name,
        },
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Imagine — Image generation with provider routing
// ---------------------------------------------------------------------------

const imagineAspectRatioSchema = z.enum(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']);

const imagineRequestSchema = z.object({
  prompt: z.string().min(1).max(5000).describe('Text prompt describing the image(s) to generate'),
  provider: z.string().optional().describe('Provider name (gemini, openai). Defaults to config default.'),
  count: z.number().int().min(1).max(4).optional().describe('Number of images to generate (1-4)'),
  aspectRatio: imagineAspectRatioSchema.optional().describe('Aspect ratio preset'),
  imageSize: z.string().optional().describe('Longest-edge preset (provider-specific, e.g. "1K", "2K")'),
  model: z.string().optional().describe('Model alias override (e.g. nano-banana-2, nano-banana-pro, gpt-image-2)'),
  negativePrompt: z.string().optional().describe('What to avoid in the generated image'),
  seed: z.number().int().optional().describe('RNG seed for reproducibility'),
  quality: z.string().optional().describe('Quality hint (OpenAI/provider-specific)'),
  background: z.string().optional().describe('Background mode (OpenAI/provider-specific)'),
  outputFormat: z.enum(['png', 'jpeg', 'webp']).optional().describe('Output image format'),
  compression: z.number().int().min(0).max(100).optional().describe('Output compression 0-100'),
});

/**
 * POST /media/imagine - Generate image(s) via the registered imagegen provider.
 *
 * Resolves the imagegen provider via the provider registry (explicit `provider`
 * param > `imagegen.provider` setting > first registered). Returns the generated
 * images as base64 so callers can save, forward, or send them as media.
 *
 * This endpoint powers the `omni imagine` verb.
 */
mediaRoutes.post('/imagine', zValidator('json', imagineRequestSchema), async (c) => {
  const body = c.req.valid('json');

  let provider: IImageGenProvider;
  try {
    provider = await providerRegistry.resolve('imagegen', body.provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.warn('Imagegen provider resolution failed', { provider: body.provider, error: message });
    return c.json(
      {
        error: {
          code: 'PROVIDER_NOT_AVAILABLE',
          message,
          available: providerRegistry.list('imagegen'),
        },
      },
      400,
    );
  }

  try {
    const result = await provider.generate(body.prompt, {
      count: body.count,
      aspectRatio: body.aspectRatio,
      negativePrompt: body.negativePrompt,
      seed: body.seed,
      model: body.model,
      imageSize: body.imageSize,
      quality: body.quality,
      background: body.background,
      outputFormat: body.outputFormat,
      compression: body.compression,
    });

    return c.json({
      data: {
        provider: provider.name,
        processingMs: result.processingMs,
        images: result.images.map((img) => ({
          mimeType: img.mimeType,
          sizeBytes: img.data.length,
          base64: img.data.toString('base64'),
          width: img.width,
          height: img.height,
          seed: img.seed,
        })),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Image generation failed', { provider: provider.name, error: message });
    return c.json(
      {
        error: {
          code: 'IMAGE_GEN_FAILED',
          message,
          provider: provider.name,
        },
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Vision — Image/video understanding with provider routing
// ---------------------------------------------------------------------------

const visionRequestSchema = z.object({
  mediaBase64: z.string().min(1).describe('Base64-encoded image or video data'),
  mimeType: z.string().min(1).describe('Media MIME type (e.g. "image/jpeg", "image/png", "video/mp4")'),
  provider: z.string().optional().describe('Provider name (gemini). Defaults to config default.'),
  prompt: z.string().optional().describe('Guided prompt (e.g. "What color is the cat?")'),
  language: z.string().optional().describe('Response language (e.g. "en", "pt-BR")'),
  maxTokens: z.number().int().positive().max(8192).optional().describe('Max output tokens'),
});

/**
 * POST /media/vision - Describe an image or video via the registered provider.
 *
 * Resolves the vision provider via the provider registry (explicit `provider`
 * param > `vision.provider` setting > first registered). Media is supplied
 * as base64 in JSON to stay consistent with `/media/tts` and `/media/stt`.
 *
 * This endpoint powers the `omni see` verb.
 */
mediaRoutes.post('/vision', zValidator('json', visionRequestSchema), async (c) => {
  const body = c.req.valid('json');

  let provider: IVisionProvider;
  try {
    provider = await providerRegistry.resolve('vision', body.provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.warn('Vision provider resolution failed', { provider: body.provider, error: message });
    return c.json(
      {
        error: {
          code: 'PROVIDER_NOT_AVAILABLE',
          message,
          available: providerRegistry.list('vision'),
        },
      },
      400,
    );
  }

  // Decode media
  let mediaBuffer: Buffer;
  try {
    mediaBuffer = Buffer.from(body.mediaBase64, 'base64');
    if (mediaBuffer.length === 0) {
      throw new Error('Decoded media is empty');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid base64';
    return c.json(
      {
        error: {
          code: 'INVALID_MEDIA',
          message: `Could not decode media: ${message}`,
        },
      },
      400,
    );
  }

  try {
    const result = await provider.describe(mediaBuffer, body.mimeType, {
      prompt: body.prompt,
      language: body.language,
      maxTokens: body.maxTokens,
    });

    return c.json({
      data: {
        provider: provider.name,
        text: result.text,
        processingMs: result.processingMs,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Vision description failed', { provider: provider.name, error: message });
    return c.json(
      {
        error: {
          code: 'VISION_DESCRIBE_FAILED',
          message,
          provider: provider.name,
        },
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Film — Video generation with provider routing (async)
// ---------------------------------------------------------------------------

const filmAspectRatioSchema = z.enum(['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']);
const imageMimeTypeSchema = z
  .string()
  .regex(/^image\/(png|jpeg|jpg|webp)$/i, 'Expected image/png, image/jpeg, or image/webp');
const imageBase64Schema = z
  .string()
  .min(1)
  .max(12_000_000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Expected base64 image data');

const filmRequestSchema = z.object({
  prompt: z.string().min(1).max(5000).describe('Text prompt describing the video'),
  provider: z.string().optional().describe('Provider name (gemini). Defaults to config default.'),
  durationSec: z.number().int().min(1).max(60).optional().describe('Clip duration in seconds (provider-dependent max)'),
  resolution: z.string().optional().describe('Resolution hint (e.g. "720p", "1080p")'),
  aspectRatio: filmAspectRatioSchema.optional().describe('Aspect ratio (Veo supports 16:9, 9:16)'),
  seed: z.number().int().optional().describe('RNG seed for reproducible output'),
  audio: z.boolean().optional().describe('Whether to generate audio along with the video'),
  imageBase64: imageBase64Schema.optional().describe('Reference image base64 for image-to-video'),
  imageMimeType: imageMimeTypeSchema.optional().describe('Reference image MIME type'),
  dialogue: z.string().optional().describe('Dialogue direction to fold into the prompt'),
  camera: z.string().optional().describe('Camera/framing direction'),
  shotList: z.array(z.string().min(1)).max(20).optional().describe('Shot list directions'),
  audioDirection: z.string().optional().describe('Sound/dialogue/ambient direction'),
  music: z.string().optional().describe('Music direction'),
  style: z.string().optional().describe('Visual style direction'),
});

/** Max wall-clock time to wait for a video generation to complete (ms). */
const FILM_TIMEOUT_MS = 5 * 60 * 1000;
/** Poll interval for video generation status (ms). */
const FILM_POLL_INTERVAL_MS = 5_000;

/**
 * POST /media/film - Generate a video via the registered videogen provider.
 *
 * Resolves the videogen provider via the provider registry (explicit `provider`
 * param > `videogen.provider` setting > first registered). The endpoint blocks
 * until generation completes (polling the underlying async operation) and
 * returns the finished video as base64. Times out at 5 minutes.
 *
 * This endpoint powers the `omni film` verb.
 */
mediaRoutes.post('/film', zValidator('json', filmRequestSchema), async (c) => {
  const body = c.req.valid('json');

  let provider: IVideoGenProvider;
  try {
    provider = await providerRegistry.resolve('videogen', body.provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.warn('Videogen provider resolution failed', { provider: body.provider, error: message });
    return c.json(
      {
        error: {
          code: 'PROVIDER_NOT_AVAILABLE',
          message,
          available: providerRegistry.list('videogen'),
        },
      },
      400,
    );
  }

  const startedAt = Date.now();
  const aspectRatio = body.aspectRatio ?? '16:9';

  try {
    let operation = await provider.submit(body.prompt, {
      aspectRatio,
      durationSec: body.durationSec,
      seed: body.seed,
      audio: body.audio ?? true,
      resolution: body.resolution,
      imageBase64: body.imageBase64,
      imageMimeType: body.imageMimeType,
      dialogue: body.dialogue,
      camera: body.camera,
      shotList: body.shotList,
      audioDirection: body.audioDirection,
      music: body.music,
      style: body.style,
    });

    while (operation.state === 'pending' || operation.state === 'processing') {
      if (Date.now() - startedAt > FILM_TIMEOUT_MS) {
        return c.json(
          {
            error: {
              code: 'VIDEO_GEN_TIMEOUT',
              message: `Video generation did not complete within ${FILM_TIMEOUT_MS / 1000}s`,
              operationId: operation.operationId,
              provider: provider.name,
            },
          },
          504,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, FILM_POLL_INTERVAL_MS));
      operation = await provider.poll(operation.operationId);
    }

    if (operation.state === 'failed' || !operation.video) {
      const message = operation.error ?? 'Video generation failed without error';
      log.error('Videogen operation failed', { provider: provider.name, error: message });
      return c.json(
        {
          error: {
            code: 'VIDEO_GEN_FAILED',
            message,
            provider: provider.name,
            operationId: operation.operationId,
          },
        },
        500,
      );
    }

    const video = operation.video;
    log.info('Videogen operation complete', {
      provider: provider.name,
      operationId: operation.operationId,
      sizeBytes: video.data.length,
      mimeType: video.mimeType,
      elapsedMs: Date.now() - startedAt,
    });

    return c.json({
      data: {
        provider: provider.name,
        operationId: operation.operationId,
        mimeType: video.mimeType,
        sizeBytes: video.data.length,
        durationMs: video.durationMs,
        videoBase64: video.data.toString('base64'),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Videogen request failed', { provider: provider.name, error: message });
    return c.json(
      {
        error: {
          code: 'VIDEO_GEN_FAILED',
          message,
          provider: provider.name,
        },
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Music — Music generation with provider routing
// ---------------------------------------------------------------------------

const musicRequestSchema = z.object({
  prompt: z.string().min(1).max(5000).describe('Text prompt describing the song/music'),
  provider: z.string().optional().describe('Provider name (gemini). Defaults to config default.'),
  model: z.string().optional().describe('Model override (provider-specific)'),
  mode: z.enum(['clip', 'pro']).optional().describe('Generation mode'),
  durationSec: z.number().int().min(1).max(600).optional().describe('Target duration in seconds'),
  instrumental: z.boolean().optional().describe('Generate instrumental music without vocals'),
  lyrics: z.string().max(10000).optional().describe('Lyrics to include'),
  timedSections: z
    .array(z.object({ start: z.string(), end: z.string(), instruction: z.string().min(1) }))
    .max(50)
    .optional()
    .describe('Timed song sections'),
  genre: z.string().optional().describe('Genre hint'),
  mood: z.string().optional().describe('Mood hint'),
  bpm: z.number().int().min(20).max(300).optional().describe('Tempo in BPM'),
  instruments: z.array(z.string().min(1)).max(30).optional().describe('Instrument hints'),
  singerProfile: z.string().optional().describe('Singer/vocal profile'),
  imageBase64: imageBase64Schema.optional().describe('Reference image base64'),
  imageMimeType: imageMimeTypeSchema.optional().describe('Reference image MIME type'),
  style: z.string().optional().describe('Style direction'),
});

mediaRoutes.post('/music', zValidator('json', musicRequestSchema), async (c) => {
  const body = c.req.valid('json');

  let provider: IMusicGenProvider;
  try {
    provider = await providerRegistry.resolve('musicgen', body.provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.warn('Musicgen provider resolution failed', { provider: body.provider, error: message });
    return c.json(
      {
        error: {
          code: 'PROVIDER_NOT_AVAILABLE',
          message,
          available: providerRegistry.list('musicgen'),
        },
      },
      400,
    );
  }

  try {
    const result = await provider.generate(body.prompt, {
      model: body.model,
      mode: body.mode,
      durationSec: body.durationSec,
      instrumental: body.instrumental,
      lyrics: body.lyrics,
      timedSections: body.timedSections,
      genre: body.genre,
      mood: body.mood,
      bpm: body.bpm,
      instruments: body.instruments,
      singerProfile: body.singerProfile,
      imageBase64: body.imageBase64,
      imageMimeType: body.imageMimeType,
      style: body.style,
    });

    return c.json({
      data: {
        provider: provider.name,
        model: result.model,
        mimeType: result.audio.mimeType,
        sizeBytes: result.audio.sizeBytes,
        durationMs: result.audio.durationMs,
        processingMs: result.processingMs,
        audioBase64: result.audio.data.toString('base64'),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    log.error('Music generation failed', { provider: provider.name, error: message });
    return c.json(
      {
        error: {
          code: 'MUSIC_GEN_FAILED',
          message,
          provider: provider.name,
        },
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Stored media serving
// ---------------------------------------------------------------------------

/**
 * GET /media/:instanceId/* - Serve stored media files
 *
 * Supports range requests for audio/video streaming. Bytes are served through
 * the active backend WITHOUT full-object buffering: Range requests fetch only
 * the requested bytes (positional file read / S3 ranged GET) and full GETs
 * stream (local file stream / S3 streaming GET) — a browser seeking through a
 * multi-GB remote video never pulls whole objects into API memory.
 *
 * Error contract: a missing object is 404; a backend that is down/misconfigured
 * (S3 unreachable, bad credentials, missing bucket) is 503 so clients retry
 * instead of treating a transient outage as gone-forever.
 */
mediaRoutes.get('/:instanceId/*', async (c) => {
  const instanceId = c.req.param('instanceId');

  // Validate instanceId is a valid UUID
  if (!isValidUUID(instanceId)) {
    return c.json({ error: { code: 'INVALID_INSTANCE', message: 'Invalid instance ID format' } }, 400);
  }

  const path = c.req.path.replace(`/api/v2/media/${instanceId}/`, '');

  if (!path) {
    return c.json({ error: { code: 'INVALID_PATH', message: 'No path specified' } }, 400);
  }

  // Security: Validate path to prevent path traversal attacks
  // Check each path segment
  const pathSegments = path.split('/');
  for (const segment of pathSegments) {
    if (!isValidPathComponent(segment)) {
      return c.json({ error: { code: 'INVALID_PATH', message: 'Invalid path' } }, 400);
    }
  }

  // Additional check: reject paths starting with /
  if (path.startsWith('/')) {
    return c.json({ error: { code: 'INVALID_PATH', message: 'Invalid path' } }, 400);
  }

  // Build relative path
  const relativePath = `${instanceId}/${path}`;

  // Get media storage service
  const db = c.get('services');
  const storage = getMediaStorage(db);

  try {
    // Stat first: resolves existence + size without reading bytes, and is the
    // gate that turns backend outages into 503 before any body is committed.
    const stat = await storage.statMedia(relativePath);
    if (!stat) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Media not found' } }, 404);
    }

    const fileSize = stat.size;
    const mimeType = storage.getMimeType(path);

    // Handle range requests for streaming
    const rangeHeader = c.req.header('Range');

    if (rangeHeader) {
      const matches = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (matches?.[1]) {
        const start = Number.parseInt(matches[1], 10);
        const requestedEnd = matches[2] ? Number.parseInt(matches[2], 10) : fileSize - 1;
        // Clamp to the object per RFC 7233 (also keeps Content-Length honest).
        const end = Math.min(requestedEnd, fileSize - 1);

        if (start >= fileSize || start > end) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${fileSize}`, 'Accept-Ranges': 'bytes' },
          });
        }

        const chunk = await storage.readMediaRange(relativePath, start, end);

        return new Response(chunk, {
          status: 206,
          headers: {
            'Content-Type': mimeType,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }
    }

    // Return full file as a stream (never a whole-object heap Buffer)
    const stream = await storage.readMediaStream(relativePath);
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000', // 1 year cache (content-addressable)
      },
    });
  } catch (err) {
    // statMedia/read* rethrow anything that is NOT object-not-found: transient
    // S3/disk failures surface as 503 so clients retry instead of caching a 404.
    log.error('Media backend read failed', { relativePath, error: String(err) });
    return c.json(
      { error: { code: 'MEDIA_BACKEND_UNAVAILABLE', message: 'Media storage backend unavailable, retry later' } },
      503,
    );
  }
});

/** Test-only hooks: inject/reset the module-level storage singleton. */
export const __test__ = {
  setMediaStorage(service: MediaStorageService | null): void {
    mediaStorage = service;
  },
};

export { mediaRoutes };
