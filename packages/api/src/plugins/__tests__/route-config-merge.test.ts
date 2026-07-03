/**
 * Route config merge tests — verifies that route overrides correctly
 * merge with instance defaults, and that getDebounceConfig / getSplitDelayConfig
 * return the merged values.
 */
import { describe, expect, it } from 'bun:test';
import type { Instance } from '@omni/db';
import { getSplitDelayConfig } from '../../services/agent-runner';
import { __test__ } from '../agent-dispatcher';

const { mergeRouteOverrides, getDebounceConfig } = __test__;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Instance with defaults for all override-relevant fields. */
function makeInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: 'inst-1',
    name: 'Test Instance',
    channel: 'whatsapp-baileys',
    agentTimeout: 60,
    agentStreamMode: false,
    agentReplyFilter: null,
    agentSessionStrategy: 'per_chat',
    agentPrefixSenderName: true,
    agentWaitForMedia: false,
    agentSendMediaPath: false,
    agentGateEnabled: false,
    agentGateModel: null,
    agentGatePrompt: null,
    messageDebounceMode: 'fixed',
    messageDebounceMinMs: 200,
    messageDebounceMaxMs: 500,
    messageDebounceRestartOnTyping: false,
    messageSplitDelayMode: 'randomized',
    messageSplitDelayFixedMs: 0,
    messageSplitDelayMinMs: 300,
    messageSplitDelayMaxMs: 1000,
    enableAutoSplit: true,
    reactionAck: 'on',
    reactionAckEmoji: null,
    ackTimeoutMs: 5000,
    agentAckMessage: null,
    ...overrides,
  } as Instance;
}

/** Route with all fields null (no overrides). */
function makeNullRoute(overrides: Record<string, unknown> = {}) {
  return {
    id: 'route-1',
    instanceId: 'inst-1',
    scope: 'chat' as const,
    chatId: 'chat-1',
    personId: null,
    agentId: null,
    agentTimeout: null,
    agentStreamMode: null,
    agentReplyFilter: null,
    agentSessionStrategy: null,
    agentPrefixSenderName: null,
    agentWaitForMedia: null,
    agentSendMediaPath: null,
    agentGateEnabled: null,
    agentGateModel: null,
    agentGatePrompt: null,
    messageDebounceMode: null,
    messageDebounceMinMs: null,
    messageDebounceMaxMs: null,
    messageDebounceGroupMs: null,
    messageDebounceRestartOnTyping: null,
    messageDebounceMaxWaitMs: null,
    messageSplitDelayMode: null,
    messageSplitDelayFixedMs: null,
    messageSplitDelayMinMs: null,
    messageSplitDelayMaxMs: null,
    enableAutoSplit: null,
    reactionAck: null,
    reactionAckEmoji: null,
    ackTimeoutMs: null,
    agentAckMessage: null,
    label: null,
    priority: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mergeRouteOverrides', () => {
  it('null route fields inherit from instance (no override)', () => {
    const instance = makeInstance();
    const route = makeNullRoute();

    const merged = mergeRouteOverrides(instance, route);

    expect(merged.agentTimeout).toBe(60);
    expect(merged.agentStreamMode).toBe(false);
    expect(merged.agentReplyFilter).toBeNull();
    expect(merged.agentSessionStrategy).toBe('per_chat');
    expect(merged.agentPrefixSenderName).toBe(true);
    expect(merged.messageDebounceMode).toBe('fixed');
    expect(merged.messageDebounceMinMs).toBe(200);
    expect(merged.messageDebounceMaxMs).toBe(500);
    expect(merged.messageDebounceRestartOnTyping).toBe(false);
    expect(merged.messageSplitDelayMode).toBe('randomized');
    expect(merged.messageSplitDelayFixedMs).toBe(0);
    expect(merged.messageSplitDelayMinMs).toBe(300);
    expect(merged.messageSplitDelayMaxMs).toBe(1000);
    expect(merged.enableAutoSplit).toBe(true);
  });

  it('route fields override instance defaults when set', () => {
    const instance = makeInstance();
    const route = makeNullRoute({
      agentTimeout: 120,
      agentStreamMode: true,
      agentReplyFilter: {
        mode: 'filtered',
        conditions: { onDm: true, onMention: true, onReply: false, onNameMatch: false },
      },
      agentSessionStrategy: 'per_user',
      agentPrefixSenderName: false,
      agentWaitForMedia: true,
      agentSendMediaPath: true,
      agentGateEnabled: true,
      agentGateModel: 'gpt-4',
      agentGatePrompt: 'Is this relevant?',
      messageDebounceMode: 'disabled',
      messageDebounceMinMs: 0,
      messageDebounceMaxMs: 0,
      messageDebounceRestartOnTyping: true,
      messageSplitDelayMode: 'fixed',
      messageSplitDelayFixedMs: 500,
      messageSplitDelayMinMs: 100,
      messageSplitDelayMaxMs: 200,
      enableAutoSplit: false,
      reactionAck: 'off',
      ackTimeoutMs: 10000,
      agentAckMessage: 'Processing...',
    });

    const merged = mergeRouteOverrides(instance, route);

    expect(merged.agentTimeout).toBe(120);
    expect(merged.agentStreamMode).toBe(true);
    expect(merged.agentReplyFilter).toEqual({
      mode: 'filtered',
      conditions: { onDm: true, onMention: true, onReply: false, onNameMatch: false },
    });
    expect(merged.agentSessionStrategy).toBe('per_user');
    expect(merged.agentPrefixSenderName).toBe(false);
    expect(merged.agentWaitForMedia).toBe(true);
    expect(merged.agentSendMediaPath).toBe(true);
    expect(merged.agentGateEnabled).toBe(true);
    expect(merged.agentGateModel).toBe('gpt-4');
    expect(merged.agentGatePrompt).toBe('Is this relevant?');
    expect(merged.messageDebounceMode).toBe('disabled');
    expect(merged.messageDebounceMinMs).toBe(0);
    expect(merged.messageDebounceMaxMs).toBe(0);
    expect(merged.messageDebounceRestartOnTyping).toBe(true);
    expect(merged.messageSplitDelayMode).toBe('fixed');
    expect(merged.messageSplitDelayFixedMs).toBe(500);
    expect(merged.messageSplitDelayMinMs).toBe(100);
    expect(merged.messageSplitDelayMaxMs).toBe(200);
    expect(merged.enableAutoSplit).toBe(false);
    expect(merged.reactionAck).toBe('off');
    expect(merged.ackTimeoutMs).toBe(10000);
    expect(merged.agentAckMessage).toBe('Processing...');
  });

  it('partial route overrides only affect set fields', () => {
    const instance = makeInstance({
      agentTimeout: 60,
      messageDebounceMode: 'fixed',
      messageDebounceMinMs: 200,
    });
    const route = makeNullRoute({
      messageDebounceMode: 'disabled',
      // all other fields null → inherit from instance
    });

    const merged = mergeRouteOverrides(instance, route);

    expect(merged.messageDebounceMode).toBe('disabled');
    expect(merged.agentTimeout).toBe(60); // unchanged
    expect(merged.messageDebounceMinMs).toBe(200); // unchanged
  });

  it('preserves non-overridable instance fields', () => {
    const instance = makeInstance({ id: 'inst-1', name: 'Test' });
    const route = makeNullRoute();

    const merged = mergeRouteOverrides(instance, route);

    expect(merged.id).toBe('inst-1');
    expect(merged.name).toBe('Test');
    expect(merged.channel).toBe('whatsapp-baileys');
  });
});

