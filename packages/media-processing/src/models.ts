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

/** Fallback model for audio transcription (when Groq unavailable) */
export const OPENAI_WHISPER_MODEL = 'whisper-1';

// ============================================================================
// Groq
// ============================================================================

/** Primary model for audio transcription */
export const GROQ_WHISPER_MODEL = 'whisper-large-v3-turbo';
