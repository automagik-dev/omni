/**
 * Settings service - manages global settings
 *
 * TENANT-BOUND SEALING OF SECRET SETTINGS (G5 deliverable (g); ADR-0008)
 * ----------------------------------------------------------------------
 * A `global_settings` row flagged `is_secret` holds live credential material —
 * `elevenlabs.api_key` and its siblings. ADR-0008 requires such values to be
 * encrypted with tenant-bound context, and names one consequence explicitly:
 * "plaintext never appears in ... migration receipts". `setting_change_history`
 * IS that receipt, and it copies both the old and the new value on every change.
 * Sealing before the write therefore protects the history rows for free — the
 * receipt records ciphertext because there was never plaintext to record.
 *
 * `global_settings` is a G0-`split` table with no `tenant_id` yet (its
 * destinations are `tenant_settings` / `platform_settings`), so — exactly as in
 * `providers.ts` — the binding is the ACTIVE TENANT SCOPE rather than a per-row
 * owner. Whether a row is secret is the row's own `is_secret` for an existing
 * setting, and the seeded definition for a new one; a value whose secrecy cannot
 * be established is left in the clear, so this can never seal an operational
 * setting an operator needs to read.
 *
 * DUAL WORLD. No scope or no master key ⇒ the codec is the identity function and
 * every value is stored and returned exactly as before G5. Reads are
 * transitional: legacy plaintext and sealed values coexist.
 */

