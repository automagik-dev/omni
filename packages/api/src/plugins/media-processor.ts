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
import { type MediaProcessingService, createMediaProcessingService } from '@omni/media-processing';
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
): Promise<MediaResolution | null> {
  // Wait briefly for message-persistence to create the DB row (race condition:
  // both media-processor and message-persistence subscribe to message.received)
  const maxWaitMs = 5_000;
  const pollMs = 250;
  const deadline = Date.now() + maxWaitMs;

  let chat = await ctx.services.chats.getByExternalId(instanceId, chatId);
  while (!chat && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    chat = await ctx.services.chats.getByExternalId(instanceId, chatId);
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

  // If no local path, try to download from URL
  if (!filePath && content.mediaUrl) {
    try {
      const result = await ctx.mediaStorage.storeFromUrl(
        instanceId,
        message.id,
        content.mediaUrl,
        mimeType,
        message.platformTimestamp ?? undefined,
      );
      filePath = result.localPath;
      await ctx.mediaStorage.updateMessageLocalPath(message.id, filePath);
      log.debug('Downloaded media from URL', { messageId: message.id, filePath });
    } catch (error) {
      log.error('Failed to download media', { error: String(error), mediaUrl: content.mediaUrl });
      return null;
    }
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
      costUsd: result.costCents,
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

  const media = await resolveMediaPath(ctx, instanceId, payload.chatId, externalId, content, mimeType);
  if (!media) return;

  log.info('Processing media', { messageId: media.messageId, mimeType, filePath: media.fullPath });

  const result = await ctx.mediaService.process(media.fullPath, mimeType, {
    language: 'pt',
    caption: content.text,
  });

  if (!result.success) {
    log.warn('Media processing failed', { messageId: media.messageId, error: result.errorMessage });

    // Write error marker so waitForMediaProcessing can fail fast instead of polling for minutes
    const errorColumn = getContentFieldForType(
      result.processingType ?? inferProcessingType(content.type),
      content.type,
    );
    if (errorColumn) {
      const marker = `[error: ${result.errorMessage ?? 'unknown'}]`;
      await ctx.db
        .update(messages)
        .set({ [errorColumn]: marker })
        .where(eq(messages.id, media.messageId));
    }
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
 * Check if user is blocked by access control for the given instance.
 */
async function isUserBlocked(
  services: Services,
  instanceId: string,
  from: string | undefined,
  channelType: string | undefined,
): Promise<boolean> {
  if (!from) return false;
  const instance = await services.instances.getById(instanceId).catch(() => null);
  if (!instance || instance.accessMode === 'disabled') return false;
  const channel = (channelType ?? 'whatsapp') as import('@omni/db').ChannelType;
  const result = await services.access.checkAccess(instance, from, channel);
  return !result.allowed;
}

/**
 * Set up media processing - subscribes to message.received events
 */
export async function setupMediaProcessor(eventBus: EventBus, db: Database, services: Services): Promise<void> {
  // Read API keys from settings DB with env var fallback
  const [groqApiKey, openaiApiKey, geminiApiKey, defaultLanguage] = await Promise.all([
    services.settings.getSecret('groq.api_key', 'GROQ_API_KEY'),
    services.settings.getSecret('openai.api_key', 'OPENAI_API_KEY'),
    services.settings.getSecret('gemini.api_key', 'GEMINI_API_KEY'),
    services.settings.getString('media.default_language', 'DEFAULT_LANGUAGE', 'pt'),
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
  };

  // Subscribe to message.received with durable consumer
  await eventBus.subscribe(
    'message.received',
    async (event) => {
      const payload = event.payload as MessageReceivedPayload;
      const metadata = event.metadata;

      // Skip if no instance ID
      if (!metadata.instanceId) {
        return;
      }

      // Skip media processing for blocked users
      if (await isUserBlocked(ctx.services, metadata.instanceId, payload.from, metadata.channelType)) {
        log.debug('Skipping media processing for blocked user', {
          from: payload.from,
          instanceId: metadata.instanceId,
        });
        return;
      }

      // Check if message has media
      const content = payload.content;
      if (!shouldProcess(content.type)) {
        return;
      }

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
        // Don't re-throw - media processing failures shouldn't block message flow
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

  log.info('Media processor initialized');
}
