/**
 * Unit tests for RouteResolver
 *
 * Tests route resolution with priority (chat > user > instance default),
 * caching behavior, cache invalidation, and metrics tracking.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { Database } from '@omni/db';
import { type ResolvedRoute, RouteResolver } from '../route-resolver';

// ============================================================================
// Helpers
// ============================================================================

/** Valid UUID used as default chatId in tests */
const TEST_CHAT_UUID = 'a0000000-0000-4000-8000-000000000001';

function createRoute(overrides: Partial<ResolvedRoute> = {}): ResolvedRoute {
  return {
    id: 'route-1',
    instanceId: 'inst-1',
    scope: 'chat',
    chatId: TEST_CHAT_UUID,
    personId: null,
    agentId: '00000000-0000-0000-0000-000000000001',
    agentTimeout: 60,
    agentStreamMode: true,
    agentReplyFilter: null,
    agentSessionStrategy: 'per_chat',
    agentPrefixSenderName: true,
    agentWaitForMedia: true,
    agentSendMediaPath: true,
    agentGateEnabled: false,
    agentGateModel: null,
    agentGatePrompt: null,
    label: 'Test Route',
    priority: 0,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

/**
 * Create a mock DB that returns the given routes from select query.
 * Optionally validates query parameters if assertions provided.
 */
function createMockDb(
  routes: ResolvedRoute[],
  assertions?: {
    where?: (arg: unknown) => void;
    orderBy?: (...args: unknown[]) => void;
    limit?: (arg: number) => void;
  },
) {
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock((arg: unknown) => {
          if (assertions?.where) assertions.where(arg);
          return {
            orderBy: mock((...args: unknown[]) => {
              if (assertions?.orderBy) assertions.orderBy(...args);
              return {
                limit: mock((limitArg: number) => {
                  if (assertions?.limit) assertions.limit(limitArg);
                  return Promise.resolve(routes);
                }),
              };
            }),
          };
        }),
      })),
    })),
  } as unknown as Database;
}

// ============================================================================
// Tests
// ============================================================================

