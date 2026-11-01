/**
 * omni#906 — instance-level config (enableAutoSplit, agentTimeout, …) is baked
 * into the cached IAgentProvider at construction, so an instance update must
 * evict the `${providerId}:${instanceId}` cache entry or the dispatcher keeps
 * the stale provider until the process restarts.
 *
 * These tests pin the eviction primitive itself:
 *   - resolveProvider caches per (provider, instance) pair
 *   - invalidateProviderCacheForInstance evicts exactly that instance's
 *     entries and leaves sibling instances of the same provider cached
 *   - the guard used by InstanceService.update only fires for fields that are
 *     actually baked into providers
 */

import { afterEach, describe, expect, it } from 'bun:test';
import type { Database } from '@omni/db';
import { touchesProviderBakedConfig } from '../../services/instances';
import { __test__, invalidateProviderCacheForInstance, resolveProvider } from '../agent-dispatcher';

type ResolveProviderParams = Parameters<typeof resolveProvider>;

function fakeAgnoProvider(overrides: Record<string, unknown> = {}): ResolveProviderParams[0] {
  return {
    id: 'provider-agno-1',
    name: 'Test Agno',
    schema: 'agno',
    baseUrl: 'http://localhost:9999',
    apiKey: 'test-key',
    schemaConfig: { agentId: 'test-agent' },
    defaultStream: false,
    defaultTimeout: 60,
    isActive: true,
    ...overrides,
  } as unknown as ResolveProviderParams[0];
}

function fakeInstance(id: string, overrides: Record<string, unknown> = {}): ResolveProviderParams[1] {
  return {
    id,
    name: `Instance ${id}`,
    channel: 'whatsapp-baileys',
    agentProviderId: 'provider-agno-1',
    enableAutoSplit: true,
    agentPrefixSenderName: true,
    ...overrides,
  } as unknown as ResolveProviderParams[1];
}

const db = {} as Database;

afterEach(() => {
  __test__.resetProviderCaches();
});

describe('invalidateProviderCacheForInstance', () => {
  it('resolveProvider caches per (provider, instance) pair', () => {
    const provider = fakeAgnoProvider();
    const first = resolveProvider(provider, fakeInstance('inst-a'), db);
    const second = resolveProvider(provider, fakeInstance('inst-a'), db);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it('evicts only the target instance, keeping siblings of the same provider cached', () => {
    const provider = fakeAgnoProvider();
    const cachedA = resolveProvider(provider, fakeInstance('inst-a'), db);
    const cachedB = resolveProvider(provider, fakeInstance('inst-b'), db);

    invalidateProviderCacheForInstance('inst-a');

    const rebuiltA = resolveProvider(provider, fakeInstance('inst-a', { enableAutoSplit: false }), db);
    const stillB = resolveProvider(provider, fakeInstance('inst-b'), db);

    expect(rebuiltA).not.toBe(cachedA);
    expect(stillB).toBe(cachedB);
  });

  it('is a no-op for an instance with no cached provider', () => {
    const provider = fakeAgnoProvider();
    const cached = resolveProvider(provider, fakeInstance('inst-a'), db);

    invalidateProviderCacheForInstance('inst-unknown');

    expect(resolveProvider(provider, fakeInstance('inst-a'), db)).toBe(cached);
  });

  it('does not match on instance-id suffix collisions (":a" must not evict ":not-a")', () => {
    const provider = fakeAgnoProvider();
    const cachedLong = resolveProvider(provider, fakeInstance('inst-a'), db);

    // "a" is a suffix of "inst-a" but the key delimiter must prevent the match
    invalidateProviderCacheForInstance('a');

    expect(resolveProvider(provider, fakeInstance('inst-a'), db)).toBe(cachedLong);
  });
});

describe('touchesProviderBakedConfig', () => {
  it('fires for every provider-baked column, including explicit nulls', () => {
    expect(touchesProviderBakedConfig({ enableAutoSplit: false })).toBe(true);
    expect(touchesProviderBakedConfig({ agentTimeout: 30 })).toBe(true);
    expect(touchesProviderBakedConfig({ agentPrefixSenderName: false })).toBe(true);
    expect(touchesProviderBakedConfig({ agentId: null })).toBe(true);
  });

  it('stays quiet for fields the cached provider never sees', () => {
    expect(touchesProviderBakedConfig({})).toBe(false);
    expect(touchesProviderBakedConfig({ profileName: 'renamed' })).toBe(false);
    expect(touchesProviderBakedConfig({ isActive: false })).toBe(false);
    // fresh-per-send via getSplitDelayConfig, not baked at construction
    expect(touchesProviderBakedConfig({ messageSplitDelayFixedMs: 1000 })).toBe(false);
  });
});