import { NotFoundError, createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { type GlobalSetting, type SettingValueType, globalSettings, settingChangeHistory } from '@omni/db';
import { desc, eq } from 'drizzle-orm';
import { openCredentialField, sealCredentialField } from '../tenancy/sealed-credentials';
import { currentTenantScope } from '../tenancy/tenant-scope';

const log = createLogger('settings');

/**
 * Known default settings that should always exist in the database.
 * Seeded on API startup so they appear in UI.
 */
const DEFAULT_SETTINGS: Array<{
  key: string;
  category: string;
  valueType: SettingValueType;
  isSecret: boolean;
  description: string;
  defaultValue?: string;
}> = [
  {
    key: 'elevenlabs.api_key',
    category: 'tts',
    valueType: 'secret',
    isSecret: true,
    description: 'ElevenLabs API key for text-to-speech',
  },
  {
    key: 'elevenlabs.default_voice',
    category: 'tts',
    valueType: 'string',
    isSecret: false,
    description: 'Default ElevenLabs voice ID',
    defaultValue: 'JBFqnCBsd6RMkjVDRZzb',
  },
  {
    key: 'elevenlabs.default_model',
    category: 'tts',
    valueType: 'string',
    isSecret: false,
    description: 'Default ElevenLabs model',
    defaultValue: 'eleven_v3',
  },
  {
    key: 'groq.api_key',
    category: 'media',
    valueType: 'secret',
    isSecret: true,
    description: 'Groq API key for Whisper audio transcription',
  },
  {
    key: 'openai.api_key',
    category: 'media',
    valueType: 'secret',
    isSecret: true,
    description: 'OpenAI API key (fallback for audio, vision)',
  },
  {
    key: 'gemini.api_key',
    category: 'media',
    valueType: 'secret',
    isSecret: true,
    description: 'Google Gemini API key (vision, document OCR)',
  },
  {
    key: 'deepseek.api_key',
    category: 'media',
    valueType: 'secret',
    isSecret: true,
    description: 'DeepSeek API key for text/vision benchmarking via Anthropic-compatible API',
  },
  {
    key: 'vision.deepseek.model',
    category: 'vision',
    valueType: 'string',
    isSecret: false,
    description: 'Default DeepSeek vision/text model for vision provider dogfood',
    defaultValue: 'deepseek-v4-flash',
  },
  {
    key: 'deepseek.anthropic_url',
    category: 'media',
    valueType: 'string',
    isSecret: false,
    description: 'DeepSeek Anthropic-compatible Messages API URL',
    defaultValue: 'https://api.deepseek.com/anthropic/v1/messages',
  },
  {
    key: 'media.default_language',
    category: 'media',
    valueType: 'string',
    isSecret: false,
    description: 'Default language for media processing',
    defaultValue: 'pt',
  },
  // Prompt overrides (null = use code default from @omni/media-processing)
  {
    key: 'prompt.image_description',
    category: 'prompts',
    valueType: 'string',
    isSecret: false,
    description: 'Override prompt for image description (null = code default)',
  },
  {
    key: 'prompt.video_description',
    category: 'prompts',
    valueType: 'string',
    isSecret: false,
    description: 'Override prompt for video description (null = code default)',
  },
  {
    key: 'prompt.document_ocr',
    category: 'prompts',
    valueType: 'string',
    isSecret: false,
    description: 'Override prompt for document OCR (null = code default)',
  },
  {
    key: 'prompt.audio_transcription',
    category: 'prompts',
    valueType: 'string',
    isSecret: false,
    description: 'Override prompt/context for audio transcription (null = provider default)',
  },
  {
    key: 'prompt.response_gate',
    category: 'prompts',
    valueType: 'string',
    isSecret: false,
    description: 'Override prompt for response gate (null = code default)',
  },
  // Provider defaults — which provider to use for each capability
  {
    key: 'tts.provider',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default TTS provider (e.g. "elevenlabs", "gemini", "openai")',
    defaultValue: 'elevenlabs',
  },
  {
    key: 'tts.gemini.model',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default Gemini TTS model.',
    defaultValue: 'gemini-3.1-flash-tts-preview',
  },
  {
    key: 'tts.gemini.default_voice',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default Gemini TTS voice for PT-BR voice notes.',
    defaultValue: 'Orus',
  },
  {
    key: 'tts.gemini.default_language',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default Gemini TTS language/style hint.',
    defaultValue: 'pt-BR',
  },
  {
    key: 'tts.gemini.default_style',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default Felipe-style Gemini TTS voice-note prompt.',
    defaultValue:
      'Fale em português brasileiro, como uma nota de WhatsApp natural: direto, quente, sem voz de locutor, com pausas curtas quando fizer sentido.',
  },
  {
    key: 'tts.openai.model',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default OpenAI TTS model.',
    defaultValue: 'gpt-4o-mini-tts',
  },
  {
    key: 'tts.openai.default_voice',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default OpenAI TTS voice.',
    defaultValue: 'cedar',
  },
  {
    key: 'tts.openai.default_instructions',
    category: 'prompts',
    valueType: 'string',
    isSecret: false,
    description: 'Default OpenAI TTS speaking instructions (null = provider default).',
  },
  {
    key: 'stt.provider',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default STT provider (e.g. "openai", "groq", "gemini")',
    defaultValue: 'openai',
  },

  {
    key: 'stt.openai.model',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default OpenAI STT model. Quality candidate: gpt-audio-mini; stable fallback: gpt-4o-transcribe.',
    defaultValue: 'gpt-audio-mini',
  },
  {
    key: 'stt.gemini.model',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default Gemini direct-audio STT model.',
    defaultValue: 'gemini-3.1-flash-lite',
  },
  {
    key: 'videogen.gemini.model',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default Gemini Veo video generation model.',
    defaultValue: 'veo-3.1-generate-preview',
  },
  {
    key: 'imagegen.provider',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default image generation provider (e.g. "gemini", "openai")',
    defaultValue: 'gemini',
  },
  {
    key: 'imagegen.gemini.model',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default Gemini image model alias or ID.',
    defaultValue: 'nano-banana-2',
  },
  {
    key: 'imagegen.openai.model',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default OpenAI image generation model.',
    defaultValue: 'gpt-image-2',
  },
  {
    key: 'videogen.provider',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default video generation provider (e.g. "gemini")',
    defaultValue: 'gemini',
  },
  {
    key: 'vision.provider',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default vision provider (e.g. "gemini")',
    defaultValue: 'gemini',
  },
  {
    key: 'musicgen.provider',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default music generation provider (e.g. "gemini")',
    defaultValue: 'gemini',
  },
  {
    key: 'musicgen.gemini.model',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default Gemini Lyria full-song model.',
    defaultValue: 'lyria-3-pro-preview',
  },
  {
    key: 'musicgen.gemini.clip_model',
    category: 'providers',
    valueType: 'string',
    isSecret: false,
    description: 'Default Gemini Lyria clip model.',
    defaultValue: 'lyria-3-clip-preview',
  },
];

export interface SettingWithHistory extends GlobalSetting {
  history?: Array<{
    oldValue: string | null;
    newValue: string | null;
    changedBy: string | null;
    changedAt: Date;
    changeReason: string | null;
  }>;
}

export class SettingsService {
  constructor(private db: Database) {}

  /** The tenant this service seals under / opens with; null on legacy paths. */
  private get tenantId(): string | null {
    return currentTenantScope()?.tenantId ?? null;
  }

  /**
   * Whether the setting named `key` holds secret material.
   *
   * An existing row's own `is_secret` is authoritative. For a key being created
   * for the first time, the seeded definition is consulted, so
   * `setValue('elevenlabs.api_key', ...)` seals even before `seedDefaults` has
   * run. Unknown keys are NOT secret — failing towards plaintext here is
   * deliberate: sealing an operational setting nobody declared secret would hide
   * it from operators with no way to tell why.
   */
  private isSecretSetting(key: string, existing?: GlobalSetting): boolean {
    if (existing?.isSecret) return true;
    // The seeded definition is the fallback in BOTH directions: for a key being
    // created for the first time, and for a pre-existing row whose `is_secret`
    // was never set (rows created by `setValue` before `seedDefaults` ran
    // default the column to false). Without the second case a declared secret
    // could be sealed on write and then not recognised on read.
    return DEFAULT_SETTINGS.some((def) => def.key === key && def.isSecret);
  }

  /** Open a loaded row's value when it is a sealed secret; identity otherwise. */
  private openSetting(row: GlobalSetting): GlobalSetting {
    if (!this.isSecretSetting(row.key, row) || typeof row.value !== 'string') return row;
    const opened = openCredentialField(this.tenantId, row.value);
    if (opened === row.value) return row;
    return { ...row, value: opened ?? null };
  }

  /**
   * List all settings, optionally filtered by category
   */
  async list(category?: string): Promise<GlobalSetting[]> {
    let query = this.db.select().from(globalSettings).$dynamic();

    if (category) {
      query = query.where(eq(globalSettings.category, category));
    }

    const rows = await query.orderBy(globalSettings.key);
    return rows.map((row) => this.openSetting(row));
  }

  /**
   * Get a setting by key
   */
  async getByKey(key: string): Promise<GlobalSetting> {
    const [result] = await this.db.select().from(globalSettings).where(eq(globalSettings.key, key)).limit(1);

    if (!result) {
      throw new NotFoundError('Setting', key);
    }

    return this.openSetting(result);
  }

  /**
   * Get a setting value, parsed according to its type
   */
  async getValue<T = unknown>(key: string, defaultValue?: T): Promise<T> {
    try {
      const setting = await this.getByKey(key);
      return this.parseValue(setting.value, setting.valueType) as T;
    } catch (error) {
      if (error instanceof NotFoundError && defaultValue !== undefined) {
        return defaultValue;
      }
      throw error;
    }
  }

  /**
   * Set a setting value
   */
  async setValue(
    key: string,
    value: unknown,
    options?: { reason?: string; changedBy?: string },
  ): Promise<GlobalSetting> {
    const plainValue = this.stringifyValue(value);

    // Get existing setting if it exists
    const existing = await this.db.select().from(globalSettings).where(eq(globalSettings.key, key)).limit(1);

    const existingSetting = existing[0];
    // Seal BEFORE the write, so `stringValue` is what lands in the row AND in
    // the history receipt below. A non-secret setting, a legacy path, or a
    // deployment with no master key all leave this as the identity function.
    const stringValue = this.isSecretSetting(key, existingSetting)
      ? (sealCredentialField(this.tenantId, plainValue) ?? plainValue)
      : plainValue;

    if (existingSetting) {
      // Update existing. `oldValue` is the value AT REST — already sealed if the
      // previous write sealed it — so the receipt never gains plaintext.
      const oldValue = existingSetting.value;

      const [updated] = await this.db
        .update(globalSettings)
        .set({
          value: stringValue,
          updatedAt: new Date(),
          updatedBy: options?.changedBy,
        })
        .where(eq(globalSettings.key, key))
        .returning();

      if (!updated) {
        throw new Error('Failed to update setting');
      }

      // Record history
      await this.db.insert(settingChangeHistory).values({
        settingId: updated.id,
        oldValue,
        newValue: stringValue,
        changedBy: options?.changedBy,
        changeReason: options?.reason,
      });

      return this.openSetting(updated);
    }

    // Create new
    const [created] = await this.db
      .insert(globalSettings)
      .values({
        key,
        value: stringValue,
        valueType: this.inferValueType(value),
        createdBy: options?.changedBy,
        updatedBy: options?.changedBy,
      })
      .returning();

    if (!created) {
      throw new Error('Failed to create setting');
    }

    return this.openSetting(created);
  }

  /**
   * Bulk update settings
   */
  async setMany(
    settings: Record<string, unknown>,
    options?: { reason?: string; changedBy?: string },
  ): Promise<GlobalSetting[]> {
    const results: GlobalSetting[] = [];

    for (const [key, value] of Object.entries(settings)) {
      const result = await this.setValue(key, value, options);
      results.push(result);
    }

    return results;
  }

  /**
   * Delete a setting
   */
  async delete(key: string): Promise<void> {
    const result = await this.db.delete(globalSettings).where(eq(globalSettings.key, key)).returning();

    if (!result.length) {
      throw new NotFoundError('Setting', key);
    }
  }

  /**
   * Get setting change history
   */
  async getHistory(key: string, options?: { limit?: number; since?: Date }): Promise<SettingWithHistory['history']> {
    const setting = await this.getByKey(key);

    let query = this.db
      .select()
      .from(settingChangeHistory)
      .where(eq(settingChangeHistory.settingId, setting.id))
      .$dynamic();

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    return query.orderBy(desc(settingChangeHistory.changedAt));
  }

  /**
   * Seed default settings into the database.
   * Only inserts settings that don't already exist (won't overwrite user values).
   * Called on API startup.
   */
  async seedDefaults(): Promise<number> {
    let seeded = 0;

    for (const def of DEFAULT_SETTINGS) {
      const existing = await this.db
        .select({ key: globalSettings.key })
        .from(globalSettings)
        .where(eq(globalSettings.key, def.key))
        .limit(1);

      if (existing.length === 0) {
        await this.db.insert(globalSettings).values({
          key: def.key,
          value: def.defaultValue ?? null,
          valueType: def.valueType,
          category: def.category,
          description: def.description,
          isSecret: def.isSecret,
          defaultValue: def.defaultValue ?? null,
          createdBy: 'system',
          updatedBy: 'system',
        });
        seeded++;
      }
    }

    if (seeded > 0) {
      log.info('Seeded default settings', { count: seeded });
    }

    return seeded;
  }

  /**
   * Get a secret value, reading from settings DB first, falling back to env var.
   * Returns the unmasked value (for internal service use only).
   */
  async getSecret(key: string, envFallback?: string): Promise<string | undefined> {
    try {
      const setting = await this.getByKey(key);
      if (setting.value) {
        return setting.value;
      }
    } catch {
      // Setting not found, fall through to env
    }

    if (envFallback) {
      return process.env[envFallback] || undefined;
    }

    return undefined;
  }

  /**
   * Get a setting value as string, with optional env fallback.
   * Unlike getSecret, this is for non-secret string values.
   */
  async getString(key: string, envFallback?: string, defaultValue?: string): Promise<string | undefined> {
    try {
      const setting = await this.getByKey(key);
      if (setting.value) {
        return setting.value;
      }
    } catch {
      // Setting not found
    }

    if (envFallback) {
      const envValue = process.env[envFallback];
      if (envValue) return envValue;
    }

    return defaultValue;
  }

  /**
   * Parse a string value according to its type
   */
  private parseValue(value: string | null, valueType: SettingValueType): unknown {
    if (value === null) return null;

    switch (valueType) {
      case 'integer':
        return Number.parseInt(value, 10);
      case 'boolean':
        return value === 'true';
      case 'json':
        return JSON.parse(value);
      default:
        // 'string', 'secret', and other types return as-is
        return value;
    }
  }

  /**
   * Stringify a value for storage
   */
  private stringifyValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /**
   * Infer the value type from a JS value
   */
  private inferValueType(value: unknown): SettingValueType {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
    if (typeof value === 'object') return 'json';
    return 'string';
  }
}
