/**
 * Journeys API Tests
 *
 * Tests for the journey tracing endpoints.
 * These don't need a database — JourneyTracker is in-memory.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getJourneyTracker, resetJourneyTracker } from '@omni/core';
import { Hono } from 'hono';
import { journeysRoutes } from '../routes/v2/journeys';
import type { AppVariables } from '../types';

// biome-ignore lint/suspicious/noExplicitAny: test helper for JSON responses
async function json(res: Response): Promise<any> {
  return res.json();
}

describe('Journeys API', () => {
  let app: Hono<{ Variables: AppVariables }>;

  beforeEach(() => {
    resetJourneyTracker();
    app = new Hono<{ Variables: AppVariables }>();
    app.route('/journeys', journeysRoutes);
  });

  afterEach(() => {
    resetJourneyTracker();
  });

  describe('GET /journeys/:correlationId', () => {
    test('returns 404 for unknown correlation ID', async () => {
      const res = await app.request('/journeys/unknown-id');
      expect(res.status).toBe(404);
      const body = await json(res);
      expect(body.error.code).toBe('JOURNEY_NOT_FOUND');
    });

    test('returns journey with checkpoints and latencies', async () => {
      const tracker = getJourneyTracker();
      tracker.recordCheckpoint('test-corr-1', 'T0', 'platformReceivedAt', 1000);
      tracker.recordCheckpoint('test-corr-1', 'T1', 'pluginReceivedAt', 1052);
      tracker.recordCheckpoint('test-corr-1', 'T2', 'eventPublishedAt', 1075);

      const res = await app.request('/journeys/test-corr-1');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.correlationId).toBe('test-corr-1');
      expect(body.checkpoints).toHaveLength(3);
      expect(body.latencies.channelProcessing).toBe(52);
      expect(body.latencies.eventPublish).toBe(23);
    });

    test('returns completed journey with all stages', async () => {
      const tracker = getJourneyTracker();
      tracker.recordCheckpoint('full', 'T0', 'platformReceivedAt', 1000);
      tracker.recordCheckpoint('full', 'T1', 'pluginReceivedAt', 1052);
      tracker.recordCheckpoint('full', 'T2', 'eventPublishedAt', 1075);
      tracker.recordCheckpoint('full', 'T3', 'eventConsumedAt', 1090);
      tracker.recordCheckpoint('full', 'T4', 'dbStoredAt', 1217);
      tracker.recordCheckpoint('full', 'T5', 'agentNotifiedAt', 1251);
      tracker.recordCheckpoint('full', 'T7', 'agentCompletedAt', 3093);
      tracker.recordCheckpoint('full', 'T8', 'apiProcessedAt', 3111);
      tracker.recordCheckpoint('full', 'T9', 'outboundEventPublishedAt', 3126);
      tracker.recordCheckpoint('full', 'T10', 'pluginSentAt', 3149);
      tracker.recordCheckpoint('full', 'T11', 'platformDeliveredAt', 3243);

      const res = await app.request('/journeys/full');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.completedAt).toBe(3243);
      expect(body.latencies.totalRoundTrip).toBe(2243);
      expect(body.latencies.omniProcessing).toBe(401);
    });
  });

  describe('GET /journeys/summary', () => {
    test('returns empty summary when no journeys tracked', async () => {
      const res = await app.request('/journeys/summary');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.totalTracked).toBe(0);
      expect(body.completedJourneys).toBe(0);
      expect(body.activeJourneys).toBe(0);
    });

    test('returns aggregated metrics', async () => {
      const tracker = getJourneyTracker();

      // Fast journey
      tracker.recordCheckpoint('fast', 'T0', 'platformReceivedAt', 1000);
      tracker.recordCheckpoint('fast', 'T1', 'pluginReceivedAt', 1010);

      // Slow journey
      tracker.recordCheckpoint('slow', 'T0', 'platformReceivedAt', 2000);
      tracker.recordCheckpoint('slow', 'T1', 'pluginReceivedAt', 2100);

      const res = await app.request('/journeys/summary');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.totalTracked).toBe(2);
      expect(body.stages.channelProcessing).toBeDefined();
      expect(body.stages.channelProcessing.count).toBe(2);
      expect(body.stages.channelProcessing.avg).toBe(55);
    });

    test('supports relative since parameter (e.g., 1h)', async () => {
      const tracker = getJourneyTracker();
      const now = Date.now();

      // Old journey (2 hours ago)
      tracker.recordCheckpoint('old', 'T0', 'platformReceivedAt', now - 7_200_000);
      tracker.recordCheckpoint('old', 'T1', 'pluginReceivedAt', now - 7_199_950);

      // Recent journey (5 minutes ago)
      tracker.recordCheckpoint('recent', 'T0', 'platformReceivedAt', now - 300_000);
      tracker.recordCheckpoint('recent', 'T1', 'pluginReceivedAt', now - 299_980);

      const res = await app.request('/journeys/summary?since=1h');
      expect(res.status).toBe(200);

      const body = await json(res);
      expect(body.totalTracked).toBe(1); // Only the recent one
    });
  });
});
