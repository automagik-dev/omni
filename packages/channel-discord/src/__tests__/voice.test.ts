import { describe, expect, test } from 'bun:test';

// Test the individual helper functions
// Since we can't easily mock Bun.spawn in unit tests, we test the waveform
// generation logic and overall flow

describe('voice message module', () => {
  test('module exports expected functions', async () => {
    const voice = await import('../senders/voice');
    expect(typeof voice.sendVoiceMessage).toBe('function');
    expect(typeof voice.checkFfmpeg).toBe('function');
    expect(typeof voice.encodeToOggOpus).toBe('function');
    expect(typeof voice.getAudioDuration).toBe('function');
    expect(typeof voice.generateWaveform).toBe('function');
    expect(typeof voice.resetFfmpegCache).toBe('function');
  });

  test('resetFfmpegCache resets the cache', async () => {
    const { resetFfmpegCache } = await import('../senders/voice');
    // Should not throw
    resetFfmpegCache();
  });

  test('checkFfmpeg returns boolean', async () => {
    const { checkFfmpeg, resetFfmpegCache } = await import('../senders/voice');
    resetFfmpegCache();
    const result = await checkFfmpeg();
    expect(typeof result).toBe('boolean');
  });

  // Integration tests (only run if ffmpeg available)
  test('encodeToOggOpus produces output when ffmpeg available', async () => {
    const { checkFfmpeg, encodeToOggOpus, resetFfmpegCache } = await import('../senders/voice');
    resetFfmpegCache();
    const hasFfmpeg = await checkFfmpeg();
    if (!hasFfmpeg) {
      return;
    }

    // Create a minimal WAV file (1 second silence)
    const sampleRate = 8000;
    const numSamples = sampleRate;
    const dataSize = numSamples * 2;
    const wav = Buffer.alloc(44 + dataSize);
    // WAV header
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + dataSize, 4);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); // PCM
    wav.writeUInt16LE(1, 22); // mono
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(dataSize, 40);

    const result = await encodeToOggOpus(wav);
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
  });

  test('getAudioDuration returns number when ffmpeg available', async () => {
    const { checkFfmpeg, getAudioDuration, resetFfmpegCache } = await import('../senders/voice');
    resetFfmpegCache();
    const hasFfmpeg = await checkFfmpeg();
    if (!hasFfmpeg) {
      return;
    }

    // Minimal WAV
    const sampleRate = 8000;
    const numSamples = sampleRate;
    const dataSize = numSamples * 2;
    const wav = Buffer.alloc(44 + dataSize);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + dataSize, 4);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(dataSize, 40);

    const duration = await getAudioDuration(wav);
    expect(typeof duration).toBe('number');
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  test('generateWaveform returns base64 string when ffmpeg available', async () => {
    const { checkFfmpeg, generateWaveform, resetFfmpegCache } = await import('../senders/voice');
    resetFfmpegCache();
    const hasFfmpeg = await checkFfmpeg();
    if (!hasFfmpeg) {
      return;
    }

    // Minimal WAV with some non-zero samples
    const sampleRate = 8000;
    const numSamples = sampleRate;
    const dataSize = numSamples * 2;
    const wav = Buffer.alloc(44 + dataSize);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(36 + dataSize, 4);
    wav.write('WAVE', 8);
    wav.write('fmt ', 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(dataSize, 40);
    // Fill with a sine wave pattern
    for (let i = 0; i < numSamples; i++) {
      const value = Math.round(16000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
      wav.writeInt16LE(value, 44 + i * 2);
    }

    const waveform = await generateWaveform(wav);
    expect(typeof waveform).toBe('string');
    // Decode and check length
    const decoded = Buffer.from(waveform, 'base64');
    expect(decoded.length).toBe(256);
  });
});
