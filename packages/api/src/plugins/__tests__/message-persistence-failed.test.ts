/**
 * #1277 — `message.failed` must mark the stored outbound message as failed.
 *
 * Before this, message-persistence had no `message.failed` subscriber: the
 * event was journaled, but the message row kept `delivery_status = 'sent'`.
 * The "never downgrade delivered/read" rule lives in the SQL of
 * `MessageService.markDeliveryFailed` and is covered by unified-messages.test.ts.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventBus, TypedOmniEvent } from '@omni/core';
import { handleMessageFailed, setupMessagePersistence } from '../message-persistence';

const EVENT_ID = '3f8b1c2e-5d4a-4b6c-9e7f-0a1b2c3d4e5f';

function failedEvent(overrides: { id?: string; payload?: Record<string, unknown> } = {}) {
  return {
    id: overrides.id ?? EVENT_ID,
    type: 'message.failed',
    timestamp: 1_700_000_000_000,
    payload: {
      externalId: 'wamid.HBgM',
      chatId: '5511999999999',
      error: 'Message undeliverable',
      errorCode: '130497',
      retryable: false,
      ...overrides.payload,
    },
    metadata: { instanceId: 'instance-1', channelType: 'whatsapp-business' },
  } as unknown as TypedOmniEvent<'message.failed'>;
}

function servicesWith(options: { chat?: boolean; message?: boolean; markFails?: boolean } = {}) {
  const { chat = true, message = true, markFails = false } = options;
  const findChat = mock(async () => (chat ? { id: 'chat-uuid' } : null));
  const getMessage = mock(async () => (message ? { id: 'message-uuid', deliveryStatus: 'sent' } : null));
  const markDeliveryFailed = mock(async () => {
    if (markFails) throw new Error('db down');
    return { id: 'message-uuid', deliveryStatus: 'failed' };
  });
  const services = {
    db: { transaction: async <T>(cb: (tx: unknown) => Promise<T>) => cb({}) },
    chats: { findByExternalIdSmart: findChat },
    messages: { getByExternalId: getMessage, markDeliveryFailed },
  } as never;
  return { services, findChat, getMessage, markDeliveryFailed };
}

describe('setupMessagePersistence (#1277)', () => {
  test('subscribes to message.failed and updates the stored message', async () => {
    const handlers = new Map<string, (event: unknown) => Promise<void>>();
    const bus = {
      subscribe: async (type: string, handler: (event: unknown) => Promise<void>) => {
        handlers.set(type, handler);
      },
      publish: async () => undefined,
    } as unknown as EventBus;
    const { services, markDeliveryFailed } = servicesWith();

    await setupMessagePersistence(bus, services);
    const handler = handlers.get('message.failed');
    expect(handler).toBeDefined();

    await handler?.(failedEvent());
    expect(markDeliveryFailed).toHaveBeenCalledWith('message-uuid', EVENT_ID);
  });
});

describe('handleMessageFailed (#1277)', () => {
  test('marks the stored message failed and points latestEventId at the failure event', async () => {
    const { services, findChat, getMessage, markDeliveryFailed } = servicesWith();

    await handleMessageFailed(services, failedEvent());

    expect(findChat).toHaveBeenCalledWith('instance-1', '5511999999999');
    expect(getMessage).toHaveBeenCalledWith('chat-uuid', 'wamid.HBgM');
    expect(markDeliveryFailed).toHaveBeenCalledWith('message-uuid', EVENT_ID);
  });

  test('does not store a non-UUID event id as latestEventId', async () => {
    const { services, markDeliveryFailed } = servicesWith();

    await handleMessageFailed(services, failedEvent({ id: 'evt_123' }));

    expect(markDeliveryFailed).toHaveBeenCalledWith('message-uuid', undefined);
  });

  test('skips a failure without externalId (the send never got a platform id)', async () => {
    const { services, findChat, markDeliveryFailed } = servicesWith();

    await handleMessageFailed(services, failedEvent({ payload: { externalId: undefined } }));

    expect(findChat).not.toHaveBeenCalled();
    expect(markDeliveryFailed).not.toHaveBeenCalled();
  });

  test('does nothing when the chat or the message is not stored', async () => {
    const noChat = servicesWith({ chat: false });
    await handleMessageFailed(noChat.services, failedEvent());
    expect(noChat.markDeliveryFailed).not.toHaveBeenCalled();

    const noMessage = servicesWith({ message: false });
    await handleMessageFailed(noMessage.services, failedEvent());
    expect(noMessage.markDeliveryFailed).not.toHaveBeenCalled();
  });

  test('logs instead of throwing when the update fails', async () => {
    const { services } = servicesWith({ markFails: true });

    await expect(handleMessageFailed(services, failedEvent())).resolves.toBeUndefined();
  });
});
