/**
 * Tests for DecryptFailureTracker — dynamic JID blocking for broken sessions (#70)
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { DecryptFailureTracker } from '../utils/decrypt-failure-tracker';

describe('DecryptFailureTracker', () => {
  let tracker: DecryptFailureTracker;

  beforeEach(() => {
    tracker = new DecryptFailureTracker({
      threshold: 3,
      windowMs: 1_000,
      blockDurationMs: 2_000,
    });
  });

  afterEach(() => {
    tracker.clearAll();
  });

  it('does not block JIDs below threshold', () => {
    tracker.recordFailure('bad@lid');
    tracker.recordFailure('bad@lid');
    expect(tracker.shouldIgnore('bad@lid')).toBe(false);
  });

  it('blocks JID after reaching threshold', () => {
    tracker.recordFailure('bad@lid');
    tracker.recordFailure('bad@lid');
    tracker.recordFailure('bad@lid');
    expect(tracker.shouldIgnore('bad@lid')).toBe(true);
  });

  it('does not affect other JIDs', () => {
    tracker.recordFailure('bad@lid');
    tracker.recordFailure('bad@lid');
    tracker.recordFailure('bad@lid');
    expect(tracker.shouldIgnore('good@lid')).toBe(false);
  });

  it('normalizes JID device suffix for consistent tracking', () => {
    tracker.recordFailure('sender@lid');
    tracker.recordFailure('sender:5@lid');
    tracker.recordFailure('sender:99@lid');
    expect(tracker.shouldIgnore('sender:0@lid')).toBe(true);
  });

  it('unblocks after blockDurationMs expires', async () => {
    // Use a very short block duration for testing
    const fastTracker = new DecryptFailureTracker({
      threshold: 2,
      windowMs: 1_000,
      blockDurationMs: 50,
    });

    fastTracker.recordFailure('temp@lid');
    fastTracker.recordFailure('temp@lid');
    expect(fastTracker.shouldIgnore('temp@lid')).toBe(true);

    // Wait for block to expire
    await new Promise((r) => setTimeout(r, 100));
    expect(fastTracker.shouldIgnore('temp@lid')).toBe(false);
    fastTracker.clearAll();
  });

  it('clear() removes tracking for a JID', () => {
    tracker.recordFailure('bad@lid');
    tracker.recordFailure('bad@lid');
    tracker.recordFailure('bad@lid');
    expect(tracker.shouldIgnore('bad@lid')).toBe(true);

    tracker.clear('bad@lid');
    expect(tracker.shouldIgnore('bad@lid')).toBe(false);
  });

  it('clearAll() removes all tracking state', () => {
    tracker.recordFailure('a@lid');
    tracker.recordFailure('a@lid');
    tracker.recordFailure('a@lid');
    tracker.recordFailure('b@lid');
    tracker.recordFailure('b@lid');
    tracker.recordFailure('b@lid');

    tracker.clearAll();
    expect(tracker.shouldIgnore('a@lid')).toBe(false);
    expect(tracker.shouldIgnore('b@lid')).toBe(false);
  });

  it('re-blocks after unblock if failures continue', async () => {
    const fastTracker = new DecryptFailureTracker({
      threshold: 2,
      windowMs: 1_000,
      blockDurationMs: 50,
    });

    // First block
    fastTracker.recordFailure('bad@lid');
    fastTracker.recordFailure('bad@lid');
    expect(fastTracker.shouldIgnore('bad@lid')).toBe(true);

    // Wait for unblock
    await new Promise((r) => setTimeout(r, 100));
    expect(fastTracker.shouldIgnore('bad@lid')).toBe(false);

    // Fail again → re-block
    fastTracker.recordFailure('bad@lid');
    fastTracker.recordFailure('bad@lid');
    expect(fastTracker.shouldIgnore('bad@lid')).toBe(true);
    fastTracker.clearAll();
  });
});
