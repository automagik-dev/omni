/**
 * Tests for profile and contacts endpoints:
 * - GET /instances/:id/users/:userId/profile
 * - GET /instances/:id/contacts
 * - GET /instances/:id/groups
 *
 * @see api-completeness wish
 */

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { NotFoundError, OmniError } from '@omni/core';
import type { Database, Instance } from '@omni/db';
import { instances } from '@omni/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createServices } from '../services';
import type { AppVariables } from '../types';
import { describeWithDb, getTestDb } from './db-helper';

// Helper to create a mock plugin with configurable methods
function createMockPlugin(
  overrides: Partial<{
    fetchUserProfile: (instanceId: string, userId: string) => Promise<Record<string, unknown>>;
    fetchContacts: (
      instanceId: string,
      options: Record<string, unknown>,
    ) => Promise<{ totalFetched: number; contacts: unknown[] }>;
    fetchGroups: (
      instanceId: string,
      options: Record<string, unknown>,
    ) => Promise<{ totalFetched: number; groups: unknown[] }>;
  }> = {},
) {
  return {
    capabilities: {
      canSendText: true,
      canSendMedia: true,
      canSendReaction: true,
      canSendTyping: true,
      canReceiveReadReceipts: true,
      canReceiveDeliveryReceipts: true,
      canEditMessage: true,
      canDeleteMessage: true,
      canReplyToMessage: true,
      canForwardMessage: true,
      canSendContact: true,
      canSendLocation: true,
      canSendSticker: true,
      canHandleGroups: true,
      canHandleBroadcast: false,
      maxMessageLength: 65536,
      supportedMediaTypes: [],
      maxFileSize: 100 * 1024 * 1024,
    },
    fetchUserProfile: overrides.fetchUserProfile,
    fetchContacts: overrides.fetchContacts,
    fetchGroups: overrides.fetchGroups,
  };
}

// Helper to create a mock channel registry
function createMockChannelRegistry(plugin: ReturnType<typeof createMockPlugin> | null = null) {
  return {
    get: mock(() => plugin),
    getAll: mock(() => (plugin ? [plugin] : [])),
    has: mock(() => !!plugin),
  };
}

