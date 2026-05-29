/**
 * Tests for delete-channel endpoint messageId resolution.
 *
 * WhatsApp/Baileys delete-for-everyone needs the platform-native message key id,
 * not Omni's internal UUID. The route must resolve an internal UUID to externalId
 * before calling channel plugin deleteMessage().
 */

import { describe, expect, test } from 'bun:test';
import { resolveChannelMessageId } from '../routes/v2/messages';

const MESSAGE_UUID = '11111111-1111-4111-8111-111111111111';
const INSTANCE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTANCE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function servicesFor(chatInstanceId = INSTANCE_A) {
  return {
    messages: {
      async getById(id: string) {
        if (id !== MESSAGE_UUID) throw new Error('not found');
        return {
          id,
          chatId: 'chat-a',
          externalId: '3EB0DELETE_FOR_EVERYONE',
        };
      },
    },
    chats: {
      async getById(id: string) {
        if (id !== 'chat-a') throw new Error('chat not found');
        return {
          id,
          instanceId: chatInstanceId,
        };
      },
    },
  };
}

describe('delete-channel messageId resolution', () => {
  test('resolves internal UUID to externalId for channel delete calls', async () => {
    const resolved = await resolveChannelMessageId(servicesFor() as never, MESSAGE_UUID, INSTANCE_A);

    expect(resolved).toBe('3EB0DELETE_FOR_EVERYONE');
  });

  test('passes platform-native non-UUID message ids through unchanged', async () => {
    await expect(resolveChannelMessageId(servicesFor() as never, '3EB0A1B2C3D4E5F6', INSTANCE_A)).resolves.toBe(
      '3EB0A1B2C3D4E5F6',
    );
  });

  test('rejects cross-instance internal UUID resolution', async () => {
    await expect(resolveChannelMessageId(servicesFor(INSTANCE_A) as never, MESSAGE_UUID, INSTANCE_B)).rejects.toThrow(
      /Message does not belong to this instance/,
    );
  });
});
