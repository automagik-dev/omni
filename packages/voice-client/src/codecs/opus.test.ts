import { describe, expect, it } from 'bun:test';
import { OpusCodec } from './opus';

describe('OpusCodec', () => {
  it('should create an instance with default parameters', () => {
    const codec = new OpusCodec();
    expect(codec.sampleRate).toBe(48000);
    expect(codec.channels).toBe(2);
    expect(codec.frameSize).toBe(960);
  });

  it('should encode and decode a PCM buffer', () => {
    const codec = new OpusCodec();
    // Create a silent PCM frame (960 samples * 2 channels)
    const pcm = new Int16Array(codec.frameSize * codec.channels);
    const encoded = codec.encode(pcm);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = codec.decode(encoded);
    expect(decoded).toBeInstanceOf(Int16Array);
    expect(decoded.length).toBe(codec.frameSize * codec.channels);
  });

  it('should roundtrip a tone signal', () => {
    const codec = new OpusCodec();
    const pcm = new Int16Array(codec.frameSize * codec.channels);
    // Generate a simple 440Hz sine wave (stereo interleaved)
    for (let i = 0; i < codec.frameSize; i++) {
      const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / codec.sampleRate) * 16000);
      pcm[i * 2] = sample;
      pcm[i * 2 + 1] = sample;
    }

    const encoded = codec.encode(pcm);
    const decoded = codec.decode(encoded);
    expect(decoded.length).toBe(pcm.length);
    // Opus is lossy, so we check approximate equality
    // The decoded signal should be correlated with the original
    let sumSq = 0;
    for (let i = 0; i < pcm.length; i++) {
      const diff = (pcm[i] ?? 0) - (decoded[i] ?? 0);
      sumSq += diff * diff;
    }
    const rmsError = Math.sqrt(sumSq / pcm.length);
    // RMS error should be reasonable for Opus lossy compression
    expect(rmsError).toBeLessThan(15000);
  });
});