describe('getDebounceConfig with route-resolved instance', () => {
  it('returns route debounce values after merge', () => {
    const instance = makeInstance({
      messageDebounceMode: 'fixed',
      messageDebounceMinMs: 200,
      messageDebounceMaxMs: 500,
      messageDebounceRestartOnTyping: false,
    });
    const route = makeNullRoute({
      messageDebounceMode: 'disabled',
      messageDebounceMinMs: 0,
      messageDebounceMaxMs: 0,
    });

    const merged = mergeRouteOverrides(instance, route);
    const config = getDebounceConfig(merged);

    expect(config.mode).toBe('disabled');
    expect(config.minMs).toBe(0);
    expect(config.maxMs).toBe(0);
    expect(config.restartOnTyping).toBe(false); // inherited from instance
  });

  it('route with messageDebounceMode: disabled → no debounce for that user', () => {
    const instance = makeInstance({
      messageDebounceMode: 'randomized',
      messageDebounceMinMs: 500,
      messageDebounceMaxMs: 2000,
    });
    const route = makeNullRoute({ messageDebounceMode: 'disabled' });

    const merged = mergeRouteOverrides(instance, route);
    const config = getDebounceConfig(merged);

    expect(config.mode).toBe('disabled');
    // minMs/maxMs inherited from instance since route has null for those
    expect(config.minMs).toBe(500);
    expect(config.maxMs).toBe(2000);
  });

  it('instance defaults used when no route', () => {
    const instance = makeInstance({
      messageDebounceMode: 'fixed',
      messageDebounceMinMs: 100,
      messageDebounceMaxMs: 100,
      messageDebounceRestartOnTyping: true,
    });

    const config = getDebounceConfig(instance);

    expect(config.mode).toBe('fixed');
    expect(config.minMs).toBe(100);
    expect(config.maxMs).toBe(100);
    expect(config.restartOnTyping).toBe(true);
  });
});

describe('getSplitDelayConfig with route-resolved instance', () => {
  it('returns route split delay values after merge', () => {
    const instance = makeInstance({
      messageSplitDelayMode: 'randomized',
      messageSplitDelayFixedMs: 0,
      messageSplitDelayMinMs: 300,
      messageSplitDelayMaxMs: 1000,
    });
    const route = makeNullRoute({
      messageSplitDelayMode: 'fixed',
      messageSplitDelayFixedMs: 500,
    });

    const merged = mergeRouteOverrides(instance, route);
    const config = getSplitDelayConfig(merged);

    expect(config.mode).toBe('fixed');
    expect(config.fixedMs).toBe(500);
    // minMs/maxMs inherited from instance
    expect(config.minMs).toBe(300);
    expect(config.maxMs).toBe(1000);
  });

  it('instance defaults used when no route overrides', () => {
    const instance = makeInstance();
    const config = getSplitDelayConfig(instance);

    expect(config.mode).toBe('randomized');
    expect(config.minMs).toBe(300);
    expect(config.maxMs).toBe(1000);
  });
});
