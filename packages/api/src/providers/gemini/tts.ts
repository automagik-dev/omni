/**
 * Gemini TTS Provider
 *
 * Uses `gemini-2.5-flash-preview-tts` with 30 prebuilt voices and free-form
 * style prompts. Gemini returns raw PCM (24kHz, 16-bit, mono). This provider
 * wraps it in a WAV header and converts it to OGG/Opus via ffmpeg for
 * WhatsApp-compatible voice notes.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/speech-generation
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@omni/core';
import type { ITtsProvider, TtsOptions, TtsResult, TtsVoice } from '../types';
import { GEMINI_MODELS, getGeminiClient, resolveGeminiApiKey } from './client';

const log = createLogger('gemini-tts');

interface ChildProcessWithEvents extends ChildProcessWithoutNullStreams {
  on(event: 'close', listener: (code: number | null) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

/** Settings reader interface — avoids circular dep on SettingsService */
export interface GeminiTtsSettingsReader {
  getSecret(key: string, envFallback?: string): Promise<string | undefined>;
  getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | undefined>;
}

/**
 * Gemini prebuilt voices (30 total).
 * Docs: https://ai.google.dev/gemini-api/docs/speech-generation#voices
 */
const GEMINI_VOICES: TtsVoice[] = [
  { id: 'Zephyr', name: 'Zephyr', provider: 'gemini', gender: 'female' },
  { id: 'Puck', name: 'Puck', provider: 'gemini', gender: 'male' },
  { id: 'Charon', name: 'Charon', provider: 'gemini', gender: 'male' },
  { id: 'Kore', name: 'Kore', provider: 'gemini', gender: 'female' },
  { id: 'Fenrir', name: 'Fenrir', provider: 'gemini', gender: 'male' },
  { id: 'Leda', name: 'Leda', provider: 'gemini', gender: 'female' },
  { id: 'Orus', name: 'Orus', provider: 'gemini', gender: 'male' },
  { id: 'Aoede', name: 'Aoede', provider: 'gemini', gender: 'female' },
  { id: 'Callirrhoe', name: 'Callirrhoe', provider: 'gemini', gender: 'female' },
  { id: 'Autonoe', name: 'Autonoe', provider: 'gemini', gender: 'female' },
  { id: 'Enceladus', name: 'Enceladus', provider: 'gemini', gender: 'male' },
  { id: 'Iapetus', name: 'Iapetus', provider: 'gemini', gender: 'male' },
  { id: 'Umbriel', name: 'Umbriel', provider: 'gemini', gender: 'male' },
  { id: 'Algieba', name: 'Algieba', provider: 'gemini', gender: 'male' },
  { id: 'Despina', name: 'Despina', provider: 'gemini', gender: 'female' },
  { id: 'Erinome', name: 'Erinome', provider: 'gemini', gender: 'female' },
  { id: 'Algenib', name: 'Algenib', provider: 'gemini', gender: 'male' },
  { id: 'Rasalgethi', name: 'Rasalgethi', provider: 'gemini', gender: 'male' },
  { id: 'Laomedeia', name: 'Laomedeia', provider: 'gemini', gender: 'female' },
  { id: 'Achernar', name: 'Achernar', provider: 'gemini', gender: 'female' },
  { id: 'Alnilam', name: 'Alnilam', provider: 'gemini', gender: 'male' },
  { id: 'Schedar', name: 'Schedar', provider: 'gemini', gender: 'male' },
  { id: 'Gacrux', name: 'Gacrux', provider: 'gemini', gender: 'female' },
  { id: 'Pulcherrima', name: 'Pulcherrima', provider: 'gemini', gender: 'female' },
  { id: 'Achird', name: 'Achird', provider: 'gemini', gender: 'male' },
  { id: 'Zubenelgenubi', name: 'Zubenelgenubi', provider: 'gemini', gender: 'male' },
  { id: 'Vindemiatrix', name: 'Vindemiatrix', provider: 'gemini', gender: 'female' },
  { id: 'Sadachbia', name: 'Sadachbia', provider: 'gemini', gender: 'male' },
  { id: 'Sadaltager', name: 'Sadaltager', provider: 'gemini', gender: 'male' },
  { id: 'Sulafat', name: 'Sulafat', provider: 'gemini', gender: 'female' },
];

