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

import { join } from 'node:path';
import type { ChannelType, EventBus, MessageReceivedPayload } from '@omni/core';
import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { mediaContent, messages } from '@omni/db';
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
  promptOverrides: {
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
  filePath: string;
  fullPath: string;
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
    fullPath: join(ctx.mediaStorage.getBasePath(), filePath),
  };
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
    await ctx.db.insert(mediaContent).values({
      eventId: eventId ?? undefined,
      mediaId: messageId,
      processingType: result.processingType,
      content: result.content ?? '',
      model: result.model,
      provider: result.provider,
      language: result.language,
      duration: result.duration,
      tokensUsed: result.inputTokens ? result.inputTokens + (result.outputTokens ?? 0) : undefined,
      costUsd: result.costCents != null ? String(result.costCents / 100) : null,
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

  log.info('Processing media', { messageId: media.messageId, mimeType, filePath: media.fullPath });

  const result = await ctx.mediaService.process(media.fullPath, mimeType, {
    language: 'pt',
    caption: content.text,
    prompt: getPromptOverride(ctx, content.type),
  });

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
  const [groqApiKey, openaiApiKey, geminiApiKey, defaultLanguage, imagePrompt, videoPrompt, documentPrompt] =
    await Promise.all([
      services.settings.getSecret('groq.api_key', 'GROQ_API_KEY'),
      services.settings.getSecret('openai.api_key', 'OPENAI_API_KEY'),
      services.settings.getSecret('gemini.api_key', 'GEMINI_API_KEY'),
      services.settings.getString('media.default_language', 'DEFAULT_LANGUAGE', 'pt'),
      services.settings.getString('prompt.image_description'),
      services.settings.getString('prompt.video_description'),
      services.settings.getString('prompt.document_ocr'),
    ]);

  const mediaService = createMediaProcessingService({
    groqApiKey,
    openaiApiKey,
    geminiApiKey,
    defaultLanguage,
  });
  const mediaStorage = new MediaStorageService(db);

  const ctx: MediaProcessorContext = {
    db,
    eventBus,
    services,
    mediaService,
    mediaStorage,
    promptOverrides: {
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
