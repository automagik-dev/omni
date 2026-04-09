/**
 * Turn monitor fallback config tests (wish: unify-bridge-revamp-skills#2).
 *
 * Covers the per-instance fallback config contract:
 *   - agentFallbackEnabled=false → sendFallback is never called
 *   - agentFallbackMessage=<custom> → sendFallback receives the exact custom text
 *   - live config re-read: changing instance between ticks takes effect on the next tick
 */

import { describe, expect, mock, test } from 'bun:test';
import { TurnMonitor } from '../turn-monitor';

type StubTurn = {
  id: string;
  instanceId: string;
  chatId: string;
  lastActivityAt: Date;
  nudgeCount: number;
};

function makeMonitor(opts: {
  turns: StubTurn[];
  instance: {
    agentFallbackEnabled: boolean;
    agentFallbackMessage: string | null;
    agentFallbackTimeoutMs?: number;
  };
}) {
  const sendFallback = mock(async (_instanceId: string, _chatId: string, _text: string) => {});
  const incrementNudge = mock(async (_id: string) => {});

  const monitor = new TurnMonitor({
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    turnService: {
      getStale: async () => opts.turns,
      incrementNudge,
      close: async () => null,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
    } as any,
    // biome-ignore lint/suspicious/noExplicitAny: test stub
    instanceService: {
      getById: async () => opts.instance,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
    } as any,
    sendFallback,
  });

  // Private tick — invoke via bracket access.
  // biome-ignore lint/suspicious/noExplicitAny: reach into private method for direct tick invocation
  const tick = () => (monitor as any).tick();

  return { monitor, sendFallback, incrementNudge, tick };
}

const FIFTEEN_MINUTES_AGO = () => new Date(Date.now() - 15 * 60_000);

describe('TurnMonitor fallback config', () => {
  test('agentFallbackEnabled=false → sendFallback is never called', async () => {
    const { sendFallback, tick } = makeMonitor({
      turns: [
        {
          id: 't1',
          instanceId: 'i1',
          chatId: 'c1',
          lastActivityAt: FIFTEEN_MINUTES_AGO(),
          nudgeCount: 2, // exactly the state that would trigger fallback
        },
      ],
      instance: {
        agentFallbackEnabled: false,
        agentFallbackMessage: null,
        agentFallbackTimeoutMs: 600_000,
      },
    });

    await tick();

    expect(sendFallback).not.toHaveBeenCalled();
  });

  test('agentFallbackMessage=<custom> → sendFallback receives exact message', async () => {
    const custom = 'Hang tight, the agent is still thinking…';
    const { sendFallback, tick } = makeMonitor({
      turns: [
        {
          id: 't2',
          instanceId: 'i2',
          chatId: 'c2',
          lastActivityAt: FIFTEEN_MINUTES_AGO(),
          nudgeCount: 2,
        },
      ],
      instance: {
        agentFallbackEnabled: true,
        agentFallbackMessage: custom,
        agentFallbackTimeoutMs: 600_000,
      },
    });

    await tick();

    expect(sendFallback).toHaveBeenCalledTimes(1);
    const [instanceId, chatId, text] = sendFallback.mock.calls[0]!;
    expect(instanceId).toBe('i2');
    expect(chatId).toBe('c2');
    expect(text).toBe(custom);
  });

  test('live config re-read: toggling agentFallbackEnabled between ticks takes effect on the next tick', async () => {
    const sendFallback = mock(async (_instanceId: string, _chatId: string, _text: string) => {});
    let enabled = true;

    const monitor = new TurnMonitor({
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      turnService: {
        getStale: async () => [
          {
            id: 't3',
            instanceId: 'i3',
            chatId: 'c3',
            lastActivityAt: FIFTEEN_MINUTES_AGO(),
            nudgeCount: 2,
          },
        ],
        incrementNudge: async () => {},
        close: async () => null,
        // biome-ignore lint/suspicious/noExplicitAny: test stub
      } as any,
      // biome-ignore lint/suspicious/noExplicitAny: test stub
      instanceService: {
        getById: async () => ({
          agentFallbackEnabled: enabled,
          agentFallbackMessage: null,
          agentFallbackTimeoutMs: 600_000,
        }),
        // biome-ignore lint/suspicious/noExplicitAny: test stub
      } as any,
      sendFallback,
    });

    // biome-ignore lint/suspicious/noExplicitAny: private method
    const tick = () => (monitor as any).tick();

    // First tick: enabled → fires
    await tick();
    expect(sendFallback).toHaveBeenCalledTimes(1);

    // Operator toggles the instance via CLI → next tick must honor the new value without a restart.
    enabled = false;
    await tick();
    expect(sendFallback).toHaveBeenCalledTimes(1); // still 1, no new call
  });
});
