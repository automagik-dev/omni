import { describe, expect, it } from 'bun:test';
import type { TelegramBotLike } from '../src/grammy-shim';
import { setupChannelPostHandlers } from '../src/handlers/channel-posts';

describe('Telegram channel posts', () => {
  function createBotMock(handlers: Map<string, (ctx: unknown) => Promise<void>>): TelegramBotLike {
    return {
      on: (event: string, handler: (ctx: unknown) => Promise<void>) => {
        handlers.set(event, handler);
      },
    } as unknown as TelegramBotLike;
  }

  it('emits image content for channel_post photo with caption (largest file_id)', async () => {
    const handlers = new Map<string, (ctx: unknown) => Promise<void>>();

    const bot = createBotMock(handlers);

    const calls: unknown[][] = [];
    const plugin = {
      handleMessageReceived: async (...args: unknown[]) => {
        calls.push(args);
      },
    } as unknown as Parameters<typeof setupChannelPostHandlers>[1];

    setupChannelPostHandlers(bot, plugin, 'inst_1');

    const handler = handlers.get('channel_post');
    expect(handler).toBeTruthy();

    const msg = {
      message_id: 42,
      date: 1700000000,
      caption: 'hello caption',
      photo: [
        { file_id: 'small', file_size: 100 },
        { file_id: 'big', file_size: 500 },
      ],
      chat: { id: 100, type: 'channel', title: 'My Channel' },
      sender_chat: { id: 999, type: 'channel', title: 'My Channel' },
    };

    await handler?.({ channelPost: msg });

    expect(calls.length).toBe(1);

    const [_instanceId, _externalId, _chatId, _fromId, content] = calls[0] ?? [];
    const c = content as { type?: string; mediaUrl?: string } | undefined;
    expect(c?.type).toBe('image');
    expect(c?.mediaUrl).toBe('big');
  });

  it('emits text content for channel_post with only text', async () => {
    const handlers = new Map<string, (ctx: unknown) => Promise<void>>();
    const bot = createBotMock(handlers);

    const calls: unknown[][] = [];
    const plugin = {
      handleMessageReceived: async (...args: unknown[]) => {
        calls.push(args);
      },
    } as unknown as Parameters<typeof setupChannelPostHandlers>[1];

    setupChannelPostHandlers(bot, plugin, 'inst_1');

    const handler = handlers.get('channel_post');
    expect(handler).toBeTruthy();

    const msg = {
      message_id: 43,
      date: 1700000000,
      text: 'hello',
      chat: { id: 100, type: 'channel', title: 'My Channel' },
      sender_chat: { id: 999, type: 'channel', title: 'My Channel' },
    };

    await handler?.({ channelPost: msg });

    expect(calls.length).toBe(1);
    const [_instanceId, _externalId, _chatId, _fromId, content] = calls[0] ?? [];
    const c = content as { type?: string; text?: string; mediaUrl?: string } | undefined;
    expect(c?.type).toBe('text');
    expect(c?.text).toBe('hello');
    expect(c?.mediaUrl).toBeUndefined();
  });
});
