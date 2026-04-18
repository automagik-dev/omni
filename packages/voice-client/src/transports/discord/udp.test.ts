import { describe, expect, it } from 'bun:test';
import { parseRtpHeader, parseRtpPacket, rtpHeaderLength } from './udp';

/** Build a minimal RTP packet buffer. */
function buildRtpPacket(opts: {
  version?: number;
  padding?: boolean;
  extension?: boolean;
  csrcCount?: number;
  marker?: boolean;
  payloadType?: number;
  sequence?: number;
  timestamp?: number;
  ssrc?: number;
  payload?: Uint8Array;
}): Uint8Array {
  const version = opts.version ?? 2;
  const padding = opts.padding ?? false;
  const extension = opts.extension ?? false;
  const csrcCount = opts.csrcCount ?? 0;
  const marker = opts.marker ?? false;
  const payloadType = opts.payloadType ?? 120; // Opus
  const sequence = opts.sequence ?? 1;
  const timestamp = opts.timestamp ?? 480;
  const ssrc = opts.ssrc ?? 12345;
  const payload = opts.payload ?? new Uint8Array([0xaa, 0xbb, 0xcc]);

  const headerLen = 12 + csrcCount * 4;
  const buf = new Uint8Array(headerLen + payload.length);
  const view = new DataView(buf.buffer);

  const firstByte =
    ((version & 0x03) << 6) | ((padding ? 1 : 0) << 5) | ((extension ? 1 : 0) << 4) | (csrcCount & 0x0f);
  const secondByte = ((marker ? 1 : 0) << 7) | (payloadType & 0x7f);

  view.setUint8(0, firstByte);
  view.setUint8(1, secondByte);
  view.setUint16(2, sequence);
  view.setUint32(4, timestamp);
  view.setUint32(8, ssrc);
  buf.set(payload, headerLen);

  return buf;
}

describe('parseRtpHeader', () => {
  it('should parse standard RTP header fields', () => {
    const packet = buildRtpPacket({
      version: 2,
      payloadType: 120,
      sequence: 42,
      timestamp: 96000,
      ssrc: 55555,
    });

    const header = parseRtpHeader(packet);
    expect(header.version).toBe(2);
    expect(header.padding).toBe(false);
    expect(header.extension).toBe(false);
    expect(header.csrcCount).toBe(0);
    expect(header.marker).toBe(false);
    expect(header.payloadType).toBe(120);
    expect(header.sequence).toBe(42);
    expect(header.timestamp).toBe(96000);
    expect(header.ssrc).toBe(55555);
  });

  it('should parse marker bit', () => {
    const packet = buildRtpPacket({ marker: true, payloadType: 111 });
    const header = parseRtpHeader(packet);
    expect(header.marker).toBe(true);
    expect(header.payloadType).toBe(111);
  });

  it('should parse padding and extension flags', () => {
    const packet = buildRtpPacket({ padding: true, extension: true });
    const header = parseRtpHeader(packet);
    expect(header.padding).toBe(true);
    expect(header.extension).toBe(true);
  });
});

describe('rtpHeaderLength', () => {
  it('should return 12 for basic header', () => {
    const packet = buildRtpPacket({});
    expect(rtpHeaderLength(packet)).toBe(12);
  });

  it('should account for CSRC entries', () => {
    const packet = buildRtpPacket({ csrcCount: 3 });
    expect(rtpHeaderLength(packet)).toBe(12 + 3 * 4);
  });

  it('should account for extension header', () => {
    // Build a packet with extension flag set and a 4-byte extension header + 8 bytes payload
    const base = buildRtpPacket({ extension: true, payload: new Uint8Array(0) });
    // Append extension: 2 bytes profile, 2 bytes length (in 32-bit words), then data
    const ext = new Uint8Array(4 + 4); // length=1 word = 4 bytes
    const extView = new DataView(ext.buffer);
    extView.setUint16(0, 0xbede); // profile
    extView.setUint16(2, 1); // 1 word of extension data
    ext.set([0x01, 0x02, 0x03, 0x04], 4);

    const full = new Uint8Array(base.length + ext.length);
    full.set(base);
    full.set(ext, base.length);

    expect(rtpHeaderLength(full)).toBe(12 + 4 + 4); // base + ext header + ext data
  });
});

describe('parseRtpPacket', () => {
  it('should split header and payload', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    const packet = buildRtpPacket({ ssrc: 99999, payload });

    const parsed = parseRtpPacket(packet);
    expect(parsed.header.ssrc).toBe(99999);
    expect(parsed.headerBytes.length).toBe(12);
    expect(parsed.payload.length).toBe(5);
    expect(parsed.payload).toEqual(payload);
    expect(parsed.nonce.length).toBe(12);
  });
});
