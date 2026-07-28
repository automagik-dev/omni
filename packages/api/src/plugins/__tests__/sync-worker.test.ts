/**
 * Sync Worker Plugin Tests
 *
 * Tests for setupSyncWorker integration behavior:
 * - EventBus subscription with correct options
 * - Job lifecycle: start -> process -> complete/fail
 * - Sync type routing: messages, profile, contacts, groups, all, history-push
 * - Error handling: unknown types, missing instances, missing plugins
 * - parseSyncDepth and getRateLimiter tested indirectly through sync flow
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import { setupSyncWorker } from '../sync-worker';

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

function createMockEventBus() {
  let subscribeCallback: ((event: any) => Promise<void>) | null = null;
  return {
    subscribe: mock(async (eventType: string, callback: any) => {
      if (eventType === 'sync.started') subscribeCallback = callback;
      return { unsubscribe: mock(async () => {}) };
    }),
    subscribePattern: mock(async () => ({ unsubscribe: mock(async () => {}) })),
    publish: mock(async () => ({ id: 'evt-1' })),
    close: mock(async () => {}),
    /** Helper: invoke the captured sync.started subscriber */
    _triggerSync: async (payload: any) => {
      if (!subscribeCallback) throw new Error('No subscriber registered');
      await subscribeCallback({ payload, metadata: {} });
    },
  } as any;
}

function createMockServices() {
  return {
    syncJobs: {
      start: mock(async () => {}),
      complete: mock(async () => {}),
      fail: mock(async (_id: string, _error: string) => {}),
      updateProgress: mock(async () => {}),
      create: mock(async () => ({ id: 'job-1' })),
      getActiveForInstance: mock(async () => []),
    },
    instances: {
      getById: mock(async () => ({
        id: 'inst-1',
        channel: 'whatsapp-baileys',
      })),
    },
    chats: {
      findOrCreate: mock(async () => ({ chat: { id: 'chat-1' }, created: false })),
      getAllExternalIds: mock(async () => []),
      findByExternalIdSmart: mock(async () => null),
      update: mock(async () => ({})),
    },
    messages: {
      getByExternalId: mock(async () => null),
      create: mock(async () => ({})),
    },
    persons: {
      findOrCreateIdentity: mock(async () => ({ isNew: false, wasLinked: false })),
    },
  };
}

