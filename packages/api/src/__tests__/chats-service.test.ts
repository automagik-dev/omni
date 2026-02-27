/**
 * Tests for ChatService - focus on smart lookup logic
 * Regression tests for media processor chat lookup bug
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Database } from '@omni/db';
import type { Chat } from '@omni/db';
import { ChatService } from '../services/chats';

// Helper to create a mock chat with all required fields
function createMockChat(overrides: Partial<Chat>): Chat {
  return {
    id: 'chat-uuid',
    instanceId: 'test-instance',
    externalId: '553496835777@s.whatsapp.net',
    canonicalId: null,
    chatType: 'dm',
    channel: 'whatsapp-baileys',
    name: null,
    description: null,
    avatarUrl: null,
    parentChatId: null,
    participantCount: 0,
    messageCount: 0,
    unreadCount: 0,
    lastMessageAt: null,
    lastMessagePreview: null,
    settings: null,
    platformMetadata: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

// Mock database queries
const mockSelect = mock(() => ({
  from: mock(() => ({
    where: mock(() => ({
      limit: mock(() => []),
    })),
  })),
}));

const mockInsert = mock(() => ({
  values: mock(() => ({
    returning: mock(() => []),
  })),
}));

const mockDb = {
  select: mockSelect,
  insert: mockInsert,
} as unknown as Database;

const mockEventBus = null;

describe('ChatService.findByExternalIdSmart', () => {
  let service: ChatService;

  beforeEach(() => {
    service = new ChatService(mockDb, mockEventBus);
    mockSelect.mockClear();
  });

  afterEach(() => {
    mock.restore();
  });

  test('should find chat by exact external_id match (primary lookup)', async () => {
    const instanceId = 'test-instance';
    const externalId = '553496835777@s.whatsapp.net';

    const mockChat = createMockChat({ instanceId, externalId });

    // Mock the primary lookup to return a chat
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => [mockChat]),
        })),
      })),
    });

    const result = await service.findByExternalIdSmart(instanceId, externalId);

    expect(result).toEqual(mockChat);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  test('should find chat by canonical_id when external_id does not match', async () => {
    const instanceId = 'test-instance';
    const phoneJid = '553496835777@s.whatsapp.net';
    const lidJid = '63750317031625@lid';

    const mockChat = createMockChat({
      instanceId,
      externalId: lidJid, // Chat was created with LID
      canonicalId: phoneJid, // But canonical is phone JID
    });

    // First lookup (exact external_id) returns nothing
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => []),
        })),
      })),
    });

    // Second lookup (canonical_id) returns the chat
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => [mockChat]),
        })),
      })),
    });

    const result = await service.findByExternalIdSmart(instanceId, phoneJid);

    expect(result).toEqual(mockChat);
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  test('should find LID chat when phone JID is provided via chatIdMappings', async () => {
    const instanceId = 'test-instance';
    const phoneJid = '553496835777@s.whatsapp.net';
    const lidJid = '63750317031625@lid';

    const mockMapping = {
      instanceId,
      lidId: lidJid,
      phoneId: phoneJid,
    };

    const mockChat = createMockChat({
      instanceId,
      externalId: lidJid,
      canonicalId: phoneJid,
    });

    // First lookup (exact external_id) returns nothing
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => []),
        })),
      })),
    });

    // Second lookup (canonical_id) returns nothing
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => []),
        })),
      })),
    });

    // Third lookup (chatIdMappings for phone JID) returns mapping
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => [mockMapping]),
        })),
      })),
    });

    // Fourth lookup (getByExternalId with LID from mapping) returns chat
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => [mockChat]),
        })),
      })),
    });

    const result = await service.findByExternalIdSmart(instanceId, phoneJid);

    expect(result).toEqual(mockChat);
    expect(mockSelect).toHaveBeenCalledTimes(4);
  });

  test('should find phone chat when LID is provided via chatIdMappings', async () => {
    const instanceId = 'test-instance';
    const phoneJid = '553496835777@s.whatsapp.net';
    const lidJid = '63750317031625@lid';

    const mockMapping = {
      instanceId,
      lidId: lidJid,
      phoneId: phoneJid,
    };

    const mockChat = createMockChat({
      instanceId,
      externalId: phoneJid,
      canonicalId: phoneJid,
    });

    // First lookup (exact external_id) returns nothing
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => []),
        })),
      })),
    });

    // Second lookup (canonical_id) returns nothing
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => []),
        })),
      })),
    });

    // Third lookup (chatIdMappings for LID) returns mapping
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => [mockMapping]),
        })),
      })),
    });

    // Fourth lookup (getByExternalId with phone from mapping) returns chat
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => [mockChat]),
        })),
      })),
    });

    const result = await service.findByExternalIdSmart(instanceId, lidJid);

    expect(result).toEqual(mockChat);
    expect(mockSelect).toHaveBeenCalledTimes(4);
  });

  test('should return null when chat is not found anywhere', async () => {
    const instanceId = 'test-instance';
    const externalId = 'nonexistent@s.whatsapp.net';

    // All lookups return empty
    mockSelect.mockReturnValue({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => []),
        })),
      })),
    });

    const result = await service.findByExternalIdSmart(instanceId, externalId);

    expect(result).toBeNull();
    // Should try: primary, canonical, chatIdMappings
    expect(mockSelect).toHaveBeenCalledTimes(3);
  });

  test('should handle non-WhatsApp external IDs gracefully', async () => {
    const instanceId = 'test-instance';
    const discordChannelId = '1234567890';

    // First lookup returns nothing
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => []),
        })),
      })),
    });

    // Second lookup returns nothing
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => []),
        })),
      })),
    });

    const result = await service.findByExternalIdSmart(instanceId, discordChannelId);

    expect(result).toBeNull();
    // Should only try primary and canonical (no LID logic for non-WhatsApp)
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });
});

describe('ChatService regression tests', () => {
  let service: ChatService;

  beforeEach(() => {
    service = new ChatService(mockDb, mockEventBus);
    mockSelect.mockClear();
  });

  test('regression: media processor should find LID chat when phone JID message arrives', async () => {
    // This is the exact bug scenario that was fixed:
    // 1. Chat created with LID (external_id = "63750317031625@lid")
    // 2. Canonical ID set to phone (canonical_id = "553496835777@s.whatsapp.net")
    // 3. Audio message arrives with phone JID (chatId = "553496835777@s.whatsapp.net")
    // 4. Media processor must find the chat

    const instanceId = 'e41f26ef-538a-4eaa-b5ad-dbce3d22c821';
    const phoneJid = '553496835777@s.whatsapp.net';
    const lidJid = '63750317031625@lid';

    const mockChat = createMockChat({
      id: '545f8ecb-f485-4283-88f1-a4bec20f66be',
      instanceId,
      externalId: lidJid,
      canonicalId: phoneJid,
    });

    // Exact match fails
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => []),
        })),
      })),
    });

    // Canonical match succeeds
    mockSelect.mockReturnValueOnce({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => [mockChat]),
        })),
      })),
    });

    const result = await service.findByExternalIdSmart(instanceId, phoneJid);

    expect(result).not.toBeNull();
    expect(result?.id).toBe('545f8ecb-f485-4283-88f1-a4bec20f66be');
    expect(result?.externalId).toBe(lidJid);
    expect(result?.canonicalId).toBe(phoneJid);
  });
});
