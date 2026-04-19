import { describe, expect, mock, test } from 'bun:test';
import { getFileWithRetry } from '../utils/media-download';

function createMockBot(getFileMock?: ReturnType<typeof mock>) {
  return {
    token: 'test-token',
    botInfo: { id: 1, username: 'testbot', first_name: 'Test' },
    on: mock(() => {}),
    catch: mock(() => {}),
    init: mock(() => Promise.resolve()),
    stop: mock(() => {}),
    start: mock(() => Promise.resolve()),
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
      getFile: getFileMock ?? mock(() => Promise.resolve({ file_path: 'photos/test.jpg' })),
      getChat: mock(() => Promise.resolve({ id: 1, type: 'private' })),
    },
  };
}

describe('Download Retry — getFileWithRetry', () => {
  test('returns file on success (first attempt)', async () => {
    const bot = createMockBot();
    const result = await getFileWithRetry(bot, 'file-123');

    expect(result).not.toBeNull();
    expect(result?.file_path).toBe('photos/test.jpg');
    expect(bot.api.getFile).toHaveBeenCalledTimes(1);
  });

  test('retries on transient failure then succeeds', async () => {
    let callCount = 0;
    const getFileMock = mock(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error('500 Internal Server Error');
      }
      return Promise.resolve({ file_path: 'photos/test.jpg' });
    });
    const bot = createMockBot(getFileMock);

    const result = await getFileWithRetry(bot, 'file-123');

    expect(result).not.toBeNull();
    expect(result?.file_path).toBe('photos/test.jpg');
    expect(getFileMock).toHaveBeenCalledTimes(2);
  });

  test('returns null after all retries exhausted', async () => {
    const getFileMock = mock(() => {
      throw new Error('503 Service Unavailable');
    });
    const bot = createMockBot(getFileMock);

    const result = await getFileWithRetry(bot, 'file-123');

    expect(result).toBeNull();
    expect(getFileMock).toHaveBeenCalledTimes(3);
  });

  test('file too large error — immediate fallback, no retry', async () => {
    const getFileMock = mock(() => {
      throw new Error('Bad Request: file is too big');
    });
    const bot = createMockBot(getFileMock);

    const result = await getFileWithRetry(bot, 'file-123');

    expect(result).toBeNull();
    expect(getFileMock).toHaveBeenCalledTimes(1);
  });

  test('non-transient error — no retry', async () => {
    const getFileMock = mock(() => {
      throw new Error('Bad Request: wrong file_id');
    });
    const bot = createMockBot(getFileMock);

    const result = await getFileWithRetry(bot, 'file-123');

    expect(result).toBeNull();
    expect(getFileMock).toHaveBeenCalledTimes(1);
  });

  test('success on first attempt adds minimal overhead', async () => {
    const bot = createMockBot();
    const start = Date.now();

    await getFileWithRetry(bot, 'file-123');

    const elapsed = Date.now() - start;
    // Should be well under 100ms for a mock call
    expect(elapsed).toBeLessThan(100);
  });
});
