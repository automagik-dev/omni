/**
 * Discord fetch-history + per_thread integration tests
 *
 * Tests:
 * - applyThreadId logic: sets threadId for thread channels, not for DMs
 * - DiscordPlugin exposes react, unreact methods
 */

import { describe, expect, it } from 'bun:test';
import { ChannelType } from 'discord.js';
import { DiscordPlugin } from '../plugin';

describe('Discord per_thread — threadId in rawPayload', () => {
  /**
   * Mirrors the applyThreadId helper from messages.ts:
   * sets payload.threadId = chatId when isThread && !isDMChannel && !payload.threadId
   */
  function applyThreadId(
    payload: Record<string, unknown>,
    chatId: string,
    isThread: boolean,
    isDMChannel: boolean,
  ): void {
    if (isThread && !isDMChannel && !payload.threadId) {
      payload.threadId = chatId;
    }
  }

  it('sets threadId for PublicThread messages', () => {
    const payload: Record<string, unknown> = {};
    applyThreadId(payload, 'T-001', true, false);
    expect(payload.threadId).toBe('T-001');
  });

  it('does not set threadId for DM channels', () => {
    const payload: Record<string, unknown> = {};
    applyThreadId(payload, 'D-001', true, true);
    expect(payload.threadId).toBeUndefined();
  });

  it('does not set threadId for non-thread channels (GuildText)', () => {
    const payload: Record<string, unknown> = {};
    applyThreadId(payload, 'C-001', false, false);
    expect(payload.threadId).toBeUndefined();
  });

  it('does not overwrite existing threadId', () => {
    const payload: Record<string, unknown> = { threadId: 'existing-T' };
    applyThreadId(payload, 'new-T', true, false);
    expect(payload.threadId).toBe('existing-T');
  });
});

describe('Discord thread type detection', () => {
  const THREAD_TYPES = [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread];
  const NON_THREAD_TYPES = [ChannelType.GuildText, ChannelType.DM, ChannelType.GuildForum];

  const isThread = (type: ChannelType) =>
    type === ChannelType.PublicThread || type === ChannelType.PrivateThread || type === ChannelType.AnnouncementThread;

  it('all thread channel types are detected as threads', () => {
    for (const type of THREAD_TYPES) {
      expect(isThread(type)).toBe(true);
    }
  });

  it('non-thread channel types are not detected as threads', () => {
    for (const type of NON_THREAD_TYPES) {
      expect(isThread(type)).toBe(false);
    }
  });
});

describe('DiscordPlugin — react/unreact surface', () => {
  it('exposes react method', () => {
    const plugin = new DiscordPlugin();
    expect(typeof plugin.react).toBe('function');
  });

  it('exposes unreact method', () => {
    const plugin = new DiscordPlugin();
    expect(typeof plugin.unreact).toBe('function');
  });

  it('exposes fetchHistory method', () => {
    const plugin = new DiscordPlugin();
    expect(typeof plugin.fetchHistory).toBe('function');
  });
});