const DEFAULT_VOICE = 'Orus';
const DEFAULT_LANGUAGE = 'pt-BR';
const DEFAULT_STYLE =
  'Fale em português brasileiro, como uma nota de WhatsApp natural: direto, quente, sem voz de locutor, com pausas curtas quando fizer sentido.';

/** Extended TTS options — Gemini supports style prompts */
export interface GeminiTtsOptions extends TtsOptions {
  /** Natural-language style prompt prepended to the text (e.g. "Say cheerfully:") */
  style?: string;
}

export class GeminiTtsProvider implements ITtsProvider {
  readonly name = 'gemini';

  constructor(private settings: GeminiTtsSettingsReader) {}

  async synthesize(text: string, options?: GeminiTtsOptions): Promise<TtsResult> {
    if (!text || text.trim().length === 0) {
      throw new Error('Gemini TTS: text must not be empty');
    }

    const apiKey = await resolveGeminiApiKey(this.settings);
    const client = getGeminiClient(apiKey);

    const model =
      options?.model ??
      (await this.settings.getString('tts.gemini.model', 'GEMINI_TTS_MODEL', GEMINI_MODELS.TTS)) ??
      GEMINI_MODELS.TTS;
    const voice =
      options?.voice ??
      (await this.settings.getString('tts.gemini.default_voice', 'GEMINI_TTS_DEFAULT_VOICE', DEFAULT_VOICE)) ??
      DEFAULT_VOICE;
    const language =
      options?.language ??
      (await this.settings.getString('tts.gemini.default_language', 'GEMINI_TTS_DEFAULT_LANGUAGE', DEFAULT_LANGUAGE)) ??
      DEFAULT_LANGUAGE;
    const defaultStyle =
      (await this.settings.getString('tts.gemini.default_style', 'GEMINI_TTS_DEFAULT_STYLE', DEFAULT_STYLE)) ??
      DEFAULT_STYLE;
    const prompt = buildPrompt(text, { ...options, language }, defaultStyle);
    const speechConfig = buildSpeechConfig(voice, options);

    log.debug('Generating speech', {
      model,
      voice,
      textLen: text.length,
      hasStyle: !!options?.style,
      multiSpeaker: options?.multiSpeaker?.length ?? 0,
    });

    const response = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig,
      },
    });

    const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inlineData?.data) {
      throw new Error('Gemini TTS: no audio returned in response');
    }

    // Gemini returns raw PCM (signed 16-bit little-endian, 24kHz, mono) base64 encoded
    const pcmBuffer = Buffer.from(inlineData.data, 'base64');
    const sourceMime = inlineData.mimeType || 'audio/L16;rate=24000';
    const { sampleRate, channels } = parsePcmMimeType(sourceMime);

    // Decide output format: default to ogg/opus for voice note compatibility
    const format = options?.format || 'ogg';

    if (format === 'pcm') {
      return {
        audio: pcmBuffer,
        mimeType: sourceMime,
        durationMs: estimatePcmDurationMs(pcmBuffer.length, sampleRate, channels, 16),
        sizeBytes: pcmBuffer.length,
      };
    }

    if (format === 'wav') {
      const wavBuffer = wrapPcmInWav(pcmBuffer, sampleRate, channels, 16);
      return {
        audio: wavBuffer,
        mimeType: 'audio/wav',
        durationMs: estimatePcmDurationMs(pcmBuffer.length, sampleRate, channels, 16),
        sizeBytes: wavBuffer.length,
      };
    }

    // Default path: convert to OGG/Opus for WhatsApp voice notes
    const wavBuffer = wrapPcmInWav(pcmBuffer, sampleRate, channels, 16);
    const oggBuffer = await convertWavToOggOpus(wavBuffer);
    const durationMs = await getAudioDurationMs(oggBuffer);

    return {
      audio: oggBuffer,
      mimeType: 'audio/ogg; codecs=opus',
      durationMs,
      sizeBytes: oggBuffer.length,
    };
  }

  async listVoices(): Promise<TtsVoice[]> {
    return GEMINI_VOICES;
  }
}

