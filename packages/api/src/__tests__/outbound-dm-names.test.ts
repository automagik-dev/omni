/**
 * Tests for outbound DM chat name resolution (#144)
 *
 * Verifies that outbound DM chats get a contact name (not null) when available,
 * while preserving inbound DM and group chat name behavior.
 *
 * @see whatsapp-sync-reliability wish, Group 3
 */

import { describe, expect, mock, test } from 'bun:test';
import { applyChatName, resolveEffectiveChatName } from '../plugins/message-persistence';
import type { Services } from '../services';

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

  // --- History sync: the owner's own pushName (the 36 "Felipe Rosa" DMs) ---
  // The plugin's history emit is the raw WAMessage with no top-level isFromMe;
  // direction lives only in key.fromMe. Persistence passes isFromMe=false.

  const OWNER_PUSH_NAME = 'Owner Name';

  function historyPayload(remoteJid: string, fromMe: boolean): Record<string, unknown> {
    return { key: { remoteJid, fromMe, id: 'HIST1' }, pushName: OWNER_PUSH_NAME, messageTimestamp: 1761700000 };
  }

  test('history message we sent never names a phone DM after the owner', () => {
    const result = resolveEffectiveChatName({
      chatType: 'dm',
      isFromMe: false,
      chatName: undefined,
      pushName: OWNER_PUSH_NAME,
      rawPayload: historyPayload('5511900006521@s.whatsapp.net', true),
    });
    expect(result).toBeUndefined();
  });

  test('history message we sent never names a @lid DM after the owner', () => {
    const result = resolveEffectiveChatName({
      chatType: 'dm',
      isFromMe: false,
      chatName: undefined,
      pushName: OWNER_PUSH_NAME,
      rawPayload: historyPayload('100000007669@lid', true),
    });
    expect(result).toBeUndefined();
  });

  test('history message we sent still takes the chat name WhatsApp gave', () => {
    const result = resolveEffectiveChatName({
      chatType: 'dm',
      isFromMe: false,
      chatName: 'Bob Contact',
      pushName: OWNER_PUSH_NAME,
      rawPayload: historyPayload('5511900006521@s.whatsapp.net', true),
    });
    expect(result).toBe('Bob Contact');
  });

  test('history message from the contact still uses their pushName', () => {
    const result = resolveEffectiveChatName({
      chatType: 'dm',
      isFromMe: false,
      chatName: undefined,
      pushName: 'Bob',
      rawPayload: { ...historyPayload('5511900006521@s.whatsapp.net', false), pushName: 'Bob' },
    });
    expect(result).toBe('Bob');
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

describe('applyChatName — a DM is never named after the account itself', () => {
  function makeServices() {
    const update = mock(async (_id: string, _data: Record<string, unknown>) => ({}));
    const services = {
      instances: { getById: mock(async () => ({ id: 'inst-1', profileName: 'Owner Name' })) },
      chats: { update },
    } as unknown as Services;
    return { services, update };
  }

  test('existing DM: the owner name (e.g. an owner verifiedBizName) is not written', async () => {
    const { services, update } = makeServices();
    const chat = { id: 'c1', name: 'Bob' as string | null };

    await applyChatName(services, chat, false, 'inst-1', 'dm', 'Owner Name');

    expect(update).not.toHaveBeenCalled();
    expect(chat.name).toBe('Bob');
  });

  test('DM just created with the owner name is cleared', async () => {
    const { services, update } = makeServices();
    const chat = { id: 'c2', name: 'Owner Name' as string | null };

    await applyChatName(services, chat, true, 'inst-1', 'dm', 'Owner Name');

    expect(update).toHaveBeenCalledWith('c2', { name: null });
    expect(chat.name).toBeNull();
  });

  test('a contact name is still written', async () => {
    const { services, update } = makeServices();
    const chat = { id: 'c3', name: null as string | null };

    await applyChatName(services, chat, false, 'inst-1', 'dm', 'Bob');

    expect(update).toHaveBeenCalledWith('c3', { name: 'Bob' });
  });
});
