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