describe('RouteResolver', () => {
  test('resolves chat route with priority', async () => {
    const chatRoute = createRoute({ scope: 'chat', chatId: TEST_CHAT_UUID });
    const db = createMockDb([chatRoute]);
    const resolver = new RouteResolver(db);

    const result = await resolver.resolve('inst-1', TEST_CHAT_UUID, 'person-1');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('route-1');
    expect(result?.scope).toBe('chat');
    expect(result?.chatId).toBe(TEST_CHAT_UUID);
  });

  test('resolves user route when no chat route exists', async () => {
    const userRoute = createRoute({ scope: 'user', chatId: null, personId: 'person-1' });
    const db = createMockDb([userRoute]);
    const resolver = new RouteResolver(db);

    const result = await resolver.resolve('inst-1', TEST_CHAT_UUID, 'person-1');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('route-1');
    expect(result?.scope).toBe('user');
    expect(result?.personId).toBe('person-1');
  });

  test('returns null when no route matches (instance default)', async () => {
    const db = createMockDb([]);
    const resolver = new RouteResolver(db);

    const result = await resolver.resolve('inst-1', TEST_CHAT_UUID, 'person-1');

    expect(result).toBeNull();
  });

  test('chat route takes priority over user route', async () => {
    // DB query should return chat route first due to ORDER BY
    const chatRoute = createRoute({ scope: 'chat', chatId: TEST_CHAT_UUID, agentId: 'chat-agent' });
    const db = createMockDb([chatRoute]); // Only chat route returned (DB does filtering)
    const resolver = new RouteResolver(db);

    const result = await resolver.resolve('inst-1', TEST_CHAT_UUID, 'person-1');

    expect(result).not.toBeNull();
    expect(result?.scope).toBe('chat');
    expect(result?.agentId).toBe('00000000-0000-0000-0000-000000000002');
  });

  test('caches route resolution results', async () => {
    const route = createRoute();
    const db = createMockDb([route]);
    const resolver = new RouteResolver(db);

    // First call - cache miss
    await resolver.resolve('inst-1', TEST_CHAT_UUID, 'person-1');
    const metrics1 = resolver.getMetrics();
    expect(metrics1.misses).toBe(1);
    expect(metrics1.hits).toBe(0);

    // Second call - cache hit
    await resolver.resolve('inst-1', TEST_CHAT_UUID, 'person-1');
    const metrics2 = resolver.getMetrics();
    expect(metrics2.hits).toBe(1);
    expect(metrics2.misses).toBe(1);
  });

  test('invalidateRoute clears cache', async () => {
    const route = createRoute();
    const db = createMockDb([route]);
    const resolver = new RouteResolver(db);

    // Prime cache
    await resolver.resolve('inst-1', TEST_CHAT_UUID, 'person-1');
    expect(resolver.getMetrics().hits).toBe(0);

    // Invalidate cache
    resolver.invalidateRoute('route-1');

    // Next call should be cache miss
    await resolver.resolve('inst-1', TEST_CHAT_UUID, 'person-1');
    const metrics = resolver.getMetrics();
    expect(metrics.misses).toBe(2); // 2 misses (initial + after invalidation)
    expect(metrics.invalidations).toBe(1);
  });

  test('invalidateInstance clears cache', async () => {
    const route = createRoute();
    const db = createMockDb([route]);
    const resolver = new RouteResolver(db);

    // Prime cache
    await resolver.resolve('inst-1', TEST_CHAT_UUID, 'person-1');

    // Invalidate cache
    resolver.invalidateInstance('inst-1');

    // Next call should be cache miss
    await resolver.resolve('inst-1', TEST_CHAT_UUID, 'person-1');
    const metrics = resolver.getMetrics();
    expect(metrics.misses).toBe(2);
    expect(metrics.invalidations).toBe(1);
  });

  test('tracks metrics correctly', async () => {
    const route = createRoute();
    const db = createMockDb([route]);
    const resolver = new RouteResolver(db);

    // Initial state
    const initialMetrics = resolver.getMetrics();
    expect(initialMetrics.hits).toBe(0);
    expect(initialMetrics.misses).toBe(0);
    expect(initialMetrics.sets).toBe(0);

    // First call - cache miss
    await resolver.resolve('inst-1', TEST_CHAT_UUID, 'person-1');
    const metrics1 = resolver.getMetrics();
    expect(metrics1.misses).toBe(1);
    expect(metrics1.sets).toBe(1);
    expect(metrics1.lastQueryMs).toBeGreaterThanOrEqual(0);

    // Second call - cache hit
    await resolver.resolve('inst-1', TEST_CHAT_UUID, 'person-1');
    const metrics2 = resolver.getMetrics();
    expect(metrics2.hits).toBe(1);
    expect(metrics2.misses).toBe(1);
    expect(metrics2.hitRate).toBeGreaterThan(0);
    expect(metrics2.cacheSize).toBe(1);
  });

  test('handles null personId gracefully', async () => {
    const route = createRoute();
    const db = createMockDb([route]);
    const resolver = new RouteResolver(db);

    // Resolve without personId (DM scenario where person not yet resolved)
    const result = await resolver.resolve('inst-1', TEST_CHAT_UUID, undefined);

    // Should still attempt resolution (chat route can match)
    expect(result).not.toBeNull();
  });

  test('casts scope to correct type', async () => {
    const route = createRoute({ scope: 'user' });
    const db = createMockDb([route]);
    const resolver = new RouteResolver(db);

    const result = await resolver.resolve('inst-1', TEST_CHAT_UUID, 'person-1');

    expect(result).not.toBeNull();
    if (result) {
      expect(result.scope).toBe('user');
    }
  });

  // ==========================================================================
  // UUID validation guard (defense-in-depth for LID JID leak)
  // ==========================================================================

  test('returns null for LID JID chatId without querying DB', async () => {
    const route = createRoute();
    const db = createMockDb([route]);
    const resolver = new RouteResolver(db);

    // @lid JIDs are WhatsApp internal identifiers, NOT valid UUIDs
    const result = await resolver.resolve('inst-1', '12345678:90@lid', 'person-1');

    // Should short-circuit to null (no DB query, no crash)
    expect(result).toBeNull();

    // DB should NOT have been queried — the select mock should not be called
    const selectMock = db.select as ReturnType<typeof mock>;
    expect(selectMock).not.toHaveBeenCalled();
  });

  test('returns null for WhatsApp phone JID chatId without querying DB', async () => {
    const route = createRoute();
    const db = createMockDb([route]);
    const resolver = new RouteResolver(db);

    // Phone-based JIDs are also not UUIDs
    const result = await resolver.resolve('inst-1', '5511999999999@s.whatsapp.net', 'person-1');

    expect(result).toBeNull();

    const selectMock = db.select as ReturnType<typeof mock>;
    expect(selectMock).not.toHaveBeenCalled();
  });

  test('returns null for group JID chatId without querying DB', async () => {
    const route = createRoute();
    const db = createMockDb([route]);
    const resolver = new RouteResolver(db);

    const result = await resolver.resolve('inst-1', '120363123456789012@g.us', 'person-1');

    expect(result).toBeNull();

    const selectMock = db.select as ReturnType<typeof mock>;
    expect(selectMock).not.toHaveBeenCalled();
  });

  test('queries DB normally for valid UUID chatId', async () => {
    const route = createRoute({ chatId: '550e8400-e29b-41d4-a716-446655440000' });
    const db = createMockDb([route]);
    const resolver = new RouteResolver(db);

    const result = await resolver.resolve('inst-1', '550e8400-e29b-41d4-a716-446655440000', 'person-1');

    // Should query DB and return route
    expect(result).not.toBeNull();
    expect(result?.chatId).toBe('550e8400-e29b-41d4-a716-446655440000');

    const selectMock = db.select as ReturnType<typeof mock>;
    expect(selectMock).toHaveBeenCalled();
  });
});
