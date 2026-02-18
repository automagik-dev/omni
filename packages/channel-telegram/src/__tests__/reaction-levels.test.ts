import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  type ReactionLevelConfig,
  removeAckReaction,
  resetCounter,
  setAckReaction,
  shouldReact,
} from '../reactions/levels';

function createMockBot() {
  return {
    token: 'test-token',
    botInfo: { id: 1, username: 'testbot', first_name: 'Test' },
    on: mock(() => {}),
    catch: mock(() => {}),
    init: mock(() => Promise.resolve()),
    stop: mock(() => {}),
    start: mock(() => {}),
    api: {
      answerCallbackQuery: mock(() => Promise.resolve({})),
      sendChatAction: mock(() => Promise.resolve({})),
      sendMessage: mock(() => Promise.resolve({ message_id: 1 })),
      sendPoll: mock(() => Promise.resolve({ message_id: 1 })),
      setMyCommands: mock(() => Promise.resolve({})),
      editMessageText: mock(() => Promise.resolve({})),
      deleteMessage: mock(() => Promise.resolve({})),
      setMessageReaction: mock(() => Promise.resolve({})),
      sendPhoto: mock(() => Promise.resolve({ message_id: 1 })),
      sendAudio: mock(() => Promise.resolve({ message_id: 1 })),
      sendVideo: mock(() => Promise.resolve({ message_id: 1 })),
      sendSticker: mock(() => Promise.resolve({ message_id: 1 })),
      sendContact: mock(() => Promise.resolve({ message_id: 1 })),
      sendLocation: mock(() => Promise.resolve({ message_id: 1 })),
      sendDocument: mock(() => Promise.resolve({ message_id: 1 })),
      forwardMessage: mock(() => Promise.resolve({ message_id: 1 })),
      exportChatInviteLink: mock(() => Promise.resolve('https://t.me/test')),
      getMe: mock(() => Promise.resolve({ id: 1, is_bot: true, first_name: 'Test' })),
      getUserProfilePhotos: mock(() => Promise.resolve({ total_count: 0, photos: [] })),
      getFile: mock(() => Promise.resolve({ file_path: 'test.jpg' })),
      getChat: mock(() => Promise.resolve({ id: 1, type: 'private' })),
    },
  };
}

describe('Reaction Levels', () => {
  const instanceId = 'test-instance';

  beforeEach(() => {
    resetCounter(instanceId);
  });

  describe('shouldReact', () => {
    test('off mode returns null', () => {
      const config: ReactionLevelConfig = { level: 'off' };
      expect(shouldReact(instanceId, config)).toBeNull();
    });

    test('ack mode returns eyes emoji by default', () => {
      const config: ReactionLevelConfig = { level: 'ack' };
      expect(shouldReact(instanceId, config)).toBe('\u{1F440}');
    });

    test('ack mode returns custom emoji when configured', () => {
      const config: ReactionLevelConfig = { level: 'ack', ackEmoji: '\u{1F4AD}' };
      expect(shouldReact(instanceId, config)).toBe('\u{1F4AD}');
    });

    test('minimal mode reacts every 5th message by default (deterministic counter)', () => {
      const config: ReactionLevelConfig = { level: 'minimal' };
      const results: (string | null)[] = [];

      for (let i = 0; i < 15; i++) {
        results.push(shouldReact(instanceId, config));
      }

      // Messages 1-4: null, message 5: emoji, messages 6-9: null, message 10: emoji, etc.
      expect(results[0]).toBeNull(); // msg 1
      expect(results[1]).toBeNull(); // msg 2
      expect(results[2]).toBeNull(); // msg 3
      expect(results[3]).toBeNull(); // msg 4
      expect(results[4]).not.toBeNull(); // msg 5 — reaction!
      expect(results[5]).toBeNull(); // msg 6
      expect(results[9]).not.toBeNull(); // msg 10 — reaction!
      expect(results[14]).not.toBeNull(); // msg 15 — reaction!
    });

    test('minimal mode with custom interval', () => {
      const config: ReactionLevelConfig = { level: 'minimal', minimalInterval: 3 };
      const results: (string | null)[] = [];

      for (let i = 0; i < 9; i++) {
        results.push(shouldReact(instanceId, config));
      }

      expect(results[0]).toBeNull(); // msg 1
      expect(results[1]).toBeNull(); // msg 2
      expect(results[2]).not.toBeNull(); // msg 3 — reaction!
      expect(results[3]).toBeNull(); // msg 4
      expect(results[4]).toBeNull(); // msg 5
      expect(results[5]).not.toBeNull(); // msg 6 — reaction!
    });

    test('extensive mode reacts to every message', () => {
      const config: ReactionLevelConfig = { level: 'extensive' };
      for (let i = 0; i < 10; i++) {
        expect(shouldReact(instanceId, config)).not.toBeNull();
      }
    });

    test('extensive mode cycles through emojis', () => {
      const config: ReactionLevelConfig = {
        level: 'extensive',
        extensiveEmojis: ['A', 'B', 'C'],
      };

      // Counter starts at 0, increments to 1, 2, 3...
      // 1 % 3 = 1 -> B, 2 % 3 = 2 -> C, 3 % 3 = 0 -> A
      expect(shouldReact(instanceId, config)).toBe('B');
      expect(shouldReact(instanceId, config)).toBe('C');
      expect(shouldReact(instanceId, config)).toBe('A');
      expect(shouldReact(instanceId, config)).toBe('B');
    });

    test('config change takes effect on next message', () => {
      // Start with off
      let config: ReactionLevelConfig = { level: 'off' };
      expect(shouldReact(instanceId, config)).toBeNull();

      // Switch to ack — immediate effect
      config = { level: 'ack' };
      expect(shouldReact(instanceId, config)).toBe('\u{1F440}');

      // Switch back to off
      config = { level: 'off' };
      expect(shouldReact(instanceId, config)).toBeNull();
    });
  });

  describe('setAckReaction', () => {
    test('sets reaction successfully', async () => {
      const bot = createMockBot();
      const result = await setAckReaction(bot, '123', 456, '\u{1F440}');

      expect(result).toBe(true);
      expect(bot.api.setMessageReaction).toHaveBeenCalledWith('123', 456, [{ type: 'emoji', emoji: '\u{1F440}' }]);
    });

    test('returns false on permission error (fail silently)', async () => {
      const bot = createMockBot();
      bot.api.setMessageReaction = mock(() => {
        throw new Error('Bad Request: not enough rights to send reactions');
      });

      const result = await setAckReaction(bot, '123', 456, '\u{1F440}');
      expect(result).toBe(false);
    });

    test('returns false on REACTION_INVALID error', async () => {
      const bot = createMockBot();
      bot.api.setMessageReaction = mock(() => {
        throw new Error('REACTION_INVALID');
      });

      const result = await setAckReaction(bot, '123', 456, '\u{1F440}');
      expect(result).toBe(false);
    });
  });

  describe('removeAckReaction', () => {
    test('removes reaction successfully', async () => {
      const bot = createMockBot();
      await removeAckReaction(bot, '123', 456);

      expect(bot.api.setMessageReaction).toHaveBeenCalledWith('123', 456, []);
    });

    test('does not throw on failure (non-blocking)', async () => {
      const bot = createMockBot();
      bot.api.setMessageReaction = mock(() => {
        throw new Error('Message not found');
      });

      // Should not throw
      await removeAckReaction(bot, '123', 456);
    });
  });
});
