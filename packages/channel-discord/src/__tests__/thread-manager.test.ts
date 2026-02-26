/**
 * Tests for thread management
 *
 * Since thread operations require a live Discord client, these tests
 * verify the module's structure, type exports, and helper logic.
 * Integration testing is done via the live Omni instance.
 */

import { describe, expect, test } from 'bun:test';
import { ChannelType } from 'discord.js';

describe('Thread Manager', () => {
  describe('module exports', () => {
    test('exports createThread function', async () => {
      const mod = await import('../threads/manager');
      expect(typeof mod.createThread).toBe('function');
    });

    test('exports createForumPost function', async () => {
      const mod = await import('../threads/manager');
      expect(typeof mod.createForumPost).toBe('function');
    });

    test('exports archiveThread function', async () => {
      const mod = await import('../threads/manager');
      expect(typeof mod.archiveThread).toBe('function');
    });

    test('exports addThreadMember function', async () => {
      const mod = await import('../threads/manager');
      expect(typeof mod.addThreadMember).toBe('function');
    });
  });

  describe('thread type mapping', () => {
    test('public thread type maps to ChannelType.PublicThread', () => {
      // ChannelType.PublicThread = 11
      expect(ChannelType.PublicThread).toBe(11);
    });

    test('private thread type maps to ChannelType.PrivateThread', () => {
      // ChannelType.PrivateThread = 12
      expect(ChannelType.PrivateThread).toBe(12);
    });

    test('forum channel type is ChannelType.GuildForum', () => {
      // ChannelType.GuildForum = 15
      expect(ChannelType.GuildForum).toBe(15);
    });
  });

  describe('createThread default behavior', () => {
    test('defaults to PublicThread when type is omitted', async () => {
      const mod = await import('../threads/manager');
      let createdType: number | undefined;

      const fakeClient = {
        channels: {
          fetch: async () => ({
            type: ChannelType.GuildText,
            threads: {
              create: async (opts: { type?: number }) => {
                createdType = opts.type;
                return { id: 'thread-1' };
              },
            },
          }),
        },
      };

      await mod.createThread(fakeClient as never, 'text-channel-id', { name: 'test' });
      expect(createdType).toBe(ChannelType.PublicThread);
    });
  });

  describe('createThread error handling', () => {
    test('throws for invalid channel (no live client)', async () => {
      const mod = await import('../threads/manager');

      // Without a real client, this should throw
      const fakeClient = {
        channels: {
          fetch: async () => null,
        },
      };

      try {
        await mod.createThread(fakeClient as never, 'invalid-channel', { name: 'test' });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain('does not support threads');
      }
    });

    test('throws for forum channel passed as text channel ID', async () => {
      const mod = await import('../threads/manager');

      // Forum channels have `threads` but are not text/announcement channels
      const fakeClient = {
        channels: {
          fetch: async () => ({ type: ChannelType.GuildForum }),
        },
      };

      try {
        await mod.createThread(fakeClient as never, 'forum-channel-id', { name: 'test' });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain('does not support threads');
      }
    });
  });

  describe('archiveThread error handling', () => {
    test('throws for invalid thread (no live client)', async () => {
      const mod = await import('../threads/manager');

      const fakeClient = {
        channels: {
          fetch: async () => null,
        },
      };

      try {
        await mod.archiveThread(fakeClient as never, 'invalid-thread');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain('not a thread');
      }
    });
  });

  describe('addThreadMember error handling', () => {
    test('throws for invalid thread (no live client)', async () => {
      const mod = await import('../threads/manager');

      const fakeClient = {
        channels: {
          fetch: async () => null,
        },
      };

      try {
        await mod.addThreadMember(fakeClient as never, 'invalid-thread', 'user-1');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain('not a thread');
      }
    });

    test('throws for text channel that has members property but is not a thread', async () => {
      const mod = await import('../threads/manager');

      // Text channels have a `members` Collection — the old guard was too broad
      const fakeClient = {
        channels: {
          fetch: async () => ({
            type: ChannelType.GuildText,
            members: new Map(), // has `members` but is NOT a thread
            isThread: () => false,
          }),
        },
      };

      try {
        await mod.addThreadMember(fakeClient as never, 'text-channel-id', 'user-1');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain('not a thread');
      }
    });
  });

  describe('createForumPost error handling', () => {
    test('throws for non-forum channel', async () => {
      const mod = await import('../threads/manager');

      const fakeClient = {
        channels: {
          fetch: async () => ({
            type: ChannelType.GuildText, // Not a forum
          }),
        },
      };

      try {
        await mod.createForumPost(fakeClient as never, 'text-channel', {
          name: 'test post',
          content: 'content',
        });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain('not a forum channel');
      }
    });
  });
});
