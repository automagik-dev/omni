/**
 * Unit tests for the idle-timeout delivery identity claim used by
 * `FollowUpLifecycleService.evaluateIdleTimeoutFreshness`.
 *
 * The gate can no longer discriminate redeliveries by sequence distance: the
 * sweeper publishes event N and immediately records N+1, so a healthy first
 * delivery and a JetStream redelivery of N both see `row = event + 1`
 * (f149179a). Identity — (chat, instance, sequenceIndex) — is what separates
 * them.
 *
 * No database required; the claim store is in-process.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { claimIdleTimeoutDelivery, resetIdleTimeoutClaims } from '../services/follow-up-lifecycle';

const CHAT = 'chat-1';
const INSTANCE = 'inst-1';

describe('claimIdleTimeoutDelivery', () => {
  beforeEach(() => {
    resetIdleTimeoutClaims();
  });

  test('first delivery of an event claims it', () => {
    expect(claimIdleTimeoutDelivery(CHAT, INSTANCE, 0)).toBe(true);
  });

  test('redelivery of the same event does not claim', () => {
    expect(claimIdleTimeoutDelivery(CHAT, INSTANCE, 0)).toBe(true);
    expect(claimIdleTimeoutDelivery(CHAT, INSTANCE, 0)).toBe(false);
    expect(claimIdleTimeoutDelivery(CHAT, INSTANCE, 0)).toBe(false);
  });

  test('the next event in the same sequence claims independently', () => {
    expect(claimIdleTimeoutDelivery(CHAT, INSTANCE, 0)).toBe(true);
    expect(claimIdleTimeoutDelivery(CHAT, INSTANCE, 1)).toBe(true);
    expect(claimIdleTimeoutDelivery(CHAT, INSTANCE, 2)).toBe(true);
  });

  test('claims are scoped per chat and per instance', () => {
    expect(claimIdleTimeoutDelivery(CHAT, INSTANCE, 0)).toBe(true);
    expect(claimIdleTimeoutDelivery('chat-2', INSTANCE, 0)).toBe(true);
    expect(claimIdleTimeoutDelivery(CHAT, 'inst-2', 0)).toBe(true);
  });

  test('events without a sequence index always claim (no identity to dedupe on)', () => {
    expect(claimIdleTimeoutDelivery(CHAT, INSTANCE, null)).toBe(true);
    expect(claimIdleTimeoutDelivery(CHAT, INSTANCE, null)).toBe(true);
  });

  test('claims expire after the TTL so the store stays bounded', () => {
    const t0 = Date.now();
    expect(claimIdleTimeoutDelivery(CHAT, INSTANCE, 0, t0)).toBe(true);
    expect(claimIdleTimeoutDelivery(CHAT, INSTANCE, 0, t0 + 60_000)).toBe(false);
    // 6h TTL — far beyond any ack-wait redelivery window.
    expect(claimIdleTimeoutDelivery(CHAT, INSTANCE, 0, t0 + 7 * 60 * 60 * 1000)).toBe(true);
  });
});
