/**
 * Media Processing Handler
 *
 * Subscribes to message.received events and processes media content.
 * Extracts text from audio (transcription), images (description), and documents.
 * Results are stored in media_content table and made available for automations.
 *
 * Flow:
 * 1. message.received event with hasMedia=true
 * 2. Download media to local path (if not already done)
 * 3. Process with MediaProcessingService
 * 4. Store result in media_content table
 * 5. Update message.mediaTranscript
 * 6. Emit media.processed event
 *
 * @see media-processing-realtime wish
 */

import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { ChannelType, EventBus, MessageReceivedPayload } from '@omni/core';
import { createLogger, isValidUuid } from '@omni/core';
import type { Database } from '@omni/db';
import { mediaContent, messages, omniEvents } from '@omni/db';
import {
  type MediaProcessingService,
  createMediaProcessingService,
  getMediaHealthTracker,
  setGlobalCircuitBreakerStateChangeCallback,
} from '@omni/media-processing';
import { eq } from 'drizzle-orm';
import type { Services } from '../services';
import { MediaStorageService } from '../services/media-storage';

const log = createLogger('media-processor');

/**
 * Media types that should be processed
 */
const PROCESSABLE_MEDIA_TYPES = new Set(['audio', 'image', 'document', 'video']);

/**
 * Map processing type + content type to message column name
 */
function getContentFieldForType(
  processingType: 'transcription' | 'description' | 'extraction',
  contentType?: string,
): string | undefined {
  switch (processingType) {
    case 'transcription':
      return 'transcription';
    case 'description':
      return contentType === 'video' ? 'videoDescription' : 'imageDescription';
    case 'extraction':
      return 'documentExtraction';
    default:
      return undefined;
  }
}

/**
 * Infer processing type from content type (for error marker writes when result.processingType is absent)
 */
function inferProcessingType(contentType?: string): 'transcription' | 'description' | 'extraction' {
  switch (contentType) {
    case 'audio':
      return 'transcription';
    case 'image':
    case 'video':
      return 'description';
    case 'document':
      return 'extraction';
    default:
      return 'transcription';
  }
}

/**
 * Check if a content type should be processed
 */
function shouldProcess(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return PROCESSABLE_MEDIA_TYPES.has(contentType);
}

function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && isValidUuid(value);
}

/**
 * Get MIME type from content or infer from type
 */
function getMimeType(content: MessageReceivedPayload['content']): string | undefined {
  if (content.mimeType) return content.mimeType;

  // Infer from content type
  switch (content.type) {
    case 'audio':
      return 'audio/ogg';
    case 'image':
      return 'image/jpeg';
    case 'video':
      return 'video/mp4';
    case 'document':
      return 'application/octet-stream';
    default:
      return undefined;
  }
}

/**
 * Media processor context
 */
interface MediaProcessorContext {
  db: Database;
  eventBus: EventBus;
  services: Services;
  mediaService: MediaProcessingService;
  mediaStorage: MediaStorageService;
  defaultLanguage: string;
  promptOverrides: {
    audio?: string;
    image?: string;
    video?: string;
    document?: string;
  };
}

/**
 * Result of resolving media file path
 */
interface MediaResolution {
  messageId: string;
  /**
   * Stored reference recorded on the message row. In local mode this is a path
   * relative to the media base dir; in remote mode it is the S3 object key.
   */
  filePath: string;
}

/**
 * Media bytes materialized as a local filesystem path for the processing
 * service (which only accepts a path and reads whole files off disk), paired
 * with a cleanup that removes any temp file created for it.
 */
