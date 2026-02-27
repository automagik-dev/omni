/**
 * Integration tests for PersonService
 *
 * Tests the actual service implementation with mocked database.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Database, PlatformIdentity } from '@omni/db';
import { PersonService } from '../persons';

// Helper to create a mock platform identity
function createMockIdentity(overrides: Partial<PlatformIdentity> = {}): PlatformIdentity {
  return {
    id: 'identity-123',
    personId: 'person-123',
    channel: 'whatsapp-baileys',
    instanceId: 'instance-123',
    platformUserId: '+5511999001234@s.whatsapp.net',
    platformUsername: 'Test User',
    profilePicUrl: null,
    profileData: null,
    messageCount: 10,
    lastSeenAt: new Date('2026-01-15T10:00:00Z'),
    firstSeenAt: new Date('2026-01-01T10:00:00Z'),
    linkedBy: 'auto',
    confidence: 100,
    linkReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Create mock database with proper Drizzle-like interface
function createMockDatabase() {
  const db = {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.resolve([])),
          orderBy: mock(() => ({
            limit: mock(() => Promise.resolve([])),
          })),
        })),
        orderBy: mock(() => ({
          limit: mock(() => Promise.resolve([])),
        })),
        limit: mock(() => Promise.resolve([])),
      })),
    })),
    insert: mock(() => ({
      values: mock(() => ({
        returning: mock(() => Promise.resolve([])),
      })),
    })),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([])),
        })),
      })),
    })),
    delete: mock(() => ({
      where: mock(() => Promise.resolve()),
    })),
  };

  return db as unknown as Database;
}

// Create mock event bus
function createMockEventBus() {
  return {
    publish: mock(async () => ({})),
  } as unknown as EventBus;
}

describe('PersonService', () => {
  let service: PersonService;
  let mockDb: ReturnType<typeof createMockDatabase>;
  let mockEventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    mockDb = createMockDatabase();
    mockEventBus = createMockEventBus();
    service = new PersonService(mockDb as unknown as Database, mockEventBus);
  });

  describe('getIdentityForChannel()', () => {
    test('returns identity when person has single identity on channel', async () => {
      const identity = createMockIdentity({
        id: 'id-1',
        personId: 'person-123',
        channel: 'whatsapp-baileys',
        platformUserId: '+5511999001234@s.whatsapp.net',
      });

      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => Promise.resolve([identity])),
        })),
      })) as unknown as typeof mockDb.select;

      const result = await service.getIdentityForChannel('person-123', 'whatsapp-baileys');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('id-1');
      expect(result?.platformUserId).toBe('+5511999001234@s.whatsapp.net');
    });

    test('returns most recently active identity when person has multiple identities on channel', async () => {
      const olderIdentity = createMockIdentity({
        id: 'id-old',
        personId: 'person-123',
        channel: 'whatsapp-baileys',
        platformUserId: '+5511999001111@s.whatsapp.net',
        lastSeenAt: new Date('2026-01-10T10:00:00Z'),
        messageCount: 5,
      });

      const newerIdentity = createMockIdentity({
        id: 'id-new',
        personId: 'person-123',
        channel: 'whatsapp-baileys',
        platformUserId: '+5511999002222@s.whatsapp.net',
        lastSeenAt: new Date('2026-01-20T10:00:00Z'),
        messageCount: 15,
      });

      // Return identities in non-sorted order to verify sorting works
      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => Promise.resolve([olderIdentity, newerIdentity])),
        })),
      })) as unknown as typeof mockDb.select;

      const result = await service.getIdentityForChannel('person-123', 'whatsapp-baileys');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('id-new');
      expect(result?.platformUserId).toBe('+5511999002222@s.whatsapp.net');
    });

    test('uses messageCount as tiebreaker when lastSeenAt is equal', async () => {
      const sameTime = new Date('2026-01-15T10:00:00Z');

      const lowMessageIdentity = createMockIdentity({
        id: 'id-low',
        personId: 'person-123',
        channel: 'whatsapp-baileys',
        platformUserId: '+5511999001111@s.whatsapp.net',
        lastSeenAt: sameTime,
        messageCount: 5,
      });

      const highMessageIdentity = createMockIdentity({
        id: 'id-high',
        personId: 'person-123',
        channel: 'whatsapp-baileys',
        platformUserId: '+5511999002222@s.whatsapp.net',
        lastSeenAt: sameTime,
        messageCount: 50,
      });

      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => Promise.resolve([lowMessageIdentity, highMessageIdentity])),
        })),
      })) as unknown as typeof mockDb.select;

      const result = await service.getIdentityForChannel('person-123', 'whatsapp-baileys');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('id-high');
      expect(result?.messageCount).toBe(50);
    });

    test('returns null when person has no identity on channel', async () => {
      // Person has Discord identity but we're looking for WhatsApp
      const discordIdentity = createMockIdentity({
        id: 'id-discord',
        personId: 'person-123',
        channel: 'discord',
        platformUserId: '123456789012345678',
      });

      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => Promise.resolve([discordIdentity])),
        })),
      })) as unknown as typeof mockDb.select;

      const result = await service.getIdentityForChannel('person-123', 'whatsapp-baileys');

      expect(result).toBeNull();
    });

    test('returns null when person has no identities at all', async () => {
      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => Promise.resolve([])),
        })),
      })) as unknown as typeof mockDb.select;

      const result = await service.getIdentityForChannel('person-123', 'whatsapp-baileys');

      expect(result).toBeNull();
    });

    test('handles identities with null lastSeenAt correctly', async () => {
      const nullLastSeenIdentity = createMockIdentity({
        id: 'id-null',
        personId: 'person-123',
        channel: 'whatsapp-baileys',
        platformUserId: '+5511999001111@s.whatsapp.net',
        lastSeenAt: null,
        messageCount: 100,
      });

      const recentIdentity = createMockIdentity({
        id: 'id-recent',
        personId: 'person-123',
        channel: 'whatsapp-baileys',
        platformUserId: '+5511999002222@s.whatsapp.net',
        lastSeenAt: new Date('2026-01-20T10:00:00Z'),
        messageCount: 5,
      });

      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => Promise.resolve([nullLastSeenIdentity, recentIdentity])),
        })),
      })) as unknown as typeof mockDb.select;

      const result = await service.getIdentityForChannel('person-123', 'whatsapp-baileys');

      // Recent identity should win because null lastSeenAt is treated as 0
      expect(result).not.toBeNull();
      expect(result?.id).toBe('id-recent');
    });

    test('filters correctly when person has identities across multiple channels', async () => {
      const whatsappIdentity = createMockIdentity({
        id: 'id-wa',
        personId: 'person-123',
        channel: 'whatsapp-baileys',
        platformUserId: '+5511999001234@s.whatsapp.net',
      });

      const discordIdentity = createMockIdentity({
        id: 'id-discord',
        personId: 'person-123',
        channel: 'discord',
        platformUserId: '123456789012345678',
      });

      const telegramIdentity = createMockIdentity({
        id: 'id-telegram',
        personId: 'person-123',
        channel: 'telegram',
        platformUserId: '987654321',
      });

      mockDb.select = mock(() => ({
        from: mock(() => ({
          where: mock(() => Promise.resolve([whatsappIdentity, discordIdentity, telegramIdentity])),
        })),
      })) as unknown as typeof mockDb.select;

      // Request Discord identity
      const result = await service.getIdentityForChannel('person-123', 'discord');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('id-discord');
      expect(result?.channel).toBe('discord');
      expect(result?.platformUserId).toBe('123456789012345678');
    });
  });
});

describe('resolveRecipient integration', () => {
  // These tests verify the UUID detection and resolution logic
  // that is used in the send routes

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function isUUID(value: string): boolean {
    return UUID_REGEX.test(value);
  }

  test('correctly identifies valid UUIDs', () => {
    expect(isUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    expect(isUUID('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
  });

  test('correctly identifies non-UUIDs (platform IDs)', () => {
    // WhatsApp phone numbers
    expect(isUUID('+5511999001234@s.whatsapp.net')).toBe(false);
    expect(isUUID('5511999001234@s.whatsapp.net')).toBe(false);

    // Discord user IDs (snowflakes)
    expect(isUUID('123456789012345678')).toBe(false);
    expect(isUUID('987654321098765432')).toBe(false);

    // Telegram user IDs
    expect(isUUID('123456789')).toBe(false);

    // Plain phone numbers
    expect(isUUID('+5511999001234')).toBe(false);

    // Email addresses
    expect(isUUID('user@example.com')).toBe(false);
  });

  test('handles edge cases correctly', () => {
    // Empty string
    expect(isUUID('')).toBe(false);

    // UUID-like but invalid
    expect(isUUID('550e8400-e29b-41d4-a716')).toBe(false); // Too short
    expect(isUUID('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false); // Too long
    expect(isUUID('550e8400-e29b-61d4-a716-446655440000')).toBe(false); // Invalid version (6)
    expect(isUUID('550e8400-e29b-41d4-c716-446655440000')).toBe(false); // Invalid variant (c)
  });
});