function buildPrompt(text: string, options: GeminiTtsOptions, defaultStyle: string): string {
  if (options.instructions?.trim()) {
    return `${options.instructions.trim()}\n\n${text}`;
  }
  const parts = [defaultStyle];
  if (options.voiceNoteProfile) parts.push(`Voice-note profile: ${options.voiceNoteProfile}.`);
  if (options.language) parts.push(`Idioma/language: ${options.language}.`);
  if (options.style) parts.push(`Style: ${options.style}.`);
  if (options.tone) parts.push(`Tone: ${options.tone}.`);
  if (options.accent) parts.push(`Accent: ${options.accent}.`);
  if (options.pace) parts.push(`Pace: ${options.pace}.`);
  if (options.emotion) parts.push(`Emotion: ${options.emotion}.`);
  if (options.speed) parts.push(`Speaking speed intent: ${options.speed}x.`);
  return `${parts.filter(Boolean).join('\n')}\n\nTexto/transcript:\n${text}`;
}

function buildSpeechConfig(voice: string, options?: GeminiTtsOptions): Record<string, unknown> {
  const multiSpeaker = options?.multiSpeaker?.filter((speaker) => speaker.speaker.trim() && speaker.voice.trim()) ?? [];
  if (multiSpeaker.length > 2) {
    throw new Error('Gemini TTS multiSpeaker supports at most 2 speakers');
  }
  if (multiSpeaker.length > 0) {
    return {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: multiSpeaker.map((speaker) => ({
          speaker: speaker.speaker,
          voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker.voice } },
        })),
      },
    };
  }
  return {
    voiceConfig: {
      prebuiltVoiceConfig: { voiceName: voice },
    },
  };
}

// ---------------------------------------------------------------------------
// PCM / WAV helpers
// ---------------------------------------------------------------------------

/**
 * Parse Gemini's audio mime type (e.g. "audio/L16;codecs=pcm;rate=24000")
 * and extract sample rate and channel count.
 */
function parsePcmMimeType(mimeType: string): { sampleRate: number; channels: number } {
  let sampleRate = 24000;
  let channels = 1;

  const rateMatch = mimeType.match(/rate=(\d+)/i);
  if (rateMatch?.[1]) {
    sampleRate = Number.parseInt(rateMatch[1], 10);
  }
  const channelsMatch = mimeType.match(/channels=(\d+)/i);
  if (channelsMatch?.[1]) {
    channels = Number.parseInt(channelsMatch[1], 10);
  }

  return { sampleRate, channels };
}

/**
 * Wrap raw PCM audio in a WAV (RIFF) container so ffmpeg can decode it.
 */
function wrapPcmInWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const chunkSize = 36 + dataSize;

  const header = Buffer.alloc(44);
  // RIFF chunk descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(chunkSize, 4);
  header.write('WAVE', 8);
  // fmt sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM sub-chunk size
  header.writeUInt16LE(1, 20); // audio format: PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  // data sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

function estimatePcmDurationMs(byteCount: number, sampleRate: number, channels: number, bitsPerSample: number): number {
  const bytesPerSecond = (sampleRate * channels * bitsPerSample) / 8;
  if (bytesPerSecond === 0) return 0;
  return Math.round((byteCount / bytesPerSecond) * 1000);
}

/**
 * Convert a WAV buffer to OGG/Opus via ffmpeg (voip profile, 48kHz mono).
 */
async function convertWavToOggOpus(wavBuffer: Buffer): Promise<Buffer> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inputPath = join(tmpdir(), `omni-gemini-tts-${stamp}-input.wav`);
  const outputPath = join(tmpdir(), `omni-gemini-tts-${stamp}-output.ogg`);

  try {
    await fs.writeFile(inputPath, wavBuffer);

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

async function getAudioDurationMs(audioBuffer: Buffer): Promise<number> {
  const tempPath = join(tmpdir(), `omni-gemini-tts-${Date.now()}-duration.ogg`);
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
