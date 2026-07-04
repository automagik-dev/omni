/**
 * Audio Processor
 *
 * Quality-first transcription for Omni media/backfill:
 * OpenAI gpt-audio-mini primary, OpenAI gpt-4o-transcribe stable fallback,
 * Gemini 3.1 Flash Lite omni-modal fallback, Groq Whisper fast fallback.
 *
 * Uses centralized retry + circuit breaker for resilience.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import Groq from 'groq-sdk';
import type { Uploadable } from 'openai/uploads';

import { GEMINI_AUDIO_MODEL, GROQ_WHISPER_MODEL, OPENAI_AUDIO_CHAT_MODEL, OPENAI_TRANSCRIBE_MODEL } from '../models';
import { calculateCost } from '../pricing';
import type { ProcessOptions, ProcessingResult } from '../types';
import { getMediaTimeouts } from '../types';
import { BaseProcessor } from './base';

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
const GEMINI_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const PROVIDER_AUDIO_TARGET_BYTES = 24 * 1024 * 1024;
const execFileAsync = promisify(execFile);

/** Audio processor using quality-first STT with fallbacks. */
export class AudioProcessor extends BaseProcessor {
  readonly name = 'audio';
  readonly supportedMimeTypes = [
    'audio/*',
    'audio/ogg',
    'audio/opus',
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/wav',
    'audio/webm',
    'audio/flac',
    'audio/m4a',
    'audio/x-m4a',
  ] as const;

  private groqClient: Groq | null = null;

  private getGroqClient(): Groq | null {
    if (!this.groqClient && this.config.groqApiKey) {
      this.groqClient = new Groq({ apiKey: this.config.groqApiKey });
      this.log.info('Groq client initialized');
    }
    return this.groqClient;
  }

  async process(filePath: string, mimeType: string, options?: ProcessOptions): Promise<ProcessingResult> {
    const startTime = performance.now();
    const language = options?.language ?? this.config.defaultLanguage ?? 'pt';
    const durationSeconds = options?.durationSeconds ?? this.estimateDuration(filePath);
    const provider = options?.provider ?? this.config.audioProvider ?? 'openai';
    const preferredModel = options?.model ?? this.config.audioModel;

    let normalizedAudioPromise: Promise<NormalizedAudioFile> | undefined;
    const getNormalizedAudio = () => {
      normalizedAudioPromise ??= normalizeAudioFileForProvider(filePath, mimeType);
      return normalizedAudioPromise;
    };

    const attempts = this.buildTranscriptionAttempts(provider, language, options, preferredModel, getNormalizedAudio);

    let result: ProcessingResult = this.createFailedResult(
      'No transcription attempts configured',
      provider,
      preferredModel ?? 'unknown',
    );
    try {
      for (const attempt of attempts) {
        result = await attempt();
        if (shouldStopAudioFallback(result)) break;
        this.log.warn('Audio transcription attempt failed; trying next fallback', {
          provider: result.provider,
          model: result.model,
          error: result.errorMessage,
        });
      }
    } finally {
      await cleanupNormalizedAudio(normalizedAudioPromise);
    }

    result.processingTimeMs = Math.round(performance.now() - startTime);
    this.applyDurationAndCost(result, durationSeconds);
    this.logProcessingResult(result);

    return result;
  }

  private applyDurationAndCost(result: ProcessingResult, durationSeconds: number | undefined): void {
    if (!result.success || !durationSeconds) return;
    result.duration = durationSeconds;
    const pricingKey = result.provider === 'groq' ? 'groq_whisper' : 'openai_whisper';
    result.costCents = calculateCost(pricingKey, result.model, { durationSeconds });
  }

  private logProcessingResult(result: ProcessingResult): void {
    if (!result.success) {
      this.log.error('Audio transcription failed', { error: result.errorMessage });
      return;
    }
    this.log.info('Audio transcription successful', {
      provider: result.provider,
      model: result.model,
      processingTimeMs: result.processingTimeMs,
      costCents: result.costCents,
    });
  }

