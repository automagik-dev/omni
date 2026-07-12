/**
 * Pure, DOM-free helpers for the Settings page. Kept separate so the grouping,
 * value coercion, display masking, and — most importantly — the secret-wipe
 * guard are unit-testable without mounting the React page.
 */
import type { SettingRow } from '../../api/ext';

/** Group a setting key by its leading `prefix.` (or `prefix_`) segment. */
export function groupOf(key: string): string {
  const dot = key.indexOf('.');
  if (dot > 0) return key.slice(0, dot);
  const us = key.indexOf('_');
  return us > 0 ? key.slice(0, us) : 'general';
}

/** Parse a value string the way the API's type auto-detect expects: JSON if it parses, else the raw string. */
export function coerceValue(text: string): unknown {
  const t = text.trim();
  if (!t) return '';
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
}

/** How a setting's current value is shown in the table/detail (secrets stay masked). */
export function displayValue(s: Pick<SettingRow, 'isSecret' | 'value'>): string {
  if (s.isSecret) return '••••••••';
  if (s.value === null || s.value === undefined) return '—';
  return typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value);
}

/**
 * Guard against silently wiping a real secret. A secret setting (e.g.
 * `elevenlabs.api_key`) arrives masked, so the edit field starts empty; saving
 * that empty field would PUT `value: ''` and overwrite the stored secret with
 * nothing. Returns true when Save must be blocked: a secret whose edit field is
 * blank/whitespace. Non-secret keys may be set to empty deliberately.
 */
export function isSecretWipe(setting: Pick<SettingRow, 'isSecret'>, editValue: string): boolean {
  return Boolean(setting.isSecret) && editValue.trim() === '';
}
