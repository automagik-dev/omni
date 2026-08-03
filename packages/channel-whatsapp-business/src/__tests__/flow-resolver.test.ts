import { describe, expect, test } from 'bun:test';
import { FlowResolverRegistry, buildFlowToken, parseFlowToken } from '../flows/resolver';

describe('flow token', () => {
  test('build → parse round-trips the flow ref', () => {
    const token = buildFlowToken('1234567890123456');
    expect(token.startsWith('omni.1234567890123456.')).toBe(true);
    expect(parseFlowToken(token)).toBe('1234567890123456');
  });

  test('refs containing dots survive (uuid is always the last segment)', () => {
    expect(parseFlowToken(buildFlowToken('my.flow.name'))).toBe('my.flow.name');
  });

  test('foreign/opaque tokens parse to null', () => {
    expect(parseFlowToken('caller-supplied-token')).toBeNull();
    expect(parseFlowToken('omni.x')).toBeNull(); // too few segments
    expect(parseFlowToken(undefined)).toBeNull();
    expect(parseFlowToken('')).toBeNull();
  });
});

describe('FlowResolverRegistry', () => {
  const flowResolver = { resolve: () => ({ screen: 'BY_REF' }) };
  const instanceResolver = { resolve: () => ({ screen: 'BY_INSTANCE' }) };

  test('flow-ref match wins over instance default', () => {
    const registry = new FlowResolverRegistry();
    registry.register('42', flowResolver);
    registry.registerInstanceDefault('inst-1', instanceResolver);
    expect(registry.lookup({ instanceId: 'inst-1', flowRef: '42' })).toBe(flowResolver);
  });

  test('falls back to instance default when ref is unknown or null', () => {
    const registry = new FlowResolverRegistry();
    registry.registerInstanceDefault('inst-1', instanceResolver);
    expect(registry.lookup({ instanceId: 'inst-1', flowRef: 'unknown' })).toBe(instanceResolver);
    expect(registry.lookup({ instanceId: 'inst-1', flowRef: null })).toBe(instanceResolver);
  });

  test('returns null when nothing matches; unregister removes the ref', () => {
    const registry = new FlowResolverRegistry();
    expect(registry.lookup({ instanceId: 'inst-1', flowRef: '42' })).toBeNull();
    registry.register('42', flowResolver);
    registry.unregister('42');
    expect(registry.lookup({ instanceId: 'inst-1', flowRef: '42' })).toBeNull();
  });
});
