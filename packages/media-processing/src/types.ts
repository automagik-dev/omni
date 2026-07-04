/**
 * Media Processing Types
 *
 * Defines interfaces for media processors and their results.
 */

/**
 * Processing result returned by processors
 */
export interface ProcessingResult {
  /** Whether processing succeeded */
  success: boolean;
  /** Extracted/transcribed content */
  content?: string;
  /** Content format: 'text', 'markdown', 'json' */
  contentFormat: 'text' | 'markdown' | 'json';
  /** Type of processing performed */
  processingType: 'transcription' | 'description' | 'extraction';
  /** Provider used (groq, openai, gemini, local) */
  provider: string;
  /** Model used (whisper-large-v3-turbo, etc.) */
  model: string;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Detected language (for audio) */
  language?: string;
  /** Duration in seconds (for audio/video) */
  duration?: number;
  /** Input tokens used (for LLM-based) */
  inputTokens?: number;
  /** Output tokens used (for LLM-based) */
  outputTokens?: number;
  /** Total cost in cents (integer for simplicity) */
  costCents: number;
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Configuration for processors
 */
export interface ProcessorConfig {
  /** Groq API key for Whisper */
  groqApiKey?: string;
  /** OpenAI API key (fallback for audio, vision) */
  openaiApiKey?: string;
  /** Preferred audio provider (openai, gemini, groq) */
  audioProvider?: string;
  /** Preferred OpenAI-chat audio model (used by the 'openai' provider; never sent to Gemini) */
  audioModel?: string;
  /** Preferred Gemini audio model (used by the 'gemini' provider; falls back to GEMINI_AUDIO_MODEL) */
  geminiAudioModel?: string;
  /** Default audio transcription prompt/context */
  audioPrompt?: string;
  /** Default audio glossary */
  audioGlossary?: string[];
  /** Google Gemini API key (vision, document OCR) */
  geminiApiKey?: string;
  /** Default language for transcription (default: 'pt') */
  defaultLanguage?: string;
  /** Maximum file size in MB (default: 25) */
  maxFileSizeMb?: number;
}

/**
 * Processor interface - all processors must implement this
 */
export interface Processor {
  /** Processor name (groq_whisper, gemini_vision, etc.) */
  readonly name: string;
  /** Supported MIME types (can include wildcards like 'audio/*') */
  readonly supportedMimeTypes: readonly string[];

  /**
   * Check if processor can handle the given MIME type
   */
  canProcess(mimeType: string): boolean;

  /**
   * Process a media file
   *
   * @param filePath - Absolute path to the media file
   * @param mimeType - MIME type of the file
   * @param options - Additional options (language, duration, etc.)
   */
  process(filePath: string, mimeType: string, options?: ProcessOptions): Promise<ProcessingResult>;
}

/**
 * Options passed to processor.process()
 */
export interface ProcessOptions {
  /** Language hint for transcription (e.g., 'pt', 'en') */
  language?: string;
  /** Duration in seconds (for cost calculation) */
  durationSeconds?: number;
  /** Caption context for images (improves description quality) */
  caption?: string;
  /** Override prompt for LLM-based processing (description, OCR, transcription) */
  prompt?: string;
  /** Domain context for transcription disambiguation */
  context?: string;
  /** Likely terms/acronyms/products for transcription */
  glossary?: string[];
  /** Provider override */
  provider?: string;
  /** Model override */
  model?: string;
}

/**
 * Pricing unit for cost calculations
 */
export type PricingUnit = 'per_hour' | 'per_minute' | 'per_million_tokens' | 'per_document';

/**
 * Pricing rate for a specific model
 */
export interface PricingRate {
  /** Model identifier */
  model: string;
  /** Provider name */
  provider: string;
  /** Pricing unit */
  unit: PricingUnit;
  /** Input rate (in dollars) */
  inputRate: number;
  /** Output rate (in dollars, for token-based) */
  outputRate?: number;
}

/**
 * Timeout configuration for media processors (env-configurable)
 */
export interface MediaTimeoutConfig {
  /** Audio processing timeout in ms (env: MEDIA_AUDIO_TIMEOUT_MS, default 30000) */
  audioTimeoutMs: number;
  /**
   * Image (vision) processing timeout in ms.
   * env: MEDIA_IMAGE_TIMEOUT_MS, default 30000.
   * On timeout, processors retry once with 2× this value (extended timeout)
   * before falling back to the secondary provider. See issue #478.
   */
  imageTimeoutMs: number;
  /** Video processing timeout in ms (env: MEDIA_VIDEO_TIMEOUT_MS, default 60000) */
  videoTimeoutMs: number;
  /** Document processing timeout in ms (env: MEDIA_DOCUMENT_TIMEOUT_MS, default 30000) */
  documentTimeoutMs: number;
}

/**
 * Default timeout values for media processors.
 * imageTimeoutMs bumped 15000 → 30000 in v2.260422 to reduce
 * Gemini Vision timeout rate on complex/large images (issue #478).
 */
export const DEFAULT_MEDIA_TIMEOUTS: MediaTimeoutConfig = {
  audioTimeoutMs: 30_000,
  imageTimeoutMs: 30_000,
  videoTimeoutMs: 60_000,
  documentTimeoutMs: 30_000,
};

/**
 * Read timeout configuration from environment variables with defaults.
 */
export function getMediaTimeouts(): MediaTimeoutConfig {
  return {
    audioTimeoutMs: Number(process.env.MEDIA_AUDIO_TIMEOUT_MS) || DEFAULT_MEDIA_TIMEOUTS.audioTimeoutMs,
    imageTimeoutMs: Number(process.env.MEDIA_IMAGE_TIMEOUT_MS) || DEFAULT_MEDIA_TIMEOUTS.imageTimeoutMs,
    videoTimeoutMs: Number(process.env.MEDIA_VIDEO_TIMEOUT_MS) || DEFAULT_MEDIA_TIMEOUTS.videoTimeoutMs,
    documentTimeoutMs: Number(process.env.MEDIA_DOCUMENT_TIMEOUT_MS) || DEFAULT_MEDIA_TIMEOUTS.documentTimeoutMs,
  };
}

/**
 * Media content row shape (for DB storage)
 */
export interface MediaContentInput {
  eventId?: string;
  mediaId?: string;
  processingType: 'transcription' | 'description' | 'extraction';
  content: string;
  model?: string;
  provider?: string;
  language?: string;
  duration?: number;
  tokensUsed?: number;
  costUsd?: number;
  processingTimeMs?: number;
}
