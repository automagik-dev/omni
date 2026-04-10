/**
 * Discord Voice UDP socket — IP Discovery + RTP receive loop.
 *
 * Handles the raw UDP transport for voice data:
 * 1. IP Discovery: Send our SSRC, receive external IP + port
 * 2. RTP receive: Parse incoming RTP packets with SRTP-encrypted payloads
 *
 * Reference: https://discord.com/developers/docs/topics/voice-connections#ip-discovery
 */
import { Buffer } from 'node:buffer';
import { type Socket, createSocket } from 'node:dgram';
import type { EventEmitter } from 'node:events';

/** Parsed RTP header fields. */
export interface RtpHeader {
  version: number;
  padding: boolean;
  extension: boolean;
  csrcCount: number;
  marker: boolean;
  payloadType: number;
  sequence: number;
  timestamp: number;
  ssrc: number;
}

/** Parsed RTP packet: header + encrypted payload. */
export interface RtpPacket {
  header: RtpHeader;
  headerBytes: Uint8Array;
  payload: Uint8Array;
  nonce: Uint8Array;
}

/** Parse the fixed 12-byte RTP header from a raw packet. */
export function parseRtpHeader(buf: Uint8Array): RtpHeader {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const firstByte = view.getUint8(0);
  const secondByte = view.getUint8(1);
  return {
    version: (firstByte >> 6) & 0x03,
    padding: Boolean((firstByte >> 5) & 0x01),
    extension: Boolean((firstByte >> 4) & 0x01),
    csrcCount: firstByte & 0x0f,
    marker: Boolean((secondByte >> 7) & 0x01),
    payloadType: secondByte & 0x7f,
    sequence: view.getUint16(2),
    timestamp: view.getUint32(4),
    ssrc: view.getUint32(8),
  };
}

/**
 * Compute the actual header length (fixed 12 bytes + CSRC entries + extension).
 * RTP extension header is 4 bytes (type + length) + length*4 payload bytes.
 */
export function rtpHeaderLength(buf: Uint8Array): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const firstByte = view.getUint8(0);
  const csrcCount = firstByte & 0x0f;
  const hasExtension = Boolean((firstByte >> 4) & 0x01);
  let offset = 12 + csrcCount * 4;
  if (hasExtension && buf.byteLength >= offset + 4) {
    const extLength = view.getUint16(offset + 2);
    offset += 4 + extLength * 4;
  }
  return offset;
}

/** Parse a full RTP packet into header + encrypted payload. */
export function parseRtpPacket(buf: Uint8Array): RtpPacket {
  const header = parseRtpHeader(buf);
  const headerLen = rtpHeaderLength(buf);
  const headerBytes = buf.slice(0, headerLen);
  const payload = buf.slice(headerLen);

  // RTP header is the nonce base for most modes
  const nonce = buf.slice(0, 12);

  return { header, headerBytes, payload, nonce };
}

export interface UdpEvents {
  packet: (packet: RtpPacket) => void;
  close: () => void;
}

type UdpEventKey = keyof UdpEvents;

/**
 * Voice UDP socket. Uses node:dgram with EventEmitter cast to work
 * around Bun's dgram type stubs missing .on/.removeListener.
 */
export class VoiceUdp {
  private socket: Socket | null = null;
  private emitter: EventEmitter | null = null;
  private remoteIp = '';
  private remotePort = 0;
  private listeners = new Map<UdpEventKey, Set<UdpEvents[UdpEventKey]>>();

  on<K extends UdpEventKey>(event: K, listener: UdpEvents[K]): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  off<K extends UdpEventKey>(event: K, listener: UdpEvents[K]): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit<K extends UdpEventKey>(event: K, ...args: Parameters<UdpEvents[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      (fn as (...a: Parameters<UdpEvents[K]>) => void)(...args);
    }
  }

  /** Create the UDP socket and start receiving. */
  createSocket(remoteIp: string, remotePort: number): void {
    this.remoteIp = remoteIp;
    this.remotePort = remotePort;
    this.socket = createSocket('udp4');
    // Cast to EventEmitter for .on/.removeListener — Bun's dgram types are incomplete
    this.emitter = this.socket as unknown as EventEmitter;

    this.emitter.on('message', (msg: Buffer) => {
      if (msg.length < 12) return;
      const packet = parseRtpPacket(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength));
      this.emit('packet', packet);
    });

    this.emitter.on('close', () => this.emit('close'));
  }

  /**
   * Perform IP Discovery: send our SSRC, receive our external IP + port.
   * Discord expects a 74-byte packet with SSRC at offset 4 (big-endian).
   * Response contains our external IP at offset 8 (null-terminated) and port at offset 72.
   */
  performIpDiscovery(ssrc: number): Promise<{ ip: string; port: number }> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.emitter) {
        reject(new Error('UDP socket not created'));
        return;
      }

      const request = Buffer.alloc(74);
      request.writeUInt16BE(0x0001, 0);
      request.writeUInt16BE(70, 2);
      request.writeUInt32BE(ssrc, 4);

      const timeout = setTimeout(() => {
        this.emitter?.removeListener('message', handler);
        reject(new Error('IP Discovery timed out'));
      }, 5000);

      const handler = (msg: Buffer) => {
        if (msg.length < 74) return;
        const type = msg.readUInt16BE(0);
        if (type !== 0x0002) return;

        clearTimeout(timeout);
        this.emitter?.removeListener('message', handler);

        const ipEnd = msg.indexOf(0, 8);
        const ip = msg.subarray(8, ipEnd > 8 ? ipEnd : 72).toString('ascii');
        const port = msg.readUInt16BE(72);
        resolve({ ip, port });
      };

      this.emitter.on('message', handler);
      this.socket.send(request, this.remotePort, this.remoteIp, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.emitter?.removeListener('message', handler);
          reject(err);
        }
      });
    });
  }

  /** Send a raw UDP packet to the remote. */
  send(data: Uint8Array): void {
    this.socket?.send(Buffer.from(data), this.remotePort, this.remoteIp);
  }

  /** Close the UDP socket. */
  close(): void {
    if (this.emitter) {
      this.emitter.removeAllListeners();
      this.emitter = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