  private buildTranscriptionAttempts(
    provider: string,
    language: string,
    options: ProcessOptions | undefined,
    preferredModel: string | undefined,
    getNormalizedAudio: () => Promise<NormalizedAudioFile>,
  ): Array<() => Promise<ProcessingResult>> {
    if (provider === 'openai') {
      return [
        () =>
          this.transcribeWithOpenAiAudioChat(
            language,
            options,
            preferredModel ?? OPENAI_AUDIO_CHAT_MODEL,
            getNormalizedAudio,
          ),
        () => this.transcribeWithOpenAiTranscriptions(language, options, OPENAI_TRANSCRIBE_MODEL, getNormalizedAudio),
        () => this.transcribeWithGemini(language, options, GEMINI_AUDIO_MODEL, getNormalizedAudio),
        () => this.transcribeWithGroq(language, getNormalizedAudio),
      ];
    }

    if (provider === 'gemini') {
      return [
        () =>
          this.transcribeWithGemini(
            language,
            options,
            this.resolveGeminiAudioModel(options?.model),
            getNormalizedAudio,
          ),
        () => this.transcribeWithOpenAiAudioChat(language, options, OPENAI_AUDIO_CHAT_MODEL, getNormalizedAudio),
        () => this.transcribeWithGroq(language, getNormalizedAudio),
      ];
    }

    return [
      () => this.transcribeWithGroq(language, getNormalizedAudio),
      () =>
        this.transcribeWithOpenAiTranscriptions(
          language,
          options,
          preferredModel ?? OPENAI_TRANSCRIBE_MODEL,
          getNormalizedAudio,
        ),
    ];
  }

  /**
   * Resolve the model for a Gemini transcription attempt.
   *
   * `config.audioModel` is the OpenAI-chat model and must never leak into Gemini
   * — that leak made WhatsApp voice notes fail as `provider:gemini model:gpt-audio-mini`.
   * A per-call override is honored only when it targets Gemini; otherwise fall back
   * to the configured Gemini model, then the built-in default.
   */
  private resolveGeminiAudioModel(optionModel: string | undefined): string {
    if (optionModel?.startsWith('gemini')) return optionModel;
    return this.config.geminiAudioModel ?? GEMINI_AUDIO_MODEL;
  }

