import { describe, expect, test } from 'bun:test';

import { verbsToScopes } from '../verbs-to-scopes';

describe('verbsToScopes', () => {
  test('single bucket: outgoing → ["messages:send"]', () => {
    expect(verbsToScopes({ buckets: ['outgoing'] })).toEqual(['messages:send']);
  });

  test('union of two buckets is deduped', () => {
    // outgoing = ['messages:send']
    // multimodal_out = ['tts:synthesize', 'media:write', 'messages:send']
    // union deduped + sorted: ['media:write', 'messages:send', 'tts:synthesize']
    expect(verbsToScopes({ buckets: ['outgoing', 'multimodal_out'] })).toEqual([
      'media:write',
      'messages:send',
      'tts:synthesize',
    ]);
  });

  test('extraScopes are added to the union', () => {
    expect(verbsToScopes({ buckets: ['outgoing'], extraScopes: ['chats:read'] })).toEqual([
      'chats:read',
      'messages:send',
    ]);
  });

  test('extraScopes overlapping with bucket scopes dedupe', () => {
    expect(verbsToScopes({ buckets: ['outgoing'], extraScopes: ['messages:send'] })).toEqual(['messages:send']);
  });

  test('output is sorted (deterministic)', () => {
    const result = verbsToScopes({
      buckets: ['multimodal_out', 'read', 'context'],
    });
    const sorted = [...result].sort();
    expect(result).toEqual(sorted);
  });

  test('empty input returns empty array', () => {
    expect(verbsToScopes({ buckets: [] })).toEqual([]);
  });

  test('empty buckets with extraScopes returns only the extras (sorted, deduped)', () => {
    expect(verbsToScopes({ buckets: [], extraScopes: ['z:scope', 'a:scope', 'z:scope'] })).toEqual([
      'a:scope',
      'z:scope',
    ]);
  });

  test('all buckets union resolves to full scope surface', () => {
    const all = verbsToScopes({
      buckets: ['outgoing', 'read', 'context', 'turn', 'multimodal_in', 'multimodal_out'],
    });
    expect(all).toEqual([
      'chats:read',
      'context:write',
      'instances:read',
      'media:read',
      'media:write',
      'messages:send',
      'tts:synthesize',
      'turns:close',
    ]);
  });
});
