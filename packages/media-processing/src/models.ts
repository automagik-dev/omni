/**
 * Centralized AI model constants for media processing.
 *
 * Change model versions here instead of hunting through individual processors.
 * Pricing keys in pricing.ts must stay in sync with these values.
 */

// ============================================================================
// Google Gemini
// ============================================================================

/** Primary model for image description, video analysis, and document OCR */
export const GEMINI_MODEL = 'gemini-3-flash-preview';

// ============================================================================
// OpenAI
// ============================================================================

/** Fallback model for image description (when Gemini unavailable) */
export const OPENAI_VISION_MODEL = 'gpt-4o-mini';

/**
 * Chat-lane fallback for audio transcription. Never the primary: chat models
 * reply conversationally instead of failing on unusable audio (issue #942),
 * so their output is validated by the transcription guard.
 */
export const OPENAI_AUDIO_CHAT_MODEL = 'gpt-audio-mini';

/** Primary OpenAI transcription model (purpose-built STT endpoint) */
export const OPENAI_TRANSCRIBE_MODEL = 'gpt-4o-transcribe';

/** Backward-compatible alias for OpenAI transcription fallback */
export const OPENAI_WHISPER_MODEL = OPENAI_TRANSCRIBE_MODEL;

/** Gemini direct-audio fallback model */
export const GEMINI_AUDIO_MODEL = 'gemini-3.1-flash-lite';

// ============================================================================
// Groq
// ============================================================================

/** Primary model for audio transcription */
export const GROQ_WHISPER_MODEL = 'whisper-large-v3-turbo';
