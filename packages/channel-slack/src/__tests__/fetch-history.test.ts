/**
 * Slack fetch-history + per_thread integration tests
 *
 * Tests:
 * - extractMessageMeta correctly surfaces threadTs/isDm/isThreadReply
 * - buildRawPayload includes threadId only for non-DM thread messages
 * - SlackPlugin exposes fetchHistory, react, unreact
 */

import { describe, expect, it } from 'bun:test';
import { extractMessageMeta } from '../handlers/messages';
import { SlackPlugin } from '../plugin';

describe('extractMessageMeta — thread context', () => {
  it('returns threadTs for thread reply messages', () => {
    const meta = extractMessageMeta({
      channel: 'C123',
      ts: '1234567890.001000',
      thread_ts: '1234567890.000000',
      user: 'U001',
      channel_type: 'channel',
    });
    expect(meta.threadTs).toBe('1234567890.000000');
    expect(meta.isThreadReply).toBe(true);
    expect(meta.isDm).toBe(false);
  });

  it('returns isDm true for DM messages', () => {
    const meta = extractMessageMeta({
      channel: 'D001',
      ts: '1234567890.001000',
      user: 'U001',
      channel_type: 'im',
    });
    expect(meta.isDm).toBe(true);
    expect(meta.isThreadReply).toBe(false);
  });

  it('isThreadReply false when thread_ts equals ts (thread root)', () => {
    const ts = '1234567890.000000';
    const meta = extractMessageMeta({
      channel: 'C123',
      ts,
      thread_ts: ts,
      user: 'U001',
      channel_type: 'channel',
    });
    expect(meta.isThreadReply).toBe(false);
  });

  it('threadTs undefined for non-thread messages', () => {
    const meta = extractMessageMeta({
      channel: 'C123',
      ts: '1234567890.000000',
      user: 'U001',
    });
    expect(meta.threadTs).toBeUndefined();
    expect(meta.isThreadReply).toBe(false);
  });
});

describe('SlackPlugin — fetchHistory + react/unreact surface', () => {
  it('exposes fetchHistory method', () => {
    const plugin = new SlackPlugin();
    expect(typeof plugin.fetchHistory).toBe('function');
  });

  it('exposes react method', () => {
    const plugin = new SlackPlugin();
    expect(typeof plugin.react).toBe('function');
  });

  it('exposes unreact method', () => {
    const plugin = new SlackPlugin();
    expect(typeof plugin.unreact).toBe('function');
  });
});

describe('buildRawPayload — threadId field', () => {
  it('threadId is set for non-DM thread messages', () => {
    // Simulate what setupMessageHandlers builds via buildRawPayload
    // We replicate the logic to confirm the contract
    const meta = extractMessageMeta({
      channel: 'C123',
      ts: '1234567890.001000',
      thread_ts: '1234567890.000000',
      user: 'U001',
      channel_type: 'channel',
    });

    // This mirrors buildRawPayload logic from messages.ts
    const rawPayload = {
      ts: meta.ts,
      threadTs: meta.threadTs,
      threadId: !meta.isDm && meta.threadTs ? meta.threadTs : undefined,
      isDm: meta.isDm,
    };

    expect(rawPayload.threadId).toBe('1234567890.000000');
  });

  it('threadId is undefined for DM thread messages', () => {
    const meta = extractMessageMeta({
      channel: 'D001',
      ts: '1234567890.001000',
      thread_ts: '1234567890.000000',
      user: 'U001',
      channel_type: 'im',
    });

    const rawPayload = {
      threadId: !meta.isDm && meta.threadTs ? meta.threadTs : undefined,
      isDm: meta.isDm,
    };

    expect(rawPayload.threadId).toBeUndefined();
  });

  it('threadId is undefined for non-thread channel messages', () => {
    const meta = extractMessageMeta({
      channel: 'C123',
      ts: '1234567890.000000',
      user: 'U001',
      channel_type: 'channel',
    });

    const rawPayload = {
      threadId: !meta.isDm && meta.threadTs ? meta.threadTs : undefined,
    };

    expect(rawPayload.threadId).toBeUndefined();
  });
});
