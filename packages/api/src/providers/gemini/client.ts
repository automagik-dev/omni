/**
 * Shared Google Gemini SDK client and model constants.
 *
 * All Gemini-based providers (TTS, STT, image gen, video gen, vision)
 * share a single client instance initialized from the Gemini API key
 * stored in settings or the GEMINI_API_KEY env var.
 */

import { GoogleGenAI } from '@google/genai';
import { createLogger } from '@omni/core';

const log = createLogger('gemini');

// ---------------------------------------------------------------------------
// Model constants
// ---------------------------------------------------------------------------

export const GEMINI_MODELS = {
  /** Flash model — fast, general purpose */
  FLASH: 'gemini-2.0-flash',
  /** Pro model — highest quality text/vision */
  PRO: 'gemini-2.5-pro-preview-06-05',
  /** TTS — text-to-speech via multimodal live */
  TTS: 'gemini-2.5-flash-preview-tts',
  /** Image generation — Imagen 3 (Nano Banana 2) */
  IMAGE_GEN: 'imagen-3.0-generate-002',
  /** Video generation — Veo 3.1 */
  VIDEO_GEN: 'veo-3.0-generate-preview',
  /** Vision — image/video understanding */
  VISION: 'gemini-2.0-flash',
  /** STT — speech-to-text */
  STT: 'gemini-2.0-flash',
} as const;

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let clientInstance: GoogleGenAI | null = null;
let clientApiKey: string | null = null;

/**
 * Get or create the shared Gemini client.
 *
 * The client is lazily initialized on first call and reused.
 * If the API key changes (e.g. rotated in settings), a new client is created.
 */
export function getGeminiClient(apiKey: string): GoogleGenAI {
  if (clientInstance && clientApiKey === apiKey) {
    return clientInstance;
  }

  log.info('Initializing Gemini client');
  clientInstance = new GoogleGenAI({ apiKey });
  clientApiKey = apiKey;
  return clientInstance;
}

/**
 * Resolve the Gemini API key from settings reader or environment.
 * Throws if not configured.
 */
export async function resolveGeminiApiKey(settings: {
  getSecret(key: string, envFallback?: string): Promise<string | undefined>;
}): Promise<string> {
  const apiKey = await settings.getSecret('gemini.api_key', 'GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error(
      'Gemini API key not configured. Set it in Settings > Media (gemini.api_key) or via GEMINI_API_KEY env var.',
    );
  }
  return apiKey;
}
