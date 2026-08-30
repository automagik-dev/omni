/**
 * Tests for AgentReplayService
 *
 * Covers onInstanceConnect guard logic, replayMissedMessages 24h window cap,
 * per-message error handling, and updateLastSeenAt.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Database } from '@omni/db';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { AgentReplayService } from '../agent-replay';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createMockInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inst-1',
    channel: 'whatsapp-baileys',
    replayEnabled: true,
    lastSeenAt: new Date('2026-01-01T10:00:00Z'),
    agentId: 'agent-1',
    ...overrides,
  };
}

function createMockMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    externalId: 'ext-1',
    messageType: 'text',
    textContent: 'hello',
    mediaUrl: null,
    mediaLocalPath: null,
    mediaMimeType: null,
    senderPlatformUserId: '+5511999@s.whatsapp.net',
    replyToExternalId: null,
    rawPayload: null,
    platformTimestamp: new Date('2026-01-01T10:30:00Z'),
    isFromMe: false,
    senderAgentId: null,
    chatExternalId: '+5511999@s.whatsapp.net',
    chatInstanceId: 'inst-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockEventBus() {
  return { publish: mock(() => Promise.resolve()) } as unknown as EventBus & {
    publish: ReturnType<typeof mock>;
  };
}

/** Build a mock DB whose select chain returns `instanceRows` on the first call
 *  (instances query) and `messageRows` on subsequent calls (messages query).
 *  The update chain always resolves. */
function createMockDb(instanceRows: unknown[] = [], messageRows: unknown[] = []) {
  let selectCallCount = 0;

  const mockUpdate = mock(() => ({
    set: mock(() => ({
      where: mock(() => Promise.resolve()),
    })),
  }));

  const mockSelect = mock(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      // instances query chain: select → from → where → limit
      return {
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve(instanceRows)),
          })),
        })),
      };
    }
    // messages query chain: select → from → innerJoin → where → orderBy → limit
    return {
      from: mock(() => ({
        innerJoin: mock(() => ({
          where: mock(() => ({
            orderBy: mock(() => ({
              limit: mock(() => Promise.resolve(messageRows)),
            })),
          })),
        })),
      })),
    };
  });

  return { select: mockSelect, update: mockUpdate } as unknown as Database & {
    select: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
  };
}

/** Build a DB mock for replayMissedMessages only (no instance query needed). */
function createMessagesOnlyDb(messageRows: unknown[] = []) {
  const mockUpdate = mock(() => ({
    set: mock(() => ({ where: mock(() => Promise.resolve()) })),
  }));

  const mockSelect = mock(() => ({
    from: mock(() => ({
      innerJoin: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() => ({
            limit: mock(() => Promise.resolve(messageRows)),
          })),
        })),
      })),
    })),
  }));

  return { select: mockSelect, update: mockUpdate } as unknown as Database & {
    select: ReturnType<typeof mock>;
    update: ReturnType<typeof mock>;
  };
}

// ---------------------------------------------------------------------------
// onInstanceConnect
// ---------------------------------------------------------------------------

