import { afterEach, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { Database } from '@omni/db';
import { chats, instances, mediaContent, messages, omniEvents } from '@omni/db';
import type { MediaProcessingService } from '@omni/media-processing';
import { eq, inArray } from 'drizzle-orm';
import { describeWithDb, getTestDb } from '../../__tests__/db-helper';
import { __test__ } from '../media-processor';

type ProcessingResult = Awaited<ReturnType<MediaProcessingService['process']>>;
type MediaProcessorTestContext = Parameters<typeof __test__.persistProcessingResult>[0];

describeWithDb('media processor persistence', () => {
  let db: Database;
  const cleanup = {
    instanceIds: [] as string[],
    chatIds: [] as string[],
    messageIds: [] as string[],
    eventIds: [] as string[],
  };

  beforeAll(() => {
    db = getTestDb();
  });

  afterEach(async () => {
    if (cleanup.messageIds.length > 0) {
      await db.delete(mediaContent).where(inArray(mediaContent.mediaId, cleanup.messageIds));
      await db.delete(messages).where(inArray(messages.id, cleanup.messageIds));
    }
    if (cleanup.eventIds.length > 0) {
      await db.delete(omniEvents).where(inArray(omniEvents.id, cleanup.eventIds));
    }
    if (cleanup.chatIds.length > 0) {
      await db.delete(chats).where(inArray(chats.id, cleanup.chatIds));
    }
    if (cleanup.instanceIds.length > 0) {
      await db.delete(instances).where(inArray(instances.id, cleanup.instanceIds));
    }

    cleanup.instanceIds = [];
    cleanup.chatIds = [];
    cleanup.messageIds = [];
    cleanup.eventIds = [];
  });

  function testContext(): MediaProcessorTestContext {
    return { db } as MediaProcessorTestContext;
  }

  function transcriptionResult(content = 'audio transcrito no teste'): ProcessingResult {
    return {
      success: true,
      processingType: 'transcription',
      content,
      model: 'test-model',
      provider: 'test-provider',
      language: 'pt',
      duration: 4,
      inputTokens: 2,
      outputTokens: 3,
      processingTimeMs: 42,
    } as ProcessingResult;
  }

  async function createAudioMessage(): Promise<{
    instanceId: string;
    chatId: string;
    messageId: string;
    externalChatId: string;
  }> {
    const instanceId = randomUUID();
    const chatId = randomUUID();
    const messageId = randomUUID();
    const externalChatId = `120363${Math.floor(Math.random() * 1_000_000_000)}@g.us`;
    const externalMessageId = `ext-audio-${randomUUID()}`;

    cleanup.instanceIds.push(instanceId);
    cleanup.chatIds.push(chatId);
    cleanup.messageIds.push(messageId);

    await db.insert(instances).values({
      id: instanceId,
      name: `media-fk-test-${instanceId}`,
      channel: 'whatsapp-baileys',
      isActive: false,
    });

    await db.insert(chats).values({
      id: chatId,
      instanceId,
      externalId: externalChatId,
      chatType: 'group',
      channel: 'whatsapp-baileys',
    });

    await db.insert(messages).values({
      id: messageId,
      chatId,
      externalId: externalMessageId,
      source: 'realtime',
      senderPlatformUserId: '5511999999999@s.whatsapp.net',
      isFromMe: false,
      messageType: 'audio',
      hasMedia: true,
      mediaMimeType: 'audio/ogg',
      mediaLocalPath: 'whatsapp/test-audio.ogg',
      platformTimestamp: new Date(),
    });

    return { instanceId, chatId, messageId, externalChatId };
  }

  test('stores transcription and media_content with null event id when event FK is not safe', async () => {
    const { messageId } = await createAudioMessage();
    const missingEventId = randomUUID();
    const result = transcriptionResult('transcricao persistida sem FK segura');

    await __test__.persistProcessingResult(testContext(), messageId, missingEventId, result, 'audio');

    const [storedMessage] = await db
      .select({ transcription: messages.transcription })
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);
    const [storedMedia] = await db.select().from(mediaContent).where(eq(mediaContent.mediaId, messageId)).limit(1);

    expect(storedMessage?.transcription).toBe(result.content);
    expect(storedMedia).toBeDefined();
    expect(storedMedia?.eventId).toBeNull();
    expect(storedMedia?.content).toBe(result.content);
    expect(storedMedia?.processingType).toBe('transcription');
  });

  test('stores transcription and media_content linked to existing omni_event', async () => {
    const { instanceId, messageId, externalChatId } = await createAudioMessage();
    const eventId = randomUUID();
    cleanup.eventIds.push(eventId);

    await db.insert(omniEvents).values({
      id: eventId,
      externalId: `ext-event-${eventId}`,
      channel: 'whatsapp-baileys',
      instanceId,
      eventType: 'message.received',
      direction: 'inbound',
      contentType: 'audio',
      chatId: externalChatId,
      status: 'received',
      receivedAt: new Date(),
    });

    const result = transcriptionResult('transcricao persistida com FK valida');

    await __test__.persistProcessingResult(testContext(), messageId, eventId, result, 'audio');

    const [storedMessage] = await db
      .select({ transcription: messages.transcription })
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);
    const [storedMedia] = await db.select().from(mediaContent).where(eq(mediaContent.mediaId, messageId)).limit(1);

    expect(storedMessage?.transcription).toBe(result.content);
    expect(storedMedia).toBeDefined();
    expect(storedMedia?.eventId).toBe(eventId);
    expect(storedMedia?.content).toBe(result.content);
    expect(storedMedia?.processingType).toBe('transcription');
  });
});
