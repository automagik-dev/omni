/**
 * reaction.received / reaction.removed persistence (#1033).
 *
 * Reactions are not messages: they attach to the target message's
 * `reactions` column instead of creating a message row.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { ChannelType, Database, Message, ReactionInfo } from '@omni/db';
import type { Services } from '../../services';
import { MessageService } from '../../services/messages';
import { handleReactionState } from '../message-persistence';

function harness(found: boolean) {
  const addReaction = mock(async () => ({}));
  const removeReaction = mock(async () => ({}));
  const services = {
    db: {} as Database,
    chats: { findByExternalIdSmart: async () => (found ? { id: 'chat-1', channel: 'whatsapp-baileys' } : null) },
    messages: {
      getByExternalId: async () => (found ? { id: 'msg-1' } : null),
      addReaction,
      removeReaction,
    },
  } as unknown as Services;
  return { services, addReaction, removeReaction };
}

function eventOf(type: 'reaction.received' | 'reaction.removed', emoji: string, from = '5511888888888') {
  return {
    id: 'evt-1',
    type,
    payload: { messageId: 'ext-msg', chatId: '5511999999999@s.whatsapp.net', from, emoji },
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
      'whatsapp-baileys',
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

/**
 * A real MessageService over a fake Database that holds one message row:
 * every select returns it, every update merges into it.
 */
function storedState(channel: ChannelType) {
  const row = { id: 'msg-1', reactions: null, reactionCounts: null, latestEventId: null } as unknown as Message;
  const select = () => ({
    from: () => ({ where: () => ({ limit: async () => [row] }) }),
  });
  const update = () => ({
    set: (values: Partial<Message>) => ({
      where: () => ({
        returning: async () => {
          Object.assign(row, values);
          return [row];
        },
      }),
    }),
  });
  const db = { select, update } as unknown as Database;
  const services = {
    db,
    chats: { findByExternalIdSmart: async () => ({ id: 'chat-1', channel }) },
    messages: new MessageService(db, null),
  } as unknown as Services;
  return {
    services,
    reactions: () => ((row.reactions as ReactionInfo[] | null) ?? []).map((r) => [r.platformUserId, r.emoji]),
    counts: () => row.reactionCounts,
  };
}

describe('handleReactionState stored state', () => {
  const alice = '5511888888888';
  const bob = '5511777777777';

  test('whatsapp: a new emoji from the same user replaces the previous one', async () => {
    const s = storedState('whatsapp-baileys');
    await handleReactionState(s.services, eventOf('reaction.received', '⏳', alice), true);
    await handleReactionState(s.services, eventOf('reaction.received', '✅', alice), true);
    expect(s.reactions()).toEqual([[alice, '✅']]);
    expect(s.counts()).toEqual({ '✅': 1 });
  });

  test('whatsapp: two different users keep one reaction each', async () => {
    const s = storedState('whatsapp-business');
    await handleReactionState(s.services, eventOf('reaction.received', '⏳', alice), true);
    await handleReactionState(s.services, eventOf('reaction.received', '👍', bob), true);
    await handleReactionState(s.services, eventOf('reaction.received', '✅', alice), true);
    expect(s.reactions()).toEqual([
      [bob, '👍'],
      [alice, '✅'],
    ]);
    expect(s.counts()).toEqual({ '👍': 1, '✅': 1 });
  });

  test('whatsapp: a removal event still removes the user reaction', async () => {
    const s = storedState('whatsapp-baileys');
    await handleReactionState(s.services, eventOf('reaction.received', '⏳', alice), true);
    await handleReactionState(s.services, eventOf('reaction.removed', '', alice), false);
    expect(s.reactions()).toEqual([]);
    expect(s.counts()).toBeNull();
  });

  test('whatsapp: the same emoji twice is stored once', async () => {
    const s = storedState('whatsapp-baileys');
    await handleReactionState(s.services, eventOf('reaction.received', '✅', alice), true);
    await handleReactionState(s.services, eventOf('reaction.received', '✅', alice), true);
    expect(s.reactions()).toEqual([[alice, '✅']]);
    expect(s.counts()).toEqual({ '✅': 1 });
  });

  test('discord: several emojis from the same user are all kept', async () => {
    const s = storedState('discord');
    await handleReactionState(s.services, eventOf('reaction.received', '⏳', alice), true);
    await handleReactionState(s.services, eventOf('reaction.received', '✅', alice), true);
    expect(s.reactions()).toEqual([
      [alice, '⏳'],
      [alice, '✅'],
    ]);
    expect(s.counts()).toEqual({ '⏳': 1, '✅': 1 });
  });
});
