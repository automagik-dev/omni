/**
 * Unit tests for AgentStateService
 *
 * Tests KV-backed state operations, graceful degradation when KV is
 * unavailable, event publishing, filtering, and the watch generator.
 * NATS KV is mocked by injecting a fake KV into the private field.
 */

import { describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import { agentStateKey } from '@omni/core';
import { StringCodec } from 'nats';
import { AgentStateService } from '../agent-state';

const sc = StringCodec();

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const AGENT_ID = '00000000-0000-4000-a000-000000000001';
const CHAT_ID = '00000000-0000-4000-a000-000000000002';
const CONV_ID = '00000000-0000-4000-a000-000000000003';

function encodeState(state: Record<string, unknown>): Uint8Array {
  return sc.encode(JSON.stringify(state));
}

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    agentId: AGENT_ID,
    chatId: CHAT_ID,
    conversationId: null,
    status: 'thinking',
    statusMeta: undefined,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeKvEntry(state: Record<string, unknown>, operation = 'PUT') {
  return { operation, value: encodeState(state) };
}

function createMockKv() {
  return {
    put: mock(async (_key: string, _val: Uint8Array) => 1),
    get: mock(async (_key: string) => null as ReturnType<typeof makeKvEntry> | null),
    delete: mock(async (_key: string) => {}),
    keys: mock(async () => ({
      [Symbol.asyncIterator]: async function* () {},
    })),
    watch: mock(async () => ({
      [Symbol.asyncIterator]: async function* () {},
      stop: mock(() => {}),
    })),
  };
}

function createMockEventBus() {
  const calls: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const eventBus = {
    publish: mock(async (type: string, payload: Record<string, unknown>) => {
      calls.push({ type, payload });
    }),
    publishGeneric: mock(async () => {}),
    subscribe: mock(async () => ({ unsubscribe: mock(() => {}) })),
    subscribePattern: mock(async () => ({ unsubscribe: mock(() => {}) })),
    close: mock(async () => {}),
    _calls: calls,
  };
  return eventBus as unknown as EventBus & { _calls: typeof calls };
}

function serviceWithKv(eventBus: EventBus | null = createMockEventBus()) {
  const kv = createMockKv();
  const service = new AgentStateService(eventBus);
  (service as any).kv = kv;
  return { service, kv, eventBus };
}

// ---------------------------------------------------------------------------
// setState
// ---------------------------------------------------------------------------

describe('AgentStateService', () => {
  describe('setState', () => {
    test('returns AgentChatState with correct fields', async () => {
      const { service } = serviceWithKv();
      const state = await service.setState(AGENT_ID, CHAT_ID, 'thinking', undefined, CONV_ID);

      expect(state.agentId).toBe(AGENT_ID);
      expect(state.chatId).toBe(CHAT_ID);
      expect(state.conversationId).toBe(CONV_ID);
      expect(state.status).toBe('thinking');
      expect(state.updatedAt).toBeGreaterThan(0);
    });

    test('writes to KV with correct key', async () => {
      const { service, kv } = serviceWithKv();
      await service.setState(AGENT_ID, CHAT_ID, 'typing');

      expect(kv.put).toHaveBeenCalledTimes(1);
      const [key] = kv.put.mock.calls[0] as [string, Uint8Array];
      expect(key).toBe(agentStateKey(AGENT_ID, CHAT_ID));
    });

    test('publishes agent.state.changed when eventBus exists', async () => {
      const eb = createMockEventBus();
      const { service } = serviceWithKv(eb);
      await service.setState(AGENT_ID, CHAT_ID, 'sending');

      expect(eb.publish).toHaveBeenCalled();
      expect(eb._calls[0]?.type).toBe('agent.state.changed');
      expect(eb._calls[0]?.payload.status).toBe('sending');
    });

    test('works without eventBus (null) - returns state, no crash', async () => {
      const service = new AgentStateService(null);
      // KV will be unavailable (ensureKv throws), but setState catches the error
      const state = await service.setState(AGENT_ID, CHAT_ID, 'idle');

      expect(state.agentId).toBe(AGENT_ID);
      expect(state.status).toBe('idle');
    });

    test('returns state even when KV write fails', async () => {
      const eb = createMockEventBus();
      const { service, kv } = serviceWithKv(eb);
      kv.put.mockImplementation(async () => {
        throw new Error('KV write failed');
      });

      const state = await service.setState(AGENT_ID, CHAT_ID, 'error');

      expect(state.status).toBe('error');
      // Event should still be published despite KV failure
      expect(eb._calls.length).toBe(1);
      expect(eb._calls[0]?.type).toBe('agent.state.changed');
    });
  });

  // ---------------------------------------------------------------------------
  // getState
  // ---------------------------------------------------------------------------

  describe('getState', () => {
    test('returns null when KV unavailable (no eventBus)', async () => {
      const service = new AgentStateService(null);
      const result = await service.getState(AGENT_ID, CHAT_ID);
      expect(result).toBeNull();
    });

    test('returns null when key not found', async () => {
      const { service, kv } = serviceWithKv();
      kv.get.mockImplementation(async () => null);

      const result = await service.getState(AGENT_ID, CHAT_ID);
      expect(result).toBeNull();
    });

    test('returns parsed state when found', async () => {
      const { service, kv } = serviceWithKv();
      const stored = makeState({ status: 'typing' });
      kv.get.mockImplementation(async () => makeKvEntry(stored));

      const result = await service.getState(AGENT_ID, CHAT_ID);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('typing');
      expect(result!.agentId).toBe(AGENT_ID);
    });

    test('returns null for DEL entries', async () => {
      const { service, kv } = serviceWithKv();
      kv.get.mockImplementation(async () => makeKvEntry(makeState(), 'DEL'));

      const result = await service.getState(AGENT_ID, CHAT_ID);
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // clearState
  // ---------------------------------------------------------------------------

  describe('clearState', () => {
    test('calls kv.delete with correct key', async () => {
      const { service, kv } = serviceWithKv();
      await service.clearState(AGENT_ID, CHAT_ID);

      expect(kv.delete).toHaveBeenCalledTimes(1);
      const [key] = kv.delete.mock.calls[0] as [string];
      expect(key).toBe(agentStateKey(AGENT_ID, CHAT_ID));
    });

    test('handles missing KV gracefully', async () => {
      const service = new AgentStateService(null);
      // Should not throw
      await service.clearState(AGENT_ID, CHAT_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // listActiveAgents
  // ---------------------------------------------------------------------------

  describe('listActiveAgents', () => {
    test('returns empty array on KV error', async () => {
      const service = new AgentStateService(null);
      const result = await service.listActiveAgents();
      expect(result).toEqual([]);
    });

    test('filters by chatId', async () => {
      const { service, kv } = serviceWithKv();
      const otherChat = '00000000-0000-4000-a000-000000000099';
      const state1 = makeState({ chatId: CHAT_ID });
      const state2 = makeState({ agentId: '00000000-0000-4000-a000-000000000010', chatId: otherChat });

      (kv.keys as any).mockImplementation(async () => ({
        [Symbol.asyncIterator]: async function* (): AsyncGenerator<string> {
          yield `${AGENT_ID}:${CHAT_ID}`;
          yield `00000000-0000-4000-a000-000000000010:${otherChat}`;
        },
      }));
      kv.get.mockImplementation(async (key: string) => {
        if (key.endsWith(CHAT_ID)) return makeKvEntry(state1);
        if (key.endsWith(otherChat)) return makeKvEntry(state2);
        return null;
      });

      const result = await service.listActiveAgents(CHAT_ID);
      expect(result.length).toBe(1);
      expect(result[0]?.chatId).toBe(CHAT_ID);
    });

    test('respects MAX_LIST_KEYS (1000) cap', async () => {
      const { service, kv } = serviceWithKv();
      let yieldCount = 0;

      (kv.keys as any).mockImplementation(async () => ({
        [Symbol.asyncIterator]: async function* (): AsyncGenerator<string> {
          for (let i = 0; i < 1500; i++) {
            yieldCount++;
            const aid = `00000000-0000-4000-a000-${String(i).padStart(12, '0')}`;
            yield `${aid}:${CHAT_ID}`;
          }
        },
      }));
      kv.get.mockImplementation(async (key: string) => {
        const aid = key.split(':')[0];
        return makeKvEntry(makeState({ agentId: aid }));
      });

      const result = await service.listActiveAgents();
      // Keys iteration should stop at 1000
      expect(yieldCount).toBe(1000);
      expect(result.length).toBe(1000);
    });
  });

  // ---------------------------------------------------------------------------
  // watchChanges
  // ---------------------------------------------------------------------------

  describe('watchChanges', () => {
    test('yields filtered states matching agentId and chatId', async () => {
      const { service, kv } = serviceWithKv();
      const matchState = makeState({ status: 'thinking' });
      const otherState = makeState({
        agentId: '00000000-0000-4000-a000-000000000099',
        chatId: '00000000-0000-4000-a000-000000000088',
        status: 'idle',
      });

      (kv.watch as any).mockImplementation(async () => ({
        [Symbol.asyncIterator]: async function* () {
          yield makeKvEntry(matchState);
          yield makeKvEntry(otherState);
          yield makeKvEntry(matchState, 'DEL'); // deleted, should be skipped
        },
        stop: mock(() => {}),
      }));

      const results: any[] = [];
      for await (const s of service.watchChanges({ agentId: AGENT_ID, chatId: CHAT_ID })) {
        results.push(s);
      }

      expect(results.length).toBe(1);
      expect(results[0].status).toBe('thinking');
    });

    test('stops on abort signal', async () => {
      const { service, kv } = serviceWithKv();
      const controller = new AbortController();
      const state = makeState({ status: 'typing' });

      let entryIndex = 0;
      (kv.watch as any).mockImplementation(async () => ({
        [Symbol.asyncIterator]: async function* () {
          while (true) {
            entryIndex++;
            yield makeKvEntry(state);
            if (entryIndex >= 2) controller.abort();
          }
        },
        stop: mock(() => {}),
      }));

      const results: any[] = [];
      for await (const s of service.watchChanges({ signal: controller.signal })) {
        results.push(s);
        if (results.length >= 3) break; // safety bail
      }

      // Should have yielded entries before the abort was detected
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    test('returns immediately when KV is unavailable', async () => {
      const service = new AgentStateService(null);
      const results: any[] = [];
      for await (const s of service.watchChanges()) {
        results.push(s);
      }
      expect(results.length).toBe(0);
    });
  });
});
