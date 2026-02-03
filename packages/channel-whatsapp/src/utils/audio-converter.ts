/**
 * Audio converter utility for WhatsApp voice notes
 *
 * Converts audio files to OGG/OPUS format required for WhatsApp voice notes (PTT).
 * Uses ffmpeg for conversion.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { promises as fs, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Extended ChildProcess type with EventEmitter methods
 * Workaround for bun-types missing EventEmitter interface on ChildProcess
 */
interface ChildProcessWithEvents extends ChildProcessWithoutNullStreams {
  on(event: 'close', listener: (code: number | null) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

/**
 * Check if ffmpeg is available on the system
 */
export async function isFFmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version']) as ChildProcessWithEvents;
    proc.on('error', () => resolve(false));
    proc.on('close', (code: number | null) => resolve(code === 0));
  });
}

/**
 * Audio format detection patterns
 */
const MIME_FORMAT_MAP: Array<{ patterns: string[]; format: string }> = [
  { patterns: ['ogg', 'opus'], format: 'ogg' },
  { patterns: ['mp3', 'mpeg'], format: 'mp3' },
  { patterns: ['wav'], format: 'wav' },
  { patterns: ['m4a', 'mp4'], format: 'm4a' },
  { patterns: ['webm'], format: 'webm' },
  { patterns: ['aac'], format: 'aac' },
];

const URL_EXTENSION_MAP: Record<string, string> = {
  '.ogg': 'ogg',
  '.opus': 'ogg',
  '.mp3': 'mp3',
  '.wav': 'wav',
  '.m4a': 'm4a',
  '.webm': 'webm',
  '.aac': 'aac',
};

/**
 * Detect format from MIME type
 */
function detectFromMime(mimeType: string): string | null {
  for (const { patterns, format } of MIME_FORMAT_MAP) {
    if (patterns.some((p) => mimeType.includes(p))) {
      return format;
    }
  }
  return null;
}

/**
 * Detect format from URL extension
 */
function detectFromUrl(url: string): string | null {
  const urlLower = url.toLowerCase();
  for (const [ext, format] of Object.entries(URL_EXTENSION_MAP)) {
    if (urlLower.includes(ext)) {
      return format;
    }
  }
  return null;
}

/**
 * Get the audio format from MIME type or URL
 */
export function getAudioFormat(mimeType?: string, url?: string): string | null {
  if (mimeType) {
    const format = detectFromMime(mimeType);
    if (format) return format;
  }
  if (url) {
    return detectFromUrl(url);
  }
  return null;
}

/**
 * Check if audio needs conversion for WhatsApp voice notes
 */
export function needsConversion(mimeType?: string, url?: string): boolean {
  const format = getAudioFormat(mimeType, url);
  // OGG/OPUS doesn't need conversion
  return format !== 'ogg';
}

/**
 * Download audio from URL to a temp file
 */
