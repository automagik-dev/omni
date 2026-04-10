/**
 * Tests for ws/voice.ts — VoiceStreamRegistry and URL parsing
 */

import { describe, expect, test } from 'bun:test';
import { VoiceStreamRegistry, parseVoiceStreamParams } from '../ws/voice';

describe('parseVoiceStreamParams', () => {
  test('parses valid URL with all params', () => {
    const url = new URL('ws://localhost/api/v2/voice/stream/voice-123?api_key=sk_test&format=pcm&user=user-1');
    const params = parseVoiceStreamParams(url);
    expect(params).not.toBeNull();
    expect(params?.sessionId).toBe('voice-123');
    expect(params?.apiKey).toBe('sk_test');
    expect(params?.format).toBe('pcm');
    expect(params?.filterUserId).toBe('user-1');
  });

  test('defaults to opus format', () => {
    const url = new URL('ws://localhost/api/v2/voice/stream/voice-123?api_key=sk_test');
    const params = parseVoiceStreamParams(url);
    expect(params?.format).toBe('opus');
    expect(params?.filterUserId).toBeUndefined();
  });

  test('returns null without api_key', () => {
    const url = new URL('ws://localhost/api/v2/voice/stream/voice-123');
    expect(parseVoiceStreamParams(url)).toBeNull();
  });

  test('returns null for wrong path', () => {
    const url = new URL('ws://localhost/api/v2/other/path?api_key=sk_test');
    expect(parseVoiceStreamParams(url)).toBeNull();
  });
});

describe('VoiceStreamRegistry', () => {
  test('add and remove clients', () => {
    const reg = new VoiceStreamRegistry();
    const ws1 = {};
    const ws2 = {};

    reg.add(ws1, {
      params: { sessionId: 'sess-1', apiKey: 'k', format: 'opus' },
      send: () => {},
    });
    reg.add(ws2, {
      params: { sessionId: 'sess-1', apiKey: 'k', format: 'pcm' },
      send: () => {},
    });

    expect(reg.size).toBe(2);
    reg.remove(ws1);
    expect(reg.size).toBe(1);
    reg.remove(ws2);
    expect(reg.size).toBe(0);
  });

  test('pushAudio routes to matching clients with tagged frames', () => {
    const reg = new VoiceStreamRegistry();
    const received: Uint8Array[] = [];

    reg.add(
      {},
      {
        params: { sessionId: 'sess-1', apiKey: 'k', format: 'opus' },
        send: (data) => {
          received.push(data as Uint8Array);
        },
      },
    );

    reg.add(
      {},
      {
        params: { sessionId: 'sess-2', apiKey: 'k', format: 'opus' },
        send: () => {
          throw new Error('should not receive');
        },
      },
    );

    reg.pushAudio('sess-1', 'user-1', new Uint8Array([1, 2, 3]), 'opus');
    expect(received.length).toBe(1);

    const frame = Buffer.from(received[0]!);
    const userIdLen = frame[0]!;
    const userId = frame.subarray(1, 1 + userIdLen).toString('utf8');
    const audio = frame.subarray(1 + userIdLen);
    expect(userId).toBe('user-1');
    expect(Array.from(audio)).toEqual([1, 2, 3]);
  });

  test('pushAudio respects user filter', () => {
    const reg = new VoiceStreamRegistry();
    const received: unknown[] = [];

    reg.add(
      {},
      {
        params: { sessionId: 'sess-1', apiKey: 'k', format: 'opus', filterUserId: 'user-1' },
        send: (data) => {
          received.push(data);
        },
      },
    );

    reg.pushAudio('sess-1', 'user-2', new Uint8Array([1]), 'opus');
    expect(received.length).toBe(0);

    reg.pushAudio('sess-1', 'user-1', new Uint8Array([2]), 'opus');
    expect(received.length).toBe(1);
  });

  test('pushAudio filters by format', () => {
    const reg = new VoiceStreamRegistry();
    const received: unknown[] = [];

    reg.add(
      {},
      {
        params: { sessionId: 'sess-1', apiKey: 'k', format: 'pcm' },
        send: (data) => {
          received.push(data);
        },
      },
    );

    reg.pushAudio('sess-1', 'user-1', new Uint8Array([1]), 'opus');
    expect(received.length).toBe(0);
  });

  test('broadcast sends JSON to all session clients', () => {
    const reg = new VoiceStreamRegistry();
    const messages: string[] = [];

    reg.add(
      {},
      {
        params: { sessionId: 'sess-1', apiKey: 'k', format: 'opus' },
        send: (data) => {
          messages.push(data as string);
        },
      },
    );

    reg.broadcast('sess-1', { type: 'participant_joined', userId: 'user-1' });
    expect(messages.length).toBe(1);
    expect(JSON.parse(messages[0]!)).toEqual({ type: 'participant_joined', userId: 'user-1' });
  });

  test('handles send errors gracefully', () => {
    const reg = new VoiceStreamRegistry();
    reg.add(
      {},
      {
        params: { sessionId: 'sess-1', apiKey: 'k', format: 'opus' },
        send: () => {
          throw new Error('connection closed');
        },
      },
    );

    // Should not throw
    reg.pushAudio('sess-1', 'user-1', new Uint8Array([1]), 'opus');
    reg.broadcast('sess-1', { type: 'test' });
  });
});
