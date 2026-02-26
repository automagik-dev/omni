/**
 * Tests for outbound DM chat name resolution (#144)
 *
 * Verifies that outbound DM chats get a contact name (not null) when available,
 * while preserving inbound DM and group chat name behavior.
 *
 * @see whatsapp-sync-reliability wish, Group 3
 */

import { describe, expect, test } from 'bun:test';
import { resolveEffectiveChatName } from '../plugins/message-persistence';

describe('resolveEffectiveChatName', () => {
  // --- Inbound DM (no regression) ---

  test('inbound DM uses pushName when chatName is absent', () => {
    const result = resolveEffectiveChatName({
      chatType: 'dm',
      isFromMe: false,
      chatName: undefined,
      pushName: 'Alice',
      rawPayload: undefined,
    });
    expect(result).toBe('Alice');
  });

  test('inbound DM prefers chatName over pushName', () => {
    const result = resolveEffectiveChatName({
      chatType: 'dm',
      isFromMe: false,
      chatName: 'Saved Name',
      pushName: 'Alice',
      rawPayload: undefined,
    });
    expect(result).toBe('Saved Name');
  });

  // --- Outbound DM (the fix) ---

  test('outbound DM uses chatName when available', () => {
    const result = resolveEffectiveChatName({
      chatType: 'dm',
      isFromMe: true,
      chatName: 'Bob Contact',
      pushName: undefined,
      rawPayload: undefined,
    });
    expect(result).toBe('Bob Contact');
  });

  test('outbound DM falls back to recipientName from rawPayload', () => {
    const result = resolveEffectiveChatName({
      chatType: 'dm',
      isFromMe: true,
      chatName: undefined,
      pushName: undefined,
      rawPayload: { recipientName: 'Bob from Contacts' },
    });
    expect(result).toBe('Bob from Contacts');
  });

  test('outbound DM falls back to verifiedBizName from rawPayload', () => {
    const result = resolveEffectiveChatName({
      chatType: 'dm',
      isFromMe: true,
      chatName: undefined,
      pushName: undefined,
      rawPayload: { verifiedBizName: 'Bob Corp' },
    });
    expect(result).toBe('Bob Corp');
  });

  test('outbound DM returns undefined when no name sources available', () => {
    const result = resolveEffectiveChatName({
      chatType: 'dm',
      isFromMe: true,
      chatName: undefined,
      pushName: undefined,
      rawPayload: undefined,
    });
    expect(result).toBeUndefined();
  });

  test('outbound DM prefers chatName over recipientName', () => {
    const result = resolveEffectiveChatName({
      chatType: 'dm',
      isFromMe: true,
      chatName: 'Explicit Name',
      pushName: undefined,
      rawPayload: { recipientName: 'Fallback Name' },
    });
    expect(result).toBe('Explicit Name');
  });

  test('outbound DM prefers recipientName over verifiedBizName', () => {
    const result = resolveEffectiveChatName({
      chatType: 'dm',
      isFromMe: true,
      chatName: undefined,
      pushName: undefined,
      rawPayload: { recipientName: 'Person Name', verifiedBizName: 'Biz Name' },
    });
    expect(result).toBe('Person Name');
  });

  // --- Group chats (no regression) ---

  test('group chat uses chatName', () => {
    const result = resolveEffectiveChatName({
      chatType: 'group',
      isFromMe: false,
      chatName: 'Family Group',
      pushName: 'Alice',
      rawPayload: undefined,
    });
    expect(result).toBe('Family Group');
  });

  test('group chat returns undefined when chatName is absent (does NOT use pushName)', () => {
    const result = resolveEffectiveChatName({
      chatType: 'group',
      isFromMe: false,
      chatName: undefined,
      pushName: 'Alice',
      rawPayload: undefined,
    });
    expect(result).toBeUndefined();
  });

  test('group chat sent by us uses chatName', () => {
    const result = resolveEffectiveChatName({
      chatType: 'group',
      isFromMe: true,
      chatName: 'Work Group',
      pushName: undefined,
      rawPayload: undefined,
    });
    expect(result).toBe('Work Group');
  });

  // --- Channel type (no regression) ---

  test('channel type uses chatName', () => {
    const result = resolveEffectiveChatName({
      chatType: 'channel',
      isFromMe: false,
      chatName: 'News Channel',
      pushName: 'Bot',
      rawPayload: undefined,
    });
    expect(result).toBe('News Channel');
  });
});
