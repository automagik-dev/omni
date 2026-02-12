/**
 * Unit tests for RouteResolver
 *
 * Tests route resolution with priority (chat > user > instance default),
 * caching behavior, cache invalidation, and metrics tracking.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { Database } from '@omni/db';
import { RouteResolver } from '../route-resolver';

// ============================================================================
// Helpers
// ============================================================================

interface ResolvedRoute {
  id: string;
  instanceId: string;
  scope: 'chat' | 'user';
  chatId: string | null;
  personId: string | null;
  agentProviderId: string;
  agentId: string;
  agentType: 'agent' | 'team' | 'workflow';
  agentTimeout: number | null;
  agentStreamMode: boolean | null;
  agentReplyFilter: unknown | null;
  agentSessionStrategy: string | null;
  agentPrefixSenderName: boolean | null;
  agentWaitForMedia: boolean | null;
  agentSendMediaPath: boolean | null;
  agentGateEnabled: boolean | null;
  agentGateModel: string | null;
  agentGatePrompt: string | null;
  label: string | null;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function createRoute(overrides: Partial<ResolvedRoute> = {}): ResolvedRoute {
  return {
    id: 'route-1',
    instanceId: 'inst-1',
    scope: 'chat',
    chatId: 'chat-1',
    personId: null,
    agentProviderId: 'provider-1',
    agentId: 'agent-1',
    agentType: 'agent',
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
 */
function createMockDb(routes: ResolvedRoute[]) {
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          orderBy: mock(() => ({
            limit: mock(() => Promise.resolve(routes)),
          })),
        })),
      })),
    })),
  } as unknown as Database;
}

// ============================================================================
// Tests
// ============================================================================

describe('RouteResolver', () => {
  test('resolves chat route with priority', async () => {
    const chatRoute = createRoute({ scope: 'chat', chatId: 'chat-1' });
    const db = createMockDb([chatRoute]);
    const resolver = new RouteResolver(db);

    const result = await resolver.resolve('inst-1', 'chat-1', 'person-1');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('route-1');
    expect(result?.scope).toBe('chat');
    expect(result?.chatId).toBe('chat-1');
  });

  test('resolves user route when no chat route exists', async () => {
    const userRoute = createRoute({ scope: 'user', chatId: null, personId: 'person-1' });
    const db = createMockDb([userRoute]);
    const resolver = new RouteResolver(db);

    const result = await resolver.resolve('inst-1', 'chat-1', 'person-1');

    expect(result).not.toBeNull();
    expect(result?.id).toBe('route-1');
    expect(result?.scope).toBe('user');
    expect(result?.personId).toBe('person-1');
  });

  test('returns null when no route matches (instance default)', async () => {
    const db = createMockDb([]);
    const resolver = new RouteResolver(db);

    const result = await resolver.resolve('inst-1', 'chat-1', 'person-1');

    expect(result).toBeNull();
  });

  test('chat route takes priority over user route', async () => {
    // DB query should return chat route first due to ORDER BY
    const chatRoute = createRoute({ scope: 'chat', chatId: 'chat-1', agentId: 'chat-agent' });
    const db = createMockDb([chatRoute]); // Only chat route returned (DB does filtering)
    const resolver = new RouteResolver(db);

    const result = await resolver.resolve('inst-1', 'chat-1', 'person-1');

    expect(result).not.toBeNull();
    expect(result?.scope).toBe('chat');
    expect(result?.agentId).toBe('chat-agent');
  });

  test('caches route resolution results', async () => {
    const route = createRoute();
    const db = createMockDb([route]);
    const resolver = new RouteResolver(db);

    // First call - cache miss
    await resolver.resolve('inst-1', 'chat-1', 'person-1');
    const metrics1 = resolver.getMetrics();
    expect(metrics1.misses).toBe(1);
    expect(metrics1.hits).toBe(0);

    // Second call - cache hit
    await resolver.resolve('inst-1', 'chat-1', 'person-1');
    const metrics2 = resolver.getMetrics();
    expect(metrics2.hits).toBe(1);
    expect(metrics2.misses).toBe(1);
  });

  test('invalidateRoute clears cache', async () => {
    const route = createRoute();
    const db = createMockDb([route]);
    const resolver = new RouteResolver(db);

    // Prime cache
    await resolver.resolve('inst-1', 'chat-1', 'person-1');
    expect(resolver.getMetrics().hits).toBe(0);

    // Invalidate cache
    resolver.invalidateRoute('route-1');

    // Next call should be cache miss
    await resolver.resolve('inst-1', 'chat-1', 'person-1');
    const metrics = resolver.getMetrics();
    expect(metrics.misses).toBe(2); // 2 misses (initial + after invalidation)
    expect(metrics.invalidations).toBe(1);
  });

  test('invalidateInstance clears cache', async () => {
    const route = createRoute();
    const db = createMockDb([route]);
    const resolver = new RouteResolver(db);

    // Prime cache
    await resolver.resolve('inst-1', 'chat-1', 'person-1');

    // Invalidate cache
    resolver.invalidateInstance('inst-1');

    // Next call should be cache miss
    await resolver.resolve('inst-1', 'chat-1', 'person-1');
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
    await resolver.resolve('inst-1', 'chat-1', 'person-1');
    const metrics1 = resolver.getMetrics();
    expect(metrics1.misses).toBe(1);
    expect(metrics1.sets).toBe(1);
    expect(metrics1.lastQueryMs).toBeGreaterThanOrEqual(0);

    // Second call - cache hit
    await resolver.resolve('inst-1', 'chat-1', 'person-1');
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
    const result = await resolver.resolve('inst-1', 'chat-1', undefined);

    // Should still attempt resolution (chat route can match)
    expect(result).not.toBeNull();
  });

  test('casts scope to correct type', async () => {
    const route = createRoute({ scope: 'user' });
    const db = createMockDb([route]);
    const resolver = new RouteResolver(db);

    const result = await resolver.resolve('inst-1', 'chat-1', 'person-1');

    expect(result).not.toBeNull();
    expect(result?.scope).toBe('user');
    // TypeScript should accept this as 'chat' | 'user'
    const scope: 'chat' | 'user' = result!.scope;
    expect(scope).toBe('user');
  });
});
