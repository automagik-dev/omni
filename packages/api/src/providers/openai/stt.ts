/**
 * OpenAI STT provider.
 *
 * Quality lane: gpt-audio-mini via chat input_audio.
 * Stable fallback: gpt-4o-transcribe via /audio/transcriptions.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@omni/core';
import type { ISttProvider, SttOptions, SttResult, SttSegment } from '../types';

const log = createLogger('provider:openai:stt');

const DEFAULT_AUDIO_CHAT_MODEL = 'gpt-audio-mini';
const DEFAULT_TRANSCRIBE_MODEL = 'gpt-4o-transcribe';
const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';

export interface OpenAiSttSettingsReader {
  getSecret(key: string, envFallback?: string): Promise<string | undefined>;
  getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | undefined>;
}

interface OpenAiChatResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

interface OpenAiTranscriptionResponse {
  text?: string;
  language?: string;
  segments?: Array<{ text?: string; start?: number; end?: number }>;
}

export class OpenAiSttProvider implements ISttProvider {
  readonly name = 'openai';

  constructor(private settings: OpenAiSttSettingsReader) {}

  async transcribe(audio: Buffer, mimeType: string, options?: SttOptions): Promise<SttResult> {
    const started = Date.now();
    const apiKey = await this.getApiKey();
    const configuredModel = await this.settings.getString(
      'stt.openai.model',
      'OPENAI_STT_MODEL',
      DEFAULT_AUDIO_CHAT_MODEL,
    );
    const model = options?.model ?? configuredModel ?? DEFAULT_AUDIO_CHAT_MODEL;

    if (model.startsWith('gpt-audio')) {
      return this.transcribeWithAudioChat(apiKey, model, audio, mimeType, options, started);
    }

    return this.transcribeWithTranscriptions(
      apiKey,
      model || DEFAULT_TRANSCRIBE_MODEL,
      audio,
      mimeType,
      options,
      started,
    );
  }

  private async transcribeWithAudioChat(
    apiKey: string,
    model: string,
    audio: Buffer,
    mimeType: string,
    options: SttOptions | undefined,
    started: number,
  ): Promise<SttResult> {
    const prompt = buildPrompt(options);
    const normalized = normalizeForOpenAiAudioChat(audio, mimeType);
    log.debug('Calling OpenAI audio chat STT', {
      model,
      mimeType,
      inputFormat: normalized.format,
      sizeBytes: normalized.audio.length,
      language: options?.language,
    });

    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'input_audio',
                input_audio: {
                  data: normalized.audio.toString('base64'),
                  format: normalized.format,
                },
              },
            ],
          },
        ],
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`OpenAI audio chat STT error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as OpenAiChatResponse;
    return {
      text: extractAssistantText(data),
      detectedLanguage: options?.language,
      processingMs: Date.now() - started,
    };
  }

  private async transcribeWithTranscriptions(
    apiKey: string,
    model: string,
    audio: Buffer,
    mimeType: string,
    options: SttOptions | undefined,
    started: number,
  ): Promise<SttResult> {
    const wantTimestamps = options?.timestamps ?? false;
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mimeType }), guessFilename(mimeType));
    form.append('model', model || DEFAULT_TRANSCRIBE_MODEL);
    form.append('response_format', wantTimestamps ? 'verbose_json' : 'json');
    if (options?.language) form.append('language', normalizeLanguage(options.language));
    const prompt = buildPrompt(options, { compact: true });
    if (prompt) form.append('prompt', prompt);
    if (wantTimestamps) form.append('timestamp_granularities[]', 'segment');

    log.debug('Calling OpenAI transcriptions STT', { model, mimeType, sizeBytes: audio.length, wantTimestamps });
    const response = await fetch(TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => 'Unknown error');
      throw new Error(`OpenAI transcription error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as OpenAiTranscriptionResponse;
    let segments: SttSegment[] | undefined;
    if (wantTimestamps && Array.isArray(data.segments)) {
      segments = data.segments.map((s) => ({
        text: (s.text ?? '').trim(),
        startMs: typeof s.start === 'number' ? Math.round(s.start * 1000) : undefined,
        endMs: typeof s.end === 'number' ? Math.round(s.end * 1000) : undefined,
      }));
    }

    return {
      text: (data.text ?? '').trim(),
      segments,
      detectedLanguage: data.language ?? options?.language,
      processingMs: Date.now() - started,
    };
  }

  private async getApiKey(): Promise<string> {
    const key = await this.settings.getSecret('openai.api_key', 'OPENAI_API_KEY');
    if (!key) {
      throw new Error('OpenAI API key not configured. Set openai.api_key or OPENAI_API_KEY.');
    }
    return key;
  }
}

export function buildPrompt(options?: SttOptions, flags?: { compact?: boolean }): string {
  const parts: string[] = [];
  const language = (options?.language ?? '').toLowerCase();
  if (options?.prompt) {
    parts.push(options.prompt.trim());
  } else if (language.startsWith('pt')) {
    parts.push(
      'Transcreva literalmente em pt-BR informal. Pode haver code-switching.',
      'Retorne apenas a transcrição, sem resumo, tradução, preâmbulo ou explicação.',
      'Use contexto/glossário só para desambiguar nomes, acrônimos, comandos e produtos; não invente se não for acusticamente plausível.',
    );
  } else {
    parts.push(
      'Transcribe the audio verbatim.',
      'Return only the transcript text. Do not summarize, translate, explain, or add a preamble.',
      'Use context/glossary only to disambiguate names, acronyms, commands, and product terms; do not invent terms that are not acoustically plausible.',
    );
  }
  if (options?.context) parts.push(`Context: ${options.context.trim()}`);
  if (options?.glossary?.length)
    parts.push(
      `Glossary: ${options.glossary
        .map((x) => x.trim())
        .filter(Boolean)
        .join(', ')}`,
    );
  const text = parts.join(flags?.compact ? '\n' : '\n\n');
  return text.slice(0, 4000);
}

function extractAssistantText(data: OpenAiChatResponse): string {
  const content = data.choices?.[0]?.message?.content;
  let raw = '';
  if (typeof content === 'string') {
    raw = content;
  } else if (Array.isArray(content)) {
    raw = content.map((part) => part.text ?? '').join('\n');
  }
  raw = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(raw) as { text?: string; transcription?: string; transcript?: string };
    return (parsed.text ?? parsed.transcription ?? parsed.transcript ?? raw).trim();
  } catch {
    return raw;
  }
}

function normalizeForOpenAiAudioChat(audio: Buffer, mimeType: string): { audio: Buffer; format: 'mp3' | 'wav' } {
  const format = toOpenAiAudioFormat(mimeType);
  if (format === 'mp3' || format === 'wav') {
    return { audio, format };
  }

  const dir = mkdtempSync(join(tmpdir(), 'omni-openai-audio-'));
  const input = join(dir, `input.${sourceExtension(mimeType)}`);
  const output = join(dir, 'output.mp3');
  try {
    writeFileSync(input, audio);
    execFileSync(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        input,
        '-vn',
        '-acodec',
        'libmp3lame',
        '-ar',
        '24000',
        '-ac',
        '1',
        output,
      ],
      {
        timeout: 60_000,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    return { audio: readFileSync(output), format: 'mp3' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sourceExtension(mimeType: string): string {
  const lower = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (lower.includes('ogg') || lower.includes('opus')) return 'ogg';
  if (lower.includes('webm')) return 'webm';
  if (lower.includes('mp4') || lower.includes('m4a')) return 'm4a';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  if (lower.includes('flac')) return 'flac';
  return 'bin';
}

function toOpenAiAudioFormat(mimeType: string): string {
  const lower = mimeType.toLowerCase().split(';')[0]?.trim() ?? 'audio/ogg';
  if (lower === 'audio/mpeg' || lower === 'audio/mp3') return 'mp3';
  if (lower === 'audio/wav' || lower === 'audio/x-wav') return 'wav';
  if (lower === 'audio/ogg' || lower === 'audio/opus') return 'ogg';
  if (lower === 'audio/webm') return 'webm';
  if (lower === 'audio/mp4' || lower === 'audio/m4a' || lower === 'audio/x-m4a') return 'mp4';
  if (lower === 'audio/flac') return 'flac';
  return 'ogg';
}

function guessFilename(mimeType: string): string {
  const format = toOpenAiAudioFormat(mimeType);
  return `audio.${format}`;
}

function normalizeLanguage(language: string): string {
  return language.toLowerCase() === 'pt-br' ? 'pt' : language;
}
