/**
 * Tests for triggerErrorHandoff — the system-initiated handoff on agent errors
 * for native-handoff channels (Gupshup).
 *
 * The critical invariant (gemini review on #741): once the HANDOFF message is
 * delivered, a failure in the persistence side-effects must STILL return true,
 * so the caller does NOT send a second (plain error) message to the user.
 */

import { describe, expect, it, mock } from 'bun:test';

// Configurable plugin mock for `getPlugin`. Tests mutate `pluginState` per case.
const pluginState: {
  canHandoff: boolean;
  sendMessage: (...args: unknown[]) => Promise<{ messageId: string }>;
} = {
  canHandoff: true,
  sendMessage: mock(() => Promise.resolve({ messageId: 'msg-1' })),
};

mock.module('../loader', () => ({
  getPlugin: mock(() =>
    Promise.resolve({
      capabilities: { canHandoff: pluginState.canHandoff },
      sendMessage: pluginState.sendMessage,
    }),
  ),
}));

import { triggerErrorHandoff } from '../agent-dispatcher';

// Minimal stand-ins; only the fields triggerErrorHandoff touches are present.
function makeServices(overrides: Record<string, unknown> = {}) {
  return {
    chats: {
      findByExternalIdSmart: mock(() => Promise.resolve({ id: 'chat-uuid', settings: {} })),
      update: mock(() => Promise.resolve(undefined)),
    },
    followUpLifecycle: { disarm: mock(() => Promise.resolve(undefined)) },
    ...overrides,
  } as never;
}

function makeDb() {
  return { insert: () => ({ values: mock(() => Promise.resolve(undefined)) }) } as never;
}

const instance = { id: 'inst-1', agentId: 'agent-1' } as never;

describe('triggerErrorHandoff', () => {
  it('returns false on a non-handoff channel (no message sent)', async () => {
    pluginState.canHandoff = false;
    const ok = await triggerErrorHandoff(makeServices(), makeDb(), 'whatsapp' as never, instance, '5511999', 'oi');
    expect(ok).toBe(false);
    pluginState.canHandoff = true;
  });

  it('returns false when the HANDOFF message delivery fails (safe to fall back)', async () => {
    pluginState.sendMessage = mock(() => Promise.reject(new Error('network down')));
    const ok = await triggerErrorHandoff(makeServices(), makeDb(), 'gupshup' as never, instance, '5511999', 'oi');
    expect(ok).toBe(false);
    pluginState.sendMessage = mock(() => Promise.resolve({ messageId: 'msg-1' }));
  });

  it('returns true even when a side-effect fails — no double message', async () => {
    // Message delivered, but chats.update throws. Must still return true.
    const services = makeServices({
      chats: {
        findByExternalIdSmart: mock(() => Promise.resolve({ id: 'chat-uuid', settings: {} })),
        update: mock(() => Promise.reject(new Error('db down'))),
      },
    });
    const ok = await triggerErrorHandoff(services, makeDb(), 'gupshup' as never, instance, '5511999', 'oi');
    expect(ok).toBe(true);
  });

  it('returns true on the happy path (message + side-effects persisted)', async () => {
    const ok = await triggerErrorHandoff(makeServices(), makeDb(), 'gupshup' as never, instance, '5511999', 'oi');
    expect(ok).toBe(true);
  });
});
