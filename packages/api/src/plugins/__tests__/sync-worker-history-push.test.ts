/**
 * History-Push Tracker Tests
 *
 * Verifies the sync.progress handler in setupHistoryPushTracker preserves the
 * stored `fetched` counter when a progress event omits the field, instead of
 * clobbering it to 0. Regression coverage for gemini-code-assist's MEDIUM
 * finding on PR #589 (sync-worker.ts:961, originally 947 on main).
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import { setupHistoryPushTracker } from '../sync-worker';

type ProgressHandler = (event: { payload: Record<string, unknown> }) => Promise<void>;

function createMockEventBus() {
  let progressHandler: ProgressHandler | null = null;
  return {
    subscribe: mock(async () => ({ unsubscribe: mock(async () => {}) })),
    subscribePattern: mock(async (pattern: string, callback: ProgressHandler) => {
      if (pattern === 'sync.progress.>') progressHandler = callback;
      return { unsubscribe: mock(async () => {}) };
    }),
    publish: mock(async () => ({ id: 'evt-1' })),
    close: mock(async () => {}),
    /** Helper: invoke the captured sync.progress.> subscriber */
    _triggerProgress: async (payload: Record<string, unknown>) => {
      if (!progressHandler) throw new Error('No sync.progress.> subscriber registered');
      await progressHandler({ payload });
    },
  } as any;
}

function createMockServices(activeJob: { id: string; type: string } | null = { id: 'job-hp', type: 'history-push' }) {
  return {
    syncJobs: {
      hasActiveJob: mock(async () => false),
      create: mock(async () => ({ id: 'job-hp' })),
      start: mock(async () => {}),
      complete: mock(async () => {}),
      fail: mock(async () => {}),
      getActiveForInstance: mock(async () => (activeJob ? [activeJob] : [])),
      updateProgress: mock(async () => {}),
    },
  };
}

describe('setupHistoryPushTracker — sync.progress.> handler', () => {
  let eventBus: ReturnType<typeof createMockEventBus>;
  let services: ReturnType<typeof createMockServices>;

  beforeEach(() => {
    eventBus = createMockEventBus();
    services = createMockServices();
  });

  test('progress event with fetched: number updates the counter', async () => {
    await setupHistoryPushTracker(eventBus as unknown as EventBus, services as any);
    await eventBus._triggerProgress({
      instanceId: 'inst-1',
      jobType: 'history-push',
      fetched: 100,
    });

    expect(services.syncJobs.updateProgress).toHaveBeenCalledTimes(1);
    const updateArgs = services.syncJobs.updateProgress.mock.calls[0] as unknown[];
    expect(updateArgs[0]).toBe('job-hp');
    expect(updateArgs[1]).toEqual({ fetched: 100 });
  });

  test('progress event with fetched: undefined does NOT reset the counter', async () => {
    await setupHistoryPushTracker(eventBus as unknown as EventBus, services as any);
    await eventBus._triggerProgress({
      instanceId: 'inst-1',
      jobType: 'history-push',
      // fetched intentionally omitted
    });

    // No update call at all — nothing to write, so we don't issue a no-op DB write
    expect(services.syncJobs.updateProgress).not.toHaveBeenCalled();
  });

  test('progress event with fetched: undefined and progress also does not reset', async () => {
    await setupHistoryPushTracker(eventBus as unknown as EventBus, services as any);
    await eventBus._triggerProgress({
      instanceId: 'inst-1',
      jobType: 'history-push',
      progress: 50,
      // fetched omitted — totalEstimated cannot be computed without it
    });

    // Without fetched, totalEstimated cannot be derived; nothing to update.
    expect(services.syncJobs.updateProgress).not.toHaveBeenCalled();
  });

  test('progress event with fetched and progress writes both fetched and totalEstimated', async () => {
    await setupHistoryPushTracker(eventBus as unknown as EventBus, services as any);
    await eventBus._triggerProgress({
      instanceId: 'inst-1',
      jobType: 'history-push',
      fetched: 50,
      progress: 25, // 25% complete -> total estimated = 50 / 0.25 = 200
    });

    expect(services.syncJobs.updateProgress).toHaveBeenCalledTimes(1);
    const updateArgs = services.syncJobs.updateProgress.mock.calls[0] as unknown[];
    expect(updateArgs[1]).toEqual({ fetched: 50, totalEstimated: 200 });
  });

  test('sequential events fetched=100, undefined, fetched=250 preserve counter (100 → 100 → 250)', async () => {
    await setupHistoryPushTracker(eventBus as unknown as EventBus, services as any);

    // Event 1: fetched=100 -> writes {fetched: 100}
    await eventBus._triggerProgress({
      instanceId: 'inst-1',
      jobType: 'history-push',
      fetched: 100,
    });
    expect(services.syncJobs.updateProgress).toHaveBeenCalledTimes(1);
    expect((services.syncJobs.updateProgress.mock.calls[0] as unknown[])[1]).toEqual({ fetched: 100 });

    // Event 2: fetched undefined -> no DB write, stored value (100) preserved by NOT being overwritten
    await eventBus._triggerProgress({
      instanceId: 'inst-1',
      jobType: 'history-push',
    });
    expect(services.syncJobs.updateProgress).toHaveBeenCalledTimes(1); // still 1

    // Event 3: fetched=250 -> writes {fetched: 250}
    await eventBus._triggerProgress({
      instanceId: 'inst-1',
      jobType: 'history-push',
      fetched: 250,
    });
    expect(services.syncJobs.updateProgress).toHaveBeenCalledTimes(2);
    expect((services.syncJobs.updateProgress.mock.calls[1] as unknown[])[1]).toEqual({ fetched: 250 });
  });

  test('progress event with fetched: 0 still updates (zero is a real value, not "missing")', async () => {
    await setupHistoryPushTracker(eventBus as unknown as EventBus, services as any);
    await eventBus._triggerProgress({
      instanceId: 'inst-1',
      jobType: 'history-push',
      fetched: 0,
    });

    expect(services.syncJobs.updateProgress).toHaveBeenCalledTimes(1);
    expect((services.syncJobs.updateProgress.mock.calls[0] as unknown[])[1]).toEqual({ fetched: 0 });
  });

  test('non-history-push events are ignored', async () => {
    await setupHistoryPushTracker(eventBus as unknown as EventBus, services as any);
    await eventBus._triggerProgress({
      instanceId: 'inst-1',
      jobType: 'messages',
      fetched: 100,
    });

    expect(services.syncJobs.getActiveForInstance).not.toHaveBeenCalled();
    expect(services.syncJobs.updateProgress).not.toHaveBeenCalled();
  });

  test('progress event with no active history-push job is a safe no-op', async () => {
    services = createMockServices(null);
    await setupHistoryPushTracker(eventBus as unknown as EventBus, services as any);
    await eventBus._triggerProgress({
      instanceId: 'inst-1',
      jobType: 'history-push',
      fetched: 100,
    });

    expect(services.syncJobs.updateProgress).not.toHaveBeenCalled();
  });
});
