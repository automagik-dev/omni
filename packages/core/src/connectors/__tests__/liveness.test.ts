/**
 * Connector liveness sweeper unit tests (#961).
 *
 * Clock is injected (`now`), data access is an in-memory repo implementing
 * the guarded-transition contract, and the bus is a capturing mock — same
 * harness style as the follow-up sweeper tests.
 */

import { describe, expect, mock, test } from 'bun:test';
import type {
  ConnectorLivenessDeps,
  ConnectorLivenessRow,
  ConnectorRecoveredPayload,
  ConnectorStalledPayload,
} from '../liveness';
import { latestConnectorSignal, sweepConnectorLiveness } from '../liveness';

const T0 = new Date('2026-09-06T12:00:00.000Z');

function at(secondsAfterT0: number): Date {
  return new Date(T0.getTime() + secondsAfterT0 * 1000);
}

function makeRow(overrides: Partial<ConnectorLivenessRow> = {}): ConnectorLivenessRow {
  return {
    id: 'src-1',
    name: 'gmail-purchases',
    expectedIntervalSeconds: 60,
    lastReceivedAt: null,
    lastHeartbeatAt: null,
    livenessArmedAt: T0,
    livenessStatus: 'healthy',
    stalledAt: null,
    createdAt: T0,
    ...overrides,
  };
}

/** In-memory repo honoring the guarded-transition contract. */
function makeRepo(rows: ConnectorLivenessRow[]) {
  return {
    rows,
    findSupervised: async () => rows.map((r) => ({ ...r })),
    markStalled: async (id: string, atTime: Date) => {
      const row = rows.find((r) => r.id === id);
      if (!row || row.livenessStatus === 'stalled') return false;
      row.livenessStatus = 'stalled';
      row.stalledAt = atTime;
      return true;
    },
    markRecovered: async (id: string, _atTime: Date) => {
      const row = rows.find((r) => r.id === id);
      if (!row || row.livenessStatus !== 'stalled') return false;
      row.livenessStatus = 'healthy';
      row.stalledAt = null;
      return true;
    },
  };
}

function makeBus() {
  const published: Array<{ type: string; payload: Record<string, unknown>; metadata?: Record<string, unknown> }> = [];
  const publishGeneric = mock(
    async (type: string, payload: Record<string, unknown>, metadata?: Record<string, unknown>) => {
      published.push({ type, payload, metadata });
      return { id: `evt-${published.length}`, sequence: published.length, stream: 'SYSTEM' };
    },
  );
  return { published, bus: { publishGeneric } };
}

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function makeDeps(
  rows: ConnectorLivenessRow[],
  overrides: Partial<ConnectorLivenessDeps> = {},
): {
  deps: ConnectorLivenessDeps;
  repo: ReturnType<typeof makeRepo>;
  published: ReturnType<typeof makeBus>['published'];
} {
  const repo = makeRepo(rows);
  const { published, bus } = makeBus();
  return { deps: { repo, eventBus: bus, logger: silentLogger, ...overrides }, repo, published };
}

describe('latestConnectorSignal', () => {
  test('picks the most recent of event, heartbeat, and arm timestamps', () => {
    const row = makeRow({ lastReceivedAt: at(10), lastHeartbeatAt: at(30), livenessArmedAt: at(20) });
    expect(latestConnectorSignal(row)).toEqual({ at: at(30), kind: 'heartbeat' });
  });

  test('falls back to createdAt when nothing else is set', () => {
    const row = makeRow({ livenessArmedAt: null });
    expect(latestConnectorSignal(row)).toEqual({ at: T0, kind: 'rearmed' });
  });
});

describe('sweepConnectorLiveness — stall detection', () => {
  test('a source within its window is untouched', async () => {
    const { deps, repo, published } = makeDeps([makeRow({ lastReceivedAt: at(30) })]);
    const stats = await sweepConnectorLiveness({ ...deps, now: () => at(60) });

    expect(stats).toEqual({ scanned: 1, stalled: 0, recovered: 0, errors: 0 });
    expect(published).toHaveLength(0);
    expect(repo.rows[0]?.livenessStatus).toBe('healthy');
  });

  test('silence exactly at the window boundary does not stall (strictly beyond)', async () => {
    const { deps, published } = makeDeps([makeRow()]);
    await sweepConnectorLiveness({ ...deps, now: () => at(60) });
    expect(published).toHaveLength(0);
  });

  test('silence beyond the window emits system.connector.stalled once, with the stall persisted', async () => {
    const row = makeRow({ lastReceivedAt: at(5), tenantId: 'tenant-1' });
    const { deps, repo, published } = makeDeps([row]);

    const stats = await sweepConnectorLiveness({ ...deps, now: () => at(120) });

    expect(stats.stalled).toBe(1);
    expect(published).toHaveLength(1);
    expect(published[0]?.type).toBe('system.connector.stalled');
    const payload = published[0]?.payload as unknown as ConnectorStalledPayload;
    expect(payload.sourceId).toBe('src-1');
    expect(payload.sourceName).toBe('gmail-purchases');
    expect(payload.expectedIntervalSeconds).toBe(60);
    expect(payload.silentForSeconds).toBe(115);
    expect(payload.lastReceivedAt).toBe(at(5).getTime());
    expect(payload.stalledAt).toBe(at(120).getTime());
    expect(published[0]?.metadata).toMatchObject({ source: 'connector-liveness', tenantId: 'tenant-1' });
    expect(repo.rows[0]?.livenessStatus).toBe('stalled');
    expect(repo.rows[0]?.stalledAt).toEqual(at(120));

    // Subsequent ticks while still silent must not re-announce.
    await sweepConnectorLiveness({ ...deps, now: () => at(300) });
    await sweepConnectorLiveness({ ...deps, now: () => at(600) });
    expect(published).toHaveLength(1);
  });

  test('a lost guard race publishes nothing', async () => {
    const { deps, published } = makeDeps([makeRow()]);
    const stats = await sweepConnectorLiveness({
      ...deps,
      repo: { ...deps.repo, markStalled: async () => false },
      now: () => at(120),
    });
    expect(stats.stalled).toBe(0);
    expect(published).toHaveLength(0);
  });
});

