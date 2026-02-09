/**
 * Telegram Plugin Tests
 *
 * Basic tests for plugin structure, capabilities, and utilities.
 */

import { describe, expect, it } from 'bun:test';
import { TELEGRAM_CAPABILITIES } from '../src/capabilities';
import { TelegramPlugin } from '../src/plugin';
import { escapeMarkdownV2, splitMessage, truncateMessage } from '../src/utils/formatting';
import { buildDisplayName, isGroupChat, isPrivateChat, toPlatformUserId } from '../src/utils/identity';

describe('TelegramPlugin', () => {
  it('has correct plugin metadata', () => {
    const plugin = new TelegramPlugin();
    expect(plugin.id).toBe('telegram');
    expect(plugin.name).toBe('Telegram');
    expect(plugin.version).toBe('1.0.0');
  });

  it('has capabilities defined', () => {
    const plugin = new TelegramPlugin();
    expect(plugin.capabilities).toBeDefined();
    expect(plugin.capabilities.canSendText).toBe(true);
    expect(plugin.capabilities.canSendMedia).toBe(true);
    expect(plugin.capabilities.canSendReaction).toBe(true);
    expect(plugin.capabilities.canSendTyping).toBe(true);
  });

  it('supports reactions', () => {
    expect(TELEGRAM_CAPABILITIES.canSendReaction).toBe(true);
  });

  it('supports groups and DMs', () => {
    expect(TELEGRAM_CAPABILITIES.canHandleGroups).toBe(true);
    expect(TELEGRAM_CAPABILITIES.canHandleDMs).toBe(true);
  });

  it('has correct max message length', () => {
    expect(TELEGRAM_CAPABILITIES.maxMessageLength).toBe(4096);
  });
});

describe('Identity utils', () => {
  it('converts numeric user ID to string', () => {
    expect(toPlatformUserId(123456789)).toBe('123456789');
    expect(toPlatformUserId(0)).toBe('0');
  });

  it('builds display name from user object', () => {
    expect(
      buildDisplayName({
        id: 1,
        is_bot: false,
        first_name: 'John',
        last_name: 'Doe',
      }),
    ).toBe('John Doe');

    expect(
      buildDisplayName({
        id: 1,
        is_bot: false,
        first_name: 'Alice',
      }),
    ).toBe('Alice');

    expect(
      buildDisplayName({
        id: 1,
        is_bot: false,
        first_name: '',
        username: 'testuser',
      }),
    ).toBe('testuser');
  });

  it('detects private chats', () => {
    expect(isPrivateChat('private')).toBe(true);
    expect(isPrivateChat('group')).toBe(false);
    expect(isPrivateChat('supergroup')).toBe(false);
  });

  it('detects group chats', () => {
    expect(isGroupChat('group')).toBe(true);
    expect(isGroupChat('supergroup')).toBe(true);
    expect(isGroupChat('private')).toBe(false);
    expect(isGroupChat('channel')).toBe(false);
  });
});

describe('Formatting utils', () => {
  it('escapes MarkdownV2 special characters', () => {
    expect(escapeMarkdownV2('Hello *world*')).toBe('Hello \\*world\\*');
    expect(escapeMarkdownV2('Test [link](url)')).toBe('Test \\[link\\]\\(url\\)');
    expect(escapeMarkdownV2('_italic_')).toBe('\\_italic\\_');
  });

  it('truncates long messages', () => {
    const short = 'Hello';
    expect(truncateMessage(short)).toBe(short);

    const long = 'a'.repeat(5000);
    const truncated = truncateMessage(long);
    expect(truncated.length).toBeLessThanOrEqual(4096);
    expect(truncated.endsWith('...')).toBe(true);
  });

  it('splits long messages', () => {
    const short = 'Hello';
    expect(splitMessage(short)).toEqual(['Hello']);

    const long = 'word '.repeat(1000);
    const chunks = splitMessage(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });
});