  private async transcribeWithOpenAiAudioChat(
    language: string,
    options: ProcessOptions | undefined,
    model: string,
    getNormalizedAudio: () => Promise<NormalizedAudioFile>,
  ): Promise<ProcessingResult> {
    if (!this.config.openaiApiKey) {
      return this.createFailedResult('OpenAI client not configured (missing API key)', 'openai', model);
    }
    const timeouts = getMediaTimeouts();
    try {
      const text = await this.executeWithResilience(
        'openai',
        async () => {
          const normalized = await getNormalizedAudio();
          const audio = await fs.readFile(normalized.filePath);
          const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.config.openaiApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: buildPrompt(language, options, this.config.audioPrompt, this.config.audioGlossary),
                    },
                    {
                      type: 'input_audio',
                      input_audio: {
                        data: audio.toString('base64'),
                        format: normalized.format === 'wav' ? 'wav' : 'mp3',
                      },
                    },
                  ],
                },
              ],
              temperature: 0,
            }),
          });
          if (!response.ok) throw new Error(`OpenAI audio chat error (${response.status}): ${await response.text()}`);
          const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
          return extractText(data.choices?.[0]?.message?.content);
        },
        { timeoutMs: timeouts.audioTimeoutMs },
      );
      return this.createSuccessResult(text, 'openai', model, language);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return this.createFailedResult(errorMsg, 'openai', model);
    }
  }

  private async transcribeWithOpenAiTranscriptions(
    language: string,
    options: ProcessOptions | undefined,
    model: string,
    getNormalizedAudio: () => Promise<NormalizedAudioFile>,
  ): Promise<ProcessingResult> {
    if (!this.config.openaiApiKey) {
      return this.createFailedResult('OpenAI client not configured (missing API key)', 'openai', model);
    }
    const timeouts = getMediaTimeouts();
    try {
      const text = await this.executeWithResilience(
        'openai',
        async () => {
          const normalized = await getNormalizedAudio();
          const fileBuffer = await Bun.file(normalized.filePath).arrayBuffer();
          const form = new FormData();
          form.append(
            'file',
            new File([fileBuffer], `audio.${normalized.format}`, { type: normalized.mimeType }) as unknown as Blob,
          );
          form.append('model', model);
          form.append('response_format', 'json');
          if (language) form.append('language', language.toLowerCase() === 'pt-br' ? 'pt' : language);
          form.append('prompt', buildPrompt(language, options, this.config.audioPrompt, this.config.audioGlossary));
          const response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.config.openaiApiKey}` },
            body: form,
          });
          if (!response.ok)
            throw new Error(`OpenAI transcription error (${response.status}): ${await response.text()}`);
          const data = (await response.json()) as { text?: string };
          return data.text ?? '';
        },
        { timeoutMs: timeouts.audioTimeoutMs },
      );
      return this.createSuccessResult(text, 'openai', model, language);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return this.createFailedResult(errorMsg, 'openai', model);
    }
  }

  private async transcribeWithGemini(
    language: string,
    options: ProcessOptions | undefined,
    model: string,
    getNormalizedAudio: () => Promise<NormalizedAudioFile>,
  ): Promise<ProcessingResult> {
    if (!this.config.geminiApiKey) {
      return this.createFailedResult('Gemini client not configured (missing API key)', 'gemini', model);
    }
    const timeouts = getMediaTimeouts();
    try {
      const text = await this.executeWithResilience(
        'gemini',
        async () => {
          const normalized = await getNormalizedAudio();
          const fileBuffer = await Bun.file(normalized.filePath).arrayBuffer();
          const url = `${GEMINI_GENERATE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.config.geminiApiKey ?? '')}`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: buildPrompt(language, options, this.config.audioPrompt, this.config.audioGlossary) },
                    {
                      inlineData: {
                        data: Buffer.from(fileBuffer).toString('base64'),
                        mimeType: normalizeGeminiAudioMimeType(normalized.mimeType),
                      },
                    },
                  ],
                },
              ],
            }),
          });
          if (!response.ok)
            throw new Error(`Gemini transcription error (${response.status}): ${await response.text()}`);
          const data = (await response.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('\n') ?? '';
        },
        { timeoutMs: timeouts.audioTimeoutMs },
      );
      return this.createSuccessResult(text, 'gemini', model, language);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return this.createFailedResult(errorMsg, 'gemini', model);
    }
  }

  private async transcribeWithGroq(
    language: string,
    getNormalizedAudio: () => Promise<NormalizedAudioFile>,
  ): Promise<ProcessingResult> {
    const client = this.getGroqClient();
    if (!client)
      return this.createFailedResult('Groq client not configured (missing API key)', 'groq', GROQ_WHISPER_MODEL);
    const timeouts = getMediaTimeouts();

    try {
      const text = await this.executeWithResilience(
        'groq',
        async () => {
          const normalized = await getNormalizedAudio();
          const filename = `audio.${normalized.format}`;
          const fileBuffer = await Bun.file(normalized.filePath).arrayBuffer();
          const file = new File([fileBuffer], filename, { type: normalized.mimeType });
          const transcription = await client.audio.transcriptions.create({
            file: file as unknown as Uploadable,
            model: GROQ_WHISPER_MODEL,
            language: language.toLowerCase() === 'pt-br' ? 'pt' : language,
            response_format: 'text',
          });
          return typeof transcription === 'string' ? transcription : ((transcription as { text?: string }).text ?? '');
        },
        { timeoutMs: timeouts.audioTimeoutMs },
      );
      return this.createSuccessResult(text, 'groq', GROQ_WHISPER_MODEL, language);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isCircuit = this.isCircuitOpen(error);
      this.log.error('Groq transcription error', { error: errorMsg, circuitOpen: isCircuit });
      return this.createFailedResult(errorMsg, 'groq', GROQ_WHISPER_MODEL);
    }
  }

  private createSuccessResult(text: string, provider: string, model: string, language: string): ProcessingResult {
    return {
      success: true,
      content: text.trim(),
      contentFormat: 'text',
      processingType: 'transcription',
      provider,
      model,
      processingTimeMs: 0,
      language,
      costCents: 0,
    };
  }

  private estimateDuration(filePath: string): number | undefined {
    try {
      const stats = statSync(filePath);
      const estimatedSeconds = Math.round(stats.size / 2000);
      return Math.max(1, estimatedSeconds);
    } catch {
      return undefined;
    }
  }
}

function shouldStopAudioFallback(result: ProcessingResult): boolean {
  return (
    result.success || Boolean(result.errorMessage?.includes('Normalized audio still exceeds provider upload limit'))
  );
}

async function cleanupNormalizedAudio(normalizedAudioPromise: Promise<NormalizedAudioFile> | undefined): Promise<void> {
  if (!normalizedAudioPromise) return;
  try {
    const normalized = await normalizedAudioPromise;
    if (normalized.cleanupPath) await fs.rm(normalized.cleanupPath, { recursive: true, force: true });
  } catch {
    // normalizeAudioFileForProvider already cleans up failed temp dirs.
  }
}

function buildPrompt(
  language: string,
  options?: ProcessOptions,
  defaultPrompt?: string,
  defaultGlossary?: string[],
): string {
  const parts: string[] = [];
  if (options?.prompt || defaultPrompt) parts.push((options?.prompt ?? defaultPrompt ?? '').trim());
  else if (language.toLowerCase().startsWith('pt')) {
    parts.push(
      'Transcreva literalmente em pt-BR informal. Pode haver code-switching.',
      'Retorne apenas a transcrição, sem resumo, tradução, preâmbulo ou explicação.',
      'Use contexto/glossário só para desambiguar nomes, acrônimos, comandos e produtos; não invente se não for acusticamente plausível.',
    );
  } else {
    parts.push(
      'Transcribe the audio verbatim. Return only the transcript text. Do not summarize, translate, explain, or add a preamble.',
    );
  }
  if (options?.context) parts.push(`Context: ${options.context}`);
  const glossary = options?.glossary?.length ? options.glossary : defaultGlossary;
  if (glossary?.length) parts.push(`Glossary: ${glossary.join(', ')}`);
  return parts.join('\n\n').slice(0, 4000);
}

function extractText(content: unknown): string {
  let raw = '';
  if (typeof content === 'string') raw = content;
  else if (Array.isArray(content))
    raw = content
      .map((part) => (typeof part === 'object' && part ? ((part as { text?: string }).text ?? '') : ''))
      .join('\n');
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

interface NormalizedAudioFile {
  filePath: string;
  mimeType: string;
  format: 'mp3' | 'wav';
  cleanupPath?: string;
}

async function normalizeAudioFileForProvider(filePath: string, mimeType: string): Promise<NormalizedAudioFile> {
  const format = toOpenAiAudioFormat(mimeType);
  const stats = statSync(filePath);
  if ((format === 'mp3' || format === 'wav') && stats.size <= PROVIDER_AUDIO_TARGET_BYTES) {
    return { filePath, mimeType: format === 'wav' ? 'audio/wav' : 'audio/mpeg', format };
  }

  const dir = await fs.mkdtemp(join(tmpdir(), 'omni-provider-audio-'));
  const output = join(dir, `${basename(filePath)}.provider.mp3`);
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        filePath,
        '-vn',
        '-acodec',
        'libmp3lame',
        '-b:a',
        '32k',
        '-ar',
        '24000',
        '-ac',
        '1',
        output,
      ],
      {
        timeout: 5 * 60_000,
      },
    );
    const normalizedStats = await fs.stat(output);
    if (normalizedStats.size > PROVIDER_AUDIO_TARGET_BYTES) {
      throw new Error(
        `Normalized audio still exceeds provider upload limit: ${normalizedStats.size} bytes > ${PROVIDER_AUDIO_TARGET_BYTES} bytes`,
      );
    }
    return { filePath: output, mimeType: 'audio/mpeg', format: 'mp3', cleanupPath: dir };
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }
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

function normalizeGeminiAudioMimeType(mimeType: string): string {
  const lower = mimeType.toLowerCase().split(';')[0]?.trim() ?? 'audio/ogg';
  if (lower === 'audio/mpeg') return 'audio/mp3';
  if (lower === 'audio/x-m4a' || lower === 'audio/m4a' || lower === 'audio/mp4') return 'audio/mp4';
  if (lower === 'audio/opus') return 'audio/ogg';
  return lower;
}
