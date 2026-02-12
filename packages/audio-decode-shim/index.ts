/**
 * Bun-compatible audio-decode shim using ffmpeg.
 *
 * Satisfies Baileys' `import('audio-decode')` for waveform generation.
 * Decodes audio (OGG/Opus, MP3, etc.) to raw PCM Float32 samples via ffmpeg.
 *
 * API contract (what Baileys expects):
 *   const { default: decoder } = await import('audio-decode');
 *   const audioBuffer = await decoder(bufferOrPath);
 *   const samples = audioBuffer.getChannelData(0); // Float32Array
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface ChildProcessWithEvents extends ChildProcessWithoutNullStreams {
  on(event: 'close', listener: (code: number | null) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

interface AudioBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  getChannelData(channel: number): Float32Array;
}

/** Write input to a temp file, returning the path. */
async function writeToTempFile(data: Buffer): Promise<string> {
  const path = join(tmpdir(), `audio-decode-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  await fs.writeFile(path, data);
  return path;
}

/** Collect a ReadableStream into a Buffer. */
async function streamToBuffer(stream: ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  let result = await reader.read();
  while (!result.done) {
    chunks.push(Buffer.from(result.value));
    result = await reader.read();
  }
  return Buffer.concat(chunks);
}

/** Resolve input to a file path, writing to temp if needed. */
async function resolveInputPath(input: Buffer | string | ReadableStream): Promise<{ path: string; cleanup: boolean }> {
  if (typeof input === 'string') {
    return { path: input, cleanup: false };
  }
  const buf = Buffer.isBuffer(input) ? input : await streamToBuffer(input as ReadableStream);
  return { path: await writeToTempFile(buf), cleanup: true };
}

/** Convert raw PCM s16le bytes to Float32Array in [-1.0, 1.0] range. */
function pcmToFloat32(pcmData: Buffer): Float32Array {
  const samples = new Float32Array(pcmData.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const lo = pcmData[i * 2] ?? 0;
    const hi = pcmData[i * 2 + 1] ?? 0;
    let sample = lo | (hi << 8);
    if (sample >= 0x8000) sample -= 0x10000;
    samples[i] = sample / 32768;
  }
  return samples;
}

/**
 * Decode audio buffer/path to PCM samples using ffmpeg.
 * Returns an AudioBuffer-like object compatible with Baileys' getAudioWaveform.
 */
async function decode(input: Buffer | string | ReadableStream): Promise<AudioBuffer> {
  const { path: inputPath, cleanup } = await resolveInputPath(input);
  try {
    const sampleRate = 8000;
    const pcmData = await ffmpegDecode(inputPath, sampleRate);
    const samples = pcmToFloat32(pcmData);

    return {
      numberOfChannels: 1,
      length: samples.length,
      sampleRate,
      duration: samples.length / sampleRate,
      getChannelData(_channel: number): Float32Array {
        return samples;
      },
    };
  } finally {
    if (cleanup) {
      await fs.unlink(inputPath).catch(() => {});
    }
  }
}

/**
 * Use ffmpeg to decode audio to raw PCM s16le mono.
 */
function ffmpegDecode(inputPath: string, sampleRate: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const ffmpeg = spawn('ffmpeg', [
      '-i',
      inputPath,
      '-f',
      's16le', // raw signed 16-bit little-endian
      '-ac',
      '1', // mono
      '-ar',
      String(sampleRate),
      '-acodec',
      'pcm_s16le',
      '-v',
      'quiet',
      'pipe:1', // output to stdout
    ]) as ChildProcessWithEvents;

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    ffmpeg.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg decode exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err: Error) => {
      reject(new Error(`ffmpeg failed to start: ${err.message}`));
    });
  });
}

export default decode;
