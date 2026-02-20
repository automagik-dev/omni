import { describe, expect, test } from 'bun:test';
import { omniPlugin } from './channel.js';
import type { ChannelAccountSnapshot, OmniPluginConfig } from './types.js';

describe('omniPlugin stub adapters', () => {
  test('outbound adapter exists with correct deliveryMode and textChunkLimit', () => {
    expect(omniPlugin.outbound).toBeDefined();
    expect(omniPlugin.outbound?.deliveryMode).toBe('direct');
    expect(omniPlugin.outbound?.textChunkLimit).toBe(4096);
  });

  test('outbound.sendText is defined', () => {
    expect(omniPlugin.outbound?.sendText).toBeDefined();
    expect(typeof omniPlugin.outbound?.sendText).toBe('function');
  });

  test('outbound.sendMedia is defined', () => {
    expect(omniPlugin.outbound?.sendMedia).toBeDefined();
    expect(typeof omniPlugin.outbound?.sendMedia).toBe('function');
  });

  test('outbound.chunkerMode is markdown', () => {
    expect(omniPlugin.outbound?.chunkerMode).toBe('markdown');
  });

  test('actions adapter lists supported actions', () => {
    expect(omniPlugin.actions).toBeDefined();
    const actions = omniPlugin.actions?.listActions?.({} as { cfg: OmniPluginConfig });
    expect(actions).toEqual(['send', 'react', 'read', 'reply']);
  });

  test('actions.supportsAction returns true for supported actions', () => {
    expect(omniPlugin.actions?.supportsAction?.({ action: 'send' })).toBe(true);
    expect(omniPlugin.actions?.supportsAction?.({ action: 'react' })).toBe(true);
    expect(omniPlugin.actions?.supportsAction?.({ action: 'read' })).toBe(true);
    expect(omniPlugin.actions?.supportsAction?.({ action: 'reply' })).toBe(true);
  });

  test('actions.supportsAction returns false for unsupported actions', () => {
    expect(omniPlugin.actions?.supportsAction?.({ action: 'delete' })).toBe(false);
    expect(omniPlugin.actions?.supportsAction?.({ action: 'forward' })).toBe(false);
  });

  test('actions.handleAction is wired to a real implementation', () => {
    expect(typeof omniPlugin.actions?.handleAction).toBe('function');
  });

  test('gateway.startAccount is wired to a real implementation', () => {
    expect(omniPlugin.gateway).toBeDefined();
    expect(typeof omniPlugin.gateway?.startAccount).toBe('function');
  });

  test('status has correct defaultRuntime', () => {
    expect(omniPlugin.status).toBeDefined();
    expect(omniPlugin.status?.defaultRuntime).toEqual({
      accountId: 'default',
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    });
  });

  test('status.collectStatusIssues returns empty for accounts without errors', () => {
    const accounts = [
      { accountId: 'a1', lastError: null },
      { accountId: 'a2', lastError: '' },
    ];
    const issues = omniPlugin.status?.collectStatusIssues?.(accounts as ChannelAccountSnapshot[]);
    expect(issues).toEqual([]);
  });

  test('status.collectStatusIssues returns issues for accounts with errors', () => {
    const accounts = [
      { accountId: 'a1', lastError: 'Connection failed' },
      { accountId: 'a2', lastError: null },
    ];
    const issues = omniPlugin.status?.collectStatusIssues?.(accounts as ChannelAccountSnapshot[]);
    expect(issues).toEqual([
      {
        channel: 'omni',
        accountId: 'a1',
        kind: 'runtime',
        message: 'Channel error: Connection failed',
      },
    ]);
  });

  test('config.describeAccount returns account snapshot', () => {
    const account = {
      accountId: 'test-1',
      name: 'Test Account',
      enabled: true,
      configured: true,
      apiUrl: 'https://api.example.com',
      apiKey: 'key',
      instanceId: 'inst-1',
    };
    const snapshot = omniPlugin.config.describeAccount?.(account);
    expect(snapshot).toEqual({
      accountId: 'test-1',
      name: 'Test Account',
      enabled: true,
      configured: true,
      baseUrl: 'https://api.example.com',
    });
  });
});
