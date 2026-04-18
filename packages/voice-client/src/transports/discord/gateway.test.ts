import { describe, expect, it } from 'bun:test';
import { type GatewayState, VoiceGateway, VoiceOpcode } from './gateway';

describe('VoiceGateway', () => {
  it('should start in idle state', () => {
    const gw = new VoiceGateway();
    expect(gw.state).toBe('idle');
  });

  it('should emit stateChange on connect', () => {
    const gw = new VoiceGateway();
    const states: GatewayState[] = [];
    gw.on('stateChange', (s) => states.push(s));

    // connect will try to open a WebSocket — it will fail, but state transitions happen
    try {
      gw.connect({
        endpoint: 'localhost:1234',
        serverId: '123',
        userId: '456',
        sessionId: 'abc',
        token: 'tok',
      });
    } catch {
      // WebSocket may throw in test env
    }

    expect(states[0]).toBe('connecting');
  });

  it('should track state through close', () => {
    const gw = new VoiceGateway();
    const states: GatewayState[] = [];
    gw.on('stateChange', (s) => states.push(s));

    gw.close();
    expect(states).toContain('disconnected');
    expect(gw.state).toBe('disconnected');
  });
});

describe('VoiceOpcode', () => {
  it('should have correct opcode values', () => {
    expect(VoiceOpcode.Identify).toBe(0);
    expect(VoiceOpcode.SelectProtocol).toBe(1);
    expect(VoiceOpcode.Ready).toBe(2);
    expect(VoiceOpcode.Heartbeat).toBe(3);
    expect(VoiceOpcode.SessionDescription).toBe(4);
    expect(VoiceOpcode.Speaking).toBe(5);
    expect(VoiceOpcode.HeartbeatAck).toBe(6);
    expect(VoiceOpcode.Resume).toBe(7);
    expect(VoiceOpcode.Hello).toBe(8);
    expect(VoiceOpcode.Resumed).toBe(9);
    expect(VoiceOpcode.ClientDisconnect).toBe(13);
  });
});
