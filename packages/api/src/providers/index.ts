/**
 * Provider framework — multimodal provider abstraction layer.
 *
 * Exports interfaces, registry, and shared clients.
 * Individual provider implementations (gemini/, elevenlabs/, groq/)
 * register themselves with the registry on import.
 */

export * from './types';
export { ProviderRegistry, providerRegistry } from './registry';
export type { ProviderSettingsReader } from './registry';
export { GEMINI_MODELS, getGeminiClient, resolveGeminiApiKey, resetGeminiClient } from './gemini/client';
export { GeminiSttProvider } from './gemini/stt';
export { GroqSttProvider, GROQ_STT_MODEL } from './groq/stt';
