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

import type { ChannelType, EventBus, MessageReceivedPayload, OmniEvent } from '@omni/core';
import { classifyEnvelope, createLogger, isValidUuid } from '@omni/core';
import type { Database } from '@omni/db';
import { mediaContent, messages, omniEvents } from '@omni/db';
import {
  GEMINI_AUDIO_MODEL,
  type MediaProcessingService,
  createMediaProcessingService,
  getMediaHealthTracker,
  setGlobalCircuitBreakerStateChangeCallback,
} from '@omni/media-processing';
import { eq } from 'drizzle-orm';
import type { Services } from '../services';
import { MediaStorageService } from '../services/media-storage';
import { currentTenantScope, scopedHandle } from '../tenancy/tenant-scope';
import { runConsumerInTenantContext, runInWorkerTenantScope } from '../tenancy/worker-tenant-context';

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
 * The trusted tenant for a tenant-context storage write, or undefined for a
 * legacy/flag-off (or non-tenant) envelope. Read from the versioned envelope the
 * producer stamped (never a payload/request field), so a tenant-prefixed object
 * key is emitted only for a genuine tenant-context write and a legacy envelope
 * keeps the byte-identical pre-G5 key layout (ADR-0008).
 */
function envelopeTenantId(envelope: Pick<OmniEvent, 'metadata'>): string | undefined {
  const classification = classifyEnvelope(envelope.metadata);
  return classification.world === 'tenant' ? classification.tenantId : undefined;
}

/**
 * Run one DISCRETE media-processing DB block in the message's world (G5,
 * ADR-0008).
 *
 * The counterpart of the dispatcher's `runDispatchDb`. Media processing
 * interleaves DB reads with long downloads, AI transcription and NATS publishes,
 * so a scope must never wrap more than one discrete block — the G4 leg-2 rule
 * that a worker transaction never outlives its work item, applied at block
 * granularity. The chat/message lookups below additionally POLL for
 * message-persistence's commit, which a single spanning transaction could never
 * observe; each attempt therefore opens and closes its own scope.
 *
 * `undefined` is the legacy world: `fn` runs on the ambient pool, byte-identical
 * to pre-G5.
 */
