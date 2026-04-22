/**
 * Tests for the stale-inbound guard in the agent dispatcher.
 *
 * Defends against Baileys history-sync replays and NATS redelivery resurrecting
 * old conversations after reconnect/restart. Drops inbound `message.received`
 * events when the platform-native timestamp (e.g. WhatsApp `messageTimestamp`)
 * is older than `instance.inboundMaxAgeMinutes` (default 10).
 */

import { describe, expect, it } from 'bun:test';
import { isInboundTooStale } from '../plugins/agent-dispatcher';

const NOW = new Date('2026-04-15T16:30:00Z').getTime();

describe('isInboundTooStale', () => {
  it('returns stale=false for a fresh message (seconds old)', () => {
    const rawPayload = { messageTimestamp: Math.floor(NOW / 1000) - 5 };
    const result = isInboundTooStale(rawPayload, 10, NOW);
    expect(result.stale).toBe(false);
    expect(result.ageMs).toBeLessThan(60_000);
  });

  it('returns stale=false right at the threshold boundary', () => {
    const rawPayload = { messageTimestamp: Math.floor(NOW / 1000) - 10 * 60 };
    const result = isInboundTooStale(rawPayload, 10, NOW);
    expect(result.stale).toBe(false);
    expect(result.ageMs).toBe(10 * 60_000);
  });

  it('returns stale=true when message is older than threshold', () => {
    const rawPayload = { messageTimestamp: Math.floor(NOW / 1000) - 11 * 60 };
    const result = isInboundTooStale(rawPayload, 10, NOW);
    expect(result.stale).toBe(true);
    expect(result.ageMs).toBeGreaterThan(10 * 60_000);
  });

  it('catches the incident case: 1h-old replay with default 10min threshold', () => {
    // Mirrors the production replay: WA messageTimestamp ~1h old, redelivered
    // by Baileys history-sync after reconnect.
    const rawPayload = { messageTimestamp: Math.floor(NOW / 1000) - 60 * 60 };
    const result = isInboundTooStale(rawPayload, 10, NOW);
    expect(result.stale).toBe(true);
  });

  it('disables the guard when maxAgeMinutes=0', () => {
    const rawPayload = { messageTimestamp: Math.floor(NOW / 1000) - 24 * 60 * 60 };
    const result = isInboundTooStale(rawPayload, 0, NOW);
    expect(result.stale).toBe(false);
  });

  it('disables the guard when maxAgeMinutes is negative', () => {
    const rawPayload = { messageTimestamp: Math.floor(NOW / 1000) - 24 * 60 * 60 };
    const result = isInboundTooStale(rawPayload, -1, NOW);
    expect(result.stale).toBe(false);
  });

  it('treats missing rawPayload.messageTimestamp as fresh (fallback = now)', () => {
    const result = isInboundTooStale(undefined, 10, NOW);
    expect(result.stale).toBe(false);
  });

  it('treats rawPayload without messageTimestamp as fresh', () => {
    const result = isInboundTooStale({ other: 'field' }, 10, NOW);
    expect(result.stale).toBe(false);
  });

  it('handles WA protobuf Long timestamp format', () => {
    // Baileys sometimes emits messageTimestamp as { low, high, unsigned }.
    // Verify the helper doesn't crash and treats unparseable timestamps as
    // fresh (fallback to `now`) rather than dropping valid messages.
    const rawPayload = {
      messageTimestamp: { low: Math.floor(NOW / 1000) - 30, high: 0, unsigned: true },
    };
    const result = isInboundTooStale(rawPayload, 10, NOW);
    expect(result.stale).toBe(false);
  });

  it('accepts messageTimestamp as a string (seconds)', () => {
    const rawPayload = { messageTimestamp: String(Math.floor(NOW / 1000) - 30) };
    const result = isInboundTooStale(rawPayload, 10, NOW);
    expect(result.stale).toBe(false);
  });
});