async function downloadToTemp(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`);
  }

  const tempPath = join(tmpdir(), `omni-audio-${Date.now()}-input`);
  const body = response.body;
  if (!body) {
    throw new Error('No response body');
  }

  // Convert web stream to node stream
  const nodeStream = Readable.fromWeb(body as ReadableStream);
  const writeStream = createWriteStream(tempPath);

  await pipeline(nodeStream, writeStream);
  return tempPath;
}

/**
 * Convert audio file to OGG/OPUS format using ffmpeg
 *
 * @param inputPath - Path to input audio file
 * @returns Path to converted OGG file
 */
async function convertToOggOpus(inputPath: string): Promise<string> {
  const outputPath = join(tmpdir(), `omni-audio-${Date.now()}-output.ogg`);

  return new Promise((resolve, reject) => {
    // ffmpeg command for WhatsApp-compatible voice note:
    // -i input: input file
    // -c:a libopus: use opus codec
    // -b:a 64k: 64kbps bitrate (good quality, small size)
    // -vbr on: variable bitrate
    // -compression_level 10: highest compression
    // -application voip: optimize for voice
    // -ar 48000: 48kHz sample rate (opus standard)
    // -ac 1: mono audio
    const ffmpeg = spawn('ffmpeg', [
      '-i',
      inputPath,
      '-c:a',
      'libopus',
      '-b:a',
      '64k',
      '-vbr',
      'on',
      '-compression_level',
      '10',
      '-application',
      'voip',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-y', // Overwrite output
      outputPath,
    ]) as ChildProcessWithEvents;

    let stderr = '';

    ffmpeg.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });

    ffmpeg.on('error', (err: Error) => {
      reject(new Error(`ffmpeg failed to start: ${err.message}`));
    });
  });
}

/**
 * Convert audio URL to OGG/OPUS buffer for WhatsApp voice notes
 *
 * @param url - URL of the audio file to convert
 * @param mimeType - Optional MIME type hint
 * @returns Buffer containing OGG/OPUS audio, or null if conversion not needed/failed
 */
export async function convertAudioForVoiceNote(
  url: string,
  mimeType?: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  // Check if conversion is needed
  if (!needsConversion(mimeType, url)) {
    return null; // Already in correct format, use URL directly
  }

  // Check if ffmpeg is available
  const ffmpegAvailable = await isFFmpegAvailable();
  if (!ffmpegAvailable) {
    return null;
  }

  let inputPath: string | null = null;
  let outputPath: string | null = null;

  try {
    // Download the audio file
    inputPath = await downloadToTemp(url);

    // Convert to OGG/OPUS
    outputPath = await convertToOggOpus(inputPath);

    // Read the converted file
    const buffer = await fs.readFile(outputPath);

    return {
      buffer,
      mimeType: 'audio/ogg; codecs=opus',
    };
  } finally {
    // Cleanup temp files
    if (inputPath) {
      await fs.unlink(inputPath).catch(() => {});
    }
    if (outputPath) {
      await fs.unlink(outputPath).catch(() => {});
    }
  }
}

/**
 * Convert audio buffer to OGG/OPUS buffer for WhatsApp voice notes
 *
 * @param buffer - Audio buffer (e.g., from base64)
 * @param mimeType - Optional MIME type hint
 * @returns Buffer containing OGG/OPUS audio, or null if conversion not needed/failed
 */
export async function convertBufferForVoiceNote(
  buffer: Buffer,
  mimeType?: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  // Check if conversion is needed
  if (!needsConversion(mimeType)) {
    return null; // Already in correct format
  }

  // Check if ffmpeg is available
  const ffmpegAvailable = await isFFmpegAvailable();
  if (!ffmpegAvailable) {
    return null;
  }

  let inputPath: string | null = null;
  let outputPath: string | null = null;

  try {
    // Write buffer to temp file
    inputPath = join(tmpdir(), `omni-audio-${Date.now()}-input`);
    await fs.writeFile(inputPath, buffer);

    // Convert to OGG/OPUS
    outputPath = await convertToOggOpus(inputPath);

    // Read the converted file
    const convertedBuffer = await fs.readFile(outputPath);

    return {
      buffer: convertedBuffer,
      mimeType: 'audio/ogg; codecs=opus',
    };
  } finally {
    // Cleanup temp files
    if (inputPath) {
      await fs.unlink(inputPath).catch(() => {});
    }
    if (outputPath) {
      await fs.unlink(outputPath).catch(() => {});
    }
  }
}

/**
 * Get audio duration using ffprobe (optional, for waveform generation)
 */
export async function getAudioDuration(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-i',
      filePath,
      '-show_entries',
      'format=duration',
      '-v',
      'quiet',
      '-of',
      'csv=p=0',
    ]) as ChildProcessWithEvents;

    let stdout = '';

    ffprobe.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    ffprobe.on('close', (code: number | null) => {
      if (code === 0 && stdout.trim()) {
        const duration = Number.parseFloat(stdout.trim());
        resolve(Number.isNaN(duration) ? null : duration);
      } else {
        resolve(null);
      }
    });

    ffprobe.on('error', () => {
      resolve(null);
    });
  });
}