interface ProcessableMedia {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * Build fetch options for authenticated media downloads.
 * Slack private URLs require a bot-token Authorization header — we look it up
 * from the instances table so credentials never enter the event payload or DB.
 */
async function buildFetchOptions(
  ctx: MediaProcessorContext,
  instanceId: string,
  channelType?: ChannelType,
): Promise<RequestInit | undefined> {
  if (channelType !== 'slack') return undefined;
  try {
    const instance = await ctx.services.instances.getById(instanceId);
    const slackBotToken = (instance as Record<string, unknown>).slackBotToken as string | undefined;
    if (slackBotToken) {
      return { headers: { Authorization: `Bearer ${slackBotToken}` } };
    }
  } catch {
    // If instance lookup fails, attempt unauthenticated download anyway
  }
  return undefined;
}

/**
 * Download media from URL and persist to local storage.
 * Returns the local path on success, null on failure.
 */
async function downloadMediaFromUrl(
  ctx: MediaProcessorContext,
  instanceId: string,
  messageId: string,
  mediaUrl: string,
  mimeType: string,
  platformTimestamp: Date | undefined,
  channelType?: ChannelType,
): Promise<string | null> {
  const fetchOptions = await buildFetchOptions(ctx, instanceId, channelType);
  try {
    const result = await ctx.mediaStorage.storeFromUrl(
      instanceId,
      messageId,
      mediaUrl,
      mimeType,
      platformTimestamp,
      fetchOptions,
    );
    await ctx.mediaStorage.updateMessageLocalPath(messageId, result.localPath);
    log.debug('Downloaded media from URL', { messageId, filePath: result.localPath });
    return result.localPath;
  } catch (error) {
    log.error('Failed to download media', { error: String(error), mediaUrl });
    return null;
  }
}

/**
 * Resolve media file path for a message
 * Handles both local paths and URL downloads
 */
async function resolveMediaPath(
  ctx: MediaProcessorContext,
  instanceId: string,
  chatId: string,
  externalId: string,
  content: MessageReceivedPayload['content'],
  mimeType: string,
  channelType?: ChannelType,
): Promise<MediaResolution | null> {
  // Wait briefly for message-persistence to create the DB row (race condition:
  // both media-processor and message-persistence subscribe to message.received)
  const maxWaitMs = 5_000;
  const pollMs = 250;
  const deadline = Date.now() + maxWaitMs;

  // Use smart lookup to handle LID/phone JID resolution
  let chat = await ctx.services.chats.findByExternalIdSmart(instanceId, chatId);
  while (!chat && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    chat = await ctx.services.chats.findByExternalIdSmart(instanceId, chatId);
  }
  if (!chat) {
    log.debug('Chat not found, cannot process media', { chatId, externalId });
    return null;
  }

  let message = await ctx.services.messages.getByExternalId(chat.id, externalId);
  while (!message && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    message = await ctx.services.messages.getByExternalId(chat.id, externalId);
  }
  if (!message) {
    log.debug('Message not found after waiting, cannot process media', { externalId });
    return null;
  }

  let filePath = message.mediaLocalPath;

  if (!filePath && content.mediaUrl) {
    filePath = await downloadMediaFromUrl(
      ctx,
      instanceId,
      message.id,
      content.mediaUrl,
      mimeType,
      message.platformTimestamp ?? undefined,
      channelType,
    );
    if (!filePath) return null;
  }

  if (!filePath) {
    log.debug('No media file path available', { externalId });
    return null;
  }

  return {
    messageId: message.id,
    filePath,
  };
}

/**
 * Materialize the stored media as a local filesystem path the processing
 * service can read.
 *
 * - `local`: the bytes already live at `{basePath}/{key}`, so hand back that
 *   path directly with a no-op cleanup (byte-for-byte the previous behavior).
 * - `remote`: `filePath` is an S3 key, not a local path. Fetch the bytes via
 *   the storage backend and write them to an `os.tmpdir()` temp file, returning
 *   a cleanup that removes it. The temp file keeps the stored extension so
 *   processors that sniff by extension (e.g. audio duration) behave as on disk.
 */
async function materializeForProcessing(ctx: MediaProcessorContext, filePath: string): Promise<ProcessableMedia> {
  if (ctx.mediaStorage.getStorageMode() === 'local') {
    return { path: join(ctx.mediaStorage.getBasePath(), filePath), cleanup: async () => {} };
  }

  const buffer = await ctx.mediaStorage.read(filePath);
  const ext = extname(filePath) || '.bin';
  const tempPath = join(tmpdir(), `omni-media-${randomUUID()}${ext}`);
  await writeFile(tempPath, buffer);

  return {
    path: tempPath,
    cleanup: async () => {
      await rm(tempPath, { force: true });
    },
  };
}

async function resolveSafeMediaContentEventId(
  ctx: MediaProcessorContext,
  eventId: string | undefined,
): Promise<string | null> {
  if (!isUuid(eventId)) return null;

  // media_content is audit/replay metadata, so do not block media.processed for long.
  // Event persistence runs concurrently with this processor and should normally win within milliseconds.
  const maxWaitMs = 250;
  const pollMs = 50;
  const deadline = Date.now() + maxWaitMs;

  while (true) {
    try {
      const [event] = await ctx.db
        .select({ id: omniEvents.id })
        .from(omniEvents)
        .where(eq(omniEvents.id, eventId))
        .limit(1);

      if (event) return event.id;
    } catch (error) {
      log.debug('Failed to validate media_content event FK', { eventId, error: String(error) });
      return null;
    }

    if (Date.now() >= deadline) {
      log.debug('Skipping media_content event FK; omni_event not found', { eventId });
      return null;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * Store processing result in database and update message
 */
async function persistProcessingResult(
  ctx: MediaProcessorContext,
  messageId: string,
  eventId: string | undefined,
  result: Awaited<ReturnType<MediaProcessingService['process']>>,
  contentType?: string,
): Promise<void> {
  // Update message with processed content first (critical path for agent dispatcher)
  if (result.content) {
    const updateField = getContentFieldForType(result.processingType, contentType);
    if (updateField) {
      await ctx.db
        .update(messages)
        .set({ [updateField]: result.content })
        .where(eq(messages.id, messageId));
    }
  }

  // Store result in media_content table (non-critical analytics/audit record)
  try {
    const safeEventId = await resolveSafeMediaContentEventId(ctx, eventId);

    await ctx.db.insert(mediaContent).values({
      eventId: safeEventId,
      mediaId: messageId,
      processingType: result.processingType,
      content: result.content ?? '',
      model: result.model,
      provider: result.provider,
      language: result.language,
      duration: result.duration,
      tokensUsed: result.inputTokens ? result.inputTokens + (result.outputTokens ?? 0) : undefined,
      costUsd: result.costCents != null ? String(Math.round(result.costCents)) : null,
      processingTimeMs: result.processingTimeMs,
    });
  } catch (error) {
    log.warn('Failed to insert media_content record (non-critical)', {
      messageId,
      error: String(error),
    });
  }
}

/**
 * Resolve the prompt override for a given content type
 */
function getPromptOverride(ctx: MediaProcessorContext, contentType: string | undefined): string | undefined {
  if (contentType === 'audio') return ctx.promptOverrides.audio;
  if (contentType === 'image') return ctx.promptOverrides.image;
  if (contentType === 'video') return ctx.promptOverrides.video;
  if (contentType === 'document') return ctx.promptOverrides.document;
  return undefined;
}

/**
 * Process media for a received message
 */
async function processMessageMedia(
  ctx: MediaProcessorContext,
  payload: MessageReceivedPayload,
  metadata: { instanceId: string; eventId?: string; channelType?: ChannelType },
): Promise<void> {
  const { instanceId, eventId } = metadata;
  const { content, externalId } = payload;
  const mimeType = getMimeType(content);

  if (!mimeType || !ctx.mediaService.canProcess(mimeType)) {
    log.debug('MIME type not processable or missing', { mimeType, externalId });
    return;
  }

  const media = await resolveMediaPath(
    ctx,
    instanceId,
    payload.chatId,
    externalId,
    content,
    mimeType,
    metadata.channelType,
  );
  if (!media) return;

  // Obtain a readable local path for the bytes. In remote mode this fetches the
  // S3 object into a temp file; in local mode it resolves the on-disk path.
  const processable = await materializeForProcessing(ctx, media.filePath);

  log.info('Processing media', { messageId: media.messageId, mimeType, filePath: processable.path });

  let result: Awaited<ReturnType<MediaProcessingService['process']>>;
  try {
    result = await ctx.mediaService.process(processable.path, mimeType, {
      language: ctx.defaultLanguage,
      caption: content.text,
      prompt: getPromptOverride(ctx, content.type),
    });
  } finally {
    // Always remove any temp file fetched for remote processing (no-op in local mode).
    await processable.cleanup();
  }

  if (!result.success) {
    const reason = result.errorMessage ?? 'unknown';
    log.warn('Media processing failed', { messageId: media.messageId, error: reason });

    // Write error marker so consumers can detect failures via DB check
    const processingType = result.processingType ?? inferProcessingType(content.type);
    const errorColumn = getContentFieldForType(processingType, content.type);
    if (errorColumn) {
      const marker = `[error: media processing failed — ${reason}]`;
      await ctx.db
        .update(messages)
        .set({ [errorColumn]: marker })
        .where(eq(messages.id, media.messageId));
    }

    // Publish media.processing.failed event (dedicated failure event)
    await ctx.eventBus.publish(
      'media.processing.failed',
      {
        eventId: eventId ?? media.messageId,
        mediaId: media.messageId,
        processingType,
        error: reason,
        provider: result.provider,
        model: result.model,
      },
      { instanceId, channelType: metadata.channelType },
    );

    // Also publish media.processed with error so dispatcher resolves immediately
    await ctx.eventBus.publish(
      'media.processed',
      {
        eventId: eventId ?? media.messageId,
        mediaId: media.messageId,
        processingType,
        content: '',
        error: reason,
      },
      { instanceId, channelType: metadata.channelType },
    );
    return;
  }

  await persistProcessingResult(ctx, media.messageId, eventId, result, content.type);

  log.info('Media processing complete', {
    messageId: media.messageId,
    processingType: result.processingType,
    provider: result.provider,
    model: result.model,
    costCents: result.costCents,
    processingTimeMs: result.processingTimeMs,
  });

  await ctx.eventBus.publish(
    'media.processed',
    {
      eventId: eventId ?? media.messageId,
      mediaId: media.messageId,
      processingType: result.processingType,
      content: result.content ?? '',
      model: result.model,
      provider: result.provider,
      tokensUsed: result.inputTokens ? result.inputTokens + (result.outputTokens ?? 0) : undefined,
    },
    { instanceId, channelType: metadata.channelType },
  );
}

/**
 * Publish failure events when media processing crashes unexpectedly.
 * Ensures the dispatcher doesn't wait forever for a completion that will never come.
 */
async function publishMediaCrashEvents(
  ctx: MediaProcessorContext,
  eventId: string,
  payload: MessageReceivedPayload,
  metadata: { instanceId?: string; channelType?: ChannelType },
  error: unknown,
): Promise<void> {
  try {
    const processingType = inferProcessingType(payload.content.type);
    const reason = `unexpected: ${String(error)}`;
    const mediaId = await resolveMediaIdForCrash(ctx, metadata.instanceId ?? '', payload);
    const meta = { instanceId: metadata.instanceId, channelType: metadata.channelType };

    await ctx.eventBus.publish(
      'media.processing.failed',
      {
        eventId,
        mediaId,
        processingType,
        error: reason,
        provider: 'unknown',
        model: 'unknown',
      },
      meta,
    );

    await ctx.eventBus.publish(
      'media.processed',
      {
        eventId,
        mediaId,
        processingType,
        content: '',
        error: reason,
      },
      meta,
    );
  } catch (publishError) {
    log.error('Failed to publish media failure event', { error: String(publishError) });
  }
}

/**
 * Best-effort resolve DB message UUID for crash handler.
 * Dispatcher awaits completions keyed by message.id, not platform externalId.
 */
async function resolveMediaIdForCrash(
  ctx: MediaProcessorContext,
  instanceId: string,
  payload: MessageReceivedPayload,
): Promise<string> {
  try {
    const chat = await ctx.services.chats.findByExternalIdSmart(instanceId, payload.chatId);
    if (chat) {
      const msg = await ctx.services.messages.getByExternalId(chat.id, payload.externalId);
      if (msg) return msg.id;
    }
  } catch (lookupError) {
    log.debug('Failed to resolve DB message UUID for crash handler, falling back to externalId', {
      error: String(lookupError),
      instanceId,
      chatId: payload.chatId,
    });
  }
  return payload.externalId;
}

/**
 * Set up media processing - subscribes to message.received events
 */
export async function setupMediaProcessor(eventBus: EventBus, db: Database, services: Services): Promise<void> {
  // Read API keys and prompt overrides from settings DB with env var fallback
  const [
    groqApiKey,
    openaiApiKey,
    geminiApiKey,
    defaultLanguage,
    audioProvider,
    audioModel,
    audioPrompt,
    imagePrompt,
    videoPrompt,
    documentPrompt,
  ] = await Promise.all([
    services.settings.getSecret('groq.api_key', 'GROQ_API_KEY'),
    services.settings.getSecret('openai.api_key', 'OPENAI_API_KEY'),
    services.settings.getSecret('gemini.api_key', 'GEMINI_API_KEY'),
    services.settings.getString('media.default_language', 'DEFAULT_LANGUAGE', 'pt'),
    services.settings.getString('stt.provider', 'STT_PROVIDER', 'openai'),
    services.settings.getString('stt.openai.model', 'OPENAI_STT_MODEL', 'gpt-audio-mini'),
    services.settings.getString('prompt.audio_transcription'),
    services.settings.getString('prompt.image_description'),
    services.settings.getString('prompt.video_description'),
    services.settings.getString('prompt.document_ocr'),
  ]);

  const mediaService = createMediaProcessingService({
    groqApiKey,
    openaiApiKey,
    geminiApiKey,
    defaultLanguage,
    audioProvider: audioProvider ?? 'openai',
    audioModel: audioModel ?? 'gpt-audio-mini',
    audioPrompt: audioPrompt ?? undefined,
  });
  const mediaStorage = new MediaStorageService(db);

  const ctx: MediaProcessorContext = {
    db,
    eventBus,
    services,
    mediaService,
    mediaStorage,
    defaultLanguage: defaultLanguage ?? 'pt',
    promptOverrides: {
      audio: audioPrompt,
      image: imagePrompt,
      video: videoPrompt,
      document: documentPrompt,
    },
  };

  // Subscribe to message.received with durable consumer
  await eventBus.subscribe(
    'message.received',
    async (event) => {
      const payload = event.payload as MessageReceivedPayload;
      const metadata = event.metadata;

      if (!metadata.instanceId) return;
      if (!shouldProcess(payload.content.type)) return;

      try {
        await processMessageMedia(ctx, payload, {
          instanceId: metadata.instanceId,
          eventId: event.id,
          channelType: metadata.channelType,
        });
      } catch (error) {
        log.error('Failed to process media', {
          externalId: payload.externalId,
          error: String(error),
        });
        await publishMediaCrashEvents(ctx, event.id, payload, metadata, error);
      }
    },
    {
      durable: 'media-processor',
      queue: 'media-processor',
      maxRetries: 2,
      retryDelayMs: 1000,
      startFrom: 'first',
      concurrency: 5, // Process up to 5 media files in parallel
    },
  );

  // Set up circuit breaker state change logging
  setGlobalCircuitBreakerStateChangeCallback((name, from, to) => {
    log.warn('Circuit breaker state change', { provider: name, from, to });
  });

  // Subscribe to media.health requests and respond with health report
  await eventBus.subscribePattern(
    'media.health.request',
    async (event) => {
      const tracker = getMediaHealthTracker();
      const report = tracker.getReport();
      const correlationId = event.metadata?.correlationId ?? event.id;

      await eventBus.publishGeneric(
        'system.media.health.response',
        { correlationId, report },
        { source: 'media-processor' },
      );

      log.debug('Published media health report', {
        correlationId,
        totalRequests: report.overall.totalRequests,
        successRate: report.overall.successRate,
      });
    },
    {
      durable: 'media-health-responder',
      queue: 'media-health-responder',
    },
  );

  log.info('Media processor initialized');
}

export const __test__ = {
  persistProcessingResult,
  resolveSafeMediaContentEventId,
  processMessageMedia,
  materializeForProcessing,
};

export type { MediaProcessorContext };
