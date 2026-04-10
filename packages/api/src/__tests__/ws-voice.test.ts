/**
 * Tests for ws/voice.ts WebSocket handler
 */

import { describe, expect, test } from 'bun:test';
import { createVoiceWebSocketHandler } from '../ws/voice';

describe('createVoiceWebSocketHandler', () => {
  describe('client management', () => {
    test('should track connected clients', () => {
      const handler = createVoiceWebSocketHandler(null);
      const ws1 = { send: () => {} };
      const ws2 = { send: () => {} };

      handler.open(ws1, { sessionId: 'sess-1' });
      handler.open(ws2, { sessionId: 'sess-1', format: 'pcm' });

      expect(handler.clientCount).toBe(2);

      handler.close(ws1);
      expect(handler.clientCount).toBe(1);

      handler.close(ws2);
      expect(handler.clientCount).toBe(0);
    });
  });

  describe('audio frame routing', () => {
    test('should send opus frames to opus subscribers', () => {
      const handler = createVoiceWebSocketHandler(null);
      const received: Uint8Array[] = [];
      const ws = { send: (data: Uint8Array | string) => received.push(data as Uint8Array) };

      handler.open(ws, { sessionId: 'sess-1', format: 'opus' });

      const frame = new Uint8Array([0x01, 0x02, 0x03]);
      handler.pushAudioFrame('sess-1', 'user-1', frame, 'opus');

      expect(received.length).toBe(1);
      expect(received[0]).toEqual(frame);
    });

    test('should not send opus frames to pcm subscribers', () => {
      const handler = createVoiceWebSocketHandler(null);
      const received: unknown[] = [];
      const ws = { send: (data: unknown) => received.push(data) };

      handler.open(ws, { sessionId: 'sess-1', format: 'pcm' });
      handler.pushAudioFrame('sess-1', 'user-1', new Uint8Array([0x01]), 'opus');

      expect(received.length).toBe(0);
    });

    test('should filter by session ID', () => {
      const handler = createVoiceWebSocketHandler(null);
      const received: unknown[] = [];
      const ws = { send: (data: unknown) => received.push(data) };

      handler.open(ws, { sessionId: 'sess-1', format: 'opus' });
      handler.pushAudioFrame('sess-2', 'user-1', new Uint8Array([0x01]), 'opus');

      expect(received.length).toBe(0);
    });

    test('should filter by user when specified', () => {
      const handler = createVoiceWebSocketHandler(null);
      const received: unknown[] = [];
      const ws = { send: (data: unknown) => received.push(data) };

      handler.open(ws, { sessionId: 'sess-1', format: 'opus', user: 'user-1' });

      handler.pushAudioFrame('sess-1', 'user-1', new Uint8Array([0x01]), 'opus');
      handler.pushAudioFrame('sess-1', 'user-2', new Uint8Array([0x02]), 'opus');

      // Only user-1's frame should arrive
      expect(received.length).toBe(1);
    });

    test('should send all users when no filter specified', () => {
      const handler = createVoiceWebSocketHandler(null);
      const received: unknown[] = [];
      const ws = { send: (data: unknown) => received.push(data) };

      handler.open(ws, { sessionId: 'sess-1', format: 'opus' });

      handler.pushAudioFrame('sess-1', 'user-1', new Uint8Array([0x01]), 'opus');
      handler.pushAudioFrame('sess-1', 'user-2', new Uint8Array([0x02]), 'opus');

      expect(received.length).toBe(2);
    });
  });

  describe('control messages', () => {
    test('should broadcast participant_joined to session subscribers', () => {
      const handler = createVoiceWebSocketHandler(null);
      const received: string[] = [];
      const ws = { send: (data: string | Uint8Array) => received.push(data as string) };

      handler.open(ws, { sessionId: 'sess-1', format: 'opus' });
      handler.broadcastParticipantJoined('sess-1', 'user-1', 'discord-12345');

      expect(received.length).toBe(1);
      const msg = JSON.parse(received[0]!) as Record<string, unknown>;
      expect(msg).toMatchObject({
        type: 'participant_joined',
        userId: 'user-1',
        platformUserId: 'discord-12345',
      });
    });

    test('should broadcast participant_left to session subscribers', () => {
      const handler = createVoiceWebSocketHandler(null);
      const received: string[] = [];
      const ws = { send: (data: string | Uint8Array) => received.push(data as string) };

      handler.open(ws, { sessionId: 'sess-1', format: 'opus' });
      handler.broadcastParticipantLeft('sess-1', 'user-1');

      expect(received.length).toBe(1);
      const msg = JSON.parse(received[0]!) as Record<string, unknown>;
      expect(msg).toMatchObject({
        type: 'participant_left',
        userId: 'user-1',
      });
    });

    test('should not send control messages to other sessions', () => {
      const handler = createVoiceWebSocketHandler(null);
      const received: unknown[] = [];
      const ws = { send: (data: unknown) => received.push(data) };

      handler.open(ws, { sessionId: 'sess-1', format: 'opus' });
      handler.broadcastParticipantJoined('sess-2', 'user-1', 'discord-12345');

      expect(received.length).toBe(0);
    });
  });

  describe('default format', () => {
    test('should default to opus when no format specified', () => {
      const handler = createVoiceWebSocketHandler(null);
      const received: unknown[] = [];
      const ws = { send: (data: unknown) => received.push(data) };

      handler.open(ws, { sessionId: 'sess-1' });

      handler.pushAudioFrame('sess-1', 'user-1', new Uint8Array([0x01]), 'opus');
      expect(received.length).toBe(1);

      handler.pushAudioFrame('sess-1', 'user-1', new Uint8Array([0x02]), 'pcm');
      expect(received.length).toBe(1); // still 1, pcm frame was filtered
    });
  });

  describe('error resilience', () => {
    test('should handle send errors gracefully', () => {
      const handler = createVoiceWebSocketHandler(null);
      const ws = {
        send: () => {
          throw new Error('connection closed');
        },
      };

      handler.open(ws, { sessionId: 'sess-1', format: 'opus' });

      // Should not throw
      handler.pushAudioFrame('sess-1', 'user-1', new Uint8Array([0x01]), 'opus');
      handler.broadcastParticipantJoined('sess-1', 'user-1', 'discord-12345');
      handler.broadcastParticipantLeft('sess-1', 'user-1');
    });
  });
});
