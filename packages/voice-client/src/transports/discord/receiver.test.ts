import { beforeEach, describe, expect, it } from 'bun:test';
import { PacketReceiver } from './receiver';

describe('PacketReceiver', () => {
  let receiver: PacketReceiver;

  beforeEach(() => {
    receiver = new PacketReceiver({ silenceTimeoutMs: 50 });
  });

  describe('handleSpeaking', () => {
    it('should map SSRC to userId', () => {
      receiver.handleSpeaking('user-1', 1001, 1);
      expect(receiver.getUserForSsrc(1001)).toBe('user-1');
    });

    it('should create a stream on first speaking event', () => {
      const joined: string[] = [];
      receiver.on('participantJoin', (userId) => joined.push(userId));

      receiver.handleSpeaking('user-1', 1001, 1);

      expect(receiver.getStream('user-1')).toBeDefined();
      expect(joined).toEqual(['user-1']);
    });

    it('should not create duplicate stream on repeated speaking', () => {
      const joined: string[] = [];
      receiver.on('participantJoin', (userId) => joined.push(userId));

      receiver.handleSpeaking('user-1', 1001, 1);
      receiver.handleSpeaking('user-1', 1001, 1);
      receiver.handleSpeaking('user-1', 1001, 0);

      expect(joined).toEqual(['user-1']);
    });

    it('should handle SSRC change (user reconnect)', () => {
      receiver.handleSpeaking('user-1', 1001, 1);
      expect(receiver.getUserForSsrc(1001)).toBe('user-1');

      // User reconnects with new SSRC
      receiver.handleSpeaking('user-1', 2002, 1);
      expect(receiver.getUserForSsrc(2002)).toBe('user-1');
      // Old SSRC should be unmapped
      expect(receiver.getUserForSsrc(1001)).toBeUndefined();
    });

    it('should emit participantSpeaking events', () => {
      const events: Array<{ userId: string; speaking: boolean }> = [];
      receiver.on('participantSpeaking', (userId, speaking) => {
        events.push({ userId, speaking });
      });

      receiver.handleSpeaking('user-1', 1001, 1);
      receiver.handleSpeaking('user-1', 1001, 0);

      expect(events).toEqual([
        { userId: 'user-1', speaking: true },
        { userId: 'user-1', speaking: false },
      ]);
    });
  });

  describe('receivePacket', () => {
    it('should route packets to correct participant stream', () => {
      receiver.handleSpeaking('user-1', 1001, 1);
      receiver.handleSpeaking('user-2', 2002, 1);

      const stream1 = receiver.getStream('user-1');
      const stream2 = receiver.getStream('user-2');
      expect(stream1).toBeDefined();
      expect(stream2).toBeDefined();

      // Subscribe to streams to verify packets arrive
      const chunks1: Uint8Array[] = [];
      const chunks2: Uint8Array[] = [];
      stream1!.subscribe('opus').pipeTo(
        new WritableStream({
          write: (chunk) => {
            chunks1.push(chunk);
          },
        }),
      );
      stream2!.subscribe('opus').pipeTo(
        new WritableStream({
          write: (chunk) => {
            chunks2.push(chunk);
          },
        }),
      );

      const frame1 = new Uint8Array([0x01, 0x02]);
      const frame2 = new Uint8Array([0x03, 0x04]);

      receiver.receivePacket(1001, frame1);
      receiver.receivePacket(2002, frame2);

      // ReadableStream is async — give a tick
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(chunks1.length).toBe(1);
          expect(chunks1[0]).toEqual(frame1);
          expect(chunks2.length).toBe(1);
          expect(chunks2[0]).toEqual(frame2);
          resolve();
        }, 10);
      });
    });

    it('should ignore packets from unknown SSRC', () => {
      // No speaking event for SSRC 9999
      receiver.receivePacket(9999, new Uint8Array([0x01]));
      // Should not throw
      expect(receiver.listParticipants()).toEqual([]);
    });
  });

  describe('multiple participants', () => {
    it('should track separate streams per participant', () => {
      receiver.handleSpeaking('alice', 100, 1);
      receiver.handleSpeaking('bob', 200, 1);
      receiver.handleSpeaking('charlie', 300, 1);

      expect(receiver.listParticipants()).toEqual(['alice', 'bob', 'charlie']);
      expect(receiver.getStream('alice')?.userId).toBe('alice');
      expect(receiver.getStream('bob')?.userId).toBe('bob');
      expect(receiver.getStream('charlie')?.userId).toBe('charlie');
    });
  });

  describe('handleDisconnect', () => {
    it('should remove participant and emit leave event', () => {
      const left: string[] = [];
      receiver.on('participantLeave', (userId) => left.push(userId));

      receiver.handleSpeaking('user-1', 1001, 1);
      expect(receiver.getStream('user-1')).toBeDefined();

      receiver.handleDisconnect('user-1');

      expect(receiver.getStream('user-1')).toBeUndefined();
      expect(receiver.getUserForSsrc(1001)).toBeUndefined();
      expect(receiver.listParticipants()).toEqual([]);
      expect(left).toEqual(['user-1']);
    });
  });

  describe('silence detection', () => {
    it('should emit speaking=false after silence timeout', async () => {
      const events: Array<{ userId: string; speaking: boolean }> = [];
      receiver.on('participantSpeaking', (userId, speaking) => {
        events.push({ userId, speaking });
      });

      receiver.handleSpeaking('user-1', 1001, 1);
      receiver.receivePacket(1001, new Uint8Array([0x01]));

      // Wait for silence timeout (50ms + buffer)
      await new Promise((r) => setTimeout(r, 80));

      const silenceEvent = events.find((e) => e.userId === 'user-1' && !e.speaking);
      expect(silenceEvent).toBeDefined();
    });

    it('should reset silence timer on new packets', async () => {
      const silenceEvents: string[] = [];
      receiver.on('participantSpeaking', (userId, speaking) => {
        if (!speaking) silenceEvents.push(userId);
      });

      receiver.handleSpeaking('user-1', 1001, 1);

      // Send packets at 20ms intervals — should keep resetting the 50ms timer
      for (let i = 0; i < 4; i++) {
        receiver.receivePacket(1001, new Uint8Array([i]));
        await new Promise((r) => setTimeout(r, 20));
      }

      // No silence event should have fired during active sending
      expect(silenceEvents.length).toBe(0);

      // Now wait for silence
      await new Promise((r) => setTimeout(r, 80));
      expect(silenceEvents).toEqual(['user-1']);
    });
  });

  describe('destroy', () => {
    it('should remove all participants and emit leave events', () => {
      const left: string[] = [];
      receiver.on('participantLeave', (userId) => left.push(userId));

      receiver.handleSpeaking('user-1', 1001, 1);
      receiver.handleSpeaking('user-2', 2002, 1);

      receiver.destroy();

      expect(receiver.listParticipants()).toEqual([]);
      expect(left).toContain('user-1');
      expect(left).toContain('user-2');
    });
  });

  describe('event listener management', () => {
    it('should support off to remove listeners', () => {
      const events: string[] = [];
      const listener = (userId: string) => events.push(userId);

      receiver.on('participantJoin', listener);
      receiver.handleSpeaking('user-1', 1001, 1);
      expect(events).toEqual(['user-1']);

      receiver.off('participantJoin', listener);
      receiver.handleSpeaking('user-2', 2002, 1);
      // Listener was removed — no new event
      expect(events).toEqual(['user-1']);
    });
  });
});