describe('AgentReplayService', () => {
  let eventBus: ReturnType<typeof createMockEventBus>;

  beforeEach(() => {
    eventBus = createMockEventBus();
  });

  describe('onInstanceConnect', () => {
    test('skips replay when instance not found', async () => {
      const db = createMockDb([], []);
      const service = new AgentReplayService(db, eventBus);

      await service.onInstanceConnect('inst-missing');

      expect(eventBus.publish).not.toHaveBeenCalled();
      // update (lastSeenAt) should NOT be called — early return before it
      expect(db.update).not.toHaveBeenCalled();
    });

    test('skips replay when no agentId — updates lastSeenAt only', async () => {
      const db = createMockDb([createMockInstance({ agentId: null })], []);
      const service = new AgentReplayService(db, eventBus);

      await service.onInstanceConnect('inst-1');

      expect(eventBus.publish).not.toHaveBeenCalled();
      expect(db.update).toHaveBeenCalledTimes(1);
    });

    test('skips replay when replay disabled — updates lastSeenAt only', async () => {
      const db = createMockDb([createMockInstance({ replayEnabled: false })], []);
      const service = new AgentReplayService(db, eventBus);

      await service.onInstanceConnect('inst-1');

      expect(eventBus.publish).not.toHaveBeenCalled();
      expect(db.update).toHaveBeenCalledTimes(1);
    });

    test('skips replay on first connect — no lastSeenAt', async () => {
      const db = createMockDb([createMockInstance({ lastSeenAt: null })], []);
      const service = new AgentReplayService(db, eventBus);

      await service.onInstanceConnect('inst-1');

      expect(eventBus.publish).not.toHaveBeenCalled();
      expect(db.update).toHaveBeenCalledTimes(1);
    });

    test('replays messages when all conditions met', async () => {
      const msg = createMockMessageRow();
      const db = createMockDb([createMockInstance()], [msg]);
      const service = new AgentReplayService(db, eventBus);

      await service.onInstanceConnect('inst-1');

      expect(eventBus.publish).toHaveBeenCalledTimes(1);
      // First arg is the event name
      const publishCalls = eventBus.publish.mock.calls as unknown[][];
      expect(publishCalls[0]?.[0]).toBe('message.received');
      // lastSeenAt updated in finally block
      expect(db.update).toHaveBeenCalledTimes(1);
    });

    test('does NOT update lastSeenAt when replay throws', async () => {
      const instance = createMockInstance();
      let selectCallCount = 0;

      const mockUpdate = mock(() => ({
        set: mock(() => ({ where: mock(() => Promise.resolve()) })),
      }));

      const mockSelect = mock(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: mock(() => ({
              where: mock(() => ({
                limit: mock(() => Promise.resolve([instance])),
              })),
            })),
          };
        }
        // messages query — throw to simulate DB failure
        return {
          from: mock(() => ({
            innerJoin: mock(() => ({
              where: mock(() => ({
                orderBy: mock(() => ({
                  limit: mock(() => Promise.reject(new Error('DB connection lost'))),
                })),
              })),
            })),
          })),
        };
      });

      const db = { select: mockSelect, update: mockUpdate } as unknown as Database & {
        update: ReturnType<typeof mock>;
      };
      const service = new AgentReplayService(db, eventBus);

      await service.onInstanceConnect('inst-1');

      // Failed replay must NOT advance lastSeenAt — prevents message loss
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // replayMissedMessages
  // -------------------------------------------------------------------------

  describe('replayMissedMessages', () => {
    test('replays messages and publishes events', async () => {
      const msg1 = createMockMessageRow({ id: 'msg-1', externalId: 'ext-1' });
      const msg2 = createMockMessageRow({ id: 'msg-2', externalId: 'ext-2', textContent: 'world' });
      const db = createMessagesOnlyDb([msg1, msg2]);
      const service = new AgentReplayService(db, eventBus);

      const result = await service.replayMissedMessages({
        instanceId: 'inst-1',
        since: new Date('2026-01-01T10:00:00Z'),
      });

      expect(result.replayed).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.instanceId).toBe('inst-1');
      expect(eventBus.publish).toHaveBeenCalledTimes(2);
    });

    test('clamps replay window to 24h max', async () => {
      const db = createMessagesOnlyDb([]);
      const service = new AgentReplayService(db, eventBus);

      const oldSince = new Date('2020-01-01T00:00:00Z'); // way older than 24h
      const result = await service.replayMissedMessages({
        instanceId: 'inst-1',
        since: oldSince,
      });

      // The returned since should be ~24h ago, not the ancient date
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      expect(result.since.getTime()).toBeGreaterThan(twentyFourHoursAgo.getTime() - 5000);
      expect(result.since.getTime()).toBeLessThanOrEqual(Date.now());
      expect(result.since.getTime()).not.toBe(oldSince.getTime());
    });

    test('handles per-message errors gracefully', async () => {
      const msg1 = createMockMessageRow({ id: 'msg-1', externalId: 'ext-1' });
      const msg2 = createMockMessageRow({ id: 'msg-2', externalId: 'ext-2' });
      const db = createMessagesOnlyDb([msg1, msg2]);

      let publishCallCount = 0;
      eventBus.publish = mock(() => {
        publishCallCount++;
        if (publishCallCount === 2) {
          return Promise.reject(new Error('Event bus unavailable'));
        }
        return Promise.resolve();
      }) as typeof eventBus.publish;

      const service = new AgentReplayService(db, eventBus);
      const result = await service.replayMissedMessages({
        instanceId: 'inst-1',
        since: new Date('2026-01-01T10:00:00Z'),
      });

      expect(result.replayed).toBe(1);
      expect(result.skipped).toBe(1);
    });

    test('returns zero counts when no messages found', async () => {
      const db = createMessagesOnlyDb([]);
      const service = new AgentReplayService(db, eventBus);

      const before = Date.now();
      const result = await service.replayMissedMessages({
        instanceId: 'inst-1',
        since: new Date(),
      });
      const after = Date.now();

      expect(result.replayed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(eventBus.publish).not.toHaveBeenCalled();
      // until must be now (query upper bound), not since — prevents zero-row stall
      expect(result.until.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.until.getTime()).toBeLessThanOrEqual(after);
    });

    test('non-zero-row replay returns until=now, not last-row platformTimestamp', async () => {
      const pastTimestamp = new Date('2026-01-01T10:30:00Z');
      const msg = createMockMessageRow({ platformTimestamp: pastTimestamp });
      const db = createMessagesOnlyDb([msg]);
      const service = new AgentReplayService(db, eventBus);

      const before = Date.now();
      const result = await service.replayMissedMessages({
        instanceId: 'inst-1',
        since: new Date('2026-01-01T10:00:00Z'),
      });
      const after = Date.now();

      expect(result.replayed).toBe(1);
      // until should be now, not the message's platformTimestamp
      expect(result.until.getTime()).toBeGreaterThan(pastTimestamp.getTime());
      expect(result.until.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.until.getTime()).toBeLessThanOrEqual(after);
    });

    test('paginates when first page is full — replays all messages across pages', async () => {
      // Build 1000 rows for the first page and 3 rows for the second page
      const page1Timestamp = new Date('2026-01-01T10:30:00Z');
      const page2Timestamp = new Date('2026-01-01T11:30:00Z');

      const page1Rows = Array.from({ length: 1000 }, (_, i) =>
        createMockMessageRow({
          id: `msg-p1-${i}`,
          externalId: `ext-p1-${i}`,
          platformTimestamp: page1Timestamp,
        }),
      );
      const page2Rows = [
        createMockMessageRow({ id: 'msg-p2-0', externalId: 'ext-p2-0', platformTimestamp: page2Timestamp }),
        createMockMessageRow({ id: 'msg-p2-1', externalId: 'ext-p2-1', platformTimestamp: page2Timestamp }),
        createMockMessageRow({ id: 'msg-p2-2', externalId: 'ext-p2-2', platformTimestamp: page2Timestamp }),
      ];

      // DB mock that returns page1Rows on first messages query, page2Rows on second
      let messagesQueryCount = 0;
      const mockUpdate = mock(() => ({
        set: mock(() => ({ where: mock(() => Promise.resolve()) })),
      }));
      const mockSelect = mock(() => {
        messagesQueryCount++;
        const rows = messagesQueryCount === 1 ? page1Rows : page2Rows;
        return {
          from: mock(() => ({
            innerJoin: mock(() => ({
              where: mock(() => ({
                orderBy: mock(() => ({
                  limit: mock(() => Promise.resolve(rows)),
                })),
              })),
            })),
          })),
        };
      });
      const db = { select: mockSelect, update: mockUpdate } as unknown as Database & {
        select: ReturnType<typeof mock>;
        update: ReturnType<typeof mock>;
      };

      const service = new AgentReplayService(db, eventBus);
      const result = await service.replayMissedMessages({
        instanceId: 'inst-1',
        since: new Date('2026-01-01T10:00:00Z'),
      });

      // All 1003 messages should be replayed across two pages
      expect(result.replayed).toBe(1003);
      expect(result.skipped).toBe(0);
      // DB was queried twice (two pages)
      expect(mockSelect).toHaveBeenCalledTimes(2);
      // Event bus received all 1003 publish calls
      expect(eventBus.publish).toHaveBeenCalledTimes(1003);
      // until should be now (the query upper bound), not last-row timestamp
      expect(result.until.getTime()).toBeGreaterThan(page2Timestamp.getTime());
    });

    test('answered-turn guard is provenance-agnostic — keyed on is_from_me, not sender_agent_id (#912)', async () => {
      // Turns answered out-of-band via POST /api/v2/messages/send are stored
      // with sender_agent_id = NULL. The guard must treat ANY outbound row
      // after the inbound as "answered", or those turns replay on every
      // reconnect. Capture the messages-query where clause and render it.
      let capturedWhere: SQL | undefined;
      const mockSelect = mock(() => ({
        from: mock(() => ({
          innerJoin: mock(() => ({
            where: mock((condition: SQL) => {
              capturedWhere = condition;
              return { orderBy: mock(() => ({ limit: mock(() => Promise.resolve([])) })) };
            }),
          })),
        })),
      }));
      const db = { select: mockSelect } as unknown as Database;

      const service = new AgentReplayService(db, eventBus);
      await service.replayMissedMessages({ instanceId: 'inst-1' });

      expect(capturedWhere).toBeDefined();
      const rendered = new PgDialect().sqlToQuery(capturedWhere as SQL).sql;

      const notExistsIdx = rendered.indexOf('NOT EXISTS');
      expect(notExistsIdx).toBeGreaterThan(-1);
      const guard = rendered.slice(notExistsIdx);
      expect(guard).toContain('reply.is_from_me = true');
      expect(guard).not.toContain('reply.sender_agent_id');
    });

    test('uses cutoff when since is undefined', async () => {
      const db = createMessagesOnlyDb([]);
      const service = new AgentReplayService(db, eventBus);

      const result = await service.replayMissedMessages({ instanceId: 'inst-1' });

      // since should default to ~24h ago
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      expect(result.since.getTime()).toBeGreaterThanOrEqual(twentyFourHoursAgo.getTime() - 5000);
    });
  });

  // -------------------------------------------------------------------------
  // updateLastSeenAt
  // -------------------------------------------------------------------------

  describe('updateLastSeenAt', () => {
    test('calls db.update with correct instanceId', async () => {
      const db = createMessagesOnlyDb([]);
      const service = new AgentReplayService(db, eventBus);

      await service.updateLastSeenAt('inst-42');

      expect(db.update).toHaveBeenCalledTimes(1);
    });
  });
});
