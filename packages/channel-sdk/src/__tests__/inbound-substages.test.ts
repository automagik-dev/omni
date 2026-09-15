/**
 * T0→T1 sub-stage checkpoints (#1179): T0a/T0b are recorded between T0 and T1.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { getJourneyTracker, resetJourneyTracker } from '@omni/core/tracing';
import { BaseChannelPlugin, type InboundSubStageTimings } from '../base/BaseChannelPlugin';

type Timings = Record<string, number>;
const plugin = Object.create(BaseChannelPlugin.prototype) as {
  captureInboundTimings(t0: number, sub?: InboundSubStageTimings): Timings | undefined;
  captureT2(correlationId: string, timings: Timings): void;
};

afterEach(() => resetJourneyTracker());

describe('inbound sub-stage checkpoints', () => {
  it('records T0, T0a, T0b, T1, T2 in order with sub-stage latencies', () => {
    const timings = plugin.captureInboundTimings(1000, { ingestedAt: 1500, mediaReadyAt: 4000 });
    expect(timings).toBeDefined();
    plugin.captureT2('corr-sub', timings as Timings);

    const journey = getJourneyTracker().getJourney('corr-sub');
    expect(journey?.checkpoints.map((c) => c.stage)).toEqual(['T0', 'T0a', 'T0b', 'T1', 'T2']);
    expect(journey?.latencies.platformDelivery).toBe(500);
    expect(journey?.latencies.mediaDownload).toBe(2500);
    expect(journey?.latencies.inboundEnrichment).toBe((timings as Timings).pluginReceivedAt - 4000);
  });

  it('keeps the legacy T0/T1/T2 shape when no sub-stages are passed', () => {
    plugin.captureT2('corr-legacy', plugin.captureInboundTimings(1000) as Timings);
    const journey = getJourneyTracker().getJourney('corr-legacy');
    expect(journey?.checkpoints.map((c) => c.stage)).toEqual(['T0', 'T1', 'T2']);
    expect(journey?.latencies.mediaDownload).toBeUndefined();
  });
});
