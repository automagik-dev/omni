/**
 * Unit tests for the verb vocabulary + bucket resolver table.
 *
 * These tests are the contract between the DESIGN doc and the profile
 * resolver. If a bucket's scope list changes here, every profile template
 * that uses it gets its resolved scope set recomputed — update snapshots
 * deliberately.
 */

import { describe, expect, test } from 'bun:test';

import { VERBS, VERB_BUCKETS, type VerbBucket, bucketToScopes } from '../verbs';

describe('VERBS enum', () => {
  test('contains all 14 documented verbs', () => {
    const expected = [
      'send',
      'say',
      'react',
      'history',
      'where',
      'open',
      'close',
      'use',
      'done',
      'listen',
      'see',
      'speak',
      'imagine',
      'film',
    ];
    expect(Object.keys(VERBS).sort()).toEqual(expected.sort());
    expect(Object.values(VERBS)).toHaveLength(14);
  });

  test('every value equals its key (identity mapping)', () => {
    for (const [key, value] of Object.entries(VERBS)) {
      expect(key).toBe(value);
    }
  });
});

describe('VERB_BUCKETS', () => {
  test('assigns every verb to exactly one bucket', () => {
    for (const verb of Object.values(VERBS)) {
      expect(VERB_BUCKETS[verb]).toBeDefined();
    }
    expect(Object.keys(VERB_BUCKETS)).toHaveLength(14);
  });

  test('outgoing bucket: send, say, react', () => {
    expect(VERB_BUCKETS.send).toBe('outgoing');
    expect(VERB_BUCKETS.say).toBe('outgoing');
    expect(VERB_BUCKETS.react).toBe('outgoing');
  });

  test('read bucket: history, where', () => {
    expect(VERB_BUCKETS.history).toBe('read');
    expect(VERB_BUCKETS.where).toBe('read');
  });

  test('context bucket: open, close, use', () => {
    expect(VERB_BUCKETS.open).toBe('context');
    expect(VERB_BUCKETS.close).toBe('context');
    expect(VERB_BUCKETS.use).toBe('context');
  });

  test('turn bucket: done', () => {
    expect(VERB_BUCKETS.done).toBe('turn');
  });

  test('multimodal_in bucket: listen, see', () => {
    expect(VERB_BUCKETS.listen).toBe('multimodal_in');
    expect(VERB_BUCKETS.see).toBe('multimodal_in');
  });

  test('multimodal_out bucket: speak, imagine, film', () => {
    expect(VERB_BUCKETS.speak).toBe('multimodal_out');
    expect(VERB_BUCKETS.imagine).toBe('multimodal_out');
    expect(VERB_BUCKETS.film).toBe('multimodal_out');
  });
});

describe('bucketToScopes', () => {
  const documented: Record<VerbBucket, string[]> = {
    outgoing: ['messages:send'],
    read: ['chats:read'],
    context: ['context:write', 'instances:read'],
    turn: ['turns:close'],
    multimodal_in: ['media:read', 'messages:send'],
    multimodal_out: ['tts:synthesize', 'media:write', 'messages:send'],
  };

  test('every bucket resolves to its documented scope list', () => {
    for (const [bucket, scopes] of Object.entries(documented) as [VerbBucket, string[]][]) {
      expect(bucketToScopes[bucket]).toEqual(scopes);
    }
  });

  test('covers every VerbBucket variant', () => {
    const buckets: VerbBucket[] = ['outgoing', 'read', 'context', 'turn', 'multimodal_in', 'multimodal_out'];
    for (const bucket of buckets) {
      expect(bucketToScopes[bucket]).toBeDefined();
      expect(bucketToScopes[bucket].length).toBeGreaterThan(0);
    }
  });

  test('no duplicate scopes within a single bucket', () => {
    for (const scopes of Object.values(bucketToScopes)) {
      const unique = new Set(scopes);
      expect(unique.size).toBe(scopes.length);
    }
  });
});