function runMediaDb<T>(ctx: MediaProcessorContext, trustedTenantId: string | undefined, fn: () => Promise<T>) {
  return trustedTenantId === undefined ? fn() : runInWorkerTenantScope(ctx.db, trustedTenantId, fn);
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
 * Build fetch options for authenticated media downloads.
 * Slack private URLs require a bot-token Authorization header — we look it up
 * from the instances table so credentials never enter the event payload or DB.
 */
async function buildFetchOptions(
  ctx: MediaProcessorContext,
  instanceId: string,
  channelType?: ChannelType,
  trustedTenantId?: string,
): Promise<RequestInit | undefined> {
  if (channelType !== 'slack') return undefined;
  try {
    const instance = await runMediaDb(ctx, trustedTenantId, () => ctx.services.instances.getById(instanceId));
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
  trustedTenantId?: string,
): Promise<string | null> {
  const fetchOptions = await buildFetchOptions(ctx, instanceId, channelType, trustedTenantId);
  try {
    const result = await ctx.mediaStorage.storeFromUrl(
      instanceId,
      messageId,
      mediaUrl,
      mimeType,
      platformTimestamp,
      fetchOptions,
      trustedTenantId,
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
  trustedTenantId?: string,
): Promise<MediaResolution | null> {
  // Wait briefly for message-persistence to create the DB row (race condition:
  // both media-processor and message-persistence subscribe to message.received)
  const maxWaitMs = 5_000;
  const pollMs = 250;
  const deadline = Date.now() + maxWaitMs;

  // Use smart lookup to handle LID/phone JID resolution
  let chat = await runMediaDb(ctx, trustedTenantId, () => ctx.services.chats.findByExternalIdSmart(instanceId, chatId));
  while (!chat && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    chat = await runMediaDb(ctx, trustedTenantId, () => ctx.services.chats.findByExternalIdSmart(instanceId, chatId));
  }
  if (!chat) {
    log.debug('Chat not found, cannot process media', { chatId, externalId });
    return null;
  }

  const chatDbId = chat.id;
  let message = await runMediaDb(ctx, trustedTenantId, () =>
    ctx.services.messages.getByExternalId(chatDbId, externalId),
  );
  while (!message && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    message = await runMediaDb(ctx, trustedTenantId, () => ctx.services.messages.getByExternalId(chatDbId, externalId));
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
      trustedTenantId,
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

async function resolveSafeMediaContentEventId(
  ctx: MediaProcessorContext,
  envelope: Pick<OmniEvent, 'metadata'>,
  eventId: string | undefined,
): Promise<string | null> {
  if (!isUuid(eventId)) return null;
  const id = eventId;

  // media_content is audit/replay metadata, so do not block media.processed for long.
  // Event persistence runs concurrently with this processor and should normally win within milliseconds.
  const maxWaitMs = 250;
  const pollMs = 50;
  const deadline = Date.now() + maxWaitMs;

  while (true) {
    // Carry-forward #2: each existence check runs in its OWN short worker tenant
    // scope, resolved BEFORE the persist scope opens. The <=250ms poll therefore
    // never holds the persist transaction open across its `setTimeout` sleeps —
    // the sleeps happen between scopes, on no open transaction. The `omni_events`
    // read still runs under a worker scope through `scopedHandle`, so the site
    // stays a tenant-boundary: a plain ambient read would both regress that
    // classification AND, under RLS, see nothing (the FK would never resolve).
    let found: string | null;
    try {
      found = await runConsumerInTenantContext(ctx.db, envelope, async () => {
        const [event] = await scopedHandle(ctx.db)
          .select({ id: omniEvents.id })
          .from(omniEvents)
          .where(eq(omniEvents.id, id))
          .limit(1);
        return event?.id ?? null;
      });
    } catch (error) {
      log.debug('Failed to validate media_content event FK', { eventId: id, error: String(error) });
      return null;
    }

    if (found) return found;

    if (Date.now() >= deadline) {
      log.debug('Skipping media_content event FK; omni_event not found', { eventId: id });
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
  // The media_content FK, already resolved (carry-forward #2) in its OWN short
  // worker scope BEFORE this persist scope opened — so the <=250ms omni_events
  // existence poll never holds this transaction open across its sleeps. `null`
  // means "no safe FK" (missing/unresolvable event); the row is stored FK-less.
  safeEventId: string | null | undefined,
  result: Awaited<ReturnType<MediaProcessingService['process']>>,
  contentType?: string,
): Promise<void> {
  // Update message with processed content first (critical path for agent dispatcher)
  if (result.content) {
    const updateField = getContentFieldForType(result.processingType, contentType);
    if (updateField) {
      await scopedHandle(ctx.db)
        .update(messages)
        .set({ [updateField]: result.content })
        .where(eq(messages.id, messageId));
    }
  }

  // Store result in media_content table (non-critical analytics/audit record).
  //
  // When this runs inside a worker tenant scope, the message update above and
  // this insert share ONE transaction, so a failed insert (an RLS/FK rejection,
  // an ambiguous derivation) would abort the transaction and roll back the
  // CRITICAL message content write. On the legacy ambient pool each statement is
  // its own implicit transaction, so a failed audit insert never touched the
  // already-committed message update. To preserve that priority under a scope we
  // isolate the insert in a SAVEPOINT (`tx.transaction()` nests as one): a
  // failure rolls back only the audit row. Outside a scope the insert runs
  // exactly as before — byte-identical to pre-G5.
  try {
    const sdb = scopedHandle(ctx.db);
    const row = {
      eventId: safeEventId ?? null,
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
    };
    if (currentTenantScope()) {
      await sdb.transaction(async (sp) => {
        await sp.insert(mediaContent).values(row);
      });
    } else {
      await sdb.insert(mediaContent).values(row);
    }
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
  // The versioned envelope of the message.received event this work item processes.
  // Its trusted tenant (or `legacy`, flag-off) scopes every DB write below via
  // `runConsumerInTenantContext`; the media download/AI work stays OUTSIDE the
  // tenant transaction so no transaction is held across network I/O.
  envelope: Pick<OmniEvent, 'metadata'>,
): Promise<void> {
  const { instanceId, eventId } = metadata;
  const { content, externalId } = payload;
  const mimeType = getMimeType(content);
  // The trusted tenant for any object this work item stores (ADR-0008), read
  // from the versioned envelope — undefined for a legacy envelope, which keeps
  // the byte-identical pre-G5 key layout.
  const trustedTenantId = envelopeTenantId(envelope);

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
    trustedTenantId,
  );
  if (!media) return;

  // Obtain a readable local path for the bytes. In remote mode this fetches the
  // S3 object into a temp file; in local mode it resolves the on-disk path.
  const processable = await ctx.mediaStorage.materializeForProcessing(media.filePath);

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
      await runConsumerInTenantContext(ctx.db, envelope, async () => {
        await scopedHandle(ctx.db)
          .update(messages)
          .set({ [errorColumn]: marker })
          .where(eq(messages.id, media.messageId));
      });
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

  // Carry-forward #2: resolve the media_content FK in its OWN short worker
  // scope(s) FIRST — the <=250ms omni_events poll runs and releases here, so the
  // persist scope below never holds its transaction open across the poll's sleeps.
  const safeEventId = await resolveSafeMediaContentEventId(ctx, envelope, eventId);

  await runConsumerInTenantContext(ctx.db, envelope, () =>
    persistProcessingResult(ctx, media.messageId, safeEventId, result, content.type),
  );

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
  trustedTenantId?: string,
): Promise<void> {
  try {
    const processingType = inferProcessingType(payload.content.type);
    const reason = `unexpected: ${String(error)}`;
    const mediaId = await resolveMediaIdForCrash(ctx, metadata.instanceId ?? '', payload, trustedTenantId);
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
  trustedTenantId?: string,
): Promise<string> {
  try {
    const msg = await runMediaDb(ctx, trustedTenantId, async () => {
      const chat = await ctx.services.chats.findByExternalIdSmart(instanceId, payload.chatId);
      if (!chat) return null;
      return ctx.services.messages.getByExternalId(chat.id, payload.externalId);
    });
    if (msg) return msg.id;
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
    geminiAudioModel,
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
    services.settings.getString('stt.gemini.model', 'GEMINI_STT_MODEL', GEMINI_AUDIO_MODEL),
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
    geminiAudioModel: geminiAudioModel ?? GEMINI_AUDIO_MODEL,
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
        await processMessageMedia(
          ctx,
          payload,
          {
            instanceId: metadata.instanceId,
            eventId: event.id,
            channelType: metadata.channelType,
          },
          event,
        );
      } catch (error) {
        log.error('Failed to process media', {
          externalId: payload.externalId,
          error: String(error),
        });
        await publishMediaCrashEvents(ctx, event.id, payload, metadata, error, envelopeTenantId(event));
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
};

export type { MediaProcessorContext };
