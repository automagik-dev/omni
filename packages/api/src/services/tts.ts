/**
 * TTS (Text-to-Speech) Service
 *
 * Converts text to speech using ElevenLabs API and prepares audio
 * for sending as voice notes via channel plugins.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ERROR_CODES, OmniError } from '@omni/core';

/**
 * Extended ChildProcess type with EventEmitter methods
 * Workaround for bun-types missing EventEmitter interface on ChildProcess
 */
interface ChildProcessWithEvents extends ChildProcessWithoutNullStreams {
  on(event: 'close', listener: (code: number | null) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export interface TTSOptions {
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
}

export interface TTSResult {
  /** OGG/Opus audio buffer ready for voice note sending */
  buffer: Buffer;
  /** MIME type of the output audio */
  mimeType: string;
  /** Audio duration in milliseconds */
  durationMs: number;
  /** Size in KB */
  sizeKb: number;
}

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const ELEVENLABS_VOICES_URL = 'https://api.elevenlabs.io/v1/voices';

/** Simplified voice info returned from listVoices */
export interface TTSVoice {
  voiceId: string;
  name: string;
  category: string;
  description: string | null;
  previewUrl: string | null;
  labels: Record<string, string>;
}

/** In-memory cache for voices list */
interface VoicesCache {
  voices: TTSVoice[];
  expiresAt: number;
}

/** Settings reader interface — avoids circular dep on SettingsService */
export interface TTSSettingsReader {
  getSecret(key: string, envFallback?: string): Promise<string | undefined>;
  getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | undefined>;
}

export class TTSService {
  private voicesCache: VoicesCache | null = null;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private settings: TTSSettingsReader) {}

  /**
   * Get ElevenLabs API key from settings DB or env var
   */
  private async getApiKey(): Promise<string> {
    const apiKey = await this.settings.getSecret('elevenlabs.api_key', 'ELEVENLABS_API_KEY');
    if (!apiKey) {
      throw new OmniError({
        code: ERROR_CODES.VALIDATION,
        message: 'ElevenLabs API key not configured. Set it in Settings > TTS or via ELEVENLABS_API_KEY env var.',
        recoverable: false,
      });
    }
    return apiKey;
  }

  /**
   * List available ElevenLabs voices.
   * Results are cached in memory for 5 minutes.
   */
  async listVoices(): Promise<TTSVoice[]> {
    // Return cached if fresh
    if (this.voicesCache && Date.now() < this.voicesCache.expiresAt) {
      return this.voicesCache.voices;
    }

    const apiKey = await this.getApiKey();

    const response = await fetch(ELEVENLABS_VOICES_URL, {
      headers: { 'xi-api-key': apiKey },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new OmniError({
        code: ERROR_CODES.CHANNEL_SEND_FAILED,
        message: `ElevenLabs voices API error (${response.status}): ${errorBody}`,
        context: { status: response.status },
        recoverable: response.status >= 500,
      });
    }

    const data = (await response.json()) as {
      voices: Array<{
        voice_id: string;
        name: string;
        category: string;
        description: string | null;
        preview_url: string | null;
        labels: Record<string, string>;
      }>;
    };

    const voices: TTSVoice[] = data.voices.map((v) => ({
      voiceId: v.voice_id,
      name: v.name,
      category: v.category,
      description: v.description,
      previewUrl: v.preview_url,
      labels: v.labels ?? {},
    }));

    this.voicesCache = {
      voices,
      expiresAt: Date.now() + TTSService.CACHE_TTL_MS,
    };

    return voices;
  }

  /**
   * Synthesize text to OGG/Opus audio ready for voice note sending
   */
  async synthesize(text: string, options?: TTSOptions): Promise<TTSResult> {
    const apiKey = await this.getApiKey();

    const defaultVoice = await this.settings.getString(
      'elevenlabs.default_voice',
      'ELEVENLABS_DEFAULT_VOICE',
      'JBFqnCBsd6RMkjVDRZzb',
    );
    const defaultModel = await this.settings.getString('elevenlabs.default_model', undefined, 'eleven_v3');

    const voiceId = options?.voiceId || defaultVoice || 'JBFqnCBsd6RMkjVDRZzb';
    const modelId = options?.modelId || defaultModel || 'eleven_v3';
    const stability = options?.stability ?? 0.5;
    const similarityBoost = options?.similarityBoost ?? 0.75;

    // 1. Generate speech via ElevenLabs (returns MP3)
    const mp3Buffer = await this.callElevenLabs(apiKey, voiceId, text, {
      modelId,
      stability,
      similarityBoost,
    });

    // 2. Convert MP3 → OGG/Opus for WhatsApp voice notes
    const oggBuffer = await this.convertToOggOpus(mp3Buffer);

    // 3. Get audio duration
    const durationMs = await this.getAudioDurationMs(oggBuffer);

    return {
      buffer: oggBuffer,
      mimeType: 'audio/ogg; codecs=opus',
      durationMs,
      sizeKb: Math.round((oggBuffer.length / 1024) * 100) / 100,
    };
  }

  /**
   * Call ElevenLabs TTS API
   */
  private async callElevenLabs(
    apiKey: string,
    voiceId: string,
    text: string,
    settings: { modelId: string; stability: number; similarityBoost: number },
  ): Promise<Buffer> {
    const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: settings.modelId,
        voice_settings: {
          stability: settings.stability,
          similarity_boost: settings.similarityBoost,
        },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new OmniError({
        code: ERROR_CODES.CHANNEL_SEND_FAILED,
        message: `ElevenLabs API error (${response.status}): ${errorBody}`,
        context: { voiceId, modelId: settings.modelId, status: response.status },
        recoverable: response.status >= 500,
      });
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Convert MP3 buffer to OGG/Opus using ffmpeg
   */
  private async convertToOggOpus(mp3Buffer: Buffer): Promise<Buffer> {
    const inputPath = join(tmpdir(), `omni-tts-${Date.now()}-input.mp3`);
    const outputPath = join(tmpdir(), `omni-tts-${Date.now()}-output.ogg`);

    try {
      await fs.writeFile(inputPath, mp3Buffer);

      await new Promise<void>((resolve, reject) => {
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
          '-y',
          outputPath,
        ]) as ChildProcessWithEvents;

        let stderr = '';
        ffmpeg.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        ffmpeg.on('close', (code: number | null) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
          }
        });

        ffmpeg.on('error', (err: Error) => {
          reject(new Error(`ffmpeg failed to start: ${err.message}. Is ffmpeg installed?`));
        });
      });

      return await fs.readFile(outputPath);
    } finally {
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
    }
  }

  /**
   * Get audio duration in milliseconds using ffprobe
   */
  private async getAudioDurationMs(audioBuffer: Buffer): Promise<number> {
    const tempPath = join(tmpdir(), `omni-tts-${Date.now()}-duration.ogg`);

    try {
      await fs.writeFile(tempPath, audioBuffer);

      return await new Promise<number>((resolve) => {
        const ffprobe = spawn('ffprobe', [
          '-i',
          tempPath,
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
            const seconds = Number.parseFloat(stdout.trim());
            resolve(Number.isNaN(seconds) ? 0 : Math.round(seconds * 1000));
          } else {
            resolve(0);
          }
        });

        ffprobe.on('error', () => {
          resolve(0);
        });
      });
    } finally {
      await fs.unlink(tempPath).catch(() => {});
    }
  }
}
