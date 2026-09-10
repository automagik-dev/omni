/**
 * reaction.received / reaction.removed persistence (#1033).
 *
 * Reactions are not messages: they attach to the target message's
 * `reactions` column instead of creating a message row.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { Database } from '@omni/db';
import type { Services } from '../../services';
import { handleReactionState } from '../message-persistence';

function harness(found: boolean) {
  const addReaction = mock(async () => ({}));
  const removeReaction = mock(async () => ({}));
  const services = {
    db: {} as Database,
    chats: { findByExternalIdSmart: async () => (found ? { id: 'chat-1' } : null) },
    messages: {
      getByExternalId: async () => (found ? { id: 'msg-1' } : null),
      addReaction,
      removeReaction,
    },
  } as unknown as Services;
  return { services, addReaction, removeReaction };
}

function eventOf(type: 'reaction.received' | 'reaction.removed', emoji: string) {
  return {
    id: 'evt-1',
    type,
    payload: { messageId: 'ext-msg', chatId: '5511999999999@s.whatsapp.net', from: '5511888888888', emoji },
    metadata: { correlationId: 'c', timestamp: 0, instanceId: 'inst-1' },
  } as never;
}

describe('handleReactionState', () => {
  test('reaction.received attaches the emoji to the target message', async () => {
    const h = harness(true);
    await handleReactionState(h.services, eventOf('reaction.received', '👍'), true);
    expect(h.addReaction).toHaveBeenCalledWith(
      'msg-1',
      { emoji: '👍', platformUserId: '5511888888888', isCustomEmoji: undefined, customEmojiId: undefined },
      'evt-1',
    );
    expect(h.removeReaction).not.toHaveBeenCalled();
  });

  test('reaction.removed detaches it (empty emoji = all of that user)', async () => {
    const h = harness(true);
    await handleReactionState(h.services, eventOf('reaction.removed', ''), false);
    expect(h.removeReaction).toHaveBeenCalledWith('msg-1', '5511888888888', '', 'evt-1');
  });

  test('unknown target message is a no-op', async () => {
    const h = harness(false);
    await handleReactionState(h.services, eventOf('reaction.received', '👍'), true);
    expect(h.addReaction).not.toHaveBeenCalled();
  });
});
