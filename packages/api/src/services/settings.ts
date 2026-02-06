/**
 * Settings service - manages global settings
 */

import { NotFoundError, createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { type GlobalSetting, type SettingValueType, globalSettings, settingChangeHistory } from '@omni/db';
import { desc, eq } from 'drizzle-orm';

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
    key: 'media.default_language',
    category: 'media',
    valueType: 'string',
    isSecret: false,
    description: 'Default language for media processing',
    defaultValue: 'pt',
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

  /**
   * List all settings, optionally filtered by category
   */
  async list(category?: string): Promise<GlobalSetting[]> {
    let query = this.db.select().from(globalSettings).$dynamic();

    if (category) {
      query = query.where(eq(globalSettings.category, category));
    }

    return query.orderBy(globalSettings.key);
  }

  /**
   * Get a setting by key
   */
  async getByKey(key: string): Promise<GlobalSetting> {
    const [result] = await this.db.select().from(globalSettings).where(eq(globalSettings.key, key)).limit(1);

    if (!result) {
      throw new NotFoundError('Setting', key);
    }

    return result;
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
    const stringValue = this.stringifyValue(value);

    // Get existing setting if it exists
    const existing = await this.db.select().from(globalSettings).where(eq(globalSettings.key, key)).limit(1);

    const existingSetting = existing[0];
    if (existingSetting) {
      // Update existing
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

      return updated;
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

    return created;
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
