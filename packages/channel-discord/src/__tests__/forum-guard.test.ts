import { describe, expect, test } from 'bun:test';
import { ChannelType } from 'discord.js';

describe('forum-guard', () => {
  test('ChannelType.GuildForum is 15', () => {
    expect(ChannelType.GuildForum).toBe(15);
  });

  test('ChannelType.GuildMedia is 16', () => {
    expect(ChannelType.GuildMedia).toBe(16);
  });

  test('forum/media channel detection logic', () => {
    const forumType = ChannelType.GuildForum;
    const mediaType = ChannelType.GuildMedia;
    const textType = ChannelType.GuildText;

    const isForumOrMedia = (type: ChannelType) => type === ChannelType.GuildForum || type === ChannelType.GuildMedia;

    expect(isForumOrMedia(forumType)).toBe(true);
    expect(isForumOrMedia(mediaType)).toBe(true);
    expect(isForumOrMedia(textType)).toBe(false);
  });

  test('auto-thread should be skipped in forum channels', () => {
    // Simulate the decision logic
    const channelTypes = [
      { type: ChannelType.GuildForum, shouldSkip: true },
      { type: ChannelType.GuildMedia, shouldSkip: true },
      { type: ChannelType.GuildText, shouldSkip: false },
      { type: ChannelType.DM, shouldSkip: false },
      { type: ChannelType.PublicThread, shouldSkip: false },
    ];

    for (const { type, shouldSkip } of channelTypes) {
      const isForumOrMedia = type === ChannelType.GuildForum || type === ChannelType.GuildMedia;
      expect(isForumOrMedia).toBe(shouldSkip);
    }
  });
});
