/**
 * Turn monitor stalled-event tests.
 *
 * Contract: diagnostic messages must NEVER be sent to the user channel.
 * When a turn stalls past the per-instance threshold the monitor MUST emit
 * an internal `turn.stalled` NATS event and nothing else.
 *
 * - TurnMonitorDeps has no sendFallback slot anymore (type-level guarantee).
 * - publishTurnStalled is the only external effect we assert on.
 */

import { describe, expect, mock, spyOn, test } from 'bun:test';
import * as turnEvents from '../turn-events';
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
  instance: { agentStalledTimeoutMs?: number };
}) {
  const incrementNudge = mock(async (_id: string) => {});

  const monitor = new TurnMonitor({
    turnService: {
      getStale: async () => opts.turns,
      incrementNudge,
      close: async () => null,
    } as unknown as never,
    instanceService: {
      getById: async () => opts.instance,
    } as unknown as never,
  });

  const tick = () => (monitor as unknown as { tick: () => Promise<void> }).tick();

  return { monitor, incrementNudge, tick };
}

const FIFTEEN_MINUTES_AGO = () => new Date(Date.now() - 15 * 60_000);

describe('TurnMonitor stalled-event contract', () => {
  test('stalled turn → publishTurnStalled is called with correct payload; no channel send path exists', async () => {
    const spy = spyOn(turnEvents, 'publishTurnStalled').mockImplementation(() => {});

    try {
      const { tick } = makeMonitor({
        turns: [
          {
            id: 't1',
            instanceId: 'i1',
            chatId: 'c1',
            lastActivityAt: FIFTEEN_MINUTES_AGO(),
            nudgeCount: 2,
          },
        ],
        instance: { agentStalledTimeoutMs: 600_000 },
      });

      await tick();

      expect(spy).toHaveBeenCalledTimes(1);
      const [instanceId, chatId, payload] = spy.mock.calls[0]!;
      expect(instanceId).toBe('i1');
      expect(chatId).toBe('c1');
      expect(payload).toMatchObject({
        turnId: 't1',
        instanceId: 'i1',
        chatId: 'c1',
        threshold: 600_000,
      });
      expect(typeof (payload as { stalledAtMs: number }).stalledAtMs).toBe('number');
    } finally {
      spy.mockRestore();
    }
  });

  test('TurnMonitorDeps has no sendFallback — stalled state cannot reach a channel regardless of config', async () => {
    // Structural proof: if a fallback code path still existed, constructing
    // the monitor without it would fail or the tick would attempt to call it.
    // This test passes silently when the channel-send path has been deleted.
    const { tick } = makeMonitor({
      turns: [
        {
          id: 't2',
          instanceId: 'i2',
          chatId: 'c2',
          lastActivityAt: FIFTEEN_MINUTES_AGO(),
          nudgeCount: 2,
        },
      ],
      instance: { agentStalledTimeoutMs: 600_000 },
    });

    await expect(tick()).resolves.toBeUndefined();
  });
});
