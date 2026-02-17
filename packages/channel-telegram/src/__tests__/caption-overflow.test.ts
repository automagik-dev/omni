import { describe, expect, mock, test } from 'bun:test';
import { sendPhoto, splitCaption } from '../senders/media';

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
      sendMessage: mock(() => Promise.resolve({ message_id: 2 })),
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

describe('Caption Overflow — splitCaption()', () => {
  test('caption of 2000 chars splits into first 1024 + overflow of 976', () => {
    const caption = 'a'.repeat(2000);
    const { first, overflow } = splitCaption(caption);

    expect(first.length).toBe(1024);
    expect(overflow).toHaveLength(1);
    expect(overflow[0]?.length).toBe(976);
  });

  test('caption of 3000 chars splits into 3 chunks (recursive)', () => {
    const caption = 'b'.repeat(3000);
    const { first, overflow } = splitCaption(caption);

    expect(first.length).toBe(1024);
    expect(overflow).toHaveLength(2);
    expect(overflow[0]?.length).toBe(1024);
    expect(overflow[1]?.length).toBe(952);

    // All chunks <= 1024
    expect(first.length).toBeLessThanOrEqual(1024);
    for (const chunk of overflow) {
      expect(chunk.length).toBeLessThanOrEqual(1024);
    }
  });

  test('caption of exactly 1024 chars — no split', () => {
    const caption = 'c'.repeat(1024);
    const { first, overflow } = splitCaption(caption);

    expect(first.length).toBe(1024);
    expect(overflow).toHaveLength(0);
  });

  test('caption of <1024 chars — no split', () => {
    const caption = 'Hello world';
    const { first, overflow } = splitCaption(caption);

    expect(first).toBe('Hello world');
    expect(overflow).toHaveLength(0);
  });

  test('empty caption — no follow-up messages', () => {
    const { first, overflow } = splitCaption('');

    expect(first).toBe('');
    expect(overflow).toHaveLength(0);
  });
});

describe('Caption Overflow — sendPhoto integration', () => {
  test('long caption triggers follow-up sendMessage', async () => {
    const bot = createMockBot();
    const caption = 'x'.repeat(2000);

    await sendPhoto(bot, '123', 'https://example.com/photo.jpg', caption);

    // sendPhoto called with truncated caption
    expect(bot.api.sendPhoto).toHaveBeenCalledTimes(1);
    const photoCallArgs = bot.api.sendPhoto.mock.calls[0];
    expect(photoCallArgs?.[2]?.caption?.length).toBe(1024);

    // sendMessage called for overflow
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    const msgCallArgs = bot.api.sendMessage.mock.calls[0];
    expect(msgCallArgs?.[1]?.length).toBe(976);
  });

  test('short caption sends normally without follow-up', async () => {
    const bot = createMockBot();
    await sendPhoto(bot, '123', 'https://example.com/photo.jpg', 'Short caption');

    expect(bot.api.sendPhoto).toHaveBeenCalledTimes(1);
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(0);
  });
});