describeWithDb('Profile and Contacts Endpoints', () => {
  let db: Database;
  let whatsappInstance: Instance;
  let discordInstance: Instance;
  const insertedInstanceIds: string[] = [];

  beforeAll(async () => {
    db = getTestDb();

    // Create WhatsApp test instance
    const [waInstance] = await db
      .insert(instances)
      .values({
        name: `test-profiles-wa-${Date.now()}`,
        channel: 'whatsapp-baileys' as const,
      })
      .returning();
    if (!waInstance) {
      throw new Error('Failed to create WhatsApp test instance');
    }
    whatsappInstance = waInstance;
    insertedInstanceIds.push(waInstance.id);

    // Create Discord test instance
    const [discInstance] = await db
      .insert(instances)
      .values({
        name: `test-profiles-discord-${Date.now()}`,
        channel: 'discord' as const,
      })
      .returning();
    if (!discInstance) {
      throw new Error('Failed to create Discord test instance');
    }
    discordInstance = discInstance;
    insertedInstanceIds.push(discInstance.id);
  });

  afterAll(async () => {
    for (const id of insertedInstanceIds) {
      await db.delete(instances).where(eq(instances.id, id));
    }
  });

  function createTestApp(mockPlugin: ReturnType<typeof createMockPlugin> | null = createMockPlugin()) {
    const services = createServices(db, null);
    const mockRegistry = createMockChannelRegistry(mockPlugin);

    const app = new Hono<{ Variables: AppVariables }>();

    // Error handler
    app.onError((error, c) => {
      if (error instanceof NotFoundError) {
        return c.json({ error: { code: 'NOT_FOUND', message: error.message } }, 404);
      }
      if (error instanceof OmniError) {
        return c.json({ error: { code: error.code, message: error.message } }, 400);
      }
      return c.json({ error: { code: 'INTERNAL_ERROR', message: error.message } }, 500);
    });

    app.use('*', async (c, next) => {
      c.set('services', services);
      c.set('channelRegistry', mockRegistry as unknown as AppVariables['channelRegistry']);
      c.set('apiKey', { id: 'test-key', name: 'test', scopes: ['*'], instanceIds: null, expiresAt: null });
      await next();
    });

    // Import and mount routes
    const { instancesRoutes } = require('../routes/v2/instances');
    app.route('/instances', instancesRoutes);

    return { app, mockPlugin, mockRegistry };
  }

  describe('GET /instances/:id/users/:userId/profile', () => {
    test('successfully fetches user profile', async () => {
      const mockProfile = {
        displayName: 'John Doe',
        avatarUrl: 'https://example.com/avatar.jpg',
        bio: 'Hello, world!',
        phone: '+5511999999999',
        platformData: { verified: true },
      };

      const fetchUserProfileMock = mock(async () => mockProfile);
      const mockPlugin = createMockPlugin({ fetchUserProfile: fetchUserProfileMock });
      const { app } = createTestApp(mockPlugin);

      const res = await app.request(`/instances/${whatsappInstance.id}/users/+5511999999999@s.whatsapp.net/profile`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { platformUserId: string; displayName: string; avatarUrl: string; bio: string; phone: string };
      };
      expect(body.data.platformUserId).toBe('+5511999999999@s.whatsapp.net');
      expect(body.data.displayName).toBe('John Doe');
      expect(body.data.avatarUrl).toBe('https://example.com/avatar.jpg');
      expect(body.data.bio).toBe('Hello, world!');
      expect(body.data.phone).toBe('+5511999999999');
      expect(fetchUserProfileMock).toHaveBeenCalledTimes(1);
      expect(fetchUserProfileMock).toHaveBeenCalledWith(whatsappInstance.id, '+5511999999999@s.whatsapp.net');
    });

    test('returns error when plugin does not support profile fetching', async () => {
      // Plugin without fetchUserProfile method
      const mockPlugin = {
        capabilities: {
          canSendText: true,
          canSendMedia: true,
          canSendReaction: true,
          canSendTyping: true,
          canReceiveReadReceipts: true,
          canReceiveDeliveryReceipts: true,
          canEditMessage: true,
          canDeleteMessage: true,
          canReplyToMessage: true,
          canForwardMessage: true,
          canSendContact: true,
          canSendLocation: true,
          canSendSticker: true,
          canHandleGroups: true,
          canHandleBroadcast: false,
          maxMessageLength: 65536,
          supportedMediaTypes: [],
          maxFileSize: 100 * 1024 * 1024,
        },
        // fetchUserProfile is NOT defined
      };
      const { app } = createTestApp(mockPlugin as unknown as ReturnType<typeof createMockPlugin>);

      const res = await app.request(`/instances/${whatsappInstance.id}/users/test-user/profile`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_SUPPORTED');
      expect(body.error.message).toContain('does not support user profile fetching');
    });

    test('returns 404 for non-existent instance', async () => {
      const { app } = createTestApp();

      const res = await app.request('/instances/00000000-0000-0000-0000-000000000000/users/test-user/profile');

      expect(res.status).toBe(404);
    });

    test('handles profile fetch errors gracefully', async () => {
      const fetchUserProfileMock = mock(async () => {
        throw new Error('Network error');
      });
      const mockPlugin = createMockPlugin({ fetchUserProfile: fetchUserProfileMock });
      const { app } = createTestApp(mockPlugin);

      const res = await app.request(`/instances/${whatsappInstance.id}/users/test-user/profile`);

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('PROFILE_FETCH_FAILED');
      expect(body.error.message).toContain('Network error');
    });
  });

  describe('GET /instances/:id/contacts', () => {
    test('successfully fetches contacts list', async () => {
      const mockContacts = {
        totalFetched: 3,
        contacts: [
          { platformUserId: '5511999990001@s.whatsapp.net', name: 'Alice', isGroup: false },
          {
            platformUserId: '5511999990002@s.whatsapp.net',
            name: 'Bob',
            phone: '+5511999990002',
            isGroup: false,
            isBusiness: true,
          },
          { platformUserId: '5511999990003@s.whatsapp.net', name: 'Charlie', isGroup: false },
        ],
      };

      const fetchContactsMock = mock(async () => mockContacts);
      const mockPlugin = createMockPlugin({ fetchContacts: fetchContactsMock });
      const { app } = createTestApp(mockPlugin);

      const res = await app.request(`/instances/${whatsappInstance.id}/contacts?limit=50`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: Array<{ platformUserId: string; displayName: string; isBusiness?: boolean }>;
        meta: { totalFetched: number; hasMore: boolean };
      };
      expect(body.items).toHaveLength(3);
      expect(body.items[0]?.platformUserId).toBe('5511999990001@s.whatsapp.net');
      expect(body.items[0]?.displayName).toBe('Alice');
      expect(body.items[1]?.isBusiness).toBe(true);
      expect(body.meta.totalFetched).toBe(3);
      expect(body.meta.hasMore).toBe(false);
      expect(fetchContactsMock).toHaveBeenCalledTimes(1);
    });

    test('respects limit parameter', async () => {
      const mockContacts = {
        totalFetched: 100,
        contacts: Array.from({ length: 100 }, (_, i) => ({
          platformUserId: `user${i}@s.whatsapp.net`,
          name: `User ${i}`,
          isGroup: false,
        })),
      };

      const fetchContactsMock = mock(async () => mockContacts);
      const mockPlugin = createMockPlugin({ fetchContacts: fetchContactsMock });
      const { app } = createTestApp(mockPlugin);

      const res = await app.request(`/instances/${whatsappInstance.id}/contacts?limit=10`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[]; meta: { hasMore: boolean } };
      expect(body.items).toHaveLength(10);
      expect(body.meta.hasMore).toBe(true);
    });

    test('Discord requires guildId parameter', async () => {
      const fetchContactsMock = mock(async () => ({ totalFetched: 0, contacts: [] }));
      const mockPlugin = createMockPlugin({ fetchContacts: fetchContactsMock });
      const { app } = createTestApp(mockPlugin);

      // Without guildId
      const res = await app.request(`/instances/${discordInstance.id}/contacts`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain('guildId is required for Discord');
    });

    test('Discord with guildId succeeds', async () => {
      const mockContacts = {
        totalFetched: 2,
        contacts: [
          { platformUserId: '123456789', name: 'DiscordUser1', isGroup: false },
          { platformUserId: '987654321', name: 'DiscordUser2', isGroup: false },
        ],
      };

      const fetchContactsMock = mock(async () => mockContacts);
      const mockPlugin = createMockPlugin({ fetchContacts: fetchContactsMock });
      const { app } = createTestApp(mockPlugin);

      const res = await app.request(`/instances/${discordInstance.id}/contacts?guildId=111222333444555666`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(body.items).toHaveLength(2);
      expect(fetchContactsMock).toHaveBeenCalledWith(discordInstance.id, { guildId: '111222333444555666', limit: 100 });
    });

    test('returns error when plugin does not support contacts fetching', async () => {
      // Plugin without fetchContacts method
      const mockPlugin = {
        capabilities: {
          canSendText: true,
          canSendMedia: true,
          canSendReaction: true,
          canSendTyping: true,
          canReceiveReadReceipts: true,
          canReceiveDeliveryReceipts: true,
          canEditMessage: true,
          canDeleteMessage: true,
          canReplyToMessage: true,
          canForwardMessage: true,
          canSendContact: true,
          canSendLocation: true,
          canSendSticker: true,
          canHandleGroups: true,
          canHandleBroadcast: false,
          maxMessageLength: 65536,
          supportedMediaTypes: [],
          maxFileSize: 100 * 1024 * 1024,
        },
        // fetchContacts is NOT defined
      };
      const { app } = createTestApp(mockPlugin as unknown as ReturnType<typeof createMockPlugin>);

      const res = await app.request(`/instances/${whatsappInstance.id}/contacts`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_SUPPORTED');
      expect(body.error.message).toContain('does not support contacts fetching');
    });

    test('returns 404 for non-existent instance', async () => {
      const { app } = createTestApp();

      const res = await app.request('/instances/00000000-0000-0000-0000-000000000000/contacts');

      expect(res.status).toBe(404);
    });

    test('handles contacts fetch errors gracefully', async () => {
      const fetchContactsMock = mock(async () => {
        throw new Error('Rate limited');
      });
      const mockPlugin = createMockPlugin({ fetchContacts: fetchContactsMock });
      const { app } = createTestApp(mockPlugin);

      const res = await app.request(`/instances/${whatsappInstance.id}/contacts`);

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('CONTACTS_FETCH_FAILED');
      expect(body.error.message).toContain('Rate limited');
    });
  });

  describe('GET /instances/:id/groups', () => {
    test('successfully fetches groups list', async () => {
      const mockGroups = {
        totalFetched: 2,
        groups: [
          {
            externalId: 'group1@g.us',
            name: 'Family Group',
            description: 'Our family chat',
            memberCount: 5,
            createdAt: new Date('2024-01-01'),
            isReadOnly: false,
          },
          {
            externalId: 'group2@g.us',
            name: 'Work Team',
            memberCount: 20,
            isReadOnly: false,
          },
        ],
      };

      const fetchGroupsMock = mock(async () => mockGroups);
      const mockPlugin = createMockPlugin({ fetchGroups: fetchGroupsMock });
      const { app } = createTestApp(mockPlugin);

      const res = await app.request(`/instances/${whatsappInstance.id}/groups`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: Array<{ externalId: string; name: string; memberCount: number }>;
        meta: { totalFetched: number; hasMore: boolean };
      };
      expect(body.items).toHaveLength(2);
      expect(body.items[0]?.externalId).toBe('group1@g.us');
      expect(body.items[0]?.name).toBe('Family Group');
      expect(body.items[0]?.memberCount).toBe(5);
      expect(body.items[1]?.name).toBe('Work Team');
      expect(body.meta.totalFetched).toBe(2);
      expect(body.meta.hasMore).toBe(false);
      expect(fetchGroupsMock).toHaveBeenCalledTimes(1);
    });

    test('respects limit parameter', async () => {
      const mockGroups = {
        totalFetched: 50,
        groups: Array.from({ length: 50 }, (_, i) => ({
          externalId: `group${i}@g.us`,
          name: `Group ${i}`,
        })),
      };

      const fetchGroupsMock = mock(async () => mockGroups);
      const mockPlugin = createMockPlugin({ fetchGroups: fetchGroupsMock });
      const { app } = createTestApp(mockPlugin);

      const res = await app.request(`/instances/${whatsappInstance.id}/groups?limit=10`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[]; meta: { hasMore: boolean } };
      expect(body.items).toHaveLength(10);
      expect(body.meta.hasMore).toBe(true);
    });

    test('returns error when plugin does not support groups fetching', async () => {
      // Plugin without fetchGroups method
      const mockPlugin = {
        capabilities: {
          canSendText: true,
          canSendMedia: true,
          canSendReaction: true,
          canSendTyping: true,
          canReceiveReadReceipts: true,
          canReceiveDeliveryReceipts: true,
          canEditMessage: true,
          canDeleteMessage: true,
          canReplyToMessage: true,
          canForwardMessage: true,
          canSendContact: true,
          canSendLocation: true,
          canSendSticker: true,
          canHandleGroups: true,
          canHandleBroadcast: false,
          maxMessageLength: 65536,
          supportedMediaTypes: [],
          maxFileSize: 100 * 1024 * 1024,
        },
        // fetchGroups is NOT defined
      };
      const { app } = createTestApp(mockPlugin as unknown as ReturnType<typeof createMockPlugin>);

      const res = await app.request(`/instances/${whatsappInstance.id}/groups`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_SUPPORTED');
      expect(body.error.message).toContain('does not support groups fetching');
    });

    test('returns 404 for non-existent instance', async () => {
      const { app } = createTestApp();

      const res = await app.request('/instances/00000000-0000-0000-0000-000000000000/groups');

      expect(res.status).toBe(404);
    });

    test('handles groups fetch errors gracefully', async () => {
      const fetchGroupsMock = mock(async () => {
        throw new Error('Connection timeout');
      });
      const mockPlugin = createMockPlugin({ fetchGroups: fetchGroupsMock });
      const { app } = createTestApp(mockPlugin);

      const res = await app.request(`/instances/${whatsappInstance.id}/groups`);

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe('GROUPS_FETCH_FAILED');
      expect(body.error.message).toContain('Connection timeout');
    });
  });
});