function createMockChannelRegistry() {
  return {
    get: mock(() => ({
      fetchHistory: mock(async () => {}),
      fetchContacts: mock(async () => {}),
      fetchGroups: mock(async () => {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('setupSyncWorker', () => {
  let eventBus: ReturnType<typeof createMockEventBus>;
  let services: ReturnType<typeof createMockServices>;
  let registry: ReturnType<typeof createMockChannelRegistry>;

  beforeEach(() => {
    eventBus = createMockEventBus();
    services = createMockServices();
    registry = createMockChannelRegistry();
  });

  // -- Subscription wiring --------------------------------------------------

  test('subscribes to sync.started with correct durable options', async () => {
    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any);

    expect(eventBus.subscribe).toHaveBeenCalledTimes(1);
    const [eventType, _cb, opts] = eventBus.subscribe.mock.calls[0];
    expect(eventType).toBe('sync.started');
    expect(opts).toEqual({
      durable: 'sync-worker',
      queue: 'sync-workers',
      startFrom: 'new',
    });
  });

  // -- Job lifecycle ---------------------------------------------------------

  test('calls syncJobs.start when a sync event is received', async () => {
    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any);
    await eventBus._triggerSync({
      jobId: 'job-1',
      instanceId: 'inst-1',
      type: 'profile',
      config: {},
    });

    expect(services.syncJobs.start).toHaveBeenCalledWith('job-1', null);
  });

  // -- Type routing ----------------------------------------------------------

  test('profile type completes immediately without calling plugin', async () => {
    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any);
    await eventBus._triggerSync({
      jobId: 'job-p',
      instanceId: 'inst-1',
      type: 'profile',
      config: {},
    });

    expect(services.syncJobs.start).toHaveBeenCalledWith('job-p', null);
    expect(services.syncJobs.complete).toHaveBeenCalledWith('job-p', null);
    // Plugin should never be looked up for profile sync
    expect(registry.get).not.toHaveBeenCalled();
  });

  test('messages type calls plugin.fetchHistory via channelRegistry', async () => {
    const mockPlugin = {
      fetchHistory: mock(async () => {}),
      fetchContacts: mock(async () => {}),
      fetchGroups: mock(async () => {}),
    };
    registry.get.mockReturnValue(mockPlugin);

    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any);
    await eventBus._triggerSync({
      jobId: 'job-m',
      instanceId: 'inst-1',
      type: 'messages',
      config: {},
    });

    expect(registry.get).toHaveBeenCalledWith('whatsapp-baileys');
    expect(mockPlugin.fetchHistory).toHaveBeenCalledTimes(1);
    // First argument is the instanceId
    const histCalls = mockPlugin.fetchHistory.mock.calls as unknown[][];
    expect(histCalls[0]?.[0]).toBe('inst-1');
    expect(services.syncJobs.complete).toHaveBeenCalledWith('job-m', null);
  });

  test('contacts type calls plugin.fetchContacts', async () => {
    const mockPlugin = {
      fetchHistory: mock(async () => {}),
      fetchContacts: mock(async () => {}),
      fetchGroups: mock(async () => {}),
    };
    registry.get.mockReturnValue(mockPlugin);

    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any);
    await eventBus._triggerSync({
      jobId: 'job-c',
      instanceId: 'inst-1',
      type: 'contacts',
      config: {},
    });

    expect(registry.get).toHaveBeenCalledWith('whatsapp-baileys');
    expect(mockPlugin.fetchContacts).toHaveBeenCalledTimes(1);
    const contactCalls = mockPlugin.fetchContacts.mock.calls as unknown[][];
    expect(contactCalls[0]?.[0]).toBe('inst-1');
    expect(services.syncJobs.complete).toHaveBeenCalledWith('job-c', null);
  });

  test('groups type calls plugin.fetchGroups', async () => {
    const mockPlugin = {
      fetchHistory: mock(async () => {}),
      fetchContacts: mock(async () => {}),
      fetchGroups: mock(async () => {}),
    };
    registry.get.mockReturnValue(mockPlugin);

    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any, {} as any);
    await eventBus._triggerSync({
      jobId: 'job-g',
      instanceId: 'inst-1',
      type: 'groups',
      config: {},
    });

    expect(registry.get).toHaveBeenCalledWith('whatsapp-baileys');
    expect(mockPlugin.fetchGroups).toHaveBeenCalledTimes(1);
    expect(services.syncJobs.complete).toHaveBeenCalledWith('job-g', null);
  });

  test('all type calls plugin.fetchHistory (processes message sync)', async () => {
    const mockPlugin = {
      fetchHistory: mock(async () => {}),
      fetchContacts: mock(async () => {}),
      fetchGroups: mock(async () => {}),
    };
    registry.get.mockReturnValue(mockPlugin);

    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any);
    await eventBus._triggerSync({
      jobId: 'job-a',
      instanceId: 'inst-1',
      type: 'all',
      config: {},
    });

    expect(mockPlugin.fetchHistory).toHaveBeenCalledTimes(1);
    expect(services.syncJobs.complete).toHaveBeenCalledWith('job-a', null);
  });

  test('history-push type is a no-op after start', async () => {
    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any);
    await eventBus._triggerSync({
      jobId: 'job-hp',
      instanceId: 'inst-1',
      type: 'history-push',
      config: {},
    });

    expect(services.syncJobs.start).toHaveBeenCalledWith('job-hp', null);
    // Should NOT call complete or fail — progress is driven by tracker subscribers
    expect(services.syncJobs.complete).not.toHaveBeenCalled();
    expect(services.syncJobs.fail).not.toHaveBeenCalled();
    expect(registry.get).not.toHaveBeenCalled();
  });

  // -- Error handling --------------------------------------------------------

  test('unknown sync type fails the job with descriptive message', async () => {
    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any);
    await eventBus._triggerSync({
      jobId: 'job-u',
      instanceId: 'inst-1',
      type: 'banana',
      config: {},
    });

    expect(services.syncJobs.fail).toHaveBeenCalledWith('job-u', 'Unknown sync type: banana', null);
  });

  test('fails job when instances.getById returns null', async () => {
    services.instances.getById.mockResolvedValue(null as any);

    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any);
    await eventBus._triggerSync({
      jobId: 'job-nf',
      instanceId: 'inst-missing',
      type: 'messages',
      config: {},
    });

    expect(services.syncJobs.fail).toHaveBeenCalledTimes(1);
    const failCalls1 = services.syncJobs.fail.mock.calls as unknown[][];
    expect(failCalls1[0]?.[0]).toBe('job-nf');
    expect(String(failCalls1[0]?.[1])).toContain('inst-missing');
    expect(String(failCalls1[0]?.[1])).toContain('not found');
  });

  test('fails job when instances.getById throws', async () => {
    services.instances.getById.mockRejectedValue(new Error('DB connection lost'));

    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any);
    await eventBus._triggerSync({
      jobId: 'job-err',
      instanceId: 'inst-1',
      type: 'messages',
      config: {},
    });

    expect(services.syncJobs.fail).toHaveBeenCalledTimes(1);
    const failCalls2 = services.syncJobs.fail.mock.calls as unknown[][];
    expect(failCalls2[0]?.[0]).toBe('job-err');
    expect(String(failCalls2[0]?.[1])).toContain('DB connection lost');
  });

  test('fails job when plugin not found in registry', async () => {
    registry.get.mockReturnValue(null as any);

    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any);
    await eventBus._triggerSync({
      jobId: 'job-np',
      instanceId: 'inst-1',
      type: 'messages',
      config: {},
    });

    expect(services.syncJobs.fail).toHaveBeenCalledTimes(1);
    const failCalls3 = services.syncJobs.fail.mock.calls as unknown[][];
    expect(failCalls3[0]?.[0]).toBe('job-np');
    expect(String(failCalls3[0]?.[1])).toContain('No plugin found');
    expect(String(failCalls3[0]?.[1])).toContain('whatsapp-baileys');
  });

  // -- parseSyncDepth tested indirectly via fetchHistory options -------------

  test('messages sync passes depth-derived since date to fetchHistory', async () => {
    const capturedOptions: Record<string, unknown>[] = [];
    const mockPlugin = {
      fetchHistory: mock(async (_id: string, opts: Record<string, unknown>) => {
        capturedOptions.push(opts);
      }),
      fetchContacts: mock(async () => {}),
      fetchGroups: mock(async () => {}),
    };
    registry.get.mockReturnValue(mockPlugin as any);

    const before = Date.now();
    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any);
    await eventBus._triggerSync({
      jobId: 'job-depth',
      instanceId: 'inst-1',
      type: 'messages',
      config: { depth: '7d' },
    });

    expect(capturedOptions.length).toBe(1);
    const sinceDate = capturedOptions[0]!.since as Date;
    expect(sinceDate).toBeInstanceOf(Date);
    // The since date should be approximately 7 days ago (within a few seconds tolerance)
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const expectedMs = before - sevenDaysMs;
    expect(Math.abs(sinceDate.getTime() - expectedMs)).toBeLessThan(10000);
  });

  test('messages sync with depth=all passes since=undefined to fetchHistory', async () => {
    const capturedOptions: Record<string, unknown>[] = [];
    const mockPlugin = {
      fetchHistory: mock(async (_id: string, opts: Record<string, unknown>) => {
        capturedOptions.push(opts);
      }),
      fetchContacts: mock(async () => {}),
      fetchGroups: mock(async () => {}),
    };
    registry.get.mockReturnValue(mockPlugin as any);

    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any);
    await eventBus._triggerSync({
      jobId: 'job-all-depth',
      instanceId: 'inst-1',
      type: 'messages',
      config: { depth: 'all' },
    });

    expect(capturedOptions.length).toBe(1);
    expect(capturedOptions[0]!.since).toBeUndefined();
  });

  test('messages sync with explicit since config uses that date', async () => {
    const capturedOptions: Record<string, unknown>[] = [];
    const mockPlugin = {
      fetchHistory: mock(async (_id: string, opts: Record<string, unknown>) => {
        capturedOptions.push(opts);
      }),
      fetchContacts: mock(async () => {}),
      fetchGroups: mock(async () => {}),
    };
    registry.get.mockReturnValue(mockPlugin as any);

    const sinceStr = '2025-01-01T00:00:00.000Z';
    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any);
    await eventBus._triggerSync({
      jobId: 'job-since',
      instanceId: 'inst-1',
      type: 'messages',
      config: { since: sinceStr },
    });

    expect(capturedOptions.length).toBe(1);
    const sinceDate = capturedOptions[0]!.since as Date;
    expect(sinceDate).toBeInstanceOf(Date);
    expect(sinceDate.toISOString()).toBe(sinceStr);
  });

  // -- GH#142: Default sync must discover chats from DB, not just Baileys volatile cache ----

  test('default WhatsApp sync uses DB anchors when database has chat data (GH#142)', async () => {
    const capturedOptions: Record<string, unknown>[] = [];
    const mockPlugin = {
      fetchHistory: mock(async (_id: string, opts: Record<string, unknown>) => {
        capturedOptions.push(opts);
      }),
      fetchContacts: mock(async () => {}),
      fetchGroups: mock(async () => {}),
    };
    registry.get.mockReturnValue(mockPlugin as any);

    // Mock database with two chats that have messages (DB anchor scenario)
    const mockDb = {
      execute: mock(async () => [
        {
          chat_jid: '5511999999999@s.whatsapp.net',
          external_id: 'msg-oldest-1',
          platform_timestamp: new Date('2026-01-01T00:00:00Z'),
          is_from_me: false,
          message_key: { id: 'msg-oldest-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
        },
        {
          chat_jid: '5511888888888@s.whatsapp.net',
          external_id: 'msg-oldest-2',
          platform_timestamp: new Date('2026-01-02T00:00:00Z'),
          is_from_me: true,
          message_key: { id: 'msg-oldest-2', remoteJid: '5511888888888@s.whatsapp.net', fromMe: true },
        },
      ]),
    };

    // Also mock getAllExternalIds to return the same chats (they're already anchored)
    (services.chats.getAllExternalIds as ReturnType<typeof mock>).mockResolvedValue([
      '5511999999999@s.whatsapp.net',
      '5511888888888@s.whatsapp.net',
    ]);

    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any, mockDb as any);
    await eventBus._triggerSync({
      jobId: 'job-gh142',
      instanceId: 'inst-1',
      type: 'messages',
      config: {},
    });

    expect(mockPlugin.fetchHistory).toHaveBeenCalledTimes(1);
    expect(capturedOptions.length).toBe(1);

    // Verify anchors were passed (active fetch, not passive)
    const anchors = capturedOptions[0]!.anchors as Array<{ chatJid: string }> | undefined;
    expect(anchors).toBeDefined();
    expect(anchors!.length).toBe(2);
    expect(anchors!.map((a) => a.chatJid).sort()).toEqual([
      '5511888888888@s.whatsapp.net',
      '5511999999999@s.whatsapp.net',
    ]);

    expect(services.syncJobs.complete).toHaveBeenCalledWith('job-gh142', null);
  });

  test('default WhatsApp sync falls back to passive when no prior data (fresh instance)', async () => {
    const capturedOptions: Record<string, unknown>[] = [];
    const mockPlugin = {
      fetchHistory: mock(async (_id: string, opts: Record<string, unknown>) => {
        capturedOptions.push(opts);
      }),
      fetchContacts: mock(async () => {}),
      fetchGroups: mock(async () => {}),
    };
    registry.get.mockReturnValue(mockPlugin as any);

    // Mock database with no prior messages
    const mockDb = {
      execute: mock(async () => []),
    };

    // No chats in DB either
    services.chats.getAllExternalIds.mockResolvedValue([]);

    await setupSyncWorker(eventBus as unknown as EventBus, services as any, registry as any, mockDb as any);
    await eventBus._triggerSync({
      jobId: 'job-fresh',
      instanceId: 'inst-1',
      type: 'messages',
      config: {},
    });

    expect(mockPlugin.fetchHistory).toHaveBeenCalledTimes(1);
    expect(capturedOptions.length).toBe(1);

    // Fresh instance: no anchors, passive sync
    expect(capturedOptions[0]!.anchors).toBeUndefined();

    expect(services.syncJobs.complete).toHaveBeenCalledWith('job-fresh', null);
  });
});
