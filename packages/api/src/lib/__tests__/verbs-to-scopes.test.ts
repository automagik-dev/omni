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

  test('verbs.remove drops a single verb without collapsing its bucket', () => {
    // `read` bucket contains history + where, both → chats:read.
    // Removing history keeps chats:read (still contributed by where).
    const scopes = verbsToScopes({ buckets: ['read'], verbs: { remove: ['history'] } });
    expect(scopes).toEqual(['chats:read']);
  });

  test('verbs.add unions an extra verb into the resolved scope set', () => {
    // outgoing alone → messages:send. Adding `where` pulls in chats:read
    // even though the `read` bucket is not enabled.
    const scopes = verbsToScopes({ buckets: ['outgoing'], verbs: { add: ['where'] } });
    expect(scopes).toEqual(['chats:read', 'messages:send']);
  });

  test('verbs.remove on `use` drops instances:read while keeping context:write', () => {
    // context bucket = open + close + use. Removing use drops only its
    // instances:read contribution; context:write (from open/close) remains.
    const scopes = verbsToScopes({ buckets: ['context'], verbs: { remove: ['use'] } });
    expect(scopes).toEqual(['context:write']);
    expect(scopes).not.toContain('instances:read');
  });

  test('verbs.add and verbs.remove overlapping throws with both verbs in the message', () => {
    expect(() =>
      verbsToScopes({ buckets: ['outgoing'], verbs: { add: ['where', 'see'], remove: ['where', 'see'] } }),
    ).toThrow(/verbs\.add and verbs\.remove cannot overlap/);
    expect(() => verbsToScopes({ buckets: ['outgoing'], verbs: { add: ['where'], remove: ['where'] } })).toThrow(
      /where/,
    );
  });

  test('multi-bucket output is sorted deterministically', () => {
    const result = verbsToScopes({
      buckets: ['multimodal_out', 'outgoing', 'read', 'turn', 'context', 'multimodal_in'],
    });
    expect(result).toEqual([...result].sort());
    expect(result).toEqual([
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
