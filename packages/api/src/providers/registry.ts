/**
 * Provider registry — register and resolve multimodal providers by capability.
 *
 * Each provider implements one or more capability interfaces (TTS, STT, etc.)
 * and is registered here. Verb commands resolve the active provider through
 * the registry, which checks:
 *   1. Explicit `--provider <name>` flag from the caller
 *   2. Config default from settings (e.g. `tts.provider = "gemini"`)
 *   3. First registered provider for the capability (fallback)
 */

import { createLogger } from '@omni/core';
import type { ProviderCapability, ProviderInterfaceMap } from './types';

const log = createLogger('provider-registry');

/** Settings reader interface — avoids circular dep on SettingsService */
export interface ProviderSettingsReader {
  getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | undefined>;
}

/**
 * Singleton provider registry.
 *
 * Usage:
 *   registry.register('tts', 'elevenlabs', elevenLabsTts);
 *   registry.register('tts', 'gemini', geminiTts);
 *   const tts = await registry.resolve('tts');           // config default
 *   const tts = await registry.resolve('tts', 'gemini'); // explicit
 */
class ProviderRegistry {
  /** capability -> Map<providerName, providerInstance> */
  private providers = new Map<ProviderCapability, Map<string, ProviderInterfaceMap[ProviderCapability]>>();
  private settings: ProviderSettingsReader | null = null;

  /** Settings key pattern: `<capability>.provider` → default provider name */
  private static readonly CONFIG_KEY: Record<ProviderCapability, string> = {
    tts: 'tts.provider',
    stt: 'stt.provider',
    imagegen: 'imagegen.provider',
    videogen: 'videogen.provider',
    vision: 'vision.provider',
    musicgen: 'musicgen.provider',
  };

  /**
   * Inject settings reader for config-based default resolution.
   * Called once during API startup after services are created.
   */
  setSettings(settings: ProviderSettingsReader): void {
    this.settings = settings;
  }

  /**
   * Register a provider for a capability.
   * The first provider registered for a capability becomes the implicit default
   * when no config default is set.
   */
  register<C extends ProviderCapability>(capability: C, name: string, provider: ProviderInterfaceMap[C]): void {
    let map = this.providers.get(capability);
    if (!map) {
      map = new Map();
      this.providers.set(capability, map);
    }

    if (map.has(name)) {
      log.warn('Overwriting existing provider', { capability, name });
    }

    map.set(name, provider);
    log.info('Provider registered', { capability, name });
  }

  /**
   * Resolve a provider for a capability.
   *
   * Resolution order:
   *   1. Explicit `name` argument (e.g. `--provider gemini`)
   *   2. Config default from settings DB (`tts.provider = "gemini"`)
   *   3. First registered provider (insertion order)
   *
   * Throws if no provider is registered for the capability.
   */
  async resolve<C extends ProviderCapability>(capability: C, name?: string): Promise<ProviderInterfaceMap[C]> {
    const map = this.providers.get(capability);
    if (!map || map.size === 0) {
      throw new Error(`No providers registered for capability "${capability}"`);
    }

    // 1. Explicit name
    if (name) {
      const provider = map.get(name);
      if (!provider) {
        const available = Array.from(map.keys()).join(', ');
        throw new Error(`Provider "${name}" not found for "${capability}". Available: ${available}`);
      }
      return provider as ProviderInterfaceMap[C];
    }

    // 2. Config default
    if (this.settings) {
      const configKey = ProviderRegistry.CONFIG_KEY[capability];
      const configDefault = await this.settings.getString(configKey);
      if (configDefault && map.has(configDefault)) {
        return map.get(configDefault) as ProviderInterfaceMap[C];
      }
    }

    // 3. First registered
    const first = map.values().next().value;
    return first as ProviderInterfaceMap[C];
  }

  /**
   * Get a specific provider by capability and name.
   * Returns undefined if not found (no fallback).
   */
  get<C extends ProviderCapability>(capability: C, name: string): ProviderInterfaceMap[C] | undefined {
    return this.providers.get(capability)?.get(name) as ProviderInterfaceMap[C] | undefined;
  }

  /**
   * List all registered provider names for a capability.
   */
  list(capability: ProviderCapability): string[] {
    const map = this.providers.get(capability);
    return map ? Array.from(map.keys()) : [];
  }

  /**
   * List all registered capabilities and their providers.
   */
  listAll(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [capability, map] of this.providers) {
      result[capability] = Array.from(map.keys());
    }
    return result;
  }

  /**
   * Check if any provider is registered for a capability.
   */
  has(capability: ProviderCapability): boolean {
    const map = this.providers.get(capability);
    return !!map && map.size > 0;
  }

  /**
   * Remove a provider registration.
   */
  unregister(capability: ProviderCapability, name: string): boolean {
    const map = this.providers.get(capability);
    if (!map) return false;
    const removed = map.delete(name);
    if (removed) {
      log.info('Provider unregistered', { capability, name });
    }
    return removed;
  }

  /**
   * Clear all registrations. Useful for testing.
   */
  clear(): void {
    this.providers.clear();
  }
}

/** Global registry instance — imported by providers and verb commands */
export const providerRegistry = new ProviderRegistry();