describe('sweepConnectorLiveness — recovery', () => {
  function stalledRow(overrides: Partial<ConnectorLivenessRow> = {}): ConnectorLivenessRow {
    return makeRow({ livenessStatus: 'stalled', stalledAt: at(100), ...overrides });
  }

  test('a fresh heartbeat recovers the source once, recoveredBy=heartbeat', async () => {
    const { deps, repo, published } = makeDeps([stalledRow({ lastHeartbeatAt: at(190) })]);

    const stats = await sweepConnectorLiveness({ ...deps, now: () => at(200) });

    expect(stats.recovered).toBe(1);
    expect(published).toHaveLength(1);
    expect(published[0]?.type).toBe('system.connector.recovered');
    const payload = published[0]?.payload as unknown as ConnectorRecoveredPayload;
    expect(payload.recoveredBy).toBe('heartbeat');
    expect(payload.stalledForSeconds).toBe(100);
    expect(payload.recoveredAt).toBe(at(200).getTime());
    expect(repo.rows[0]?.livenessStatus).toBe('healthy');
    expect(repo.rows[0]?.stalledAt).toBeNull();

    // Second tick: healthy and within window → silent.
    await sweepConnectorLiveness({ ...deps, now: () => at(210) });
    expect(published).toHaveLength(1);
  });

  test('a fresh event recovers with recoveredBy=event', async () => {
    const { deps, published } = makeDeps([stalledRow({ lastReceivedAt: at(195) })]);
    await sweepConnectorLiveness({ ...deps, now: () => at(200) });
    expect((published[0]?.payload as unknown as ConnectorRecoveredPayload).recoveredBy).toBe('event');
  });

  test('re-declaring the cadence recovers with recoveredBy=rearmed', async () => {
    const { deps, published } = makeDeps([stalledRow({ livenessArmedAt: at(198) })]);
    await sweepConnectorLiveness({ ...deps, now: () => at(200) });
    expect((published[0]?.payload as unknown as ConnectorRecoveredPayload).recoveredBy).toBe('rearmed');
  });

  test('a stalled source that stays silent stays stalled without new events', async () => {
    const { deps, repo, published } = makeDeps([stalledRow()]);
    await sweepConnectorLiveness({ ...deps, now: () => at(500) });
    expect(published).toHaveLength(0);
    expect(repo.rows[0]?.livenessStatus).toBe('stalled');
  });
});

describe('sweepConnectorLiveness — hooks and resilience', () => {
  test('onStalled receives the payload and the published event id', async () => {
    const seen: Array<{ payload: ConnectorStalledPayload; eventId: string | null }> = [];
    const { deps, published } = makeDeps([makeRow()]);

    await sweepConnectorLiveness({
      ...deps,
      now: () => at(120),
      onStalled: async (_row, payload, eventId) => {
        seen.push({ payload, eventId });
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.eventId).toBe('evt-1');
    expect(seen[0]?.payload.sourceName).toBe('gmail-purchases');
    expect(published).toHaveLength(1);
  });

  test('onRecovered fires after a recovery transition', async () => {
    const recovered: ConnectorRecoveredPayload[] = [];
    const { deps } = makeDeps([makeRow({ livenessStatus: 'stalled', stalledAt: at(100), lastHeartbeatAt: at(195) })]);

    await sweepConnectorLiveness({
      ...deps,
      now: () => at(200),
      onRecovered: async (_row, payload) => {
        recovered.push(payload);
      },
    });

    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.recoveredBy).toBe('heartbeat');
  });

  test('a throwing hook does not fail the sweep and the event is still published', async () => {
    const { deps, published } = makeDeps([makeRow()]);
    const stats = await sweepConnectorLiveness({
      ...deps,
      now: () => at(120),
      onStalled: async () => {
        throw new Error('dlq down');
      },
    });
    expect(stats).toEqual({ scanned: 1, stalled: 1, recovered: 0, errors: 0 });
    expect(published).toHaveLength(1);
  });

  test('without an event bus the transition is still persisted', async () => {
    const { deps, repo } = makeDeps([makeRow()]);
    const stats = await sweepConnectorLiveness({ ...deps, eventBus: null, now: () => at(120) });
    expect(stats.stalled).toBe(1);
    expect(repo.rows[0]?.livenessStatus).toBe('stalled');
  });

  test('one failing row does not starve the others', async () => {
    const rows = [makeRow({ id: 'src-bad', name: 'bad' }), makeRow({ id: 'src-good', name: 'good' })];
    const { deps, repo, published } = makeDeps(rows);
    const originalMarkStalled = repo.markStalled;

    const stats = await sweepConnectorLiveness({
      ...deps,
      repo: {
        ...repo,
        markStalled: async (id: string, atTime: Date) => {
          if (id === 'src-bad') throw new Error('db hiccup');
          return originalMarkStalled(id, atTime);
        },
      },
      now: () => at(120),
    });

    expect(stats).toEqual({ scanned: 2, stalled: 1, recovered: 0, errors: 1 });
    expect(published).toHaveLength(1);
    expect((published[0]?.payload as unknown as ConnectorStalledPayload).sourceId).toBe('src-good');
  });
});
